import * as THREE from 'three';
import { createWindLine, smoothstep } from './wind-motion.js';
import { disposeObject3D } from './resources.js';

// Every ribbon extends past both screen edges. Widths are CSS pixels, including
// soft edges, so wide windows and camera distance cannot turn them into hairlines.
const LAYERS = [
  { depth: 9, count: 1, widthPx: [6, 8], band: [-0.75, 0.10], delay: [0, 0], opacity: [0.62, 0.78], foreground: true },
  { depth: 34, count: 1, widthPx: [4, 6], band: [-0.25, 0.20], delay: [1.2, 2.4], opacity: [0.40, 0.54], foreground: false },
];
const STEPS = 32;
const SEA_COLOR = new THREE.Color('#e2f0ed');
const SKY_COLOR = new THREE.Color('#567f90');
const pick = ([min, max]) => min + Math.random() * (max - min);

function makeStreakTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 32;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(canvas.width, canvas.height);
  for (let y = 0; y < canvas.height; y += 1) {
    const across = Math.abs(((y + 0.5) / canvas.height) * 2 - 1);
    const softness = 1 - smoothstep(0.72, 1, across);
    for (let x = 0; x < canvas.width; x += 1) {
      const u = (x + 0.5) / canvas.width;
      // Fade only outside the visible viewport. Both screen edges retain the
      // line's full body instead of exposing tapered ends within the picture.
      const ends = smoothstep(0, 0.06, u) * (1 - smoothstep(0.94, 1, u));
      const offset = (y * canvas.width + x) * 4;
      img.data[offset] = 255;
      img.data[offset + 1] = 255;
      img.data[offset + 2] = 255;
      img.data[offset + 3] = Math.round(255 * softness * ends);
    }
  }
  ctx.putImageData(img, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeRibbon() {
  const geometry = new THREE.BufferGeometry();
  const positions = new THREE.BufferAttribute(new Float32Array((STEPS + 1) * 6), 3);
  positions.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', positions);
  const uvs = new Float32Array((STEPS + 1) * 4);
  const indices = [];
  for (let i = 0; i <= STEPS; i += 1) {
    const t = i / STEPS;
    uvs.set([t, 0, t, 1], i * 4);
    if (i < STEPS) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}

// The endpoints and middle deform at different times during each gust.
// Horizontal coordinates remain outside both edges throughout its lifetime.
function shapeRibbon(geometry, points, halfHeight, aspect, widthPx, viewportHeight) {
  const position = geometry.getAttribute('position');
  const halfWidth = halfHeight * aspect;
  const thickness = (widthPx * halfHeight) / Math.max(1, viewportHeight);
  for (let i = 0; i <= STEPS; i += 1) {
    const prev = Math.max(0, i - 1) * 2;
    const next = Math.min(STEPS, i + 1) * 2;
    const dx = (points[next] - points[prev]) * halfWidth;
    const dy = (points[next + 1] - points[prev + 1]) * halfHeight;
    const tangentLength = Math.max(0.0001, Math.hypot(dx, dy));
    const ox = (-dy / tangentLength) * thickness;
    const oy = (dx / tangentLength) * thickness;
    const x = points[i * 2] * halfWidth;
    const y = points[i * 2 + 1] * halfHeight;
    position.setXYZ(i * 2, x - ox, y - oy, 0);
    position.setXYZ(i * 2 + 1, x + ox, y + oy, 0);
  }
  position.needsUpdate = true;
}

export function createWind(camera) {
  const group = new THREE.Group();
  group.name = 'wind';
  camera.add(group);
  const texture = makeStreakTexture();
  const streaks = [];
  let disposed = false;

  function place(streak, sample) {
    const { layer, mesh } = streak;
    mesh.visible = sample.visible;
    if (!sample.visible) return;
    const halfHeight = layer.depth * Math.tan((camera.fov * Math.PI) / 360) / camera.zoom;
    shapeRibbon(mesh.geometry, sample.points, halfHeight, camera.aspect, streak.widthPx, window.innerHeight);
    const horizon = -Math.tan(camera.rotation.x) / Math.tan((camera.fov * Math.PI) / 360) * camera.zoom;
    const sky = smoothstep(horizon - 0.14, horizon + 0.14, sample.centerY);
    mesh.material.color.copy(SEA_COLOR).lerp(SKY_COLOR, sky);
    mesh.material.opacity = streak.opacity * sample.opacity;
  }

  for (const layer of LAYERS) {
    for (let i = 0; i < layer.count; i += 1) {
      const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        depthTest: !layer.foreground,
        side: THREE.DoubleSide,
        fog: false,
      });
      const mesh = new THREE.Mesh(makeRibbon(), material);
      mesh.position.z = -layer.depth;
      mesh.frustumCulled = false;
      mesh.renderOrder = layer.foreground ? 20 : 0;
      group.add(mesh);
      const motion = createWindLine({ band: layer.band, startDelay: pick(layer.delay), pointCount: STEPS + 1 });
      const streak = { layer, mesh, motion, widthPx: pick(layer.widthPx), opacity: pick(layer.opacity) };
      place(streak, motion.advance(0));
      streaks.push(streak);
    }
  }

  return {
    update(dt) {
      if (disposed) return;
      for (const streak of streaks) place(streak, streak.motion.advance(dt));
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      camera.remove(group);
      disposeObject3D(group);
    },
  };
}
