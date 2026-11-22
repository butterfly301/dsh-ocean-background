import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { disposeObject3D } from './resources.js';
import { buildIslandSurfaceData, chooseIslandArchetype } from './scenery-geometry.js';
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
import { createRockLibrary } from './rock-assets.js';

const ISLAND_SPAN = 300;
const ISLAND_COUNT = 3;
const REEF_SPAN = 260;
const REEF_COUNT = 4;
const ROCKY_ISLAND = 'rocky-island';
const PALM_NAME = 'island-coconut-palm';
const TAU = Math.PI * 2;

// Rotations derived from the layout seed instead of the shared random stream,
// so asynchronous asset loads cannot change the outcome of a replay.
function hashUnit(a, b) {
  let hash = 2166136261 ^ (Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263));
  hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
  return ((hash ^ (hash >>> 16)) >>> 0) / 4294967296;
}

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
  ctx.ellipse(64, 46, 9, 7, 0, 0, TAU);
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

export function createScenery(scene, camera, { random = Math.random } = {}) {
  const cameraZ = () => (camera ? camera.position.z : 44);
  const group = new THREE.Group();
  group.name = 'scenery';
  const islands = [];
  const reefs = [];
  const birds = [];
  const palmSources = [];
  let disposed = false;

  const rocks = createRockLibrary();

  const islandMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.94,
    flatShading: true,
  });
  const shrubMaterial = new THREE.MeshStandardMaterial({
    color: '#4f7a42',
    roughness: 0.95,
    flatShading: true,
  });
  const shrubGeometry = new THREE.IcosahedronGeometry(1, 0);

  function ensurePalm(entry) {
    const source = palmSources[0];
    const palm = entry.surfaceData?.palm;
    const existing = entry.island.getObjectByName(PALM_NAME);
    if (!palm) {
      if (existing) existing.visible = false;
      return;
    }
    if (!source) return;
    let mesh = existing;
    if (!mesh) {
      mesh = source.clone(true);
      mesh.name = PALM_NAME;
      entry.island.add(mesh);
    }
    mesh.visible = true;
    mesh.position.set(palm.x, palm.y, palm.z);
    mesh.scale.setScalar(palm.scale);
    mesh.rotation.y = hashUnit(palm.x * 100, palm.z * 100) * TAU;
  }

  function removeIslandExtras(entry) {
    for (const child of [...entry.island.children]) {
      if (child === entry.surface || child.name === PALM_NAME) continue;
      entry.island.remove(child);
      if (child.userData.shared) continue;
      child.traverse((node) => {
        if (node.isMesh && node.geometry && node.geometry !== shrubGeometry) {
          node.geometry.dispose();
        }
      });
    }
  }

  function addShrubs(entry, data) {
    const count = Math.min(3, data.vegetation ?? 0);
    for (let index = 0; index < count; index += 1) {
      const angle = 1.1 + index * 2.05 + entry.seed;
      const shrub = new THREE.Mesh(shrubGeometry, shrubMaterial);
      shrub.name = 'island-shrub';
      shrub.position.set(
        data.top.x + Math.cos(angle) * 1.2,
        data.top.y + 0.08,
        data.top.z + Math.sin(angle) * 0.9,
      );
      shrub.scale.set(0.55 + index * 0.08, 0.34, 0.5);
      shrub.rotation.y = hashUnit(entry.seed * 100, index) * Math.PI;
      entry.island.add(shrub);
    }
  }

  function placeRock(entry, name, footprint, angle, radius, height = 0.15) {
    const rock = rocks.make(name, footprint);
    if (!rock) return;
    rock.position.set(Math.cos(angle) * radius, height, Math.sin(angle) * radius * 0.72);
    rock.rotation.y = random() * TAU;
    entry.island.add(rock);
  }

  /**
   * Rocky islands are a sand shelf with a cluster of the provided rock models
   * on top, not a procedurally generated rock cone.
   */
  function addRockyCluster(entry) {
    for (const child of [...entry.island.children]) {
      if (child.userData.shared) entry.island.remove(child);
    }
    if (!rocks.isReady) return;

    const main = rocks.make('tall_rock', 6.0 + random() * 1.8);
    if (main) {
      main.position.set((random() - 0.5) * 1.0, -0.22, (random() - 0.5) * 1.0);
      main.rotation.y = random() * TAU;
      entry.island.add(main);
    }
    placeRock(entry, 'rock_d', 4.6 + random() * 1.6, random() * TAU, 3.2, -0.25);
    if (random() < 0.8) {
      placeRock(entry, 'cliff_c', 1.3 + random() * 0.6, random() * TAU, 4.1, -0.18);
    }
    if (random() < 0.55) {
      placeRock(entry, random() < 0.5 ? 'rock_d' : 'tall_rock', 2.2 + random() * 1.2, random() * TAU, 2.4, -0.20);
    }
  }

  function applyIslandArchetype(entry, archetype, seed) {
    removeIslandExtras(entry);
    entry.archetype = archetype;
    entry.seed = seed;

    const surface = entry.surface;
    surface.visible = true;
    surface.scale.setScalar(1);

    let data;
    if (archetype === ROCKY_ISLAND) {
      // A low sand shelf under the rocks; the rocks provide the silhouette.
      data = buildIslandSurfaceData('sandbar-shoal', seed);
      data = { ...data, palm: null, vegetation: 0 };
      surface.scale.setScalar(0.62);
      surface.name = 'island-sand-base';
    } else {
      data = buildIslandSurfaceData(archetype, seed);
      surface.name = `island-surface-${archetype}`;
    }

    surface.geometry.dispose();
    surface.geometry = surfaceGeometry(data);
    entry.surfaceData = data;

    if (archetype === ROCKY_ISLAND) {
      addRockyCluster(entry);
    } else {
      addShrubs(entry, data);
    }
    ensurePalm(entry);
  }

  function populateReef(entry) {
    const reef = entry.reef;
    for (const child of [...reef.children]) reef.remove(child);
    if (!rocks.isReady) return;

    const main = rocks.make(random() < 0.55 ? 'tall_rock' : 'rock_d', 2.4 + random() * 1.8);
    if (main) {
      main.position.set((random() - 0.5) * 1.4, -0.34 + random() * 0.12, (random() - 0.5) * 1.1);
      main.rotation.y = random() * TAU;
      reef.add(main);
    }

    const extraCount = 1 + Math.floor(random() * 2);
    for (let index = 0; index < extraCount; index += 1) {
      const useStack = random() < 0.38;
      const name = useStack ? 'cliff_c' : (random() < 0.55 ? 'rock_d' : 'tall_rock');
      const footprint = useStack ? 0.9 + random() * 0.6 : 1.4 + random() * 1.3;
      const rock = rocks.make(name, footprint);
      if (!rock) continue;
      const angle = random() * TAU;
      const radius = 1.2 + random() * 2.1;
      rock.position.set(
        Math.cos(angle) * radius,
        -0.36 + random() * 0.14,
        Math.sin(angle) * radius * 0.75,
      );
      rock.rotation.y = random() * TAU;
      reef.add(rock);
    }
  }

  const visibleIslandTypes = new Set();
  for (let index = 0; index < ISLAND_COUNT; index += 1) {
    const island = new THREE.Group();
    island.name = `tropical-island-${index + 1}`;
    const archetype = chooseIslandArchetype(random, visibleIslandTypes);
    visibleIslandTypes.add(archetype);
    const laneX = [-ISLAND_SPAN * 0.45, -ISLAND_SPAN * 0.18, ISLAND_SPAN * 0.30][index];
    island.position.set(laneX, 0, islandZ({ cameraZ: cameraZ(), archetype, random }));
    island.scale.setScalar(islandScale(random));
    island.rotation.y = random() * TAU;

    const surface = new THREE.Mesh(new THREE.BufferGeometry(), islandMaterial);
    island.add(surface);
    const entry = { island, span: ISLAND_SPAN, surface, archetype, surfaceData: null, seed: 0 };
    group.add(island);
    islands.push(entry);
    applyIslandArchetype(entry, archetype, index * 1.71 + 0.8);
  }

  for (let index = 0; index < REEF_COUNT; index += 1) {
    const reef = new THREE.Group();
    reef.name = `reef-${index + 1}`;
    reef.position.set(REEF_SPAN * (-0.375 + index * 0.25), 0, reefZ(cameraZ(), random));
    group.add(reef);
    const entry = { reef, span: REEF_SPAN };
    reefs.push(entry);
    populateReef(entry);
  }

  new GLTFLoader().load('./assets/coconut-palm.glb', (gltf) => {
    if (disposed) {
      disposeObject3D(gltf.scene);
      return;
    }
    palmSources.push(gltf.scene);
    for (const entry of islands) ensurePalm(entry);
  }, undefined, (error) => {
    if (!disposed) console.warn('[ocean] coconut palm failed to load', error);
  });

  rocks.ready.then(() => {
    if (disposed) return;
    for (const entry of reefs) populateReef(entry);
    for (const entry of islands) {
      if (entry.archetype === ROCKY_ISLAND) addRockyCluster(entry);
    }
  });

  const birdTexture = makeBirdTexture();
  for (let index = 0; index < 5; index += 1) {
    const material = new THREE.MeshBasicMaterial({
      map: birdTexture,
      transparent: true,
      opacity: 0.55 + random() * 0.25,
      depthWrite: false,
      color: new THREE.Color('#3f5560'),
      side: THREE.DoubleSide,
    });
    const size = 1.6 + random() * 1.4;
    const bird = new THREE.Mesh(new THREE.PlaneGeometry(size, size * 0.62), material);
    bird.position.set(
      (random() - 0.5) * 110,
      6 + random() * 6,
      -18 - random() * 55,
    );
    bird.frustumCulled = false;
    group.add(bird);
    birds.push({
      bird,
      speed: 2.4 + random() * 2.2,
      phase: random() * 6.28,
      flap: 1.4 + random() * 1.2,
    });
  }

  scene.add(group);

  function recycleIsland(entry, cameraX) {
    const island = entry.island;
    island.position.x = recycleX(cameraX, entry.span, random);
    island.scale.setScalar(islandScale(random));
    island.rotation.y = random() * TAU;
    const otherTypes = new Set(
      islands.filter((other) => other !== entry).map((other) => other.archetype),
    );
    const archetype = chooseIslandArchetype(random, otherTypes);
    applyIslandArchetype(entry, archetype, random() * 1000);
    island.position.z = islandZ({ cameraZ: cameraZ(), archetype, random });
  }

  return {
    update(dt, time, cameraX = 0) {
      const lensZ = cameraZ();
      for (const entry of islands) {
        const z = entry.island.position.z;
        if (islandNeedsPlacement({ z, cameraZ: lensZ, archetype: entry.archetype })) {
          entry.island.position.z = islandZ({ cameraZ: lensZ, archetype: entry.archetype, random });
        }
        if (isBehindView(entry.island.position.x, cameraX, entry.span)) recycleIsland(entry, cameraX);
      }
      for (const entry of reefs) {
        const z = entry.reef.position.z;
        if (intrudesOnCamera(z, lensZ, REEF_CAMERA_CLEARANCE) || intrudesOnHull(z, REEF_HULL_HALF_DEPTH)) {
          entry.reef.position.z = reefZ(lensZ, random);
        }
        if (isBehindView(entry.reef.position.x, cameraX, entry.span)) {
          entry.reef.position.x = recycleX(cameraX, entry.span, random);
          entry.reef.position.z = reefZ(lensZ, random);
          populateReef(entry);
        }
      }
      for (const item of birds) {
        item.bird.position.x -= item.speed * dt;
        item.bird.position.y += Math.sin(time * 1.7 + item.phase) * dt * 0.25;
        item.bird.rotation.y = 0;
        item.bird.scale.y = 1 - 0.18 * Math.abs(Math.sin(time * item.flap + item.phase));
        if (item.bird.position.x < cameraX - 66) {
          item.bird.position.x = cameraX + 66;
          item.bird.position.y = 6 + random() * 6;
          item.bird.position.z = -18 - random() * 55;
        }
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      scene.remove(group);
      for (const entry of islands) {
        for (const child of [...entry.island.children]) {
          if (child.userData.shared) entry.island.remove(child);
        }
      }
      for (const entry of reefs) {
        for (const child of [...entry.reef.children]) {
          if (child.userData.shared) entry.reef.remove(child);
        }
      }
      rocks.dispose();
      disposeObject3D(group, ...palmSources);
    },
  };
}
