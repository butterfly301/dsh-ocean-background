import * as THREE from 'three';
import { createOcean } from './ocean.js';
import { sampleWaveAt } from './wave-field.js';
import { disposeObject3D } from './resources.js';
import { createSky } from './sky.js';
import { loadShip, loadDinghy } from './ship.js';
import { createFleet } from './boats.js';
import { viewForCamera } from './fleet.js';
import { createWind } from './wind.js';
import { createScenery } from './scenery.js';
import { createSeaState } from './state.js';
import { createVoyageReporter } from './voyage.js';
import { advanceVoyage, cameraXForShip, normalizeCameraXOffset, toWorldX } from './world-motion.js';
import {
  createFrameClock,
  owesStillFrame,
  shouldAnimate,
  targetFpsForQuality,
} from './lifecycle.js';

const params = new URLSearchParams(location.search);

const EMBEDDED = window.parent !== window;
if (EMBEDDED) document.documentElement.classList.add('embedded');
const reducedMotion = typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const DEFAULTS = Object.freeze({
  enabled: true,
  strength: 0.72,
  running: true,
  quality: params.get('quality') === 'high' ? 'high' : 'balanced',
  sessionId: null,
  visible: true,
  cameraDistance: 44,
  cameraHeight: 4.8,
  cameraPitch: 2.7,
  cameraXOffset: 0,
});

const PALETTE = {
  skyZenith: '#3f87bd',
  skyHorizon: '#b6dbe8',
  sunDir: new THREE.Vector3(-0.48, 0.20, -0.85).normalize(),
  sunColor: '#fff0d2',
  deep: '#1f5d78',
  shallow: '#4e9fba',
  foam: '#bfe0dc',
};

const SHIP_X = 0;

function seaAmplitudeFor(level) {
  const t = Math.min(1, Math.max(0, (Number(level) - 25) / 75));
  return 0.5 + 2.0 * t ** 1.5;
}

const uniforms = {
  uTime: { value: 0 },
  uFlow: { value: 0 },
  uSea: { value: seaAmplitudeFor(25) },
  uFoam: { value: 0 },
  uCloud: { value: 0.75 },
  uSkyZenith: { value: new THREE.Color(PALETTE.skyZenith) },
  uSkyHorizon: { value: new THREE.Color(PALETTE.skyHorizon) },
  uSunDir: { value: PALETTE.sunDir.clone() },
  uSunColor: { value: new THREE.Color(PALETTE.sunColor) },
  uDeep: { value: new THREE.Color(PALETTE.deep) },
  uShallow: { value: new THREE.Color(PALETTE.shallow) },
  uFoamColor: { value: new THREE.Color(PALETTE.foam) },
  uShipPos: { value: new THREE.Vector3(SHIP_X, 0, 0) },
  uWorldOffset: { value: 0 },
  uShadow: { value: 0 },
  uWake: { value: 0 },
};

const settings = { ...DEFAULTS };
let pendingSession;
let quality = settings.quality;
const clock = createFrameClock({ targetFps: targetFpsForQuality(quality) });

let stage = null;
let renderer = null;
let scene = null;
let camera = null;
let ocean = null;
let sky = null;
let wind = null;
let scenery = null;
let fleet = null;
let seaState = null;
let vesselRoot = null;
let sunLight = null;
let travelX = 0;
let ship = null;
let dinghy = null;
let voyage = null;

let booted = false;
let bootFailed = false;
let settingsReceived = false;
let disposed = false;
let loopOn = false;
let announced = false;
let stillFrameNeeded = false;
let elapsed = 0;
let shipFurl = 0;

function pixelRatioFor(nextQuality) {
  return Math.min(window.devicePixelRatio || 1, nextQuality === 'high' ? 2 : 1.3);
}

