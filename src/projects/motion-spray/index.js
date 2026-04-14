import { getPixelColor } from '../../utils/pixels.js';
import { rgbString } from '../../utils/color.js';
import { randomRange, randomInt, clamp } from '../../utils/math.js';
import { noise2D } from '../../utils/noise.js';

// Color distance: Euclidean in RGB, normalized 0-1
// Max distance = sqrt(255^2 * 3) ≈ 441.67
const MAX_RGB_DIST = Math.sqrt(255 * 255 * 3);

function colorDistance(r1, g1, b1, r2, g2, b2) {
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return Math.sqrt(dr * dr + dg * dg + db * db) / MAX_RGB_DIST;
}

export default {
  id: 'motion-spray',
  name: 'Motion Spray',
  description: 'Areas of movement get sprayed with paint dots. Stay still and the portrait crystallizes. Move and it splatters.',
  mediapipe: [],
  params: {
    changeThreshold: { value: 0.3,   min: 0.05, max: 0.7,  step: 0.05,  label: 'Change Threshold' },
    snapshotInterval:{ value: 100,   min: 50,   max: 500,  step: 25,    label: 'Snapshot (ms)' },
    dotsPerCell:     { value: 3,     min: 1,    max: 10,   step: 1,     label: 'Dots Per Cell' },
    minDotSize:      { value: 2,     min: 1,    max: 10,   step: 0.5,   label: 'Min Dot Size' },
    maxDotSize:      { value: 20,    min: 5,    max: 60,   step: 1,     label: 'Max Dot Size' },
    dotOpacity:      { value: 0.8,   min: 0.2,  max: 1.0,  step: 0.05,  label: 'Dot Opacity' },
    fadeSpeed:       { value: 0.004, min: 0.0,  max: 0.02, step: 0.001, label: 'Fade Speed' },
    dotLifespan:     { value: 6,     min: 1,    max: 20,   step: 0.5,   label: 'Dot Lifespan (s)' },
    noiseAmount:     { value: 0.4,   min: 0.0,  max: 1.0,  step: 0.05,  label: 'Rate Variation' },
    gridCols:        { value: 60,    min: 20,   max: 120,  step: 5,     label: 'Grid Columns' },
    gridRows:        { value: 45,    min: 15,   max: 90,   step: 5,     label: 'Grid Rows' },
  },
  presets: [
    {
      name: 'Fine Detail',
      values: { dotsPerCell: 5, minDotSize: 1, maxDotSize: 8, dotOpacity: 0.9, fadeSpeed: 0.002, gridCols: 100, gridRows: 75 },
    },
    {
      name: 'Bold Strokes',
      values: { dotsPerCell: 2, minDotSize: 8, maxDotSize: 50, dotOpacity: 0.6, fadeSpeed: 0.006, changeThreshold: 0.2, gridCols: 30, gridRows: 22 },
    },
    {
      name: 'Ghost Trail',
      values: { changeThreshold: 0.15, dotsPerCell: 4, minDotSize: 3, maxDotSize: 15, dotOpacity: 0.4, fadeSpeed: 0.001, dotLifespan: 15 },
    },
  ],

  init(ctx, canvas) {
    const accCanvas = new OffscreenCanvas(canvas.width, canvas.height);
    const accCtx = accCanvas.getContext('2d');
    accCtx.fillStyle = '#fff';
    accCtx.fillRect(0, 0, canvas.width, canvas.height);

    return {
      accCanvas,
      accCtx,
      // Previous frame color grid: flat array of [r, g, b] per cell
      prevGrid: null,
      // Change intensity per cell (0-1), updated every snapshot
      changeGrid: null,
      // Timer for snapshot interval
      snapshotTimer: 0,
      // Active dots sorted by size for rendering
      dots: [],
      // Track grid dimensions for rebuild
      prevGridCols: 0,
      prevGridRows: 0,
    };
  },

  update(state, input, dt) {
    const P = state.params;
    const { width, height } = input.canvas;
    const elapsed = input.time.elapsed;
    const cols = Math.round(P.gridCols);
    const rows = Math.round(P.gridRows);

    // Rebuild grids if dimensions changed
    if (cols !== state.prevGridCols || rows !== state.prevGridRows) {
      state.prevGrid = null;
      state.changeGrid = new Float32Array(cols * rows);
      state.prevGridCols = cols;
      state.prevGridRows = rows;
    }

    // Snapshot timer
    state.snapshotTimer += dt * 1000;
    if (state.snapshotTimer >= P.snapshotInterval) {
      state.snapshotTimer = 0;
      _computeChangeGrid(state, input, cols, rows);
    }

    // Spawn dots in changed cells
    if (state.changeGrid) {
      const pixels = input.getPixelData();
      const webcamDims = input.getWebcamDimensions();
      const cellW = width / cols;
      const cellH = height / rows;

      // Noise-modulated spawn rate
      const noiseVal = noise2D(elapsed * 0.3, 0) * 0.5 + 0.5; // 0-1
      const spawnMult = 1 - P.noiseAmount + noiseVal * P.noiseAmount * 2;
      const dotsPerCell = Math.round(P.dotsPerCell * clamp(spawnMult, 0.1, 2));

      for (let gy = 0; gy < rows; gy++) {
        for (let gx = 0; gx < cols; gx++) {
          const change = state.changeGrid[gy * cols + gx];
          if (change < P.changeThreshold) continue;

          // More change = more dots (proportional above threshold)
          const intensity = (change - P.changeThreshold) / (1 - P.changeThreshold);
          const count = Math.ceil(dotsPerCell * intensity * dt * 60);

          for (let d = 0; d < count; d++) {
            // Random position within cell
            const cx = gx * cellW + randomRange(0, cellW);
            const cy = gy * cellH + randomRange(0, cellH);

            // Sample webcam color at this position
            const wx = Math.floor((cx / width) * webcamDims.width);
            const wy = Math.floor((cy / height) * webcamDims.height);
            const clampedX = clamp(wx, 0, webcamDims.width - 1);
            const clampedY = clamp(wy, 0, webcamDims.height - 1);
            const [r, g, b] = getPixelColor(pixels, clampedX, clampedY);

            // Size: higher change = wider range, biased by intensity
            const size = randomRange(P.minDotSize, P.maxDotSize);

            state.dots.push({
              x: cx, y: cy,
              r, g, b,
              size,
              opacity: randomRange(P.dotOpacity * 0.6, P.dotOpacity),
              age: 0,
              maxAge: randomRange(P.dotLifespan * 0.5, P.dotLifespan),
            });
          }
        }
      }
    }

    // Age dots and remove expired
    for (let i = state.dots.length - 1; i >= 0; i--) {
      state.dots[i].age += dt;
      if (state.dots[i].age >= state.dots[i].maxAge) {
        state.dots.splice(i, 1);
      }
    }

    // Cap dot count for performance
    const maxDots = 15000;
    if (state.dots.length > maxDots) {
      // Remove oldest (at the front since newest are appended)
      state.dots.splice(0, state.dots.length - maxDots);
    }
  },

  render(state, input, ctx, canvas) {
    const accCtx = state.accCtx;

    // Resize accumulation canvas if needed
    if (state.accCanvas.width !== canvas.width || state.accCanvas.height !== canvas.height) {
      const temp = accCtx.getImageData(0, 0, state.accCanvas.width, state.accCanvas.height);
      state.accCanvas.width = canvas.width;
      state.accCanvas.height = canvas.height;
      accCtx.fillStyle = '#fff';
      accCtx.fillRect(0, 0, canvas.width, canvas.height);
      accCtx.putImageData(temp, 0, 0);
    }

    // Fade accumulation layer toward white
    if (state.params.fadeSpeed > 0) {
      accCtx.fillStyle = `rgba(255, 255, 255, ${state.params.fadeSpeed})`;
      accCtx.fillRect(0, 0, canvas.width, canvas.height);
    }

    // Sort dots by size descending — largest drawn first, smallest on top
    state.dots.sort((a, b) => b.size - a.size);

    // Draw dots to accumulation canvas
    for (const dot of state.dots) {
      const lifeRatio = dot.age / dot.maxAge;
      const fadeOut = lifeRatio > 0.7 ? 1 - (lifeRatio - 0.7) / 0.3 : 1;
      const alpha = dot.opacity * fadeOut;
      if (alpha <= 0.01) continue;

      // Soft spray dot: radial gradient
      const grad = accCtx.createRadialGradient(
        dot.x, dot.y, 0,
        dot.x, dot.y, dot.size
      );
      grad.addColorStop(0, rgbString(dot.r, dot.g, dot.b, alpha));
      grad.addColorStop(0.5, rgbString(dot.r, dot.g, dot.b, alpha * 0.6));
      grad.addColorStop(1, rgbString(dot.r, dot.g, dot.b, 0));

      accCtx.fillStyle = grad;
      accCtx.beginPath();
      accCtx.arc(dot.x, dot.y, dot.size, 0, Math.PI * 2);
      accCtx.fill();
    }

    // Composite to main canvas
    ctx.drawImage(state.accCanvas, 0, 0);
  },

  resize(state, width, height) {
    // Accumulation canvas resized in render
  },

  cleanup(state) {
    state.dots.length = 0;
    state.prevGrid = null;
    state.changeGrid = null;
  },
};

