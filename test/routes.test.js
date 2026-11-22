import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { installRoutes } from '../host/routes.js';
import { createSnapshotReader } from '../host/snapshot.js';
import { createMileageLedger } from '../host/mileage/ledger.js';
import { createFoldState } from '../host/session-facts.js';

function makeSession(id, events, header = { origin: 'main' }) {
  return {
    id,
    seq: events.length,
    inheritedEventCount: 0,
    header,
    eventAt: (index) => events[index],
  };
}

function fakeContext() {
  const sessions = new Map();
  sessions.set('root-1', makeSession('root-1', [
    { type: 'user/message', surfaceOp: 'append', time: 1000, data: { role: 'user', source: { kind: 'user' } } },
    {
      type: 'assistant/message',
      data: {
        turn: 1,
        step: 1,
        usage: { inputTokens: 100, outputTokens: 40, cacheReadTokens: 10, cacheWriteTokens: 0 },
      },
    },
  ]));
  sessions.set('child-1', makeSession('child-1', [
    { type: 'turn/start', data: {} },
    {
      type: 'assistant/message',
      data: { turn: 1, step: 1, usage: { inputTokens: 20, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 } },
    },
  ]));
  const services = {
    sessions: {
      get: (id) => sessions.get(id),
    },
    subagents: {
      listDescendants: async (rootId) => (rootId === 'root-1'
        ? [{ id: 'child-1', name: 'boat one', running: true, mode: 'interactive' }]
        : []),
    },
    dshHomePath: () => null,
    logger: { warn: () => {} },
  };
  return { get: (key) => services[key] };
}

function request(handler, { method = 'GET', url = '/', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === null ? null : Buffer.from(JSON.stringify(body));
    const req = Readable.from(payload === null ? [] : [payload]);
    req.method = method;
    req.url = url;
    req.headers = headers;
    if (payload !== null) req.headers['content-length'] = String(payload.byteLength);
    const res = {
      status: 0,
      headers: {},
      body: null,
      writeHead(status, responseHeaders) {
        this.status = status;
        this.headers = responseHeaders ?? {};
      },
      end(chunk) {
        this.body = chunk ?? null;
        resolve(this);
      },
    };
    try {
      handler(req, res);
    } catch (error) {
      reject(error);
    }
    setTimeout(() => reject(new Error('route timed out')), 3000).unref?.();
  });
}

async function setup() {
  const ctx = fakeContext();
  const ledger = createMileageLedger({ dir: null });
  const readSnapshot = createSnapshotReader({ ctx, ledger });
  let options;
  const fakeWebServer = { register: (input) => { options = input; return () => {}; } };
  installRoutes({ ...ctx, webServer: fakeWebServer }, { ledger, readSnapshot });
  return { handler: options.handler, ledger };
}

test('the snapshot route aggregates the fleet and the mileage view', async () => {
  const { handler } = await setup();
  const res = await request(handler, { url: '/ocean-background/snapshot?sessionId=root-1' });
  assert.equal(res.status, 200);
  assert.match(res.headers['cache-control'], /no-store/);
  const payload = JSON.parse(res.body.toString('utf8'));
  assert.equal(payload.ok, true);
  assert.equal(payload.sessionId, 'root-1');
  assert.equal(payload.agentRunning, false);
  assert.equal(payload.fleet.length, 1);
  assert.equal(payload.fleet[0].id, 'child-1');
  assert.equal(payload.fleet[0].status, 'working');
  assert.equal(payload.counter, 175);
  assert.equal(payload.mileage.eligible, true);
  assert.equal(payload.mileage.ok, true);
  assert.equal(payload.mileage.mode, 'fleet');
});

test('an empty selection returns the calm snapshot', async () => {
  const { handler } = await setup();
  const res = await request(handler, { url: '/ocean-background/snapshot' });
  assert.equal(res.status, 200);
  const payload = JSON.parse(res.body.toString('utf8'));
  assert.equal(payload.sessionId, null);
  assert.equal(payload.counter, null);
  assert.deepEqual(payload.fleet, []);
});

test('voyage posts are credited against the resolved root', async () => {
  const { handler } = await setup();
  const first = await request(handler, {
    method: 'POST',
    url: '/ocean-background/voyage',
    body: { instanceId: 'i-1', sessionId: 'root-1', travelX: 0 },
  });
  assert.equal(first.status, 200);
  const second = await request(handler, {
    method: 'POST',
    url: '/ocean-background/voyage',
    body: { instanceId: 'i-1', sessionId: 'root-1', travelX: 120 },
  });
  const payload = JSON.parse(second.body.toString('utf8'));
  assert.equal(payload.creditedMeters, 120);
  assert.equal(payload.mileage.fleetMeters, 120);
});

test('bad voyage bodies are rejected', async () => {
  const { handler } = await setup();
  const res = await request(handler, {
    method: 'POST',
    url: '/ocean-background/voyage',
    body: { instanceId: '', travelX: -1 },
  });
  assert.equal(res.status, 400);
});

test('the protocol module is served from the runtime bundle', async () => {
  const { handler } = await setup();
  const res = await request(handler, { url: '/ocean-background/protocol.js' });
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /javascript/);
  assert.match(res.body.toString('utf8'), /PROTOCOL_VERSION/);
});

test('vendored assets revalidate with an etag', async () => {
  const { handler } = await setup();
  const res = await request(handler, { url: '/ocean-background/vendor/THREE-LICENSE.txt' });
  assert.equal(res.status, 200);
  assert.match(res.headers['cache-control'], /no-cache/);
  assert.ok(res.headers.etag);
  const cached = await request(handler, {
    url: '/ocean-background/vendor/THREE-LICENSE.txt',
    headers: { 'if-none-match': res.headers.etag },
  });
  assert.equal(cached.status, 304);
});

test('locales fall back to english and reject unknown languages', async () => {
  const { handler } = await setup();
  const zh = await request(handler, { url: '/ocean-background/locale/zh.json' });
  assert.equal(zh.status, 200);
  assert.equal(JSON.parse(zh.body.toString('utf8')).ui.open, '海景设置');

  const fallback = await request(handler, { url: '/ocean-background/locale/xx.json' });
  assert.equal(fallback.status, 200);
  assert.equal(JSON.parse(fallback.body.toString('utf8')).lang, 'en');

  const bad = await request(handler, { url: '/ocean-background/locale/..%2Fpackage.json' });
  assert.ok(bad.status === 400 || bad.status === 404);
});

test('path traversal and unknown methods are refused', async () => {
  const { handler } = await setup();
  const traversal = await request(handler, { url: '/ocean-background/..%2F..%2Fpackage.json' });
  assert.ok(traversal.status === 403 || traversal.status === 404);
  const wrongMethod = await request(handler, { method: 'POST', url: '/ocean-background/snapshot' });
  assert.equal(wrongMethod.status, 405);
});
