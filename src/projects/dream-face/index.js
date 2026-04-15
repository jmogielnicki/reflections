import { clamp } from '../../utils/math.js';
import { noise2D } from '../../utils/noise.js';

// Face regions defined by MediaPipe landmark indices (closed polygons)
const REGIONS = [
  {
    name: 'leftEye',
    indices: [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246],
  },
  {
    name: 'rightEye',
    indices: [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466],
  },
  {
    name: 'leftEyebrow',
    indices: [70, 63, 105, 66, 107, 55, 65, 52, 53, 46],
  },
  {
    name: 'rightEyebrow',
    indices: [300, 293, 334, 296, 336, 285, 295, 282, 283, 276],
  },
  {
    name: 'nose',
    indices: [168, 6, 197, 195, 5, 4, 1, 19, 94, 2, 164, 0, 11, 12,
              248, 281, 275, 440, 344, 278, 438, 457, 274, 1,
              44, 45, 220, 115, 48, 64, 98, 97, 2],
  },
  {
    name: 'upperLip',
    indices: [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291,
              375, 321, 405, 314, 17, 84, 181, 91, 146],
  },
  {
    name: 'lowerLip',
    indices: [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291,
              308, 324, 318, 402, 317, 14, 87, 178, 88, 95, 78],
  },
  {
    name: 'leftCheek',
    indices: [93, 132, 58, 172, 136, 150, 176, 148, 152, 377, 400,
              378, 379, 365, 397, 288, 361, 323],
  },
  {
    name: 'rightCheek',
    indices: [323, 361, 288, 397, 365, 379, 378, 400, 377, 152,
              148, 176, 150, 136, 172, 58, 132, 93],
  },
  {
    name: 'forehead',
    indices: [10, 338, 297, 332, 284, 251, 389, 356, 454,
              323, 361, 288, 397, 365, 379, 378, 400, 377,
              152, 148, 176, 150, 136, 172, 58, 132, 93,
              234, 127, 162, 21, 54, 103, 67, 109],
  },
  {
    name: 'chin',
    indices: [152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234,
              127, 162, 21, 54, 103, 67, 109, 10, 338, 297, 332,
              284, 251, 389, 356, 454, 323, 361, 288, 397, 365,
              379, 378, 400, 377],
  },
];

