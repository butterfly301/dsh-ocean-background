import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import {
  DAY_PALETTE,
  applyWeatherToAtmosphere,
  blendAtmosphere,
  computeAtmosphere,
  paletteForHour,
} from '../runtime/env/time-weather.js';
import { createWeatherService, mapWeatherCode, truncateCoord } from '../host/weather.js';
import { installRoutes } from '../host/routes.js';
import { createMileageLedger } from '../host/mileage/ledger.js';
import { createSnapshotReader } from '../host/snapshot.js';

function requestJson(handler, url) {
  return new Promise((resolve, reject) => {
    const req = Readable.from([]);
    req.method = 'GET';
    req.url = url;
    req.headers = {};
    const res = {
      status: 0,
      headers: {},
      body: null,
      writeHead(status, headers) {
        this.status = status;
        this.headers = headers ?? {};
      },
      end(chunk) {
        this.body = chunk ? JSON.parse(chunk.toString()) : null;
        resolve(this);
      },
    };
    handler(req, res);
    setTimeout(() => reject(new Error('route timed out')), 3000).unref?.();
  });
}

test('default disabled followTime/followWeather matches exact DAY_PALETTE', () => {
  const atmo = computeAtmosphere({ followTime: false, timePreset: 'day', weather: 'clear' });
  assert.equal(atmo.skyZenith, DAY_PALETTE.skyZenith);
  assert.equal(atmo.skyHorizon, DAY_PALETTE.skyHorizon);
  assert.equal(atmo.deep, DAY_PALETTE.deep);
  assert.equal(atmo.shallow, DAY_PALETTE.shallow);
  assert.equal(atmo.nightWeight, 0);
  assert.equal(atmo.seaBoost, 0);
});

test('24-hour curve transitions smoothly and night activates lanterns', () => {
  const midnight = paletteForHour(0);
  const dawn = paletteForHour(6);
  const noon = paletteForHour(12);
  const dusk = paletteForHour(18);
  assert.equal(midnight.nightWeight, 1);
  assert.equal(noon.nightWeight, 0);
  assert.ok(dusk.nightWeight > 0.4);
  assert.ok(dawn.nightWeight > 0.1);

  const mid = blendAtmosphere(noon, midnight, 0.5);
  assert.equal(mid.nightWeight, 0.5);
});

test('rain and snow mood boost clouds and wave intensity without altering nightWeight', () => {
  const night = paletteForHour(0);
  const rainyNight = applyWeatherToAtmosphere(night, 'rain');
  const snowyNight = applyWeatherToAtmosphere(night, 'snow');
  assert.equal(rainyNight.nightWeight, night.nightWeight);
  assert.equal(snowyNight.nightWeight, night.nightWeight);
  assert.ok(rainyNight.seaBoost > snowyNight.seaBoost);
  assert.ok(rainyNight.cloud > 0.9);
});

test('weather codes map cleanly to clear/rain/snow and coords truncate to 2 decimals', () => {
  assert.equal(mapWeatherCode(0), 'clear');
  assert.equal(mapWeatherCode(63), 'rain');
  assert.equal(mapWeatherCode(95), 'rain');
  assert.equal(mapWeatherCode(73), 'snow');
  assert.equal(mapWeatherCode(86), 'snow');
  assert.equal(truncateCoord(31.2398, -90, 90), 31.23);
  assert.equal(truncateCoord(-190, -180, 180), null);
});

test('geo and weather proxy routes truncate coordinates and query Open-Meteo', async () => {
  const weatherService = createWeatherService({
    fetchImpl: async (url) => {
      if (url.includes('ipwho.is')) {
        return { ok: true, json: async () => ({ success: true, latitude: 35.6895, longitude: 139.6917, city: 'Tokyo' }) };
      }
      return { ok: true, json: async () => ({ current: { weather_code: 75 } }) };
    },
  });
  const ledger = createMileageLedger({ dir: null });
  const ctx = { get: () => null };
  const readSnapshot = createSnapshotReader({ ctx, ledger });
  let options;
  installRoutes({ ...ctx, webServer: { register: (input) => { options = input; return () => {}; } } }, {
    ledger,
    readSnapshot,
    weatherService,
  });

  const geo = await requestJson(options.handler, '/ocean-background/geo');
  assert.equal(geo.status, 200);
  assert.equal(geo.body.lat, 35.68);
  assert.equal(geo.body.lon, 139.69);

  const weather = await requestJson(options.handler, '/ocean-background/weather?lat=35.6895&lon=139.6917');
  assert.equal(weather.status, 200);
  assert.equal(weather.body.weather, 'snow');
  assert.equal(weather.body.lat, 35.68);
  assert.equal(weather.body.lon, 139.69);
});
