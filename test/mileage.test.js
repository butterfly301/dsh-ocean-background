import test from 'node:test';
import assert from 'node:assert/strict';
import { createMileageLedger, dayKeyOf, METERS_PER_NM } from '../host/mileage/ledger.js';

function at(year, month, day, hour = 12, minute = 0) {
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime();
}

test('the ledger credits only forward travel for eligible fleets', () => {
  const now = at(2026, 5, 4);
  const ledger = createMileageLedger({ dir: null, now: () => now });

  assert.equal(ledger.credit({ instanceId: 'i', travelX: 0, rootId: 'root', eligible: true }), 0);
  assert.equal(ledger.credit({ instanceId: 'i', travelX: 100, rootId: 'root', eligible: true }), 100);
  assert.equal(ledger.view('root', true).fleetMeters, 100);
  assert.equal(ledger.view('root', true).mode, 'fleet');

  assert.equal(ledger.credit({ instanceId: 'i', travelX: 50, rootId: 'root', eligible: true }), 0);
  assert.equal(ledger.credit({ instanceId: 'i', travelX: 100, rootId: 'root', eligible: true }), 0);
  assert.equal(ledger.view('root', true).fleetMeters, 100);
});

test('ineligible travel advances the baseline without credit', () => {
  const now = at(2026, 5, 4);
  const ledger = createMileageLedger({ dir: null, now: () => now });
  ledger.credit({ instanceId: 'x', travelX: 0, rootId: 'root', eligible: false });
  assert.equal(ledger.credit({ instanceId: 'x', travelX: 500, rootId: 'root', eligible: false }), 0);
  assert.equal(ledger.view('root', false).todayMeters, 0);
  assert.equal(ledger.view('root', false).mode, 'today');
});

test('travel across local midnight is split between both days', () => {
  const day1 = at(2026, 1, 1, 23, 58);
  const day2 = at(2026, 1, 2, 0, 2);
  const ledger = createMileageLedger({ dir: null, now: () => day2 });
  ledger.credit({ instanceId: 'm', travelX: 0, rootId: 'root', eligible: true, at: day1 });
  assert.equal(
    ledger.credit({ instanceId: 'm', travelX: 100, rootId: 'root', eligible: true, at: day2, from: day1, to: day2 }),
    100,
  );
  assert.ok(Math.abs(ledger.state.days['2026-01-01'] - 50) < 1);
  assert.ok(Math.abs(ledger.state.days['2026-01-02'] - 50) < 1);
});

test('forks inherit the source fleet mileage', async () => {
  const now = at(2026, 5, 4);
  const ledger = createMileageLedger({ dir: null, now: () => now });
  ledger.credit({ instanceId: 'i', travelX: 0, rootId: 'root', eligible: true });
  ledger.credit({ instanceId: 'i', travelX: 250, rootId: 'root', eligible: true });

  const token = await ledger.beginFork('root');
  assert.equal(token.baseMeters, 250);
  assert.equal(await ledger.settleFork(token, 'child'), true);
  assert.equal(await ledger.settleFork(token, 'child'), false);
  assert.equal(ledger.hasForkRoot('child'), true);
  assert.equal(ledger.view('child', true).fleetMeters, 250);

  ledger.credit({ instanceId: 'c', travelX: 0, rootId: 'child', eligible: true });
  ledger.credit({ instanceId: 'c', travelX: 40, rootId: 'child', eligible: true });
  assert.equal(ledger.view('child', true).fleetMeters, 290);
  assert.equal(ledger.view('root', true).fleetMeters, 250);
});

test('day keys and the nautical mile constant are stable', () => {
  assert.equal(dayKeyOf(at(2026, 1, 2, 23, 59)), '2026-01-02');
  assert.equal(METERS_PER_NM, 1852);
});
