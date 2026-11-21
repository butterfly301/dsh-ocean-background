// Pure folding of durable session events into token, turn and metering facts.

/** The one status vocabulary the renderer knows how to turn into a hull state. */
export const STATUS = Object.freeze({
  working: 'working',
  waiting: 'waiting',
  completed: 'completed',
  failed: 'failed',
  cancelled: 'cancelled',
  unavailable: 'unavailable',
})

const BUCKET_KEYS = Object.freeze([
  'uncachedInputTokens',
  'outputTokens',
  'cacheReadTokens',
  'cacheWriteTokens',
])

const ZERO_BUCKETS = Object.freeze({
  uncachedInputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
})

export function countOf(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0
}

function sameBuckets(left, right) {
  return BUCKET_KEYS.every((key) => left[key] === right[key])
}

export function sumBuckets(buckets) {
  let total = 0
  for (const key of BUCKET_KEYS) {
    const value = buckets?.[key]
    if (typeof value === 'number' && Number.isFinite(value)) total += value
  }
  return total
}

/** The last `usage` chunk of one compact Assistant stream, read as plain JSON. */
function lastStreamUsage(stream) {
  if (!Array.isArray(stream)) return undefined
  for (let index = stream.length - 1; index >= 0; index -= 1) {
    const record = stream[index]
    if (record?.type !== 'chunk') continue
    const chunk = record.chunk
    if (chunk?.type === 'usage') return chunk.usage
  }
  return undefined
}

/**
 * The usage sample one durable settlement reports, mirroring the tokenUsage fold:
 * an explicit `data.usage` wins, otherwise the stream's last `usage` chunk.
 */
export function usageOfEvent(event) {
  const data = event?.data
  if (!data || typeof data !== 'object') return undefined
  if (event.type === 'assistant/message' && data.usage !== undefined) return data.usage
  if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') return undefined
  return lastStreamUsage(data.stream)
}

/**
 * Map provider usage onto the four buckets the tokenUsage projection publishes.
 * Raw `TokenUsage.inputTokens` is the uncached prompt count.
 */
export function bucketsOf(usage) {
  const pick = (key) => {
    const value = usage?.[key]
    return typeof value === 'number' && Number.isFinite(value) ? value : 0
  }
  return {
    uncachedInputTokens: pick('inputTokens'),
    outputTokens: pick('outputTokens'),
    cacheReadTokens: pick('cacheReadTokens'),
    cacheWriteTokens: pick('cacheWriteTokens'),
  }
}

/** One fold state for a Session that has not been read yet. */
export function createFoldState() {
  return {
    readable: false,
    inheritedEventCount: 0,
    foldedThrough: -1,
    buckets: { ...ZERO_BUCKETS },
    lastUsage: null,
    turnOpen: false,
    lastTurnEnd: null,
    firstUserAt: null,
  }
}

function resetFoldState(state, inheritedEventCount) {
  state.inheritedEventCount = inheritedEventCount
  state.foldedThrough = inheritedEventCount - 1
  state.buckets = { ...ZERO_BUCKETS }
  state.lastUsage = null
  state.turnOpen = false
  state.lastTurnEnd = null
  state.firstUserAt = null
}

/** Read one event without copying the log; the cursor keeps this at O(new events). */
function eventAtOf(session, seq) {
  if (typeof session?.eventAt === 'function') return session.eventAt(seq)
  if (typeof session?.snapshotEvents === 'function') return session.snapshotEvents(seq, seq + 1)[0]
  return undefined
}

/** Fold one committed event, following the tokenUsage projection's replace and retry rules. */
function applyEventFacts(state, event) {
  const type = event?.type
  if (type === 'turn/start') {
    state.turnOpen = true
    return
  }
  if (type === 'turn/end') {
    state.turnOpen = false
    const kind = event.data?.reason?.kind
    state.lastTurnEnd = typeof kind === 'string' ? kind : null
    return
  }
  if (type === 'llm/retry-started') {
    const data = event.data
    if (state.lastUsage !== null
      && state.lastUsage.turn === data?.turn
      && state.lastUsage.step === data?.step) state.lastUsage = null
    return
  }
  if (type === 'user/message') {
    const kind = event.data?.source?.kind
    if (state.firstUserAt === null
      && event.surfaceOp === 'append'
      && event.data?.role === 'user'
      && (kind === 'user' || kind === 'user-rpc')) {
      state.firstUserAt = typeof event.time === 'number' && Number.isFinite(event.time) ? event.time : 0
    }
    return
  }
  if (type !== 'assistant/message' && type !== 'assistant/attempt') return
  const usage = usageOfEvent(event)
  if (usage === undefined || usage === null) return
  const data = event.data
  const buckets = bucketsOf(usage)
  const previous = state.lastUsage !== null
    && state.lastUsage.turn === data?.turn
    && state.lastUsage.step === data?.step
    ? state.lastUsage.buckets
    : undefined
  if (previous !== undefined && sameBuckets(previous, buckets)) return
  for (const key of BUCKET_KEYS) state.buckets[key] += buckets[key] - (previous?.[key] ?? 0)
  state.lastUsage = { turn: data?.turn, step: data?.step, buckets }
}

/**
 * Advance one Session's facts through its own events, starting at the fork cut.
 *
 * The tokenUsage projection folds the whole log, so a fork-seeded child's totals
 * include the inherited prefix; this fold skips it and reads only events past the
 * cursor. A gap throws, because a partial fold is not a complete read.
 */
export function foldSessionFacts(state, session) {
  const inherited = countOf(session?.inheritedEventCount)
  const end = countOf(session?.seq)
  if (state.inheritedEventCount !== inherited
    || state.foldedThrough >= end
    || state.foldedThrough < inherited - 1) {
    resetFoldState(state, inherited)
  }
  for (let seq = state.foldedThrough + 1; seq < end; seq += 1) {
    const event = eventAtOf(session, seq)
    if (event === undefined || event === null) {
      throw new Error(`session "${session?.id ?? ''}" has no event at seq ${String(seq)}`)
    }
    applyEventFacts(state, event)
    state.foldedThrough = seq
  }
  state.readable = true
  return state
}

/**
 * Turn one Session's facts into the shared status word.
 *
 * A closed Turn is the only terminal evidence accepted here: a normal close
 * completes a one-shot child and leaves a continuable child waiting, an abort or
 * interruption cancels, an error or token ceiling fails. `blocked`, an unclosed
 * turn, and an unread Session stay `waiting`; inactive proves nothing.
 */
export function statusOfFacts(facts, mode) {
  if (!facts || facts.readable !== true) return STATUS.unavailable
  if (facts.turnOpen === true) return STATUS.working
  const kind = facts.lastTurnEnd
  if (kind === 'completed') return mode === 'one-shot' ? STATUS.completed : STATUS.waiting
  if (kind === 'aborted' || kind === 'interrupted') return STATUS.cancelled
  if (kind === 'error' || kind === 'max-tokens') return STATUS.failed
  return STATUS.waiting
}

