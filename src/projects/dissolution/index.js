import { extractMask, getMaskPixels, getCenterOfMass } from '../../utils/silhouette.js';
import { getPixelColor } from '../../utils/pixels.js';
import { clamp, lerp, randomRange, easeInOut, easeOut } from '../../utils/math.js';
import { noise2D, noise3D } from '../../utils/noise.js';
import { rgbString } from '../../utils/color.js';
import { createControlPanel } from '../../utils/controls.js';

const BACKGROUND = '#f5f2ec';        // warm off-white
const INK = [70, 64, 54];            // soft warm gray for text
const PRESENCE_MIN_SAMPLES = 80;     // mask samples (at step 8) required to count as present
const PRESENCE_FRAMES = 45;          // stable frames of presence before countdown starts
const ABSENCE_CANCEL_FRAMES = 30;    // frames of absence that cancel a countdown
const MAX_PARTICLES = 20000;
const MAX_CARRY_SPEED = 150;         // px/s cap on inherited body motion
const REST_DURATION = 2.5;           // pause on empty mirror before re-arming

const PHASES = { MIRROR: 0, COUNTDOWN: 1, DISSOLVING: 2, RESTING: 3 };

export default {
  id: 'dissolution',
  name: 'Dissolution',
  description: 'Gaze at your reflection; after a countdown it freezes and gently dissolves into drifting dust.',
  mediapipe: ['segmentation'],

  init(ctx, canvas) {
    const state = {
      phase: PHASES.MIRROR,
      time: 0,
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,

      // Presence / motion tracking
      present: false,
      presenceFrames: 0,
      absenceFrames: 0,
      prevCenter: null,
      personVel: { x: 0, y: 0 },
      frozenVel: { x: 0, y: 0 },

      // Countdown / dissolve timing
      countdownT: 0,
      dissolveT: 0,
      restT: 0,

      // Particles + frozen image
      particles: [],
      snapshot: null,
      snapshotCtx: null,
      punchW: 0,
      punchH: 0,

      // Reusable compositing layers
      maskResult: null,
      maskLayer: null,
      maskCtx: null,
      maskImage: null,
      personLayer: null,
      personCtx: null,

      panel: null,
      params: null,
    };

    state.panel = createControlPanel({
      title: 'Dissolution',
      controls: [
        { key: 'countdown', label: 'Countdown (s)', min: 1, max: 10, step: 0.5, value: 3 },
        { key: 'hold', label: 'Freeze hold (s)', min: 0, max: 3, step: 0.1, value: 0.7 },
        { key: 'spread', label: 'Dissolve over (s)', min: 1, max: 25, step: 0.5, value: 8 },
        { key: 'patch', label: 'Erosion patch (px)', min: 10, max: 250, step: 5, value: 70 },
        { key: 'fade', label: 'Mote fade (s)', min: 2, max: 25, step: 0.5, value: 9 },
        { key: 'drift', label: 'Drift force', min: 0, max: 80, step: 1, value: 16 },
        { key: 'noiseScale', label: 'Flow scale', min: 0.2, max: 5, step: 0.1, value: 1.5 },
        { key: 'noiseSpeed', label: 'Flow speed', min: 0, max: 0.5, step: 0.01, value: 0.08 },
        { key: 'momentum', label: 'Momentum carry', min: 0, max: 2, step: 0.05, value: 0.6 },
        { key: 'buoyancy', label: 'Buoyancy', min: -30, max: 30, step: 1, value: 5 },
        { key: 'damping', label: 'Damping', min: 0, max: 3, step: 0.05, value: 0.7 },
        { key: 'moteSize', label: 'Mote size (px)', min: 0.5, max: 4, step: 0.1, value: 1.4 },
        { key: 'density', label: 'Sample step', min: 2, max: 8, step: 1, value: 4 },
        { key: 'softness', label: 'Edge blur (px)', min: 0, max: 6, step: 0.5, value: 1.5 },
        { type: 'button', label: 'Restart', onClick: () => _reset(state) },
      ],
    });
    state.params = state.panel.params;

    return state;
  },

  update(state, input, dt) {
    state.time += dt;
    state.canvasWidth = input.canvas.width;
    state.canvasHeight = input.canvas.height;

    switch (state.phase) {
      case PHASES.MIRROR:
      case PHASES.COUNTDOWN:
        _updateMirror(state, input, dt);
        break;
      case PHASES.DISSOLVING:
        _updateDissolving(state, input, dt);
        break;
      case PHASES.RESTING:
        state.restT += dt;
        if (state.restT >= REST_DURATION) _reset(state);
        break;
    }
  },

  render(state, input, ctx, canvas) {
    ctx.fillStyle = BACKGROUND;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (state.phase === PHASES.MIRROR || state.phase === PHASES.COUNTDOWN) {
      _renderMirror(state, input, ctx, canvas);
    } else if (state.phase === PHASES.DISSOLVING) {
      _renderDissolving(state, ctx, canvas);
    }
  },

  resize(state, width, height) {
    state.canvasWidth = width;
    state.canvasHeight = height;
    // Frozen snapshot and particle positions no longer match the canvas
    if (state.phase === PHASES.DISSOLVING || state.phase === PHASES.RESTING) {
      _reset(state);
    }
  },

  cleanup(state) {
    if (state.panel) state.panel.destroy();
    state.particles.length = 0;
    state.snapshot = null;
    state.maskLayer = null;
    state.personLayer = null;
  },
};

