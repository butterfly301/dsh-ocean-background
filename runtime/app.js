import * as THREE from 'three';
import { createUniforms, DAY_PALETTE } from './env/palette.js';
import { qualityProfile, pixelRatioFor } from './env/quality.js';
import { createSeaState, amplitudeForLevel } from './sim/sea-state.js';
import { createFrameClock } from './sim/clock.js';
import { modeOf, wantsLoop, wantsStillFrame } from './sim/lifecycle.js';
import { advanceVoyage } from './sim/world-motion.js';
import { resolveRandom } from './sim/random.js';
import { createVoyageReporter } from './sim/voyage.js';
import { createWorld } from './world/index.js';
import { createSnapshotFeed } from './io/snapshot-feed.js';
import { PROTOCOL_VERSION, MESSAGE, normalizeSettings, readMessage } from './protocol.js';

const DEFAULT_CAMERA = { fov: 34, near: 0.5, far: 3000 };

function message(type, extra) {
  return { v: PROTOCOL_VERSION, type, ...extra };
}

export function createApp({ embedded = false, params = new URLSearchParams() } = {}) {
  const seedParam = Number(params.get('seed'));
  const random = resolveRandom(Number.isFinite(seedParam) ? seedParam : undefined);
  const freeze = params.get('freeze') === '1';
  const freezeAt = Number(params.get('t'));
  const reducedMotion = typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const uniforms = createUniforms();
  const clock = createFrameClock({ targetFps: qualityProfile('balanced').targetFps });
  const seaState = createSeaState();

  let settings = normalizeSettings({ running: freeze ? false : true });
  let stage = null;
  let renderer = null;
  let scene = null;
  let camera = null;
  let world = null;
  let voyage = null;
  let feed = null;
  let travelX = 0;
  let elapsed = 0;
  let shipFurl = 0;
  let booted = false;
  let failed = false;
  let disposed = false;
  let loopOn = false;
  let announced = false;
  let settingsReceived = false;
  let stillFrameNeeded = true;
  let latestSnapshot = null;
  let selectedSessionId = null;
  let rootSessionId = null;
  let agentRunning = false;

  function post(payload) {
    if (!embedded) return;
    try {
      window.parent.postMessage(payload, location.origin);
    } catch {}
  }

  function announceReady() {
    if (announced) return;
    announced = true;
    if (!embedded) return;
    post(message(MESSAGE.ready));
  }

  function fail(stage, error) {
    failed = true;
    console.error(`[ocean] ${stage} failed`, error);
    if (!embedded) return;
    post(message(MESSAGE.error, {
      stage,
      message: error instanceof Error ? error.message : String(error),
    }));
  }

  function wantsAnimation() {
    return wantsLoop(currentMode());
  }

  function currentMode() {
    return modeOf({
      disposed,
      failed,
      booted,
      enabled: settings.enabled,
      running: settings.running,
      hidden: document.hidden,
    });
  }

  function ensureBoot() {
    if (booted || failed || disposed) return;
    if (embedded && !settingsReceived) return;
    if (!settings.enabled || document.hidden) return;
    try {
      boot();
    } catch (error) {
      failed = true;
      releaseRenderer();
      fail('boot', error);
    }
  }

  function boot() {
    stage = document.getElementById('stage') || document.body;
    const profile = qualityProfile(settings.quality);

    renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: settings.quality === 'high' ? 'high-performance' : 'low-power',
    });
    renderer.setPixelRatio(pixelRatioFor(settings.quality, window.devicePixelRatio || 1));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    stage.appendChild(renderer.domElement);
    clock.setTargetFps(profile.targetFps);

    scene = new THREE.Scene();
    scene.fog = new THREE.Fog(DAY_PALETTE.skyHorizon, 60, 450);
    camera = new THREE.PerspectiveCamera(
      DEFAULT_CAMERA.fov,
      window.innerWidth / Math.max(1, window.innerHeight),
      DEFAULT_CAMERA.near,
      DEFAULT_CAMERA.far,
    );
    scene.add(camera);
    camera.position.set(0, settings.cameraHeight, settings.cameraDistance);
    camera.rotation.set(-THREE.MathUtils.degToRad(settings.cameraPitch), 0, 0);

    seaState.reset();
    world = createWorld({
      scene,
      camera,
      uniforms,
      quality: settings.quality,
      random,
      onAssetReady: () => {
        stillFrameNeeded = true;
        if (latestSnapshot && world) world.syncFleet(latestSnapshot.fleet, latestSnapshot.sessionId);
        syncLifecycle();
      },
    });
    world.applySettings(settings);
    world.syncPosition(travelX);

    voyage = createVoyageReporter({
      send: (body) => fetch('./voyage', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...body, v: PROTOCOL_VERSION }),
        keepalive: true,
      }).then((response) => {
        if (!response || !response.ok) throw new Error(`voyage ${response ? response.status : 0}`);
      }),
      getSessionId: () => selectedSessionId,
    });

    booted = true;
    if (freeze && Number.isFinite(freezeAt)) elapsed = Math.max(0, freezeAt);
    if (latestSnapshot) applySnapshotData(latestSnapshot);
    renderFrame(0, false);
    syncLifecycle();
  }

  function renderFrame(dt, credit = true) {
    if (disposed || !renderer || !scene || !camera || !world) return;
    const seconds = Math.max(0, dt);
    elapsed += seconds;

    const advanced = advanceVoyage(travelX, seconds, !reducedMotion);
    const sailed = advanced - travelX;
    if (credit && sailed > 0) voyage?.add(sailed);
    travelX = advanced;
    world.syncPosition(travelX);

    const { sea, foam } = seaState.update(seconds);
    uniforms.uSea.value = amplitudeForLevel(sea);
    uniforms.uFoam.value = foam;
    uniforms.uTime.value = elapsed;
    uniforms.uFlow.value = reducedMotion ? 0 : elapsed;

    const furlTarget = agentRunning ? 0 : 0.42;
    const furlBlend = seconds > 0 ? Math.min(1, seconds / 1.6) : 1;
    shipFurl += (furlTarget - shipFurl) * furlBlend;
    world.setFurl(shipFurl);

    world.update(seconds, {
      time: elapsed,
      flow: uniforms.uFlow.value,
      sea: uniforms.uSea.value,
      motion: !reducedMotion,
    });
    renderer.render(scene, camera);
    announceReady();
  }

  function frameLoop(timeMs) {
    if (disposed) return;
    const nowMs = typeof timeMs === 'number' ? timeMs : performance.now();
    const frame = clock.sample(nowMs);
    if (frame.render) renderFrame(frame.dt);
  }

  function releaseRenderer() {
    if (!renderer) return;
    try { renderer.setAnimationLoop(null); } catch {}
    try { renderer.dispose(); } catch {}
    try { renderer.forceContextLoss(); } catch {}
    try { renderer.domElement.remove(); } catch {}
    renderer = null;
    loopOn = false;
  }

  function syncLifecycle() {
    if (!booted || disposed) return;
    const mode = currentMode();

    if (wantsLoop(mode)) {
      if (!loopOn) {
        loopOn = true;
        clock.reset(performance.now());
        renderer.setAnimationLoop(frameLoop);
      }
      stillFrameNeeded = false;
      return;
    }

    if (loopOn) {
      loopOn = false;
      renderer.setAnimationLoop(null);
    }
    voyage?.flush();

    if (wantsStillFrame(mode) && stillFrameNeeded) {
      stillFrameNeeded = false;
      renderFrame(0, false);
    }
  }

  function applyQuality() {
    if (!renderer) return;
    const profile = qualityProfile(settings.quality);
    renderer.setPixelRatio(pixelRatioFor(settings.quality, window.devicePixelRatio || 1));
    renderer.setSize(window.innerWidth, window.innerHeight);
    clock.setTargetFps(profile.targetFps);
    world?.applySettings(settings);
    stillFrameNeeded = true;
  }

  function applySettings(next) {
    if (!next || typeof next !== 'object' || disposed) return;
    const previous = settings;
    const candidate = { ...settings, ...next };
    const normalized = normalizeSettings(candidate);
    settings = normalized;

    const cameraChanged = previous.cameraDistance !== normalized.cameraDistance
      || previous.cameraHeight !== normalized.cameraHeight
      || previous.cameraPitch !== normalized.cameraPitch
      || previous.cameraXOffset !== normalized.cameraXOffset;
    const qualityChanged = previous.quality !== normalized.quality;
    const hasSession = Object.prototype.hasOwnProperty.call(next, 'sessionId');
    if (hasSession) {
      const nextSession = typeof next.sessionId === 'string' && next.sessionId !== ''
        ? next.sessionId
        : null;
      if (nextSession !== selectedSessionId) {
        selectedSessionId = nextSession;
        voyage?.flush();
        seaState.reset();
        rootSessionId = null;
        latestSnapshot = null;
        stillFrameNeeded = true;
      }
    }

    if (normalized.enabled && !document.hidden) ensureBoot();
    if (booted) {
      if (cameraChanged || qualityChanged) world?.applySettings(settings);
      if (cameraChanged) stillFrameNeeded = true;
      if (qualityChanged) applyQuality();
    }
    syncLifecycle();
  }

  function applySnapshotData(data) {
    if (!data || typeof data !== 'object' || data.ok === false) return;
    const nextRoot = typeof data.sessionId === 'string' && data.sessionId !== ''
      ? data.sessionId
      : null;
    if (nextRoot !== rootSessionId) {
      rootSessionId = nextRoot;
      seaState.reset();
    }
    seaState.ingest({ counter: data.counter, counterEpoch: data.counterEpoch });
    agentRunning = data.agentRunning === true;
    latestSnapshot = data;
    if (world) {
      world.syncFleet(Array.isArray(data.fleet) ? data.fleet : [], nextRoot);
    }
    stillFrameNeeded = true;
    if (booted) syncLifecycle();
  }

  function onMessage(event) {
    if (disposed || event.origin !== location.origin) return;
    if (embedded && event.source !== window.parent) return;
    const payload = readMessage(event.data);
    if (!payload) return;
    if (payload.type === MESSAGE.settings) {
      settingsReceived = true;
      applySettings({
        ...(payload.settings && typeof payload.settings === 'object' ? payload.settings : {}),
        sessionId: payload.sessionId ?? null,
      });
      return;
    }
    if (payload.type === MESSAGE.snapshot) applySnapshotData(payload.snapshot);
  }

  function onResize() {
    if (!renderer || !camera) return;
    camera.aspect = window.innerWidth / Math.max(1, window.innerHeight);
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    stillFrameNeeded = true;
    syncLifecycle();
  }

  function onVisibility() {
    if (disposed) return;
    ensureBoot();
    syncLifecycle();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    try { feed?.stop(); } catch {}
    feed = null;
    if (loopOn && renderer) {
      try { renderer.setAnimationLoop(null); } catch {}
    }
    loopOn = false;
    try { voyage?.dispose(); } catch {}
    voyage = null;
    try { world?.dispose(); } catch {}
    world = null;
    releaseRenderer();
    seaState.reset();
    scene = null;
    camera = null;
    stage = null;
    booted = false;
  }

  function start() {
    if (embedded) return;
    ensureBoot();
    if (freeze) return;
    const sessionParam = params.get('sessionId');
    feed = createSnapshotFeed({
      sessionId: sessionParam === null || sessionParam === '' ? null : sessionParam,
      onSnapshot: applySnapshotData,
      onError: (error) => {
        if (error && error.name !== 'AbortError') console.warn('[ocean] snapshot feed failed', error);
      },
    });
    feed.start();
  }

  function advance(seconds, step = 0.05) {
    let left = Math.max(0, seconds);
    while (left > 0) {
      const dt = Math.min(step, left);
      renderFrame(dt, false);
      left -= dt;
    }
  }

  const debugApi = {
    advance,
    uniforms,
    dispose,
    applySettings,
    get settings() { return { ...settings }; },
    get scene() { return scene; },
    get camera() { return camera; },
    get renderer() { return renderer; },
    get world() { return world; },
    get booted() { return booted; },
    get announced() { return announced; },
    get travelX() { return travelX; },
    get voyage() { return voyage; },
    get snapshot() { return latestSnapshot; },
  };

  return {
    start,
    onMessage,
    onResize,
    onVisibility,
    dispose,
    applySettings,
    ingestSnapshot: applySnapshotData,
    debugApi,
    get mode() { return currentMode(); },
    get wantsAnimation() { return wantsAnimation(); },
  };
}
