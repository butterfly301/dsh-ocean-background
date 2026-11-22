import test from 'node:test';
import assert from 'node:assert/strict';
import { createVoyageReporter } from '../runtime/sim/voyage.js';

const STORAGE_KEY = 'ocean-background:voyage';

function memoryStorage(initial = '') {
  const map = new Map();
  if (initial !== '') map.set(STORAGE_KEY, initial);
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, value); },
    raw: () => map.get(STORAGE_KEY),
  };
}

test('travel is batched and reported once', async () => {
  const sent = [];
  const reporter = createVoyageReporter({
    send: async (body) => { sent.push(body); },
    getSessionId: () => 's-1',
    now: () => 1000,
    instanceId: 'fixed',
    storage: memoryStorage(),
  });
  reporter.add(10);
  reporter.add(5);
  assert.equal(reporter.pending, 15);
  await reporter.flush();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].travelX, 15);
  assert.equal(sent[0].sessionId, 's-1');
  assert.equal(reporter.pending, 0);
});

test('a failed send is queued again', async () => {
  let fail = true;
  const sent = [];
  const reporter = createVoyageReporter({
    send: async (body) => {
      if (fail) throw new Error('offline');
      sent.push(body);
    },
    getSessionId: () => 's-1',
    now: () => 1000,
    instanceId: 'fixed',
    storage: memoryStorage(),
  });
  reporter.add(30);
  await reporter.flush();
  assert.equal(reporter.pending, 30);
  assert.equal(sent.length, 0);

  fail = false;
  await reporter.flush();
  assert.equal(reporter.pending, 0);
  assert.equal(sent[0].travelX, 30);
});

test('a restored record sends a baseline before the new target', async () => {
  const stored = JSON.stringify({
    version: 1,
    instanceId: 'restored',
    ackedX: 5,
    travelX: 15,
    from: 900,
    to: 950,
  });
  const sent = [];
  const reporter = createVoyageReporter({
    send: async (body) => { sent.push(body); },
    getSessionId: () => 's-1',
    now: () => 2000,
    storage: memoryStorage(stored),
  });
  assert.equal(reporter.pending, 10);
  await reporter.flush();
  assert.equal(sent.length, 2);
  assert.equal(sent[0].travelX, 5);
  assert.equal(sent[1].travelX, 15);
});

test('a restored record waits for a session before reporting', async () => {
  const stored = JSON.stringify({
    version: 1,
    instanceId: 'restored',
    ackedX: 0,
    travelX: 25,
    from: null,
    to: null,
  });
  let session = null;
  const sent = [];
  const reporter = createVoyageReporter({
    send: async (body) => { sent.push(body); },
    getSessionId: () => session,
    now: () => 2000,
    storage: memoryStorage(stored),
  });
  await reporter.flush();
  assert.equal(sent.length, 0);
  assert.equal(reporter.pending, 25);

  session = 's-9';
  await reporter.flush();
  assert.equal(sent.length, 2);
  assert.equal(sent[0].travelX, 0);
  assert.equal(sent[1].travelX, 25);
});
