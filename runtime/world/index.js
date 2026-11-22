import * as THREE from 'three';
import { createOcean } from './ocean.js';
import { createSky } from './sky.js';
import { createWind } from './wind.js';
import { createScenery } from './scenery.js';
import { loadShip, loadDinghy } from './ship.js';
import { createFleet } from './fleet.js';
import { disposeObject3D } from './resources.js';
import { viewForCamera } from '../sim/berth.js';
import { sampleWaveAt } from '../sim/wave-field.js';
import { toWorldX, cameraXForShip } from '../sim/world-motion.js';
import { qualityProfile } from '../env/quality.js';

const SHIP_X = 0;

// Owns every object in the scene except the camera and the renderer. The app
// drives it with one update call per frame and one settings call per change.
export function createWorld({
  scene,
  camera,
  uniforms,
  quality = 'balanced',
  random = Math.random,
  onAssetReady = () => {},
}) {
  const vesselRoot = new THREE.Group();
  vesselRoot.name = 'moving-vessel-group';
  scene.add(vesselRoot);

  const sunLight = new THREE.DirectionalLight(0xfff3e2, 2.5);
  sunLight.position.copy(uniforms.uSunDir.value).multiplyScalar(120);
  sunLight.target.position.set(0, 0, 0);
  scene.add(sunLight, sunLight.target);
  scene.add(new THREE.HemisphereLight(0xd2e8f3, 0x1a515e, 1.45));

  const sky = createSky(uniforms);
  scene.add(sky);
  const ocean = createOcean(uniforms, {
    size: 1200,
    segments: qualityProfile(quality).segments,
  });
  scene.add(ocean);

  const wind = createWind(camera, { random });
  const scenery = createScenery(scene, camera, { random });

  let ship = null;
  let dinghy = null;
  let fleet = null;
  let settings = null;
  let travelX = 0;
  let disposed = false;
  let shipFurl = 0;

  function cameraView() {
    if (!camera || !vesselRoot) return undefined;
    return viewForCamera({
      cameraX: camera.position.x - vesselRoot.position.x,
      cameraDistance: settings?.cameraDistance ?? 44,
      fovDeg: camera.fov,
      aspect: camera.aspect,
    });
  }

  function syncFleet(rows, rootId) {
    if (!fleet) return;
    fleet.sync(rows, { shipX: SHIP_X, rootId: rootId ?? null });
  }

  function attachFleet() {
    if (fleet || !ship || !dinghy || disposed) return;
    fleet = createFleet({
      scene: vesselRoot,
      makeDinghy: () => dinghy.make(),
      getView: cameraView,
      random,
    });
  }

  function loadAssets() {
    loadShip('./assets/ship.glb').then((loaded) => {
      if (disposed) {
        disposeObject3D(loaded.pivot);
        return;
      }
      ship = loaded;
      ship.pivot.position.set(SHIP_X, 0, 0);
      vesselRoot.add(ship.pivot);
      uniforms.uShadow.value = 1;
      uniforms.uWake.value = 1;
      uniforms.uShipPos.value.set(toWorldX(SHIP_X, travelX), 0, 0);
      if (dinghy) attachFleet();
      onAssetReady();
    }).catch((error) => {
      if (!disposed) console.error('[ocean] ship failed to load', error);
    });

    loadDinghy('./assets/dinghy.glb').then((loaded) => {
      if (disposed) {
        disposeObject3D(loaded.pivot);
        return;
      }
      dinghy = loaded;
      if (ship) attachFleet();
      onAssetReady();
    }).catch((error) => {
      if (!disposed) console.error('[ocean] dinghy failed to load', error);
    });
  }

  function applySettings(next) {
    settings = next;
    if (ocean) ocean.setSegments(qualityProfile(next.quality).segments);
    if (!camera) return;
    camera.position.set(
      cameraXForShip(travelX, SHIP_X, next.cameraXOffset),
      next.cameraHeight,
      next.cameraDistance,
    );
    camera.rotation.set(-THREE.MathUtils.degToRad(next.cameraPitch), 0, 0);
    if (camera.aspect) camera.updateProjectionMatrix();
  }

  function syncPosition(nextTravelX) {
    travelX = nextTravelX;
    const cameraX = cameraXForShip(travelX, SHIP_X, settings?.cameraXOffset ?? 0);
    if (camera) camera.position.x = cameraX;
    if (vesselRoot) vesselRoot.position.x = travelX;
    if (ocean) ocean.position.x = cameraX;
    if (sky) sky.position.x = cameraX;
    if (sunLight) {
      sunLight.position.x = travelX + uniforms.uSunDir.value.x * 120;
      sunLight.target.position.x = travelX;
    }
    uniforms.uWorldOffset.value = cameraX;
    uniforms.uShipPos.value.set(toWorldX(SHIP_X, travelX), 0, 0);
  }

  function bobShip(time, flow, sea) {
    if (!ship) return;
    const worldX = toWorldX(SHIP_X, travelX);
    const wave = sampleWaveAt(worldX, 0, time, flow, sea);
    ship.pivot.position.y = wave.height * 0.92 - 0.15;
    ship.pivot.rotation.z = -wave.dx * 0.75;
    ship.pivot.rotation.x = wave.dz * 1.15;
  }

  function setFurl(amount) {
    shipFurl = amount;
    if (ship) ship.setFurl(shipFurl);
  }

  function update(dt, frame) {
    if (disposed) return;
    const { time, flow, sea, motion = true } = frame;
    bobShip(time, flow, sea);
    if (fleet) fleet.update(dt, { time, flow, sea, worldOffset: travelX });
    if (!motion) return;
    wind.update(dt);
    scenery.update(dt, time, cameraXForShip(travelX, SHIP_X, settings?.cameraXOffset ?? 0));
  }

  loadAssets();

  return {
    applySettings,
    syncPosition,
    syncFleet,
    setFurl,
    update,
    get ship() { return ship; },
    get fleet() { return fleet; },
    get cameraView() { return cameraView(); },
    get vesselRoot() { return vesselRoot; },
    get ocean() { return ocean; },
    get sky() { return sky; },
    get scenery() { return scenery; },
    get wind() { return wind; },
    get travelX() { return travelX; },
    get ready() { return Boolean(ship && dinghy); },
    dispose() {
      if (disposed) return;
      disposed = true;
      try { fleet?.dispose(); } catch {}
      try { wind.dispose(); } catch {}
      try { scenery.dispose(); } catch {}
      if (ship) {
        try { disposeObject3D(ship.pivot); } catch {}
        ship = null;
      }
      if (dinghy) {
        try { disposeObject3D(dinghy.pivot); } catch {}
        dinghy = null;
      }
      if (ocean) {
        try { ocean.geometry.dispose(); ocean.material.dispose(); } catch {}
      }
      if (sky) {
        try { sky.geometry.dispose(); sky.material.dispose(); } catch {}
      }
      try { scene.remove(vesselRoot, sunLight, sunLight.target, sky, ocean); } catch {}
      fleet = null;
      settings = null;
    },
  };
}
