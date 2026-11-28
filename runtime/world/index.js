import * as THREE from 'three';
import { createOcean } from './ocean.js';
import { createSky } from './sky.js';
import { createWind } from './wind.js';
import { createScenery } from './scenery.js';
import { loadShip, loadDinghy } from './ship.js';
import { createFleet } from './fleet.js';
import { createShipLanterns } from './lanterns.js';
import { createWeatherEffects } from './weather.js';
import { disposeObject3D } from './resources.js';
import { viewForCamera } from '../sim/berth.js';
import { sampleWaveAt } from '../sim/wave-field.js';
import { toWorldX, cameraXForShip } from '../sim/world-motion.js';
import { qualityProfile } from '../env/quality.js';

const SHIP_X = 0;

export function createWorld({
  scene,
  camera,
  uniforms,
  quality = 'balanced',
  random = Math.random,
  onAssetReady = () => {},
  onAssetError = () => {},
}) {
  const vesselRoot = new THREE.Group();
  vesselRoot.name = 'moving-vessel-group';
  scene.add(vesselRoot);

  const sunLight = new THREE.DirectionalLight(0xfff3e2, 2.5);
  sunLight.position.copy(uniforms.uSunDir.value).multiplyScalar(120);
  sunLight.target.position.set(0, 0, 0);
  scene.add(sunLight, sunLight.target);
  const hemiLight = new THREE.HemisphereLight(0xd2e8f3, 0x1a515e, 1.45);
  scene.add(hemiLight);

  const sky = createSky(uniforms);
  scene.add(sky);
  const ocean = createOcean(uniforms, {
    size: 1200,
    segments: qualityProfile(quality).segments,
  });
  scene.add(ocean);

  const wind = createWind(camera, { random });
  const scenery = createScenery(scene, camera, { random });
  const weatherEffects = createWeatherEffects(scene, { random });

  let ship = null;
  let lanterns = null;
  let dinghy = null;
  let fleet = null;
  let settings = null;
  let travelX = 0;
  let disposed = false;
  let shipFurl = 0;
  let pendingFlag = null;
  let flagSeq = 0;
  let nightWeight = 0;
  let nightHour = null;
  let currentWeather = 'clear';

  function applyFlagState() {
    if (!ship || pendingFlag === null) return;
    const spec = pendingFlag;
    const seq = ++flagSeq;
    if (!spec.hasCustom) {
      ship.setFlagTexture(null);
      onAssetReady();
      return;
    }
    const loader = new THREE.TextureLoader();
    loader.load(
      `./flag/image?v=${encodeURIComponent(String(spec.version ?? ''))}`,
      (texture) => {
        if (disposed || seq !== flagSeq || !ship) {
          texture.dispose();
          return;
        }
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.flipY = false;
        texture.needsUpdate = true;
        ship.setFlagTexture(texture);
        onAssetReady();
      },
      undefined,
      (error) => {
        if (!disposed) console.warn('[ocean] custom flag texture failed to load', error);
      },
    );
  }

  function setFlagState(hasCustom, version = Date.now()) {
    const nextHas = Boolean(hasCustom);
    if (pendingFlag && pendingFlag.hasCustom === nextHas && pendingFlag.version === version) return;
    pendingFlag = { hasCustom: nextHas, version };
    applyFlagState();
  }

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
      lanterns = createShipLanterns(ship.pivot, ship.anchors);
      ship.pivot.position.set(SHIP_X, 0, 0);
      vesselRoot.add(ship.pivot);
      uniforms.uShadow.value = 1;
      uniforms.uWake.value = 1;
      uniforms.uShipPos.value.set(toWorldX(SHIP_X, travelX), 0, 0);
      if (pendingFlag !== null) applyFlagState();
      if (dinghy) attachFleet();
      onAssetReady();
    }).catch((error) => {
      if (disposed) return;
      console.error('[ocean] ship failed to load', error);
      onAssetError(error);
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
      if (disposed) return;
      console.error('[ocean] dinghy failed to load', error);
      onAssetError(error);
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

  function applyAtmosphere(atmo) {
    if (!atmo) return;
    uniforms.uSkyZenith.value.set(atmo.skyZenith);
    uniforms.uSkyHorizon.value.set(atmo.skyHorizon);
    uniforms.uSunDir.value.set(atmo.sunDir.x, atmo.sunDir.y, atmo.sunDir.z).normalize();
    uniforms.uSunColor.value.set(atmo.sunColor);
    uniforms.uDeep.value.set(atmo.deep);
    uniforms.uShallow.value.set(atmo.shallow);
    uniforms.uFoamColor.value.set(atmo.foam);
    uniforms.uCloud.value = atmo.cloud;
    if (scene?.fog) scene.fog.color.set(atmo.skyHorizon);
    sunLight.color.set(atmo.sunColor);
    sunLight.intensity = atmo.sunIntensity;
    sunLight.position.set(
      travelX + uniforms.uSunDir.value.x * 120,
      uniforms.uSunDir.value.y * 120,
      uniforms.uSunDir.value.z * 120,
    );
    hemiLight.color.set(atmo.hemiSky);
    hemiLight.groundColor.set(atmo.hemiGround);
    hemiLight.intensity = atmo.hemiIntensity;
    nightWeight = atmo.nightWeight ?? 0;
    nightHour = typeof atmo.hour === 'number' ? atmo.hour : null;
    currentWeather = atmo.weather ?? 'clear';
  }

  function bobShip(time, flow, sea, rollOffset = 0) {
    if (!ship) return;
    const worldX = toWorldX(SHIP_X, travelX);
    const wave = sampleWaveAt(worldX, 0, time, flow, sea);
    ship.pivot.position.y = wave.height * 0.92 - 0.15;
    ship.pivot.rotation.z = -wave.dx * 0.75;
    ship.pivot.rotation.x = wave.dz * 1.15 + rollOffset;
  }

  function setFurl(amount) {
    shipFurl = amount;
    if (ship) ship.setFurl(shipFurl);
  }

  function update(dt, frame) {
    if (disposed) return;
    const { time, flow, sea, motion = true, rollOffset = 0 } = frame;
    const cameraX = cameraXForShip(travelX, SHIP_X, settings?.cameraXOffset ?? 0);
    bobShip(time, flow, sea, rollOffset);
    if (lanterns) lanterns.update(time, nightWeight, nightHour);
    if (fleet) fleet.update(dt, { time, flow, sea, worldOffset: travelX, rollOffset });
    weatherEffects.update(dt, {
      weather: currentWeather,
      quality: settings?.quality ?? 'balanced',
      motion,
      cameraX,
      time,
    });
    if (!motion) return;
    wind.update(dt);
    scenery.update(dt, time, cameraX);
  }

  loadAssets();

  return {
    applySettings,
    syncPosition,
    syncFleet,
    setFurl,
    setFlagState,
    applyAtmosphere,
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
      try { weatherEffects.dispose(); } catch {}
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
      try { scene.remove(vesselRoot, sunLight, sunLight.target, hemiLight, sky, ocean); } catch {}
      lanterns = null;
      fleet = null;
      settings = null;
    },
  };
}
