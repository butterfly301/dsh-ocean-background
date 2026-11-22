// Pure berth layout for the fleet. No three.js, no DOM: given a viewport span
// and a slot number it returns where a dinghy belongs. The runtime that owns
// the meshes lives in world/fleet.js.

const CHILD_STATUS = Object.freeze([
  'working',
  'waiting',
  'completed',
  'failed',
  'cancelled',
  'unavailable',
]);

const KNOWN = new Set(CHILD_STATUS);
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

const FORMATION = Object.freeze({
  shipLength: 10,
  boatLength: 3.4,
  boatHalfBeam: 1.1,
  columnGap: 5.0,
  sideNear: 5.4,
  sideStep: 3.6,
  edgeInset: 2.4,
  jitterX: 0.6,
  jitterZ: 0.55,
  jitterYaw: 0.18,
  jitterScale: 0.12,
  driftX: 0.22,
  driftZ: 0.16,
});

const DEFAULT_VIEW = Object.freeze({ minX: -8, maxX: 18 });

const COLUMN_CACHE_LIMIT = 4;
const BERTH_CACHE_LIMIT = 256;
let columnCache = [];

function normalizeView(view) {
  const rawMin = Number.isFinite(view?.minX) ? view.minX : DEFAULT_VIEW.minX;
  const rawMax = Number.isFinite(view?.maxX) ? view.maxX : DEFAULT_VIEW.maxX;
  return { minX: Math.min(rawMin, rawMax), maxX: Math.max(rawMin, rawMax) };
}

function viewKeyOf(view) {
  return `${view.minX}:${view.maxX}`;
}

function computeColumns(view) {
  const halfSpan = Math.max(0, (view.maxX - view.minX) / 2);
  const inset = Math.min(FORMATION.edgeInset, Math.max(0, halfSpan - 0.1));
  const lo = view.minX + inset;
  const hi = view.maxX - inset;
  const span = Math.max(0, hi - lo);
  const count = Math.max(1, Math.floor(span / FORMATION.columnGap) + 1);
  const xs = [];
  if (count === 1) {
    xs.push((lo + hi) / 2);
  } else {
    for (let index = 0; index < count; index += 1) {
      xs.push(lo + (span * index) / (count - 1));
    }
  }
  const center = (lo + hi) / 2;
  return xs
    .map((x, index) => ({ x, index, distance: Math.abs(x - center) }))
    .sort((left, right) => left.distance - right.distance || left.index - right.index)
    .map((entry) => entry.x);
}

function columnsForView(view) {
  const normalized = normalizeView(view);
  const key = viewKeyOf(normalized);
  for (const entry of columnCache) {
    if (entry.key === key) return entry.columns;
  }
  const columns = computeColumns(normalized);
  columnCache = [{ key, columns }, ...columnCache].slice(0, COLUMN_CACHE_LIMIT);
  return columns;
}

