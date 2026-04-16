import { clamp } from '../../utils/math.js';
import { noise2D } from '../../utils/noise.js';

// Face regions: tight, non-overlapping polygons around each feature.
// Eyes, brows, and mouth use known MediaPipe contour indices.
// Nose, cheeks, forehead, and chin use seed landmarks → convex hull at runtime.
const REGIONS = [
  { name: 'leftEye', indices: [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246], hull: false },
  { name: 'rightEye', indices: [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466], hull: false },
  { name: 'leftEyebrow', indices: [70, 63, 105, 66, 107, 55, 65, 52, 53, 46], hull: false },
  { name: 'rightEyebrow', indices: [300, 293, 334, 296, 336, 285, 295, 282, 283, 276], hull: false },
  { name: 'mouth', indices: [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146], hull: false },
  // Seed-based regions: convex hull computed at runtime for clean shapes
  { name: 'nose', indices: [168, 6, 195, 5, 4, 1, 2, 98, 327, 49, 279], hull: true },
  { name: 'leftCheek', indices: [93, 132, 123, 147, 187, 207, 206, 205, 50, 101, 36, 142], hull: true },
  { name: 'rightCheek', indices: [323, 361, 352, 376, 411, 427, 426, 425, 280, 330, 266, 371], hull: true },
  { name: 'forehead', indices: [10, 109, 67, 103, 54, 21, 162, 127, 338, 297, 332, 284, 251, 389, 356], hull: true },
  { name: 'chin', indices: [152, 175, 199, 200, 18, 171, 396, 428, 262], hull: true },
];

// Simple convex hull (Andrew's monotone chain)
function convexHull(points) {
  if (points.length < 3) return points.slice();
  const sorted = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  // Lower hull
  const lower = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  // Upper hull
  const upper = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

// Expand polygon outward from its centroid
function expandPolygon(points, cx, cy, amount) {
  return points.map(p => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    return {
      x: p.x + (dx / len) * amount,
      y: p.y + (dy / len) * amount,
    };
  });
}

