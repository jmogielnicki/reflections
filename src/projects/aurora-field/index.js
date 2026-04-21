import { fbm3D } from '../../utils/noise.js';
import { hslToRgb } from '../../utils/color.js';
import { lerp, clamp } from '../../utils/math.js';

// Render aurora at low resolution — scaled up for smooth, dreamy look
const RENDER_W = 128;
const RENDER_H = 72;

export default {
  id: 'aurora-field',
  name: 'Aurora Field',
  description: 'A living aurora of colored smoke fills the screen. Step in front of the camera to cast a glowing light across it.',
  mediapipe: ['pose'],
  params: {
    noiseScale:    { value: 2.8,  min: 0.5,  max: 7.0,  step: 0.1,  label: 'Smoke Scale' },
    noiseSpeed:    { value: 0.1,  min: 0.01, max: 0.4,  step: 0.01, label: 'Animation Speed' },
    octaves:       { value: 5,    min: 2,    max: 7,    step: 1,    label: 'Smoke Detail' },
    baseHue:       { value: 220,  min: 0,    max: 360,  step: 5,    label: 'Base Hue' },
    hueRange:      { value: 30,   min: 0,    max: 90,   step: 5,    label: 'Hue Variation' },
    darkBg:        { value: 0.04, min: 0.0,  max: 0.15, step: 0.01, label: 'Dark Floor' },
    glowHue:       { value: 320,  min: 0,    max: 360,  step: 5,    label: 'Light Hue' },
    glowRadius:    { value: 0.38, min: 0.1,  max: 0.8,  step: 0.02, label: 'Light Radius' },
    glowStrength:  { value: 1.2,  min: 0.2,  max: 3.0,  step: 0.1,  label: 'Light Strength' },
    glowFalloff:   { value: 2.0,  min: 0.5,  max: 5.0,  step: 0.25, label: 'Light Falloff' },
    lightBlend:    { value: 0.7,  min: 0.0,  max: 1.0,  step: 0.05, label: 'Color Shift' },
    fadeSpeed:     { value: 2.0,  min: 0.5,  max: 5.0,  step: 0.25, label: 'Enter/Exit Speed' },
  },
  presets: [
    {
      name: 'Midnight Ocean',
      values: { baseHue: 220, hueRange: 25, glowHue: 310, noiseScale: 2.8, darkBg: 0.04, glowStrength: 1.1, glowRadius: 0.4 },
    },
    {
      name: 'Northern Lights',
      values: { baseHue: 165, hueRange: 35, glowHue: 290, noiseScale: 3.5, darkBg: 0.03, glowStrength: 1.3, glowRadius: 0.45, octaves: 5 },
    },
    {
      name: 'Ember Cloud',
      values: { baseHue: 15, hueRange: 25, glowHue: 55, noiseScale: 2.2, darkBg: 0.02, glowStrength: 1.5, glowRadius: 0.35 },
    },
    {
      name: 'Void Light',
      values: { baseHue: 260, hueRange: 40, glowHue: 180, noiseScale: 3.0, darkBg: 0.02, glowStrength: 1.6, glowRadius: 0.5, glowFalloff: 3.0, lightBlend: 0.9 },
    },
  ],

  init(ctx, canvas) {
    const offscreen = new OffscreenCanvas(RENDER_W, RENDER_H);
    const offCtx = offscreen.getContext('2d');
    const imageData = offCtx.createImageData(RENDER_W, RENDER_H);

    return {
      offscreen,
      offCtx,
      imageData,
      // Smoothed light position (normalized 0-1)
      lightX: 0.5,
      lightY: 0.4,
      hasTarget: false,
      // Smooth entry/exit
      lightAlpha: 0,
    };
  },

  update(state, input, dt) {
    const P = state.params;
    const isPresent = input.derived.isPersonPresent;

    if (isPresent) {
      state.lightAlpha = Math.min(1, state.lightAlpha + dt * P.fadeSpeed);

      let targetX = null;
      let targetY = null;

      if (input.pose && input.pose.landmarks && input.pose.landmarks.length > 0) {
        const lm = input.pose.landmarks[0];
        if (lm[0]) {
          targetX = 1 - lm[0].x;
          targetY = lm[0].y;
        }
      } else if (input.derived.horizontalPosition !== undefined) {
        targetX = input.derived.horizontalPosition;
        targetY = 0.45;
      }

      if (targetX !== null) {
        const smoothing = 1 - Math.exp(-dt * 3.0);
        if (!state.hasTarget) {
          state.lightX = targetX;
          state.lightY = targetY;
          state.hasTarget = true;
        } else {
          state.lightX = lerp(state.lightX, targetX, smoothing);
          state.lightY = lerp(state.lightY, targetY, smoothing);
        }
      }
    } else {
      state.lightAlpha = Math.max(0, state.lightAlpha - dt * P.fadeSpeed * 0.5);
      state.hasTarget = false;
    }
  },

  render(state, input, ctx, canvas) {
    const P = state.params;
    const w = canvas.width;
    const h = canvas.height;
    const elapsed = input.time.elapsed;
    const data = state.imageData.data;

    const t = elapsed * P.noiseSpeed;
    const oct = Math.round(P.octaves);
    const aspectRatio = RENDER_W / RENDER_H;

    for (let py = 0; py < RENDER_H; py++) {
      const ny = py / RENDER_H;

      for (let px = 0; px < RENDER_W; px++) {
        const nx = px / RENDER_W;

        // --- Aurora smoke via two FBM layers ---
        const sx = nx * P.noiseScale;
        const sy = ny * P.noiseScale;

        // Layer 1: main smoke structure
        const n1 = fbm3D(sx, sy, t, oct, 2.1, 0.48);
        // Layer 2: color swirl variation (offset in noise space, slower)
        const n2 = fbm3D(sx + 7.3, sy + 2.9, t * 0.55, oct - 1, 2.0, 0.5);

        // Map noise to smoke density (0-1)
        const density = clamp(n1 * 0.5 + 0.5, 0, 1);

        // Hue shifts across the smoke based on n2
        const hue = P.baseHue + n2 * P.hueRange;
        // Saturation higher in mid-density areas
        const sat = clamp(0.55 + density * 0.3, 0, 1);
        // Lightness: dark floor, driven by density
        const lit = P.darkBg + Math.pow(density, 1.4) * (0.35 - P.darkBg);

        let [r, g, b] = hslToRgb(hue, sat, lit);

        // --- Flashlight from person position ---
        if (state.lightAlpha > 0 && state.hasTarget) {
          const dx = (nx - state.lightX) * aspectRatio;
          const dy = ny - state.lightY;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < P.glowRadius) {
            const t01 = dist / P.glowRadius;
            const falloff = Math.pow(1 - t01, P.glowFalloff);
            const lightIntensity = clamp(falloff * P.glowStrength * state.lightAlpha, 0, 1);

            if (lightIntensity > 0) {
              // Illuminate the smoke: boost its own brightness and saturation
              const boostedLit = clamp(lit + lightIntensity * 0.5, 0, 0.8);
              const boostedSat = clamp(sat + lightIntensity * 0.25, 0, 1);
              // Subtle hue shift toward light color in bright areas
              const shiftedHue = hue + (P.glowHue - hue) * lightIntensity * P.lightBlend * 0.3;
              [r, g, b] = hslToRgb(shiftedHue, boostedSat, boostedLit);
            }
          }
        }

        const idx = (py * RENDER_W + px) * 4;
        data[idx]     = clamp(r, 0, 255);
        data[idx + 1] = clamp(g, 0, 255);
        data[idx + 2] = clamp(b, 0, 255);
        data[idx + 3] = 255;
      }
    }

    state.offCtx.putImageData(state.imageData, 0, 0);

    // Scale up with slight blur for dreamy softness
    ctx.filter = 'blur(3px)';
    ctx.drawImage(state.offscreen, -3, -3, w + 6, h + 6);
    ctx.filter = 'none';
  },

  resize(state, width, height) {},
  cleanup(state) {},
};
