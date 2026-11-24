import * as THREE from 'three';

let cachedGlowTexture = null;

function getGlowTexture() {
  if (cachedGlowTexture) return cachedGlowTexture;
  if (typeof document === 'undefined') return null;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const half = size / 2;
  const grad = ctx.createRadialGradient(half, half, 0, half, half, half);
  grad.addColorStop(0, 'rgba(255, 240, 185, 0.95)');
  grad.addColorStop(0.22, 'rgba(255, 188, 82, 0.62)');
  grad.addColorStop(0.55, 'rgba(255, 138, 32, 0.18)');
  grad.addColorStop(1, 'rgba(255, 120, 20, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  cachedGlowTexture = new THREE.CanvasTexture(canvas);
  cachedGlowTexture.needsUpdate = true;
  return cachedGlowTexture;
}

function createLanternAssembly(anchor, phase, mountType) {
  const group = new THREE.Group();
  group.position.copy(anchor);

  const ironMat = new THREE.MeshStandardMaterial({
    color: 0x3b2d20,
    roughness: 0.78,
    metalness: 0.35,
  });

  if (mountType === 'stern') {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.036, 0.30, 6), ironMat);
    post.position.y = -0.20;
    group.add(post);
  } else {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, 0.32), ironMat);
    arm.position.set(0, 0.08, 0.14);
    group.add(arm);
  }

  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.15, 0.09, 6), ironMat);
  cap.position.y = 0.14;
  group.add(cap);

  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.065, 0.055, 6), ironMat);
  base.position.y = -0.095;
  group.add(base);

  const coreMat = new THREE.MeshStandardMaterial({
    color: 0xffeeb5,
    emissive: new THREE.Color(0xffa832),
    emissiveIntensity: 0,
    roughness: 0.15,
    metalness: 0,
    fog: false,
    toneMapped: false,
  });
  const core = new THREE.Mesh(new THREE.CylinderGeometry(0.088, 0.075, 0.17, 6), coreMat);
  core.position.y = 0.02;
  group.add(core);

  let halo = null;
  let haloMat = null;
  const glowTex = getGlowTexture();
  if (glowTex) {
    haloMat = new THREE.SpriteMaterial({
      map: glowTex,
      color: 0xffcf78,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    });
    halo = new THREE.Sprite(haloMat);
    halo.position.y = 0.02;
    halo.scale.setScalar(1.3);
    group.add(halo);
  }

  const light = new THREE.PointLight(0xffb148, 0, 18, 1.5);
  light.position.set(0, -0.04, 0);
  group.add(light);

  group.visible = false;
  return { group, coreMat, halo, haloMat, light, phase };
}

export function createShipLanterns(shipPivot, anchors) {
  const stern = createLanternAssembly(anchors.stern, 0, 'stern');
  const mast = createLanternAssembly(anchors.mast, 1.7, 'mast');
  shipPivot.add(stern.group, mast.group);

  function update(time, nightWeight, quality = 'balanced') {
    const active = typeof nightWeight === 'number' && nightWeight > 0.02;
    stern.group.visible = active;
    mast.group.visible = active;
    if (!active) {
      stern.coreMat.emissiveIntensity = 0;
      mast.coreMat.emissiveIntensity = 0;
      if (stern.haloMat) stern.haloMat.opacity = 0;
      if (mast.haloMat) mast.haloMat.opacity = 0;
      stern.light.intensity = 0;
      mast.light.intensity = 0;
      return;
    }

    const w = THREE.MathUtils.clamp(nightWeight, 0, 1);
    const breathStern = 1 + 0.08 * Math.sin(time * 2.2 + stern.phase);
    const breathMast = 1 + 0.08 * Math.sin(time * 2.2 + mast.phase);

    stern.coreMat.emissiveIntensity = w * 3.6 * breathStern;
    mast.coreMat.emissiveIntensity = w * 3.6 * breathMast;
    if (stern.halo && stern.haloMat) {
      stern.haloMat.opacity = Math.min(1, w * 0.92);
      stern.halo.scale.setScalar((1.15 + w * 0.55) * breathStern);
    }
    if (mast.halo && mast.haloMat) {
      mast.haloMat.opacity = Math.min(1, w * 0.88);
      mast.halo.scale.setScalar((1.0 + w * 0.5) * breathMast);
    }
    stern.light.intensity = w * 5.8 * breathStern;
    mast.light.intensity = quality === 'high' ? w * 4.2 * breathMast : w * 2.4 * breathMast;
  }

  return { update };
}
