import { VALUE_NOISE_GLSL } from './glsl.js';

// Swell table. The four components move in different directions so the surface
// never looks like one repeating sine wave; the shortest one only shapes the
// silhouette and is too small to alias with the ocean mesh.
const WAVES = [
  { dir: [0.86, 0.51], length: 196, steep: 0.050, envelopeFreq: 0.026 },
  { dir: [-0.42, 0.91], length: 132, steep: 0.032, envelopeFreq: 0.038 },
  { dir: [-0.62, 0.78], length: 86, steep: 0.020, envelopeFreq: 0.052 },
  { dir: [0.18, -0.98], length: 54, steep: 0.006, envelopeFreq: 0.078 },
];

// Large-scale amplitude modulation keeps the swell from looking machine-made.
const ENVELOPE_DEPTH = 0.10;
const ENVELOPE_DRIFT = 0.028;

// A slow noise warp bends every crest and prevents the wave directions from
// reading as straight parallel lines.
const WARP_SCALE = 0.012;
const WARP_STRENGTH = 1.2;
const WARP_DRIFT = 0.004;

// A small second harmonic gives crests a sharper lip than a pure sine.
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
    x: (valueNoise(x * WARP_SCALE + 12.7 + time * WARP_DRIFT, z * WARP_SCALE + 31.9 - time * WARP_DRIFT * 0.63) - 0.5) * WARP_STRENGTH,
    z: (valueNoise(x * WARP_SCALE + 67.2 - time * WARP_DRIFT * 0.47, z * WARP_SCALE + 8.4 + time * WARP_DRIFT) - 0.5) * WARP_STRENGTH,
  };
}

/**
 * Height of the shared wave field at one world-space point.
 * Mirrors `OCEAN_WAVE_GLSL` so the ship, the boats and the water mesh agree.
 */
export function waveHeightAt(x, z, time, flow, sea) {
  const warp = warpAt(x, z, time);
  const px = x + warp.x;
  const pz = z + warp.z;
  let height = 0;
  for (const wave of RESOLVED) {
    const phase = wave.k * (wave.dx * px + wave.dy * pz - time * wave.speed + flow * wave.k * FLOW_PHASE_GAIN);
    const along = -wave.dy * px + wave.dx * pz;
    const envelope = 1 - ENVELOPE_DEPTH
      + ENVELOPE_DEPTH * Math.sin(along * wave.envelopeFreq + wave.envelopePhase + time * wave.envelopeDrift);
    const crest = Math.sin(phase) + CREST_HARMONIC * Math.sin(2 * phase - CREST_SHARPNESS);
    height += wave.amplitude * envelope * crest;
  }
  return height * sea;
}

/**
 * Height and slope in one pass. Slope drives hull roll and pitch; using a
 * single entry point keeps the ship and every boat on exactly the same field.
 */
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

/**
 * Complete GLSL implementation of the same field, embedded in the water
 * vertex shader. Keeping the constants generated from one table means the CPU
 * and GPU can never drift apart.
 */
export const OCEAN_WAVE_GLSL = `
uniform float uTime;
uniform float uFlow;
uniform float uSea;

${VALUE_NOISE_GLSL}

float waveHeight(vec2 p) {
  float warpX = (valueNoise(vec2(p.x * ${WARP_SCALE.toFixed(4)} + 12.7 + uTime * ${WARP_DRIFT.toFixed(4)}, p.y * ${WARP_SCALE.toFixed(4)} + 31.9 - uTime * ${(WARP_DRIFT * 0.63).toFixed(4)})) - 0.5) * ${WARP_STRENGTH.toFixed(3)};
  float warpZ = (valueNoise(vec2(p.x * ${WARP_SCALE.toFixed(4)} + 67.2 - uTime * ${(WARP_DRIFT * 0.47).toFixed(4)}, p.y * ${WARP_SCALE.toFixed(4)} + 8.4 + uTime * ${WARP_DRIFT.toFixed(4)})) - 0.5) * ${WARP_STRENGTH.toFixed(3)};
  vec2 q = p + vec2(warpX, warpZ);
  float h = 0.0;
${RESOLVED.map((wave, index) => {
  const flat = (1 - ENVELOPE_DEPTH).toFixed(3);
  const depth = ENVELOPE_DEPTH.toFixed(3);
  const crestX = (-wave.dy).toFixed(6);
  const crestY = wave.dx.toFixed(6);
  return `  float phase${index} = ${wave.k.toFixed(6)} * (${wave.dx.toFixed(6)} * q.x + ${wave.dy.toFixed(6)} * q.y - uTime * ${wave.speed.toFixed(6)} + uFlow * ${wave.k.toFixed(6)} * ${FLOW_PHASE_GAIN.toFixed(2)});
  float envelope${index} = ${flat} + ${depth} * sin((${crestX} * q.x + ${crestY} * q.y) * ${wave.envelopeFreq.toFixed(4)} + ${wave.envelopePhase.toFixed(4)} + uTime * ${wave.envelopeDrift.toFixed(4)});
  float crest${index} = sin(phase${index}) + ${CREST_HARMONIC.toFixed(3)} * sin(2.0 * phase${index} - ${CREST_SHARPNESS.toFixed(3)});
  h += ${wave.amplitude.toFixed(6)} * envelope${index} * crest${index};`;
}).join('\n')}
  return h * uSea;
}
`;
