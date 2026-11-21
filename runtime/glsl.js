// Shared GLSL: the day sky used both by the dome and by the water reflection, so
// the two can never drift apart.

export const SKY_GLSL = /* glsl */ `
uniform vec3 uSkyZenith;
uniform vec3 uSkyHorizon;
uniform vec3 uSunDir;
uniform vec3 uSunColor;

// The renderer keeps colour management on, so every colour here is linear and
// the shader has to hand sRGB back to the drawing buffer itself. Raw
// ShaderMaterials do not get three's output pass.
vec3 linearToSRGB(vec3 c) {
  vec3 lo = c * 12.92;
  vec3 hi = 1.055 * pow(max(c, vec3(0.0)), vec3(0.4166667)) - 0.055;
  return mix(lo, hi, step(vec3(0.0031308), c));
}

vec3 skyColor(vec3 d) {
  float h = d.y;
  float t = pow(clamp(1.0 - max(h, 0.0), 0.0, 1.0), 3.1);
  vec3 col = mix(uSkyZenith, uSkyHorizon, t);
  // below the water line the sky keeps the horizon tint; the ocean covers it,
  // this only matters for the reflection of steep wave faces
  col = mix(col, uSkyHorizon * 0.94, smoothstep(0.0, -0.10, h));

  float sd = max(dot(d, uSunDir), 0.0);
  // broad day glow, a tighter halo, then the disc itself
  col += uSunColor * pow(sd, 8.0) * 0.045;
  col += uSunColor * pow(sd, 140.0) * 0.20;
  col += uSunColor * smoothstep(0.99962, 0.99980, sd) * 3.0;
  return col;
}
`;

export const VALUE_NOISE_GLSL = /* glsl */ `
float hash21(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

`;

export const NOISE_GLSL = /* glsl */ `${VALUE_NOISE_GLSL}
float fbm2(vec2 p) {
  return valueNoise(p) * 0.6 + valueNoise(p * 2.07 + 11.3) * 0.28 + valueNoise(p * 4.11 + 27.7) * 0.12;
}
`;