function _reset(state) {
  state.phase = PHASES.MIRROR;
  state.particles.length = 0;
  state.snapshot = null;
  state.snapshotCtx = null;
  state.presenceFrames = 0;
  state.absenceFrames = 0;
  state.prevCenter = null;
  state.personVel = { x: 0, y: 0 };
  state.countdownT = 0;
  state.dissolveT = 0;
  state.restT = 0;
}

function _updateMirror(state, input, dt) {
  if (input.segmentation) {
    state.maskResult = extractMask(input.segmentation);
  }
  const maskResult = state.maskResult;
  const present = !!(input.segmentation && maskResult && _countMaskSamples(maskResult, 8) >= PRESENCE_MIN_SAMPLES);
  state.present = present;

  // Track silhouette motion so the dust can inherit it
  if (present && dt > 0) {
    const center = getCenterOfMass(maskResult);
    if (center) {
      const dims = input.getWebcamDimensions();
      const map = _coverMap(dims.width, dims.height, state.canvasWidth, state.canvasHeight);
      const cx = state.canvasWidth - (map.offX + center.x * map.drawW);
      const cy = map.offY + center.y * map.drawH;
      if (state.prevCenter) {
        const instVx = (cx - state.prevCenter.x) / dt;
        const instVy = (cy - state.prevCenter.y) / dt;
        state.personVel.x = lerp(state.personVel.x, instVx, 0.12);
        state.personVel.y = lerp(state.personVel.y, instVy, 0.12);
      }
      state.prevCenter = { x: cx, y: cy };
    }
  } else {
    state.prevCenter = null;
    state.personVel.x = lerp(state.personVel.x, 0, 0.1);
    state.personVel.y = lerp(state.personVel.y, 0, 0.1);
  }

  if (present) {
    state.presenceFrames++;
    state.absenceFrames = 0;
  } else {
    state.presenceFrames = 0;
    state.absenceFrames++;
  }

  if (state.phase === PHASES.MIRROR) {
    if (state.presenceFrames >= PRESENCE_FRAMES) {
      state.phase = PHASES.COUNTDOWN;
      state.countdownT = state.params.countdown;
    }
  } else {
    // COUNTDOWN
    if (state.absenceFrames >= ABSENCE_CANCEL_FRAMES) {
      state.phase = PHASES.MIRROR;
      state.presenceFrames = 0;
      return;
    }
    state.countdownT -= dt;
    if (state.countdownT <= 0 && present) {
      _freeze(state, input);
    }
  }
}

