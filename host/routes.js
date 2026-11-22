import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeError, logOnce } from './session-state.js';
import { snapshotErrorPayload } from './snapshot.js';

const BASE = '/ocean-background';
const SNAPSHOT_PATH = `${BASE}/snapshot`;
const VOYAGE_PATH = `${BASE}/voyage`;
const LOCALE_PREFIX = `${BASE}/locale/`;
const RUNTIME_ROOT = resolve(fileURLToPath(new URL('../runtime/', import.meta.url)));
const LOCALE_ROOT = resolve(fileURLToPath(new URL('../locale/', import.meta.url)));
const MAX_VOYAGE_BODY = 4096;
const LANG_RE = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u;

const MIME = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
});

function baseHeaders(extra) {
  return { 'x-content-type-options': 'nosniff', ...extra };
}

function finish(res, status, headers) {
  res.writeHead(status, headers ?? baseHeaders({ 'cache-control': 'no-cache' }));
  res.end();
}

function sendJson(req, res, payload, cacheControl = 'no-store') {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(200, baseHeaders({
    'cache-control': cacheControl,
    'content-length': String(body.byteLength),
    'content-type': 'application/json; charset=utf-8',
  }));
  res.end(req.method === 'HEAD' ? undefined : body);
}

function readJsonBody(req) {
  return new Promise((resolvePromise, rejectPromise) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      rejectPromise(error);
    };
    req.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > MAX_VOYAGE_BODY) {
        fail(new Error('voyage body too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      try {
        resolvePromise(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (error) {
        rejectPromise(error);
      }
    });
    req.on('error', fail);
  });
}

async function serveSnapshot(ctx, readSnapshot, req, res, url) {
  let payload;
  try {
    payload = await readSnapshot(url.searchParams.get('sessionId'));
  } catch (error) {
    logOnce(ctx, 'warn', 'snapshot', `ocean-background: snapshot failed: ${describeError(error)}`);
    payload = snapshotErrorPayload(error);
  }
  sendJson(req, res, payload);
}

async function serveVoyage(ctx, ledger, readSnapshot, req, res) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    finish(res, 400);
    return;
  }
  const instanceId = typeof body?.instanceId === 'string'
    && body.instanceId !== '' && body.instanceId.length <= 128 ? body.instanceId : null;
  const travelX = typeof body?.travelX === 'number'
    && Number.isFinite(body.travelX) && body.travelX >= 0 ? body.travelX : null;
  if (instanceId === null || travelX === null) {
    finish(res, 400);
    return;
  }

  await ledger.ready();
  let rootId = null;
  let eligible = false;
  try {
    const snapshot = await readSnapshot(typeof body?.sessionId === 'string' ? body.sessionId : null);
    rootId = snapshot.sessionId;
    eligible = snapshot.mileage?.eligible === true;
  } catch (error) {
    logOnce(ctx, 'warn', 'voyage', `ocean-background: voyage target failed: ${describeError(error)}`);
  }

  const creditedMeters = ledger.credit({
    instanceId,
    travelX,
    rootId,
    eligible,
    from: typeof body?.from === 'number' && Number.isFinite(body.from) ? body.from : undefined,
    to: typeof body?.to === 'number' && Number.isFinite(body.to) ? body.to : undefined,
  });
  sendJson(req, res, {
    ok: true,
    creditedMeters,
    mileage: { ok: true, ...ledger.view(rootId, eligible) },
  });
}

async function serveLocale(req, res, pathname) {
  const raw = pathname.slice(LOCALE_PREFIX.length);
  if (!raw.endsWith('.json')) {
    finish(res, 404);
    return;
  }
  let lang;
  try {
    lang = decodeURIComponent(raw.slice(0, -5));
  } catch {
    finish(res, 400);
    return;
  }
  if (!LANG_RE.test(lang)) {
    finish(res, 400);
    return;
  }
  const primary = lang.toLowerCase().split('-')[0];
  const candidates = [lang.toLowerCase(), primary, 'en'].filter((id, index, all) => all.indexOf(id) === index);
  for (const id of candidates) {
    try {
      const raw = await readFile(resolve(LOCALE_ROOT, `${id}.json`), 'utf8');
      const data = JSON.parse(raw);
      const body = Buffer.from(JSON.stringify({ lang: id, ...data }));
      res.writeHead(200, baseHeaders({
        'cache-control': 'public, max-age=60',
        'content-length': String(body.byteLength),
        'content-type': 'application/json; charset=utf-8',
      }));
      res.end(req.method === 'HEAD' ? undefined : body);
      return;
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        finish(res, 500);
        return;
      }
    }
  }
  finish(res, 404);
}

