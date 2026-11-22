// Shared GLSL for the sky dome and the water surface. Both include the same
// sky function, so the reflection in the sea and the sky behind it always
// agree on colour and sun position.

export const SKY_GLSL = /* glsl */ `
uniform vec3 uSkyZenith;
uniform vec3 uSkyHorizon;
uniform vec3 uSunDir;
uniform vec3 uSunColor;

// The renderer keeps colour management on, so colours arrive linear and the
// raw ShaderMaterials have to encode sRGB themselves.
vec3 linearToSRGB(vec3 c) {
  vec3 lo = c * 12.92;
  vec3 hi = 1.055 * pow(max(c, vec3(0.0)), vec3(0.4166667)) - 0.055;
  return mix(lo, hi, step(vec3(0.0031308), c));
}

// The base gradient is also used by the water reflection. Keeping the sun
// disc out of that path stops the sea from growing a white mirror blob.
vec3 skyBase(vec3 d) {
  float h = d.y;
  float t = pow(clamp(1.0 - max(h, 0.0), 0.0, 1.0), 4.2);
  vec3 col = mix(uSkyZenith, uSkyHorizon, t);

  // A slightly deeper band right under the horizon keeps the sky from fading
  // into a flat white strip behind the water line.
  col = mix(col, uSkyHorizon * 0.94, smoothstep(0.0, -0.10, h));

  vec2 dAz = normalize(vec2(d.x, d.z) + vec2(1e-6, 0.0));
  vec2 sunAz = normalize(vec2(uSunDir.x, uSunDir.z) + vec2(1e-6, 0.0));
  float azimuth = pow(max(dot(dAz, sunAz), 0.0), 5.0);
  col += uSunColor * azimuth * smoothstep(0.34, 0.0, abs(h)) * 0.05;
  return col;
}

vec3 skyColor(vec3 d) {
  vec3 col = skyBase(d);
  float sd = max(dot(d, uSunDir), 0.0);

  // Broad daylight glow, a tight halo, then the disc itself.
  col += uSunColor * pow(sd, 8.0) * 0.05;
  col += uSunColor * pow(sd, 140.0) * 0.18;
  col += uSunColor * smoothstep(0.99980, 0.99990, sd) * 2.2;
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

// Value-noise gradient. The analytic derivative is cheaper and smoother than
// four extra height samples, which is what makes the fine ripple normals
// affordable at a stable frame rate.
export const NOISE_GLSL = `${VALUE_NOISE_GLSL}
vec2 valueNoiseGrad(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  vec2 du = 6.0 * f * (1.0 - f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  float k = a - b - c + d;
  return du * (vec2(b - a, c - a) + k * u.yx);
}

float fbm2(vec2 p) {
  return valueNoise(p) * 0.6 + valueNoise(p * 2.07 + 11.3) * 0.28 + valueNoise(p * 4.11 + 27.7) * 0.12;
}
`;
