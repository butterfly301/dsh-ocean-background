import * as THREE from 'three';
import { SKY_GLSL, NOISE_GLSL } from './glsl.js';
import { waveFieldCode, WAVE_VERTEX_NOISE_GLSL } from './wave-field.js';
export { waveHeightAt, waveSlopeAt, waveWarpAt } from './wave-field.js';

const vertexShader = /* glsl */ `
uniform float uTime;
uniform float uSea;
uniform float uFlow;
uniform float uWorldOffset;

varying vec3 vWorld;
varying vec3 vNormalW;
varying float vHeight;

${WAVE_VERTEX_NOISE_GLSL}

float waveHeight(vec2 p) {
  float h = 0.0;
${waveFieldCode()}
  return h * uSea;
}

void main() {
  vec3 pos = position;
  vec2 xz = pos.xz + vec2(uWorldOffset, 0.0);
  float h = waveHeight(xz);

  // Finite-difference normal: the field is smooth, so two samples 0.55 units out
  // give a normal that is stable and cheap. Fine ripple detail is added in the
  // fragment shader where it belongs.
  float e = 0.55;
  float hx = waveHeight(xz + vec2(e, 0.0));
  float hz = waveHeight(xz + vec2(0.0, e));
  vec3 n = normalize(vec3(h - hx, e, h - hz));

  pos.y += h;

  vec4 world = modelMatrix * vec4(pos, 1.0);
  vWorld = world.xyz;
  vNormalW = normalize(mat3(modelMatrix) * n);
  vHeight = h;

  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const fragmentShader = /* glsl */ `
uniform float uTime;
uniform float uFlow;
uniform float uSea;
uniform float uFoam;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uFoamColor;
uniform vec3 uShipPos;
uniform float uShadow;
uniform float uWake;

varying vec3 vWorld;
varying vec3 vNormalW;
varying float vHeight;

${SKY_GLSL}
${NOISE_GLSL}