/**
 * Sample current webcam into a color grid, compare to previous frame,
 * and store the per-cell change intensity (0-1).
 */
function _computeChangeGrid(state, input, cols, rows) {
  const pixels = input.getPixelData();
  const { width: pw, height: ph } = input.getWebcamDimensions();

  const cellW = pw / cols;
  const cellH = ph / rows;
  const currentGrid = new Uint8Array(cols * rows * 3);

  // Sample center pixel of each cell from webcam
  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      const wx = Math.floor(gx * cellW + cellW / 2);
      const wy = Math.floor(gy * cellH + cellH / 2);
      const cx = clamp(wx, 0, pw - 1);
      const cy = clamp(wy, 0, ph - 1);
      const [r, g, b] = getPixelColor(pixels, cx, cy);

      const idx = (gy * cols + gx) * 3;
      currentGrid[idx] = r;
      currentGrid[idx + 1] = g;
      currentGrid[idx + 2] = b;
    }
  }

  // Compare to previous frame
  if (state.prevGrid && state.prevGrid.length === currentGrid.length) {
    for (let i = 0; i < cols * rows; i++) {
      const ci = i * 3;
      const change = colorDistance(
        currentGrid[ci], currentGrid[ci + 1], currentGrid[ci + 2],
        state.prevGrid[ci], state.prevGrid[ci + 1], state.prevGrid[ci + 2]
      );
      state.changeGrid[i] = change;
    }
  } else {
    // First frame — no change
    state.changeGrid.fill(0);
  }

  state.prevGrid = currentGrid;
}
