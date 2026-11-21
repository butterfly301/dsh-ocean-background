// Host-owned session reading. Each Cordis context owns its caches and diagnostics.
import { STATUS, sumBuckets, createFoldState, foldSessionFacts, statusOfFacts } from './session-facts.js'

/** `SessionHeader.origin` marks a Session created as a subagent child. */
const SUBAGENT_ORIGIN = 'subagent'
/** Bound for one upward walk; a cycle or a deep tree stops instead of looping. */
const MAX_ANCESTRY_DEPTH = 64
/** A cold Session is re-read from persistence at most once per window. */
const COLD_READ_TTL_MS = 1500
/** Header reads are cheap but not free; ancestry reuses them briefly. */
const HEADER_TTL_MS = 5000
/** Upper bound on retained per-Session fold state. */
const MAX_CACHE_ENTRIES = 256
/** Fold state untouched for this long is dropped. */
const CACHE_IDLE_MS = 120_000
/** Repeated failures log once per window instead of once per poll. */
const LOG_INTERVAL_MS = 10_000
const MAX_LOG_KEYS = 64

let states = new WeakMap()

function stateOf(ctx) {
  let state = states.get(ctx)
  if (state === undefined) {
    state = { sessionCache: new Map(), headerCache: new Map(), inflight: new Map(), logTimes: new Map(), notified: new Set() }
    states.set(ctx, state)
  }
  return state
}

export function readService(ctx, key) {
  try {
    if (typeof ctx.get === 'function') return ctx.get(key)
    if (ctx.reflect && typeof ctx.reflect.get === 'function') return ctx.reflect.get(key)
  } catch {}
  return undefined
}

export function describeError(error) {
  try {
    return error instanceof Error ? error.message : String(error)
  } catch {
    return 'unrenderable error'
  }
}

function logNow(ctx, level, message) {
  try {
    const logger = ctx?.logger
    const method = logger?.[level] ?? logger?.info
    if (typeof method === 'function') method.call(logger, message)
    else if (typeof logger === 'function') logger.call(ctx, message)
  } catch {}
}

export function logOnce(ctx, level, key, message) {
  const { logTimes } = stateOf(ctx)
  const now = Date.now()
  const previous = logTimes.get(key)
  if (previous !== undefined && now - previous < LOG_INTERVAL_MS) return
  if (logTimes.size >= MAX_LOG_KEYS && !logTimes.has(key)) logTimes.clear()
  logTimes.set(key, now)
  logNow(ctx, level, message)
}

export function notifyOnce(ctx, level, key, message) {
  const { notified } = stateOf(ctx)
  if (notified.has(key)) return
  notified.add(key)
  logNow(ctx, level, message)
}

function disposeObservation(observation) {
  if (!observation) return
  try {
    const asyncDispose = observation[Symbol.asyncDispose]
    if (typeof asyncDispose === 'function') {
      Promise.resolve(asyncDispose.call(observation)).catch(() => {})
      return
    }
    const syncDispose = observation[Symbol.dispose]
    if (typeof syncDispose === 'function') syncDispose.call(observation)
    else if (typeof observation.dispose === 'function') observation.dispose()
  } catch {}
}

function cacheEntry(ctx, sessionId) {
  const { sessionCache } = stateOf(ctx)
  let entry = sessionCache.get(sessionId)
  if (entry === undefined) {
    entry = { at: 0, state: createFoldState() }
    sessionCache.set(sessionId, entry)
  }
  return entry
}

function pruneCache(ctx, now) {
  const { sessionCache, headerCache } = stateOf(ctx)
  for (const [sessionId, entry] of sessionCache) {
    if (entry.at !== 0 && now - entry.at > CACHE_IDLE_MS) sessionCache.delete(sessionId)
  }
  for (const [sessionId, entry] of headerCache) {
    if (now - entry.at > CACHE_IDLE_MS) headerCache.delete(sessionId)
  }
  if (sessionCache.size > MAX_CACHE_ENTRIES) {
    const oldest = [...sessionCache.entries()].sort((left, right) => left[1].at - right[1].at)
    for (const [sessionId] of oldest) {
      if (sessionCache.size <= MAX_CACHE_ENTRIES) break
      sessionCache.delete(sessionId)
    }
  }
  if (headerCache.size > MAX_CACHE_ENTRIES) {
    const oldest = [...headerCache.entries()].sort((left, right) => left[1].at - right[1].at)
    for (const [sessionId] of oldest) {
      if (headerCache.size <= MAX_CACHE_ENTRIES) break
      headerCache.delete(sessionId)
    }
  }
}

