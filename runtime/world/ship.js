import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const SAIL_COLOR = new THREE.Color('#f3ece0');
const FURLED_GAIN = 0.80;
const TARGET_LENGTH = 10;
const DRAFT_RATIO = 0.091;

const isSail = (name) => /^StylShip_Sail/i.test(name);
const isMainFlag = (name) => /^StylShip_MainFlag$/i.test(name);

function stripEmissive(material) {
  if (!material) return material;
  material.emissiveIntensity = 0;
  if (material.emissive) material.emissive.setRGB(0, 0, 0);
  material.needsUpdate = true;
  return material;
}

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
    }
  }
}

export function prepareShip(gltf) {
  const root = gltf.scene;
  root.updateMatrixWorld(true);

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
  pivot.rotation.y = Math.PI;
  root.scale.setScalar(scale);
  root.updateMatrixWorld(true);

  const scaled = new THREE.Box3().setFromObject(root);
  const center = new THREE.Vector3();
  scaled.getCenter(center);
  root.position.x -= center.x;
  root.position.z -= center.z;
  root.position.y -= scaled.min.y + TARGET_LENGTH * DRAFT_RATIO;
  root.updateMatrixWorld(true);

  const fencingBackBox = new THREE.Box3();
  const floorBackTopBox = new THREE.Box3();
  const mastMidBox = new THREE.Box3();
  root.traverse((node) => {
    if (!node.isMesh) return;
    if (/^StylShip_FencingBack\b/i.test(node.name)) fencingBackBox.expandByObject(node);
    else if (/^StylShip_FloorBackTop\b/i.test(node.name)) floorBackTopBox.expandByObject(node);
    else if (/^StylShip_MastMid\b/i.test(node.name)) mastMidBox.expandByObject(node);
  });

  const sternAnchor = !fencingBackBox.isEmpty()
    ? new THREE.Vector3(
      fencingBackBox.max.x - 0.06,
      fencingBackBox.max.y + 0.16,
      (fencingBackBox.min.z + fencingBackBox.max.z) * 0.5,
    )
    : !floorBackTopBox.isEmpty()
      ? new THREE.Vector3(floorBackTopBox.max.x - 0.08, floorBackTopBox.max.y + 0.28, 0)
      : new THREE.Vector3(scaled.max.x * 0.92, 1.8, 0);

  const mastAnchor = !mastMidBox.isEmpty()
    ? new THREE.Vector3(
      (mastMidBox.min.x + mastMidBox.max.x) * 0.5,
      mastMidBox.min.y + (mastMidBox.max.y - mastMidBox.min.y) * 0.67,
      -0.28,
    )
    : new THREE.Vector3(0.6, 4.2, -0.28);

  pivot.add(root);

  const sails = [];
  const mainFlags = [];
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
    } else if (isMainFlag(name)) {
      // Clone material so replacing StylShip_MainFlag never mutates Flag1 or Flag2.
      const flagMaterial = material && typeof material.clone === 'function'
        ? material.clone()
        : new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide });
      stripEmissive(flagMaterial);
      flagMaterial.side = THREE.DoubleSide;
      node.material = flagMaterial;
      mainFlags.push({ mesh: node, material: flagMaterial, defaultMap: flagMaterial.map || null });
    } else {
      stripEmissive(node.material);
    }
  });

  mergeStaticParts(root, [...sails, ...mainFlags.map((entry) => entry.mesh)]);

  const cx = new THREE.Box3().setFromObject(root).getCenter(new THREE.Vector3()).x;
  for (const mesh of sails) bakeFurl(mesh, cx);

  const anchors = {
    stern: sternAnchor,
    mast: mastAnchor,
  };

  let customFlagTexture = null;

  return {
    pivot,
    anchors,
    setFurl(amount01) {
      const a = THREE.MathUtils.clamp(amount01, 0, 1);
      for (const mesh of sails) {
        if (mesh.morphTargetInfluences) mesh.morphTargetInfluences[0] = a;
      }
    },
    setFlagTexture(texture) {
      if (customFlagTexture && customFlagTexture !== texture) {
        try { customFlagTexture.dispose(); } catch {}
      }
      customFlagTexture = texture || null;
      for (const entry of mainFlags) {
        entry.material.map = customFlagTexture || entry.defaultMap;
        entry.material.needsUpdate = true;
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

  const shell = root.clone(true);
  shell.scale.setScalar(scale);
  shell.updateMatrixWorld(true);

  const scaled = new THREE.Box3().setFromObject(shell);
  const center = new THREE.Vector3();
  scaled.getCenter(center);
  shell.position.x -= center.x;
  shell.position.z -= center.z;
  const height = Math.max(0.001, scaled.max.y - scaled.min.y);
  shell.position.y -= scaled.min.y + height * 0.13;

  const pivot = new THREE.Group();
  pivot.name = 'dinghyPivot';
  pivot.rotation.y = Math.PI;
  pivot.add(shell);

  return {
    pivot,
    size: size.toArray(),
    make() {
      return pivot.clone(true);
    },
  };
}

