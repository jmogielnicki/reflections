import { noise3D } from '../../utils/noise.js';
import { sampleGrid } from '../../utils/pixels.js';
import { hslToRgb, rgbString } from '../../utils/color.js';
import { lerp, randomRange } from '../../utils/math.js';

const GRID_COLS = 80;
const GRID_ROWS = 60;

export default {
  id: 'particle-vibration',
  name: 'Particle Vibration',
  description: 'Particles float in calm areas and vibrate intensely in darker regions of your image.',
  mediapipe: [],
  params: {
    particleCount:  { value: 4000,  min: 500,   max: 10000, step: 100,   label: 'Particle Count' },
    maxVibration:   { value: 25,    min: 5,     max: 100,   step: 1,     label: 'Max Vibration' },
    springStrength: { value: 0.08,  min: 0.01,  max: 0.3,   step: 0.01,  label: 'Spring Strength' },
    damping:        { value: 0.92,  min: 0.8,   max: 0.99,  step: 0.01,  label: 'Damping' },
    noiseFreq:      { value: 0.008, min: 0.001, max: 0.05,  step: 0.001, label: 'Noise Frequency' },
    noiseSpeed:     { value: 1.5,   min: 0.1,   max: 5,     step: 0.1,   label: 'Noise Speed' },
    trailFade:      { value: 0.08,  min: 0.01,  max: 0.3,   step: 0.01,  label: 'Trail Fade' },
  },

  init(ctx, canvas) {
    const particles = [];
    for (let i = 0; i < 4000; i++) {
      const homeX = randomRange(0, canvas.width);
      const homeY = randomRange(0, canvas.height);
      particles.push({
        x: homeX,
        y: homeY,
        homeX,
        homeY,
        vx: 0,
        vy: 0,
        size: randomRange(1.2, 3),
      });
    }

    return { particles };
  },

  update(state, input, dt) {
    const P = state.params;
    const grid = input.getBrightnessGrid(GRID_COLS, GRID_ROWS);
    const { width, height } = input.canvas;
    const elapsed = input.time.elapsed;

    // Adjust particle count dynamically
    const targetCount = Math.round(P.particleCount);
    while (state.particles.length < targetCount) {
      const homeX = randomRange(0, width);
      const homeY = randomRange(0, height);
      state.particles.push({ x: homeX, y: homeY, homeX, homeY, vx: 0, vy: 0, size: randomRange(1.2, 3) });
    }
    if (state.particles.length > targetCount) {
      state.particles.length = targetCount;
    }

    for (const p of state.particles) {
      const brightness = sampleGrid(grid, p.homeX, p.homeY, width, height);
      const darkness = 1 - brightness;

      // Vibration from noise, scaled by darkness
      const vibAmount = darkness * P.maxVibration;
      const nx = noise3D(p.homeX * P.noiseFreq, p.homeY * P.noiseFreq, elapsed * P.noiseSpeed);
      const ny = noise3D(p.homeX * P.noiseFreq + 500, p.homeY * P.noiseFreq + 500, elapsed * P.noiseSpeed);
      p.vx += nx * vibAmount * dt * 60;
      p.vy += ny * vibAmount * dt * 60;

      // Spring back to home
      const springForce = lerp(P.springStrength, P.springStrength * 0.2, darkness);
      p.vx += (p.homeX - p.x) * springForce;
      p.vy += (p.homeY - p.y) * springForce;

      // Damping
      p.vx *= P.damping;
      p.vy *= P.damping;

      // Integrate
      p.x += p.vx * dt * 60;
      p.y += p.vy * dt * 60;

      // Store darkness for rendering
      p._darkness = darkness;
    }
  },

  render(state, input, ctx, canvas) {
    // Fade trail
    ctx.fillStyle = `rgba(0, 0, 0, ${state.params.trailFade})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw particles
    for (const p of state.particles) {
      const d = p._darkness || 0;
      // Warm colors in dark areas, cool in light
      const hue = lerp(210, 15, d);       // blue → red/orange
      const sat = lerp(0.3, 0.9, d);
      const light = lerp(0.7, 0.55, d);
      const alpha = lerp(0.4, 0.9, d);

      const [r, g, b] = hslToRgb(hue, sat, light);
      ctx.fillStyle = rgbString(r, g, b, alpha);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
  },

  resize(state, width, height) {
    // Redistribute particles to new canvas size
    for (const p of state.particles) {
      const ratioX = p.homeX / (p._prevWidth || width);
      const ratioY = p.homeY / (p._prevHeight || height);
      p.homeX = ratioX * width;
      p.homeY = ratioY * height;
      p.x = p.homeX;
      p.y = p.homeY;
    }
    state._prevWidth = width;
    state._prevHeight = height;
  },

  cleanup(state) {
    state.particles.length = 0;
  },
};