function cachePolicyFor() {

  return 'no-cache';
}

async function serveStatic(req, res, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    finish(res, 400);
    return;
  }

  const suffix = decoded === BASE || decoded === `${BASE}/`
    ? 'index.html'
    : decoded.startsWith(`${BASE}/`)
      ? decoded.slice(BASE.length + 1)
      : null;
  if (suffix === null || suffix === '') {
    finish(res, 404);
    return;
  }

  const target = resolve(RUNTIME_ROOT, suffix);
  if (target !== RUNTIME_ROOT && !target.startsWith(`${RUNTIME_ROOT}${sep}`)) {
    finish(res, 403);
    return;
  }

  let info;
  try {
    info = await stat(target);
  } catch (error) {
    finish(res, error?.code === 'ENOENT' ? 404 : 500);
    return;
  }
  if (!info.isFile()) {
    finish(res, 404);
    return;
  }

  const etag = `"${info.mtimeMs.toString(36)}-${info.size.toString(36)}"`;
  const cacheControl = cachePolicyFor();
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, baseHeaders({ etag, 'cache-control': cacheControl }));
    res.end();
    return;
  }

  let body;
  try {
    body = await readFile(target);
  } catch {
    finish(res, 500);
    return;
  }
  res.writeHead(200, baseHeaders({
    'cache-control': cacheControl,
    'content-length': String(body.byteLength),
    'content-type': MIME[extname(target)] ?? 'application/octet-stream',
    etag,
  }));
  res.end(req.method === 'HEAD' ? undefined : body);
}

export function installRoutes(ctx, { ledger, readSnapshot }) {
  return ctx.webServer.register({
    kind: 'prefix',
    path: BASE,
    handler: (req, res) => {
      let url;
      try {
        url = new URL(req.url ?? BASE, 'http://dsh.local');
      } catch {
        finish(res, 400);
        return;
      }
      const pathname = url.pathname;
      const isRead = req.method === 'GET' || req.method === 'HEAD';

      if (pathname === SNAPSHOT_PATH) {
        if (!isRead) {
          finish(res, 405);
          return;
        }
        void serveSnapshot(ctx, readSnapshot, req, res, url).catch((error) => {
          logOnce(ctx, 'warn', 'snapshot-route', `ocean-background: snapshot route failed: ${describeError(error)}`);
          finish(res, 500);
        });
        return;
      }

      if (pathname === VOYAGE_PATH) {
        if (req.method !== 'POST') {
          finish(res, 405);
          return;
        }
        void serveVoyage(ctx, ledger, readSnapshot, req, res).catch((error) => {
          logOnce(ctx, 'warn', 'voyage-route', `ocean-background: voyage route failed: ${describeError(error)}`);
          finish(res, 500);
        });
        return;
      }

      if (pathname.startsWith(LOCALE_PREFIX)) {
        if (!isRead) {
          finish(res, 405);
          return;
        }
        void serveLocale(req, res, pathname).catch((error) => {
          logOnce(ctx, 'warn', 'locale-route', `ocean-background: locale route failed: ${describeError(error)}`);
          finish(res, 500);
        });
        return;
      }

      if (!isRead) {
        finish(res, 405);
        return;
      }
      void serveStatic(req, res, pathname).catch((error) => {
        logOnce(ctx, 'warn', 'asset-route', `ocean-background: asset route failed: ${describeError(error)}`);
        finish(res, 500);
      });
    },
  });
}
