import test from 'node:test';
import assert from 'node:assert/strict';
import { createSeaState, amplitudeForLevel, SEA_FLOOR } from '../runtime/sim/sea-state.js';

function fakeClock() {
  let now = 0;
  return {
    now: () => now,
    advance: (ms) => { now += ms; },
  };
}

function closeTo(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
}

test('token growth raises the sea and a stable counter holds it', () => {
  const clock = fakeClock();
  const sea = createSeaState({ now: clock.now });
  assert.equal(sea.sea, SEA_FLOOR);

  sea.ingest({ counter: 100, counterEpoch: 'a' });
  clock.advance(1000);
  sea.ingest({ counter: 400, counterEpoch: 'a' });
  clock.advance(500);
  sea.update(0.5);
  assert.ok(sea.sea > SEA_FLOOR);

  sea.ingest({ counter: 400, counterEpoch: 'a' });
  clock.advance(1000);
  sea.update(1);
  assert.ok(sea.rate >= 0);
});

test('a fleet composition change rebases instead of spiking', () => {
  const clock = fakeClock();
  const sea = createSeaState({ now: clock.now });
  sea.ingest({ counter: 100, counterEpoch: 'one' });
  clock.advance(1000);
  sea.ingest({ counter: 200, counterEpoch: 'one' });
  const before = sea.rate;

  clock.advance(1000);
  sea.ingest({ counter: 20, counterEpoch: 'two' });
  closeTo(sea.rate, before);

  clock.advance(1000);
  sea.ingest({ counter: 120, counterEpoch: 'two' });
  assert.ok(sea.rate > 0);
});

test('a decreasing counter never creates negative throughput', () => {
  const clock = fakeClock();
  const sea = createSeaState({ now: clock.now });
  sea.ingest({ counter: 500, counterEpoch: 'a' });
  clock.advance(1000);
  sea.ingest({ counter: 300, counterEpoch: 'a' });
  clock.advance(500);
  sea.update(0.5);
  assert.ok(sea.rate >= 0);
  assert.ok(sea.sea >= SEA_FLOOR);
});

test('idle time decays the rate and the sea', () => {
  const clock = fakeClock();
  const sea = createSeaState({ now: clock.now });
  sea.ingest({ counter: 0, counterEpoch: 'a' });
  clock.advance(1000);
  sea.ingest({ counter: 4000, counterEpoch: 'a' });
  clock.advance(100);
  sea.update(0.1);
  const busy = sea.rate;
  assert.ok(busy > 0);

  clock.advance(10000);
  for (let index = 0; index < 40; index += 1) {
    clock.advance(100);
    sea.update(0.1);
  }
  assert.ok(sea.rate < busy);
  assert.ok(sea.sea < 100);
});

test('reset returns the model to rest', () => {
  const clock = fakeClock();
  const sea = createSeaState({ now: clock.now });
  sea.ingest({ counter: 0, counterEpoch: 'a' });
  clock.advance(1000);
  sea.ingest({ counter: 900, counterEpoch: 'a' });
  sea.reset();
  assert.equal(sea.sea, SEA_FLOOR);
  assert.equal(sea.rate, 0);
  assert.equal(sea.foam, 0);
});

test('amplitude maps the level range onto the shader range', () => {
  assert.equal(amplitudeForLevel(25), 0.5);
  assert.equal(amplitudeForLevel(100), 2.5);
  assert.equal(amplitudeForLevel(0), 0.5);
  assert.equal(amplitudeForLevel(999), 2.5);
});