function _freeze(state, input) {
  const maskResult = state.maskResult;
  const w = state.canvasWidth;
  const h = state.canvasHeight;
  const { width: mw, height: mh } = maskResult;
  const params = state.params;

  // Capture the frozen reflection at full resolution
  state.snapshot = new OffscreenCanvas(w, h);
  state.snapshotCtx = state.snapshot.getContext('2d');
  _composePerson(state, input.getVideoElement(), maskResult, state.snapshotCtx, w, h, params.softness);

  // Sample mask pixels into particles, bumping the step if there are too many
  let step = Math.round(params.density);
  let maskPixels = getMaskPixels(maskResult, step);
  while (maskPixels.length > MAX_PARTICLES && step < 16) {
    step++;
    maskPixels = getMaskPixels(maskResult, step);
  }

  const pixels = input.getPixelData();
  const webcamDims = input.getWebcamDimensions();
  const map = _coverMap(webcamDims.width, webcamDims.height, w, h);

  const tileW = (map.drawW / mw) * step;
  const tileH = (map.drawH / mh) * step;
  state.punchW = tileW * 1.3;
  state.punchH = tileH * 1.3;
  const tileRadius = Math.max(tileW, tileH) * 0.7;

  // Carry the body's recent motion into the dust, gently capped
  const speed = Math.hypot(state.personVel.x, state.personVel.y);
  const speedScale = speed > MAX_CARRY_SPEED ? MAX_CARRY_SPEED / speed : 1;
  state.frozenVel = {
    x: state.personVel.x * speedScale,
    y: state.personVel.y * speedScale,
  };

  // Spatial noise decides release order, so the body erodes in organic patches
  const patchScale = 1 / Math.max(1, params.patch);

  state.particles = [];
  for (const mp of maskPixels) {
    const canvasX = w - (map.offX + (mp.x / mw) * map.drawW);
    const canvasY = map.offY + (mp.y / mh) * map.drawH;

    // Skip silhouette pixels cropped out by the cover fit
    if (canvasX < -tileW || canvasX > w + tileW || canvasY < -tileH || canvasY > h + tileH) continue;

    const wx = clamp(Math.floor((1 - mp.x / mw) * webcamDims.width), 0, webcamDims.width - 1);
    const wy = clamp(Math.floor((mp.y / mh) * webcamDims.height), 0, webcamDims.height - 1);
    const [r, g, b] = getPixelColor(pixels, wx, wy);

    const n = (noise2D(canvasX * patchScale, canvasY * patchScale) + 1) / 2;
    const releaseAt = params.hold + n * params.spread + randomRange(0, params.spread * 0.1);

    state.particles.push({
      x: canvasX,
      y: canvasY,
      vx: 0,
      vy: 0,
      r, g, b,
      released: false,
      dead: false,
      releaseAt,
      age: 0,
      alpha: 1,
      tileRadius,
      drawRadius: tileRadius,
      moteRadius: params.moteSize * randomRange(0.6, 1.4),
      seed: Math.random() * 10,
    });
  }

  state.dissolveT = 0;
  state.phase = PHASES.DISSOLVING;
}

function _updateDissolving(state, input, dt) {
  const params = state.params;
  state.dissolveT += dt;
  const t = state.dissolveT;

  const w = state.canvasWidth;
  const h = state.canvasHeight;
  const sctx = state.snapshotCtx;
  const ns = params.noiseScale * 0.001;
  const dampF = Math.exp(-params.damping * dt);

  let alive = 0;
  for (const p of state.particles) {
    if (p.dead) continue;

    if (!p.released) {
      if (t < p.releaseAt) {
        alive++;
        continue;
      }
      p.released = true;
      p.vx = state.frozenVel.x * params.momentum + randomRange(-4, 4);
      p.vy = state.frozenVel.y * params.momentum + randomRange(-4, 4);
      // Erase this particle's tile from the frozen image
      sctx.clearRect(p.x - state.punchW / 2, p.y - state.punchH / 2, state.punchW, state.punchH);
    }

    p.age += dt;
    const lifeT = p.age / params.fade;
    if (lifeT >= 1) {
      p.dead = true;
      continue;
    }

    // Coherent flow field — like still air slowly moving through a room
    const angle = noise3D(p.x * ns, p.y * ns, state.time * params.noiseSpeed + p.seed * 0.05) * Math.PI * 2;
    p.vx += Math.cos(angle) * params.drift * dt;
    p.vy += Math.sin(angle) * params.drift * dt;
    p.vy -= params.buoyancy * dt;
    p.vx *= dampF;
    p.vy *= dampF;
    p.x += p.vx * dt;
    p.y += p.vy * dt;

    if (p.x < -60 || p.x > w + 60 || p.y < -60 || p.y > h + 60) {
      p.dead = true;
      continue;
    }

    p.alpha = 0.9 * (1 - easeInOut(clamp(lifeT, 0, 1)));
    // Settle from tile-sized fragment down to a dust mote over the first second
    const settle = easeOut(clamp(p.age, 0, 1));
    p.drawRadius = lerp(p.tileRadius, p.moteRadius, settle) * (1 - 0.3 * lifeT);
    alive++;
  }

  if (alive === 0) {
    state.particles.length = 0;
    state.phase = PHASES.RESTING;
    state.restT = 0;
  }
}

