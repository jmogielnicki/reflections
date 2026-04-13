import { extractMask, getCenterOfMass } from '../../utils/silhouette.js';
import { noise2D } from '../../utils/noise.js';
import { hslToRgb } from '../../utils/color.js';
import { lerp, clamp } from '../../utils/math.js';

export default {
  id: 'paint-smear',
  name: 'Paint Smear',
  description: 'Your silhouette smears colorful paint across the canvas. Step away and it slowly retracts.',
  mediapipe: ['segmentation'],
  params: {
    retractSpeed:  { value: 0.015, min: 0.001, max: 0.1,  step: 0.001, label: 'Retract Speed' },
    smearStrength: { value: 12,    min: 2,     max: 40,   step: 1,     label: 'Smear Strength' },
    colorBoost:    { value: 1.3,   min: 1.0,   max: 2.0,  step: 0.05,  label: 'Color Boost' },
    paintNoiseFreq:{ value: 0.004, min: 0.001, max: 0.02, step: 0.001, label: 'Paint Noise Freq' },
  },

  init(ctx, canvas) {
    const w = canvas.width;
    const h = canvas.height;

    // Create paint layer with noise-based colorful blobs
    const paintCanvas = new OffscreenCanvas(w, h);
    const paintCtx = paintCanvas.getContext('2d');

    _generatePaint(paintCtx, w, h, 0.004);

    // Store the original for retraction
    const originalData = paintCtx.getImageData(0, 0, w, h);

    return {
      paintCanvas,
      paintCtx,
      originalData,
      prevCenterX: 0.5,
      prevCenterY: 0.5,
      prevMask: null,
      prevMaskWidth: 0,
      prevMaskHeight: 0,
    };
  },

  update(state, input, dt) {
    if (!input.segmentation) return;
    const P = state.params;

    const maskResult = extractMask(input.segmentation);
    const { data: maskData, width: mw, height: mh } = maskResult;

    const paintCtx = state.paintCtx;
    const pw = state.paintCanvas.width;
    const ph = state.paintCanvas.height;

    // Get center of mass for motion direction
    const center = getCenterOfMass(maskResult);
    let dx = 0, dy = 0;
    if (center) {
      // Mirror the x position since webcam is mirrored
      const cx = 1 - center.x;
      dx = (cx - state.prevCenterX) * P.smearStrength;
      dy = (center.y - state.prevCenterY) * P.smearStrength;
      state.prevCenterX = lerp(state.prevCenterX, cx, 0.3);
      state.prevCenterY = lerp(state.prevCenterY, center.y, 0.3);
    }

    const paintData = paintCtx.getImageData(0, 0, pw, ph);
    const origData = state.originalData.data;
    const pd = paintData.data;

    // Process pixels
    const scaleX = mw / pw;
    const scaleY = mh / ph;

    // Smear: shift pixels in direction of movement where person is
    if (Math.abs(dx) > 0.3 || Math.abs(dy) > 0.3) {
      const tempData = new Uint8ClampedArray(pd);

      for (let py = 0; py < ph; py += 2) {
        const my = Math.floor(py * scaleY);
        for (let px = 0; px < pw; px += 2) {
          const mx = Math.floor(px * scaleX);

          if (mx < mw && my < mh && maskData[my * mw + mx] > 0) {
            // Source pixel to smear from
            const srcX = Math.floor(clamp(px - dx, 0, pw - 1));
            const srcY = Math.floor(clamp(py - dy, 0, ph - 1));

            const di = (py * pw + px) * 4;
            const si = (srcY * pw + srcX) * 4;

            // Copy source pixel with color boost
            pd[di] = clamp(Math.floor(tempData[si] * P.colorBoost), 0, 255);
            pd[di + 1] = clamp(Math.floor(tempData[si + 1] * P.colorBoost), 0, 255);
            pd[di + 2] = clamp(Math.floor(tempData[si + 2] * P.colorBoost), 0, 255);
            pd[di + 3] = 255;

            // Also fill adjacent pixels for coverage
            if (px + 1 < pw) {
              const di2 = di + 4;
              pd[di2] = pd[di]; pd[di2 + 1] = pd[di + 1]; pd[di2 + 2] = pd[di + 2]; pd[di2 + 3] = 255;
            }
            if (py + 1 < ph) {
              const di2 = ((py + 1) * pw + px) * 4;
              pd[di2] = pd[di]; pd[di2 + 1] = pd[di + 1]; pd[di2 + 2] = pd[di + 2]; pd[di2 + 3] = 255;
            }
          }
        }
      }
    }

    // Retract: where person is NOT, pull paint back toward original
    for (let py = 0; py < ph; py += 2) {
      const my = Math.floor(py * scaleY);
      for (let px = 0; px < pw; px += 2) {
        const mx = Math.floor(px * scaleX);
        const personHere = mx < mw && my < mh && maskData[my * mw + mx] > 0;

        if (!personHere) {
          const i = (py * pw + px) * 4;
          pd[i] = Math.round(lerp(pd[i], origData[i], P.retractSpeed));
          pd[i + 1] = Math.round(lerp(pd[i + 1], origData[i + 1], P.retractSpeed));
          pd[i + 2] = Math.round(lerp(pd[i + 2], origData[i + 2], P.retractSpeed));

          // Fill adjacent
          if (px + 1 < pw) {
            const i2 = i + 4;
            pd[i2] = pd[i]; pd[i2 + 1] = pd[i + 1]; pd[i2 + 2] = pd[i + 2];
          }
          if (py + 1 < ph) {
            const i2 = ((py + 1) * pw + px) * 4;
            pd[i2] = pd[i]; pd[i2 + 1] = pd[i + 1]; pd[i2 + 2] = pd[i + 2];
          }
        }
      }
    }

    paintCtx.putImageData(paintData, 0, 0);

    state.prevMask = maskData;
    state.prevMaskWidth = mw;
    state.prevMaskHeight = mh;
  },

  render(state, input, ctx, canvas) {
    ctx.drawImage(state.paintCanvas, 0, 0, canvas.width, canvas.height);
  },

  resize(state, width, height) {
    // Regenerate paint at new size
    state.paintCanvas.width = width;
    state.paintCanvas.height = height;
    const freq = state.params ? state.params.paintNoiseFreq : 0.004;
    _generatePaint(state.paintCtx, width, height, freq);
    state.originalData = state.paintCtx.getImageData(0, 0, width, height);
  },

  cleanup(state) {
    // Nothing to clean up
  },
};

