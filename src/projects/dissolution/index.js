import { extractMask, getCenterOfMass } from '../../utils/silhouette.js';
import { clamp, lerp, randomRange, easeInOut } from '../../utils/math.js';
import { noise2D, noise3D } from '../../utils/noise.js';
import { rgbString } from '../../utils/color.js';
import { FlakeRenderer } from './FlakeRenderer.js';

const BACKGROUND = '#f5f2ec';        // warm off-white
const INK = [70, 64, 54];            // soft warm gray for text
const PRESENCE_MIN_SAMPLES = 80;     // mask samples (at step 8) required to count as present
const PRESENCE_FRAMES = 45;          // stable frames of presence before countdown starts
const ABSENCE_CANCEL_FRAMES = 30;    // frames of absence that cancel a countdown
const MAX_PARTICLES_GL = 150000;     // WebGL point sprites stay cheap
const MAX_PARTICLES_2D = 20000;      // canvas-2D drawImage fallback budget
const FLOW_GRID_SPACING = 40;        // px between flow-field noise samples
const MAX_CARRY_SPEED = 150;         // px/s cap on inherited body motion
const REST_DURATION = 2.5;           // pause on empty mirror before re-arming

const PHASES = { MIRROR: 0, COUNTDOWN: 1, DISSOLVING: 2, RESTING: 3 };

export default {
  id: 'dissolution',
  name: 'Dissolution',
  description: 'Gaze at your reflection; after a countdown it freezes and gently dissolves into drifting dust.',
  mediapipe: ['segmentation'],
  params: {
    countdown:  { value: 3,    min: 1,   max: 10,  step: 0.5,  label: 'Countdown (s)' },
    hold:       { value: 0.7,  min: 0,   max: 3,   step: 0.1,  label: 'Freeze Hold (s)' },
    spread:     { value: 8,    min: 0,   max: 25,  step: 0.5,  label: 'Dissolve Over (s)' },
    patch:      { value: 70,   min: 10,  max: 250, step: 5,    label: 'Erosion Patch (px)' },
    fade:       { value: 9,    min: 2,   max: 25,  step: 0.5,  label: 'Mote Fade (s)' },
    drift:      { value: 16,   min: 0,   max: 80,  step: 1,    label: 'Drift Force' },
    noiseScale: { value: 1.5,  min: 0.2, max: 5,   step: 0.1,  label: 'Flow Scale' },
    noiseSpeed: { value: 0.08, min: 0,   max: 0.5, step: 0.01, label: 'Flow Speed' },
    momentum:   { value: 0.6,  min: 0,   max: 2,   step: 0.05, label: 'Momentum Carry' },
    buoyancy:   { value: 5,    min: -30, max: 30,  step: 1,    label: 'Buoyancy' },
    damping:    { value: 0.7,  min: 0,   max: 3,   step: 0.05, label: 'Damping' },
    moteShrink: { value: 1,    min: 0.1, max: 1,   step: 0.05, label: 'Mote Shrink' },
    flake:      { value: 3,    min: 1,   max: 10,  step: 1,    label: 'Flake Size' },
    softness:   { value: 1.5,  min: 0,   max: 6,   step: 0.5,  label: 'Edge Blur (px)' },
  },
  // The defaults are the "gentle drift" mood; these presets explore others.
  // Countdown, density, and edge blur are deliberately left untouched.
  presets: [
    {
      // Heavy motes sink and settle like ash after a fire
      name: 'Ash',
      values: { hold: 1.2, spread: 12, patch: 110, fade: 13, drift: 9, noiseScale: 1.0, noiseSpeed: 0.04, momentum: 0.3, buoyancy: -8, damping: 1.1, moteShrink: 0.5 },
    },
    {
      // Everything rises — smoke leaving a body
      name: 'Updraft',
      values: { hold: 0.5, spread: 6, patch: 50, fade: 10, drift: 12, noiseScale: 1.2, noiseSpeed: 0.1, momentum: 0.4, buoyancy: 18, damping: 0.5, moteShrink: 0.7 },
    },
    {
      // Fast, windy, strongly carried by your last movement
      name: 'Swept Away',
      values: { hold: 0.3, spread: 4, patch: 35, fade: 5.5, drift: 48, noiseScale: 3, noiseSpeed: 0.22, momentum: 1.5, buoyancy: 2, damping: 0.4, moteShrink: 0.35 },
    },
    {
      // Almost imperceptibly slow; large patches linger like a fading memory
      name: 'Haunting',
      values: { hold: 1.5, spread: 18, patch: 160, fade: 20, drift: 6, noiseScale: 0.7, noiseSpeed: 0.03, momentum: 0.15, buoyancy: 3, damping: 0.6, moteShrink: 0.85 },
    },
  ],

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
      releasedCount: 0,
      firstAlive: 0,
      snapshot: null,
      snapshotCtx: null,
      snapshotCleared: false,
      source: null,
      flakes: FlakeRenderer.create(canvas),

      // Shared flow field, sampled on a coarse grid once per frame
      flowFx: null,
      flowFy: null,
      flowCols: 0,
      flowRows: 0,

      // Reusable compositing layers
      maskResult: null,
      maskLayer: null,
      maskCtx: null,
      maskImage: null,
      personLayer: null,
      personCtx: null,
    };

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
    if (state.flakes) state.flakes.resize();
    // Frozen snapshot and particle positions no longer match the canvas
    if (state.phase === PHASES.DISSOLVING || state.phase === PHASES.RESTING) {
      _reset(state);
    }
  },

  cleanup(state) {
    if (state.flakes) {
      state.flakes.destroy();
      state.flakes = null;
    }
    state.particles.length = 0;
    state.snapshot = null;
    state.maskLayer = null;
    state.personLayer = null;
  },
};

