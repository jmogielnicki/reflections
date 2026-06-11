import { lerp, clamp, dist } from '../../utils/math.js';
import { hslToRgb, rgbString } from '../../utils/color.js';
import { noise2D } from '../../utils/noise.js';

// Key face landmark indices for a sparser anchor set
// Using a subset avoids 468-point brute force per node per frame
const FACE_ANCHORS = [
  // Forehead / top
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288,
  // Eyebrows
  70, 63, 105, 66, 107, 336, 296, 334, 293, 300,
  // Eyes
  33, 133, 160, 159, 145, 153, 362, 263, 387, 386, 374, 380,
  // Nose
  1, 2, 98, 327, 168,
  // Cheeks
  93, 132, 58, 172, 136, 150, 176, 148,
  323, 361, 288, 397, 365, 379, 400, 377,
  // Lips
  61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291,
  78, 95, 88, 178, 87, 14, 317, 402, 318, 324,
  // Jaw line
  234, 127, 162, 21, 54, 103, 67, 109, 10,
  454, 356, 389, 251, 284, 332, 297, 338,
  152, 148, 176, 149, 150, 136, 172, 58, 132,
  377, 400, 378, 379, 365, 397, 288, 361, 323,
];

// Deduplicate
const ANCHOR_SET = [...new Set(FACE_ANCHORS)];

