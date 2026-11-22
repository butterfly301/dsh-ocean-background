import test from 'node:test';
import assert from 'node:assert/strict';
import { createFrameClock, MAX_FRAME_DELTA } from '../runtime/sim/clock.js';

test('a 30fps clock skips frames inside the cadence', () => {
  const clock = createFrameClock({ targetFps: 30 });
  assert.deepEqual(clock.sample(0), { render: true, dt: 0 });
  assert.equal(clock.sample(5).render, false);
  const frame = clock.sample(34);
  assert.equal(frame.render, true);
  assert.ok(Math.abs(frame.dt - 0.034) < 1e-9);
});

test('long pauses clamp the delta and drop the backlog', () => {
  const clock = createFrameClock({ targetFps: 30 });
  clock.sample(0);
  const frame = clock.sample(5000);
  assert.equal(frame.render, true);
  assert.equal(frame.dt, MAX_FRAME_DELTA);
  assert.equal(clock.sample(5010).render, false);
});

test('changing the target rate takes effect on the next frame', () => {
  const clock = createFrameClock({ targetFps: 30 });
  clock.sample(1000);
  clock.setTargetFps(60);
  assert.ok(Math.abs(clock.targetFps - 60) < 1e-9);
  assert.equal(clock.sample(1010).render, false);
  assert.equal(clock.sample(1020).render, true);
});

test('a clock reset re-primes without a huge delta', () => {
  const clock = createFrameClock({ targetFps: 60 });
  clock.sample(0);
  clock.sample(100);
  clock.reset(5000);
  const frame = clock.sample(5000);
  assert.equal(frame.render, true);
  assert.equal(frame.dt, 0);
});
