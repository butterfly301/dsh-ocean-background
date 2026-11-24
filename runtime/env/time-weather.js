// Pure 24-hour atmosphere interpolation and weather mood blending (no Three.js).

export const DAY_PALETTE = Object.freeze({
  skyZenith: '#3f87bd',
  skyHorizon: '#b6dbe8',
  sunDir: Object.freeze({ x: -0.48, y: 0.20, z: -0.85 }),
  sunColor: '#fff0d2',
  deep: '#1f5d78',
  shallow: '#4e9fba',
  foam: '#bfe0dc',
});

const KEYFRAMES = Object.freeze([
  {
    hour: 0,
    skyZenith: '#081326',
    skyHorizon: '#162c46',
    sunDir: { x: 0.35, y: 0.38, z: -0.85 },
    sunColor: '#8fb2d8',
    deep: '#091b2c',
    shallow: '#163d52',
    foam: '#5d7d8e',
    sunIntensity: 0.55,
    hemiSky: '#3b587a',
    hemiGround: '#0a1f2c',
    hemiIntensity: 0.70,
    nightWeight: 1.0,
  },
  {
    hour: 6,
    skyZenith: '#4a6d9c',
    skyHorizon: '#f2b58b',
    sunDir: { x: 0.72, y: 0.14, z: -0.68 },
    sunColor: '#ffd6a3',
    deep: '#1c4762',
    shallow: '#46859b',
    foam: '#d9d7ce',
    sunIntensity: 1.75,
    hemiSky: '#f0cbb0',
    hemiGround: '#1a4252',
    hemiIntensity: 1.25,
    nightWeight: 0.25,
  },
  {
    hour: 12,
    skyZenith: DAY_PALETTE.skyZenith,
    skyHorizon: DAY_PALETTE.skyHorizon,
    sunDir: DAY_PALETTE.sunDir,
    sunColor: DAY_PALETTE.sunColor,
    deep: DAY_PALETTE.deep,
    shallow: DAY_PALETTE.shallow,
    foam: DAY_PALETTE.foam,
    sunIntensity: 2.5,
    hemiSky: '#d2e8f3',
    hemiGround: '#1a515e',
    hemiIntensity: 1.45,
    nightWeight: 0,
  },
  {
    hour: 18,
    skyZenith: '#2b3d6b',
    skyHorizon: '#e88b5a',
    sunDir: { x: -0.78, y: 0.11, z: -0.62 },
    sunColor: '#ffb074',
    deep: '#173a56',
    shallow: '#3c738f',
    foam: '#cbb7b0',
    sunIntensity: 1.5,
    hemiSky: '#d9a48f',
    hemiGround: '#153445',
    hemiIntensity: 1.1,
    nightWeight: 0.55,
  },
  {
    hour: 24,
    skyZenith: '#081326',
    skyHorizon: '#162c46',
    sunDir: { x: 0.35, y: 0.38, z: -0.85 },
    sunColor: '#8fb2d8',
    deep: '#091b2c',
    shallow: '#163d52',
    foam: '#5d7d8e',
    sunIntensity: 0.55,
    hemiSky: '#3b587a',
    hemiGround: '#0a1f2c',
    hemiIntensity: 0.70,
    nightWeight: 1.0,
  },
]);

const PRESET_HOURS = Object.freeze({
  dawn: 6,
  day: 12,
  dusk: 18,
  night: 0,
});

