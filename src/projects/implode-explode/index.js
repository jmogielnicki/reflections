import { extractMask, getCenterOfMass, getMaskPixels } from '../../utils/silhouette.js';
import { getPixelColor } from '../../utils/pixels.js';
import { randomRange, lerp, clamp, dist } from '../../utils/math.js';
import { noise2D } from '../../utils/noise.js';
import { rgbString } from '../../utils/color.js';

const PARTICLE_COUNT = 8000;
const SAMPLE_STEP = 3;          // Downsample mask pixels
const ATTRACTION_STRENGTH = 4;
const SETTLE_THRESHOLD = 3;     // pixels
const SETTLE_RATIO = 0.90;      // 90% settled → transition to HOLDING
const HOLD_DURATION = 2.5;      // seconds
const EXPLOSION_STRENGTH = 600;
const GRAVITY = 150;
const JITTER_AMOUNT = 1.5;
const DAMPING = 0.96;
const IMPLODE_DAMPING = 0.92;

const PHASES = { WAITING: 0, IMPLODING: 1, HOLDING: 2, EXPLODING: 3 };

export default {
  id: 'implode-explode',
  name: 'Implode / Explode',
  description: 'Particles rush in from off-screen to form your silhouette, hold, then burst apart.',
  mediapipe: ['segmentation', 'pose'],

  init(ctx, canvas) {
    return {
      phase: PHASES.WAITING,
      particles: [],
      holdTimer: 0,
      center: { x: 0.5, y: 0.5 },
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      waitCooldown: 0,  // Prevent immediate re-trigger after explosion
      detectionCount: 0, // Require stable detection before triggering
    };
  },

  update(state, input, dt) {
    const { width, height } = input.canvas;
    state.canvasWidth = width;
    state.canvasHeight = height;

    switch (state.phase) {
      case PHASES.WAITING:
        _updateWaiting(state, input, dt);
        break;
      case PHASES.IMPLODING:
        _updateImploding(state, input, dt);
        break;
      case PHASES.HOLDING:
        _updateHolding(state, input, dt);
        break;
      case PHASES.EXPLODING:
        _updateExploding(state, input, dt);
        break;
    }
  },

  render(state, input, ctx, canvas) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw particles
    for (const p of state.particles) {
      if (p.alpha <= 0.01) continue;
      ctx.fillStyle = rgbString(p.r, p.g, p.b, p.alpha);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }

    // Phase indicator
    const phaseNames = ['Waiting...', 'Imploding', 'Holding', 'Exploding'];
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font = '12px monospace';
    ctx.fillText(phaseNames[state.phase], 10, canvas.height - 10);
  },

  resize(state, width, height) {
    state.canvasWidth = width;
    state.canvasHeight = height;
  },

  cleanup(state) {
    state.particles.length = 0;
    state.phase = PHASES.WAITING;
  },
};

function _updateWaiting(state, input, dt) {
  // Cooldown after explosion
  if (state.waitCooldown > 0) {
    state.waitCooldown -= dt;
    return;
  }

  // Check for person via pose landmarks
  if (!input.pose || !input.pose.landmarks || input.pose.landmarks.length === 0) {
    state.detectionCount = 0;
    return;
  }

  // Require stable detection for a few frames
  state.detectionCount++;
  if (state.detectionCount < 10) return;

  // Person detected with stable tracking — capture silhouette
  if (!input.segmentation) return;

  const maskResult = extractMask(input.segmentation);
  const maskPixels = getMaskPixels(maskResult, SAMPLE_STEP);

  if (maskPixels.length < 50) return; // Not enough mask data

  const center = getCenterOfMass(maskResult);
  if (center) {
    state.center = { x: (1 - center.x) * state.canvasWidth, y: center.y * state.canvasHeight };
  }

  // Sample webcam colors and create target positions
  const pixels = input.getPixelData();
  const webcamDims = input.getWebcamDimensions();

  // Select a subset of mask pixels as targets
  const targetCount = Math.min(PARTICLE_COUNT, maskPixels.length);
  const step = Math.max(1, Math.floor(maskPixels.length / targetCount));

  state.particles = [];

  for (let i = 0; i < maskPixels.length && state.particles.length < PARTICLE_COUNT; i += step) {
    const mp = maskPixels[i];

    // Map mask coords to canvas coords (mirrored)
    const canvasX = (1 - mp.x / maskResult.width) * state.canvasWidth;
    const canvasY = (mp.y / maskResult.height) * state.canvasHeight;

    // Sample color from webcam (mirrored)
    const wx = Math.floor((1 - mp.x / maskResult.width) * webcamDims.width);
    const wy = Math.floor((mp.y / maskResult.height) * webcamDims.height);
    const clampedX = clamp(wx, 0, webcamDims.width - 1);
    const clampedY = clamp(wy, 0, webcamDims.height - 1);
    const [r, g, b] = getPixelColor(pixels, clampedX, clampedY);

    // Random off-screen start position
    const edge = Math.floor(Math.random() * 4);
    let startX, startY;
    switch (edge) {
      case 0: startX = randomRange(-200, -50); startY = randomRange(0, state.canvasHeight); break;
      case 1: startX = randomRange(state.canvasWidth + 50, state.canvasWidth + 200); startY = randomRange(0, state.canvasHeight); break;
      case 2: startX = randomRange(0, state.canvasWidth); startY = randomRange(-200, -50); break;
      case 3: startX = randomRange(0, state.canvasWidth); startY = randomRange(state.canvasHeight + 50, state.canvasHeight + 200); break;
    }

    state.particles.push({
      x: startX,
      y: startY,
      vx: 0,
      vy: 0,
      targetX: canvasX,
      targetY: canvasY,
      r, g, b,
      alpha: 1,
      size: randomRange(1.5, 3),
      settled: false,
    });
  }

  state.phase = PHASES.IMPLODING;
  state.detectionCount = 0;
}

