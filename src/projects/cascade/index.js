import { getPixelColor, getBrightnessGrid } from '../../utils/pixels.js';
import { rgbString, hslToRgb, rgbToHsl } from '../../utils/color.js';
import { lerp, clamp, randomRange } from '../../utils/math.js';
import { noise2D } from '../../utils/noise.js';

const GRID_COLS = 80;
const GRID_ROWS = 60;

export default {
  id: 'cascade',
  name: 'Cascade',
  description: 'Colored pills stream down vertical tracks, stretching tall in dark areas and racing through bright ones — a waterfall self-portrait.',
  mediapipe: [],
  params: {
    numLines:        { value: 140,   min: 40,   max: 300,   step: 5,     label: 'Vertical Lines' },
    minSpeed:        { value: 0.5,   min: 0.1,  max: 3,     step: 0.1,   label: 'Min Fall Speed' },
    maxSpeed:        { value: 4,     min: 1,    max: 12,    step: 0.5,   label: 'Max Fall Speed' },
    spawnCooldown:   { value: 12,    min: 4,    max: 40,    step: 1,     label: 'Spawn Cooldown' },
    pillRadius:      { value: 1.5,   min: 0.5,  max: 4,     step: 0.5,   label: 'Pill Radius' },
    minExtraHeight:  { value: 0,     min: 0,    max: 10,    step: 1,     label: 'Min Extra Height' },
    maxExtraHeight:  { value: 18,    min: 5,    max: 60,    step: 1,     label: 'Max Extra Height' },
    sizeInertia:     { value: 0.06,  min: 0.01, max: 0.3,   step: 0.01,  label: 'Size Inertia' },
    colorMode:       { value: 1,     min: 0,    max: 1,     step: 1,     label: 'Color (0=Ink, 1=Webcam)' },
    saturationBoost: { value: 1.4,   min: 1.0,  max: 2.5,   step: 0.1,   label: 'Saturation Boost' },
    guideLineAlpha:  { value: 0.12,  min: 0.0,  max: 0.4,   step: 0.02,  label: 'Guide Line Opacity' },
    trailFade:       { value: 0.0,   min: 0.0,  max: 0.05,  step: 0.005, label: 'Trail Persistence' },
  },
  presets: [
    {
      name: 'Classic Ink',
      values: { colorMode: 0, numLines: 150, saturationBoost: 1.0, guideLineAlpha: 0.15, pillRadius: 1, maxExtraHeight: 15, trailFade: 0 },
    },
    {
      name: 'Vivid Portrait',
      values: { colorMode: 1, numLines: 160, saturationBoost: 1.8, maxSpeed: 5, maxExtraHeight: 22, guideLineAlpha: 0.06, trailFade: 0.01 },
    },
    {
      name: 'Dense Downpour',
      values: { numLines: 280, spawnCooldown: 5, pillRadius: 0.8, minSpeed: 1, maxSpeed: 8, maxExtraHeight: 12, colorMode: 1, saturationBoost: 1.3, guideLineAlpha: 0.04, trailFade: 0.005 },
    },
  ],

  init(ctx, canvas) {
    // Accumulation canvas for trail effect
    const accCanvas = new OffscreenCanvas(canvas.width, canvas.height);
    const accCtx = accCanvas.getContext('2d');
    accCtx.fillStyle = '#F0EEE6';
    accCtx.fillRect(0, 0, canvas.width, canvas.height);

    return {
      pills: [],          // pills[lineIndex] = array of pill objects
      spawnCounters: [],   // per-line cooldown countdown
      accCanvas,
      accCtx,
      prevNumLines: 0,
    };
  },

  update(state, input, dt) {
    const P = state.params;
    const { width, height } = input.canvas;
    const numLines = Math.round(P.numLines);

    // Reinitialize if line count changed
    if (numLines !== state.prevNumLines) {
      state.pills = [];
      state.spawnCounters = [];
      for (let i = 0; i < numLines; i++) {
        state.pills.push([]);
        state.spawnCounters.push(Math.floor(Math.random() * Math.round(P.spawnCooldown)));
      }
      state.prevNumLines = numLines;
    }

    const lineSpacing = width / numLines;
    const pixels = input.getPixelData();
    const webcamDims = input.getWebcamDimensions();
    const grid = input.getBrightnessGrid(GRID_COLS, GRID_ROWS);

    const elapsed = input.time.elapsed;
    // dt-scaled frame multiplier (targeting 60fps baseline)
    const dtScale = dt * 60;

    for (let i = 0; i < numLines; i++) {
      const xPos = i * lineSpacing + lineSpacing / 2;

      // Spawn logic
      state.spawnCounters[i] -= dtScale;
      if (state.spawnCounters[i] <= 0) {
        // Noise-modulated cooldown for organic timing
        const noiseOffset = noise2D(i * 0.1, elapsed * 0.5) * 0.3;
        const cooldown = P.spawnCooldown * (1 + noiseOffset);
        state.spawnCounters[i] = cooldown + randomRange(-2, 2);

        // Sample color from webcam at spawn position (top of screen)
        const wx = Math.floor((xPos / width) * webcamDims.width);
        const wy = 0;
        const cx = clamp(wx, 0, webcamDims.width - 1);
        const [sr, sg, sb] = getPixelColor(pixels, cx, wy);

        state.pills[i].push({
          y: -P.pillRadius * 2,
          extraHeight: (P.minExtraHeight + P.maxExtraHeight) / 2,
          r: sr, g: sg, b: sb,  // will be resampled as it falls
        });
      }

      // Update pills on this line
      const linePills = state.pills[i];
      for (let j = linePills.length - 1; j >= 0; j--) {
        const pill = linePills[j];

        // Sample brightness at pill's current position
        const gx = Math.floor((xPos / width) * grid.cols);
        const gy = Math.floor((clamp(pill.y, 0, height - 1) / height) * grid.rows);
        const cgx = clamp(gx, 0, grid.cols - 1);
        const cgy = clamp(gy, 0, grid.rows - 1);
        const brightness = grid.cells[cgy * grid.cols + cgx];

        // Bright = fast, dark = slow
        const speed = P.minSpeed + brightness * (P.maxSpeed - P.minSpeed);
        // Dark = tall, bright = short
        const targetExtra = P.minExtraHeight + (1 - brightness) * (P.maxExtraHeight - P.minExtraHeight);

        pill.y += speed * dtScale;
        pill.extraHeight = lerp(pill.extraHeight, targetExtra, P.sizeInertia);

        // Resample webcam color at current position
        if (Math.round(P.colorMode) === 1) {
          const wx = Math.floor((xPos / width) * webcamDims.width);
          const wy = Math.floor((clamp(pill.y, 0, height - 1) / height) * webcamDims.height);
          const cx2 = clamp(wx, 0, webcamDims.width - 1);
          const cy2 = clamp(wy, 0, webcamDims.height - 1);
          const [pr, pg, pb] = getPixelColor(pixels, cx2, cy2);
          // Smooth color transition
          pill.r = Math.round(lerp(pill.r, pr, 0.15));
          pill.g = Math.round(lerp(pill.g, pg, 0.15));
          pill.b = Math.round(lerp(pill.b, pb, 0.15));
        }

        // Store brightness for rendering
        pill._brightness = brightness;

        // Remove if fully off screen
        const totalHeight = P.pillRadius * 2 + pill.extraHeight;
        if (pill.y - totalHeight / 2 > height) {
          linePills.splice(j, 1);
        }
      }
    }
  },

  render(state, input, ctx, canvas) {
    const P = state.params;
    const w = canvas.width;
    const h = canvas.height;
    const numLines = Math.round(P.numLines);
    const lineSpacing = w / numLines;

    const accCtx = state.accCtx;

    // Resize accumulation canvas if needed
    if (state.accCanvas.width !== w || state.accCanvas.height !== h) {
      state.accCanvas.width = w;
      state.accCanvas.height = h;
      accCtx.fillStyle = '#F0EEE6';
      accCtx.fillRect(0, 0, w, h);
    }

    // Fade accumulation toward background
    if (P.trailFade > 0) {
      // Trail mode: draw to accumulation canvas, slow fade
      accCtx.fillStyle = `rgba(240, 238, 230, ${P.trailFade})`;
      accCtx.fillRect(0, 0, w, h);
      _drawFrame(accCtx, state, P, numLines, lineSpacing, w, h);
      ctx.drawImage(state.accCanvas, 0, 0);
    } else {
      // No trail: draw directly to main canvas
      ctx.fillStyle = '#F0EEE6';
      ctx.fillRect(0, 0, w, h);
      _drawFrame(ctx, state, P, numLines, lineSpacing, w, h);
    }
  },

  resize(state, width, height) {
    // Force re-init on resize
    state.prevNumLines = 0;
  },

  cleanup(state) {
    state.pills = [];
    state.spawnCounters = [];
  },
};

