
const POLL_MS = 1000;
const FLOOR = 25;
const SPAN = 75;
const R0 = 25;
const SMOOTH = 4;
const IDLE_AFTER_MS = 2000;
const MIN_STEP_SECONDS = 0.05;
const FOAM_START_RATE = 100;
const FOAM_FULL_RATE = 400;

function defaultSetTimer(fn, ms) {
  return setTimeout(fn, ms);
}

function defaultClearTimer(id) {
  clearTimeout(id);
}

function defaultFetch(url, init) {
  return fetch(url, init);
}

function numberOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function toSessionId(value) {
  if (value === null || value === undefined) return null;
  const text = String(value);
  return text === '' ? null : text;
}

function sameChildren(previous, next) {
  if (previous.length !== next.length) return false;
  for (let i = 0; i < previous.length; i += 1) {
    const a = previous[i];
    const b = next[i];
    if (!a || !b) return false;
    if (a.id !== b.id) return false;
    if (a.running !== b.running) return false;
    if (a.status !== b.status) return false;
    if (a.title !== b.title) return false;
  }
  return true;
}

export function createSeaState({
  onFleet = null,
  onSample = null,
  onSession = null,
  fetchImpl = defaultFetch,
  now = () => Date.now(),
  setTimer = defaultSetTimer,
  clearTimer = defaultClearTimer,
  pollMs = POLL_MS,
} = {}) {
  let flow = null;
  let lastAt = null;
  let lastActiveAt = 0;
  let rate = 0;
  let sea = FLOOR;
  let foam = 0;
  let timer = null;
  let inFlight = null;
  let epoch = 0;
  let fleet = [];
  let agentRunning = false;
  let sessionId = null;
  let requestedSession;
  let started = false;
  let paused = true;
  let disposed = false;
  let snapshot = null;

  const state = {
    get sea() { return sea; },
    get foam() { return foam; },
    get rate() { return rate; },
    get fleet() { return fleet; },
    get sessionId() { return sessionId; },
    get requestedSession() { return requestedSession; },
    get agentRunning() { return agentRunning; },
  };

  function step(dtSeconds, tokensPerSecond) {
    const seconds = Math.max(0, dtSeconds);
    const instant = Math.max(0, tokensPerSecond);
    const alphaRate = 1 - Math.exp(-seconds / Math.max(0.5, SMOOTH));
    rate += (instant - rate) * alphaRate;
    if (instant === 0) rate *= Math.exp(-seconds / Math.max(1, SMOOTH * 2));

    const target = Math.max(0, Math.min(100, FLOOR + SPAN * (1 - Math.exp(-rate / Math.max(1, R0)))));
    const alphaSea = 1 - Math.exp(-seconds / Math.max(0.4, SMOOTH / 2));
    sea += (target - sea) * alphaSea;

    const foamRate = Math.min(1, Math.max(0, (rate - FOAM_START_RATE) / (FOAM_FULL_RATE - FOAM_START_RATE)));
    const curve = foamRate * foamRate * (3 - 2 * foamRate);
    const busy = now() - lastActiveAt < IDLE_AFTER_MS;
    const target2 = busy ? curve : 0;
    foam += (target2 - foam) * Math.min(1, seconds / 1.2);
  }

  function relax(dtSeconds) {
    if (now() - lastActiveAt > IDLE_AFTER_MS) step(dtSeconds, 0);
  }

  function resetSampling() {
    flow = null;
    lastAt = null;
  }

  function resetWaves() {
    rate = 0;
    sea = FLOOR;
    foam = 0;
    lastActiveAt = 0;
  }

  function abortInFlight() {
    if (!inFlight) return;
    try {
      inFlight.abort();
    } catch {}
    inFlight = null;
  }

  function cancelTimer() {
    if (timer === null) return;
    clearTimer(timer);
    timer = null;
  }

  function schedule() {
    if (disposed || paused || !started || timer !== null || inFlight !== null) return;
    timer = setTimer(() => {
      timer = null;
      poll();
    }, pollMs);
  }

  function stateUrl() {
    return requestedSession === null || requestedSession === undefined
      ? './state'
      : `./state?sessionId=${encodeURIComponent(requestedSession)}`;
  }

  function applySnapshot(data) {
    if (!data || typeof data !== 'object' || data.ok === false) return false;

    const nextSessionId = toSessionId(data.sessionId !== undefined ? data.sessionId : data.rootId);
    const previous = sessionId;
    const switched = nextSessionId !== sessionId;

    if (switched) {
      sessionId = nextSessionId;
      resetSampling();
      resetWaves();
      fleet = [];
      agentRunning = false;
      if (previous !== null && onSession) onSession({ sessionId, previous });
    }

    const sampleNow = now();
    const complete = data.tokensComplete !== false;
    const flowTokens = complete ? numberOrNull(data.flowTokens) : null;
    const counter = flowTokens !== null
      ? flowTokens
      : (complete ? numberOrNull(data.totalTokens) : null);
    if (counter !== null) {
      if (flow !== null && lastAt !== null) {
        const seconds = Math.max(MIN_STEP_SECONDS, (sampleNow - lastAt) / 1000);
        const delta = counter - flow;
        if (delta > 0) {
          lastActiveAt = sampleNow;
          step(seconds, delta / seconds);
        }
      }
      flow = counter;
      lastAt = sampleNow;
    }

    const nextChildren = Array.isArray(data.children) ? data.children.slice() : fleet;
    if (typeof data.agentRunning === 'boolean') agentRunning = data.agentRunning;
    const changed = switched || !sameChildren(fleet, nextChildren);
    fleet = nextChildren;

    snapshot = {
      ok: true,
      sessionId,
      totalTokens: complete ? (numberOrNull(data.totalTokens) ?? 0) : null,
      flowTokens: complete ? (flowTokens ?? 0) : null,
      agentRunning,
      children: fleet,
    };

    if (changed && onFleet) {
      onFleet(fleet, { sessionId, sessionChanged: switched });
    }
    if (onSample) onSample(state);
    return true;
  }

  function poll() {
    if (disposed || paused || !started) return;
    cancelTimer();

    epoch += 1;
    const myEpoch = epoch;
    abortInFlight();

    const controller = new AbortController();
    inFlight = controller;

    let request;
    try {
      request = fetchImpl(stateUrl(), { cache: 'no-store', signal: controller.signal });
    } catch {
      inFlight = null;
      schedule();
      return;
    }

    Promise.resolve(request)
      .then(async (response) => {
        if (!response || !response.ok) return;
        const data = await response.json();
        if (disposed || paused || myEpoch !== epoch) return;
        applySnapshot(data);
      })
      .catch(() => {
      })
      .finally(() => {
        const current = controller === inFlight;
        if (!current) return;
        inFlight = null;
        schedule();
      });
  }

  function start() {
    resume();
  }

  function pause() {
    if (disposed || paused) return;
    paused = true;
    cancelTimer();
    epoch += 1;
    abortInFlight();
  }

  function resume() {
    if (disposed) return;
    if (started && !paused) return;
    started = true;
    paused = false;
    resetSampling();
    poll();
  }

  function setSession(nextSession) {
    if (disposed) return false;
    const next = toSessionId(nextSession);
    if (next === requestedSession) return false;
    requestedSession = next;
    cancelTimer();
    epoch += 1;
    abortInFlight();

    if (next === null) {
      const previous = sessionId;
      if (previous !== null || fleet.length > 0) {
        sessionId = null;
        resetSampling();
        resetWaves();
        fleet = [];
        agentRunning = false;
        if (onSession) onSession({ sessionId: null, previous });
        if (onFleet) onFleet(fleet, { sessionId: null, sessionChanged: true });
      }
    }

    if (started && !paused) poll();
    return true;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    started = false;
    paused = true;
    cancelTimer();
    epoch += 1;
    abortInFlight();
    onFleet = null;
    onSample = null;
    onSession = null;
  }

  return {
    state,
    start,
    pause,
    resume,
    setSession,
    dispose,
    relax,
    step,
    get snapshot() { return snapshot; },
    get sessionId() { return sessionId; },
    get requestedSession() { return requestedSession; },
    get paused() { return paused; },
    get started() { return started; },
  };
}
