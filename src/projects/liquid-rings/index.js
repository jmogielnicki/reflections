import { noise3D } from '../../utils/noise.js';
import { hslToRgb, rgbString } from '../../utils/color.js';
import { map } from '../../utils/math.js';

export default {
  id: 'liquid-rings',
  name: 'Liquid Rings',
  description: 'Concentric rings ripple and distort like ink in water, driven by Perlin noise.',
  mediapipe: [],
  params: {
    ringCount:    { value: 40,    min: 5,     max: 100,   step: 1,     label: 'Ring Count' },
    gap:          { value: 12,    min: 4,     max: 40,    step: 1,     label: 'Ring Gap' },
    resolution:   { value: 200,   min: 40,    max: 400,   step: 10,    label: 'Resolution' },
    noiseDetail:  { value: 0.004, min: 0.001, max: 0.02,  step: 0.001, label: 'Noise Detail' },
    noiseFactor:  { value: 80,    min: 10,    max: 300,   step: 5,     label: 'Noise Factor' },
    speed:        { value: 0.3,   min: 0.05,  max: 2.0,   step: 0.05,  label: 'Speed' },
    lineWidth:    { value: 1.5,   min: 0.5,   max: 5,     step: 0.5,   label: 'Line Width' },
    baseHue:      { value: 200,   min: 0,     max: 360,   step: 5,     label: 'Base Hue' },
    colorSpread:  { value: 60,    min: 10,    max: 180,   step: 5,     label: 'Color Spread' },
    opacity:      { value: 0.7,   min: 0.1,   max: 1.0,   step: 0.05,  label: 'Opacity' },
    outerChaos:   { value: 2.0,   min: 1.0,   max: 5.0,   step: 0.1,   label: 'Outer Chaos' },
  },

  init(ctx, canvas) {
    return {};
  },

  update(state, input, dt) {
    // Pure rendering project — no state to update
  },

  render(state, input, ctx, canvas) {
    const P = state.params;
    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const time = input.time.elapsed * P.speed;

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
      // Vary lightness by ring: inner rings lighter, outer darker
      const lightness = map(ringRatio, 0, 1, 0.65, 0.35);
      const [r, g, b] = hslToRgb(hue, 0.7, lightness);

      ctx.strokeStyle = rgbString(r, g, b, P.opacity);
      ctx.beginPath();

      const steps = Math.round(P.resolution);
      for (let i = 0; i <= steps; i++) {
        const angle = (i / steps) * Math.PI * 2;

        // Base circle position
        const bx = cx + Math.cos(angle) * radius;
        const by = cy + Math.sin(angle) * radius;

        // Perlin noise offset — feed position + time for animation
        const noiseVal = noise3D(
          bx * P.noiseDetail,
          by * P.noiseDetail,
          time + ring * 0.1
        );

        // Push the point outward/inward along the radial direction
        const offsetX = noiseVal * Math.cos(angle) * ringNoiseFactor;
        const offsetY = noiseVal * Math.sin(angle) * ringNoiseFactor;

        const px = bx + offsetX;
        const py = by + offsetY;

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