function _reset(state) {
  state.phase = PHASES.MIRROR;
  state.particles.length = 0;
  state.releasedCount = 0;
  state.firstAlive = 0;
  state.snapshot = null;
  state.snapshotCtx = null;
  state.snapshotCleared = false;
  state.source = null;
  if (state.flakes) state.flakes.clear();
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

  // Capture the frozen reflection at full resolution, plus a pristine copy
  // that drifting fragments are drawn from
  state.snapshot = new OffscreenCanvas(w, h);
  state.snapshotCtx = state.snapshot.getContext('2d');
  _composePerson(state, input.getVideoElement(), maskResult, state.snapshotCtx, w, h, params.softness);
  state.source = new OffscreenCanvas(w, h);
  state.source.getContext('2d').drawImage(state.snapshot, 0, 0);
  state.snapshotCleared = false;

  // Tile the silhouette with grid cells, bumping the cell size if there are
  // too many. Every cell that touches the mask becomes a fragment carrying
  // its actual image pixels, so the whole body — edges included — leaves as
  // particles with nothing left behind.
  const maxParticles = state.flakes ? MAX_PARTICLES_GL : MAX_PARTICLES_2D;
  let step = Math.round(params.flake);
  let cells = _coveredCells(maskResult, step);
  while (cells.length > maxParticles && step < 16) {
    step++;
    cells = _coveredCells(maskResult, step);
  }

  const webcamDims = input.getWebcamDimensions();
  const map = _coverMap(webcamDims.width, webcamDims.height, w, h);

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
  for (const cell of cells) {
    // Cell bounds in canvas space; the x mapping mirrors, so the cell's
    // right edge in mask space becomes its left edge on screen
    const left = w - (map.offX + (cell.x1 / mw) * map.drawW);
    const right = w - (map.offX + (cell.x0 / mw) * map.drawW);
    const top = map.offY + (cell.y0 / mh) * map.drawH;
    const bottom = map.offY + (cell.y1 / mh) * map.drawH;

    // Clip to the canvas (cover fit can push cells off-screen) and snap to
    // whole pixels: adjacent cells share the same snapped boundary, so the
    // lift-out clears are exact — no antialiased slivers left behind and no
    // biting into neighbors that haven't released yet. Zero-size cells own
    // no pixels (a neighbor's rect covers them) and are skipped.
    const x0 = Math.round(clamp(left, 0, w));
    const x1 = Math.round(clamp(right, 0, w));
    const y0 = Math.round(clamp(top, 0, h));
    const y1 = Math.round(clamp(bottom, 0, h));
    const rectW = x1 - x0;
    const rectH = y1 - y0;
    if (rectW < 1 || rectH < 1) continue;

    const cx = x0 + rectW / 2;
    const cy = y0 + rectH / 2;

    const n = (noise2D(cx * patchScale, cy * patchScale) + 1) / 2;
    const releaseAt = params.hold + n * params.spread + randomRange(0, params.spread * 0.1);

    state.particles.push({
      x: cx,
      y: cy,
      vx: 0,
      vy: 0,
      srcX: x0,
      srcY: y0,
      rectW,
      rectH,
      cellPx: Math.max(rectW, rectH),
      scale: 1,
      released: false,
      dead: false,
      releaseAt,
      age: 0,
      alpha: 1,
    });
  }

  // Release order = array order, so released flakes form a contiguous window
  state.particles.sort((a, b) => a.releaseAt - b.releaseAt);
  state.releasedCount = 0;
  state.firstAlive = 0;

  if (state.flakes) {
    state.flakes.begin(state.source, state.particles);
  }

  state.dissolveT = 0;
  state.phase = PHASES.DISSOLVING;
}

