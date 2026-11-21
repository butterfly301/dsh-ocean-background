import * as THREE from 'three';
import { createOcean } from './ocean.js';
import { waveHeightAt, waveSlopeAt } from './wave-field.js';
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

// Inside the app the host already lays its own veil over this page, so the
// renderer adds almost none: two half-strengths multiply into a washed-out sea.
const EMBEDDED = window.parent !== window;
if (EMBEDDED) document.documentElement.classList.add('embedded');
const reducedMotion = typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// The host owns these settings. Nothing heavy starts until the first message
// says the picture is wanted, so a disabled background never loads the models.
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

// One palette object so the sky, the water and the haze can never disagree.
const PALETTE = {
  skyZenith: '#5c9cc6',
  skyHorizon: '#dceef2',
  sunDir: new THREE.Vector3(-0.42, 0.30, -0.86).normalize(),
  sunColor: '#fff2dc',
  deep: '#093a47',
  shallow: '#4fa6a4',
  foam: '#eefafa',
};

// The hull stays near the camera's follow point while its world position advances.
const SHIP_X = 0;

const uniforms = {
  uTime: { value: 0 },
  uFlow: { value: 0 },
  uSea: { value: 0.25 + (25 / 100) * 1.5 },
  uFoam: { value: 0 },
  uCloud: { value: 0.5 },
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
// Kept apart from `settings` so the last value survives until the runtime
// boots. undefined means "the host never sent a session", null means "none".
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
  // Embedded, the host's first message decides whether the picture is wanted at
  // all; booting on our own would load the models behind a disabled setting.
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

// ---- boot --------------------------------------------------------------------

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
  // Distance haze for the scenery models. The custom water and sky shaders carry
  // their own haze; this fog only reaches the islands and reefs, and its
  // near plane sits well beyond the ship so the hull stays crisp.
  scene.fog = new THREE.Fog('#d6e9ef', 170, 620);
  camera = new THREE.PerspectiveCamera(34, window.innerWidth / Math.max(1, window.innerHeight), 0.5, 3000);
  applyCamera();
  // The wind rides in camera space so its on-screen size never depends on zoom.
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
    size: 900,
    segments: quality === 'high' ? 280 : 220,
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

  // One real frame before the models arrive: the host only makes its shell
  // translucent after this message, and a paused setting must not stall it.
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
    // Boats are laid out in the visible water, not in a fixed grid, so a narrow
    // window or a dragged camera keeps the whole small fleet on screen.
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
  // The roster can arrive before the models finish loading, and the poller only
  // reports changes. Without this the children already running at load time never
  // got a boat, and nothing would retry until the roster happened to change again.
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
  // The root really changed: no boat from the old fleet may stay on the water,
  // even if the new roster happens to be empty.
  fleet.sync([], { shipX: SHIP_X, rootId: sessionId });
}

// ---- frame -------------------------------------------------------------------

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
  // The sea value is a percentage, exactly like the reference skin's slider; the
  // uniform it feeds is the 0.25–1.75 amplitude range that slider maps to.
  const seaTarget = 0.25 + ((state ? state.sea : 25) / 100) * 1.5;
  const seaBlend = seconds > 0 ? Math.min(1, seconds / 0.3) : 1;
  uniforms.uSea.value += (seaTarget - uniforms.uSea.value) * seaBlend;
  const foamTarget = state ? state.foam : 0;
  const foamBlend = seconds > 0 ? Math.min(1, seconds / 0.8) : 1;
  uniforms.uFoam.value += (foamTarget - uniforms.uFoam.value) * foamBlend;
  uniforms.uTime.value = elapsed;
  uniforms.uFlow.value = reducedMotion ? 0 : elapsed;

  // Full canvas while the agent works, a partly rolled sail while it waits.
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
  const h = waveHeightAt(worldX, 0, time, flow, sea);
  const slope = waveSlopeAt(worldX, 0, time, flow, sea);
  ship.pivot.position.y = h * 0.92 - 0.15;
  ship.pivot.rotation.z = -slope.dx * 0.75;
  ship.pivot.rotation.x = slope.dz * 1.15;
}

// The host only makes its shell translucent after this message. It follows an
// actual render, so a renderer that failed to start can never leave a blank
// window behind.
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
      // Draw at the display's pace, capped by the quality target. The first
      // sample after a resume draws with no elapsed time instead of replaying
      // the paused interval.
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
  // A paused picture still stops polling: nothing on screen consumes the data.
  seaState.pause();

  // Persisted pause: make sure the complete picture, including late models,
  // reaches the screen once. Hidden or disabled waits until it is shown again.
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

// ---- settings ----------------------------------------------------------------

function applyCamera() {
  if (!camera) return;
  camera.position.set(cameraXForShip(travelX, SHIP_X, settings.cameraXOffset), settings.cameraHeight, settings.cameraDistance);
  // Positive pitch looks down. Yaw and roll stay fixed as the position changes.
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
  // Same quality never resizes: the host reloads the frame when it wants new
  // ocean geometry, and a redundant setSize would only reallocate buffers.
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
    // The session may be a child of the root; setSession only re-asks the host,
    // and the fleet resets when the answered root actually changes.
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
  // Standalone, a page loaded in a hidden tab still has to start once shown.
  ensureBoot();
  syncLifecycle();
}

// ---- teardown ----------------------------------------------------------------

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
  // The dinghy source never sits in the scene; the fleet only holds clones of it.
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

// ---- wiring ------------------------------------------------------------------

window.addEventListener('message', onMessage);
window.addEventListener('resize', onResize);
document.addEventListener('visibilitychange', onVisibility);
window.addEventListener('pagehide', dispose);

document.documentElement.style.setProperty('--ocean-strength', String(settings.strength));

// Standalone, without a host page, the sea simply shows with its defaults.
// Embedded, the first settings message boots it.
if (!EMBEDDED) ensureBoot();

// A verification hook: a hidden tab throttles requestAnimationFrame to a crawl,
// so the scene has to be steppable by hand to inspect an arrival, a departure or
// a sail change without waiting for a visible window.
function advance(seconds, step = 0.05) {
  let left = Math.max(0, seconds);
  while (left > 0) {
    const dt = Math.min(step, left);
    renderFrame(dt, false);
    left -= dt;
  }
}

window.__ocean = {
  advance,
  uniforms,
  dispose,
  applySettings,
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
  // Read-only handles for verification: neither state has another way to be
  // inspected without a live agent driving it.
  get ship() { return ship; },
  get fleet() { return fleet; },
  get voyage() { return voyage; },
};
