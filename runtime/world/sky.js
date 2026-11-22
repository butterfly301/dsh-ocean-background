import * as THREE from 'three';
import { SKY_GLSL, NOISE_GLSL } from './glsl.js';

const vertexShader =  `
varying vec3 vDir;

void main() {
  vDir = normalize(position);
  vec4 world = modelMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const fragmentShader =  `
uniform float uTime;
uniform float uCloud;

varying vec3 vDir;

${SKY_GLSL}
${NOISE_GLSL}

void main() {
  vec3 d = normalize(vDir);
  vec3 col = skyColor(d);

  float band = smoothstep(0.015, 0.10, d.y) * smoothstep(0.82, 0.30, d.y);
  if (band > 0.001) {
    vec2 proj = d.xz / (d.y + 0.16);
    vec2 drift = vec2(uTime * 0.0035, uTime * 0.0012);
    float broad = fbm2(proj * vec2(0.026, 0.075) + drift);
    float detail = fbm2(proj * vec2(0.070, 0.185) + drift * 1.5 + 5.0);
    float mass = broad * 0.72 + detail * 0.38;

    float cloud = smoothstep(0.40, 0.68, mass) * band * uCloud;
    float lit = smoothstep(0.44, 0.90, mass);
    vec3 cloudCol = mix(uSkyHorizon * 0.86, uSunColor * 1.02, lit * 0.76);
    col = mix(col, cloudCol, cloud * 0.70);
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
