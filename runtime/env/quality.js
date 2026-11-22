

export const QUALITY_PROFILES = Object.freeze({
  balanced: Object.freeze({ pixelRatio: 1.3, targetFps: 30, segments: 240 }),
  high: Object.freeze({ pixelRatio: 2, targetFps: 60, segments: 300 }),
});

export function qualityProfile(name) {
  return QUALITY_PROFILES[name] ?? QUALITY_PROFILES.balanced;
}

export function pixelRatioFor(name, devicePixelRatio = 1) {
  const base = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return Math.min(base, qualityProfile(name).pixelRatio);
}
