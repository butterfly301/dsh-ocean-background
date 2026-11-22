export function disposeObject3D(...roots) {
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();

  for (const root of roots) {
    if (typeof root?.traverse !== 'function') continue;
    root.traverse((node) => {
      if (node.geometry) geometries.add(node.geometry);
      const assigned = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of assigned) {
        if (!material) continue;
        materials.add(material);
        for (const value of Object.values(material)) {
          if (value?.isTexture) textures.add(value);
        }
      }
    });
  }

  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  for (const texture of textures) texture.dispose();
}