function applyRendererQuality() {
  if (!renderer) return;
  renderer.setPixelRatio(pixelRatioFor(quality));
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function wantsAnimation() {
  return shouldAnimate({
    booted,
    enabled: settings.enabled,
    visible: settings.visible,
    running: settings.running,
    hidden: document.hidden,
  });
}

function ensureBoot() {
  if (booted || bootFailed || disposed) return;
  if (EMBEDDED && !settingsReceived) return;
  if (!settings.enabled || !settings.visible || document.hidden) return;
  try {
    boot();
  } catch (error) {
    bootFailed = true;
    dispose();
    console.error('[ocean] renderer failed to start', error);
  }
}

function boot() {
  stage = document.getElementById('stage');
  quality = settings.quality;

  renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: quality === 'high' ? 'high-performance' : 'low-power',
  });
  applyRendererQuality();
  clock.setTargetFps(targetFpsForQuality(quality));
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  if (stage) stage.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(PALETTE.skyHorizon, 60, 450);
  camera = new THREE.PerspectiveCamera(34, window.innerWidth / Math.max(1, window.innerHeight), 0.5, 3000);
  applyCamera();
  scene.add(camera);

  vesselRoot = new THREE.Group();
  vesselRoot.name = 'moving-vessel-group';
  scene.add(vesselRoot);

  sunLight = new THREE.DirectionalLight(0xfff3e2, 2.5);
  sunLight.position.copy(PALETTE.sunDir).multiplyScalar(120);
  sunLight.target.position.set(0, 0, 0);
  scene.add(sunLight, sunLight.target);
  scene.add(new THREE.HemisphereLight(0xd2e8f3, 0x1a515e, 1.45));

  sky = createSky(uniforms);
  scene.add(sky);
  ocean = createOcean(uniforms, {
    size: 1200,
    segments: quality === 'high' ? 300 : 240,
  });
  scene.add(ocean);

  wind = createWind(camera);
  scenery = createScenery(scene, camera);

  voyage = createVoyageReporter({
    send: (body) => fetch('./voyage', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      keepalive: true,
    }).then((response) => {
      if (!response || !response.ok) throw new Error(`voyage ${response ? response.status : 0}`);
    }),
    getSessionId: () => (pendingSession === undefined ? null : pendingSession),
  });

  seaState = createSeaState({
    onFleet: handleFleet,
    onSession: handleSession,
  });
  if (pendingSession !== undefined) seaState.setSession(pendingSession);

  loadAssets();

  booted = true;

  renderFrame(0);
  syncLifecycle();
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
    stillFrameNeeded = true;
    syncLifecycle();
  }).catch((error) => {
    if (!disposed) console.error('[ocean] ship failed to load', error);
  });

  loadDinghy('./assets/dinghy.glb').then((loaded) => {
    if (disposed) {
      disposeObject3D(loaded.pivot);
      return;
    }
    dinghy = loaded;
    console.info('[ocean] dinghy ready', { size: loaded.size.map((n) => Number(n.toFixed(2))) });
    if (ship) attachFleet();
    stillFrameNeeded = true;
    syncLifecycle();
  }).catch((error) => {
    if (!disposed) console.error('[ocean] dinghy failed to load', error);
  });
}

function attachFleet() {
  if (fleet || !ship || !dinghy || disposed) return;
  fleet = createFleet({
    scene: vesselRoot,
    makeDinghy: () => dinghy.make(),
    getView: () => {
      if (!camera || !vesselRoot) return undefined;
      return viewForCamera({
        cameraX: camera.position.x - vesselRoot.position.x,
        cameraDistance: settings.cameraDistance,
        fovDeg: camera.fov,
        aspect: camera.aspect,
      });
    },
  });
  const children = seaState ? seaState.state.fleet : [];
  const rootId = seaState ? seaState.state.sessionId : null;
  fleet.sync(children, { shipX: SHIP_X, rootId });
}

function handleFleet(children, info) {
  if (!fleet) return;
  const rootId = info && 'sessionId' in info
    ? info.sessionId
    : (seaState ? seaState.state.sessionId : null);
  fleet.sync(children, { shipX: SHIP_X, rootId });
}

function handleSession({ sessionId }) {
  if (!fleet) return;
  fleet.sync([], { shipX: SHIP_X, rootId: sessionId });
}

function renderFrame(dt, credit = true) {
  if (disposed || !renderer || !scene || !camera) return;
  const seconds = Math.max(0, dt);
  elapsed += seconds;
  const advanced = advanceVoyage(travelX, seconds, !reducedMotion);
  const sailed = advanced - travelX;
  if (credit && sailed > 0) voyage?.add(sailed);
  travelX = advanced;
  syncWorldPosition();

  if (seaState) seaState.relax(seconds);
  const state = seaState ? seaState.state : null;
  const seaTarget = seaAmplitudeFor(state ? state.sea : 25);
  const seaBlend = seconds > 0 ? Math.min(1, seconds / 0.3) : 1;
  uniforms.uSea.value += (seaTarget - uniforms.uSea.value) * seaBlend;
  const foamTarget = state ? state.foam : 0;
  const foamBlend = seconds > 0 ? Math.min(1, seconds / 0.8) : 1;
  uniforms.uFoam.value += (foamTarget - uniforms.uFoam.value) * foamBlend;
  uniforms.uTime.value = elapsed;
  uniforms.uFlow.value = reducedMotion ? 0 : elapsed;

  const furlTarget = state && state.agentRunning ? 0 : 0.42;
  const furlBlend = seconds > 0 ? Math.min(1, seconds / 1.6) : 1;
  shipFurl += (furlTarget - shipFurl) * furlBlend;
  if (ship) ship.setFurl(shipFurl);

  bobShip();
  if (fleet) {
    fleet.update(seconds, {
      time: uniforms.uTime.value,
      flow: uniforms.uFlow.value,
      sea: uniforms.uSea.value,
      worldOffset: travelX,
    });
  }
  if (!reducedMotion) {
    wind.update(seconds);
    scenery.update(seconds, elapsed, cameraXForShip(travelX, SHIP_X, settings.cameraXOffset));
  }

  renderer.render(scene, camera);
  announceReady();
}

