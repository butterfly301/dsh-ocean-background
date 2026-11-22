/** HTTP and lifecycle adapter for the ocean background. */
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createMileageLedger } from './mileage.js'
import { installForkSnapshots } from './host/fork-snapshots.js'
import { readService, describeError, logOnce, debugPayload, sessionSnapshot, resolveMileageTarget, clearOceanCaches } from './host/session-state.js'

// Preserve the existing exported interface while implementations live with their owners.
export { STATUS, usageOfEvent, bucketsOf, createFoldState, foldSessionFacts, statusOfFacts } from './host/session-facts.js'
export { clearOceanCaches, readSessionFacts, resolveRootSessionId, isMeteringEligible, resolveMileageTarget, listFleetRows, emptySnapshot, sessionSnapshot } from './host/session-state.js'

export const name = 'ocean-background'
export const inject = ['webServer', 'sessionController']

const ROUTE = '/ocean-background'
const STATE_ROUTE = `${ROUTE}/state`
const MILEAGE_ROUTE = `${ROUTE}/mileage`
const VOYAGE_ROUTE = `${ROUTE}/voyage`
const RUNTIME_ROOT = resolve(fileURLToPath(new URL('./runtime/', import.meta.url)))
const MAX_VOYAGE_BODY = 4096

const MIME = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
})

const STATE_TIMEOUT_MS = 4000

function errorPayload(error) {
  return {
    ok: false,
    sessionId: null,
    tokensComplete: false,
    totalTokens: null,
    flowTokens: null,
    agentRunning: false,
    children: [],
    error: describeError(error),
  }
}

function sendJson(req, res, payload) {
  const body = Buffer.from(JSON.stringify(payload))
  res.writeHead(200, {
    'cache-control': 'no-store',
    'content-length': String(body.byteLength),
    'content-type': 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
  })
  res.end(req.method === 'HEAD' ? undefined : body)
}

async function serveState(ctx, req, res, url) {
  const selected = url.searchParams.get('sessionId')
  let payload
  try {
    payload = await sessionSnapshot(ctx, selected, AbortSignal.timeout(STATE_TIMEOUT_MS))
    if (url.searchParams.has('debug')) payload.debug = debugPayload(ctx, selected)
  } catch (error) {
    logOnce(ctx, 'warn', 'state', `ocean-background: state request failed: ${describeError(error)}`)
    payload = errorPayload(error)
  }
  sendJson(req, res, payload)
}

function mileagePayloadOf(ledger, rootId, eligible) {
  return { ok: true, ...ledger.view(rootId, eligible) }
}

function mileageErrorPayload(error) {
  return {
    ok: false,
    sessionId: null,
    eligible: false,
    mode: 'today',
    day: null,
    todayMeters: 0,
    fleetMeters: 0,
    error: describeError(error),
  }
}

async function serveMileage(ctx, ledger, req, res, url) {
  let payload
  try {
    await ledger.ready()
    const target = await resolveMileageTarget(
      ctx,
      ledger,
      url.searchParams.get('sessionId'),
      AbortSignal.timeout(STATE_TIMEOUT_MS),
    )
    payload = mileagePayloadOf(ledger, target.rootId, target.eligible)
  } catch (error) {
    logOnce(ctx, 'warn', 'mileage', `ocean-background: mileage request failed: ${describeError(error)}`)
    payload = mileageErrorPayload(error)
  }
  sendJson(req, res, payload)
}