export default {
  id: 'spider-web',
  name: 'Spider Web',
  description: 'A net of threads stretches across the screen. Move your face and the web clings to it like a spider\'s trap.',
  mediapipe: ['face'],
  params: {
    cols:            { value: 28,    min: 8,    max: 50,    step: 1,     label: 'Grid Columns' },
    rows:            { value: 20,    min: 6,    max: 36,    step: 1,     label: 'Grid Rows' },
    catchRadius:     { value: 0.08,  min: 0.02, max: 0.2,   step: 0.01,  label: 'Catch Radius' },
    pullStrength:    { value: 0.15,  min: 0.02, max: 0.5,   step: 0.01,  label: 'Pull Strength' },
    springBack:      { value: 0.03,  min: 0.005,max: 0.15,  step: 0.005, label: 'Spring Back' },
    damping:         { value: 0.88,  min: 0.7,  max: 0.98,  step: 0.01,  label: 'Damping' },
    edgeOpacity:     { value: 0.6,   min: 0.1,  max: 1.0,   step: 0.05,  label: 'Edge Opacity' },
    nodeSize:        { value: 2,     min: 0.5,  max: 5,     step: 0.5,   label: 'Node Size' },
    baseHue:         { value: 220,   min: 0,    max: 360,   step: 5,     label: 'Base Hue' },
    stretchColor:    { value: 0,     min: 0,    max: 360,   step: 5,     label: 'Stretch Hue' },
    idleSway:        { value: 3,     min: 0,    max: 15,    step: 0.5,   label: 'Idle Sway' },
    diagonals:       { value: 1,     min: 0,    max: 1,     step: 1,     label: 'Diagonals (0/1)' },
  },
  presets: [
    {
      name: 'Tight Weave',
      values: { cols: 40, rows: 28, catchRadius: 0.06, pullStrength: 0.3, springBack: 0.01, nodeSize: 1.5, diagonals: 1 },
    },
    {
      name: 'Loose Net',
      values: { cols: 16, rows: 12, catchRadius: 0.15, pullStrength: 0.08, springBack: 0.06, nodeSize: 3, edgeOpacity: 0.4, diagonals: 0 },
    },
    {
      name: 'Sticky Trap',
      values: { cols: 28, rows: 20, catchRadius: 0.12, pullStrength: 0.4, springBack: 0.008, damping: 0.92, baseHue: 280, stretchColor: 340 },
    },
  ],

  init(ctx, canvas) {
    return {
      nodes: [],
      edges: [],
      needsRebuild: true,
      prevCols: 0,
      prevRows: 0,
      prevDiagonals: -1,
    };
  },

  update(state, input, dt) {
    const P = state.params;
    const w = input.canvas.width;
    const h = input.canvas.height;
    const elapsed = input.time.elapsed;

    // Rebuild grid if params changed
    const cols = Math.round(P.cols);
    const rows = Math.round(P.rows);
    const diags = Math.round(P.diagonals);
    if (state.needsRebuild || cols !== state.prevCols || rows !== state.prevRows || diags !== state.prevDiagonals) {
      _buildGrid(state, cols, rows, diags, w, h);
      state.prevCols = cols;
      state.prevRows = rows;
      state.prevDiagonals = diags;
      state.needsRebuild = false;
    }

    // Get face landmarks (mirrored to canvas coords)
    let anchors = null;
    if (input.face && input.face.landmarks && input.face.landmarks.length > 0) {
      const raw = input.face.landmarks[0];
      anchors = [];
      for (const idx of ANCHOR_SET) {
        if (idx < raw.length) {
          anchors.push({
            x: (1 - raw[idx].x) * w,
            y: raw[idx].y * h,
          });
        }
      }
    }

    const catchPx = P.catchRadius * Math.max(w, h);

    // Physics update
    for (const node of state.nodes) {
      let fx = 0, fy = 0;

      // If face detected, find closest anchor
      if (anchors) {
        let minDist = Infinity;
        let closestAnchor = null;

        for (const a of anchors) {
          const d = dist(node.homeX, node.homeY, a.x, a.y);
          if (d < minDist) {
            minDist = d;
            closestAnchor = a;
          }
        }

        if (closestAnchor && minDist < catchPx) {
          // Pull toward anchor — strength fades with distance
          const strength = P.pullStrength * (1 - minDist / catchPx);
          fx += (closestAnchor.x - node.x) * strength;
          fy += (closestAnchor.y - node.y) * strength;
          node.caught = clamp(node.caught + dt * 4, 0, 1);
        } else {
          node.caught = clamp(node.caught - dt * 2, 0, 1);
        }
      } else {
        node.caught = clamp(node.caught - dt * 2, 0, 1);
      }

      // Spring back toward home
      fx += (node.homeX - node.x) * P.springBack;
      fy += (node.homeY - node.y) * P.springBack;

      // Idle sway (subtle noise-based movement)
      if (P.idleSway > 0) {
        const swayX = noise2D(node.homeX * 0.003 + elapsed * 0.4, node.homeY * 0.003) * P.idleSway;
        const swayY = noise2D(node.homeX * 0.003 + 100, node.homeY * 0.003 + elapsed * 0.4) * P.idleSway;
        fx += (node.homeX + swayX - node.x) * 0.02;
        fy += (node.homeY + swayY - node.y) * 0.02;
      }

      // Integrate
      node.vx = (node.vx + fx) * P.damping;
      node.vy = (node.vy + fy) * P.damping;
      node.x += node.vx;
      node.y += node.vy;

      // Track stretch amount for coloring
      node.stretch = dist(node.x, node.y, node.homeX, node.homeY) / catchPx;
    }
  },

  render(state, input, ctx, canvas) {
    const P = state.params;
    const w = canvas.width;
    const h = canvas.height;

    // Dark background
    ctx.fillStyle = 'rgb(8, 8, 12)';
    ctx.fillRect(0, 0, w, h);

    // Draw edges
    for (const edge of state.edges) {
      const a = state.nodes[edge[0]];
      const b = state.nodes[edge[1]];

      const avgStretch = (a.stretch + b.stretch) / 2;
      const avgCaught = (a.caught + b.caught) / 2;

      // Color: base hue when relaxed, stretch hue when pulled
      const hue = lerp(P.baseHue, P.stretchColor, clamp(avgStretch, 0, 1));
      const sat = lerp(0.3, 0.9, clamp(avgCaught, 0, 1));
      const light = lerp(0.35, 0.65, clamp(avgStretch * 0.5, 0, 1));
      const alpha = P.edgeOpacity * lerp(0.4, 1.0, clamp(avgCaught + 0.3, 0, 1));

      const [r, g, b_] = hslToRgb(hue, sat, light);
      ctx.strokeStyle = rgbString(r, g, b_, alpha);
      ctx.lineWidth = lerp(0.5, 1.5, clamp(avgStretch, 0, 1));

      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    // Draw nodes
    for (const node of state.nodes) {
      const hue = lerp(P.baseHue, P.stretchColor, clamp(node.stretch, 0, 1));
      const sat = lerp(0.3, 1.0, clamp(node.caught, 0, 1));
      const light = lerp(0.5, 0.8, clamp(node.stretch * 0.5, 0, 1));
      const alpha = lerp(0.5, 1.0, clamp(node.caught + 0.3, 0, 1));

      const [r, g, b_] = hslToRgb(hue, sat, light);
      ctx.fillStyle = rgbString(r, g, b_, alpha);
      ctx.beginPath();
      const size = P.nodeSize * (1 + node.caught * 0.5);
      ctx.arc(node.x, node.y, size, 0, Math.PI * 2);
      ctx.fill();
    }
  },

  resize(state, width, height) {
    state.needsRebuild = true;
  },

  cleanup(state) {
    state.nodes.length = 0;
    state.edges.length = 0;
  },
};

function _buildGrid(state, cols, rows, diagonals, w, h) {
  state.nodes = [];
  state.edges = [];

  // Margins so the grid doesn't sit right at the edge
  const marginX = w * 0.05;
  const marginY = h * 0.05;
  const innerW = w - marginX * 2;
  const innerH = h - marginY * 2;

  // Create nodes
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      const x = marginX + (c / cols) * innerW;
      const y = marginY + (r / rows) * innerH;
      state.nodes.push({
        x, y,
        homeX: x,
        homeY: y,
        vx: 0, vy: 0,
        caught: 0,
        stretch: 0,
      });
    }
  }

  const stride = cols + 1;

  // Create edges (horizontal + vertical + optional diagonals)
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      const idx = r * stride + c;

      // Horizontal
      if (c < cols) {
        state.edges.push([idx, idx + 1]);
      }
      // Vertical
      if (r < rows) {
        state.edges.push([idx, idx + stride]);
      }
      // Diagonals
      if (diagonals) {
        if (c < cols && r < rows) {
          state.edges.push([idx, idx + stride + 1]);
        }
        if (c > 0 && r < rows) {
          state.edges.push([idx, idx + stride - 1]);
        }
      }
    }
  }
}