/** Grid cells (in mask space) that contain at least one silhouette pixel */
function _coveredCells(maskResult, step) {
  const { data, width, height } = maskResult;
  const cells = [];
  for (let y0 = 0; y0 < height; y0 += step) {
    const y1 = Math.min(y0 + step, height);
    for (let x0 = 0; x0 < width; x0 += step) {
      const x1 = Math.min(x0 + step, width);
      let covered = false;
      for (let my = y0; my < y1 && !covered; my++) {
        const row = my * width;
        for (let mx = x0; mx < x1; mx++) {
          if (data[row + mx] > 0) {
            covered = true;
            break;
          }
        }
      }
      if (covered) cells.push({ x0, y0, x1, y1 });
    }
  }
  return cells;
}

function _updateDissolving(state, input, dt) {
  const params = state.params;
  state.dissolveT += dt;
  const t = state.dissolveT;

  const w = state.canvasWidth;
  const h = state.canvasHeight;
  const sctx = state.snapshotCtx;
  const parts = state.particles;
  const n = parts.length;

  // Release flakes whose time has come (array is sorted by releaseAt).
  // Each is lifted out of the frozen image and redrawn at the exact same
  // spot this frame, so the hand-off is invisible. Flakes start with only
  // the body's carried momentum; all other motion ramps in from the flow
  // field so nothing shifts at the instant of release.
  const vx0 = state.frozenVel.x * params.momentum;
  const vy0 = state.frozenVel.y * params.momentum;
  if (state.releasedCount < n && t >= parts[n - 1].releaseAt) {
    // Everything is due at once (e.g. Dissolve Over = 0): skip per-flake
    // clears and wipe the snapshot in one go
    for (let i = state.releasedCount; i < n; i++) {
      const p = parts[i];
      p.released = true;
      p.vx = vx0;
      p.vy = vy0;
    }
    state.releasedCount = n;
    sctx.clearRect(0, 0, state.snapshot.width, state.snapshot.height);
    state.snapshotCleared = true;
  } else {
    while (state.releasedCount < n && t >= parts[state.releasedCount].releaseAt) {
      const p = parts[state.releasedCount++];
      p.released = true;
      p.vx = vx0;
      p.vy = vy0;
      sctx.clearRect(p.srcX, p.srcY, p.rectW, p.rectH);
    }
  }

  // Evaluate the flow noise once per grid node per frame; particles sample
  // it bilinearly. This keeps cost flat regardless of particle count.
  if (state.releasedCount > state.firstAlive) {
    _buildFlowField(state, params);
  }
  const { flowFx, flowFy, flowCols, flowRows } = state;
  const spacing = FLOW_GRID_SPACING;
  const dampF = Math.exp(-params.damping * dt);
  const shrinkTime = params.fade * 0.35;
  // Flakes shrink toward this fraction of their original size as they
  // drift; at 1 they stay flake-sized and only the fade reveals background
  const moteScale = clamp(params.moteShrink, 0.05, 1);

  let moving = 0;
  for (let i = state.firstAlive; i < state.releasedCount; i++) {
    const p = parts[i];
    if (p.dead) continue;

    p.age += dt;
    const lifeT = p.age / params.fade;
    if (lifeT >= 1) {
      p.dead = true;
      p.alpha = 0;
      continue;
    }

    // Bilinear sample of the shared flow field
    let gx = p.x / spacing;
    let gy = p.y / spacing;
    gx = gx < 0 ? 0 : (gx > flowCols - 2 ? flowCols - 2 : gx);
    gy = gy < 0 ? 0 : (gy > flowRows - 2 ? flowRows - 2 : gy);
    const cx = Math.floor(gx);
    const cy = Math.floor(gy);
    const tx = gx - cx;
    const ty = gy - cy;
    const i00 = cy * flowCols + cx;
    const i01 = i00 + flowCols;
    const fx = (flowFx[i00] * (1 - tx) + flowFx[i00 + 1] * tx) * (1 - ty) +
               (flowFx[i01] * (1 - tx) + flowFx[i01 + 1] * tx) * ty;
    const fy = (flowFy[i00] * (1 - tx) + flowFy[i00 + 1] * tx) * (1 - ty) +
               (flowFy[i01] * (1 - tx) + flowFy[i01 + 1] * tx) * ty;

    p.vx += fx * dt;
    p.vy += fy * dt - params.buoyancy * dt;
    p.vx *= dampF;
    p.vy *= dampF;
    p.x += p.vx * dt;
    p.y += p.vy * dt;

    if (p.x < -60 || p.x > w + 60 || p.y < -60 || p.y > h + 60) {
      p.dead = true;
      p.alpha = 0;
      continue;
    }

    // Full opacity at release (matching the frozen image exactly), then a
    // slow ease into transparency; shrink from full image fragment down to
    // a dust speck over the first third of its life
    p.alpha = 1 - easeInOut(clamp(lifeT, 0, 1));
    p.scale = lerp(1, moteScale, easeInOut(clamp(p.age / shrinkTime, 0, 1)));
    moving++;
  }
  while (state.firstAlive < state.releasedCount && parts[state.firstAlive].dead) {
    state.firstAlive++;
  }

  const frozen = n - state.releasedCount;

  // Once every particle has released, wipe the snapshot so no edge
  // fringe or antialiased slivers linger behind
  if (frozen === 0 && !state.snapshotCleared && sctx) {
    sctx.clearRect(0, 0, state.snapshot.width, state.snapshot.height);
    state.snapshotCleared = true;
  }

  if (frozen === 0 && moving === 0) {
    state.particles.length = 0;
    state.releasedCount = 0;
    state.firstAlive = 0;
    if (state.flakes) state.flakes.clear();
    state.phase = PHASES.RESTING;
    state.restT = 0;
  }
}

