import { clamp } from '../../utils/math.js';

const GRID_COLS = 200;
const GRID_ROWS = 150;

export default {
  id: 'contour-lines',
  name: 'Contour Lines',
  description: 'Parallel lines bend around your form, creating a topographic 3D illusion from flat strokes.',
  mediapipe: [],
  params: {
    numLines:     { value: 80,  min: 20,  max: 160, step: 1,    label: 'Number of Lines' },
    displacement: { value: 50,  min: 5,   max: 150, step: 1,    label: 'Displacement' },
    lineWidth:    { value: 1.8, min: 0.5, max: 5,   step: 0.25, label: 'Line Width' },
    smoothing:    { value: 5,   min: 1,   max: 15,  step: 1,    label: 'Smoothing' },
    contrast:     { value: 1.5, min: 0.5, max: 3.0, step: 0.1,  label: 'Contrast' },
    invert:       { value: 0,   min: 0,   max: 1,   step: 1,    label: 'Invert (0/1)' },
    direction:    { value: 0,   min: 0,   max: 1,   step: 1,    label: 'Direction (0=H, 1=V)' },
  },
  presets: [
    {
      name: 'Classic Relief',
      values: { numLines: 80, displacement: 50, lineWidth: 1.8, smoothing: 5, contrast: 1.5, direction: 0 },
    },
    {
      name: 'Fine Topography',
      values: { numLines: 140, displacement: 30, lineWidth: 0.8, smoothing: 3, contrast: 2.0, direction: 0 },
    },
    {
      name: 'Bold Contour',
      values: { numLines: 40, displacement: 100, lineWidth: 3.5, smoothing: 8, contrast: 1.3, direction: 0 },
    },
    {
      name: 'Vertical Scan',
      values: { numLines: 80, displacement: 50, lineWidth: 1.5, smoothing: 5, contrast: 1.5, direction: 1 },
    },
  ],

  init(ctx, canvas) {
    return {};
  },

  update(state, input, dt) {},

  render(state, input, ctx, canvas) {
    const P = state.params;
    const w = canvas.width;
    const h = canvas.height;
    const numLines = Math.round(P.numLines);
    const isVertical = Math.round(P.direction) === 1;
    const smoothR = Math.round(P.smoothing);
    const inv = Math.round(P.invert) === 1;

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, w, h);

    const grid = input.getBrightnessGrid(GRID_COLS, GRID_ROWS);
    if (!grid) return;

    const crossLen = isVertical ? w : h;
    const travelLen = isVertical ? h : w;
    const travelN = isVertical ? GRID_ROWS : GRID_COLS;
    const crossN = isVertical ? GRID_COLS : GRID_ROWS;
    const spacing = crossLen / numLines;

    const raw = new Float32Array(travelN);
    const sm = new Float32Array(travelN);

    ctx.strokeStyle = '#000000';
    ctx.lineWidth = P.lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (let li = 0; li < numLines; li++) {
      const crossNorm = (li + 0.5) / numLines;
      const ci = clamp(Math.floor(crossNorm * crossN), 0, crossN - 1);

      for (let s = 0; s < travelN; s++) {
        const b = isVertical
          ? grid.cells[s * GRID_COLS + ci]
          : grid.cells[ci * GRID_COLS + s];
        const bc = clamp((b - 0.5) * P.contrast + 0.5, 0, 1);
        raw[s] = inv ? bc : (1 - bc);
      }

      for (let s = 0; s < travelN; s++) {
        let sum = 0, count = 0;
        const lo = Math.max(0, s - smoothR);
        const hi = Math.min(travelN - 1, s + smoothR);
        for (let k = lo; k <= hi; k++) { sum += raw[k]; count++; }
        sm[s] = sum / count;
      }

      const base = (li + 0.5) * spacing;

      ctx.beginPath();
      for (let s = 0; s < travelN; s++) {
        const t = (s / (travelN - 1)) * travelLen;
        const d = sm[s] * P.displacement;
        const x = isVertical ? base - d : t;
        const y = isVertical ? t : base - d;

        if (s === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  },

  resize(state, width, height) {},
  cleanup(state) {},
};
