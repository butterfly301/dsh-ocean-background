// Placement rules for everything that drifts past the ship.
//
// The ship sails along z = 0; the camera sits at z = cameraDistance, looking
// down -Z. Scenery may appear on either side of the hull, in front of it as well
// as behind, but never inside the camera's clearance bubble and never in the
// hull's lane. Both depend on the live camera distance, so the rules take it as
// an argument rather than baking in a constant.

/** Deepest scenery depth; beyond this the haze swallows everything anyway. */
export const SCENERY_Z_FAR = -340;
/** Hull lane half-depth: the hull, its wake and the nearest escort lanes. */
export const ISLAND_HULL_HALF_DEPTH = 12;
export const REEF_HULL_HALF_DEPTH = 9;
/** How far a spawned object must stay from the camera plane. */
export const ISLAND_CAMERA_CLEARANCE = 34;
export const REEF_CAMERA_CLEARANCE = 16;

/** Sandbars stay in the background, at least this far behind the hull plane. */
const SANDBAR_MIN_DEPTH = 120;
/** Island scale range, varied at first placement and every recycle. */
export const ISLAND_SCALE_MIN = 1.4;
export const ISLAND_SCALE_MAX = 1.9;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Pick a depth that is outside the hull lane and outside the camera bubble.
 *
 * Scenery is allowed in front of the ship: with the camera pulled back there is
 * room between the hull and the lens, and a small reef passing close is one of
 * the better cues that the ship is moving. The camera clearance is what stops
 * that from turning into geometry through the lens.
 *
 * @param options.cameraZ - camera world z for this frame.
 * @param options.cameraClearance - minimum distance from the camera plane.
 * @param options.hullHalfDepth - half depth of the lane to keep clear.
 * @param options.random - source of random numbers, injectable for tests.
 * @returns z in [SCENERY_Z_FAR, cameraZ - cameraClearance] outside the lane.
 */
export function sceneryDepth({
  cameraZ,
  cameraClearance,
  hullHalfDepth,
  random = Math.random,
  attempts = 12,
}) {
  const maxZ = Math.min(cameraZ - cameraClearance, cameraZ);
  const minZ = Math.min(SCENERY_Z_FAR, maxZ);
  if (maxZ <= minZ) return minZ;

  const laneFar = -hullHalfDepth;
  const laneNear = hullHalfDepth;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const z = minZ + random() * (maxZ - minZ);
    if (z <= laneFar || z >= laneNear) return z;
  }
  // The lane covers most of the band; fall back to the far side of it.
  return clamp(minZ + random() * (maxZ - minZ) * 0.5, minZ, laneFar);
}

function isSandbar(archetype) {
  return archetype.startsWith('sandbar-');
}

/** Pick depth from the silhouette's allowed band, respecting the live camera. */
export function islandZ({ cameraZ = 44, archetype = 'green-island', random = Math.random } = {}) {
  if (isSandbar(archetype)) {
    const near = Math.min(-SANDBAR_MIN_DEPTH, cameraZ - ISLAND_CAMERA_CLEARANCE);
    const far = Math.min(SCENERY_Z_FAR, near);
    return near - random() * (near - far);
  }

  const headroom = cameraZ - ISLAND_CAMERA_CLEARANCE;
  if (headroom > ISLAND_HULL_HALF_DEPTH + 8 && random() < 0.2) {
    return ISLAND_HULL_HALF_DEPTH + 4 + random() * (headroom - ISLAND_HULL_HALF_DEPTH - 6);
  }
  const deep = random() < 0.18;
  if (deep) return -200 - random() * 140;
  const near = -(ISLAND_HULL_HALF_DEPTH + 14);
  const far = -175;
  return near - random() * (Math.abs(far) - Math.abs(near));
}

/** Initial placement, recycling and camera changes share the same constraints. */
export function islandNeedsPlacement({ z, cameraZ, archetype }) {
  return intrudesOnCamera(z, cameraZ, ISLAND_CAMERA_CLEARANCE)
    || intrudesOnHull(z, ISLAND_HULL_HALF_DEPTH)
    || (isSandbar(archetype) && z > -SANDBAR_MIN_DEPTH);
}

/** Depth for a reef cluster; reefs may pass close in front of the hull. */
export function reefZ(cameraZ = 44, random = Math.random) {
  const headroom = cameraZ - REEF_CAMERA_CLEARANCE;
  if (headroom > REEF_HULL_HALF_DEPTH + 6 && random() < 0.35) {
    return REEF_HULL_HALF_DEPTH + 3 + random() * (headroom - REEF_HULL_HALF_DEPTH - 4);
  }
  const near = -(REEF_HULL_HALF_DEPTH + 6);
  const far = -130;
  return near - random() * (Math.abs(far) - Math.abs(near));
}

/**
 * Whether an existing object has fallen inside the camera bubble, which happens
 * when the user pulls the camera back while scenery is already on the water.
 * @param z - object world z.
 * @param cameraZ - camera world z.
 * @param cameraClearance - required distance from the camera plane.
 * @returns true when the object must be re-placed this frame.
 */
export function intrudesOnCamera(z, cameraZ, cameraClearance) {
  return Math.abs(cameraZ - z) < cameraClearance;
}

/** Whether an existing object sits in the hull lane. */
export function intrudesOnHull(z, hullHalfDepth) {
  return Math.abs(z) < hullHalfDepth;
}

/** Pick an island scale from the allowed range. */
export function islandScale(random = Math.random) {
  return ISLAND_SCALE_MIN + random() * (ISLAND_SCALE_MAX - ISLAND_SCALE_MIN);
}

/**
 * Recycle an object to just beyond the right edge of the view, with jitter so
 * successive passes never line up.
 * @param cameraX - camera world x.
 * @param span - visible half width the object may occupy.
 * @param random - source of random numbers.
 * @returns world x for the recycled object.
 */
export function recycleX(cameraX, span, random = Math.random) {
  return cameraX + span * (0.55 + random() * 0.35);
}

/**
 * Whether a recycled object should move again this frame.
 * @param worldX - object world x.
 * @param cameraX - camera world x.
 * @param span - visible half width.
 * @returns true when the object has fallen behind the left edge.
 */
export function isBehindView(worldX, cameraX, span) {
  return worldX < cameraX - span;
}
