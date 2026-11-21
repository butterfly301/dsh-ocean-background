// Formation and turn-state rules for the crew boats.
//
// Deliberately free of three.js: these are the rules that are easy to get wrong
// and are exercised directly by the unit tests. boats.js is the thin adapter
// that moves meshes according to what this module decides.
//
// Berths are laid out in the camera's local frame: x is along the ship's course
// relative to the vessel root, z is across it. The visible span is supplied by
// the caller, so a few boats always sit near the middle of the picture instead
// of being scattered by a hash into slots that are already off screen.

export const CHILD_STATUS = Object.freeze([
  'working',
  'waiting',
  'completed',
  'failed',
  'cancelled',
  'unavailable',
]);

const KNOWN = new Set(CHILD_STATUS);
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

// The camera looks from z = +cameraDistance toward the ship, so +z is the near
// side of the hull and -z the far side. Columns step wider than the dinghy is
// long, lanes wider than it is broad, so two berths can never overlap a hull.
export const FORMATION = Object.freeze({
  shipLength: 10,
  boatLength: 3.4,
  boatHalfBeam: 1.1,
  columnGap: 5.0,
  sideNear: 5.4,
  sideStep: 3.6,
  edgeInset: 2.4,
  // Scatter: enough to break the grid, never enough to let hulls overlap. A
  // column gap of 5.0 minus twice 0.6 still clears the 3.4 long hull, and a
  // ring step of 3.6 minus twice 0.55 still clears the 2.2 wide one.
  jitterX: 0.6,
  jitterZ: 0.55,
  jitterYaw: 0.18,
  jitterScale: 0.12,
  driftX: 0.22,
  driftZ: 0.16,
});

// A fallback span for a default lens and a camera lead of five units. It is
// deliberately narrower than the true 16:9 frustum so it also survives the
// host's +/- camera offset. Real callers pass a span derived from the live
// camera through the getView callback.
export const DEFAULT_VIEW = Object.freeze({ minX: -8, maxX: 18 });

const COLUMN_CACHE_LIMIT = 4;
let columnCache = [];

function normalizeView(view) {
  const rawMin = Number.isFinite(view?.minX) ? view.minX : DEFAULT_VIEW.minX;
  const rawMax = Number.isFinite(view?.maxX) ? view.maxX : DEFAULT_VIEW.maxX;
  const minX = Math.min(rawMin, rawMax);
  const maxX = Math.max(rawMin, rawMax);
  return { minX, maxX };
}

function computeColumns(view) {
  const halfSpan = Math.max(0, (view.maxX - view.minX) / 2);
  // A span narrower than the inset still yields one safe central column.
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
  // Fill the most central column first so the first few boats are the ones the
  // camera is actually looking at.
  const center = (lo + hi) / 2;
  return xs
    .map((x, index) => ({ x, index, distance: Math.abs(x - center) }))
    .sort((left, right) => left.distance - right.distance || left.index - right.index)
    .map((entry) => entry.x);
}

function columnsForView(view) {
  const normalized = normalizeView(view);
  for (const entry of columnCache) {
    if (entry.view.minX === normalized.minX && entry.view.maxX === normalized.maxX) return entry.columns;
  }
  const columns = computeColumns(normalized);
  columnCache = [{ view: normalized, columns }, ...columnCache].slice(0, COLUMN_CACHE_LIMIT);
  return columns;
}

function hash32(value) {
  let hash = 2166136261 ^ (value | 0);
  hash = Math.imul(hash ^ (hash >>> 15), 2246822507);
  hash = Math.imul(hash ^ (hash >>> 13), 3266489909);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

// Deterministic per-slot randomness: a boat keeps its offset for its whole
// life, so the scatter never flickers, and two fleets do not share one pose.
function unitFor(slot, salt) {
  return (hash32(Math.imul(slot + 1, 2654435761) ^ salt) >>> 8) / 16777216;
}

function centered(slot, salt, amount) {
  return (unitFor(slot, salt) * 2 - 1) * amount;
}

// Pure berth for a slot in the fleet-local frame. Slot 0 and 1 are the near and
// far side of the central column; slots then fill the remaining columns of that
// ring and only start a new, deeper ring once the visible band is used up.
// Every berth carries its own small offset, heading and scale so the fleet
// reads as boats moored in loose formation rather than a marching grid.
export function berthForSlot(slot, view = DEFAULT_VIEW) {
  const columns = columnsForView(view);
  const normalized = Math.max(0, Math.floor(Number.isFinite(slot) ? slot : 0));
  const perRing = Math.max(2, columns.length * 2);
  const ring = Math.floor(normalized / perRing);
  const within = normalized % perRing;
  const column = columns[Math.floor(within / 2) % columns.length];
  const side = within % 2 === 0 ? -1 : 1;
  const x = Math.min(view.maxX, Math.max(view.minX, column + centered(normalized, 0x1f123bb5, FORMATION.jitterX)));
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

function hashIdentity(identity) {
  const text = String(identity);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

// The stateless helper has no roster to count, so it previews within the first
// visible band. Allocation of a real fleet goes through createBerthAllocator.
const PREVIEW_SLOTS = 8;

// Converts a live camera into the horizontal span the formation may use, in the
// same fleet-local frame as berth positions. cameraX is in that frame too: for
// the ocean plugin that is camera.position.x - vesselRoot.position.x. fovDeg is
// three.js's vertical fov in degrees; aspect is the drawing buffer aspect.
export function viewForCamera({
  cameraX,
  shipX = 0,
  cameraDistance = 44,
  fovDeg = 34,
  aspect = 16 / 9,
  margin = 0.86,
} = {}) {
  const lead = Number.isFinite(cameraX) ? cameraX : 5;
  // Solve the span at the nearest lane, where the frustum is tightest.
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
  let view = DEFAULT_VIEW;

  function setView(next) {
    view = normalizeView(next);
    return view;
  }

  function allocateSlot() {
    let slot = 0;
    while (occupied.has(slot)) slot += 1;
    return slot;
  }

  // Reserve returns the berth in world-local coordinates: shipX offsets the
  // formation, while the view decides which columns are usable.
  function reserve(identity, shipX = 0, nextView) {
    if (nextView !== undefined) setView(nextView);
    const id = String(identity);
    let slot = assignments.get(id);
    if (slot === undefined) {
      slot = allocateSlot();
      assignments.set(id, slot);
      occupied.add(slot);
    }
    const local = berthForSlot(slot, view);
    return { ...local, x: shipX + local.x };
  }

  function remove(identity) {
    const id = String(identity);
    const slot = assignments.get(id);
    if (slot === undefined) return;
    assignments.delete(id);
    occupied.delete(slot);
  }

  function clear() {
    assignments.clear();
    occupied.clear();
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

// String identities use a deterministic preview berth. Numeric input remains
// accepted as a compatibility seam for callers that already hold a roster index.
export function berthPosition(identity, shipX = 0, view = DEFAULT_VIEW) {
  const slot = typeof identity === 'number'
    ? Math.max(0, Math.floor(identity))
    : hashIdentity(identity) % PREVIEW_SLOTS;
  const local = berthForSlot(slot, view);
  return { ...local, x: shipX + local.x };
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