function _generatePaint(ctx, w, h, freq = 0.004) {
  // Create a colorful paint blob using noise
  const imageData = ctx.createImageData(w, h);
  const d = imageData.data;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;

      // Multiple noise layers for color variation
      const n1 = noise2D(x * freq, y * freq);
      const n2 = noise2D(x * freq * 2 + 100, y * freq * 2 + 100);
      const n3 = noise2D(x * freq * 0.5 + 200, y * freq * 0.5 + 200);

      // Distance from center affects intensity
      const cx = x / w - 0.5;
      const cy = y / h - 0.5;
      const distFromCenter = Math.sqrt(cx * cx + cy * cy);
      const falloff = clamp(1 - distFromCenter * 1.8, 0, 1);

      const hue = ((n1 + 1) * 180 + n2 * 60) % 360;
      const sat = 0.3 + n3 * 0.15;
      const light = 0.4 + n2 * 0.1;

      const [r, g, b] = hslToRgb(hue, sat, light);

      // Blend with gray background based on falloff
      const bg = 140;
      d[i] = Math.round(lerp(bg, r, falloff));
      d[i + 1] = Math.round(lerp(bg, g, falloff));
      d[i + 2] = Math.round(lerp(bg, b, falloff));
      d[i + 3] = 255;
    }
  }

  ctx.putImageData(imageData, 0, 0);
}
