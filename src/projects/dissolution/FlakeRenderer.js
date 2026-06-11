/**
 * WebGL2 point-sprite renderer for dissolution flakes.
 *
 * The 2D canvas keeps drawing the background and the frozen (unreleased)
 * part of the image; this renderer draws the released flakes on a
 * transparent overlay canvas stacked on top of it. Each flake is a point
 * sprite whose fragment shader samples the flake's own little rectangle of
 * the frozen image, so the image itself drifts apart. Per-frame CPU work is
 * just packing position/alpha/scale into a buffer, which keeps 100k+
 * particles smooth.
 *
 * create() returns null when WebGL2 isn't available; callers fall back to
 * the canvas-2D path.
 */

const VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aSrcCenter;  // static: center of the flake's home rect (px)
layout(location = 1) in float aCellPx;    // static: flake edge length (px)
layout(location = 2) in vec2 aPos;        // dynamic: current center (px)
layout(location = 3) in float aAlpha;     // dynamic
layout(location = 4) in float aScale;     // dynamic
uniform vec2 uResolution;
out vec2 vSrcCenter;
out float vCellPx;
out float vAlpha;
void main() {
  vec2 clip = vec2(aPos.x / uResolution.x * 2.0 - 1.0, 1.0 - aPos.y / uResolution.y * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
  gl_PointSize = aCellPx * aScale;
  vSrcCenter = aSrcCenter;
  vCellPx = aCellPx;
  vAlpha = aAlpha;
}`;

const FRAG = `#version 300 es
precision highp float;
uniform sampler2D uImage;
uniform vec2 uTexSize;
in vec2 vSrcCenter;
in float vCellPx;
in float vAlpha;
out vec4 outColor;
void main() {
  vec2 src = vSrcCenter + (gl_PointCoord - 0.5) * vCellPx;
  vec4 tex = texture(uImage, src / uTexSize);
  outColor = tex * vAlpha; // premultiplied alpha
}`;

export class FlakeRenderer {
  static create(mainCanvas) {
    const glCanvas = document.createElement('canvas');
    const gl = glCanvas.getContext('webgl2', { alpha: true, depth: false, antialias: false });
    if (!gl) return null;
    try {
      return new FlakeRenderer(mainCanvas, glCanvas, gl);
    } catch (e) {
      console.warn('FlakeRenderer init failed, falling back to 2D:', e);
      return null;
    }
  }

  constructor(mainCanvas, glCanvas, gl) {
    this._main = mainCanvas;
    this._canvas = glCanvas;
    this._gl = gl;
    this._count = 0;
    this._dyn = null;

    // Overlay the main canvas inside #project-container; below the UI
    // chrome (which uses z-index), above the 2D canvas (DOM order)
    glCanvas.style.position = 'absolute';
    glCanvas.style.inset = '0';
    glCanvas.style.width = '100%';
    glCanvas.style.height = '100%';
    glCanvas.style.pointerEvents = 'none';
    mainCanvas.parentElement.insertBefore(glCanvas, mainCanvas.nextSibling);

    this._program = this._buildProgram(VERT, FRAG);
    this._uResolution = gl.getUniformLocation(this._program, 'uResolution');
    this._uTexSize = gl.getUniformLocation(this._program, 'uTexSize');
    this._uImage = gl.getUniformLocation(this._program, 'uImage');

    this._tex = gl.createTexture();
    this._staticBuf = gl.createBuffer();
    this._dynBuf = gl.createBuffer();

    this._vao = gl.createVertexArray();
    gl.bindVertexArray(this._vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this._staticBuf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 12, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 12, 8);
    gl.bindBuffer(gl.ARRAY_BUFFER, this._dynBuf);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, 16, 8);
    gl.enableVertexAttribArray(4);
    gl.vertexAttribPointer(4, 1, gl.FLOAT, false, 16, 12);
    gl.bindVertexArray(null);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    this.resize();
  }

  _buildProgram(vertSrc, fragSrc) {
    const gl = this._gl;
    const compile = (type, src) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, src);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(shader));
      }
      return shader;
    };
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vertSrc));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragSrc));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program));
    }
    return program;
  }

  resize() {
    this._canvas.width = this._main.width;
    this._canvas.height = this._main.height;
    this._gl.viewport(0, 0, this._canvas.width, this._canvas.height);
  }

  /** Upload the frozen image and per-flake static attributes; clears the overlay */
  begin(sourceCanvas, particles) {
    const gl = this._gl;
    const n = particles.length;
    this._count = n;

    gl.bindTexture(gl.TEXTURE_2D, this._tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sourceCanvas);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const stat = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const p = particles[i];
      stat[i * 3] = p.srcX + p.rectW / 2;
      stat[i * 3 + 1] = p.srcY + p.rectH / 2;
      stat[i * 3 + 2] = p.cellPx;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this._staticBuf);
    gl.bufferData(gl.ARRAY_BUFFER, stat, gl.STATIC_DRAW);

    this._dyn = new Float32Array(n * 4);
    gl.bindBuffer(gl.ARRAY_BUFFER, this._dynBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this._dyn.byteLength, gl.DYNAMIC_DRAW);

    gl.useProgram(this._program);
    gl.uniform2f(this._uTexSize, sourceCanvas.width, sourceCanvas.height);
    gl.uniform1i(this._uImage, 0);

    this.clear();
  }

  /** Draw flakes [first, end) — must match the order passed to begin() */
  draw(particles, first, end) {
    const gl = this._gl;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (end <= first || !this._dyn) return;

    const dyn = this._dyn;
    for (let i = first; i < end; i++) {
      const p = particles[i];
      const o = i * 4;
      dyn[o] = p.x;
      dyn[o + 1] = p.y;
      dyn[o + 2] = p.dead ? 0 : p.alpha;
      dyn[o + 3] = p.scale;
    }

    gl.useProgram(this._program);
    gl.bindVertexArray(this._vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this._dynBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, first * 16, dyn, first * 4, (end - first) * 4);
    gl.uniform2f(this._uResolution, this._canvas.width, this._canvas.height);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._tex);
    gl.drawArrays(gl.POINTS, first, end - first);
    gl.bindVertexArray(null);
  }

  clear() {
    const gl = this._gl;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  destroy() {
    const ext = this._gl.getExtension('WEBGL_lose_context');
    if (ext) ext.loseContext();
    this._canvas.remove();
  }
}
