// Throughput to sea state. Pure arithmetic: it consumes monotonic token
// counters and produces the wave height, the foam amount and the smoothed rate.
// It never touches the network, the DOM or three.js.

export const SEA_FLOOR = 25;
export const SEA_SPAN = 75;
export const RATE_HALF_POINT = 25;
export const IDLE_AFTER_MS = 2000;
export const MIN_STEP_SECONDS = 0.05;

const RATE_SMOOTHING = 4;
// The renderer used to ease the surface toward the model with a 0.3s blend.
// That second stage is gone, so the model's own time constant carries it.
const SEA_SMOOTHING = 2.3;
const FOAM_START_RATE = 100;
const FOAM_FULL_RATE = 400;

function numberOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

// Sea level runs 25..100. The shader wants a world-space amplitude, so the
// mapping lives next to the model and is covered by tests.
export function amplitudeForLevel(level) {
  const t = Math.min(1, Math.max(0, (Number(level) - SEA_FLOOR) / SEA_SPAN));
  return 0.5 + 2.0 * t ** 1.5;
}


export function createSeaState({
  now = () => Date.now(),
  floor = SEA_FLOOR,
  span = SEA_SPAN,
  rateHalfPoint = RATE_HALF_POINT,
  idleAfterMs = IDLE_AFTER_MS,
} = {}) {
  let counter = null;
  let lastAt = null;
  let epoch = undefined;
  let rate = 0;
  let sea = floor;
  let foam = 0;
  let lastActiveAt = 0;

  function step(dtSeconds, tokensPerSecond) {
    const seconds = Math.max(0, dtSeconds);
    const instant = Math.max(0, tokensPerSecond);
    const rateAlpha = 1 - Math.exp(-seconds / Math.max(0.5, RATE_SMOOTHING));
    rate += (instant - rate) * rateAlpha;
    if (instant === 0) rate *= Math.exp(-seconds / Math.max(1, RATE_SMOOTHING * 2));

    const target = Math.max(
      0,
      Math.min(100, floor + span * (1 - Math.exp(-rate / Math.max(1, rateHalfPoint)))),
    );
    const seaAlpha = 1 - Math.exp(-seconds / Math.max(0.4, SEA_SMOOTHING / 2));
    sea += (target - sea) * seaAlpha;

    const foamRate = Math.min(
      1,
      Math.max(0, (rate - FOAM_START_RATE) / (FOAM_FULL_RATE - FOAM_START_RATE)),
    );
    const curved = foamRate * foamRate * (3 - 2 * foamRate);
    const busy = now() - lastActiveAt < idleAfterMs;
    const foamTarget = busy ? curved : 0;
    foam += (foamTarget - foam) * Math.min(1, seconds / 1.2);
  }

  function ingest(sample) {
    const at = now();
    const nextCounter = numberOrNull(sample?.counter);
    const nextEpoch = sample?.counterEpoch;

    if (nextEpoch !== epoch) {
      epoch = nextEpoch;
      counter = nextCounter;
      lastAt = nextCounter === null ? null : at;
      return;
    }

    if (nextCounter === null) {
      counter = null;
      lastAt = null;
      return;
    }

    if (counter === null || lastAt === null) {
      counter = nextCounter;
      lastAt = at;
      return;
    }

    const seconds = Math.max(MIN_STEP_SECONDS, (at - lastAt) / 1000);
    const delta = nextCounter - counter;
    if (delta > 0) {
      lastActiveAt = at;
      step(seconds, delta / seconds);
    }
    counter = nextCounter;
    lastAt = at;
  }

  function update(dtSeconds) {
    if (now() - lastActiveAt > idleAfterMs) step(dtSeconds, 0);
    return state();
  }

  function reset() {
    counter = null;
    lastAt = null;
    epoch = undefined;
    rate = 0;
    sea = floor;
    foam = 0;
    lastActiveAt = 0;
  }

  function state() {
    return { sea, foam, rate };
  }

  return {
    ingest,
    update,
    step,
    reset,
    state,
    get sea() { return sea; },
    get foam() { return foam; },
    get rate() { return rate; },
  };
}
