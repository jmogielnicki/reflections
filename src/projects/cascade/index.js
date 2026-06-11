import { getPixelColor, getBrightnessGrid } from '../../utils/pixels.js';
import { rgbString, hslToRgb, rgbToHsl } from '../../utils/color.js';
import { lerp, clamp, randomRange } from '../../utils/math.js';
import { noise2D } from '../../utils/noise.js';

const GRID_COLS = 80;
const GRID_ROWS = 60;

// Direction: 0=Down, 1=Up, 2=Right, 3=Left
const DIR_DOWN = 0, DIR_UP = 1, DIR_RIGHT = 2, DIR_LEFT = 3;

export default {
  id: 'cascade',
  name: 'Cascade',
  description: 'Colored pills stream down vertical tracks, stretching tall in dark areas and racing through bright ones — a waterfall self-portrait.',
  mediapipe: [],
  params: {
    direction:       { value: 0,     min: 0,    max: 3,     step: 1,     label: 'Direction (0-3)' },
    numLines:        { value: 140,   min: 40,   max: 300,   step: 5,     label: 'Lines' },
    minSpeed:        { value: 0.5,   min: 0.1,  max: 3,     step: 0.1,   label: 'Min Speed' },
    maxSpeed:        { value: 4,     min: 1,    max: 12,    step: 0.5,   label: 'Max Speed' },
    spawnCooldown:   { value: 12,    min: 4,    max: 40,    step: 1,     label: 'Spawn Cooldown' },
    pillRadius:      { value: 1.5,   min: 0.5,  max: 4,     step: 0.5,   label: 'Pill Radius' },
    minExtraHeight:  { value: 0,     min: 0,    max: 10,    step: 1,     label: 'Min Extra Length' },
    maxExtraHeight:  { value: 18,    min: 5,    max: 60,    step: 1,     label: 'Max Extra Length' },
    sizeInertia:     { value: 0.06,  min: 0.01, max: 0.3,   step: 0.01,  label: 'Size Inertia' },
    colorMode:       { value: 1,     min: 0,    max: 1,     step: 1,     label: 'Color (0=Ink, 1=Webcam)' },
    saturationBoost: { value: 1.4,   min: 1.0,  max: 2.5,   step: 0.1,   label: 'Saturation Boost' },
    guideLineAlpha:  { value: 0.12,  min: 0.0,  max: 0.4,   step: 0.02,  label: 'Guide Line Opacity' },
    trailFade:       { value: 0.0,   min: 0.0,  max: 0.05,  step: 0.005, label: 'Trail Persistence' },
  },
  presets: [
    {
      name: 'Classic Ink',
      values: { direction: 0, colorMode: 0, numLines: 150, saturationBoost: 1.0, guideLineAlpha: 0.15, pillRadius: 1, maxExtraHeight: 15, trailFade: 0 },
    },
    {
      name: 'Vivid Portrait',
      values: { direction: 0, colorMode: 1, numLines: 160, saturationBoost: 1.8, maxSpeed: 5, maxExtraHeight: 22, guideLineAlpha: 0.06, trailFade: 0.01 },
    },
    {
      name: 'Dense Downpour',
      values: { direction: 0, numLines: 280, spawnCooldown: 5, pillRadius: 0.8, minSpeed: 1, maxSpeed: 8, maxExtraHeight: 12, colorMode: 1, saturationBoost: 1.3, guideLineAlpha: 0.04, trailFade: 0.005 },
    },
    {
      name: 'Rising Embers',
      values: { direction: 1, numLines: 120, minSpeed: 0.3, maxSpeed: 3, pillRadius: 1.5, maxExtraHeight: 14, colorMode: 1, saturationBoost: 2.0, guideLineAlpha: 0.05, trailFade: 0.015 },
    },
    {
      name: 'Sideways Rain',
      values: { direction: 2, numLines: 100, minSpeed: 1, maxSpeed: 6, pillRadius: 1, maxExtraHeight: 20, colorMode: 1, saturationBoost: 1.4, guideLineAlpha: 0.08, trailFade: 0 },
    },
  ],

  init(ctx, canvas) {
    const accCanvas = new OffscreenCanvas(canvas.width, canvas.height);
    const accCtx = accCanvas.getContext('2d');
    accCtx.fillStyle = '#F0EEE6';
    accCtx.fillRect(0, 0, canvas.width, canvas.height);

    return {
      pills: [],
      spawnCounters: [],
      accCanvas,
      accCtx,
      prevNumLines: 0,
      prevDirection: -1,
    };
  },

  update(state, input, dt) {
    const P = state.params;
    const { width, height } = input.canvas;
    const numLines = Math.round(P.numLines);
    const dir = Math.round(P.direction);
    const isHorizontal = dir === DIR_RIGHT || dir === DIR_LEFT;

    // The cross-axis is what lines are spaced along
    // The travel-axis is what pills move along
    const crossLength = isHorizontal ? height : width;
    const travelLength = isHorizontal ? width : height;

    // Reinitialize if line count or direction changed
    if (numLines !== state.prevNumLines || dir !== state.prevDirection) {
      state.pills = [];
      state.spawnCounters = [];
      for (let i = 0; i < numLines; i++) {
        state.pills.push([]);
        state.spawnCounters.push(Math.floor(Math.random() * Math.round(P.spawnCooldown)));
      }
      state.prevNumLines = numLines;
      state.prevDirection = dir;
    }

    const lineSpacing = crossLength / numLines;
    const pixels = input.getPixelData();
    const webcamDims = input.getWebcamDimensions();
    const grid = input.getBrightnessGrid(GRID_COLS, GRID_ROWS);

    const elapsed = input.time.elapsed;
    const dtScale = dt * 60;

    // Travel direction sign: +1 for down/right, -1 for up/left
    const travelSign = (dir === DIR_DOWN || dir === DIR_RIGHT) ? 1 : -1;
    // Spawn position: start edge of travel axis
    const spawnPos = travelSign > 0 ? -P.pillRadius * 2 : travelLength + P.pillRadius * 2;

    for (let i = 0; i < numLines; i++) {
      // Cross-axis position of this line
      const crossPos = i * lineSpacing + lineSpacing / 2;

      // Spawn logic
      state.spawnCounters[i] -= dtScale;
      if (state.spawnCounters[i] <= 0) {
        const noiseOffset = noise2D(i * 0.1, elapsed * 0.5) * 0.3;
        const cooldown = P.spawnCooldown * (1 + noiseOffset);
        state.spawnCounters[i] = cooldown + randomRange(-2, 2);

        // Sample initial color at spawn edge
        const screenX = isHorizontal ? spawnPos : crossPos;
        const screenY = isHorizontal ? crossPos : spawnPos;
        const wx = clamp(Math.floor((screenX / width) * webcamDims.width), 0, webcamDims.width - 1);
        const wy = clamp(Math.floor((screenY / height) * webcamDims.height), 0, webcamDims.height - 1);
        const [sr, sg, sb] = getPixelColor(pixels, wx, wy);

        state.pills[i].push({
          pos: spawnPos,
          extraHeight: (P.minExtraHeight + P.maxExtraHeight) / 2,
          r: sr, g: sg, b: sb,
        });
      }

      // Update pills
      const linePills = state.pills[i];
      for (let j = linePills.length - 1; j >= 0; j--) {
        const pill = linePills[j];

        // Map pill to screen coords for brightness sampling
        const screenX = isHorizontal ? pill.pos : crossPos;
        const screenY = isHorizontal ? crossPos : pill.pos;

        // Sample brightness at pill position
        const gx = Math.floor((clamp(screenX, 0, width - 1) / width) * grid.cols);
        const gy = Math.floor((clamp(screenY, 0, height - 1) / height) * grid.rows);
        const cgx = clamp(gx, 0, grid.cols - 1);
        const cgy = clamp(gy, 0, grid.rows - 1);
        const brightness = grid.cells[cgy * grid.cols + cgx];

        // Bright = fast, dark = slow
        const speed = P.minSpeed + brightness * (P.maxSpeed - P.minSpeed);
        // Dark = tall, bright = short
        const targetExtra = P.minExtraHeight + (1 - brightness) * (P.maxExtraHeight - P.minExtraHeight);

        pill.pos += speed * dtScale * travelSign;
        pill.extraHeight = lerp(pill.extraHeight, targetExtra, P.sizeInertia);

        // Resample webcam color
        if (Math.round(P.colorMode) === 1) {
          const wx = clamp(Math.floor((clamp(screenX, 0, width - 1) / width) * webcamDims.width), 0, webcamDims.width - 1);
          const wy = clamp(Math.floor((clamp(screenY, 0, height - 1) / height) * webcamDims.height), 0, webcamDims.height - 1);
          const [pr, pg, pb] = getPixelColor(pixels, wx, wy);
          pill.r = Math.round(lerp(pill.r, pr, 0.15));
          pill.g = Math.round(lerp(pill.g, pg, 0.15));
          pill.b = Math.round(lerp(pill.b, pb, 0.15));
        }

        pill._brightness = brightness;

        // Remove if off screen
        const totalLen = P.pillRadius * 2 + pill.extraHeight;
        const pastEnd = travelSign > 0
          ? pill.pos - totalLen / 2 > travelLength
          : pill.pos + totalLen / 2 < 0;
        if (pastEnd) {
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
    const dir = Math.round(P.direction);
    const isHorizontal = dir === DIR_RIGHT || dir === DIR_LEFT;
    const crossLength = isHorizontal ? h : w;
    const lineSpacing = crossLength / numLines;

    const accCtx = state.accCtx;

    // Resize accumulation canvas if needed
    if (state.accCanvas.width !== w || state.accCanvas.height !== h) {
      state.accCanvas.width = w;
      state.accCanvas.height = h;
      accCtx.fillStyle = '#F0EEE6';
      accCtx.fillRect(0, 0, w, h);
    }

    if (P.trailFade > 0) {
      accCtx.fillStyle = `rgba(240, 238, 230, ${P.trailFade})`;
      accCtx.fillRect(0, 0, w, h);
      _drawFrame(accCtx, state, P, numLines, lineSpacing, w, h, dir, isHorizontal);
      ctx.drawImage(state.accCanvas, 0, 0);
    } else {
      ctx.fillStyle = '#F0EEE6';
      ctx.fillRect(0, 0, w, h);
      _drawFrame(ctx, state, P, numLines, lineSpacing, w, h, dir, isHorizontal);
    }
  },

  resize(state, width, height) {
    state.prevNumLines = 0;
  },

  cleanup(state) {
    state.pills = [];
    state.spawnCounters = [];
  },
};

function _drawFrame(ctx, state, P, numLines, lineSpacing, w, h, dir, isHorizontal) {
  const capR = P.pillRadius;

  // Draw guide lines
  if (P.guideLineAlpha > 0) {
    ctx.strokeStyle = `rgba(160, 155, 145, ${P.guideLineAlpha})`;
    ctx.lineWidth = 0.5;
    for (let i = 0; i < numLines; i++) {
      const crossPos = i * lineSpacing + lineSpacing / 2;
      ctx.beginPath();
      if (isHorizontal) {
        ctx.moveTo(0, crossPos);
        ctx.lineTo(w, crossPos);
      } else {
        ctx.moveTo(crossPos, 0);
        ctx.lineTo(crossPos, h);
      }
      ctx.stroke();
    }
  }

  // Draw pills
  for (let i = 0; i < numLines; i++) {
    const crossPos = i * lineSpacing + lineSpacing / 2;
    const linePills = state.pills[i];
    if (!linePills) continue;

    for (const pill of linePills) {
      const rectH = Math.max(0, pill.extraHeight);

      // Determine fill color
      let fillStyle;
      if (Math.round(P.colorMode) === 0) {
        const alpha = clamp(0.6 + (1 - pill._brightness) * 0.4, 0.3, 1);
        fillStyle = `rgba(34, 34, 34, ${alpha})`;
      } else {
        let [hue, sat, light] = rgbToHsl(pill.r, pill.g, pill.b);
        sat = clamp(sat * P.saturationBoost, 0, 1);
        light = clamp(light * 0.85, 0.08, 0.75);
        const [cr, cg, cb] = hslToRgb(hue, sat, light);
        const alpha = clamp(0.7 + (1 - pill._brightness) * 0.3, 0.5, 1);
        fillStyle = rgbString(cr, cg, cb, alpha);
      }

      ctx.fillStyle = fillStyle;
      ctx.beginPath();

      if (isHorizontal) {
        // Pill oriented horizontally: caps on left/right
        const x = pill.pos;
        const y = crossPos;
        ctx.arc(x - rectH / 2, y, capR, 0.5 * Math.PI, 1.5 * Math.PI);
        ctx.lineTo(x + rectH / 2, y - capR);
        ctx.arc(x + rectH / 2, y, capR, 1.5 * Math.PI, 0.5 * Math.PI);
        ctx.lineTo(x - rectH / 2, y + capR);
      } else {
        // Pill oriented vertically: caps on top/bottom
        const x = crossPos;
        const y = pill.pos;
        ctx.arc(x, y - rectH / 2, capR, Math.PI, 2 * Math.PI);
        ctx.lineTo(x + capR, y + rectH / 2);
        ctx.arc(x, y + rectH / 2, capR, 0, Math.PI);
        ctx.lineTo(x - capR, y - rectH / 2);
      }

      ctx.closePath();
      ctx.fill();
    }
  }
}
