// Sea state and fleet, fed by the Host half.
//
// This follows Open Sea Skin 2.1.0's throughput path: sample the cached +
// uncached + output token counters, take the positive delta per second, smooth
// it with an exponential average, then map it through a saturating curve in
// percent. The cost branch and the budget-driven whitecaps are dropped because
// this plugin drives the sea with throughput only.
//
// Everything here is scoped to the root session the host reports. A new root
// resets both the token baseline and the wave smoothing, so switching
// conversations never mixes two histories or turns the other session's token
// count into a spike. Everything that talks to the network or schedules work is
// injectable, which keeps the lifecycle testable without a browser.

const POLL_MS = 1000;
// Reference defaults: floor 25, r0 25, smooth 4 (seconds).
const FLOOR = 25;
const SPAN = 75;
const R0 = 25;
const SMOOTH = 4;
const IDLE_AFTER_MS = 2000;
const MIN_STEP_SECONDS = 0.05;
// Smoothed tokens per second. Wave height keeps its original response curve;
// whitecaps need sustained high throughput rather than ordinary token activity.
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
  // undefined = the host never named a view; null = the host named none.
  let requestedSession;
  let started = false;
  let paused = true;
  let disposed = false;
  let snapshot = null;

  const state = {
    // Percent, 0–100, exactly like the reference skin's sea value.
    get sea() { return sea; },
    get foam() { return foam; },
    get rate() { return rate; },
    get fleet() { return fleet; },
    // The root session the numbers above belong to, as reported by the host.
    get sessionId() { return sessionId; },
    // The conversation the host was asked to report on, which may be a child
    // session of that root.
    get requestedSession() { return requestedSession; },
    // Whether the root agent has an open turn, independent of token activity.
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

    // A separate high-throughput gate permits whitecaps. Their spatial coverage
    // stays sparse in the shader even when this strength reaches one.
    const foamRate = Math.min(1, Math.max(0, (rate - FOAM_START_RATE) / (FOAM_FULL_RATE - FOAM_START_RATE)));
    const curve = foamRate * foamRate * (3 - 2 * foamRate);
    const busy = now() - lastActiveAt < IDLE_AFTER_MS;
    const target2 = busy ? curve : 0;
    foam += (target2 - foam) * Math.min(1, seconds / 1.2);
  }

  // Keeps easing while nothing arrives, so an idle session settles back to the
  // floor instead of freezing at its last value.
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

  // Applies one successful snapshot. Returns false, touching nothing, when the
  // payload is a failure: a failed sample is not an empty fleet.
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
      // The first assignment is not a switch: there is no old fleet to clear.
      if (previous !== null && onSession) onSession({ sessionId, previous });
    }

    const sampleNow = now();
    // A complete sample is the normal case. When the host cannot read one of the
    // children it reports no counters at all; that is a gap, not zero throughput.
    // The last valid counter and its timestamp are kept, so the next complete
    // sample averages over the whole gap instead of spiking or resetting to 0.
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
      // Incomplete samples keep null rather than posing as an idle second.
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

    // A new request invalidates whatever is still in flight: only the newest
    // response for the current view may touch the snapshot.
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
        // The host route is absent when the renderer is opened standalone; the
        // sea then stays calm instead of throwing every second. A failed request
        // is also not an empty fleet.
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
    // Never bridge a pause or a stop with counters that moved meanwhile.
    resetSampling();
    poll();
  }

  // Switches the conversation the host should report on. The root session comes
  // back in the snapshot; resetting sampling and waves is driven by that root
  // change, so viewing a child stays inside the same fleet. Only "nothing is
  // selected" empties the water immediately.
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
        // The host answers with no root at all; clear at once instead of
        // waiting for an empty roster that may never describe the empty view.
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
