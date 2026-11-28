import * as THREE from 'three';

const RAIN_MAX = 900;
const RAIN_BALANCED = 450;
const SNOW_MAX = 750;
const SNOW_BALANCED = 350;

const SPAN_X = 76;
const SPAN_Y = 30;
const SPAN_Z = 56;
const MIN_Y = -2;

function makeSnowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const grad = ctx.createRadialGradient(16, 16, 1, 16, 16, 15);
    grad.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
    grad.addColorStop(0.55, 'rgba(236, 245, 255, 0.55)');
    grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 32, 32);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createWeatherEffects(scene, { random = Math.random } = {}) {
  const group = new THREE.Group();
  group.name = 'weather-precipitation';
  scene.add(group);

  const rainPositions = new Float32Array(RAIN_MAX * 6);
  const rainSeeds = new Float32Array(RAIN_MAX * 3);
  for (let i = 0; i < RAIN_MAX; i += 1) {
    const x = (random() - 0.5) * SPAN_X;
    const y = MIN_Y + random() * SPAN_Y;
    const z = (random() - 0.5) * SPAN_Z;
    rainSeeds[i * 3] = x;
    rainSeeds[i * 3 + 1] = y;
    rainSeeds[i * 3 + 2] = z;
    rainPositions[i * 6] = x;
    rainPositions[i * 6 + 1] = y;
    rainPositions[i * 6 + 2] = z;
    rainPositions[i * 6 + 3] = x + 0.14;
    rainPositions[i * 6 + 4] = y + 0.95;
    rainPositions[i * 6 + 5] = z;
  }
  const rainGeo = new THREE.BufferGeometry();
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPositions, 3));
  const rainMat = new THREE.LineBasicMaterial({
    color: 0xc8dff0,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
  });
  const rainMesh = new THREE.LineSegments(rainGeo, rainMat);
  rainMesh.frustumCulled = false;
  rainMesh.visible = false;
  group.add(rainMesh);

  const snowPositions = new Float32Array(SNOW_MAX * 3);
  const snowPhase = new Float32Array(SNOW_MAX);
  for (let i = 0; i < SNOW_MAX; i += 1) {
    snowPositions[i * 3] = (random() - 0.5) * SPAN_X;
    snowPositions[i * 3 + 1] = MIN_Y + random() * SPAN_Y;
    snowPositions[i * 3 + 2] = (random() - 0.5) * SPAN_Z;
    snowPhase[i] = random() * Math.PI * 2;
  }
  const snowGeo = new THREE.BufferGeometry();
  snowGeo.setAttribute('position', new THREE.BufferAttribute(snowPositions, 3));
  const snowTex = makeSnowTexture();
  const snowMat = new THREE.PointsMaterial({
    map: snowTex,
    size: 0.45,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
  });
  const snowMesh = new THREE.Points(snowGeo, snowMat);
  snowMesh.frustumCulled = false;
  snowMesh.visible = false;
  group.add(snowMesh);

  function update(dt, { weather = 'clear', quality = 'balanced', motion = true, cameraX = 0, time = 0 } = {}) {
    group.position.set(cameraX, 0, 12);
    if (!motion || (weather !== 'rain' && weather !== 'snow')) {
      rainMesh.visible = false;
      snowMesh.visible = false;
      return;
    }

    if (weather === 'rain') {
      snowMesh.visible = false;
      rainMesh.visible = true;
      const count = quality === 'high' ? RAIN_MAX : RAIN_BALANCED;
      rainGeo.setDrawRange(0, count * 2);
      const attr = rainGeo.getAttribute('position');
      const arr = attr.array;
      const dx = 3.8 * dt;
      const dy = -29 * dt;
      for (let i = 0; i < count; i += 1) {
        let x = rainSeeds[i * 3] + dx;
        let y = rainSeeds[i * 3 + 1] + dy;
        const z = rainSeeds[i * 3 + 2];
        if (y < MIN_Y) {
          y += SPAN_Y;
          x = (random() - 0.5) * SPAN_X;
        }
        if (x > SPAN_X * 0.5) x -= SPAN_X;
        rainSeeds[i * 3] = x;
        rainSeeds[i * 3 + 1] = y;
        arr[i * 6] = x;
        arr[i * 6 + 1] = y;
        arr[i * 6 + 2] = z;
        arr[i * 6 + 3] = x + 0.14;
        arr[i * 6 + 4] = y + 0.95;
        arr[i * 6 + 5] = z;
      }
      attr.needsUpdate = true;
      return;
    }

    rainMesh.visible = false;
    snowMesh.visible = true;
    const count = quality === 'high' ? SNOW_MAX : SNOW_BALANCED;
    snowGeo.setDrawRange(0, count);
    const attr = snowGeo.getAttribute('position');
    const arr = attr.array;
    const dy = -4.2 * dt;
    for (let i = 0; i < count; i += 1) {
      let x = arr[i * 3] + Math.sin(time * 1.4 + snowPhase[i]) * 1.3 * dt;
      let y = arr[i * 3 + 1] + dy;
      if (y < MIN_Y) {
        y += SPAN_Y;
        x = (random() - 0.5) * SPAN_X;
      }
      arr[i * 3] = x;
      arr[i * 3 + 1] = y;
    }
    attr.needsUpdate = true;
  }

  function dispose() {
    rainGeo.dispose();
    rainMat.dispose();
    snowGeo.dispose();
    snowMat.dispose();
    snowTex.dispose();
    scene.remove(group);
  }

  return { update, dispose };
}
