import { getPixelColor } from '../../utils/pixels.js';
import { rgbString } from '../../utils/color.js';
import { randomRange, randomInt, lerp } from '../../utils/math.js';

const WEATHER_TYPES = [
  { type: 'sprinkle', dropsPerFrame: [1, 3], sizeRange: [2, 8], weight: 0.65 },
  { type: 'rain', dropsPerFrame: [5, 15], sizeRange: [4, 12], weight: 0.25 },
  { type: 'thunderstorm', dropsPerFrame: [30, 80], sizeRange: [8, 25], weight: 0.10 },
];

function pickWeather() {
  const r = Math.random();
  let cumulative = 0;
  for (const w of WEATHER_TYPES) {
    cumulative += w.weight;
    if (r < cumulative) return w;
  }
  return WEATHER_TYPES[0];
}

export default {
  id: 'watercolor-drops',
  name: 'Watercolor Drops',
  description: 'Drops of color fall like rain, building a pointillist portrait that fades and reforms.',
  mediapipe: [],
  params: {
    maxDropSize:     { value: 25,   min: 5,   max: 60,  step: 1,    label: 'Max Drop Size' },
    minDropSize:     { value: 2,    min: 1,   max: 20,  step: 1,    label: 'Min Drop Size' },
    dropMaxAge:      { value: 8,    min: 2,   max: 20,  step: 0.5,  label: 'Drop Max Age (s)' },
    dropMinAge:      { value: 3,    min: 1,   max: 10,  step: 0.5,  label: 'Drop Min Age (s)' },
    dropOpacity:     { value: 0.85, min: 0.2, max: 1.0, step: 0.05, label: 'Drop Opacity' },
    weatherChangeMin:{ value: 3,    min: 1,   max: 10,  step: 0.5,  label: 'Weather Min (s)' },
    weatherChangeMax:{ value: 10,   min: 5,   max: 30,  step: 1,    label: 'Weather Max (s)' },
    fadeSpeed:       { value: 0.003,min: 0.0, max: 0.02,step: 0.001,label: 'Background Fade' },
  },

  init(ctx, canvas) {
    const accCanvas = new OffscreenCanvas(canvas.width, canvas.height);
    const accCtx = accCanvas.getContext('2d');
    accCtx.fillStyle = '#fff';
    accCtx.fillRect(0, 0, canvas.width, canvas.height);

    return {
      accCanvas,
      accCtx,
      drops: [],
      weather: pickWeather(),
      weatherTimer: 0,
      nextWeatherChange: randomRange(3, 10),
    };
  },

  update(state, input, dt) {
    const P = state.params;
    const { width, height } = input.canvas;
    const webcamDims = input.getWebcamDimensions();

    // Update weather
    state.weatherTimer += dt;
    if (state.weatherTimer >= state.nextWeatherChange) {
      state.weather = pickWeather();
      state.weatherTimer = 0;
      state.nextWeatherChange = randomRange(P.weatherChangeMin, P.weatherChangeMax);
    }

    // Spawn new drops
    const pixels = input.getPixelData();
    const dropCount = randomInt(state.weather.dropsPerFrame[0], state.weather.dropsPerFrame[1]);

    for (let i = 0; i < dropCount; i++) {
      const cx = randomRange(0, width);
      const cy = randomRange(0, height);

      // Sample webcam color at this position (map canvas coords to webcam coords)
      const wx = Math.floor((cx / width) * webcamDims.width);
      const wy = Math.floor((cy / height) * webcamDims.height);
      const clampedX = Math.max(0, Math.min(webcamDims.width - 1, wx));
      const clampedY = Math.max(0, Math.min(webcamDims.height - 1, wy));
      const [r, g, b] = getPixelColor(pixels, clampedX, clampedY);

      state.drops.push({
        x: cx,
        y: cy,
        radius: randomRange(P.minDropSize, P.maxDropSize),
        r, g, b,
        startOpacity: randomRange(P.dropOpacity * 0.6, P.dropOpacity),
        age: 0,
        maxAge: randomRange(P.dropMinAge, P.dropMaxAge),
        drawn: false,
      });
    }

    // Age drops
    for (let i = state.drops.length - 1; i >= 0; i--) {
      state.drops[i].age += dt;
      if (state.drops[i].age >= state.drops[i].maxAge) {
        state.drops.splice(i, 1);
      }
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

    // Fade the accumulation canvas slightly toward white to clear old drops
    accCtx.fillStyle = `rgba(255, 255, 255, ${state.params.fadeSpeed})`;
    accCtx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw new drops to accumulation canvas
    for (const drop of state.drops) {
      const lifeRatio = drop.age / drop.maxAge;
      const opacity = drop.startOpacity * (1 - lifeRatio);
      if (opacity <= 0.01) continue;

      // Watercolor radial gradient
      const grad = accCtx.createRadialGradient(
        drop.x, drop.y, 0,
        drop.x, drop.y, drop.radius
      );
      grad.addColorStop(0, rgbString(drop.r, drop.g, drop.b, opacity));
      grad.addColorStop(0.4, rgbString(drop.r, drop.g, drop.b, opacity * 0.7));
      grad.addColorStop(0.7, rgbString(drop.r, drop.g, drop.b, opacity * 0.3));
      grad.addColorStop(1, rgbString(drop.r, drop.g, drop.b, 0));

      accCtx.fillStyle = grad;
      accCtx.beginPath();
      accCtx.arc(drop.x, drop.y, drop.radius, 0, Math.PI * 2);
      accCtx.fill();
    }

    // Composite accumulation canvas to main canvas
    ctx.drawImage(state.accCanvas, 0, 0);

    // Weather indicator
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '12px monospace';
    ctx.fillText(state.weather.type, 10, canvas.height - 10);
  },

  resize(state, width, height) {
    // Accumulation canvas is resized in render
  },

  cleanup(state) {
    state.drops.length = 0;
  },
};
