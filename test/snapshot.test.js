import test from 'node:test';
import assert from 'node:assert/strict';
import { PROTOCOL_VERSION } from '../runtime/protocol.js';
import { emptySnapshot, snapshotErrorPayload } from '../host/snapshot.js';

function fakeLedger() {
  return {
    view(rootId, eligible) {
      return {
        ok: true,
        sessionId: rootId,
        eligible,
        mode: eligible ? 'fleet' : 'today',
        day: '2026-01-01',
        todayMeters: 12,
        fleetMeters: 34,
      };
    },
    hasForkRoot() {
      return false;
    },
  };
}

test('an empty session reports a calm snapshot', () => {
  const snapshot = emptySnapshot(fakeLedger());
  assert.equal(snapshot.v, PROTOCOL_VERSION);
  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.sessionId, null);
  assert.equal(snapshot.agentRunning, false);
  assert.deepEqual(snapshot.fleet, []);
  assert.equal(snapshot.counter, null);
  assert.equal(snapshot.mileage.mode, 'today');
  assert.equal(snapshot.mileage.eligible, false);
});

test('an error snapshot keeps the same field set', () => {
  const snapshot = snapshotErrorPayload(new Error('broken'));
  assert.equal(snapshot.ok, false);
  assert.equal(snapshot.error, 'broken');
  assert.deepEqual(snapshot.fleet, []);
  assert.equal(snapshot.mileage.ok, false);
  assert.equal(snapshot.tokensComplete, false);
});
