// Forward travel keeps the ship moving through a fixed sea at a readable pace.
// One scene unit reads as about one metre, so this is roughly three knots.
export const VOYAGE_SPEED = 1.6;
// The camera leads the hull slightly so the water ahead has more screen space.
export const CAMERA_LEAD = 5;
export const CAMERA_X_OFFSET_LIMIT = 8;

export function normalizeCameraXOffset(value) {
  return Number.isFinite(value)
    ? Math.min(CAMERA_X_OFFSET_LIMIT, Math.max(-CAMERA_X_OFFSET_LIMIT, value))
    : 0;
}

export function advanceVoyage(worldX, dt, enabled = true) {
  return worldX + (enabled ? Math.max(0, dt) * VOYAGE_SPEED : 0);
}

export function cameraXForShip(travelX, shipLocalX = 0, offset = 0) {
  return travelX + shipLocalX + CAMERA_LEAD + normalizeCameraXOffset(offset);
}

export function toWorldX(localX, originX) {
  return localX + originX;
}
