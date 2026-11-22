import { VALUE_NOISE_GLSL } from './glsl.js';
import { WAVE_FIELD_PARAMS } from '../sim/wave-field.js';

const {
  resolved,
  envelopeDepth,
  crestHarmonic,
  crestSharpness,
  flowPhaseGain,
  warpScale,
  warpStrength,
  warpDrift,
} = WAVE_FIELD_PARAMS;

export const OCEAN_WAVE_GLSL = `
uniform float uTime;
uniform float uFlow;
uniform float uSea;

${VALUE_NOISE_GLSL}

float waveHeight(vec2 p) {
  float warpX = (valueNoise(vec2(p.x * ${warpScale.toFixed(4)} + 12.7 + uTime * ${warpDrift.toFixed(4)}, p.y * ${warpScale.toFixed(4)} + 31.9 - uTime * ${(warpDrift * 0.63).toFixed(4)})) - 0.5) * ${warpStrength.toFixed(3)};
  float warpZ = (valueNoise(vec2(p.x * ${warpScale.toFixed(4)} + 67.2 - uTime * ${(warpDrift * 0.47).toFixed(4)}, p.y * ${warpScale.toFixed(4)} + 8.4 + uTime * ${warpDrift.toFixed(4)})) - 0.5) * ${warpStrength.toFixed(3)};
  vec2 q = p + vec2(warpX, warpZ);
  float h = 0.0;
${resolved.map((wave, index) => {
  const flat = (1 - envelopeDepth).toFixed(3);
  const depth = envelopeDepth.toFixed(3);
  const crestX = (-wave.dy).toFixed(6);
  const crestY = wave.dx.toFixed(6);
  return `  float phase${index} = ${wave.k.toFixed(6)} * (${wave.dx.toFixed(6)} * q.x + ${wave.dy.toFixed(6)} * q.y - uTime * ${wave.speed.toFixed(6)} + uFlow * ${wave.k.toFixed(6)} * ${flowPhaseGain.toFixed(2)});
  float envelope${index} = ${flat} + ${depth} * sin((${crestX} * q.x + ${crestY} * q.y) * ${wave.envelopeFreq.toFixed(4)} + ${wave.envelopePhase.toFixed(4)} + uTime * ${wave.envelopeDrift.toFixed(4)});
  float crest${index} = sin(phase${index}) + ${crestHarmonic.toFixed(3)} * sin(2.0 * phase${index} - ${crestSharpness.toFixed(3)});
  h += ${wave.amplitude.toFixed(6)} * envelope${index} * crest${index};`;
}).join('\n')}
  return h * uSea;
}
`;