/** Drop every retained Session fact and header. Called when the plugin unloads. */
export function clearOceanCaches(ctx) {
  if (ctx === undefined) states = new WeakMap()
  else states.delete(ctx)
}

function liveSession(ctx, sessionId) {
  const sessions = readService(ctx, 'sessions')
  if (!sessions || typeof sessions.get !== 'function') return undefined
  try {
    return sessions.get(sessionId)
  } catch {
    return undefined
  }
}

/**
 * Read one Session's own-suffix facts.
 *
 * A live Session folds in place. A cold one goes through `sessionQuery.inspectSession`,
 * which reuses or restores a prepared Session without publishing it; the result is
 * reused for a short window with one shared pass. Failure returns null.
 */
export async function readSessionFacts(ctx, sessionId, signal) {
  const { inflight } = stateOf(ctx)
  const live = liveSession(ctx, sessionId)
  const entry = cacheEntry(ctx, sessionId)
  if (live !== undefined) {
    try {
      const state = foldSessionFacts(entry.state, live)
      entry.at = Date.now()
      return state
    } catch (error) {
      entry.at = Date.now()
      entry.state.readable = false
      logOnce(ctx, 'warn', `facts:${sessionId}`, `ocean-background: folding live session "${sessionId}" failed: ${describeError(error)}`)
      return null
    }
  }

  const now = Date.now()
  // A zero timestamp means this Session has never been read. A later timestamp
  // covers both a fresh success and a failed attempt backing off for the window.
  if (entry.at !== 0 && now - entry.at < COLD_READ_TTL_MS) {
    return entry.state.readable ? entry.state : null
  }

  const pending = inflight.get(sessionId)
  if (pending !== undefined) return pending

  const query = readService(ctx, 'sessionQuery')
  if (!query || typeof query.inspectSession !== 'function') {
    notifyOnce(ctx, 'warn', 'session-query', 'ocean-background: sessionQuery.inspectSession is unavailable; fleet tokens cannot be read')
    return null
  }

  const read = query.inspectSession(
    sessionId,
    (session) => foldSessionFacts(entry.state, session),
    signal,
  )
  const task = Promise.resolve(read).then((state) => {
    entry.at = Date.now()
    return state
  }).catch((error) => {
    entry.at = Date.now()
    entry.state.readable = false
    logOnce(ctx, 'warn', `facts:${sessionId}`, `ocean-background: reading session "${sessionId}" failed: ${describeError(error)}`)
    return null
  }).finally(() => {
    if (inflight.get(sessionId) === task) inflight.delete(sessionId)
  })
  inflight.set(sessionId, task)
  return task
}

/**
 * Read one Session's immutable header, live first, then from a cold head read
 * that computes no projections.
 */
async function readHeader(ctx, sessionId, signal) {
  const { headerCache } = stateOf(ctx)
  const live = liveSession(ctx, sessionId)
  if (live?.header) return live.header
  const cached = headerCache.get(sessionId)
  const now = Date.now()
  if (cached !== undefined && now - cached.at < HEADER_TTL_MS) return cached.header

  const query = readService(ctx, 'sessionQuery')
  if (!query || typeof query.observeSession !== 'function') return null
  const observation = await query.observeSession(sessionId, { signal, projectionMode: 'none' })
  try {
    const header = observation?.header ?? null
    if (header) headerCache.set(sessionId, { at: Date.now(), header })
    return header
  } finally {
    disposeObservation(observation)
  }
}

/**
 * Resolve the conversation root for a selection.
 *
 * Only `origin: 'subagent'` makes a Session a child; an ordinary fork may keep
 * `parentSession` and stays its own root. A broken chain is an error, never a
 * child reported as the root it failed to find.
 */
export async function resolveRootSessionId(ctx, sessionId, signal) {
  let current = sessionId
  const visited = new Set()
  for (let depth = 0; depth < MAX_ANCESTRY_DEPTH; depth += 1) {
    if (visited.has(current)) throw new Error(`session ancestry is cyclic at "${current}"`)
    visited.add(current)
    const header = await readHeader(ctx, current, signal)
    if (header === null) throw new Error(`session "${current}" has no readable header`)
    if (header.origin !== SUBAGENT_ORIGIN) return current
    const parent = header.parentSession
    if (typeof parent !== 'string' || parent === '') {
      throw new Error(`subagent session "${current}" has no parentSession`)
    }
    current = parent
  }
  throw new Error(`session ancestry exceeds ${String(MAX_ANCESTRY_DEPTH)} levels at "${current}"`)
}

export function isMeteringEligible(facts, hasForkBase = false) {
  if (!facts || facts.readable !== true) return false
  return facts.firstUserAt !== null || hasForkBase === true
}

