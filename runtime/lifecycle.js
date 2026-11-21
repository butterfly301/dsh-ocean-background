// Frame pacing for the runtime loop.
//
// The scene advances in real time: the animation step is the wall-clock gap
// between two drawn frames. The balanced/high setting caps how often a frame is
// drawn; it must not stretch the step. The old loop capped the step at 0.05 s,
// which turned every frame slower than 20 fps into slow motion.
//
// Kept free of DOM and three.js so the cadence can be tested with plain
// timestamps on Node's built-in test runner.

export const MAX_FRAME_DELTA = 0.25;

// Timestamps jitter by a fraction of a refresh, so a frame that lands a hair
// before its ideal slot is still due.
const CADENCE_EPSILON_MS = 2;

export function targetFpsForQuality(quality) {
  return quality === 'high' ? 60 : 30;
}

// Whether the runtime may draw and poll at all.
export function shouldAnimate({ booted, enabled, visible, running, hidden }) {
  return Boolean(booted && enabled && visible && running && !hidden);
}

// Whether a paused scene still owes exactly one frame: a persisted pause must
// draw the sky and sea (and, once they arrive, the models) or the host waits for
// a ready signal that never comes.
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
  // The ideal time for the next frame. Keeping it on a fixed grid lets a panel
  // that is not a multiple of the target (144 Hz at 60 fps) alternate intervals
  // and average the target instead of settling one refresh below it.
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

    // Called when the loop (re)starts. The next sample draws one frame with no
    // elapsed time, so a resume never replays the paused interval.
    reset(nowMs) {
      const now = Number.isFinite(nowMs) ? nowMs : null;
      lastRenderMs = now;
      nextDueMs = now === null ? null : now + periodMs;
      primed = false;
    },

    // nowMs is the rAF timestamp. Returns whether this refresh should draw and
    // the real time elapsed since the last drawn frame.
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
        // A long stall restarts the cadence instead of firing a burst of
        // catch-up frames.
        const missed = Math.ceil((now - nextDueMs) / periodMs) + 1;
        nextDueMs += missed * periodMs;
      }
      return { render: true, dt };
    },
  };
}
