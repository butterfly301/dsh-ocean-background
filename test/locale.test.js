import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LOCALE_DIR = fileURLToPath(new URL('../locale/', import.meta.url));
const REQUIRED = [
  'open',
  'show',
  'strength',
  'running',
  'quality',
  'balanced',
  'high',
  'cameraDistance',
  'cameraHeight',
  'cameraPitch',
  'cameraXOffset',
  'cameraHint',
  'recovering',
  'mileageToday',
  'mileageFleet',
  'mileageUnit',
  'followTime',
  'timePreset',
  'presetDawn',
  'presetDay',
  'presetDusk',
  'presetNight',
  'followWeather',
  'weatherPreset',
  'weatherClear',
  'weatherRain',
  'weatherSnow',
  'useLocation',
  'weatherLat',
  'weatherLon',
  'locating',
  'locationFailed',
  'shipFlag',
  'uploadFlag',
  'resetFlag',
  'flagCustom',
  'flagDefault',
  'flagInvalid',
];

test('every locale ships the complete UI dictionary', async () => {
  const files = (await readdir(LOCALE_DIR)).filter((name) => name.endsWith('.json'));
  assert.ok(files.length >= 8);
  for (const file of files) {
    const payload = JSON.parse(await readFile(join(LOCALE_DIR, file), 'utf8'));
    assert.equal(typeof payload.meta?.title, 'string', `${file} meta.title`);
    assert.equal(typeof payload.ui, 'object', `${file} ui`);
    for (const key of REQUIRED) {
      assert.equal(typeof payload.ui[key], 'string', `${file} missing ui.${key}`);
    }
  }
});

test('locale files stay pure JSON data', async () => {
  const files = (await readdir(LOCALE_DIR)).filter((name) => name.endsWith('.json'));
  for (const file of files) {
    const raw = await readFile(join(LOCALE_DIR, file), 'utf8');
    assert.doesNotThrow(() => JSON.parse(raw));
  }
});
