import { VALUE_NOISE_GLSL } from './glsl.js';

// Three long swells carry the displacement. Shorter wind chop belongs to the
// fragment normal: at this camera height a five-wave surface reads as a field of
// identical ripples, while open water shows one broad swell train at a time.
const WAVES = [
  { dir: [0.86, 0.51], length: 196.0, steep: 0.064, envelopeFreq: 0.026 },
  { dir: [-0.42, 0.91], length: 132.0, steep: 0.042, envelopeFreq: 0.038 },
  { dir: [-0.62, 0.78], length: 86.0, steep: 0.025, envelopeFreq: 0.052 },
];

// Widen the crests while keeping the total rise close to the previous sea.
// Slow envelopes and weak warping avoid breaking a long swell into small peaks.
const ENVELOPE_DEPTH = 0.16;
const ENVELOPE_DRIFT = 0.028;
const WARP_SCALE = 0.022;
const WARP_STRENGTH = 2.8;
const WARP_DRIFT = 0.004;
const CREST_HARMONIC = 0.05;
const CREST_SHARPNESS = 0.38;
const AMPLITUDE_GAIN = 1 / (1 - ENVELOPE_DEPTH);

const RESOLVED = WAVES.map(({ dir, length, steep, envelopeFreq }, index) => {
  const lengthDir = Math.hypot(dir[0], dir[1]);
  const dx = dir[0] / lengthDir;
  const dy = dir[1] / lengthDir;
  const k = (Math.PI * 2) / length;
  const amplitude = (steep / k) * AMPLITUDE_GAIN;
  const speed = Math.sqrt(9.8 * k);
  return {
    dx,
    dy,
    k,
    amplitude,
    speed,
    envelopeFreq,
    envelopePhase: 1.3 + index * 2.1,
    envelopeDrift: ENVELOPE_DRIFT + index * 0.009,
  };
});

function fract(value) {
  return value - Math.floor(value);
}

function hash21(x, y) {
  let qx = fract(x * 0.1031);
  let qy = fract(y * 0.1030);
  let qz = fract(x * 0.0973);
  const dot = qx * (qy + 33.33) + qy * (qz + 33.33) + qz * (qx + 33.33);
  qx += dot;
  qy += dot;
  qz += dot;
  return fract((qx + qy) * qz);
}

function valueNoise(x, y) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash21(ix, iy);
  const b = hash21(ix + 1, iy);
  const c = hash21(ix, iy + 1);
  const d = hash21(ix + 1, iy + 1);
  const lower = a + (b - a) * ux;
  const upper = c + (d - c) * ux;
  return lower + (upper - lower) * uy;
}

export function waveWarpAt(x, z, time) {
  return {
    x: (valueNoise(x * WARP_SCALE + 12.7 + time * WARP_DRIFT, z * WARP_SCALE + 31.9 - time * WARP_DRIFT * 0.63) - 0.5) * WARP_STRENGTH,
    z: (valueNoise(x * WARP_SCALE + 67.2 - time * WARP_DRIFT * 0.47, z * WARP_SCALE + 8.4 + time * WARP_DRIFT) - 0.5) * WARP_STRENGTH,
  };
}

export function waveHeightAt(x, z, time, flow, sea) {
  const warp = waveWarpAt(x, z, time);
  const px = x + warp.x;
  const pz = z + warp.z;
  let height = 0;
  for (const wave of RESOLVED) {
    const phase = wave.k * (wave.dx * px + wave.dy * pz - time * wave.speed + flow * wave.k * 0.42);
    const along = -wave.dy * px + wave.dx * pz;
    const envelope = 1 - ENVELOPE_DEPTH
      + ENVELOPE_DEPTH * Math.sin(along * wave.envelopeFreq + wave.envelopePhase + time * wave.envelopeDrift);
    const crest = Math.sin(phase) + CREST_HARMONIC * Math.sin(2 * phase - CREST_SHARPNESS);
    height += wave.amplitude * envelope * crest;
  }
  return height * sea;
}

export function waveSlopeAt(x, z, time, flow, sea) {
  const e = 0.6;
  const height = waveHeightAt(x, z, time, flow, sea);
  return {
    dx: (waveHeightAt(x + e, z, time, flow, sea) - height) / e,
    dz: (waveHeightAt(x, z + e, time, flow, sea) - height) / e,
  };
}

export function waveFieldCode() {
  const warp = `  float warpX = (valueNoise(vec2(p.x * ${WARP_SCALE.toFixed(4)} + 12.7 + uTime * ${WARP_DRIFT.toFixed(4)}, p.y * ${WARP_SCALE.toFixed(4)} + 31.9 - uTime * ${(WARP_DRIFT * 0.63).toFixed(4)})) - 0.5) * ${WARP_STRENGTH.toFixed(3)};
  float warpZ = (valueNoise(vec2(p.x * ${WARP_SCALE.toFixed(4)} + 67.2 - uTime * ${(WARP_DRIFT * 0.47).toFixed(4)}, p.y * ${WARP_SCALE.toFixed(4)} + 8.4 + uTime * ${WARP_DRIFT.toFixed(4)})) - 0.5) * ${WARP_STRENGTH.toFixed(3)};
  vec2 q = p + vec2(warpX, warpZ);`;
  const fields = RESOLVED.map((wave, index) => {
    const flat = (1 - ENVELOPE_DEPTH).toFixed(3);
    const depth = ENVELOPE_DEPTH.toFixed(3);
    const crestX = (-wave.dy).toFixed(6);
    const crestY = wave.dx.toFixed(6);
    return `  float f${index} = ${wave.k.toFixed(6)} * (${wave.dx.toFixed(6)} * q.x + ${wave.dy.toFixed(6)} * q.y - uTime * ${wave.speed.toFixed(6)} + uFlow * ${wave.k.toFixed(6)} * 0.42);
  float e${index} = ${flat} + ${depth} * sin((${crestX} * q.x + ${crestY} * q.y) * ${wave.envelopeFreq.toFixed(4)} + ${wave.envelopePhase.toFixed(4)} + uTime * ${wave.envelopeDrift.toFixed(4)});
  float c${index} = sin(f${index}) + ${CREST_HARMONIC.toFixed(3)} * sin(2.0 * f${index} - ${CREST_SHARPNESS.toFixed(3)});
  h += ${wave.amplitude.toFixed(6)} * e${index} * c${index};`;
  }).join('\n');
  return `${warp}\n${fields}`;
}

export const WAVE_VERTEX_NOISE_GLSL = VALUE_NOISE_GLSL;

/** Largest possible crest height at a sea value of 1, used to keep scenery clear. */
export const WAVE_AMPLITUDE_SUM = RESOLVED.reduce((sum, wave) => sum + wave.amplitude, 0);
