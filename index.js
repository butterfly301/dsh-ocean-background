import { homedir } from 'node:os';
import { join } from 'node:path';
import { createFlagStore } from './host/flag-store.js';
import { createMileageLedger } from './host/mileage/ledger.js';
import { installForkSnapshots } from './host/mileage/fork-hook.js';
import { installRoutes } from './host/routes.js';
import { createSnapshotReader } from './host/snapshot.js';
import { clearOceanCaches, describeError, logOnce, readService } from './host/session-state.js';

export const name = 'ocean-background';
export const inject = ['webServer', 'sessionController'];

function dataDirOf(ctx) {
  const homePath = readService(ctx, 'dshHomePath');
  if (typeof homePath === 'function') {
    try {
      const resolved = homePath('ocean-background');
      if (typeof resolved === 'string' && resolved !== '') return resolved;
    } catch {}
  }
  const home = process.env.DSH_HOME || join(homedir(), '.dsh');
  return join(home, 'ocean-background');
}

export function apply(ctx, config = {}) {
  return ctx.effect(() => {
    const resolvedDir = config.mileageDir === null
      ? null
      : (typeof config.mileageDir === 'string' && config.mileageDir !== '' ? config.mileageDir : dataDirOf(ctx));
    const ledger = createMileageLedger({
      dir: resolvedDir,
      onWarn: (error) => logOnce(
        ctx,
        'warn',
        'mileage-storage',
        `ocean-background: mileage storage failed: ${describeError(error)}`,
      ),
    });
    const flagStore = createFlagStore({ dir: resolvedDir });
    const readSnapshot = createSnapshotReader({ ctx, ledger });
    let restoreFork = () => {};
    let registration;
    let disposed = false;

    const release = () => {
      if (disposed) return;
      disposed = true;
      try {
        if (typeof registration === 'function') registration();
      } catch {}
      try { restoreFork(); } catch {}
      clearOceanCaches(ctx);
      void ledger.dispose();
    };

    try {
      restoreFork = installForkSnapshots(ctx, ledger);
    } catch (error) {
      logOnce(ctx, 'warn', 'fork-snapshot', `ocean-background: fork snapshot install failed: ${describeError(error)}`);
    }

    try {
      registration = installRoutes(ctx, { ledger, readSnapshot, flagStore });
    } catch (error) {
      release();
      throw error;
    }
    return release;
  }, 'ocean-background: renderer route');
}
