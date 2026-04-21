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
      // Light source positions (normalized 0-1, canvas space)
      // We track up to 2 lights: head and torso
      lights: [],
      // Smooth entry/exit
      lightAlpha: 0,
    };
  },

  update(state, input, dt) {
    const P = state.params;
    const isPresent = input.derived.isPersonPresent;

    if (isPresent) {
      state.lightAlpha = Math.min(1, state.lightAlpha + dt * P.fadeSpeed);

      // Build light positions from pose landmarks
      state.lights = [];

      // Head light: from nose landmark if available
      if (input.pose && input.pose.landmarks && input.pose.landmarks.length > 0) {
        const lm = input.pose.landmarks[0];

        // Nose (idx 0)
        if (lm[0]) {
          state.lights.push({
            x: 1 - lm[0].x,  // mirror
            y: lm[0].y,
            weight: 0.6,
          });
        }

        // Chest midpoint: between shoulders (11, 12)
        if (lm[11] && lm[12]) {
          state.lights.push({
            x: 1 - (lm[11].x + lm[12].x) * 0.5,
            y: (lm[11].y + lm[12].y) * 0.5 + 0.08,
            weight: 0.8,
          });
        }

        // Hip midpoint (23, 24) — lower body glow
        if (lm[23] && lm[24]) {
          state.lights.push({
            x: 1 - (lm[23].x + lm[24].x) * 0.5,
            y: (lm[23].y + lm[24].y) * 0.5,
            weight: 0.4,
          });
        }
      } else if (input.derived.horizontalPosition !== undefined) {
        // Fallback: use horizontal position only
        state.lights.push({ x: input.derived.horizontalPosition, y: 0.45, weight: 1.0 });
      }
    } else {
      state.lightAlpha = Math.max(0, state.lightAlpha - dt * P.fadeSpeed * 0.5);
      state.lights = [];
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

        // --- Flashlight from person positions ---
        if (state.lightAlpha > 0 && state.lights.length > 0) {
          // Combine all light contributions
          let totalLight = 0;
          for (const light of state.lights) {
            const dx = (nx - light.x) * aspectRatio;
            const dy = ny - light.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const radius = P.glowRadius * light.weight;
            if (dist < radius) {
              const t01 = dist / radius;
              // Smooth falloff: bright center, soft edge
              const falloff = Math.pow(1 - t01, P.glowFalloff);
              totalLight += falloff * light.weight;
            }
          }

          const lightIntensity = clamp(totalLight * P.glowStrength * state.lightAlpha, 0, 1);

          if (lightIntensity > 0) {
            // Flashlight effect: reveal the smoke color AND shift hue toward light color
            const litSmoke = clamp(lit + lightIntensity * 0.55, 0, 0.85);

            // Base color boosted by light
            const [lr, lg, lb] = hslToRgb(hue, sat, litSmoke);

            // Light color tint (the "colored flashlight")
            const tintLit = clamp(0.35 + lightIntensity * 0.35, 0, 0.75);
            const [tr_, tg_, tb_] = hslToRgb(P.glowHue, 0.9, tintLit);

            // Blend: mostly lit smoke, partially tinted by light color
            const blend = lightIntensity * P.lightBlend;
            r = Math.round(lerp(lr, tr_, blend));
            g = Math.round(lerp(lg, tg_, blend));
            b = Math.round(lerp(lb, tb_, blend));
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
