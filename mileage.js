import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const METERS_PER_NM = 1852

const FILE = 'mileage.json'
const VERSION = 1
const INSTANCE_TTL_MS = 60 * 60 * 1000
const MAX_SPAN_MS = 10 * 60 * 1000
const MAX_INSTANCES = 64

function pad2(value) {
  return String(value).padStart(2, '0')
}

export function dayKeyOf(ms) {
  const date = new Date(ms)
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

function nextMidnight(ms) {
  const date = new Date(ms)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime()
}

function metersOf(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function emptyState() {
  return {
    version: VERSION,
    days: Object.create(null),
    fleets: Object.create(null),
    forks: Object.create(null),
    instances: Object.create(null),
  }
}

export function createMileageLedger({ dir = null, now = Date.now, writeDelayMs = 2000, onWarn = null } = {}) {
  let state = emptyState()
  let dirty = false
  let saveTimer = null
  let writing = Promise.resolve()
  let loading = null
  let closed = false

  function warn(error) {
    try {
      if (typeof onWarn === 'function') onWarn(error)
    } catch {}
  }

  function adopt(raw) {
    if (!raw || typeof raw !== 'object') return
    const next = emptyState()
    if (raw.days && typeof raw.days === 'object') {
      for (const [key, value] of Object.entries(raw.days)) {
        const meters = metersOf(value)
        if (meters !== null && /^\d{4}-\d{2}-\d{2}$/.test(key)) next.days[key] = meters
      }
    }
    if (raw.fleets && typeof raw.fleets === 'object') {
      for (const [key, value] of Object.entries(raw.fleets)) {
        const meters = metersOf(value?.meters)
        if (typeof key !== 'string' || key === '' || meters === null) continue
        const updatedAt = typeof value?.updatedAt === 'number' && Number.isFinite(value.updatedAt) ? value.updatedAt : 0
        next.fleets[key] = { meters, updatedAt }
      }
    }
    if (raw.forks && typeof raw.forks === 'object') {
      for (const [key, value] of Object.entries(raw.forks)) {
        const baseMeters = metersOf(value?.baseMeters)
        if (typeof key !== 'string' || key === '' || baseMeters === null) continue
        next.forks[key] = {
          baseMeters,
          sourceRootId: typeof value?.sourceRootId === 'string' ? value.sourceRootId : '',
          createdAt: typeof value?.createdAt === 'number' && Number.isFinite(value.createdAt) ? value.createdAt : 0,
        }
      }
    }
    if (raw.instances && typeof raw.instances === 'object') {
      for (const [key, value] of Object.entries(raw.instances)) {
        const x = metersOf(value?.x)
        if (typeof key !== 'string' || key === '' || x === null) continue
        next.instances[key] = {
          x,
          at: typeof value?.at === 'number' && Number.isFinite(value.at) ? value.at : 0,
          rootId: typeof value?.rootId === 'string' && value.rootId !== '' ? value.rootId : null,
          eligible: value?.eligible === true,
        }
      }
    }
    state = next
  }

  function pruneInstances(at) {
    const entries = Object.entries(state.instances)
      .filter(([, value]) => at - value.at <= INSTANCE_TTL_MS)
      .sort((left, right) => right[1].at - left[1].at)
      .slice(0, MAX_INSTANCES)
    if (entries.length === Object.keys(state.instances).length) return
    const next = Object.create(null)
    for (const [key, value] of entries) next[key] = value
    state.instances = next
  }

  function load() {
    if (dir === null) return Promise.resolve()
    const target = join(dir, FILE)
    return readFile(target, 'utf8').then((raw) => {
      adopt(JSON.parse(raw))
      pruneInstances(now())
    }).catch((error) => {
      if (error?.code !== 'ENOENT') warn(error)
    })
  }

  function ready() {
    if (loading === null) loading = load()
    return loading
  }

  function serialize() {
    return {
      version: VERSION,
      days: state.days,
      fleets: state.fleets,
      forks: state.forks,
      instances: state.instances,
    }
  }

  function flush() {
    if (saveTimer !== null) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    if (dir === null || !dirty) return writing
    dirty = false
    const body = JSON.stringify(serialize(), null, 2)
    writing = writing.then(async () => {
      await mkdir(dir, { recursive: true })
      const temp = join(dir, `.${FILE}.${process.pid}.tmp`)
      await writeFile(temp, body, 'utf8')
      await rename(temp, join(dir, FILE))
    }).catch((error) => {
      dirty = true
      warn(error)
    })
    return writing
  }

  function scheduleSave() {
    if (dir === null || closed) return
    dirty = true
    if (saveTimer !== null) return
    saveTimer = setTimeout(() => {
      saveTimer = null
      void flush()
    }, writeDelayMs)
    if (typeof saveTimer.unref === 'function') saveTimer.unref()
  }

  function baseOf(rootId) {
    const record = state.forks[rootId]
    return record ? record.baseMeters : 0
  }

  function fleetMeters(rootId) {
    if (typeof rootId !== 'string') return 0
    const own = state.fleets[rootId]?.meters ?? 0
    return baseOf(rootId) + own
  }

  function addFleet(rootId, meters, at) {
    const record = state.fleets[rootId] ?? { meters: 0, updatedAt: 0 }
    record.meters += meters
    record.updatedAt = at
    state.fleets[rootId] = record
  }

  function addDay(key, meters) {
    state.days[key] = (state.days[key] ?? 0) + meters
  }

  function distribute(delta, from, to, rootId) {
    const start = Math.min(from, to)
    const end = Math.max(from, to)
    const at = Number.isFinite(to) ? to : start
    if (!(end > start)) {
      addDay(dayKeyOf(at), delta)
      addFleet(rootId, delta, at)
      return
    }
    let cursor = start
    let left = delta
    while (left > 0) {
      const boundary = nextMidnight(cursor)
      if (boundary >= end) {
        addDay(dayKeyOf(cursor), left)
        addFleet(rootId, left, at)
        break
      }
      const share = left * ((boundary - cursor) / (end - cursor))
      addDay(dayKeyOf(cursor), share)
      addFleet(rootId, share, at)
      left -= share
      cursor = boundary
    }
  }

  function view(rootId, eligible) {
    const day = dayKeyOf(now())
    const known = typeof rootId === 'string' && rootId !== ''
    const metering = known && eligible === true
    return {
      sessionId: known ? rootId : null,
      eligible: metering,
      mode: metering ? 'fleet' : 'today',
      day,
      todayMeters: state.days[day] ?? 0,
      fleetMeters: known ? fleetMeters(rootId) : 0,
    }
  }

  function credit({ instanceId, travelX, rootId, eligible, at, from, to }) {
    const time = Number.isFinite(at) ? at : now()
    const key = String(instanceId)
    const known = typeof rootId === 'string' && rootId !== ''
    const metering = known && eligible === true
    const root = metering ? rootId : null
    const x = metersOf(travelX)
    if (x === null) return 0
    const instance = state.instances[key]
    if (instance === undefined) {
      state.instances[key] = { x, at: time, rootId: root, eligible: metering }
      pruneInstances(time)
      scheduleSave()
      return 0
    }
    const same = instance.rootId === root && instance.eligible === metering
    instance.at = time
    instance.rootId = root
    instance.eligible = metering
    if (!same) {
      instance.x = x
      scheduleSave()
      return 0
    }
    const delta = x - instance.x
    if (!(delta > 0)) {
      instance.x = Math.max(instance.x, x)
      scheduleSave()
      return 0
    }
    instance.x = x
    if (!metering) {
      scheduleSave()
      return 0
    }
    let start = Number.isFinite(from) ? from : time
    let end = Number.isFinite(to) ? to : time
    end = Math.min(end, time)
    start = Math.min(start, end)
    if (end - start > MAX_SPAN_MS) start = end - MAX_SPAN_MS
    distribute(delta, start, end, root)
    scheduleSave()
    return delta
  }

  function hasForkRoot(rootId) {
    return typeof rootId === 'string' && rootId !== '' && Object.hasOwn(state.forks, rootId)
  }

  async function beginFork(rootId) {
    await ready()
    if (typeof rootId !== 'string' || rootId === '') return null
    return { rootId, baseMeters: fleetMeters(rootId) }
  }

  async function settleFork(token, childId) {
    if (!token || typeof childId !== 'string' || childId === '') return false
    await ready()
    if (Object.hasOwn(state.forks, childId)) return false
    state.forks[childId] = {
      baseMeters: token.baseMeters,
      sourceRootId: token.rootId,
      createdAt: now(),
    }
    scheduleSave()
    return true
  }

  async function dispose() {
    closed = true
    await flush()
  }

  return {
    ready,
    credit,
    view,
    hasForkRoot,
    fleetMeters,
    beginFork,
    settleFork,
    flush,
    dispose,
    get state() { return state },
  }
}