export default {
  id: 'dream-face',
  name: 'Dream Face',
  description: 'Your face fragments into drifting pieces that breathe and wander — an ethereal, surreal self-portrait.',
  mediapipe: ['face'],
  params: {
    driftAmount:    { value: 40,   min: 0,    max: 120,  step: 2,    label: 'Drift Amount' },
    driftSpeed:     { value: 0.25, min: 0.05, max: 1.0,  step: 0.05, label: 'Drift Speed' },
    breatheAmount:  { value: 0.12, min: 0.0,  max: 0.5,  step: 0.01, label: 'Breathe Amount' },
    breatheSpeed:   { value: 0.4,  min: 0.1,  max: 2.0,  step: 0.1,  label: 'Breathe Speed' },
    feather:        { value: 14,   min: 0,    max: 30,   step: 1,    label: 'Edge Feather' },
    expand:         { value: 15,   min: 0,    max: 40,   step: 1,    label: 'Piece Expansion' },
    bgOpacity:      { value: 0.15, min: 0.0,  max: 1.0,  step: 0.05, label: 'Ghost BG Opacity' },
    rotateAmount:   { value: 4,    min: 0,    max: 20,   step: 0.5,  label: 'Rotation (deg)' },
    delayVariation: { value: 3.0,  min: 0.0,  max: 8.0,  step: 0.1,  label: 'Time Offset' },
    regionOpacity:  { value: 0.95, min: 0.3,  max: 1.0,  step: 0.05, label: 'Piece Opacity' },
  },
  presets: [
    {
      name: 'Subtle Unease',
      values: { driftAmount: 15, driftSpeed: 0.12, breatheAmount: 0.05, feather: 18, bgOpacity: 0.4, rotateAmount: 2, delayVariation: 1.5, expand: 20 },
    },
    {
      name: 'Full Surreal',
      values: { driftAmount: 60, driftSpeed: 0.35, breatheAmount: 0.25, breatheSpeed: 0.5, feather: 16, bgOpacity: 0.1, rotateAmount: 10, delayVariation: 4.0, expand: 12 },
    },
    {
      name: 'Dissolving',
      values: { driftAmount: 100, driftSpeed: 0.15, breatheAmount: 0.35, breatheSpeed: 0.2, feather: 25, bgOpacity: 0.05, rotateAmount: 6, delayVariation: 6.0, regionOpacity: 0.7, expand: 10 },
    },
  ],

  init(ctx, canvas) {
    const tempCanvas = new OffscreenCanvas(canvas.width, canvas.height);
    const tempCtx = tempCanvas.getContext('2d');

    // Unique noise seeds per region
    const regionSeeds = REGIONS.map((_, i) => ({
      seedX: i * 137.5 + 7,
      seedY: i * 137.5 + 307,
      seedScale: i * 137.5 + 607,
      seedRotate: i * 137.5 + 907,
    }));

    return { tempCanvas, tempCtx, regionSeeds };
  },

  update(state, input, dt) {
    // Pure rendering
  },

  render(state, input, ctx, canvas) {
    const P = state.params;
    const w = canvas.width;
    const h = canvas.height;
    const elapsed = input.time.elapsed;

    // Dark background
    ctx.fillStyle = '#0a0a0e';
    ctx.fillRect(0, 0, w, h);

    const video = input.getVideoElement();
    if (!video || video.videoWidth === 0) return;

    // Dim ghost background
    if (P.bgOpacity > 0) {
      ctx.save();
      ctx.globalAlpha = P.bgOpacity;
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0, w, h);
      ctx.restore();
    }

    if (!input.face || !input.face.landmarks || input.face.landmarks.length === 0) return;
    const landmarks = input.face.landmarks[0];

    // Resize temp canvas if needed
    if (state.tempCanvas.width !== w || state.tempCanvas.height !== h) {
      state.tempCanvas.width = w;
      state.tempCanvas.height = h;
    }
    const tempCtx = state.tempCtx;

    for (let ri = 0; ri < REGIONS.length; ri++) {
      const region = REGIONS[ri];
      const seed = state.regionSeeds[ri];
      const timeOffset = ri * P.delayVariation;
      const t = elapsed * P.driftSpeed + timeOffset;

      // Compute landmark points (mirrored)
      let rawPoints = [];
      for (const idx of region.indices) {
        if (idx >= landmarks.length) continue;
        rawPoints.push({
          x: (1 - landmarks[idx].x) * w,
          y: landmarks[idx].y * h,
        });
      }
      if (rawPoints.length < 3) continue;

      // Convex hull for seed-based regions
      let points = region.hull ? convexHull(rawPoints) : rawPoints;
      if (points.length < 3) continue;

      // Compute centroid
      let cx = 0, cy = 0;
      for (const p of points) { cx += p.x; cy += p.y; }
      cx /= points.length;
      cy /= points.length;

      // Expand polygon outward for chunkier pieces
      if (P.expand > 0) {
        points = expandPolygon(points, cx, cy, P.expand);
      }

      // Noise-driven transforms
      const driftX = noise2D(seed.seedX + t * 0.7, t * 0.3) * P.driftAmount;
      const driftY = noise2D(seed.seedY + t * 0.3, t * 0.7) * P.driftAmount;
      const scaleNoise = noise2D(seed.seedScale, elapsed * P.breatheSpeed + timeOffset);
      const scale = 1 + scaleNoise * P.breatheAmount;
      const rotateNoise = noise2D(seed.seedRotate, elapsed * P.driftSpeed * 0.5 + timeOffset);
      const rotation = rotateNoise * P.rotateAmount * (Math.PI / 180);

      // --- Draw feathered region to temp canvas ---
      tempCtx.clearRect(0, 0, w, h);

      // Step 1: Draw soft mask (white polygon + shadow for feather)
      tempCtx.save();
      if (P.feather > 0) {
        tempCtx.shadowColor = 'white';
        tempCtx.shadowBlur = P.feather;
        tempCtx.shadowOffsetX = 0;
        tempCtx.shadowOffsetY = 0;
      }
      tempCtx.fillStyle = 'white';
      tempCtx.beginPath();
      for (let i = 0; i < points.length; i++) {
        if (i === 0) tempCtx.moveTo(points[i].x, points[i].y);
        else tempCtx.lineTo(points[i].x, points[i].y);
      }
      tempCtx.closePath();
      tempCtx.fill();
      tempCtx.restore();

      // Step 2: source-in composite with mirrored webcam
      tempCtx.save();
      tempCtx.globalCompositeOperation = 'source-in';
      tempCtx.translate(w, 0);
      tempCtx.scale(-1, 1);
      tempCtx.drawImage(video, 0, 0, w, h);
      tempCtx.restore();

      // Step 3: Draw onto main canvas with drift/scale/rotation
      ctx.save();
      ctx.globalAlpha = P.regionOpacity;
      ctx.translate(cx + driftX, cy + driftY);
      ctx.rotate(rotation);
      ctx.scale(scale, scale);
      ctx.translate(-cx, -cy);
      ctx.drawImage(state.tempCanvas, 0, 0);
      ctx.restore();
    }
  },

  resize(state, width, height) {},

  cleanup(state) {},
};
