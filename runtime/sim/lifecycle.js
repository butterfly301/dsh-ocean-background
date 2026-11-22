// One reducer decides what the renderer should do. Every boolean that used to
// gate the loop lives in the input, so the transitions are testable without a
// renderer.

export const MODE = Object.freeze({
  idle: 'idle',
  booting: 'booting',
  paused: 'paused',
  running: 'running',
  failed: 'failed',
  disposed: 'disposed',
});

export function modeOf(input) {
  if (input.disposed) return MODE.disposed;
  if (input.failed) return MODE.failed;
  if (!input.enabled || input.hidden) return MODE.idle;
  if (!input.booted) return MODE.booting;
  if (!input.running) return MODE.paused;
  return MODE.running;
}

export function wantsLoop(mode) {
  return mode === MODE.running;
}

export function wantsStillFrame(mode) {
  return mode === MODE.paused;
}
