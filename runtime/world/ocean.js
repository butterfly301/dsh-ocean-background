import * as THREE from 'three';
import { SKY_GLSL, NOISE_GLSL } from './glsl.js';
import { OCEAN_WAVE_GLSL } from './wave-glsl.js';



const vertexShader =  `
uniform float uWorldOffset;

varying vec3 vWorld;
varying vec3 vNormalW;
varying float vHeight;

${OCEAN_WAVE_GLSL}

void main() {
  vec3 pos = position;
  vec2 waveUv = pos.xz + vec2(uWorldOffset, 0.0);
  float h = waveHeight(waveUv);



  float e = 0.55;
  float hx = waveHeight(waveUv + vec2(e, 0.0));
  float hz = waveHeight(waveUv + vec2(0.0, e));
  vec3 n = normalize(vec3(h - hx, e, h - hz));

  pos.y += h;

  vec4 world = modelMatrix * vec4(pos, 1.0);
  vWorld = world.xyz;
  vNormalW = normalize(mat3(modelMatrix) * n);
  vHeight = h;

  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const fragmentShader =  `
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
  float eyeDistance = length(cameraPosition - vWorld);



  vec2 windDir = normalize(vec2(0.86, 0.51));
  vec2 crossDir = vec2(-windDir.y, windDir.x);
  float alongWind = dot(vWorld.xz, windDir);
  float acrossWind = dot(vWorld.xz, crossDir);



  float fineFade = 1.0 - smoothstep(120.0, 520.0, eyeDistance);
  vec2 g1 = valueNoiseGrad(vec2(alongWind * 0.060 + uTime * 0.040, acrossWind * 0.140 - uTime * 0.018));
  vec2 g2 = valueNoiseGrad(vec2(alongWind * 0.240 + uTime * 0.110, acrossWind * 0.550 - uTime * 0.060) + 13.7);
  vec2 g3 = valueNoiseGrad(vec2(alongWind * 0.900 + uTime * 0.340, acrossWind * 1.900 - uTime * 0.190) + 41.2);
  vec2 rippleGrad = (g1 * 0.45 + g2 * 0.18 * fineFade + g3 * 0.04 * fineFade) * 0.55;
  vec2 rippleWorld = windDir * rippleGrad.x + crossDir * rippleGrad.y;
  vec3 n = normalize(vNormalW + vec3(-rippleWorld.x, 0.0, -rippleWorld.y));




  float relativeHeight = vHeight / max(uSea, 0.25);
  float crest = smoothstep(-0.9, 0.90, relativeHeight);
  vec3 body = mix(uDeep, uShallow, 0.24 + crest * 0.64);
  body = mix(body, mix(uShallow, uFoamColor, 0.15), smoothstep(0.70, 1.05, relativeHeight) * 0.20);

  float broadDepth = fbm2(vWorld.xz * 0.0045 + vec2(uFlow * 0.0008, -uTime * 0.0006));
  body = mix(body, uDeep * 1.55, smoothstep(0.38, 0.72, broadDepth) * 0.10);
  float shoal = fbm2(vWorld.xz * 0.0120 + 31.7 + vec2(-uFlow * 0.0020, uTime * 0.0010));
  body = mix(body, uShallow * 1.05, smoothstep(0.55, 0.82, shoal) * 0.36);


  float streak = fbm2(vec2(alongWind * 0.035 + uFlow * 0.006, acrossWind * 0.220 - uTime * 0.012));
  body *= 0.86 + streak * 0.16;
  float streakFine = fbm2(vec2(alongWind * 0.120 + uFlow * 0.020, acrossWind * 0.750 - uTime * 0.040));
  body *= 0.94 + streakFine * 0.08;
  float micro = fbm2(vec2(alongWind * 0.520 + uFlow * 0.080, acrossWind * 2.600 - uTime * 0.160));
  body *= 0.97 + micro * 0.05 * fineFade;




  vec3 lightDir = normalize(vec3(-0.50, 0.55, 0.72));
  vec3 swellNormal = normalize(vNormalW);
  float swellLight = max(dot(swellNormal, lightDir), 0.0);
  body *= 0.80 + swellLight * 0.44;
  float facet = max(dot(n, lightDir), 0.0);
  body *= 0.88 + facet * 0.22;
  body *= 1.00;
  float depthAir = smoothstep(0.0, 560.0, eyeDistance);
  body = mix(body * 0.94, body * 1.06, depthAir);



  float sunBehind = max(dot(-viewDir, uSunDir), 0.0);
  body += uShallow * uSunColor * pow(sunBehind, 3.0) * crest * 0.16;




  vec3 refl = reflect(-viewDir, n);
  refl.y = abs(refl.y) + 0.015;
  float facing = clamp(dot(n, viewDir), 0.0, 1.0);
  float fresnel = min(0.02 + 0.24 * pow(1.0 - facing, 5.0), 0.12);
  vec3 reflection = mix(skyBase(refl) * vec3(0.72, 0.88, 1.0), uShallow * 1.25 + uDeep * 0.20, 0.62);
  vec3 col = mix(body, reflection, fresnel);



  vec3 halfDir = normalize(uSunDir + viewDir);
  float broadSheen = pow(max(dot(n, halfDir), 0.0), 10.0) * 0.10;
  col += uShallow * broadSheen;





  float swellSlope = length(swellNormal.xz);
  float crestMask = smoothstep(0.55, 1.10, relativeHeight);
  float breakMask = smoothstep(0.08, 0.22, swellSlope);
  float foamPatch = smoothstep(0.54, 0.78, fbm2(vec2(alongWind * 0.090 + uFlow * 0.050, acrossWind * 0.140 - uTime * 0.025)));
  float lace = smoothstep(0.44, 0.72, fbm2(vWorld.xz * 1.6 + vec2(uFlow * 0.16, -uTime * 0.12)));
  float foam = crestMask * breakMask * foamPatch * (0.35 + lace * 0.75);
  float foamAmount = clamp(foam * uFoam * 0.30, 0.0, 0.18);
  col = mix(col, mix(uShallow, uFoamColor, 0.65), foamAmount);


  if (uShadow > 0.001) {
    vec2 d = (vWorld.xz - uShipPos.xz) * vec2(1.0, 2.0);
    float hull = smoothstep(1.0, 0.12, length(d) / max(5.2, uSea * 2.6));
    col *= 1.0 - hull * 0.28 * uShadow;
  }




  if (uWake > 0.001) {
    vec2 rel = vWorld.xz - uShipPos.xz;
    float lateral = abs(rel.y);
    float bowX = 3.6;
    float sternX = -3.8;
    float aft = bowX - rel.x;

    float collarNoise = fbm2(vec2(vWorld.x * 0.9, vWorld.z * 1.4) + vec2(uFlow * 0.2, uTime * 0.04));
    float collarDistance = length(vec2(rel.x - (bowX - 0.6), lateral * 0.85));
    float collar = (1.0 - smoothstep(0.15, 1.7, collarDistance))
      * (1.0 - smoothstep(bowX - 0.2, bowX + 0.5, rel.x))
      * (0.45 + 0.55 * smoothstep(0.30, 0.75, collarNoise));
    col = mix(col, uFoamColor, clamp(collar * 0.42 * uWake, 0.0, 0.36));

    float arm = abs(lateral - max(aft, 0.0) * 0.42);
    float armNoise = smoothstep(0.35, 0.72, fbm2(vWorld.xz * 1.1 + vec2(uFlow * 0.30, 0.0)));
    float arms = (1.0 - smoothstep(0.15, 1.10, arm))
      * smoothstep(1.2, 4.0, aft)
      * exp(-aft * 0.025)
      * (0.30 + armNoise * 0.70);
    col = mix(col, mix(uShallow, uFoamColor, 0.60), clamp(arms * 0.50 * uWake, 0.0, 0.35));

    float behindStern = sternX - rel.x;
    float width = 1.05 + max(behindStern, 0.0) * 0.32;
    float chop = fbm2(vec2(vWorld.x * 0.55, vWorld.z * 1.15) + vec2(uFlow * 0.20, uTime * 0.03));
    float trail = (1.0 - smoothstep(width * 0.35, width, lateral))
      * smoothstep(-0.3, 1.2, behindStern)
      * exp(-max(behindStern, 0.0) * 0.045)
      * (0.35 + 0.65 * smoothstep(0.22, 0.80, chop + 0.34));
    col = mix(col, uFoamColor, clamp(trail * 0.55 * uWake, 0.0, 0.55));
  }




  float hazeT = smoothstep(150.0, 620.0, eyeDistance);
  vec3 hazeDir = normalize(vec3(-viewDir.x, 0.012, -viewDir.z));
  vec3 hazeCol = skyBase(hazeDir);
  col = mix(col, hazeCol, hazeT * 0.96);

  col *= 0.95;
  gl_FragColor = vec4(linearToSRGB(col), 1.0);
}
`;

export function createOcean(uniforms, { size = 1200, segments = 300 } = {}) {
  const buildGeometry = (nextSegments) => {
    const geometry = new THREE.PlaneGeometry(size, size, nextSegments, nextSegments);
    geometry.rotateX(-Math.PI / 2);
    return geometry;
  };

  const geometry = buildGeometry(segments);
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    side: THREE.FrontSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.name = 'ocean';
  mesh.setSegments = (nextSegments) => {
    const target = Math.max(32, Math.floor(nextSegments));
    if (!Number.isFinite(target) || target === mesh.geometry.parameters?.widthSegments) return;
    const previous = mesh.geometry;
    mesh.geometry = buildGeometry(target);
    previous.dispose();
  };
  return mesh;
}

