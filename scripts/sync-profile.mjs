import { cp, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Mirrors the working tree into the desktop profile so the running app and the
// repository cannot drift. The target must be the plugin directory inside a
// profile's node_modules; anything else is refused.

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const target = resolve(
  process.env.DSH_OCEAN_TARGET
    ?? join(homedir(), '.dsh/profiles/desktop/node_modules/dsh-ocean-background'),
);

if (!/node_modules[\\/]dsh-ocean-background$/.test(target)) {
  throw new Error(`refusing to sync into ${target}`);
}

const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
const entries = [
  'index.js',
  'client.js',
  'host',
  'runtime',
  'locale',
  'icon.svg',
  'preview.png',
  'README.md',
  'LICENSE',
  'package.json',
];

try {
  const info = await stat(target);
  if (!info.isDirectory()) throw new Error('target is not a directory');
} catch {
  await mkdir(target, { recursive: true });
}

for (const entry of entries) {
  await rm(join(target, entry), { recursive: true, force: true });
}

for (const entry of entries) {
  await cp(join(ROOT, entry), join(target, entry), { recursive: true });
}

console.log(`synced ${pkg.name}@${pkg.version} -> ${target}`);
console.log('reload the Harness window to pick it up');
