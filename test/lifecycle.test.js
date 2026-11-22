import test from 'node:test';
import assert from 'node:assert/strict';
import { MODE, modeOf, wantsLoop, wantsStillFrame } from '../runtime/sim/lifecycle.js';

const base = {
  disposed: false,
  failed: false,
  booted: true,
  enabled: true,
  running: true,
  hidden: false,
};

test('mode precedence is explicit', () => {
  assert.equal(modeOf(base), MODE.running);
  assert.equal(modeOf({ ...base, running: false }), MODE.paused);
  assert.equal(modeOf({ ...base, booted: false }), MODE.booting);
  assert.equal(modeOf({ ...base, hidden: true }), MODE.idle);
  assert.equal(modeOf({ ...base, enabled: false }), MODE.idle);
  assert.equal(modeOf({ ...base, failed: true }), MODE.failed);
  assert.equal(modeOf({ ...base, disposed: true }), MODE.disposed);
});

test('only running animates and only paused needs a still frame', () => {
  assert.equal(wantsLoop(MODE.running), true);
  assert.equal(wantsLoop(MODE.paused), false);
  assert.equal(wantsStillFrame(MODE.paused), true);
  assert.equal(wantsStillFrame(MODE.idle), false);
});
