import { noise3D } from '../../utils/noise.js';
import { sampleGrid } from '../../utils/pixels.js';
import { hslToRgb, rgbString } from '../../utils/color.js';
import { lerp, randomRange } from '../../utils/math.js';

const PARTICLE_COUNT = 4000;
const GRID_COLS = 80;
const GRID_ROWS = 60;
const MAX_VIBRATION = 25;
const SPRING_STRENGTH = 0.08;
const DAMPING = 0.92;
const NOISE_FREQ = 0.008;
const NOISE_SPEED = 1.5;
const TRAIL_FADE = 0.08;

export default {
  id: 'particle-vibration',
  name: 'Particle Vibration',
  description: 'Particles float in calm areas and vibrate intensely in darker regions of your image.',
  mediapipe: [],

  init(ctx, canvas) {
    const particles = [];
    for (let i = 0; i < PARTICLE_COUNT; i++) {
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
    const grid = input.getBrightnessGrid(GRID_COLS, GRID_ROWS);
    const { width, height } = input.canvas;
    const elapsed = input.time.elapsed;

    for (const p of state.particles) {
      const brightness = sampleGrid(grid, p.homeX, p.homeY, width, height);
      const darkness = 1 - brightness;

      // Vibration from noise, scaled by darkness
      const vibAmount = darkness * MAX_VIBRATION;
      const nx = noise3D(p.homeX * NOISE_FREQ, p.homeY * NOISE_FREQ, elapsed * NOISE_SPEED);
      const ny = noise3D(p.homeX * NOISE_FREQ + 500, p.homeY * NOISE_FREQ + 500, elapsed * NOISE_SPEED);
      p.vx += nx * vibAmount * dt * 60;
      p.vy += ny * vibAmount * dt * 60;

      // Spring back to home
      const springForce = lerp(SPRING_STRENGTH, SPRING_STRENGTH * 0.2, darkness);
      p.vx += (p.homeX - p.x) * springForce;
      p.vy += (p.homeY - p.y) * springForce;

      // Damping
      p.vx *= DAMPING;
      p.vy *= DAMPING;

      // Integrate
      p.x += p.vx * dt * 60;
      p.y += p.vy * dt * 60;

      // Store darkness for rendering
      p._darkness = darkness;
    }
  },

  render(state, input, ctx, canvas) {
    // Fade trail
    ctx.fillStyle = `rgba(0, 0, 0, ${TRAIL_FADE})`;
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