function _drawFrame(ctx, state, P, numLines, lineSpacing, w, h) {
  const capR = P.pillRadius;

  // Draw guide lines
  if (P.guideLineAlpha > 0) {
    ctx.strokeStyle = `rgba(160, 155, 145, ${P.guideLineAlpha})`;
    ctx.lineWidth = 0.5;
    for (let i = 0; i < numLines; i++) {
      const x = i * lineSpacing + lineSpacing / 2;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
  }

  // Draw pills
  for (let i = 0; i < numLines; i++) {
    const xPos = i * lineSpacing + lineSpacing / 2;
    const linePills = state.pills[i];
    if (!linePills) continue;

    for (const pill of linePills) {
      const rectH = Math.max(0, pill.extraHeight);

      // Determine fill color
      let fillStyle;
      if (Math.round(P.colorMode) === 0) {
        // Ink mode: dark with brightness-based opacity
        const alpha = clamp(0.6 + (1 - pill._brightness) * 0.4, 0.3, 1);
        fillStyle = `rgba(34, 34, 34, ${alpha})`;
      } else {
        // Webcam color mode with saturation boost
        let [hue, sat, light] = rgbToHsl(pill.r, pill.g, pill.b);
        sat = clamp(sat * P.saturationBoost, 0, 1);
        // Slightly deepen for richness
        light = clamp(light * 0.85, 0.08, 0.75);
        const [cr, cg, cb] = hslToRgb(hue, sat, light);
        const alpha = clamp(0.7 + (1 - pill._brightness) * 0.3, 0.5, 1);
        fillStyle = rgbString(cr, cg, cb, alpha);
      }

      ctx.fillStyle = fillStyle;
      ctx.beginPath();

      // Pill shape: top cap + rect + bottom cap
      ctx.arc(xPos, pill.y - rectH / 2, capR, Math.PI, 2 * Math.PI);
      ctx.lineTo(xPos + capR, pill.y + rectH / 2);
      ctx.arc(xPos, pill.y + rectH / 2, capR, 0, Math.PI);
      ctx.lineTo(xPos - capR, pill.y - rectH / 2);
      ctx.closePath();
      ctx.fill();
    }
  }
}
