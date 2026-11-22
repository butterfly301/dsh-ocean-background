import { PROTOCOL_VERSION } from '../runtime/protocol.js';
import { STATUS, statusOfFacts, sumBuckets } from './session-facts.js';
import {
  isMeteringEligible,
  listFleetRows,
  readSessionFacts,
  resolveRootSessionId,
} from './session-state.js';

function rowIdOf(row) {
  const id = row?.id ?? row?.sessionId ?? row?.childId;
  return typeof id === 'string' && id !== '' ? id : null;
}

function rowTitleOf(row) {
  const name = typeof row?.name === 'string' ? row.name : '';
  if (name !== '') return name;
  const label = typeof row?.label === 'string' ? row.label : '';
  return label;
}

function childRow(id, status, title) {
  const row = { id, running: status === STATUS.working, status };
  if (title !== '') row.title = title;
  return row;
}

function hashIds(ids) {
  let hash = 2166136261;
  const text = ids.join('|');
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = new Array(Math.min(limit, items.length)).fill(null).map(async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

export function emptySnapshot(ledger) {
  return {
    v: PROTOCOL_VERSION,
    ok: true,
    at: Date.now(),
    sessionId: null,
    counter: null,
    counterEpoch: 'none',
    totalTokens: 0,
    tokensComplete: true,
    agentRunning: false,
    fleet: [],
    mileage: { ok: true, ...ledger.view(null, false) },
  };
}

export async function readSnapshot(ctx, ledger, selected, signal) {
  if (typeof selected !== 'string' || selected.trim() === '') return emptySnapshot(ledger);
  const rootId = await resolveRootSessionId(ctx, selected.trim(), signal);
  const rootFacts = await readSessionFacts(ctx, rootId, signal);
  if (rootFacts === null) throw new Error(`session "${rootId}" could not be read`);

  const rows = await listFleetRows(ctx, rootId, signal);
  const seen = new Set([rootId]);
  const entries = [];
  for (const row of rows) {
    const id = rowIdOf(row);
    if (id === null || seen.has(id)) continue;
    seen.add(id);
    entries.push({ row, id, title: rowTitleOf(row) });
  }

  let complete = true;
  let childTotal = 0;
  const children = await mapLimit(entries, 4, async ({ row, id, title }) => {
    if (row?.kind === 'diagnostic' || row?.mode === 'external') {
      complete = false;
      return childRow(id, STATUS.unavailable, title);
    }
    const facts = await readSessionFacts(ctx, id, signal);
    if (facts === null) {
      complete = false;
      return childRow(id, STATUS.unavailable, title);
    }
    childTotal += sumBuckets(facts.buckets);
    return childRow(id, statusOfFacts(facts, row?.mode), title);
  });

  const rootTotal = sumBuckets(rootFacts.buckets);
  const total = Math.max(0, rootTotal + childTotal);
  const ids = [rootId, ...entries.map((entry) => entry.id)].sort();
  const eligible = isMeteringEligible(rootFacts, ledger.hasForkRoot(rootId));

  return {
    v: PROTOCOL_VERSION,
    ok: true,
    at: Date.now(),
    sessionId: rootId,
    counter: complete ? total : null,
    counterEpoch: `${hashIds(ids)}:${complete ? 'complete' : 'partial'}`,
    totalTokens: complete ? total : null,
    tokensComplete: complete,
    agentRunning: rootFacts.turnOpen === true,
    fleet: children,
    mileage: { ok: true, ...ledger.view(rootId, eligible) },
  };
}

export function snapshotErrorPayload(error) {
  return {
    v: PROTOCOL_VERSION,
    ok: false,
    sessionId: null,
    counter: null,
    counterEpoch: 'error',
    totalTokens: null,
    tokensComplete: false,
    agentRunning: false,
    fleet: [],
    mileage: {
      ok: false,
      sessionId: null,
      eligible: false,
      mode: 'today',
      day: null,
      todayMeters: 0,
      fleetMeters: 0,
    },
    error: error instanceof Error ? error.message : String(error),
  };
}


export function createSnapshotReader({ ctx, ledger, ttlMs = 400, timeoutMs = 4000, limit = 32 }) {
  const cache = new Map();

  function prune(now) {
    for (const [key, entry] of cache) {
      if (now - entry.at > ttlMs) cache.delete(key);
    }
    while (cache.size > limit) {
      const oldest = cache.keys().next().value;
      cache.delete(oldest);
    }
  }

  return function read(selected) {
    const key = typeof selected === 'string' ? selected : '';
    const now = Date.now();
    const hit = cache.get(key);
    if (hit !== undefined && now - hit.at < ttlMs) return hit.promise;

    const timeout = AbortSignal.timeout(timeoutMs);
    const promise = readSnapshot(ctx, ledger, selected, timeout).catch((error) => {
      cache.delete(key);
      throw error;
    });
    cache.set(key, { at: now, promise });
    prune(now);
    return promise;
  };
}
