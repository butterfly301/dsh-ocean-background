import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_FLAG_BYTES } from './flag-store.js';
import { describeError, logOnce } from './session-state.js';
import { snapshotErrorPayload } from './snapshot.js';
import { createWeatherService } from './weather.js';

const BASE = '/ocean-background';
const SNAPSHOT_PATH = `${BASE}/snapshot`;
const VOYAGE_PATH = `${BASE}/voyage`;
const FLAG_PATH = `${BASE}/flag`;
const FLAG_IMAGE_PATH = `${BASE}/flag/image`;
const GEO_PATH = `${BASE}/geo`;
const WEATHER_PATH = `${BASE}/weather`;
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

function sendJson(req, res, payload, status = 200, cacheControl = 'no-store') {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, baseHeaders({
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
      const content = await readFile(resolve(LOCALE_ROOT, `${id}.json`), 'utf8');
      const data = JSON.parse(content);
      sendJson(req, res, { lang: id, ...data }, 200, 'public, max-age=60');
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

function readBinaryBody(req, limitBytes) {
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
      if (size > limitBytes) {
        const err = new Error('body too large');
        err.status = 413;
        fail(err);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      resolvePromise(Buffer.concat(chunks));
    });
    req.on('error', fail);
  });
}

async function serveFlagMeta(flagStore, req, res) {
  if (!flagStore) {
    sendJson(req, res, { ok: true, hasCustom: false, mime: null, updatedAt: null });
    return;
  }
  const info = await flagStore.inspect();
  sendJson(req, res, { ok: true, ...info });
}

async function serveFlagImage(flagStore, req, res) {
  if (!flagStore) {
    finish(res, 204);
    return;
  }
  const img = await flagStore.readImage();
  if (!img) {
    finish(res, 204);
    return;
  }
  res.writeHead(200, baseHeaders({
    'cache-control': 'no-store',
    'content-length': String(img.buffer.byteLength),
    'content-type': img.mime,
  }));
  res.end(req.method === 'HEAD' ? undefined : img.buffer);
}

async function serveFlagUpload(flagStore, req, res) {
  if (!flagStore) {
    sendJson(req, res, { ok: false, error: 'flag storage unavailable' }, 503);
    return;
  }
  let body;
  try {
    body = await readBinaryBody(req, MAX_FLAG_BYTES);
  } catch (error) {
    const status = error?.status === 413 ? 413 : 400;
    sendJson(req, res, { ok: false, error: error?.message || 'invalid body' }, status);
    return;
  }
  try {
    const saved = await flagStore.saveImage(body);
    sendJson(req, res, { ok: true, ...saved });
  } catch (error) {
    const status = typeof error?.status === 'number' ? error.status : 400;
    sendJson(req, res, { ok: false, error: error?.message || 'invalid image' }, status);
  }
}

async function serveFlagDelete(flagStore, req, res) {
  if (!flagStore) {
    sendJson(req, res, { ok: false, error: 'flag storage unavailable' }, 503);
    return;
  }
  const cleared = await flagStore.clearImage();
  sendJson(req, res, { ok: true, ...cleared });
}

export function installRoutes(ctx, { ledger, readSnapshot, flagStore = null, weatherService = createWeatherService() }) {
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

      if (pathname === FLAG_PATH) {
        if (isRead) {
          void serveFlagMeta(flagStore, req, res).catch((error) => {
            logOnce(ctx, 'warn', 'flag-route', `ocean-background: flag route failed: ${describeError(error)}`);
            finish(res, 500);
          });
          return;
        }
        if (req.method === 'POST') {
          void serveFlagUpload(flagStore, req, res).catch((error) => {
            logOnce(ctx, 'warn', 'flag-upload', `ocean-background: flag upload failed: ${describeError(error)}`);
            finish(res, 500);
          });
          return;
        }
        if (req.method === 'DELETE') {
          void serveFlagDelete(flagStore, req, res).catch((error) => {
            logOnce(ctx, 'warn', 'flag-delete', `ocean-background: flag delete failed: ${describeError(error)}`);
            finish(res, 500);
          });
          return;
        }
        finish(res, 405);
        return;
      }

      if (pathname === FLAG_IMAGE_PATH) {
        if (!isRead) {
          finish(res, 405);
          return;
        }
        void serveFlagImage(flagStore, req, res).catch((error) => {
          logOnce(ctx, 'warn', 'flag-image', `ocean-background: flag image failed: ${describeError(error)}`);
          finish(res, 500);
        });
        return;
      }

      if (pathname === GEO_PATH) {
        if (!isRead) {
          finish(res, 405);
          return;
        }
        void weatherService.locateByIp()
          .then((payload) => sendJson(req, res, payload))
          .catch((error) => {
            logOnce(ctx, 'warn', 'geo-route', `ocean-background: geo route failed: ${describeError(error)}`);
            sendJson(req, res, { ok: false, error: describeError(error) }, 502);
          });
        return;
      }

      if (pathname === WEATHER_PATH) {
        if (!isRead) {
          finish(res, 405);
          return;
        }
        const lat = url.searchParams.get('lat');
        const lon = url.searchParams.get('lon');
        void weatherService.fetchWeather(lat, lon)
          .then((payload) => sendJson(req, res, payload))
          .catch((error) => {
            const status = error?.status === 400 ? 400 : 502;
            if (status !== 400) {
              logOnce(ctx, 'warn', 'weather-route', `ocean-background: weather route failed: ${describeError(error)}`);
            }
            sendJson(req, res, { ok: false, error: describeError(error) }, status);
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
