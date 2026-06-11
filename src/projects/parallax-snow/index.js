import { lerp, randomRange } from '../../utils/math.js';
import { noise2D } from '../../utils/noise.js';

const PROFILE_RES = 400;
const PAD = 300;

const SCENERY = [
  { baseY: 0.50, amp: 0.14, freq: 2.5, seed: 7,   color: '#131c30', depth: 0.05 },
  { baseY: 0.62, amp: 0.10, freq: 3.0, seed: 113, color: '#1a2a45', depth: 0.12 },
  { baseY: 0.74, amp: 0.06, freq: 4.0, seed: 227, color: '#253856', depth: 0.22 },
  { baseY: 0.88, amp: 0.025, freq: 5.5, seed: 341, color: '#5a7a98', depth: 0.38 },
];

function makeFlake(w, h, scatter) {
  return {
    x: randomRange(0, w),
    y: scatter ? randomRange(0, h) : randomRange(-40, -5),
    depth: Math.random(),
    seed: Math.random() * 1000,
  };
}

export default {
  id: 'parallax-snow',
  name: 'Parallax Snow',
  description: 'A layered winter scene with falling snow. Move your head to peer through the window and feel the depth.',
  mediapipe: ['face'],
  params: {
    numFlakes:        { value: 500,  min: 100, max: 1200, step: 25,   label: 'Snowflakes' },
    parallaxStrength: { value: 120,  min: 20,  max: 300,  step: 5,    label: 'Parallax Strength' },
    fallSpeedMin:     { value: 15,   min: 5,   max: 50,   step: 1,    label: 'Min Fall Speed' },
    fallSpeedMax:     { value: 70,   min: 20,  max: 150,  step: 5,    label: 'Max Fall Speed' },
    sizeMin:          { value: 1.0,  min: 0.5, max: 3,    step: 0.5,  label: 'Min Size' },
    sizeMax:          { value: 5.0,  min: 2,   max: 10,   step: 0.5,  label: 'Max Size' },
    drift:            { value: 25,   min: 0,   max: 80,   step: 1,    label: 'Wind Drift' },
    driftSpeed:       { value: 0.4,  min: 0.1, max: 1.5,  step: 0.05, label: 'Drift Speed' },
    trackSmoothing:   { value: 3.0,  min: 1.0, max: 8.0,  step: 0.5,  label: 'Track Smoothing' },
    vertParallax:     { value: 0.3,  min: 0,   max: 1.0,  step: 0.05, label: 'Vertical Parallax' },
  },
  presets: [
    {
      name: 'Gentle Evening',
      values: { numFlakes: 400, parallaxStrength: 100, fallSpeedMax: 50, drift: 15, sizeMax: 4 },
    },
    {
      name: 'Blizzard',
      values: { numFlakes: 1000, parallaxStrength: 80, fallSpeedMin: 25, fallSpeedMax: 120, drift: 60, driftSpeed: 0.8 },
    },
    {
      name: 'Deep Parallax',
      values: { numFlakes: 500, parallaxStrength: 250, fallSpeedMax: 60, vertParallax: 0.6 },
    },
    {
      name: 'Sparse Flurry',
      values: { numFlakes: 150, parallaxStrength: 140, fallSpeedMax: 40, sizeMin: 2, sizeMax: 7, drift: 30 },
    },
  ],

  init(ctx, canvas) {
    const w = canvas.width;
    const h = canvas.height;

    const profiles = SCENERY.map(layer => {
      const pts = new Float32Array(PROFILE_RES);
      for (let i = 0; i < PROFILE_RES; i++) {
        const nx = (i / PROFILE_RES) * layer.freq;
        pts[i] = noise2D(nx + layer.seed, layer.seed * 0.7) * layer.amp
               + noise2D(nx * 2.7 + layer.seed + 50, layer.seed * 0.3 + 10) * layer.amp * 0.35;
      }
      return pts;
    });

    const groundProfile = new Float32Array(PROFILE_RES);
    for (let i = 0; i < PROFILE_RES; i++) {
      groundProfile[i] = noise2D((i / PROFILE_RES) * 6 + 500, 500) * 0.012;
    }

    const stars = [];
    for (let i = 0; i < 100; i++) {
      stars.push({
        x: Math.random(),
        y: Math.random() * 0.5,
        size: Math.random() * 1.2 + 0.3,
        alpha: Math.random() * 0.4 + 0.15,
      });
    }

    const flakes = [];
    for (let i = 0; i < 500; i++) {
      flakes.push(makeFlake(w, h, true));
    }

    return { profiles, groundProfile, stars, flakes, headX: 0.5, headY: 0.4, hasHead: false };
  },

  update(state, input, dt) {
    const P = state.params;
    const { width: w, height: h } = input.canvas;
    const elapsed = input.time.elapsed;

    // Head tracking via iris landmarks (468, 473)
    if (input.face && input.face.landmarks && input.face.landmarks.length > 0) {
      const lm = input.face.landmarks[0];
      let tx, ty;
      if (lm[468] && lm[473]) {
        tx = 1 - (lm[468].x + lm[473].x) * 0.5;
        ty = (lm[468].y + lm[473].y) * 0.5;
      } else if (lm[1]) {
        tx = 1 - lm[1].x;
        ty = lm[1].y;
      }
      if (tx !== undefined) {
        const sm = 1 - Math.exp(-dt * P.trackSmoothing);
        if (!state.hasHead) {
          state.headX = tx;
          state.headY = ty;
          state.hasHead = true;
        } else {
          state.headX = lerp(state.headX, tx, sm);
          state.headY = lerp(state.headY, ty, sm);
        }
      }
    }

    // Manage flake pool
    const numFlakes = Math.round(P.numFlakes);
    while (state.flakes.length < numFlakes) {
      state.flakes.push(makeFlake(w, h, false));
    }
    if (state.flakes.length > numFlakes) state.flakes.length = numFlakes;

    // Update flakes
    for (const f of state.flakes) {
      f.y += lerp(P.fallSpeedMin, P.fallSpeedMax, f.depth) * dt;
      f.x += noise2D(f.seed, elapsed * P.driftSpeed) * P.drift * dt;
      if (f.y > h + 30) {
        f.y = randomRange(-40, -5);
        f.x = randomRange(0, w);
      }
    }
  },

  render(state, input, ctx, canvas) {
    const P = state.params;
    const w = canvas.width;
    const h = canvas.height;
    const hx = (state.headX - 0.5) * 2;
    const hy = (state.headY - 0.5) * 2;
    const pStr = P.parallaxStrength;
    const vp = P.vertParallax;
    const totalW = w + PAD * 2;

    // Sky gradient
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#080d1a');
    grad.addColorStop(0.5, '#101c30');
    grad.addColorStop(1, '#182840');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Stars
    ctx.fillStyle = '#ffffff';
    const starSx = -hx * 0.02 * pStr;
    const starSy = -hy * 0.02 * pStr * vp;
    for (const s of state.stars) {
      ctx.globalAlpha = s.alpha;
      ctx.fillRect(s.x * w + starSx, s.y * h + starSy, s.size, s.size);
    }
    ctx.globalAlpha = 1;

    // Mountain / hill silhouettes
    for (let li = 0; li < SCENERY.length; li++) {
      const layer = SCENERY[li];
      const profile = state.profiles[li];
      const sx = -hx * layer.depth * pStr;
      const sy = -hy * layer.depth * pStr * vp;

      ctx.fillStyle = layer.color;
      ctx.beginPath();
      for (let i = 0; i < PROFILE_RES; i++) {
        const x = (i / (PROFILE_RES - 1)) * totalW - PAD + sx;
        const y = (layer.baseY - profile[i]) * h + sy;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.lineTo(totalW - PAD + sx, h + 10);
      ctx.lineTo(-PAD + sx, h + 10);
      ctx.closePath();
      ctx.fill();
    }

    // Ground snow surface
    const gd = 0.45;
    const gsx = -hx * gd * pStr;
    const gsy = -hy * gd * pStr * vp;
    const gp = state.groundProfile;

    ctx.fillStyle = '#c0d4e2';
    ctx.beginPath();
    for (let i = 0; i < PROFILE_RES; i++) {
      const x = (i / (PROFILE_RES - 1)) * totalW - PAD + gsx;
      const y = (0.92 - gp[i]) * h + gsy;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.lineTo(totalW - PAD + gsx, h + 10);
    ctx.lineTo(-PAD + gsx, h + 10);
    ctx.closePath();
    ctx.fill();

    // Snow flakes
    ctx.fillStyle = '#ffffff';
    const wrapW = w + PAD * 2;
    for (const f of state.flakes) {
      const sx = -hx * f.depth * pStr;
      const sy = -hy * f.depth * pStr * vp;
      let fx = f.x + sx;
      const fy = f.y + sy;

      fx = ((fx + PAD) % wrapW + wrapW) % wrapW - PAD;
      if (fx < -10 || fx > w + 10 || fy < -10 || fy > h + 10) continue;

      const size = lerp(P.sizeMin, P.sizeMax, f.depth);
      ctx.globalAlpha = lerp(0.2, 0.9, f.depth);
      ctx.beginPath();
      ctx.arc(fx, fy, size, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = 1;
  },

  resize(state, width, height) {},
  cleanup(state) {},
};