function parseHex(hex) {
  const raw = String(hex).replace('#', '');
  const n = parseInt(raw, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function lerpHex(hexA, hexB, t) {
  const [r1, g1, b1] = parseHex(hexA);
  const [r2, g2, b2] = parseHex(hexB);
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const b = Math.round(b1 + (b2 - b1) * t);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

function lerpNum(a, b, t) {
  return a + (b - a) * t;
}

function normalizeVec3(v) {
  const len = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

export function hourFromDate(date = new Date()) {
  const h = date.getHours();
  const m = date.getMinutes();
  const s = date.getSeconds();
  return h + m / 60 + s / 3600;
}

export function hourForSettings({ followTime, timePreset, date }) {
  if (followTime) return hourFromDate(date);
  return Object.prototype.hasOwnProperty.call(PRESET_HOURS, timePreset)
    ? PRESET_HOURS[timePreset]
    : 12;
}

export function paletteForHour(rawHour) {
  const wrapped = ((Number(rawHour) % 24) + 24) % 24;
  let a = KEYFRAMES[0];
  let b = KEYFRAMES[1];
  for (let i = 0; i < KEYFRAMES.length - 1; i += 1) {
    if (wrapped >= KEYFRAMES[i].hour && wrapped <= KEYFRAMES[i + 1].hour) {
      a = KEYFRAMES[i];
      b = KEYFRAMES[i + 1];
      break;
    }
  }
  const span = Math.max(0.0001, b.hour - a.hour);
  const linear = (wrapped - a.hour) / span;
  // Smoothstep for gentle transitions near noon/midnight
  const t = linear * linear * (3 - 2 * linear);
  const sunDir = normalizeVec3({
    x: lerpNum(a.sunDir.x, b.sunDir.x, t),
    y: lerpNum(a.sunDir.y, b.sunDir.y, t),
    z: lerpNum(a.sunDir.z, b.sunDir.z, t),
  });
  return {
    skyZenith: lerpHex(a.skyZenith, b.skyZenith, t),
    skyHorizon: lerpHex(a.skyHorizon, b.skyHorizon, t),
    sunDir,
    sunColor: lerpHex(a.sunColor, b.sunColor, t),
    deep: lerpHex(a.deep, b.deep, t),
    shallow: lerpHex(a.shallow, b.shallow, t),
    foam: lerpHex(a.foam, b.foam, t),
    sunIntensity: lerpNum(a.sunIntensity, b.sunIntensity, t),
    hemiSky: lerpHex(a.hemiSky, b.hemiSky, t),
    hemiGround: lerpHex(a.hemiGround, b.hemiGround, t),
    hemiIntensity: lerpNum(a.hemiIntensity, b.hemiIntensity, t),
    nightWeight: lerpNum(a.nightWeight, b.nightWeight, t),
  };
}

export function applyWeatherToAtmosphere(base, weather = 'clear') {
  if (weather === 'rain') {
    return {
      ...base,
      skyZenith: lerpHex(base.skyZenith, '#2a3948', 0.58),
      skyHorizon: lerpHex(base.skyHorizon, '#627382', 0.62),
      sunColor: lerpHex(base.sunColor, '#93a6b8', 0.65),
      deep: lerpHex(base.deep, '#133040', 0.45),
      shallow: lerpHex(base.shallow, '#2f5b6b', 0.48),
      foam: lerpHex(base.foam, '#9bb2ba', 0.40),
      sunIntensity: base.sunIntensity * 0.55,
      hemiIntensity: base.hemiIntensity * 0.85,
      cloud: 1.0,
      seaBoost: 0.34,
      weather: 'rain',
    };
  }
  if (weather === 'snow') {
    return {
      ...base,
      skyZenith: lerpHex(base.skyZenith, '#6c7c8c', 0.55),
      skyHorizon: lerpHex(base.skyHorizon, '#bcc8d2', 0.58),
      sunColor: lerpHex(base.sunColor, '#dce6ef', 0.50),
      deep: lerpHex(base.deep, '#1c4459', 0.35),
      shallow: lerpHex(base.shallow, '#4d8296', 0.35),
      foam: lerpHex(base.foam, '#e6eef2', 0.45),
      sunIntensity: base.sunIntensity * 0.68,
      hemiIntensity: base.hemiIntensity * 0.95,
      cloud: 0.96,
      seaBoost: 0.14,
      weather: 'snow',
    };
  }
  return {
    ...base,
    cloud: 0.75,
    seaBoost: 0,
    weather: 'clear',
  };
}

export function computeAtmosphere({ followTime = false, timePreset = 'day', weather = 'clear', date = new Date() } = {}) {
  const hour = hourForSettings({ followTime, timePreset, date });
  const base = paletteForHour(hour);
  return applyWeatherToAtmosphere(base, weather);
}

export function blendAtmosphere(current, target, alpha) {
  const t = Math.min(1, Math.max(0, alpha));
  if (!current || t >= 0.999) return { ...target };
  const sunDir = normalizeVec3({
    x: lerpNum(current.sunDir.x, target.sunDir.x, t),
    y: lerpNum(current.sunDir.y, target.sunDir.y, t),
    z: lerpNum(current.sunDir.z, target.sunDir.z, t),
  });
  return {
    skyZenith: lerpHex(current.skyZenith, target.skyZenith, t),
    skyHorizon: lerpHex(current.skyHorizon, target.skyHorizon, t),
    sunDir,
    sunColor: lerpHex(current.sunColor, target.sunColor, t),
    deep: lerpHex(current.deep, target.deep, t),
    shallow: lerpHex(current.shallow, target.shallow, t),
    foam: lerpHex(current.foam, target.foam, t),
    sunIntensity: lerpNum(current.sunIntensity, target.sunIntensity, t),
    hemiSky: lerpHex(current.hemiSky, target.hemiSky, t),
    hemiGround: lerpHex(current.hemiGround, target.hemiGround, t),
    hemiIntensity: lerpNum(current.hemiIntensity, target.hemiIntensity, t),
    nightWeight: lerpNum(current.nightWeight, target.nightWeight, t),
    cloud: lerpNum(current.cloud, target.cloud, t),
    seaBoost: lerpNum(current.seaBoost, target.seaBoost, t),
    weather: target.weather,
  };
}
