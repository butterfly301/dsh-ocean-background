const DEFAULT_GEO_URL = 'https://ipwho.is/';
const FALLBACK_GEO_URL = 'https://get.geojs.io/v1/ip/geo.json';
const OPEN_METEO_BASE = 'https://api.open-meteo.com/v1/forecast';
const REQUEST_TIMEOUT_MS = 6000;

export function truncateCoord(value, min, max) {
  if (typeof value !== 'number' && (typeof value !== 'string' || value.trim() === '')) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return Number((Math.trunc(n * 100) / 100).toFixed(2));
}

export function mapWeatherCode(code) {
  const n = Number(code);
  if (!Number.isFinite(n)) return 'clear';
  const c = Math.trunc(n);
  if (c === 71 || c === 73 || c === 75 || c === 77 || c === 85 || c === 86) {
    return 'snow';
  }
  if (
    (c >= 51 && c <= 67)
    || (c >= 80 && c <= 82)
    || c === 95
    || c === 96
    || c === 99
  ) {
    return 'rain';
  }
  return 'clear';
}

async function fetchJson(fetchImpl, url) {
  const response = await fetchImpl(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response || !response.ok) {
    throw new Error(`upstream status ${response ? response.status : 0}`);
  }
  return response.json();
}

export function createWeatherService({ fetchImpl = globalThis.fetch } = {}) {
  async function locateByIp() {
    if (typeof fetchImpl !== 'function') throw new Error('fetch unavailable');
    try {
      const data = await fetchJson(fetchImpl, DEFAULT_GEO_URL);
      if (data && data.success !== false) {
        const lat = truncateCoord(data.latitude, -90, 90);
        const lon = truncateCoord(data.longitude, -180, 180);
        if (lat !== null && lon !== null) {
          return {
            ok: true,
            lat,
            lon,
            city: typeof data.city === 'string' ? data.city : '',
          };
        }
      }
    } catch {}

    const fallback = await fetchJson(fetchImpl, FALLBACK_GEO_URL);
    const lat = truncateCoord(fallback?.latitude, -90, 90);
    const lon = truncateCoord(fallback?.longitude, -180, 180);
    if (lat === null || lon === null) throw new Error('geolocation returned invalid coordinates');
    return {
      ok: true,
      lat,
      lon,
      city: typeof fallback?.city === 'string' ? fallback.city : '',
    };
  }

  async function fetchWeather(rawLat, rawLon) {
    if (typeof fetchImpl !== 'function') throw new Error('fetch unavailable');
    const lat = truncateCoord(rawLat, -90, 90);
    const lon = truncateCoord(rawLon, -180, 180);
    if (lat === null || lon === null) {
      const err = new Error('invalid coordinates');
      err.status = 400;
      throw err;
    }
    const url = `${OPEN_METEO_BASE}?latitude=${encodeURIComponent(String(lat))}&longitude=${encodeURIComponent(String(lon))}&current=weather_code`;
    const data = await fetchJson(fetchImpl, url);
    const code = data?.current?.weather_code;
    if (typeof code !== 'number' || !Number.isFinite(code)) {
      throw new Error('missing weather_code in Open-Meteo response');
    }
    return {
      ok: true,
      weather: mapWeatherCode(code),
      weatherCode: Math.trunc(code),
      lat,
      lon,
      fetchedAt: Date.now(),
    };
  }

  return { locateByIp, fetchWeather };
}
