import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// The model ships with a black sail cloth and a cyan skull that glows through an
// emissive map. We want the cream canvas and no neon, so the sail material is
// rebuilt and every other material simply loses its emissive channel.
const SAIL_COLOR = new THREE.Color('#f3ece0');
const FURLED_GAIN = 0.80;
// Twelve units reads as a ship at a comfortable distance behind the UI, not a
// model pressed against the camera.
const TARGET_LENGTH = 10;
// How far the keel sits under the surface. Enough to look loaded, not sunk.
const DRAFT_RATIO = 0.091;

const isSail = (name) => /^StylShip_Sail/i.test(name);

function stripEmissive(material) {
  if (!material) return material;
  material.emissiveIntensity = 0;
  if (material.emissive) material.emissive.setRGB(0, 0, 0);
  material.needsUpdate = true;
  return material;
}

// Bake a furled copy of a sail as a morph target. Compressing in the sail's own
// local space would need an axis guess per mesh; doing it in world space and
// converting straight back is exact, and the cost is paid once at load time on
// geometries that hold a few hundred vertices each.
function bakeFurl(mesh, cx) {
  const geometry = mesh.geometry;
  const position = geometry.getAttribute('position');
  if (!position) return;

  mesh.updateWorldMatrix(true, false);
  const toWorld = mesh.matrixWorld.clone();
  const toLocal = toWorld.clone().invert();

  const bounds = new THREE.Box3().setFromObject(mesh);
  const topY = bounds.max.y;
  const height = Math.max(0.001, topY - bounds.min.y);

  const morphed = new Float32Array(position.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < position.count; i += 1) {
    v.fromBufferAttribute(position, i).applyMatrix4(toWorld);
    const fromTop = topY - v.y;
    v.y = topY - fromTop * (1 - FURLED_GAIN) - height * 0.02 * FURLED_GAIN;
    // The bundle bunches toward the centre line and wrinkles along it.
    v.x = cx + (v.x - cx) * (1 - 0.10 * FURLED_GAIN);
    v.z += Math.sin((v.x - cx) * 2.6) * height * 0.055 * FURLED_GAIN;
    v.applyMatrix4(toLocal);
    morphed[i * 3] = v.x;
    morphed[i * 3 + 1] = v.y;
    morphed[i * 3 + 2] = v.z;
  }

  geometry.morphAttributes.position = [new THREE.BufferAttribute(morphed, 3)];
  mesh.updateMorphTargets();
  mesh.morphTargetInfluences = [0];
}

function mergeStaticParts(root, keep) {
  const keepSet = new Set(keep);
  const buckets = new Map();
  root.updateWorldMatrix(true, true);

  root.traverse((node) => {
    if (!node.isMesh || keepSet.has(node)) return;
    const material = Array.isArray(node.material) ? node.material[0] : node.material;
    if (!material) return;
    const key = material.uuid;
    if (!buckets.has(key)) buckets.set(key, { material, meshes: [] });
    buckets.get(key).meshes.push(node);
  });

  const toRoot = new THREE.Matrix4().copy(root.matrixWorld).invert();
  for (const { material, meshes } of buckets.values()) {
    if (meshes.length < 2) continue;
    try {
      const geometries = [];
      for (const mesh of meshes) {
        const geometry = mesh.geometry.clone();
        geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(toRoot, mesh.matrixWorld));
        for (const name of Object.keys(geometry.attributes)) {
          if (name !== 'position' && name !== 'normal' && name !== 'uv' && name !== 'uv1') {
            geometry.deleteAttribute(name);
          }
        }
        if (!geometry.getAttribute('uv') && geometry.getAttribute('uv1')) {
          geometry.setAttribute('uv', geometry.getAttribute('uv1'));
        }
        geometry.deleteAttribute('uv1');
        if (!geometry.index) {
          // merged geometry must be consistently indexed or consistently raw
          const count = geometry.getAttribute('position').count;
          const index = new Uint32Array(count);
          for (let i = 0; i < count; i += 1) index[i] = i;
          geometry.setIndex(new THREE.BufferAttribute(index, 1));
        }
        geometries.push(geometry);
      }
      const merged = mergeGeometries(geometries, false);
      if (!merged) throw new Error('merge returned null');
      const combined = new THREE.Mesh(merged, material);
      combined.name = `merged-${material.name ?? 'material'}`;
      root.add(combined);
      for (const mesh of meshes) mesh.parent?.remove(mesh);
    } catch {
      // A geometry set that cannot merge is not worth failing the ship over.
    }
  }
}

