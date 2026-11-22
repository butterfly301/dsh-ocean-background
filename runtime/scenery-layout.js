
export const SCENERY_Z_FAR = -340;
export const ISLAND_HULL_HALF_DEPTH = 12;
export const REEF_HULL_HALF_DEPTH = 9;
export const ISLAND_CAMERA_CLEARANCE = 34;
export const REEF_CAMERA_CLEARANCE = 16;

const SANDBAR_MIN_DEPTH = 120;
export const ISLAND_SCALE_MIN = 1.4;
export const ISLAND_SCALE_MAX = 1.9;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

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
  return clamp(minZ + random() * (maxZ - minZ) * 0.5, minZ, laneFar);
}

function isSandbar(archetype) {
  return archetype.startsWith('sandbar-');
}

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

export function islandNeedsPlacement({ z, cameraZ, archetype }) {
  return intrudesOnCamera(z, cameraZ, ISLAND_CAMERA_CLEARANCE)
    || intrudesOnHull(z, ISLAND_HULL_HALF_DEPTH)
    || (isSandbar(archetype) && z > -SANDBAR_MIN_DEPTH);
}

export function reefZ(cameraZ = 44, random = Math.random) {
  const headroom = cameraZ - REEF_CAMERA_CLEARANCE;
  if (headroom > REEF_HULL_HALF_DEPTH + 6 && random() < 0.35) {
    return REEF_HULL_HALF_DEPTH + 3 + random() * (headroom - REEF_HULL_HALF_DEPTH - 4);
  }
  const near = -(REEF_HULL_HALF_DEPTH + 18);
  const far = -150;
  return near - random() * (Math.abs(far) - Math.abs(near));
}

export function intrudesOnCamera(z, cameraZ, cameraClearance) {
  return Math.abs(cameraZ - z) < cameraClearance;
}

export function intrudesOnHull(z, hullHalfDepth) {
  return Math.abs(z) < hullHalfDepth;
}

export function islandScale(random = Math.random) {
  return ISLAND_SCALE_MIN + random() * (ISLAND_SCALE_MAX - ISLAND_SCALE_MIN);
}

export function recycleX(cameraX, span, random = Math.random) {
  return cameraX + span * (0.55 + random() * 0.35);
}

export function isBehindView(worldX, cameraX, span) {
  return worldX < cameraX - span;
}
