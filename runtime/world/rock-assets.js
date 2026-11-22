import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { disposeObject3D } from './resources.js';

export const ROCK_MODELS = Object.freeze([
  'tall_rock',
  'rock_d',
  'cliff_c',
]);

const BASE_PATH = './assets/rocks/';

export function createRockLibrary({
  loader = new GLTFLoader(),
  basePath = BASE_PATH,
} = {}) {
  const sources = new Map();
  let ready = false;
  let disposed = false;

  const loaded = Promise.all(ROCK_MODELS.map((name) => new Promise((resolve) => {
    loader.load(`${basePath}${name}.glb`, (gltf) => {
      if (disposed) {
        disposeObject3D(gltf.scene);
        resolve();
        return;
      }
      const model = gltf.scene;
      model.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(model);
      const size = new THREE.Vector3();
      const center = new THREE.Vector3();
      box.getSize(size);
      box.getCenter(center);
      sources.set(name, {
        model,
        size,
        center,
        minY: box.min.y,
      });
      resolve();
    }, undefined, (error) => {
      console.warn('[ocean] rock failed to load', name, error);
      resolve();
    });
  }))).then(() => {
    ready = true;
    return sources.size;
  });

  function make(name, footprint = 4) {
    const source = sources.get(name);
    if (!source) return null;

    const model = source.model.clone(true);
    model.position.set(-source.center.x, -source.minY, -source.center.z);

    const holder = new THREE.Group();
    holder.add(model);
    const scale = footprint / Math.max(source.size.x, source.size.z, 0.001);
    holder.scale.setScalar(scale);
    holder.userData.height = source.size.y * scale;
    holder.userData.footprint = footprint;
    holder.userData.shared = true;
    return holder;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const source of sources.values()) disposeObject3D(source.model);
    sources.clear();
  }

  return {
    ready: loaded,
    get isReady() { return ready; },
    make,
    dispose,
  };
}
