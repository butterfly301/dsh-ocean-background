import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createFlagStore, detectImageFormat, MAX_FLAG_BYTES } from '../host/flag-store.js';
import { installRoutes } from '../host/routes.js';
import { createMileageLedger } from '../host/mileage/ledger.js';
import { createSnapshotReader } from '../host/snapshot.js';

const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13]);
const JPEG_HEADER = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0, 16, 0x4A, 0x46, 0x49, 0x46, 0, 1]);
const WEBP_HEADER = Buffer.from('RIFF\x20\x00\x00\x00WEBPVP8 ', 'latin1');

function requestBinary(handler, { method = 'GET', url = '/', body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = Readable.from(body === null ? [] : [body]);
    req.method = method;
    req.url = url;
    req.headers = body ? { 'content-length': String(body.byteLength) } : {};
    const res = {
      status: 0,
      headers: {},
      body: null,
      writeHead(status, headers) {
        this.status = status;
        this.headers = headers ?? {};
      },
      end(chunk) {
        this.body = chunk ?? null;
        resolve(this);
      },
    };
    handler(req, res);
    setTimeout(() => reject(new Error('route timed out')), 3000).unref?.();
  });
}

test('detectImageFormat accepts PNG/JPEG/WebP and rejects SVG/arbitrary data', () => {
  assert.equal(detectImageFormat(PNG_HEADER)?.mime, 'image/png');
  assert.equal(detectImageFormat(JPEG_HEADER)?.mime, 'image/jpeg');
  assert.equal(detectImageFormat(WEBP_HEADER)?.mime, 'image/webp');
  assert.equal(detectImageFormat(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
});

test('flag routes store, serve, reject invalid/oversized, and reset custom flag', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-ocean-flag-'));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const flagStore = createFlagStore({ dir });
  const ledger = createMileageLedger({ dir: null });
  const ctx = { get: () => null };
  const readSnapshot = createSnapshotReader({ ctx, ledger });
  let options;
  installRoutes({ ...ctx, webServer: { register: (input) => { options = input; return () => {}; } } }, {
    ledger,
    readSnapshot,
    flagStore,
  });

  // Initial state: no custom flag
  const initRes = await requestBinary(options.handler, { url: '/ocean-background/flag' });
  assert.equal(initRes.status, 200);
  assert.equal(JSON.parse(initRes.body.toString()).hasCustom, false);

  // Reject SVG
  const svgRes = await requestBinary(options.handler, {
    method: 'POST',
    url: '/ocean-background/flag',
    body: Buffer.from('<svg><script>alert(1)</script></svg>'),
  });
  assert.equal(svgRes.status, 415);

  // Reject > 2MB
  const big = Buffer.alloc(MAX_FLAG_BYTES + 1);
  PNG_HEADER.copy(big);
  const bigRes = await requestBinary(options.handler, {
    method: 'POST',
    url: '/ocean-background/flag',
    body: big,
  });
  assert.equal(bigRes.status, 413);

  // Accept PNG and serve image
  const okRes = await requestBinary(options.handler, {
    method: 'POST',
    url: '/ocean-background/flag',
    body: PNG_HEADER,
  });
  assert.equal(okRes.status, 200);
  assert.equal(JSON.parse(okRes.body.toString()).hasCustom, true);
  const storedFiles = await readdir(dir);
  assert.equal(storedFiles.some((f) => f.endsWith('.tmp')), false);

  const imgRes = await requestBinary(options.handler, { url: '/ocean-background/flag/image' });
  assert.equal(imgRes.status, 200);
  assert.equal(imgRes.headers['content-type'], 'image/png');
  assert.deepEqual(imgRes.body, PNG_HEADER);

  // Reset via DELETE
  const delRes = await requestBinary(options.handler, { method: 'DELETE', url: '/ocean-background/flag' });
  assert.equal(delRes.status, 200);
  assert.equal(JSON.parse(delRes.body.toString()).hasCustom, false);

  const emptyImgRes = await requestBinary(options.handler, { url: '/ocean-background/flag/image' });
  assert.equal(emptyImgRes.status, 204);
});
