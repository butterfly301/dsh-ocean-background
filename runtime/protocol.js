export const PROTOCOL_VERSION = 2;

export const MESSAGE = Object.freeze({
  settings: 'ocean-settings',
  snapshot: 'ocean-snapshot',
  flag: 'ocean-flag',
  shake: 'ocean-shake',
  ready: 'ocean-ready',
  error: 'ocean-error',
});

const field = (spec) => Object.freeze(spec);

export const SETTINGS_SCHEMA = Object.freeze({
  version: 2,
  order: Object.freeze([
    'enabled',
    'strength',
    'running',
    'quality',
    'followTime',
    'timePreset',
    'followWeather',
    'weatherPreset',
    'weatherLat',
    'weatherLon',
    'cameraDistance',
    'cameraHeight',
    'cameraPitch',
    'cameraXOffset',
  ]),
  fields: Object.freeze({
    enabled: field({
      type: 'boolean',
      control: 'checkbox',
      label: 'show',
      default: true,
    }),
    strength: field({
      type: 'number',
      control: 'percent',
      label: 'strength',
      default: 0.72,
      min: 0.35,
      max: 0.95,
      step: 0.01,
      decimals: 2,
    }),
    running: field({
      type: 'boolean',
      control: 'checkbox',
      label: 'running',
      default: true,
    }),
    quality: field({
      type: 'enum',
      control: 'select',
      label: 'quality',
      default: 'balanced',
      values: Object.freeze(['balanced', 'high']),
      optionLabels: Object.freeze({ balanced: 'balanced', high: 'high' }),
    }),
    followTime: field({
      type: 'boolean',
      control: 'checkbox',
      label: 'followTime',
      default: false,
    }),
    timePreset: field({
      type: 'enum',
      control: 'select',
      label: 'timePreset',
      default: 'day',
      values: Object.freeze(['dawn', 'day', 'dusk', 'night']),
      optionLabels: Object.freeze({
        dawn: 'presetDawn',
        day: 'presetDay',
        dusk: 'presetDusk',
        night: 'presetNight',
      }),
    }),
    followWeather: field({
      type: 'boolean',
      control: 'checkbox',
      label: 'followWeather',
      default: false,
    }),
    weatherPreset: field({
      type: 'enum',
      control: 'select',
      label: 'weatherPreset',
      default: 'clear',
      values: Object.freeze(['clear', 'rain', 'snow']),
      optionLabels: Object.freeze({
        clear: 'weatherClear',
        rain: 'weatherRain',
        snow: 'weatherSnow',
      }),
    }),
    weatherLat: field({
      type: 'string',
      control: 'coord',
      label: 'weatherLat',
      default: '',
      min: -90,
      max: 90,
    }),
    weatherLon: field({
      type: 'string',
      control: 'coord',
      label: 'weatherLon',
      default: '',
      min: -180,
      max: 180,
    }),
    cameraDistance: field({
      type: 'number',
      control: 'range',
      label: 'cameraDistance',
      default: 44,
      min: 20,
      max: 100,
      step: 1,
      decimals: 0,
    }),
    cameraHeight: field({
      type: 'number',
      control: 'range',
      label: 'cameraHeight',
      default: 4.8,
      min: 2,
      max: 40,
      step: 0.1,
      decimals: 1,
    }),
    cameraPitch: field({
      type: 'number',
      control: 'range',
      label: 'cameraPitch',
      default: 2.7,
      min: -30,
      max: 60,
      step: 0.1,
      decimals: 1,
      unit: '°',
    }),
    cameraXOffset: field({
      type: 'number',
      control: 'range',
      label: 'cameraXOffset',
      default: 0,
      min: -8,
      max: 8,
      step: 0.1,
      decimals: 1,
    }),
  }),
});

export function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function normalizeCoord(raw, min, max) {
  if (raw === null || raw === undefined) return '';
  const text = String(raw).trim();
  if (text === '') return '';
  const n = Number(text);
  if (!Number.isFinite(n) || n < min || n > max) return '';
  const truncated = Math.trunc(n * 100) / 100;
  return truncated.toFixed(2);
}

function quantize(value, spec) {
  const clamped = clampNumber(value, spec.min, spec.max);
  const step = spec.step;
  if (!(typeof step === 'number' && Number.isFinite(step) && step > 0)) return clamped;
  const steps = Math.round((clamped - spec.min) / step);
  const snapped = spec.min + steps * step;
  const decimals = Number.isInteger(spec.decimals) ? spec.decimals : 2;
  return Number(snapped.toFixed(decimals));
}

function normalizeField(spec, value) {
  if (spec.type === 'boolean') {
    return typeof value === 'boolean' ? value : spec.default;
  }
  if (spec.type === 'enum') {
    return typeof value === 'string' && spec.values.includes(value) ? value : spec.default;
  }
  if (spec.type === 'string') {
    if (spec.control === 'coord') return normalizeCoord(value, spec.min, spec.max);
    return typeof value === 'string' ? value.trim() : spec.default;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return quantize(value, spec);
  return spec.default;
}

export function normalizeSettings(raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const output = {};
  for (const [key, spec] of Object.entries(SETTINGS_SCHEMA.fields)) {
    output[key] = normalizeField(spec, input[key]);
  }
  return output;
}

export function settingsEqual(left, right) {
  for (const key of Object.keys(SETTINGS_SCHEMA.fields)) {
    if (left[key] !== right[key]) return false;
  }
  return true;
}

export function readMessage(data) {
  if (!data || typeof data !== 'object') return null;
  if (data.v !== PROTOCOL_VERSION) return null;
  if (typeof data.type !== 'string') return null;
  return data;
}

export function settingsMessage(settings, sessionId, liveWeather = null) {
  return {
    v: PROTOCOL_VERSION,
    type: MESSAGE.settings,
    settings: normalizeSettings(settings),
    sessionId: typeof sessionId === 'string' && sessionId !== '' ? sessionId : null,
    liveWeather: liveWeather === 'clear' || liveWeather === 'rain' || liveWeather === 'snow'
      ? liveWeather
      : null,
  };
}

export function snapshotMessage(snapshot) {
  return { v: PROTOCOL_VERSION, type: MESSAGE.snapshot, snapshot };
}

export function flagMessage(hasCustom, version = Date.now()) {
  return { v: PROTOCOL_VERSION, type: MESSAGE.flag, hasCustom: Boolean(hasCustom), version };
}

export function shakeMessage(durationMs = 4000, intensity = 1) {
  return { v: PROTOCOL_VERSION, type: MESSAGE.shake, durationMs, intensity };
}
