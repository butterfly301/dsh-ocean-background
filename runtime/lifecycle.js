
export const MAX_FRAME_DELTA = 0.25;

const CADENCE_EPSILON_MS = 2;

export function targetFpsForQuality(quality) {
  return quality === 'high' ? 60 : 30;
}

export function shouldAnimate({ booted, enabled, visible, running, hidden }) {
  return Boolean(booted && enabled && visible && running && !hidden);
}

export function owesStillFrame({
  booted, enabled, visible, running, hidden, stillFrameNeeded,
}) {
  return Boolean(booted && enabled && visible && !running && !hidden && stillFrameNeeded);
}

function normalizeTarget(targetFps) {
  const value = Number(targetFps);
  return Number.isFinite(value) && value > 0 ? value : 30;
}

export function createFrameClock({ targetFps = 30, maxDelta = MAX_FRAME_DELTA } = {}) {
  let periodMs = 1000 / normalizeTarget(targetFps);
  let lastRenderMs = null;
  let nextDueMs = null;
  let primed = false;

  return {
    get targetFps() {
      return 1000 / periodMs;
    },

    setTargetFps(next) {
      periodMs = 1000 / normalizeTarget(next);
      if (lastRenderMs !== null) nextDueMs = lastRenderMs + periodMs;
    },

    reset(nowMs) {
      const now = Number.isFinite(nowMs) ? nowMs : null;
      lastRenderMs = now;
      nextDueMs = now === null ? null : now + periodMs;
      primed = false;
    },

    sample(nowMs) {
      const now = Number.isFinite(nowMs) ? nowMs : 0;

      if (!primed || lastRenderMs === null || nextDueMs === null || now < lastRenderMs) {
        primed = true;
        lastRenderMs = now;
        nextDueMs = now + periodMs;
        return { render: true, dt: 0 };
      }

      if (now + CADENCE_EPSILON_MS < nextDueMs) return { render: false, dt: 0 };

      const dt = Math.min(maxDelta, Math.max(0, (now - lastRenderMs) / 1000));
      lastRenderMs = now;
      nextDueMs += periodMs;
      if (nextDueMs <= now) {
        const missed = Math.ceil((now - nextDueMs) / periodMs) + 1;
        nextDueMs += missed * periodMs;
      }
      return { render: true, dt };
    },
  };
}