function readJsonBody(req) {
  return new Promise((resolvePromise, rejectPromise) => {
    const chunks = []
    let size = 0
    let settled = false
    const fail = (error) => {
      if (settled) return
      settled = true
      rejectPromise(error)
    }
    req.on('data', (chunk) => {
      if (settled) return
      size += chunk.length
      if (size > MAX_VOYAGE_BODY) {
        fail(new Error('voyage body too large'))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (settled) return
      settled = true
      try {
        resolvePromise(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (error) {
        rejectPromise(error)
      }
    })
    req.on('error', fail)
  })
}

async function serveVoyage(ctx, ledger, req, res) {
  let body
  try {
    body = await readJsonBody(req)
  } catch {
    finish(res, 400)
    return
  }
  const instanceId = typeof body?.instanceId === 'string'
    && body.instanceId !== '' && body.instanceId.length <= 128 ? body.instanceId : null
  const travelX = typeof body?.travelX === 'number'
    && Number.isFinite(body.travelX) && body.travelX >= 0 ? body.travelX : null
  if (instanceId === null || travelX === null) {
    finish(res, 400)
    return
  }
  await ledger.ready()
  let rootId = null
  let eligible = false
  try {
    const target = await resolveMileageTarget(
      ctx,
      ledger,
      typeof body?.sessionId === 'string' ? body.sessionId : null,
      AbortSignal.timeout(STATE_TIMEOUT_MS),
    )
    rootId = target.rootId
    eligible = target.eligible
  } catch (error) {
    logOnce(ctx, 'warn', 'voyage', `ocean-background: voyage target failed: ${describeError(error)}`)
  }
  const creditedMeters = ledger.credit({
    instanceId,
    travelX,
    rootId,
    eligible,
    from: typeof body?.from === 'number' && Number.isFinite(body.from) ? body.from : undefined,
    to: typeof body?.to === 'number' && Number.isFinite(body.to) ? body.to : undefined,
  })
  sendJson(req, res, { ...mileagePayloadOf(ledger, rootId, eligible), creditedMeters })
}

function dataDirOf(ctx) {
  const homePath = readService(ctx, 'dshHomePath')
  if (typeof homePath === 'function') {
    try {
      const resolved = homePath('ocean-background')
      if (typeof resolved === 'string' && resolved !== '') return resolved
    } catch {}
  }
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'ocean-background')
}

function finish(res, status) {
  res.writeHead(status, { 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' })
  res.end()
}

async function serveAsset(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    finish(res, 405)
    return
  }

  let pathname
  try {
    pathname = decodeURIComponent(new URL(req.url ?? ROUTE, 'http://dsh.local').pathname)
  } catch {
    finish(res, 400)
    return
  }

  const suffix = pathname === ROUTE || pathname === `${ROUTE}/`
    ? 'index.html'
    : pathname.slice(`${ROUTE}/`.length)
  const target = resolve(RUNTIME_ROOT, suffix)
  if (target !== RUNTIME_ROOT && !target.startsWith(`${RUNTIME_ROOT}${sep}`)) {
    finish(res, 403)
    return
  }

  try {
    const body = await readFile(target)
    res.writeHead(200, {
      'cache-control': 'no-cache',
      'content-length': String(body.byteLength),
      'content-type': MIME[extname(target)] ?? 'application/octet-stream',
      'x-content-type-options': 'nosniff',
    })
    res.end(req.method === 'HEAD' ? undefined : body)
  } catch (error) {
    if (error instanceof Error && 'code' in error
      && (error.code === 'ENOENT' || error.code === 'EISDIR')) {
      finish(res, 404)
      return
    }
    finish(res, 500)
  }
}

export function apply(ctx, config = {}) {
  ctx.effect(() => {
    const ledger = createMileageLedger({
      dir: config.mileageDir === null
        ? null
        : (typeof config.mileageDir === 'string' && config.mileageDir !== '' ? config.mileageDir : dataDirOf(ctx)),
      onWarn: (error) => logOnce(ctx, 'warn', 'mileage-storage', `ocean-background: mileage storage failed: ${describeError(error)}`),
    })
    let restoreFork = () => {}
    let registration
    let disposed = false
    const release = () => {
      if (disposed) return
      disposed = true
      try {
        if (typeof registration === 'function') registration()
      } catch {}
      try { restoreFork() } catch {}
      clearOceanCaches(ctx)
      void ledger.dispose()
    }
    try {
      restoreFork = installForkSnapshots(ctx, ledger)
    } catch (error) {
      logOnce(ctx, 'warn', 'fork-snapshot', `ocean-background: fork snapshot install failed: ${describeError(error)}`)
    }
    try {
      registration = ctx.webServer.register({
        kind: 'prefix',
        path: ROUTE,
        handler: (req, res) => {
          let url
          try {
            url = new URL(req.url ?? ROUTE, 'http://dsh.local')
          } catch {
            return finish(res, 400)
          }
          if (url.pathname === STATE_ROUTE) {
            if (req.method !== 'GET' && req.method !== 'HEAD') return finish(res, 405)
            return serveState(ctx, req, res, url)
          }
          if (url.pathname === MILEAGE_ROUTE) {
            if (req.method !== 'GET' && req.method !== 'HEAD') return finish(res, 405)
            return serveMileage(ctx, ledger, req, res, url)
          }
          if (url.pathname === VOYAGE_ROUTE) {
            if (req.method !== 'POST') return finish(res, 405)
            return serveVoyage(ctx, ledger, req, res)
          }
          return serveAsset(req, res)
        },
      })
    } catch (error) {
      release()
      throw error
    }
    return release
  }, 'ocean-background: renderer route')
}