export function prepareShip(gltf) {
  const root = gltf.scene;
  root.updateMatrixWorld(true);

  // The upload carries its own water plane. It is a flat disc with a painted
  // pattern: keeping it would draw a second sea on top of ours.
  const drop = [];
  root.traverse((node) => {
    if (node.name === 'WaterPlane' || /^WaterPlane/.test(node.name)) drop.push(node);
  });
  drop.forEach((node) => node.parent?.remove(node));

  const bounds = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  bounds.getSize(size);
  const longest = Math.max(size.x, size.z);
  const scale = TARGET_LENGTH / Math.max(longest, 0.001);

  const pivot = new THREE.Group();
  pivot.name = 'shipPivot';
  // The model is built bow-to-the-left; the ship always sails to the right.
  pivot.rotation.y = Math.PI;
  root.scale.setScalar(scale);
  root.updateMatrixWorld(true);

  const scaled = new THREE.Box3().setFromObject(root);
  const center = new THREE.Vector3();
  scaled.getCenter(center);
  // Centre on the hull, then drop it so the waterline sits just under the deck
  // rather than on the keel.
  root.position.x -= center.x;
  root.position.z -= center.z;
  // Keel below the waterline, scaled with the hull. A fixed depth that looked
  // right on a 17-unit ship buried the waterline once the ship was 10.
  root.position.y -= scaled.min.y + TARGET_LENGTH * DRAFT_RATIO;

  pivot.add(root);

  const sails = [];
  root.traverse((node) => {
    if (!node.isMesh) return;
    const material = Array.isArray(node.material) ? node.material[0] : node.material;
    const name = node.name;

    if (isSail(name)) {
      const rebuilt = new THREE.MeshStandardMaterial({
        color: SAIL_COLOR,
        roughness: 0.92,
        metalness: 0,
        side: THREE.DoubleSide,
      });
      if (material?.normalMap) rebuilt.normalMap = material.normalMap;
      if (material?.aoMap) {
        rebuilt.aoMap = material.aoMap;
        node.geometry.setAttribute('uv1', node.geometry.getAttribute('uv'));
      }
      node.material = rebuilt;
      node.castShadow = false;
      sails.push(node);
    } else {
      stripEmissive(node.material);
    }
  });

  // The upload is a rigger's outliner: 70 meshes that share seven materials.
  // Baked into one mesh per material they draw eight times instead of seventy,
  // and nothing moves because none of them were meant to move.
  mergeStaticParts(root, sails);

  // Furl every sail in one pass so all four share the same centre line.
  const cx = new THREE.Box3().setFromObject(root).getCenter(new THREE.Vector3()).x;
  for (const mesh of sails) bakeFurl(mesh, cx);

  return {
    pivot,
    setFurl(amount01) {
      const a = THREE.MathUtils.clamp(amount01, 0, 1);
      for (const mesh of sails) {
        if (mesh.morphTargetInfluences) mesh.morphTargetInfluences[0] = a;
      }
    },
  };
}

export function loadShip(url) {
  return new Promise((resolve, reject) => {
    const loader = new GLTFLoader();
    loader.load(url, (gltf) => {
      try {
        resolve(prepareShip(gltf));
      } catch (error) {
        reject(error);
      }
    }, undefined, reject);
  });
}


// The crew boat is its own model: a rowboat with oars shipped inboard. It is
// red-hulled, which is a useful second accent next to the brown ship.
// The rowboat has its own hull and proportions.
const DINGHY_LENGTH = 3.4;

export function loadDinghy(url) {
  return new Promise((resolve, reject) => {
    const loader = new GLTFLoader();
    loader.load(url, (gltf) => {
      try {
        resolve(prepareDinghy(gltf));
      } catch (error) {
        reject(error);
      }
    }, undefined, reject);
  });
}

function prepareDinghy(gltf) {
  const root = gltf.scene;
  root.updateMatrixWorld(true);

  const bounds = new THREE.Box3().setFromObject(root);
  const size = bounds.getSize(new THREE.Vector3());
  const longest = Math.max(size.x, size.z);
  const scale = DINGHY_LENGTH / Math.max(longest, 0.001);

  // Scale the model itself, never the pivot: every offset below is then in world
  // units, which is the only way the draft stays the draft you can see.
  const shell = root.clone(true);
  shell.scale.setScalar(scale);
  shell.updateMatrixWorld(true);

  const scaled = new THREE.Box3().setFromObject(shell);
  const center = new THREE.Vector3();
  scaled.getCenter(center);
  shell.position.x -= center.x;
  shell.position.z -= center.z;
  // Draft is a share of the boat's own height, not a flat number: a rowboat has
  // a shallow hull, and sinking it to a fixed depth hid the floor and the seats
  // under the water plane, leaving a hollow shell on the surface.
  const height = Math.max(0.001, scaled.max.y - scaled.min.y);
  shell.position.y -= scaled.min.y + height * 0.13;

  const pivot = new THREE.Group();
  pivot.name = 'dinghyPivot';
  pivot.rotation.y = Math.PI;
  pivot.add(shell);

  // The boat's own copy. Geometries and materials are shared with this pivot;
  // both live until the runtime disposes the model.
  return {
    pivot,
    size: size.toArray(),
    make() {
      return pivot.clone(true);
    },
  };
}

