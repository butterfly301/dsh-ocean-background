export const VOYAGE_REPORT_MS = 1000

const STORAGE_KEY = 'ocean-background:voyage'

function randomInstanceId() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  } catch {}
  return `ocean-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function resolveStorage(storage) {
  if (storage !== undefined) return storage
  try {
    if (typeof localStorage !== 'undefined' && localStorage !== null) return localStorage
  } catch {}
  return null
}

function readRecord(storage) {
  if (!storage || typeof storage.getItem !== 'function') return null
  let raw
  try {
    raw = storage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
  if (typeof raw !== 'string' || raw === '') return null
  try {
    const value = JSON.parse(raw)
    if (!value || typeof value !== 'object') return null
    const ackedX = Number.isFinite(value.ackedX) && value.ackedX >= 0 ? value.ackedX : 0
    const travelX = Number.isFinite(value.travelX) && value.travelX >= ackedX ? value.travelX : ackedX
    const instanceId = typeof value.instanceId === 'string' && value.instanceId !== '' ? value.instanceId : null
    if (instanceId === null) return null
    return {
      instanceId,
      ackedX,
      travelX,
      from: Number.isFinite(value.from) ? value.from : null,
      to: Number.isFinite(value.to) ? value.to : null,
    }
  } catch {
    return null
  }
}

export function createVoyageReporter({
  send,
  getSessionId = () => null,
  now = () => Date.now(),
  intervalMs = VOYAGE_REPORT_MS,
  instanceId = null,
  storage = undefined,
} = {}) {
  const store = resolveStorage(storage)
  const saved = readRecord(store)
  const stableId = typeof instanceId === 'string' && instanceId !== ''
    ? instanceId
    : (saved?.instanceId ?? randomInstanceId())
  const restoredAcked = saved ? saved.ackedX : 0
  const restoredHigh = saved ? saved.travelX : 0
  let pending = Math.max(0, restoredHigh - restoredAcked)
  let sent = restoredAcked
  let acked = restoredAcked
  let spanFrom = pending > 0 ? saved?.from ?? null : null
  let spanTo = pending > 0 ? saved?.to ?? null : null
  let restored = pending > 0
  let lastAt = now()
  let generation = 0
  let disposed = false

  function persist(ack, high, from, to) {
    if (!store || typeof store.setItem !== 'function') return
    try {
      store.setItem(STORAGE_KEY, JSON.stringify({
        version: 1,
        instanceId: stableId,
        ackedX: ack,
        travelX: high,
        from: Number.isFinite(from) ? from : null,
        to: Number.isFinite(to) ? to : null,
      }))
    } catch {}
  }

  persist(acked, sent + pending, spanFrom, spanTo)

  function flush() {
    if (typeof send !== 'function' || !(pending > 0)) return Promise.resolve()
    const sessionId = typeof getSessionId === 'function' ? getSessionId() : null
    if (restored && (sessionId === null || sessionId === undefined)) return Promise.resolve()
    const delta = pending
    const from = spanFrom
    const to = spanTo
    const target = sent + delta
    pending = 0
    sent = target
    spanFrom = null
    spanTo = null
    const mine = ++generation
    const needsBaseline = restored
    persist(acked, target, from, to)
    const sendTarget = () => Promise.resolve().then(() => send({
      instanceId: stableId,
      sessionId,
      travelX: target,
      from,
      to,
    }))
    const task = needsBaseline
      ? Promise.resolve()
        .then(() => send({ instanceId: stableId, sessionId, travelX: acked, from: null, to: null }))
        .then(() => {
          restored = false
          return sendTarget()
        })
      : sendTarget()
    return task.then(() => {
      restored = false
      if (target > acked) acked = target
      persist(acked, sent + pending, spanFrom, spanTo)
    }).catch(() => {
      if (generation !== mine) return
      sent -= delta
      pending += delta
      spanFrom = from
      spanTo = to
    })
  }

  function add(meters) {
    if (disposed || !Number.isFinite(meters) || meters <= 0) return
    const stamp = now()
    if (pending === 0 || spanFrom === null) spanFrom = stamp
    spanTo = stamp
    pending += meters
    if (stamp - lastAt >= intervalMs) {
      lastAt = stamp
      void flush()
    }
  }

  function dispose() {
    persist(acked, sent + pending, spanFrom, spanTo)
    const task = flush()
    disposed = true
    return task
  }

  return {
    add,
    flush,
    dispose,
    get instanceId() { return stableId },
    get pending() { return pending },
    get sent() { return sent },
    get intervalMs() { return intervalMs },
  }
}
