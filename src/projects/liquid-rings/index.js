import { noise3D } from '../../utils/noise.js';
import { hslToRgb, rgbString } from '../../utils/color.js';
import { sampleGrid } from '../../utils/pixels.js';
import { map, clamp } from '../../utils/math.js';

const GRID_COLS = 80;
const GRID_ROWS = 60;

export default {
  id: 'liquid-rings',
  name: 'Liquid Rings',
  description: 'Concentric rings ripple and distort like ink in water. Darker areas of your image create more distortion.',
  mediapipe: [],
  params: {
    ringCount:       { value: 40,    min: 5,     max: 100,   step: 1,     label: 'Ring Count' },
    gap:             { value: 12,    min: 4,     max: 40,    step: 1,     label: 'Ring Gap' },
    resolution:      { value: 200,   min: 40,    max: 400,   step: 10,    label: 'Resolution' },
    noiseDetail:     { value: 0.004, min: 0.001, max: 0.02,  step: 0.001, label: 'Noise Detail' },
    noiseFactor:     { value: 80,    min: 10,    max: 300,   step: 5,     label: 'Noise Factor' },
    speed:           { value: 0.3,   min: 0.05,  max: 2.0,   step: 0.05,  label: 'Speed' },
    lineWidth:       { value: 1.5,   min: 0.5,   max: 5,     step: 0.5,   label: 'Line Width' },
    baseHue:         { value: 200,   min: 0,     max: 360,   step: 5,     label: 'Base Hue' },
    colorSpread:     { value: 60,    min: 10,    max: 180,   step: 5,     label: 'Color Spread' },
    opacity:         { value: 0.7,   min: 0.1,   max: 1.0,   step: 0.05,  label: 'Opacity' },
    outerChaos:      { value: 2.0,   min: 1.0,   max: 5.0,   step: 0.1,   label: 'Outer Chaos' },
    webcamInfluence: { value: 0.8,   min: 0.0,   max: 1.0,   step: 0.05,  label: 'Webcam Influence' },
    baseDistortion:  { value: 0.2,   min: 0.0,   max: 1.0,   step: 0.05,  label: 'Base Distortion' },
  },

  init(ctx, canvas) {
    return {};
  },

  update(state, input, dt) {
    // Pure rendering — no state to update
  },

  render(state, input, ctx, canvas) {
    const P = state.params;
    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const time = input.time.elapsed * P.speed;

    // Get webcam brightness grid
    const grid = input.getBrightnessGrid(GRID_COLS, GRID_ROWS);

    // Background: very dark shade of the base hue
    const [bgR, bgG, bgB] = hslToRgb(P.baseHue, 0.3, 0.04);
    ctx.fillStyle = rgbString(bgR, bgG, bgB);
    ctx.fillRect(0, 0, w, h);

    // Build a palette: base + triadic offsets
    const palette = [
      P.baseHue,
      (P.baseHue + P.colorSpread) % 360,
      (P.baseHue + P.colorSpread * 2) % 360,
      (P.baseHue + 180) % 360,
    ];

    ctx.lineWidth = P.lineWidth;

    const steps = Math.round(P.resolution);

    // Draw concentric rings from inside out
    for (let ring = 0; ring < P.ringCount; ring++) {
      const radius = (ring + 1) * P.gap;
      const ringRatio = ring / P.ringCount;

      // Outer rings get more distortion
      const chaosMult = 1 + ringRatio * (P.outerChaos - 1);
      const ringNoiseFactor = P.noiseFactor * chaosMult;

      // Pick color from palette based on ring index
      const paletteIdx = ring % palette.length;
      const hue = palette[paletteIdx];
      const lightness = map(ringRatio, 0, 1, 0.65, 0.35);
      const [r, g, b] = hslToRgb(hue, 0.7, lightness);

      ctx.strokeStyle = rgbString(r, g, b, P.opacity);
      ctx.beginPath();

      for (let i = 0; i <= steps; i++) {
        const angle = (i / steps) * Math.PI * 2;

        // Base circle position
        const bx = cx + Math.cos(angle) * radius;
        const by = cy + Math.sin(angle) * radius;

        // Sample webcam darkness at this point
        const brightness = sampleGrid(grid, bx, by, w, h);
        const darkness = 1 - brightness;

        // Blend webcam darkness with base distortion
        // At webcamInfluence=1: fully driven by darkness
        // At webcamInfluence=0: uniform distortion at baseDistortion level
        const distortionAmount = P.baseDistortion + darkness * P.webcamInfluence;
        const clampedDistortion = clamp(distortionAmount, 0, 1);

        // Perlin noise offset
        const noiseVal = noise3D(
          bx * P.noiseDetail,
          by * P.noiseDetail,
          time + ring * 0.1
        );

        // Scale offset by distortion amount
        const offset = noiseVal * ringNoiseFactor * clampedDistortion;
        const px = bx + Math.cos(angle) * offset;
        const py = by + Math.sin(angle) * offset;

        if (i === 0) {
          ctx.moveTo(px, py);
        } else {
          ctx.lineTo(px, py);
        }
      }

      ctx.closePath();
      ctx.stroke();
    }
  },

  resize(state, width, height) {
    // Nothing to resize
  },

  cleanup(state) {
    // Nothing to clean up
  },
};