function bobShip() {
  if (!ship) return;
  const sea = uniforms.uSea.value;
  const time = uniforms.uTime.value;
  const flow = uniforms.uFlow.value;
  const worldX = toWorldX(SHIP_X, travelX);
  const wave = sampleWaveAt(worldX, 0, time, flow, sea);
  ship.pivot.position.y = wave.height * 0.92 - 0.15;
  ship.pivot.rotation.z = -wave.dx * 0.75;
  ship.pivot.rotation.x = wave.dz * 1.15;
}

function announceReady() {
  if (announced) return;
  announced = true;
  if (!EMBEDDED) return;
  try {
    window.parent.postMessage({ type: 'ocean-ready' }, location.origin);
  } catch {}
}

function frameLoop(timeMs) {
  if (disposed) return;
  const nowMs = typeof timeMs === 'number' ? timeMs : performance.now();
  const frame = clock.sample(nowMs);
  if (frame.render) renderFrame(frame.dt);
}

function syncLifecycle() {
  if (!booted || disposed) return;

  if (wantsAnimation()) {
    if (!loopOn) {
      loopOn = true;
      clock.reset(performance.now());
      renderer.setAnimationLoop(frameLoop);
    }
    seaState.resume();
    stillFrameNeeded = false;
    return;
  }

  if (loopOn) {
    loopOn = false;
    renderer.setAnimationLoop(null);
  }
  voyage?.flush();
  seaState.pause();

  if (owesStillFrame({
    booted: true,
    enabled: settings.enabled,
    visible: settings.visible,
    running: settings.running,
    hidden: document.hidden,
    stillFrameNeeded,
  })) {
    stillFrameNeeded = false;
    renderFrame(0);
  }
}

function applyCamera() {
  if (!camera) return;
  camera.position.set(cameraXForShip(travelX, SHIP_X, settings.cameraXOffset), settings.cameraHeight, settings.cameraDistance);
  camera.rotation.set(-THREE.MathUtils.degToRad(settings.cameraPitch), 0, 0);
}

function syncWorldPosition() {
  const cameraX = cameraXForShip(travelX, SHIP_X, settings.cameraXOffset);
  if (camera) camera.position.x = cameraX;
  if (vesselRoot) vesselRoot.position.x = travelX;
  if (ocean) ocean.position.x = cameraX;
  if (sky) sky.position.x = cameraX;
  if (sunLight) {
    sunLight.position.x = travelX + PALETTE.sunDir.x * 120;
    sunLight.target.position.x = travelX;
  }
  uniforms.uWorldOffset.value = cameraX;
  uniforms.uShipPos.value.set(toWorldX(SHIP_X, travelX), 0, 0);
}

function applyQuality() {
  quality = settings.quality;
  if (!renderer) return;
  renderer.setPixelRatio(pixelRatioFor(quality));
  renderer.setSize(window.innerWidth, window.innerHeight);
  clock.setTargetFps(targetFpsForQuality(quality));
}

