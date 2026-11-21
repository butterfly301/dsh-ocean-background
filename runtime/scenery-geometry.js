// Pure surface data for the scenery archetypes.
//
// No three.js import: the shape and the archetype distribution can be exercised
// by node tests, while the renderer only turns the arrays into buffer geometry.
// Every builder is deterministic for a given seed, so a recycled island can pick
// a fresh silhouette without rebuilding the world.

const TAU = Math.PI * 2;

/** Island silhouettes, in weighted-pick order. */
export const ISLAND_ARCHETYPES = [
  'sandbar-crescent',
  'sandbar-shoal',
  'green-island',
  'rocky-island',
];

/** Low sandbars together hold the majority so most passes stay flat. */
export const ISLAND_ARCHETYPE_WEIGHTS = {
  'sandbar-crescent': 0.34,
  'sandbar-shoal': 0.34,
  'green-island': 0.18,
  'rocky-island': 0.14,
};

/** Reef silhouettes: mostly squat stones, rarely a sea stack. */
export const REEF_ARCHETYPES = ['squat', 'sea-stack'];

export const REEF_ARCHETYPE_WEIGHTS = {
  squat: 0.86,
  'sea-stack': 0.14,
};

// Muted sea-and-sail palette: sand and rock sit close to the haze, the greens
// stay grey rather than tropical, so the scenery never out-shouts the ship.
const SAND_WET_DARK = '#7f7f74';
const SAND_WET = '#9c998a';
const SAND = '#b4af9e';
const SAND_LIGHT = '#c4bfad';
const SAND_PALE = '#d0cab8';
const SAND_TOP = '#d8d2c0';
const GRASS_EDGE = '#8d9375';
const GREEN_DARK = '#5f6f59';
const GREEN = '#6f7f66';
const GREEN_LIGHT = '#87937a';
const GREEN_TOP = '#94a083';
const ROCK_DARK = '#697473';
const ROCK = '#77817f';
const ROCK_LIGHT = '#89928e';
const ROCK_TOP = '#98a09a';
const MOSS = '#7b866c';
const REEF_WET = '#65716f';
const REEF_BODY = '#75807d';
const REEF_TOP = '#89938c';

