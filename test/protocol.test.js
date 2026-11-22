import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROTOCOL_VERSION,
  MESSAGE,
  SETTINGS_SCHEMA,
  normalizeSettings,
  readMessage,
  settingsMessage,
  snapshotMessage,
} from '../runtime/protocol.js';

test('settings schema defaults form a complete object', () => {
  const settings = normalizeSettings({});
  for (const [key, spec] of Object.entries(SETTINGS_SCHEMA.fields)) {
    assert.equal(typeof settings[key], spec.type === 'boolean' ? 'boolean' : spec.type === 'number' ? 'number' : 'string');
  }
  assert.equal(settings.enabled, true);
  assert.equal(settings.quality, 'balanced');
  assert.deepEqual(Object.keys(settings), Object.keys(SETTINGS_SCHEMA.fields));
});

test('numbers are clamped and snapped to the slider step', () => {
  assert.equal(normalizeSettings({ strength: 0.999 }).strength, 0.95);
  assert.equal(normalizeSettings({ strength: -3 }).strength, 0.35);
  assert.equal(normalizeSettings({ cameraDistance: 50.4 }).cameraDistance, 50);
  assert.equal(normalizeSettings({ cameraHeight: 2.06 }).cameraHeight, 2.1);
  assert.equal(normalizeSettings({ cameraPitch: -100 }).cameraPitch, -30);
  assert.equal(normalizeSettings({ cameraPitch: 12.34 }).cameraPitch, 12.3);
  assert.equal(normalizeSettings({ cameraXOffset: 99 }).cameraXOffset, 8);
});

test('invalid values fall back to defaults', () => {
  const settings = normalizeSettings({ enabled: 'yes', quality: 'ultra', strength: 'loud', cameraDistance: null });
  assert.equal(settings.enabled, true);
  assert.equal(settings.quality, 'balanced');
  assert.equal(settings.strength, 0.72);
  assert.equal(settings.cameraDistance, 44);
});

test('messages are version gated', () => {
  assert.equal(readMessage(null), null);
  assert.equal(readMessage({ v: 1, type: MESSAGE.ready }), null);
  assert.equal(readMessage({ v: PROTOCOL_VERSION, type: MESSAGE.ready }).type, MESSAGE.ready);
});

test('message builders carry the protocol version and normalized settings', () => {
  const settings = settingsMessage({ strength: 2, sessionId: 'ignored' }, 's-1');
  assert.equal(settings.v, PROTOCOL_VERSION);
  assert.equal(settings.type, MESSAGE.settings);
  assert.equal(settings.settings.strength, 0.95);
  assert.equal(settings.sessionId, 's-1');
  assert.equal(settings.settings.sessionId, undefined);

  const snapshot = snapshotMessage({ ok: true });
  assert.equal(snapshot.type, MESSAGE.snapshot);
  assert.deepEqual(snapshot.snapshot, { ok: true });
});
