import * as THREE from 'three';

export const DAY_PALETTE = Object.freeze({
  skyZenith: '#3f87bd',
  skyHorizon: '#b6dbe8',
  sunDir: Object.freeze({ x: -0.48, y: 0.20, z: -0.85 }),
  sunColor: '#fff0d2',
  deep: '#1f5d78',
  shallow: '#4e9fba',
  foam: '#bfe0dc',
});

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