function applySettings(next) {
  if (!next || typeof next !== 'object' || disposed) return;
  const previousQuality = quality;
  const previousDistance = settings.cameraDistance;
  const previousHeight = settings.cameraHeight;
  const previousPitch = settings.cameraPitch;
  const previousOffset = settings.cameraXOffset;
  if (Number.isFinite(next.cameraDistance)) settings.cameraDistance = Math.min(100, Math.max(20, next.cameraDistance));
  if (Number.isFinite(next.cameraHeight)) settings.cameraHeight = Math.min(40, Math.max(2, next.cameraHeight));
  if (Number.isFinite(next.cameraPitch)) settings.cameraPitch = Math.min(60, Math.max(-30, next.cameraPitch));
  if (Number.isFinite(next.cameraXOffset)) settings.cameraXOffset = normalizeCameraXOffset(next.cameraXOffset);
  const cameraChanged = settings.cameraDistance !== previousDistance
    || settings.cameraHeight !== previousHeight || settings.cameraPitch !== previousPitch
    || settings.cameraXOffset !== previousOffset;

  if (typeof next.strength === 'number' && Number.isFinite(next.strength)) {
    settings.strength = Math.min(1, Math.max(0, next.strength));
    document.documentElement.style.setProperty('--ocean-strength', String(settings.strength));
  }
  if (typeof next.enabled === 'boolean') settings.enabled = next.enabled;
  if (typeof next.running === 'boolean') settings.running = next.running;
  if (typeof next.visible === 'boolean') settings.visible = next.visible;
  if (next.quality === 'balanced' || next.quality === 'high') settings.quality = next.quality;

  const hasSession = Object.prototype.hasOwnProperty.call(next, 'sessionId');
  if (hasSession) {
    voyage?.flush();
    pendingSession = next.sessionId === null || next.sessionId === undefined
      ? null
      : String(next.sessionId);
  }

  if (settings.enabled && settings.visible && !document.hidden) ensureBoot();

  if (booted) {
    if (cameraChanged) {
      applyCamera();
      stillFrameNeeded = true;
    }
    if (settings.quality !== previousQuality) applyQuality();
    if (hasSession) seaState.setSession(pendingSession);
  }

  syncLifecycle();
}

function onMessage(event) {
  if (event.origin !== location.origin || (EMBEDDED && event.source !== window.parent)) return;
  const data = event.data;
  if (!data || typeof data !== 'object' || data.type !== 'ocean-settings') return;
  settingsReceived = true;
  applySettings(data.settings && typeof data.settings === 'object' ? data.settings : {});
}

function onResize() {
  if (!renderer || !camera) return;
  camera.aspect = window.innerWidth / Math.max(1, window.innerHeight);
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function onVisibility() {
  if (disposed) return;
  ensureBoot();
  syncLifecycle();
}

function dispose() {
  if (disposed) return;
  disposed = true;

  if (loopOn && renderer) {
    try {
      renderer.setAnimationLoop(null);
    } catch {}
  }
  loopOn = false;

  window.removeEventListener('resize', onResize);
  window.removeEventListener('message', onMessage);
  document.removeEventListener('visibilitychange', onVisibility);
  window.removeEventListener('pagehide', dispose);

  try { voyage?.dispose(); } catch {}
  voyage = null;
  try { seaState?.dispose(); } catch {}
  try { fleet?.dispose(); } catch {}
  try { wind?.dispose(); } catch {}
  try { scenery?.dispose(); } catch {}
  try { disposeObject3D(dinghy?.pivot, scene); } catch {}

  if (renderer) {
    try { renderer.dispose(); } catch {}
    try { renderer.forceContextLoss(); } catch {}
    try { renderer.domElement.remove(); } catch {}
  }

  ship = null;
  dinghy = null;
  fleet = null;
  seaState = null;
  wind = null;
  scenery = null;
  ocean = null;
  sky = null;
  scene = null;
  camera = null;
  vesselRoot = null;
  sunLight = null;
  renderer = null;
  stage = null;
  booted = false;
}

window.addEventListener('message', onMessage);
window.addEventListener('resize', onResize);
document.addEventListener('visibilitychange', onVisibility);
window.addEventListener('pagehide', dispose);

document.documentElement.style.setProperty('--ocean-strength', String(settings.strength));

if (!EMBEDDED) ensureBoot();

function advance(seconds, step = 0.05) {
  let left = Math.max(0, seconds);
  while (left > 0) {
    const dt = Math.min(step, left);
    renderFrame(dt, false);
    left -= dt;
  }
}

if (!EMBEDDED || params.get('debug') === '1') {
  window.__ocean = {
    advance,
    uniforms,
    dispose,
    applySettings,
    boot: () => {
      if (booted || disposed) return;
      settingsReceived = true;
      boot();
    },
    setRunning: (value) => applySettings({ running: value }),
    setSession: (sessionId) => applySettings({ sessionId }),
    get settings() { return { ...settings }; },
    get seaState() { return seaState; },
    get scene() { return scene; },
    get camera() { return camera; },
    get renderer() { return renderer; },
    get booted() { return booted; },
    get announced() { return announced; },
    get travelX() { return travelX; },
    get ship() { return ship; },
    get fleet() { return fleet; },
    get voyage() { return voyage; },
  };
}
