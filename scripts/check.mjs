import { readdir, readFile, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SKIP_DIRS = new Set(['.git', 'node_modules', 'vendor', 'test']);

async function walk(dir, files = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.git') continue;
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await walk(join(dir, entry.name), files);
      continue;
    }
    files.push(join(dir, entry.name));
  }
  return files;
}

function fail(message) {
  console.error(`check: ${message}`);
  process.exitCode = 1;
}

const files = await walk(ROOT);
let scripts = 0;
let jsonFiles = 0;

for (const file of files) {
  if (file.endsWith('.js') || file.endsWith('.mjs')) {
    try {
      await run(process.execPath, ['--check', file]);
      scripts += 1;
    } catch (error) {
      fail(`${relative(ROOT, file)}: ${error.stderr || error.message}`);
      continue;
    }
    const source = await readFile(file, 'utf8');
    const specifiers = source.matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g);
    for (const match of specifiers) {
      const target = resolve(dirname(file), match[1]);
      try {
        const info = await stat(target);
        if (!info.isFile()) fail(`${relative(ROOT, file)}: ${match[1]} is not a file`);
      } catch {
        fail(`${relative(ROOT, file)}: missing import ${match[1]}`);
      }
    }
    continue;
  }
  if (file.endsWith('.json')) {
    try {
      JSON.parse(await readFile(file, 'utf8'));
      jsonFiles += 1;
    } catch (error) {
      fail(`${relative(ROOT, file)}: ${error.message}`);
    }
  }
}

const protocol = await readFile(join(ROOT, 'runtime/protocol.js'), 'utf8');
for (const banned of ['document.', 'window.', "from 'three'", 'localStorage']) {
  if (protocol.includes(banned)) fail(`runtime/protocol.js must stay environment-free, found ${banned}`);
}

const settingsSchema = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
if (!settingsSchema.scripts?.test) fail('package.json is missing a test script');

console.log(`check: ${scripts} scripts, ${jsonFiles} json files`);