export default {
  id: 'dream-face',
  name: 'Dream Face',
  description: 'Your face fragments into drifting pieces that breathe and wander — an ethereal, surreal self-portrait.',
  mediapipe: ['face'],
  params: {
    driftAmount:    { value: 25,   min: 0,    max: 80,   step: 1,    label: 'Drift Amount' },
    driftSpeed:     { value: 0.3,  min: 0.05, max: 1.0,  step: 0.05, label: 'Drift Speed' },
    breatheAmount:  { value: 0.15, min: 0.0,  max: 0.5,  step: 0.01, label: 'Breathe Amount' },
    breatheSpeed:   { value: 0.5,  min: 0.1,  max: 2.0,  step: 0.1,  label: 'Breathe Speed' },
    feather:        { value: 12,   min: 0,    max: 30,   step: 1,    label: 'Edge Feather' },
    bgOpacity:      { value: 0.3,  min: 0.0,  max: 1.0,  step: 0.05, label: 'Ghost BG Opacity' },
    rotateAmount:   { value: 3,    min: 0,    max: 15,   step: 0.5,  label: 'Rotation (deg)' },
    delayVariation: { value: 2.0,  min: 0.0,  max: 5.0,  step: 0.1,  label: 'Time Offset' },
    regionOpacity:  { value: 0.95, min: 0.3,  max: 1.0,  step: 0.05, label: 'Region Opacity' },
  },
  presets: [
    {
      name: 'Subtle Unease',
      values: { driftAmount: 10, driftSpeed: 0.15, breatheAmount: 0.06, breatheSpeed: 0.3, feather: 15, bgOpacity: 0.5, rotateAmount: 1.5, delayVariation: 1.0 },
    },
    {
      name: 'Full Surreal',
      values: { driftAmount: 50, driftSpeed: 0.4, breatheAmount: 0.3, breatheSpeed: 0.6, feather: 18, bgOpacity: 0.15, rotateAmount: 8, delayVariation: 3.0 },
    },
    {
      name: 'Dissolving',
      values: { driftAmount: 70, driftSpeed: 0.2, breatheAmount: 0.4, breatheSpeed: 0.25, feather: 25, bgOpacity: 0.1, rotateAmount: 5, delayVariation: 4.0, regionOpacity: 0.7 },
    },
  ],

  init(ctx, canvas) {
    // One shared OffscreenCanvas for region extraction
    const tempCanvas = new OffscreenCanvas(canvas.width, canvas.height);
    const tempCtx = tempCanvas.getContext('2d');

    // Per-region time offsets for unique noise patterns
    const regionSeeds = REGIONS.map((_, i) => ({
      seedX: i * 100 + 7,
      seedY: i * 100 + 307,
      seedScale: i * 100 + 607,
      seedRotate: i * 100 + 907,
    }));

    return {
      tempCanvas,
      tempCtx,
      regionSeeds,
    };
  },

  update(state, input, dt) {
    // Pure rendering — nothing to update
  },

  render(state, input, ctx, canvas) {
    const P = state.params;
    const w = canvas.width;
    const h = canvas.height;
    const elapsed = input.time.elapsed;

    // Dark background
    ctx.fillStyle = '#0a0a0e';
    ctx.fillRect(0, 0, w, h);

    // Get video element for drawing
    const video = input.getVideoElement();
    if (!video || video.videoWidth === 0) return;

    // Draw ghost background (dimmed, mirrored webcam)
    if (P.bgOpacity > 0) {
      ctx.save();
      ctx.globalAlpha = P.bgOpacity;
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0, w, h);
      ctx.restore();
    }

    // Need face landmarks
    if (!input.face || !input.face.landmarks || input.face.landmarks.length === 0) return;
    const landmarks = input.face.landmarks[0];

    // Resize temp canvas if needed
    if (state.tempCanvas.width !== w || state.tempCanvas.height !== h) {
      state.tempCanvas.width = w;
      state.tempCanvas.height = h;
    }

    const tempCtx = state.tempCtx;

    // Draw each face region as a drifting, breathing fragment
    for (let ri = 0; ri < REGIONS.length; ri++) {
      const region = REGIONS[ri];
      const seed = state.regionSeeds[ri];
      const timeOffset = ri * P.delayVariation;
      const t = elapsed * P.driftSpeed + timeOffset;

      // Compute the polygon points (mirrored)
      const points = [];
      let cx = 0, cy = 0;
      for (const idx of region.indices) {
        if (idx >= landmarks.length) continue;
        const px = (1 - landmarks[idx].x) * w;
        const py = landmarks[idx].y * h;
        points.push({ x: px, y: py });
        cx += px;
        cy += py;
      }
      if (points.length < 3) continue;
      cx /= points.length;
      cy /= points.length;

      // Noise-driven transforms
      const driftX = noise2D(seed.seedX + t * 0.7, t * 0.3) * P.driftAmount;
      const driftY = noise2D(seed.seedY + t * 0.3, t * 0.7) * P.driftAmount;
      const scaleNoise = noise2D(seed.seedScale, elapsed * P.breatheSpeed + timeOffset);
      const scale = 1 + scaleNoise * P.breatheAmount;
      const rotateNoise = noise2D(seed.seedRotate, elapsed * P.driftSpeed * 0.5 + timeOffset);
      const rotation = rotateNoise * P.rotateAmount * (Math.PI / 180);

      // Clear temp canvas
      tempCtx.clearRect(0, 0, w, h);

      // Step 1: Draw the soft mask shape (white fill + shadow for feather)
      tempCtx.save();
      if (P.feather > 0) {
        tempCtx.shadowColor = 'white';
        tempCtx.shadowBlur = P.feather;
        // Offset shadow to counter the shadow displacement
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

      // Step 2: Composite — only keep webcam pixels where mask exists
      tempCtx.save();
      tempCtx.globalCompositeOperation = 'source-in';
      tempCtx.translate(w, 0);
      tempCtx.scale(-1, 1);
      tempCtx.drawImage(video, 0, 0, w, h);
      tempCtx.restore();

      // Step 3: Draw the feathered region onto main canvas with transform
      ctx.save();
      ctx.globalAlpha = P.regionOpacity;

      // Translate to region center, apply drift + rotation + scale, translate back
      ctx.translate(cx + driftX, cy + driftY);
      ctx.rotate(rotation);
      ctx.scale(scale, scale);
      ctx.translate(-cx, -cy);

      ctx.drawImage(state.tempCanvas, 0, 0);
      ctx.restore();
    }
  },

  resize(state, width, height) {
    // Temp canvas resized in render
  },

  cleanup(state) {
    // Nothing to clean up
  },
};
