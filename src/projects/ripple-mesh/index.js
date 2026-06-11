import { lerp, clamp, dist } from '../../utils/math.js';
import { hslToRgb, rgbString } from '../../utils/color.js';

// Sparse set of face landmarks for ripple sources
// Nose tip, chin, forehead, cheeks, eyes, mouth corners
const SOURCE_LANDMARKS = [
  1,    // nose tip
  152,  // chin
  10,   // forehead top
  234,  // left cheek outer
  454,  // right cheek outer
  33,   // left eye inner
  263,  // right eye inner
  61,   // mouth left
  291,  // mouth right
  168,  // nose bridge
  0,    // upper lip center
  17,   // lower lip center
];

export default {
  id: 'ripple-mesh',
  name: 'Ripple Mesh',
  description: 'A calm grid of water-like mesh. Your face touches the surface and sends ripples spreading outward.',
  mediapipe: ['face'],
  params: {
    cols:            { value: 60,    min: 20,   max: 100,   step: 2,     label: 'Grid Columns' },
    rows:            { value: 40,    min: 14,   max: 70,    step: 2,     label: 'Grid Rows' },
    waveSpeed:       { value: 0.35,  min: 0.1,  max: 0.8,   step: 0.05,  label: 'Wave Speed' },
    waveDamping:     { value: 0.985, min: 0.95, max: 0.999, step: 0.001, label: 'Wave Damping' },
    pushStrength:    { value: 12,    min: 2,    max: 40,    step: 1,     label: 'Push Strength' },
    pushRadius:      { value: 0.06,  min: 0.02, max: 0.15,  step: 0.01,  label: 'Push Radius' },
    displacementScale:{ value: 8,    min: 1,    max: 25,    step: 1,     label: 'Displacement' },
    edgeOpacity:     { value: 0.7,   min: 0.1,  max: 1.0,   step: 0.05,  label: 'Edge Opacity' },
    nodeSize:        { value: 1.5,   min: 0.5,  max: 4,     step: 0.5,   label: 'Node Size' },
    calmHue:         { value: 200,   min: 0,    max: 360,   step: 5,     label: 'Calm Hue' },
    peakHue:         { value: 180,   min: 0,    max: 360,   step: 5,     label: 'Peak Hue' },
    troughHue:       { value: 240,   min: 0,    max: 360,   step: 5,     label: 'Trough Hue' },
    showNodes:       { value: 1,     min: 0,    max: 1,     step: 1,     label: 'Show Nodes (0/1)' },
  },
  presets: [
    {
      name: 'Still Pond',
      values: { waveSpeed: 0.2, waveDamping: 0.992, pushStrength: 8, displacementScale: 5, edgeOpacity: 0.5, calmHue: 210, peakHue: 170, troughHue: 250 },
    },
    {
      name: 'Stormy Surface',
      values: { waveSpeed: 0.7, waveDamping: 0.975, pushStrength: 30, pushRadius: 0.1, displacementScale: 20, edgeOpacity: 0.9, calmHue: 220, peakHue: 60, troughHue: 280 },
    },
    {
      name: 'Mercury Pool',
      values: { cols: 80, rows: 55, waveSpeed: 0.5, waveDamping: 0.99, pushStrength: 15, displacementScale: 6, calmHue: 0, peakHue: 0, troughHue: 0, nodeSize: 1, edgeOpacity: 0.8 },
    },
  ],

  init(ctx, canvas) {
    return {
      // Wave buffers (flat arrays indexed by row * stride + col)
      height: null,
      prevHeight: null,
      // Grid topology
      nodeX: null,   // home X positions
      nodeY: null,   // home Y positions
      edges: [],
      stride: 0,
      totalNodes: 0,
      // Rebuild tracking
      needsRebuild: true,
      prevCols: 0,
      prevRows: 0,
    };
  },

  update(state, input, dt) {
    const P = state.params;
    const w = input.canvas.width;
    const h = input.canvas.height;

    const cols = Math.round(P.cols);
    const rows = Math.round(P.rows);

    // Rebuild grid if needed
    if (state.needsRebuild || cols !== state.prevCols || rows !== state.prevRows) {
      _buildGrid(state, cols, rows, w, h);
      state.prevCols = cols;
      state.prevRows = rows;
      state.needsRebuild = false;
    }

    const stride = state.stride;
    const cur = state.height;
    const prev = state.prevHeight;

    // --- Apply face landmark pushes ---
    if (input.face && input.face.landmarks && input.face.landmarks.length > 0) {
      const raw = input.face.landmarks[0];
      const pushRadPx = P.pushRadius * Math.max(w, h);
      const pushRadSq = pushRadPx * pushRadPx;

      for (const idx of SOURCE_LANDMARKS) {
        if (idx >= raw.length) continue;
        const fx = (1 - raw[idx].x) * w;  // mirrored
        const fy = raw[idx].y * h;

        // Find nodes within push radius and displace them
        // Optimization: only check nodes in the bounding box
        const marginX = w * 0.05;
        const marginY = h * 0.05;
        const innerW = w - marginX * 2;
        const innerH = h - marginY * 2;

        const colMin = Math.max(0, Math.floor(((fx - pushRadPx - marginX) / innerW) * cols) - 1);
        const colMax = Math.min(cols, Math.ceil(((fx + pushRadPx - marginX) / innerW) * cols) + 1);
        const rowMin = Math.max(0, Math.floor(((fy - pushRadPx - marginY) / innerH) * rows) - 1);
        const rowMax = Math.min(rows, Math.ceil(((fy + pushRadPx - marginY) / innerH) * rows) + 1);

        for (let r = rowMin; r <= rowMax; r++) {
          for (let c = colMin; c <= colMax; c++) {
            const ni = r * stride + c;
            const dx = state.nodeX[ni] - fx;
            const dy = state.nodeY[ni] - fy;
            const dSq = dx * dx + dy * dy;
            if (dSq < pushRadSq) {
              // Smooth falloff: strongest at center
              const falloff = 1 - Math.sqrt(dSq) / pushRadPx;
              cur[ni] -= P.pushStrength * falloff * falloff * dt * 60;
            }
          }
        }
      }
    }

    // --- Wave propagation (2D wave equation) ---
    // newH = 2*cur - prev + speed^2 * (neighbors_avg - cur)
    // Then apply damping
    const sp2 = P.waveSpeed * P.waveSpeed;
    const damp = P.waveDamping;
    const rowCount = rows + 1;
    const colCount = cols + 1;

    // We need a temporary buffer for the new heights
    const next = state._tmpBuffer || new Float32Array(state.totalNodes);
    if (next.length !== state.totalNodes) {
      state._tmpBuffer = new Float32Array(state.totalNodes);
    }
    const tmp = state._tmpBuffer || next;

    for (let r = 0; r < rowCount; r++) {
      for (let c = 0; c < colCount; c++) {
        const i = r * stride + c;

        // Sum neighbors
        let neighbors = 0;
        let count = 0;
        if (c > 0)           { neighbors += cur[i - 1];      count++; }
        if (c < colCount - 1){ neighbors += cur[i + 1];      count++; }
        if (r > 0)           { neighbors += cur[i - stride];  count++; }
        if (r < rowCount - 1){ neighbors += cur[i + stride];  count++; }

        const avg = neighbors / count;
        tmp[i] = (2 * cur[i] - prev[i] + sp2 * (avg - cur[i])) * damp;
      }
    }

    // Rotate buffers: prev = cur, cur = new
    state.prevHeight = cur;
    state.height = tmp;
    state._tmpBuffer = prev;
  },

  render(state, input, ctx, canvas) {
    const P = state.params;
    const w = canvas.width;
    const h = canvas.height;

    // Dark background
    ctx.fillStyle = 'rgb(6, 8, 16)';
    ctx.fillRect(0, 0, w, h);

    if (!state.height || !state.nodeX) return;

    const cur = state.height;
    const scale = P.displacementScale;
    const stride = state.stride;
    const cols = state.prevCols;
    const rows = state.prevRows;
    const colCount = cols + 1;
    const rowCount = rows + 1;

    // Compute displaced positions (reuse arrays to avoid allocation)
    const dispX = state._dispX || new Float32Array(state.totalNodes);
    const dispY = state._dispY || new Float32Array(state.totalNodes);
    if (dispX.length !== state.totalNodes) {
      state._dispX = new Float32Array(state.totalNodes);
      state._dispY = new Float32Array(state.totalNodes);
    }
    const dx = state._dispX || dispX;
    const dy = state._dispY || dispY;

    // Displace nodes based on height gradient (simulates surface normal)
    for (let r = 0; r < rowCount; r++) {
      for (let c = 0; c < colCount; c++) {
        const i = r * stride + c;
        const ht = cur[i];

        // Gradient-based displacement: move node based on slope
        let gradX = 0, gradY = 0;
        if (c > 0 && c < colCount - 1) {
          gradX = (cur[i + 1] - cur[i - 1]) * 0.5;
        } else if (c > 0) {
          gradX = cur[i] - cur[i - 1];
        } else {
          gradX = cur[i + 1] - cur[i];
        }

        if (r > 0 && r < rowCount - 1) {
          gradY = (cur[i + stride] - cur[i - stride]) * 0.5;
        } else if (r > 0) {
          gradY = cur[i] - cur[i - stride];
        } else {
          gradY = cur[i + stride] - cur[i];
        }

        dx[i] = state.nodeX[i] - gradX * scale;
        dy[i] = state.nodeY[i] - gradY * scale;
      }
    }

    // Draw horizontal edges
    for (let r = 0; r < rowCount; r++) {
      for (let c = 0; c < colCount - 1; c++) {
        const i = r * stride + c;
        const j = i + 1;
        _drawEdge(ctx, dx, dy, cur, i, j, P);
      }
    }

    // Draw vertical edges
    for (let r = 0; r < rowCount - 1; r++) {
      for (let c = 0; c < colCount; c++) {
        const i = r * stride + c;
        const j = i + stride;
        _drawEdge(ctx, dx, dy, cur, i, j, P);
      }
    }

    // Draw nodes
    if (Math.round(P.showNodes)) {
      for (let i = 0; i < state.totalNodes; i++) {
        const ht = cur[i];
        const absH = Math.abs(ht);
        const hue = ht > 0.1 ? P.peakHue : ht < -0.1 ? P.troughHue : P.calmHue;
        const light = clamp(0.4 + absH * 0.08, 0.3, 0.85);
        const alpha = clamp(0.3 + absH * 0.15, 0.2, 1.0);
        const [rv, gv, bv] = hslToRgb(hue, 0.6, light);

        ctx.fillStyle = rgbString(rv, gv, bv, alpha);
        ctx.beginPath();
        ctx.arc(dx[i], dy[i], P.nodeSize, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  },

  resize(state, width, height) {
    state.needsRebuild = true;
  },

  cleanup(state) {
    state.height = null;
    state.prevHeight = null;
    state.nodeX = null;
    state.nodeY = null;
    state.edges = [];
  },
};

function _drawEdge(ctx, dx, dy, heights, i, j, P) {
  const hi = heights[i];
  const hj = heights[j];
  const avgH = (Math.abs(hi) + Math.abs(hj)) * 0.5;

  // Color based on average wave height direction
  const avgVal = (hi + hj) * 0.5;
  const hue = avgVal > 0.1 ? P.peakHue : avgVal < -0.1 ? P.troughHue : P.calmHue;
  const sat = clamp(0.3 + avgH * 0.1, 0.2, 0.9);
  const light = clamp(0.3 + avgH * 0.06, 0.25, 0.7);
  const alpha = P.edgeOpacity * clamp(0.3 + avgH * 0.12, 0.15, 1.0);

  const [r, g, b] = hslToRgb(hue, sat, light);
  ctx.strokeStyle = rgbString(r, g, b, alpha);
  ctx.lineWidth = clamp(0.3 + avgH * 0.15, 0.3, 2.0);

  ctx.beginPath();
  ctx.moveTo(dx[i], dy[i]);
  ctx.lineTo(dx[j], dy[j]);
  ctx.stroke();
}

function _buildGrid(state, cols, rows, w, h) {
  const stride = cols + 1;
  const totalNodes = (cols + 1) * (rows + 1);

  state.stride = stride;
  state.totalNodes = totalNodes;
  state.height = new Float32Array(totalNodes);
  state.prevHeight = new Float32Array(totalNodes);
  state._tmpBuffer = new Float32Array(totalNodes);
  state.nodeX = new Float32Array(totalNodes);
  state.nodeY = new Float32Array(totalNodes);
  state._dispX = new Float32Array(totalNodes);
  state._dispY = new Float32Array(totalNodes);

  const marginX = w * 0.05;
  const marginY = h * 0.05;
  const innerW = w - marginX * 2;
  const innerH = h - marginY * 2;

  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      const i = r * stride + c;
      state.nodeX[i] = marginX + (c / cols) * innerW;
      state.nodeY[i] = marginY + (r / rows) * innerH;
    }
  }
}
