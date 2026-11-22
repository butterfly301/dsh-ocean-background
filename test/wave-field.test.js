import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_WAVE_HEIGHT, sampleWaveAt, waveHeightAt } from '../runtime/sim/wave-field.js';

test('the field is deterministic and bounded', () => {
  const height = waveHeightAt(12.5, -3.25, 4.2, 1.1, 1);
  assert.equal(height, waveHeightAt(12.5, -3.25, 4.2, 1.1, 1));
  assert.ok(Math.abs(height) <= MAX_WAVE_HEIGHT + 1e-9);
});

test('sea amplitude scales the field linearly', () => {
  const full = waveHeightAt(3, 7, 2, 0.5, 1);
  const half = waveHeightAt(3, 7, 2, 0.5, 0.5);
  assert.ok(Math.abs(half - full * 0.5) < 1e-9);
  assert.equal(waveHeightAt(3, 7, 2, 0.5, 0), 0);
});

test('flow and time both move the surface', () => {
  const still = waveHeightAt(1, 2, 3, 0, 1);
  assert.notEqual(still, waveHeightAt(1, 2, 3.5, 0, 1));
  assert.notEqual(still, waveHeightAt(1, 2, 3, 0.5, 1));
});

test('sample returns a finite slope', () => {
  const sample = sampleWaveAt(5, 5, 1.5, 0.2, 1.2);
  assert.ok(Number.isFinite(sample.height));
  assert.ok(Number.isFinite(sample.dx));
  assert.ok(Number.isFinite(sample.dz));
  assert.ok(Math.abs(sample.dx) < 1);
  assert.ok(Math.abs(sample.dz) < 1);
});