function _updateImploding(state, input, dt) {
  let settledCount = 0;

  for (const p of state.particles) {
    // Attraction toward target
    const dx = p.targetX - p.x;
    const dy = p.targetY - p.y;
    const d = Math.sqrt(dx * dx + dy * dy);

    if (d < SETTLE_THRESHOLD) {
      p.settled = true;
      settledCount++;
      // Snap close to target with jitter
      p.x = p.targetX + (Math.random() - 0.5) * JITTER_AMOUNT;
      p.y = p.targetY + (Math.random() - 0.5) * JITTER_AMOUNT;
      p.vx = 0;
      p.vy = 0;
      continue;
    }

    // Attraction force
    const force = ATTRACTION_STRENGTH;
    p.vx += (dx / d) * force;
    p.vy += (dy / d) * force;

    // Slight noise for organic feel
    p.vx += noise2D(p.x * 0.01, p.y * 0.01) * 0.5;
    p.vy += noise2D(p.x * 0.01 + 500, p.y * 0.01 + 500) * 0.5;

    // Damping
    p.vx *= IMPLODE_DAMPING;
    p.vy *= IMPLODE_DAMPING;

    // Integrate
    p.x += p.vx * dt * 60;
    p.y += p.vy * dt * 60;
  }

  // Check if enough particles settled
  if (state.particles.length > 0 && settledCount / state.particles.length >= SETTLE_RATIO) {
    state.phase = PHASES.HOLDING;
    state.holdTimer = 0;
  }
}

function _updateHolding(state, input, dt) {
  state.holdTimer += dt;

  // Re-sample live webcam colors during hold
  if (input.segmentation) {
    const pixels = input.getPixelData();
    const webcamDims = input.getWebcamDimensions();

    for (const p of state.particles) {
      // Jitter near target
      p.x = p.targetX + (Math.random() - 0.5) * JITTER_AMOUNT;
      p.y = p.targetY + (Math.random() - 0.5) * JITTER_AMOUNT;

      // Re-sample color
      const wx = clamp(Math.floor((p.targetX / state.canvasWidth) * webcamDims.width), 0, webcamDims.width - 1);
      const wy = clamp(Math.floor((p.targetY / state.canvasHeight) * webcamDims.height), 0, webcamDims.height - 1);
      const [r, g, b] = getPixelColor(pixels, wx, wy);
      p.r = r; p.g = g; p.b = b;
    }
  }

  if (state.holdTimer >= HOLD_DURATION) {
    state.phase = PHASES.EXPLODING;

    // Apply explosion force
    for (const p of state.particles) {
      const dx = p.x - state.center.x;
      const dy = p.y - state.center.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;

      const force = EXPLOSION_STRENGTH / Math.sqrt(d + 1);
      p.vx = (dx / d) * force + randomRange(-50, 50);
      p.vy = (dy / d) * force + randomRange(-50, 50);
      p.settled = false;
    }
  }
}

function _updateExploding(state, input, dt) {
  let offScreenCount = 0;
  const w = state.canvasWidth;
  const h = state.canvasHeight;
  const margin = 100;

  for (const p of state.particles) {
    // Gravity
    p.vy += GRAVITY * dt;

    // Damping
    p.vx *= DAMPING;
    p.vy *= DAMPING;

    // Integrate
    p.x += p.vx * dt;
    p.y += p.vy * dt;

    // Fade out as they fly away
    const distFromCenter = dist(p.x, p.y, w / 2, h / 2);
    p.alpha = clamp(1 - distFromCenter / (Math.max(w, h) * 0.8), 0, 1);

    // Check if off-screen
    if (p.x < -margin || p.x > w + margin || p.y < -margin || p.y > h + margin) {
      offScreenCount++;
    }
  }

  // All particles off-screen → back to waiting
  if (offScreenCount >= state.particles.length * 0.95) {
    state.particles.length = 0;
    state.phase = PHASES.WAITING;
    state.waitCooldown = 1.5; // Wait before re-triggering
    state.detectionCount = 0;
  }
}
