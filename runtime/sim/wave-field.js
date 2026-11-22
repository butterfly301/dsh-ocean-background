// The swell field shared by the GPU water plane and the CPU bobbing of every
// hull. This module owns the numbers; world/wave-glsl.js turns the same table
// into shader source, so the two can never drift apart.

const WAVES = [
  { dir: [0.86, 0.51], length: 196, steep: 0.050, envelopeFreq: 0.026 },
  { dir: [-0.42, 0.91], length: 132, steep: 0.032, envelopeFreq: 0.038 },
  { dir: [-0.62, 0.78], length: 86, steep: 0.020, envelopeFreq: 0.052 },
  { dir: [0.18, -0.98], length: 54, steep: 0.006, envelopeFreq: 0.078 },
];

const ENVELOPE_DEPTH = 0.10;
const ENVELOPE_DRIFT = 0.028;
const WARP_SCALE = 0.012;
const WARP_STRENGTH = 1.2;
const WARP_DRIFT = 0.004;
const CREST_HARMONIC = 0.02;
const CREST_SHARPNESS = 0.45;
const FLOW_PHASE_GAIN = 0.42;
const AMPLITUDE_SCALE = 0.7;
const AMPLITUDE_GAIN = 1 / (1 - ENVELOPE_DEPTH);

const RESOLVED = WAVES.map(({ dir, length, steep, envelopeFreq }, index) => {
  const lengthDir = Math.hypot(dir[0], dir[1]);
  const dx = dir[0] / lengthDir;
  const dy = dir[1] / lengthDir;
  const k = (Math.PI * 2) / length;
  return {
    dx,
    dy,
    k,
    amplitude: (steep / k) * AMPLITUDE_GAIN * AMPLITUDE_SCALE,
    speed: Math.sqrt(9.8 * k),
    envelopeFreq,
    envelopePhase: 1.3 + index * 2.1,
    envelopeDrift: ENVELOPE_DRIFT + index * 0.009,
  };
});

export const MAX_WAVE_HEIGHT = RESOLVED.reduce((sum, wave) => sum + wave.amplitude, 0);

export const WAVE_FIELD_PARAMS = Object.freeze({
  resolved: RESOLVED,
  envelopeDepth: ENVELOPE_DEPTH,
  crestHarmonic: CREST_HARMONIC,
  crestSharpness: CREST_SHARPNESS,
  flowPhaseGain: FLOW_PHASE_GAIN,
  warpScale: WARP_SCALE,
  warpStrength: WARP_STRENGTH,
  warpDrift: WARP_DRIFT,
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

function warpAt(x, z, time) {
  return {
    x: (valueNoise(
      x * WARP_SCALE + 12.7 + time * WARP_DRIFT,
      z * WARP_SCALE + 31.9 - time * WARP_DRIFT * 0.63,
    ) - 0.5) * WARP_STRENGTH,
    z: (valueNoise(
      x * WARP_SCALE + 67.2 - time * WARP_DRIFT * 0.47,
      z * WARP_SCALE + 8.4 + time * WARP_DRIFT,
    ) - 0.5) * WARP_STRENGTH,
  };
}

export function waveHeightAt(x, z, time, flow, sea) {
  const warp = warpAt(x, z, time);
  const px = x + warp.x;
  const pz = z + warp.z;
  let height = 0;
  for (const wave of RESOLVED) {
    const phase = wave.k
      * (wave.dx * px + wave.dy * pz - time * wave.speed + flow * wave.k * FLOW_PHASE_GAIN);
    const along = -wave.dy * px + wave.dx * pz;
    const envelope = 1 - ENVELOPE_DEPTH
      + ENVELOPE_DEPTH
        * Math.sin(along * wave.envelopeFreq + wave.envelopePhase + time * wave.envelopeDrift);
    const crest = Math.sin(phase) + CREST_HARMONIC * Math.sin(2 * phase - CREST_SHARPNESS);
    height += wave.amplitude * envelope * crest;
  }
  return height * sea;
}

export function sampleWaveAt(x, z, time, flow, sea) {
  const epsilon = 0.6;
  const height = waveHeightAt(x, z, time, flow, sea);
  const heightX = waveHeightAt(x + epsilon, z, time, flow, sea);
  const heightZ = waveHeightAt(x, z + epsilon, time, flow, sea);
  return {
    height,
    dx: (heightX - height) / epsilon,
    dz: (heightZ - height) / epsilon,
  };
}
