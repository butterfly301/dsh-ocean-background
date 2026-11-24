import * as THREE from 'three';
import { DAY_PALETTE } from './time-weather.js';

export {
  DAY_PALETTE,
  computeAtmosphere,
  blendAtmosphere,
  paletteForHour,
  applyWeatherToAtmosphere,
} from './time-weather.js';

export function createUniforms(palette = DAY_PALETTE) {
  const sunDir = new THREE.Vector3(palette.sunDir.x, palette.sunDir.y, palette.sunDir.z).normalize();
  return {
    uTime: { value: 0 },
    uFlow: { value: 0 },
    uSea: { value: 0.5 },
    uFoam: { value: 0 },
    uCloud: { value: 0.75 },
    uSkyZenith: { value: new THREE.Color(palette.skyZenith) },
    uSkyHorizon: { value: new THREE.Color(palette.skyHorizon) },
    uSunDir: { value: sunDir },
    uSunColor: { value: new THREE.Color(palette.sunColor) },
    uDeep: { value: new THREE.Color(palette.deep) },
    uShallow: { value: new THREE.Color(palette.shallow) },
    uFoamColor: { value: new THREE.Color(palette.foam) },
    uShipPos: { value: new THREE.Vector3(0, 0, 0) },
    uWorldOffset: { value: 0 },
    uShadow: { value: 0 },
    uWake: { value: 0 },
  };
}