/** Flow field as unit drift vectors (pre-scaled by drift force) on a coarse grid */
function _buildFlowField(state, params) {
  const spacing = FLOW_GRID_SPACING;
  const cols = Math.ceil(state.canvasWidth / spacing) + 2;
  const rows = Math.ceil(state.canvasHeight / spacing) + 2;
  if (!state.flowFx || state.flowFx.length !== cols * rows) {
    state.flowFx = new Float32Array(cols * rows);
    state.flowFy = new Float32Array(cols * rows);
  }
  state.flowCols = cols;
  state.flowRows = rows;

  const ns = params.noiseScale * 0.001;
  const tz = state.time * params.noiseSpeed;
  const drift = params.drift;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const angle = noise3D(c * spacing * ns, r * spacing * ns, tz) * Math.PI * 2;
      state.flowFx[r * cols + c] = Math.cos(angle) * drift;
      state.flowFy[r * cols + c] = Math.sin(angle) * drift;
    }
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

  // Each fragment is a piece of the frozen image itself, drifting away and
  // shrinking into a speck. Drawn as WebGL point sprites on the overlay
  // canvas when available, canvas-2D drawImage otherwise.
  if (state.flakes) {
    state.flakes.draw(state.particles, state.firstAlive, state.releasedCount);
    return;
  }
  if (!state.source) return;

  for (let i = state.firstAlive; i < state.releasedCount; i++) {
    const p = state.particles[i];
    if (p.dead || p.alpha <= 0.01) continue;
    const dw = p.rectW * p.scale;
    const dh = p.rectH * p.scale;
    if (dw < 0.2 || dh < 0.2) continue;
    ctx.globalAlpha = p.alpha;
    ctx.drawImage(state.source, p.srcX, p.srcY, p.rectW, p.rectH, p.x - dw / 2, p.y - dh / 2, dw, dh);
  }
  ctx.globalAlpha = 1;
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