export async function resolveMileageTarget(ctx, ledger, selected, signal) {
  if (typeof selected !== 'string' || selected.trim() === '') {
    return { rootId: null, eligible: false }
  }
  const rootId = await resolveRootSessionId(ctx, selected.trim(), signal)
  await ledger.ready()
  const facts = await readSessionFacts(ctx, rootId, signal)
  return { rootId, eligible: isMeteringEligible(facts, ledger.hasForkRoot(rootId)) }
}

function rowIdOf(row) {
  const id = row?.id ?? row?.sessionId ?? row?.childId
  return typeof id === 'string' && id !== '' ? id : null
}

function rowTitleOf(row) {
  const name = typeof row?.name === 'string' ? row.name : ''
  if (name !== '') return name
  const label = typeof row?.label === 'string' ? row.label : ''
  return label
}

function childRow(id, status, title) {
  const row = { id, running: status === STATUS.working, status }
  if (title !== '') row.title = title
  return row
}

/**
 * List every descendant through the durable subagent catalogs, which walk the
 * whole tree without loading an Agent. A throwing listing stays an error; it is
 * never replaced by direct children alone.
 */
export async function listFleetRows(ctx, rootId, signal) {
  const subagents = readService(ctx, 'subagents')
  if (!subagents || typeof subagents.listDescendants !== 'function') {
    notifyOnce(ctx, 'info', 'subagents', 'ocean-background: subagents service is not mounted; the fleet shows the root only')
    return []
  }
  const listed = await subagents.listDescendants(rootId, signal)
  if (!Array.isArray(listed)) throw new Error('subagent listing returned no rows')
  return listed
}

/** The response for a missing selection: no conversation, no boats, no guess. */
export function emptySnapshot() {
  return {
    ok: true,
    sessionId: null,
    tokensComplete: true,
    totalTokens: 0,
    flowTokens: 0,
    agentRunning: false,
    children: [],
  }
}

/**
 * Build one state payload for a selected main-view Session.
 *
 * Tokens are the four real usage buckets over the root and every distinct
 * descendant, each counted once because every fold starts at its own fork cut.
 * `flowTokens` repeats the cumulative total the renderer turns into a delta. An
 * unreadable branch makes the total unknowable: `tokensComplete: false` with null
 * counters, so a partial sum never reads as a lull and then a spike.
 */
export async function sessionSnapshot(ctx, sessionId, signal) {
  if (typeof sessionId !== 'string' || sessionId.trim() === '') return emptySnapshot()
  const selected = sessionId.trim()
  pruneCache(ctx, Date.now())
  const rootId = await resolveRootSessionId(ctx, selected, signal)
  const rootFacts = await readSessionFacts(ctx, rootId, signal)
  if (rootFacts === null) throw new Error(`session "${rootId}" could not be read`)

  const rows = await listFleetRows(ctx, rootId, signal)
  const seen = new Set([rootId])
  const children = []
  let total = sumBuckets(rootFacts.buckets)
  let complete = true
  for (const row of rows) {
    const id = rowIdOf(row)
    if (id === null || seen.has(id)) continue
    seen.add(id)
    const title = rowTitleOf(row)
    if (row?.kind === 'diagnostic' || row?.mode === 'external') {
      complete = false
      children.push(childRow(id, STATUS.unavailable, title))
      continue
    }
    const facts = await readSessionFacts(ctx, id, signal)
    if (facts === null) complete = false
    else total += sumBuckets(facts.buckets)
    children.push(childRow(id, statusOfFacts(facts, row?.mode), title))
  }

  const agentRunning = rootFacts.turnOpen === true
  if (!complete) {
    return {
      ok: true,
      sessionId: rootId,
      tokensComplete: false,
      totalTokens: null,
      flowTokens: null,
      agentRunning,
      children,
    }
  }
  const tokens = Math.max(0, total)
  return {
    ok: true,
    sessionId: rootId,
    tokensComplete: true,
    totalTokens: tokens,
    flowTokens: tokens,
    agentRunning,
    children,
  }
}

export function debugPayload(ctx, selected) {
  const { sessionCache, headerCache } = stateOf(ctx)
  return {
    selected: typeof selected === 'string' && selected !== '' ? selected : null,
    services: {
      sessions: Boolean(readService(ctx, 'sessions')),
      sessionQuery: Boolean(readService(ctx, 'sessionQuery')),
      subagents: Boolean(readService(ctx, 'subagents')),
      agents: Boolean(readService(ctx, 'agents')),
    },
    cache: { sessions: sessionCache.size, headers: headerCache.size },
  }
}