void main() {
  vec3 viewDir = normalize(cameraPosition - vWorld);

  // Wind-aligned detail stretches into short chop instead of a square noise grid.
  // With only long swells in the vertex displacement, this layer carries the
  // texture that makes the surface read as water rather than rolling hills.
  vec2 windDir = vec2(0.86, 0.51);
  vec2 crossDir = vec2(-windDir.y, windDir.x);
  float alongWind = dot(vWorld.xz, windDir);
  float acrossWind = dot(vWorld.xz, crossDir);
  vec2 broadChop = vec2(alongWind * 0.095 + uTime * 0.05, acrossWind * 0.045 - uTime * 0.018);
  vec2 fineChop = vec2(alongWind * 0.28 - uTime * 0.12, acrossWind * 0.14 + uTime * 0.03);
  vec2 microChop = vec2(alongWind * 0.9 + uTime * 0.28, acrossWind * 0.65 - uTime * 0.16);
  float d1 = fbm2(broadChop);
  float d2 = fbm2(fineChop + 13.7);
  float d3 = fbm2(microChop + 41.2);
  vec3 n = normalize(vNormalW
    + vec3((d1 - 0.5) * 0.11 + (d2 - 0.5) * 0.055 + (d3 - 0.5) * 0.02, 0.0,
      (d2 - 0.5) * 0.065 + (d3 - 0.5) * 0.028));

  float fres = pow(1.0 - clamp(dot(n, viewDir), 0.0, 1.0), 5.0);
  fres = mix(0.02, 0.38, clamp(fres, 0.0, 1.0));

  // Height changes the blue-green tint, with a bounded shallow-water blend.
  // Broad swells keep their water colour instead of receiving a pale crest coat.
  float relativeHeight = vHeight / max(uSea, 0.2);
  float lift = mix(0.18, 0.62, smoothstep(-2.0, 2.6, relativeHeight));
  vec3 body = mix(uDeep, uShallow, lift);
  float scatter = pow(max(dot(n, uSunDir), 0.0), 2.2) * smoothstep(0.3, 2.4, relativeHeight);
  body += uShallow * scatter * 0.10;

  vec3 refl = reflect(-viewDir, n);
  refl.y = abs(refl.y);
  vec3 sky = skyColor(refl);
  vec3 col = mix(body, sky, fres);

  // Sun glitter belongs on the path between the eye and the sun, not everywhere;
  // the flat-direction test and a sparkle mask are what keep it from reading as
  // a field of white flakes.
  vec3 sunFlat = normalize(vec3(uSunDir.x, 0.0, uSunDir.z));
  vec3 reflFlat = normalize(vec3(refl.x, 0.0, refl.z));
  float path = pow(max(dot(reflFlat, sunFlat), 0.0), 9.0);
  float sparkle = fbm2(vWorld.xz * 7.5 + vec2(uFlow * 0.35, uTime * 0.2));
  float glint = pow(max(dot(refl, uSunDir), 0.0), 380.0);
  col += uSunColor * glint * path * smoothstep(0.46, 0.9, sparkle) * 3.2;
  col += uSunColor * pow(max(dot(refl, uSunDir), 0.0), 30.0) * path * 0.05;

  // Throughput permits whitecaps; crest height, actual swell slope and two
  // multiplicative patch masks decide where sparse fragments can appear.
  // Fine normal-map ripples never trigger foam on their own.
  if (uFoam > 0.001) {
    vec3 swellNormal = normalize(vNormalW);
    float slope = length(swellNormal.xz) / max(swellNormal.y, 0.2);
    float crestMask = smoothstep(1.0, 2.6, relativeHeight);
    float breakingMask = smoothstep(0.095, 0.23, slope);
    vec2 patchUv = vec2(alongWind * 0.045 + uFlow * 0.018, acrossWind * 0.07 - uTime * 0.012);
    float patches = smoothstep(0.62, 0.79, fbm2(patchUv));
    float fragments = smoothstep(0.48, 0.74, fbm2(vWorld.xz * 0.65 + vec2(uFlow * 0.04, -uTime * 0.025)));
    float foam = crestMask * breakingMask * patches * fragments * uFoam;
    vec3 whitecapColor = mix(uShallow, uFoamColor, 0.72);
    col = mix(col, whitecapColor, clamp(foam * 0.34, 0.0, 0.34));
  }

  // Soft shadow the hull throws on the water. It is the cheapest cue that the
  // ship is sitting in the sea rather than floating on top of the picture.
  if (uShadow > 0.001) {
    vec2 d = (vWorld.xz - uShipPos.xz) * vec2(1.0, 1.8);
    float hull = smoothstep(1.0, 0.15, length(d) / max(6.0, uSea * 3.0));
    col *= 1.0 - hull * 0.26 * uShadow;
  }

  // Wake: a wedge of broken water trailing the hull plus a band of foam where
  // the hull meets the surface. Both are anchored to the ship, which is the
  // one thing on the water that does not move in world space.
  if (uWake > 0.001) {
    vec2 rel = vWorld.xz - uShipPos.xz;
    float behind = -rel.x - 4.6;
    float lateral = abs(rel.y);
    if (behind > -1.0) {
      float width = 1.2 + max(behind, 0.0) * 0.3;
      float core = smoothstep(width, width * 0.35, lateral);
      float decay = exp(-max(behind, 0.0) * 0.055);
      float chop = fbm2(vec2(vWorld.x * 0.55, vWorld.z * 1.1) + vec2(uFlow * 0.2, 0.0));
      float trail = core * decay * smoothstep(0.35, 0.85, chop + 0.35) * uWake;
      col = mix(col, uFoamColor, clamp(trail, 0.0, 0.75));
    }
    // Contact foam along the waterline: an ellipse a touch wider than the hull.
    float hullDist = length(rel * vec2(0.6, 1.72));
    float ring = smoothstep(4.0, 2.3, hullDist) * smoothstep(1.7, 2.6, hullDist);
    float burble = smoothstep(0.35, 0.75, fbm2(vWorld.xz * 1.4 + vec2(uFlow * 0.3, 0.0)));
    // Broken water, not a collar: the ring is thinned and carried by the noise.
    col = mix(col, uFoamColor, clamp(ring * (0.10 + burble * 0.42) * uWake, 0.0, 0.42));
  }

  // Distance haze into the horizon tint: this hides the edge of the water plane.
  float dist = length(cameraPosition - vWorld);
  // Aerial perspective: the far water keeps a little of its own colour instead of
  // turning into the sky, which is what separates sea from haze in the frame.
  vec3 haze = mix(uSkyHorizon, uDeep * 1.35 + uSkyHorizon * 0.28, 0.42);
  col = mix(col, haze, smoothstep(150.0, 760.0, dist) * 0.86);

  gl_FragColor = vec4(linearToSRGB(col), 1.0);
}
`;

export function createOcean(uniforms, geometryOptions = {}) {
  const geometry = new THREE.PlaneGeometry(
    geometryOptions.size ?? 900,
    geometryOptions.size ?? 900,
    geometryOptions.segments ?? 220,
    geometryOptions.segments ?? 220,
  );
  geometry.rotateX(-Math.PI / 2);

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    side: THREE.FrontSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.name = 'ocean';
  return mesh;
}