function srgbToLinear(channel) {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function linearColor(hex) {
  const value = Number.parseInt(hex.slice(1), 16);
  return [
    srgbToLinear((value >> 16) & 0xff),
    srgbToLinear((value >> 8) & 0xff),
    srgbToLinear(value & 0xff),
  ];
}

const COLORS = new Map(
  [
    SAND_WET_DARK, SAND_WET, SAND, SAND_LIGHT, SAND_PALE, SAND_TOP,
    GRASS_EDGE, GREEN_DARK, GREEN, GREEN_LIGHT, GREEN_TOP,
    ROCK_DARK, ROCK, ROCK_LIGHT, ROCK_TOP, MOSS,
    REEF_WET, REEF_BODY, REEF_TOP,
  ].map(hex => [hex, linearColor(hex)]),
);

function colorOf(hex) {
  return COLORS.get(hex);
}

const ISLAND_PROFILES = {
  // A long, curved bank that hooks away from its own crest.
  'sandbar-crescent': {
    segments: 30,
    rings: [
      { rx: 10.6, rz: 5.4, y: -0.72, color: SAND_WET_DARK },
      { rx: 9.9, rz: 5.0, y: 0.02, color: SAND_WET },
      { rx: 8.8, rz: 4.4, y: 0.24, color: SAND },
      { rx: 7.2, rz: 3.5, y: 0.42, color: SAND_LIGHT },
      { rx: 5.4, rz: 2.6, y: 0.54, color: SAND_PALE },
      { rx: 3.4, rz: 1.6, y: 0.6, color: SAND_TOP },
    ],
    wobble: { a: 0.08, b: 0.05, c: 0.03, y: 0.035, lobe: 0.2, phase: 0.55 },
    bend: { x: -2.4, z: 0.9 },
    centerY: 0.62,
    vegetation: 1,
    palmScale: 0.62,
  },
  // A broad, very low shoal with almost no centre mound.
  'sandbar-shoal': {
    segments: 28,
    rings: [
      { rx: 13.2, rz: 6.6, y: -0.7, color: SAND_WET_DARK },
      { rx: 12.4, rz: 6.1, y: 0.0, color: SAND_WET },
      { rx: 10.8, rz: 5.2, y: 0.16, color: SAND },
      { rx: 8.6, rz: 4.0, y: 0.3, color: SAND_LIGHT },
      { rx: 6.0, rz: 2.7, y: 0.42, color: SAND_PALE },
      { rx: 3.2, rz: 1.5, y: 0.5, color: SAND_TOP },
    ],
    wobble: { a: 0.06, b: 0.04, c: 0.025, y: 0.03, lobe: 0.05, phase: 2.1 },
    bend: { x: 0.9, z: -0.4 },
    centerY: 0.52,
    vegetation: 1,
    palmScale: 0.6,
  },
  // A rounded, vegetated hill: green rings over a sand shore.
  'green-island': {
    segments: 32,
    rings: [
      { rx: 8.8, rz: 7.0, y: -0.9, color: SAND_WET_DARK },
      { rx: 8.1, rz: 6.4, y: 0.05, color: SAND_WET },
      { rx: 7.2, rz: 5.6, y: 0.75, color: GRASS_EDGE },
      { rx: 6.0, rz: 4.5, y: 1.55, color: GREEN_DARK },
      { rx: 4.8, rz: 3.4, y: 2.3, color: GREEN },
      { rx: 3.4, rz: 2.3, y: 3.0, color: GREEN_LIGHT },
      { rx: 1.9, rz: 1.2, y: 3.5, color: GREEN_TOP },
    ],
    wobble: { a: 0.09, b: 0.05, c: 0.03, y: 0.06, lobe: 0.05, phase: 1.2 },
    bend: { x: 0.5, z: 0.3 },
    centerY: 3.7,
    vegetation: 4,
    palmScale: 0.64,
  },
  // Stepped, grey cliffs: a different surface from the soft green island.
  'rocky-island': {
    segments: 26,
    rings: [
      { rx: 8.2, rz: 6.4, y: -1.1, color: ROCK_DARK },
      { rx: 7.6, rz: 5.9, y: 0.1, color: ROCK },
      { rx: 6.9, rz: 5.2, y: 0.85, color: ROCK_LIGHT },
      { rx: 6.0, rz: 4.4, y: 1.65, color: ROCK },
      { rx: 4.9, rz: 3.4, y: 2.35, color: ROCK_LIGHT },
      { rx: 3.6, rz: 2.4, y: 2.95, color: ROCK_TOP },
      { rx: 2.2, rz: 1.4, y: 3.3, color: MOSS },
    ],
    wobble: { a: 0.12, b: 0.07, c: 0.04, y: 0.09, lobe: 0.1, phase: 2.7 },
    bend: { x: -0.7, z: 0.4 },
    centerY: 3.45,
    vegetation: 1,
    palmScale: 0.55,
  },
};

const REEF_PROFILES = {
  // A flattened, partly submerged stone.
  squat: {
    segments: 14,
    rings: [
      { rx: 3.2, rz: 2.4, y: -0.6, color: REEF_WET },
      { rx: 3.0, rz: 2.25, y: 0.05, color: REEF_BODY },
      { rx: 2.5, rz: 1.8, y: 0.55, color: REEF_BODY },
      { rx: 1.7, rz: 1.15, y: 0.95, color: REEF_TOP },
      { rx: 0.9, rz: 0.6, y: 1.15, color: REEF_TOP },
    ],
    wobble: { a: 0.14, b: 0.08, c: 0.05, y: 0.05, lobe: 0.08, phase: 0.8 },
    bend: { x: 0.3, z: -0.2 },
    centerY: 1.25,
  },
  // A slender, slightly leaning column that stands well above the squat stones.
  'sea-stack': {
    segments: 12,
    rings: [
      { rx: 1.7, rz: 1.35, y: -0.8, color: REEF_WET },
      { rx: 1.6, rz: 1.25, y: 0.25, color: REEF_BODY },
      { rx: 1.45, rz: 1.1, y: 1.35, color: REEF_BODY },
      { rx: 1.3, rz: 0.95, y: 2.5, color: REEF_TOP },
      { rx: 1.1, rz: 0.8, y: 3.55, color: REEF_BODY },
      { rx: 0.85, rz: 0.6, y: 4.35, color: REEF_TOP },
      { rx: 0.55, rz: 0.4, y: 4.8, color: REEF_TOP },
      { rx: 0.3, rz: 0.2, y: 5.0, color: REEF_TOP },
    ],
    wobble: { a: 0.09, b: 0.05, c: 0.03, y: 0.08, lobe: 0.05, phase: 2.3 },
    bend: { x: 0.55, z: -0.25 },
    centerY: 5.05,
  },
};

function pickWeighted(ids, weights, random, excluded) {
  const excludedSet = excluded instanceof Set ? excluded : new Set(excluded ?? []);
  let candidates = ids.filter(id => !excludedSet.has(id));
  if (candidates.length === 0) candidates = ids.slice();

  const total = candidates.reduce((sum, id) => sum + (weights[id] ?? 0), 0);
  if (total <= 0) return candidates[0];

  const sampled = random();
  const roll = Number.isFinite(sampled) ? Math.min(Math.max(sampled, 0), 1) : 0;
  let target = roll * total;
  for (const id of candidates) {
    target -= weights[id] ?? 0;
    if (target < 0) return id;
  }
  return candidates[candidates.length - 1];
}

/**
 * Pick an island silhouette, avoiding the ones already on screen when a
 * different one is still available.
 * @param random - source of random numbers, injectable for tests.
 * @param excluded - archetypes currently visible.
 * @returns one id from ISLAND_ARCHETYPES.
 */
export function chooseIslandArchetype(random = Math.random, excluded = []) {
  return pickWeighted(ISLAND_ARCHETYPES, ISLAND_ARCHETYPE_WEIGHTS, random, excluded);
}

/**
 * Pick a reef silhouette. Sea stacks stay occasional.
 * @param random - source of random numbers, injectable for tests.
 * @param excluded - archetypes to avoid, if any.
 * @returns one id from REEF_ARCHETYPES.
 */
export function chooseReefArchetype(random = Math.random, excluded = []) {
  return pickWeighted(REEF_ARCHETYPES, REEF_ARCHETYPE_WEIGHTS, random, excluded);
}

/**
 * Turn a ring profile into a closed, coloured surface.
 *
 * Rings are stacked from the wet skirt to the crest. The centre vertex caps the
 * top so the mesh can be read from above as well as from the side.
 */
function buildRingSurface(profile, seed) {
  const { rings, segments, wobble, bend } = profile;
  const positions = [];
  const colors = [];
  const indices = [];
  const ringCenters = [];

  for (let ringIndex = 0; ringIndex < rings.length; ringIndex += 1) {
    const ring = rings[ringIndex];
    const rise = ringIndex / Math.max(1, rings.length - 1);
    const centerX = (bend?.x ?? 0) * rise ** 1.4;
    const centerZ = (bend?.z ?? 0) * rise ** 1.4;
    ringCenters.push({ x: centerX, z: centerZ });
    const color = colorOf(ring.color);

    for (let i = 0; i < segments; i += 1) {
      const angle = (i / segments) * TAU;
      const irregularity = 1
        + wobble.a * Math.sin(angle * 3 + seed)
        + wobble.b * Math.sin(angle * 7 - seed * 1.7)
        + wobble.c * Math.sin(angle * 11 + seed * 2.3)
        + wobble.lobe * Math.cos(angle + wobble.phase);
      const localHeight = wobble.y * Math.sin(angle * 4 + seed + ringIndex * 1.3);
      positions.push(
        centerX + Math.cos(angle) * ring.rx * irregularity,
        ring.y + localHeight,
        centerZ + Math.sin(angle) * ring.rz * irregularity,
      );
      colors.push(color[0], color[1], color[2]);
    }
  }

  for (let ringIndex = 0; ringIndex < rings.length - 1; ringIndex += 1) {
    const outer = ringIndex * segments;
    const inner = (ringIndex + 1) * segments;
    for (let i = 0; i < segments; i += 1) {
      const next = (i + 1) % segments;
      indices.push(outer + i, inner + i, outer + next, outer + next, inner + i, inner + next);
    }
  }

  const centerIndex = positions.length / 3;
  const topCenter = ringCenters[ringCenters.length - 1];
  positions.push(topCenter.x, profile.centerY, topCenter.z);
  const topColor = colorOf(rings[rings.length - 1].color);
  colors.push(topColor[0], topColor[1], topColor[2]);
  const lastRing = (rings.length - 1) * segments;
  for (let i = 0; i < segments; i += 1) {
    indices.push(lastRing + i, centerIndex, lastRing + ((i + 1) % segments));
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    minX = Math.min(minX, positions[i]);
    maxX = Math.max(maxX, positions[i]);
    minZ = Math.min(minZ, positions[i + 2]);
    maxZ = Math.max(maxZ, positions[i + 2]);
    maxY = Math.max(maxY, positions[i + 1]);
  }

  return {
    positions,
    colors,
    indices,
    width: maxX - minX,
    depth: maxZ - minZ,
    maxRelief: maxY,
    top: {
      x: topCenter.x,
      y: profile.centerY,
      z: topCenter.z,
    },
  };
}

/**
 * Deterministic island surface for one archetype.
 * @param archetype - id from ISLAND_ARCHETYPES.
 * @param seed - shape seed; the same seed always returns the same data.
 * @returns positions, colors, indices, footprint and relief.
 */
export function buildIslandSurfaceData(archetype, seed = 0) {
  const profile = ISLAND_PROFILES[archetype];
  if (!profile) throw new Error(`unknown island archetype: ${archetype}`);
  const surface = buildRingSurface(profile, seed);
  return {
    archetype,
    positions: surface.positions,
    colors: surface.colors,
    indices: surface.indices,
    width: surface.width,
    depth: surface.depth,
    maxRelief: surface.maxRelief,
    top: surface.top,
    palm: {
      x: surface.top.x,
      y: surface.top.y - 0.04,
      z: surface.top.z,
      scale: profile.palmScale,
    },
    vegetation: profile.vegetation,
  };
}

/**
 * Deterministic reef surface for one archetype.
 * @param archetype - id from REEF_ARCHETYPES.
 * @param seed - shape seed; the same seed always returns the same data.
 * @returns positions, colors, indices, footprint and relief.
 */
export function buildReefSurfaceData(archetype, seed = 0) {
  const profile = REEF_PROFILES[archetype];
  if (!profile) throw new Error(`unknown reef archetype: ${archetype}`);
  const surface = buildRingSurface(profile, seed);
  return {
    archetype,
    positions: surface.positions,
    colors: surface.colors,
    indices: surface.indices,
    width: surface.width,
    depth: surface.depth,
    maxRelief: surface.maxRelief,
    top: surface.top,
  };
}
