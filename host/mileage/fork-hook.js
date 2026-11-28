import { readService, notifyOnce, logOnce, describeError, resolveMileageTarget } from '../session-state.js'

const FORK_OWNER = Symbol.for('ocean-background.fork-snapshot')
const SNAPSHOT_TIMEOUT_MS = 4000

export function installForkSnapshots(ctx, ledger) {
  const controller = readService(ctx, 'sessionController')
  if (!controller || typeof controller.fork !== 'function') {
    notifyOnce(ctx, 'warn', 'fork-snapshot', 'ocean-background: sessionController.fork is unavailable; fork mileage cannot be inherited')
    return () => {}
  }
  const raw = controller[Symbol.for('cordis.original')] ?? controller
  const previous = raw[FORK_OWNER]
  if (typeof previous === 'function') {
    try { previous() } catch {}
  }
  const original = raw.fork
  const hadOwn = Object.hasOwn(raw, 'fork')
  const wrapper = async function forkWithMileage(request) {
    let token = null
    try {
      const source = typeof request?.sessionId === 'string' ? request.sessionId : null
      if (source !== null) {
        const target = await resolveMileageTarget(ctx, ledger, source, AbortSignal.timeout(SNAPSHOT_TIMEOUT_MS))
        if (target.eligible) token = await ledger.beginFork(target.rootId)
      }
    } catch (error) {
      logOnce(ctx, 'warn', 'fork-snapshot', `ocean-background: fork mileage snapshot failed: ${describeError(error)}`)
    }
    const value = await original.call(raw, request)
    try {
      if (token && value && typeof value.sessionId === 'string') {
        await ledger.settleFork(token, value.sessionId)
      }
    } catch (error) {
      logOnce(ctx, 'warn', 'fork-snapshot', `ocean-background: fork mileage record failed: ${describeError(error)}`)
    }
    return value
  }
  try {
    raw.fork = wrapper
  } catch (error) {
    logOnce(ctx, 'warn', 'fork-snapshot', `ocean-background: sessionController.fork cannot be wrapped: ${describeError(error)}`)
    return () => {}
  }
  if (raw.fork !== wrapper) {
    notifyOnce(ctx, 'warn', 'fork-snapshot', 'ocean-background: sessionController.fork is read-only; fork mileage cannot be inherited')
    return () => {}
  }
  const restore = () => {
    if (raw.fork === wrapper) {
      if (hadOwn) raw.fork = original
      else delete raw.fork
    }
    if (raw[FORK_OWNER] === restore) delete raw[FORK_OWNER]
  }
  raw[FORK_OWNER] = restore
  return restore
}

