import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createBerthAllocator,
  viewForCamera,
  normalizeStatus,
  phaseFor,
  isTerminal,
  rowsOars,
} from '../runtime/sim/berth.js';

test('view span follows the camera', () => {
  const view = viewForCamera({ cameraX: 5, cameraDistance: 44, fovDeg: 34, aspect: 16 / 9 });
  assert.ok(view.minX < view.maxX);
  assert.ok(Math.abs((view.minX + view.maxX) / 2 - 5) < 1e-9);
  const narrow = viewForCamera({ cameraX: 5, aspect: 0.5 });
  assert.ok(narrow.maxX - narrow.minX < view.maxX - view.minX);
});

test('allocator hands out stable unique slots', () => {
  const allocator = createBerthAllocator();
  const a = allocator.reserve('a', 0, { minX: -8, maxX: 18 });
  const b = allocator.reserve('b', 0);
  const again = allocator.reserve('a', 0);
  assert.notEqual(a.slot, b.slot);
  assert.deepEqual(again, a);
  assert.equal(allocator.size, 2);

  allocator.remove('a');
  const c = allocator.reserve('c', 0);
  assert.equal(c.slot, 0);
});

test('berths stay inside the visible span', () => {
  const allocator = createBerthAllocator();
  for (let index = 0; index < 24; index += 1) {
    const berth = allocator.reserve(`id-${index}`, 0, { minX: -6, maxX: 12 });
    assert.ok(berth.x >= -6 - 0.001);
    assert.ok(berth.x <= 12 + 0.001);
    assert.ok(Math.abs(berth.z) >= 5);
  }
});

test('view changes move existing berths', () => {
  const allocator = createBerthAllocator();
  allocator.reserve('a', 0, { minX: -20, maxX: 20 });
  const wide = allocator.reserve('a', 0);
  allocator.setView({ minX: -4, maxX: 4 });
  const narrow = allocator.reserve('a', 0);
  assert.notEqual(wide.x, narrow.x);
});

test('status mapping matches the fleet contract', () => {
  assert.equal(normalizeStatus({ status: 'working' }), 'working');
  assert.equal(normalizeStatus({ running: true }), 'working');
  assert.equal(normalizeStatus({ running: false }), 'completed');
  assert.equal(normalizeStatus({}), 'unavailable');
  assert.equal(isTerminal('completed'), true);
  assert.equal(isTerminal('working'), false);
  assert.equal(rowsOars('working'), true);
  assert.equal(rowsOars('waiting'), false);
});

test('phase transitions bring a finished boat back to entering', () => {
  assert.equal(phaseFor('working', 'leaving'), 'entering');
  assert.equal(phaseFor('completed', 'berthed'), 'leaving');
  assert.equal(phaseFor('working', 'entering'), 'entering');
  assert.equal(phaseFor('working', 'berthed'), 'berthed');
});
