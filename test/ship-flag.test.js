import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const THREE_URL = pathToFileURL(resolve(ROOT, 'runtime/vendor/three.module.js')).href;
const JSM_BASE = pathToFileURL(resolve(ROOT, 'runtime/vendor/jsm') + '/').href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'three') return { url: THREE_URL, shortCircuit: true };
    if (specifier.startsWith('three/addons/')) {
      return { url: JSM_BASE + specifier.slice('three/addons/'.length), shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const THREE = await import('three');
const { isMainFlag, prepareShip } = await import('../runtime/world/ship.js');
const { createShipLanterns } = await import('../runtime/world/lanterns.js');

function readGlbMainFlagMesh() {
  const buf = readFileSync(resolve(ROOT, 'runtime/assets/ship.glb'));
  const jsonLen = buf.readUInt32LE(12);
  const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  const binStart = 20 + jsonLen + 8;
  const flagNode = gltf.nodes.find((n) => n.name === 'StylShip_MainFlag_Mat_StylShip_SailsRope_0');
  const prim = gltf.meshes[flagNode.mesh].primitives[0];
  const readFloatAttr = (accIdx, itemSize) => {
    const acc = gltf.accessors[accIdx];
    const bv = gltf.bufferViews[acc.bufferView];
    const off = binStart + (bv.byteOffset || 0) + (acc.byteOffset || 0);
    const stride = bv.byteStride || itemSize * 4;
    const out = new Float32Array(acc.count * itemSize);
    for (let i = 0; i < acc.count; i += 1) {
      for (let d = 0; d < itemSize; d += 1) {
        out[i * itemSize + d] = buf.readFloatLE(off + i * stride + d * 4);
      }
    }
    return new THREE.BufferAttribute(out, itemSize);
  };
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', readFloatAttr(prim.attributes.POSITION, 3));
  geom.setAttribute('uv', readFloatAttr(prim.attributes.TEXCOORD_0, 2));
  return { geom, gltf };
}

function buildGroupFromGltfNode(node) {
  const g = new THREE.Group();
  g.name = node.name || '';
  if (Array.isArray(node.matrix)) {
    g.matrixAutoUpdate = false;
    g.matrix.fromArray(node.matrix);
  }
  return g;
}

test('isMainFlag matches child mesh suffix names without touching Flag1 or Flag2', () => {
  assert.equal(isMainFlag('StylShip_MainFlag'), true);
  assert.equal(isMainFlag('StylShip_MainFlag_Mat_StylShip_SailsRope_0'), true);
  assert.equal(isMainFlag('StylShip_Flag1'), false);
  assert.equal(isMainFlag('StylShip_Flag1_Mat_StylShip_SailsRope_0'), false);
  assert.equal(isMainFlag('StylShip_Flag2_Mat_StylShip_SailsRope_0'), false);
});

test('prepareShip isolates StylShip_MainFlag through full parent transform chain and toggles custom 0..1 UVs & material', () => {
  const { geom: mainFlagGeom, gltf } = readGlbMainFlagMesh();

  // Reconstruct the full parent chain from ship.glb: node 0 -> node 1 -> node 2 -> node 71 -> node 72.
  const n0 = buildGroupFromGltfNode(gltf.nodes[0]);
  const n1 = buildGroupFromGltfNode(gltf.nodes[1]);
  const n2 = buildGroupFromGltfNode(gltf.nodes[2]);
  const mainGroup = buildGroupFromGltfNode(gltf.nodes[71]);

  const defaultTex = new THREE.Texture();
  const atlasMaterial = new THREE.MeshStandardMaterial({
    name: 'Mat_StylShip_SailsRope',
    map: defaultTex,
    transparent: true,
    normalMap: new THREE.Texture(),
    aoMap: new THREE.Texture(),
  });

  const sharedGeomRef = mainFlagGeom;
  const mainMesh = new THREE.Mesh(sharedGeomRef, atlasMaterial);
  mainMesh.name = 'StylShip_MainFlag_Mat_StylShip_SailsRope_0';
  mainGroup.add(mainMesh);
  n2.add(mainGroup);

  const flag1Group = buildGroupFromGltfNode(gltf.nodes[85]);
  const flag1Mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.5), atlasMaterial);
  flag1Mesh.name = 'StylShip_Flag1_Mat_StylShip_SailsRope_0';
  flag1Group.add(flag1Mesh);
  n2.add(flag1Group);

  const hullMesh = new THREE.Mesh(new THREE.BoxGeometry(10, 2, 3), new THREE.MeshStandardMaterial({ name: 'Hull' }));
  hullMesh.name = 'StylShip_Hull';
  n2.add(hullMesh);

  n1.add(n2);
  n0.add(n1);

  const ship = prepareShip({ scene: n0 });
  assert.notEqual(mainMesh.geometry, sharedGeomRef, 'mainFlag geometry should be cloned');
  const initialMat = mainMesh.material;
  const initialUv = mainMesh.geometry.getAttribute('uv');
  assert.equal(initialMat.map, defaultTex);
  assert.ok(initialUv.getX(0) > 0.6 && initialUv.getY(0) < 0.1, 'default UV should preserve atlas coords');

  const customTex = new THREE.Texture();
  ship.setFlagTexture(customTex);

  assert.notEqual(mainMesh.material, initialMat);
  assert.equal(mainMesh.material.map, customTex);
  assert.equal(mainMesh.material.normalMap, null);
  assert.equal(mainMesh.material.aoMap, null);
  assert.equal(flag1Mesh.material.map, defaultTex);

  const customUv = mainMesh.geometry.getAttribute('uv');
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (let i = 0; i < customUv.count; i += 1) {
    minU = Math.min(minU, customUv.getX(i));
    maxU = Math.max(maxU, customUv.getX(i));
    minV = Math.min(minV, customUv.getY(i));
    maxV = Math.max(maxV, customUv.getY(i));
  }
  assert.ok(Math.abs(minU) < 1e-5 && Math.abs(maxU - 1) < 1e-5, `expected full U span, got ${minU}..${maxU}`);
  assert.ok(Math.abs(minV) < 1e-5 && Math.abs(maxV - 1) < 1e-5, `expected full V span, got ${minV}..${maxV}`);
  // Vertex 0 is at the top of the flag, vertex 1 is at the bottom.
  assert.ok(customUv.getY(0) < 0.05 && customUv.getY(1) > 0.95, 'top edge must map to v=0 and bottom edge to v=1 for flipY=false');

  // Restoring default restores both original atlas material and original atlas UVs.
  ship.setFlagTexture(null);
  assert.equal(mainMesh.material, initialMat);
  assert.equal(mainMesh.material.map, defaultTex);
  assert.equal(mainMesh.geometry.getAttribute('uv'), initialUv);
});

test('ship lanterns light from dusk and stay dark through the afternoon', () => {
  const pivot = new THREE.Group();
  const lanterns = createShipLanterns(pivot, {
    stern: new THREE.Vector3(4, 1.8, 0),
    mast: new THREE.Vector3(0.5, 4.2, -0.2),
  });
  const intensities = () => {
    const values = [];
    pivot.traverse((n) => {
      if (n.isPointLight) values.push(n.intensity);
    });
    return values;
  };
  lanterns.update(1.5, 1, 13);
  assert.deepEqual(intensities(), [0, 0]);
  lanterns.update(1.5, 1, 18);
  assert.deepEqual(intensities(), [0, 0]);
  lanterns.update(1.5, 1, 20);
  const night = intensities();
  assert.equal(night.length, 2);
  assert.ok(night[0] > 4 && night[1] > 3);
});
