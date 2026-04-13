import { createNoise2D, createNoise3D } from 'simplex-noise';

let _noise2d = null;
let _noise3d = null;

function getNoise2D() {
  if (!_noise2d) _noise2d = createNoise2D();
  return _noise2d;
}

function getNoise3D() {
  if (!_noise3d) _noise3d = createNoise3D();
  return _noise3d;
}

/** 2D simplex noise, returns -1 to 1 */
export function noise2D(x, y) {
  return getNoise2D()(x, y);
}

/** 3D simplex noise, returns -1 to 1. Use z as time for animation. */
export function noise3D(x, y, z) {
  return getNoise3D()(x, y, z);
}

/** Fractal Brownian motion for richer noise */
export function fbm(x, y, octaves = 4, lacunarity = 2, gain = 0.5) {
  const n2d = getNoise2D();
  let value = 0;
  let amplitude = 1;
  let frequency = 1;
  let totalAmplitude = 0;

  for (let i = 0; i < octaves; i++) {
    value += n2d(x * frequency, y * frequency) * amplitude;
    totalAmplitude += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }

  return value / totalAmplitude;
}

/** Animated FBM using 3D noise with z = time */
export function fbm3D(x, y, z, octaves = 4, lacunarity = 2, gain = 0.5) {
  const n3d = getNoise3D();
  let value = 0;
  let amplitude = 1;
  let frequency = 1;
  let totalAmplitude = 0;

  for (let i = 0; i < octaves; i++) {
    value += n3d(x * frequency, y * frequency, z * frequency) * amplitude;
    totalAmplitude += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }

  return value / totalAmplitude;
}