function _renderMirror(state, input, ctx, canvas) {
  const video = input.getVideoElement();
  const w = canvas.width;
  const h = canvas.height;

  if (state.maskResult && video && video.readyState >= 2) {
    if (!state.personLayer || state.personLayer.width !== w || state.personLayer.height !== h) {
      state.personLayer = new OffscreenCanvas(w, h);
      state.personCtx = state.personLayer.getContext('2d');
    }
    _composePerson(state, video, state.maskResult, state.personCtx, w, h, state.params.softness);
    ctx.drawImage(state.personLayer, 0, 0);
  }

  if (state.phase === PHASES.COUNTDOWN) {
    const number = Math.max(1, Math.ceil(state.countdownT));
    const frac = state.countdownT - Math.floor(state.countdownT);
    const alpha = 0.12 + 0.38 * easeInOut(frac);
    ctx.fillStyle = rgbString(INK[0], INK[1], INK[2], alpha);
    ctx.font = `100 ${Math.round(h * 0.16)}px 'Helvetica Neue', Helvetica, Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(number), w / 2, h * 0.18);
  } else if (!state.present) {
    const pulse = 0.25 + 0.15 * Math.sin(state.time * 1.5);
    ctx.fillStyle = rgbString(INK[0], INK[1], INK[2], pulse);
    ctx.font = `300 18px 'Helvetica Neue', Helvetica, Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('step into view', w / 2, h / 2);
  }
}

function _renderDissolving(state, ctx, canvas) {
  if (state.snapshot) {
    ctx.drawImage(state.snapshot, 0, 0);
  }

  for (const p of state.particles) {
    if (!p.released || p.dead || p.alpha <= 0.01) continue;
    ctx.fillStyle = rgbString(p.r, p.g, p.b, p.alpha);
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.drawRadius, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * Draw the mirrored webcam image masked by the silhouette into targetCtx.
 * Result is the person on a transparent background.
 */
function _composePerson(state, video, maskResult, targetCtx, targetW, targetH, softness) {
  const { width: mw, height: mh, data } = maskResult;

  if (!state.maskLayer || state.maskLayer.width !== mw || state.maskLayer.height !== mh) {
    state.maskLayer = new OffscreenCanvas(mw, mh);
    state.maskCtx = state.maskLayer.getContext('2d');
    state.maskImage = state.maskCtx.createImageData(mw, mh);
    const md = state.maskImage.data;
    for (let i = 0; i < md.length; i += 4) {
      md[i] = 255;
      md[i + 1] = 255;
      md[i + 2] = 255;
    }
  }

  const md = state.maskImage.data;
  const count = mw * mh;
  for (let i = 0; i < count; i++) {
    md[i * 4 + 3] = data[i] > 0 ? 255 : 0;
  }
  state.maskCtx.putImageData(state.maskImage, 0, 0);

  // Cover-fit the video to the canvas (crop instead of stretch). The
  // centered crop is symmetric, so the same rect works in mirrored space.
  const map = _coverMap(video.videoWidth, video.videoHeight, targetW, targetH);

  targetCtx.clearRect(0, 0, targetW, targetH);
  targetCtx.save();
  targetCtx.translate(targetW, 0);
  targetCtx.scale(-1, 1);
  targetCtx.drawImage(video, map.offX, map.offY, map.drawW, map.drawH);
  targetCtx.globalCompositeOperation = 'destination-in';
  if (softness > 0) {
    targetCtx.filter = `blur(${softness}px)`;
  }
  targetCtx.drawImage(state.maskLayer, map.offX, map.offY, map.drawW, map.drawH);
  targetCtx.restore();
}

/**
 * Scale source dimensions to fill the target while preserving aspect ratio
 * (like CSS object-fit: cover), centered, cropping the overflow.
 */
function _coverMap(srcW, srcH, targetW, targetH) {
  const scale = Math.max(targetW / srcW, targetH / srcH);
  const drawW = srcW * scale;
  const drawH = srcH * scale;
  return { drawW, drawH, offX: (targetW - drawW) / 2, offY: (targetH - drawH) / 2 };
}

function _countMaskSamples(maskResult, step) {
  const { data, width, height } = maskResult;
  let count = 0;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      if (data[y * width + x] > 0) count++;
    }
  }
  return count;
}
