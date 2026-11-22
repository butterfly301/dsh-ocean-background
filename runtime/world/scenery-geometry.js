
const TAU = Math.PI * 2;

// rocky-island has no profile here on purpose: scenery.js builds it from the
// supplied GLB rock models, while the other three archetypes stay procedural.
export const ISLAND_ARCHETYPES = [
  'sandbar-crescent',
  'sandbar-shoal',
  'green-island',
  'rocky-island',
];

export const ISLAND_ARCHETYPE_WEIGHTS = {
  'sandbar-crescent': 0.34,
  'sandbar-shoal': 0.34,
  'green-island': 0.18,
  'rocky-island': 0.14,
};


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
  ].map(hex => [hex, linearColor(hex)]),
);

function colorOf(hex) {
  return COLORS.get(hex);
}

function hash2(x, y) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function noise2(x, y) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function mixColor(a, b, t) {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

const ISLAND_PROFILES = {
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
    roughness: 0.035,
    roughnessY: 0.020,
    centerY: 0.62,
    vegetation: 1,
    palmScale: 0.62,
  },
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
    roughness: 0.030,
    roughnessY: 0.018,
    centerY: 0.52,
    vegetation: 1,
    palmScale: 0.6,
  },
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
    roughness: 0.045,
    roughnessY: 0.030,
    centerY: 3.7,
    vegetation: 4,
    palmScale: 0.64,
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

export function chooseIslandArchetype(random = Math.random, excluded = []) {
  return pickWeighted(ISLAND_ARCHETYPES, ISLAND_ARCHETYPE_WEIGHTS, random, excluded);
}

function buildRingSurface(profile, seed) {
  const {
    rings,
    segments,
    wobble,
    bend,
    roughness = 0.06,
    roughnessY = 0.035,
    capScale = 0.45,
    capLift = 0.55,
  } = profile;

  // A small extra ring under the summit rounds the top cap. Without it every
  // island ends in a single fan of long triangles, which is what made the
  // close-up rocks read as flat grey pyramids.
  const lastRing = rings[rings.length - 1];
  const capRing = {
    rx: lastRing.rx * capScale,
    rz: lastRing.rz * capScale,
    y: lastRing.y + (profile.centerY - lastRing.y) * capLift,
    color: lastRing.color,
  };
  const surfaceRings = [...rings, capRing];

  const positions = [];
  const colors = [];
  const indices = [];
  const ringCenters = [];

  for (let ringIndex = 0; ringIndex < surfaceRings.length; ringIndex += 1) {
    const ring = surfaceRings[ringIndex];
    const rise = ringIndex / Math.max(1, surfaceRings.length - 1);
    const centerX = (bend?.x ?? 0) * rise ** 1.4;
    const centerZ = (bend?.z ?? 0) * rise ** 1.4;
    ringCenters.push({ x: centerX, z: centerZ });
    const colorA = colorOf(ring.color);
    const colorB = colorOf(surfaceRings[Math.min(surfaceRings.length - 1, ringIndex + 1)].color);

    for (let i = 0; i < segments; i += 1) {
      const angle = (i / segments) * TAU;
      const irregularity = 1
        + wobble.a * Math.sin(angle * 3 + seed)
        + wobble.b * Math.sin(angle * 7 - seed * 1.7)
        + wobble.c * Math.sin(angle * 11 + seed * 2.3)
        + wobble.lobe * Math.cos(angle + wobble.phase);
      const baseX = Math.cos(angle) * ring.rx;
      const baseZ = Math.sin(angle) * ring.rz;

      // Two noise octaves break the smooth ring into a ragged rock outline.
      const grain = (noise2(baseX * 0.18 + seed * 1.7, baseZ * 0.18 - seed) - 0.5) * roughness
        + (noise2(baseX * 0.55 + seed * 3.1, baseZ * 0.55 + seed) - 0.5) * roughness * 0.45;
      const radial = irregularity * (1 + grain * (0.45 + rise));
      const localHeight = wobble.y * Math.sin(angle * 4 + seed + ringIndex * 1.3)
        + (noise2(baseX * 0.42 + seed * 2.3, baseZ * 0.42 - seed * 1.1) - 0.5)
          * roughnessY * (ringIndex === 0 ? 0.3 : 1);

      positions.push(
        centerX + baseX * radial,
        ring.y + localHeight,
        centerZ + baseZ * radial,
      );

      // Blend neighbouring ring colours per vertex instead of painting whole
      // horizontal bands, so the cliff face is mottled rather than one slab.
      const blend = 0.22 + 0.56 * noise2(baseX * 0.34 + seed, baseZ * 0.34 - seed * 0.7);
      const color = mixColor(colorA, colorB, blend);
      colors.push(color[0], color[1], color[2]);
    }
  }

  for (let ringIndex = 0; ringIndex < surfaceRings.length - 1; ringIndex += 1) {
    const outer = ringIndex * segments;
    const inner = (ringIndex + 1) * segments;
    for (let i = 0; i < segments; i += 1) {
      const next = (i + 1) % segments;
      indices.push(outer + i, inner + i, outer + next, outer + next, inner + i, inner + next);
    }
  }

  // Offset the summit slightly so the last triangle fan does not converge on
  // the exact ring centre and create a visible pin point.
  const topOffsetX = (noise2(seed * 2.1, 0.5) - 0.5) * lastRing.rx * 0.35;
  const topOffsetZ = (noise2(0.5, seed * 2.7) - 0.5) * lastRing.rz * 0.35;
  const topCenter = ringCenters[ringCenters.length - 1];
  const centerIndex = positions.length / 3;
  positions.push(topCenter.x + topOffsetX, profile.centerY, topCenter.z + topOffsetZ);
  const topColor = colorOf(capRing.color);
  colors.push(topColor[0], topColor[1], topColor[2]);
  const lastStart = (surfaceRings.length - 1) * segments;
  for (let i = 0; i < segments; i += 1) {
    indices.push(lastStart + i, centerIndex, lastStart + ((i + 1) % segments));
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
      x: topCenter.x + topOffsetX,
      y: profile.centerY,
      z: topCenter.z + topOffsetZ,
    },
  };
}

export function buildIslandSurfaceData(archetype, seed = 0) {
  if (archetype === 'rocky-island') {
    throw new Error('rocky-island is assembled from rock assets, not a ring surface');
  }
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