function hash32(value) {
  let hash = 2166136261 ^ (value | 0);
  hash = Math.imul(hash ^ (hash >>> 15), 2246822507);
  hash = Math.imul(hash ^ (hash >>> 13), 3266489909);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

function unitFor(slot, salt) {
  return (hash32(Math.imul(slot + 1, 2654435761) ^ salt) >>> 8) / 16777216;
}

function centered(slot, salt, amount) {
  return (unitFor(slot, salt) * 2 - 1) * amount;
}

function berthForSlot(slot, view = DEFAULT_VIEW) {
  const normalizedView = normalizeView(view);
  const columns = columnsForView(normalizedView);
  const normalized = Math.max(0, Math.floor(Number.isFinite(slot) ? slot : 0));
  const perRing = Math.max(2, columns.length * 2);
  const ring = Math.floor(normalized / perRing);
  const within = normalized % perRing;
  const column = columns[Math.floor(within / 2) % columns.length];
  const side = within % 2 === 0 ? -1 : 1;
  const x = Math.min(
    normalizedView.maxX,
    Math.max(normalizedView.minX, column + centered(normalized, 0x1f123bb5, FORMATION.jitterX)),
  );
  const z = side * (FORMATION.sideNear + ring * FORMATION.sideStep)
    + centered(normalized, 0x3b6c1a5d, FORMATION.jitterZ);
  return {
    x,
    y: 0,
    z,
    yaw: centered(normalized, 0x5d2c8e91, FORMATION.jitterYaw),
    scale: 1 + centered(normalized, 0x7a4f16c3, FORMATION.jitterScale),
  };
}

export function viewForCamera({
  cameraX,
  shipX = 0,
  cameraDistance = 44,
  fovDeg = 34,
  aspect = 16 / 9,
  margin = 0.86,
} = {}) {
  const lead = Number.isFinite(cameraX) ? cameraX : 5;
  const nearestDepth = Math.max(1, (Number.isFinite(cameraDistance) ? cameraDistance : 44) - FORMATION.sideNear);
  const halfVertical = Math.tan(((Number.isFinite(fovDeg) ? fovDeg : 34) * Math.PI) / 360);
  const safeAspect = Math.max(0.2, Number.isFinite(aspect) ? aspect : 16 / 9);
  const safeMargin = Math.min(1, Math.max(0.2, Number.isFinite(margin) ? margin : 0.86));
  const halfSpan = nearestDepth * halfVertical * safeAspect * safeMargin;
  const center = lead - (Number.isFinite(shipX) ? shipX : 0);
  return { minX: center - halfSpan, maxX: center + halfSpan };
}

export function createBerthAllocator() {
  const assignments = new Map();
  const occupied = new Set();
  const berthCache = new Map();
  let view = DEFAULT_VIEW;
  let viewKey = viewKeyOf(view);

  function setView(next) {
    view = normalizeView(next);
    viewKey = viewKeyOf(view);
    return view;
  }

  function allocateSlot() {
    let slot = 0;
    while (occupied.has(slot)) slot += 1;
    return slot;
  }

  function localFor(slot) {
    const hit = berthCache.get(slot);
    if (hit !== undefined && hit.key === viewKey) return hit.berth;
    const berth = berthForSlot(slot, view);
    if (berthCache.size >= BERTH_CACHE_LIMIT) {
      for (const [cachedSlot, entry] of berthCache) {
        if (entry.key !== viewKey) berthCache.delete(cachedSlot);
      }
      if (berthCache.size >= BERTH_CACHE_LIMIT) berthCache.clear();
    }
    berthCache.set(slot, { key: viewKey, berth });
    return berth;
  }

  function reserve(identity, shipX = 0, nextView) {
    if (nextView !== undefined) setView(nextView);
    const id = String(identity);
    let slot = assignments.get(id);
    if (slot === undefined) {
      slot = allocateSlot();
      assignments.set(id, slot);
      occupied.add(slot);
    }
    const local = localFor(slot);
    return {
      x: shipX + local.x,
      y: local.y,
      z: local.z,
      yaw: local.yaw,
      scale: local.scale,
      slot,
    };
  }

  function remove(identity) {
    const id = String(identity);
    const slot = assignments.get(id);
    if (slot === undefined) return;
    assignments.delete(id);
    occupied.delete(slot);
    berthCache.delete(slot);
  }

  function clear() {
    assignments.clear();
    occupied.clear();
    berthCache.clear();
  }

  return {
    reserve,
    remove,
    clear,
    setView,
    get size() { return assignments.size; },
    get view() { return view; },
  };
}

export function normalizeStatus(entry) {
  if (typeof entry?.status === 'string' && KNOWN.has(entry.status)) return entry.status;
  if (entry && typeof entry.running === 'boolean') return entry.running ? 'working' : 'completed';
  return 'unavailable';
}

export function isTerminal(status) {
  return TERMINAL.has(status);
}

export function rowsOars(status) {
  return status === 'working';
}

export function phaseFor(status, phase) {
  if (isTerminal(status)) return 'leaving';
  if (phase === 'leaving') return 'entering';
  return phase === 'berthed' || phase === 'entering' ? phase : 'entering';
}
