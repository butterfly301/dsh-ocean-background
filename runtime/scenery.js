import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { disposeObject3D } from './resources.js';
import {
  buildIslandSurfaceData,
  buildReefSurfaceData,
  chooseIslandArchetype,
  chooseReefArchetype,
} from './scenery-geometry.js';
import {
  islandNeedsPlacement,
  islandScale,
  islandZ,
  intrudesOnCamera,
  intrudesOnHull,
  isBehindView,
  REEF_CAMERA_CLEARANCE,
  REEF_HULL_HALF_DEPTH,
  recycleX,
  reefZ,
} from './scenery-layout.js';

// Everything here sits still in world space; the camera passes it with the ship.
// Scenery may appear in front of the hull as well as behind it, but every spawn
// keeps clear of the hull lane and of the camera's clearance bubble.

const ISLAND_SPAN = 300;
const ISLAND_COUNT = 3;
const REEF_SPAN = 260;
const REEF_COUNT = 4;

// A gull seen from the side: two swept wings and a small body, drawn once.
function makeBirdTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 80;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(64, 44);
  ctx.quadraticCurveTo(40, 18, 6, 24);
  ctx.quadraticCurveTo(34, 30, 56, 48);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(64, 44);
  ctx.quadraticCurveTo(88, 18, 122, 24);
  ctx.quadraticCurveTo(94, 30, 72, 48);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(64, 46, 9, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function surfaceGeometry(surface) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(surface.positions, 3));
  if (surface.colors?.length) {
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(surface.colors, 3));
  }
  geometry.setIndex(surface.indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function createScenery(scene, camera) {
  const cameraZ = () => (camera ? camera.position.z : 44);
  const group = new THREE.Group();
  group.name = 'scenery';
  const islands = [];
  const reefs = [];
  const birds = [];
  const palmSources = [];
  let disposed = false;

  const islandMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.94,
    flatShading: true,
  });
  const rockMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 1,
    flatShading: true,
  });
  const reefMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true,
    color: '#6f6d66',
    roughness: 1,
    flatShading: true,
  });
  const shrubMaterial = new THREE.MeshStandardMaterial({
    color: '#4f7a42',
    roughness: 0.95,
    flatShading: true,
  });
  const shrubGeometry = new THREE.IcosahedronGeometry(1, 0);
  const visibleIslandTypes = new Set();

  function applyIslandArchetype(entry, archetype, seed) {
    const { island, surface } = entry;
    for (const child of [...island.children]) {
      if (child === surface || child.name === 'island-coconut-palm') continue;
      island.remove(child);
      if (child.geometry && child.geometry !== shrubGeometry) child.geometry.dispose();
    }
    surface.geometry.dispose();
    const surfaceData = buildIslandSurfaceData(archetype, seed);
    surface.geometry = surfaceGeometry(surfaceData);
    surface.name = `island-surface-${archetype}`;
    entry.archetype = archetype;
    entry.surfaceData = surfaceData;
    entry.seed = seed;

    const shrubCount = Math.min(3, surfaceData.vegetation ?? 0);
    for (let shrubIndex = 0; shrubIndex < shrubCount; shrubIndex += 1) {
      const angle = 1.1 + shrubIndex * 2.05 + seed;
      const shrub = new THREE.Mesh(shrubGeometry, shrubMaterial);
      shrub.name = 'island-shrub';
      shrub.position.set(
        surfaceData.top.x + Math.cos(angle) * 1.2,
        surfaceData.top.y + 0.08,
        surfaceData.top.z + Math.sin(angle) * 0.9,
      );
      shrub.scale.set(0.55 + shrubIndex * 0.08, 0.34, 0.5);
      shrub.rotation.y = Math.random() * Math.PI;
      island.add(shrub);
    }

    if (archetype === 'rocky-island') {
      for (let rockIndex = 0; rockIndex < 2; rockIndex += 1) {
        const angle = rockIndex * Math.PI + 0.4;
        const rockData = buildReefSurfaceData('squat', rockIndex + seed);
        const rock = new THREE.Mesh(surfaceGeometry(rockData), rockMaterial);
        rock.name = 'island-reef-stone';
        rock.position.set(Math.cos(angle) * 6.2, 0.2, Math.sin(angle) * 4.2);
        rock.scale.set(0.7, 0.5, 0.72);
        island.add(rock);
      }
    }

    const palm = island.getObjectByName('island-coconut-palm');
    if (palm) {
      palm.position.set(surfaceData.palm.x, surfaceData.palm.y, surfaceData.palm.z);
      palm.scale.setScalar(surfaceData.palm.scale);
    }
  }

  for (let i = 0; i < ISLAND_COUNT; i += 1) {
    const island = new THREE.Group();
    island.name = `tropical-island-${i + 1}`;
    const archetype = chooseIslandArchetype(Math.random, visibleIslandTypes);
    visibleIslandTypes.add(archetype);
    island.position.set(ISLAND_SPAN * (-0.3 + i * 0.3), 0, islandZ({ cameraZ: cameraZ(), archetype }));
    island.scale.setScalar(islandScale());
    island.rotation.y = Math.random() * Math.PI * 2;

    const surface = new THREE.Mesh(new THREE.BufferGeometry(), islandMaterial);
    island.add(surface);
    const entry = { island, span: ISLAND_SPAN, surface, archetype, surfaceData: null, seed: 0 };
    applyIslandArchetype(entry, archetype, i * 1.71 + 0.8);
    group.add(island);
    islands.push(entry);
  }

  // Standalone reef stones: low, dark and clustered, a step nearer than islands.
  for (let i = 0; i < REEF_COUNT; i += 1) {
    const reef = new THREE.Group();
    reef.name = `reef-${i + 1}`;
    reef.position.set(REEF_SPAN * (-0.25 + i * 0.25), 0, reefZ(cameraZ()));
    const stones = 2 + Math.floor(Math.random() * 2);
    for (let stoneIndex = 0; stoneIndex < stones; stoneIndex += 1) {
      const archetype = chooseReefArchetype(Math.random);
      const stoneData = buildReefSurfaceData(archetype, i * 2.3 + stoneIndex);
      const stone = new THREE.Mesh(surfaceGeometry(stoneData), reefMaterial);
      stone.name = `reef-stone-${archetype}`;
      stone.position.set(
        (Math.random() - 0.5) * 5,
        0.12 + Math.random() * 0.25,
        (Math.random() - 0.5) * 3.2,
      );
      stone.scale.set(
        1.1 + Math.random() * 1.2,
        0.5 + Math.random() * 0.6,
        0.8 + Math.random() * 0.9,
      );
      stone.rotation.y = Math.random() * Math.PI;
      reef.add(stone);
    }
    group.add(reef);
    reefs.push({ reef, span: REEF_SPAN });
  }

  new GLTFLoader().load('./assets/coconut-palm.glb', (gltf) => {
    if (disposed) {
      disposeObject3D(gltf.scene);
      return;
    }
    palmSources.push(gltf.scene);
    for (const entry of islands) {
      const palm = gltf.scene.clone(true);
      palm.name = 'island-coconut-palm';
      palm.rotation.y = Math.random() * Math.PI * 2;
      palm.position.set(entry.surfaceData.palm.x, entry.surfaceData.palm.y, entry.surfaceData.palm.z);
      palm.scale.setScalar(entry.surfaceData.palm.scale);
      entry.island.add(palm);
    }
  }, undefined, (error) => {
    if (!disposed) console.warn('[ocean] coconut palm failed to load', error);
  });

  const birdTexture = makeBirdTexture();
  for (let i = 0; i < 5; i += 1) {
    const material = new THREE.MeshBasicMaterial({
      map: birdTexture,
      transparent: true,
      opacity: 0.55 + Math.random() * 0.25,
      depthWrite: false,
      color: new THREE.Color('#3f5560'),
      side: THREE.DoubleSide,
    });
    const size = 1.6 + Math.random() * 1.4;
    const bird = new THREE.Mesh(new THREE.PlaneGeometry(size, size * 0.62), material);
    bird.position.set(
      (Math.random() - 0.5) * 110,
      6 + Math.random() * 6,
      -18 - Math.random() * 55,
    );
    bird.frustumCulled = false;
    group.add(bird);
    birds.push({
      bird,
      speed: 2.4 + Math.random() * 2.2,
      phase: Math.random() * 6.28,
      flap: 1.4 + Math.random() * 1.2,
    });
  }

  scene.add(group);

  function recycleIsland(entry, cameraX) {
    const island = entry.island;
    island.position.x = recycleX(cameraX, entry.span);
    island.scale.setScalar(islandScale());
    island.rotation.y = Math.random() * Math.PI * 2;
    const otherTypes = new Set(
      islands.filter(other => other !== entry).map(other => other.archetype),
    );
    const archetype = chooseIslandArchetype(Math.random, otherTypes);
    applyIslandArchetype(entry, archetype, Math.random() * 1000);
    island.position.z = islandZ({ cameraZ: cameraZ(), archetype });
    const palm = island.getObjectByName('island-coconut-palm');
    if (palm) palm.rotation.y = Math.random() * Math.PI * 2;
  }

  return {
    update(dt, time, cameraX = 0) {
      const lensZ = cameraZ();
      for (const entry of islands) {
        const z = entry.island.position.z;
        if (islandNeedsPlacement({ z, cameraZ: lensZ, archetype: entry.archetype })) {
          entry.island.position.z = islandZ({ cameraZ: lensZ, archetype: entry.archetype });
        }
        if (isBehindView(entry.island.position.x, cameraX, entry.span)) recycleIsland(entry, cameraX);
      }
      for (const entry of reefs) {
        const z = entry.reef.position.z;
        if (intrudesOnCamera(z, lensZ, REEF_CAMERA_CLEARANCE) || intrudesOnHull(z, REEF_HULL_HALF_DEPTH)) {
          entry.reef.position.z = reefZ(lensZ);
        }
        if (isBehindView(entry.reef.position.x, cameraX, entry.span)) {
          entry.reef.position.x = recycleX(cameraX, entry.span);
          entry.reef.position.z = reefZ(lensZ);
        }
      }
      for (const item of birds) {
        item.bird.position.x -= item.speed * dt;
        item.bird.position.y += Math.sin(time * 1.7 + item.phase) * dt * 0.25;
        item.bird.rotation.y = 0;
        item.bird.scale.y = 1 - 0.18 * Math.abs(Math.sin(time * item.flap + item.phase));
        if (item.bird.position.x < cameraX - 66) {
          item.bird.position.x = cameraX + 66;
          item.bird.position.y = 6 + Math.random() * 6;
          item.bird.position.z = -18 - Math.random() * 55;
        }
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      scene.remove(group);
      disposeObject3D(group, ...palmSources);
    },
  };
}
