// Small deterministic PRNG so scenery, wind and fleet jitter can be replayed.
// Test and screenshot runs pass a seed; normal runs keep Math.random.

export function seedFromString(text) {
  let hash = 2166136261;
  const value = String(text);
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function createRandom(seed) {
  let state = (Number.isFinite(seed) ? Math.floor(seed) : 1) >>> 0;
  if (state === 0) state = 0x9e3779b9;
  return function random() {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4294967296;
  };
}

export function resolveRandom(seed) {
  return Number.isFinite(seed) ? createRandom(seed) : Math.random;
}
