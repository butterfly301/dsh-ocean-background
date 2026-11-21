import * as THREE from 'three';
import { SKY_GLSL, NOISE_GLSL } from './glsl.js';

// A dome with the shared day sky plus a thin, high cirrus layer. It is drawn
// first and writes no depth, so the sea and the ship always sit in front of it.
const vertexShader = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 world = modelMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const fragmentShader = /* glsl */ `
uniform float uTime;
uniform float uCloud;

varying vec3 vDir;

${SKY_GLSL}
${NOISE_GLSL}

void main() {
  vec3 d = normalize(vDir);
  vec3 col = skyColor(d);

  // Cirrus: stretched noise projected on the dome, only above the horizon.
  float band = smoothstep(0.02, 0.12, d.y) * smoothstep(0.95, 0.55, d.y);
  if (band > 0.001) {
    vec2 proj = d.xz / (d.y + 0.22);
    vec2 drift = vec2(uTime * 0.0035, uTime * 0.0012);
    float w = fbm2(proj * vec2(0.032, 0.085) + drift);
    float w2 = fbm2(proj * vec2(0.075, 0.19) + drift * 1.5 + 5.0);
    float mass = w * 0.76 + w2 * 0.34;
    // Soft banks: a wide threshold so the cloud edge stays feathered, and a
    // brighter crown where the sun sits behind it.
    float cloud = smoothstep(0.36, 0.72, mass) * band * uCloud;
    float lit = smoothstep(0.42, 0.95, mass);
    // Cooler than the sky so the banks read as shape, warmer where the sun is
    // behind them, and never darker than a thin overcast.
    vec3 cloudCol = mix(vec3(0.52, 0.61, 0.71), uSunColor * 1.02, lit * 0.9);
    col = mix(col, cloudCol, cloud * 0.85);
  }

  gl_FragColor = vec4(linearToSRGB(col), 1.0);
}
`;

export function createSky(uniforms) {
  const geometry = new THREE.SphereGeometry(1200, 40, 24);
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    side: THREE.BackSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  mesh.name = 'sky';
  return mesh;
}
