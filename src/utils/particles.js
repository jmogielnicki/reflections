/**
 * Object-pooled particle system.
 * Particles are pre-allocated and recycled to avoid GC pressure.
 */
export class ParticleSystem {
  constructor(maxCount) {
    this.max = maxCount;
    this.count = 0;

    // Parallel arrays for performance
    this.x = new Float32Array(maxCount);
    this.y = new Float32Array(maxCount);
    this.vx = new Float32Array(maxCount);
    this.vy = new Float32Array(maxCount);
    this.life = new Float32Array(maxCount);     // remaining life (seconds), -1 = immortal
    this.maxLife = new Float32Array(maxCount);
    this.size = new Float32Array(maxCount);
    this.r = new Uint8Array(maxCount);
    this.g = new Uint8Array(maxCount);
    this.b = new Uint8Array(maxCount);
    this.alpha = new Float32Array(maxCount);

    // Extra per-particle data slots for project-specific use
    this.data0 = new Float32Array(maxCount); // homeX / targetX
    this.data1 = new Float32Array(maxCount); // homeY / targetY
    this.data2 = new Float32Array(maxCount); // custom
    this.data3 = new Float32Array(maxCount); // custom
  }

  /** Emit a single particle. Returns index or -1 if pool is full. */
  emit(props) {
    if (this.count >= this.max) return -1;
    const i = this.count++;
    this.x[i] = props.x || 0;
    this.y[i] = props.y || 0;
    this.vx[i] = props.vx || 0;
    this.vy[i] = props.vy || 0;
    this.life[i] = props.life !== undefined ? props.life : -1;
    this.maxLife[i] = props.maxLife || props.life || 1;
    this.size[i] = props.size || 2;
    this.r[i] = props.r || 255;
    this.g[i] = props.g || 255;
    this.b[i] = props.b || 255;
    this.alpha[i] = props.alpha !== undefined ? props.alpha : 1;
    this.data0[i] = props.data0 || 0;
    this.data1[i] = props.data1 || 0;
    this.data2[i] = props.data2 || 0;
    this.data3[i] = props.data3 || 0;
    return i;
  }

  /** Update all particles: apply velocity, age, remove dead. */
  update(dt) {
    let i = 0;
    while (i < this.count) {
      // Age
      if (this.life[i] >= 0) {
        this.life[i] -= dt;
        if (this.life[i] <= 0) {
          this._remove(i);
          continue;
        }
      }

      // Velocity integration
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;

      i++;
    }
  }

  /** Apply a force function to all particles: fn(i, system) should modify vx/vy */
  applyForce(fn) {
    for (let i = 0; i < this.count; i++) {
      fn(i, this);
    }
  }

  /** Draw all particles to ctx using default circle renderer */
  draw(ctx) {
    for (let i = 0; i < this.count; i++) {
      const a = this.alpha[i] * (this.life[i] >= 0 ? this.life[i] / this.maxLife[i] : 1);
      if (a <= 0) continue;
      ctx.fillStyle = `rgba(${this.r[i]},${this.g[i]},${this.b[i]},${a})`;
      ctx.beginPath();
      ctx.arc(this.x[i], this.y[i], this.size[i], 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** Draw using a custom render function: fn(ctx, i, system) */
  drawCustom(ctx, fn) {
    for (let i = 0; i < this.count; i++) {
      fn(ctx, i, this);
    }
  }

  /** Remove particle at index by swapping with last */
  _remove(i) {
    const last = this.count - 1;
    if (i < last) {
      this.x[i] = this.x[last];
      this.y[i] = this.y[last];
      this.vx[i] = this.vx[last];
      this.vy[i] = this.vy[last];
      this.life[i] = this.life[last];
      this.maxLife[i] = this.maxLife[last];
      this.size[i] = this.size[last];
      this.r[i] = this.r[last];
      this.g[i] = this.g[last];
      this.b[i] = this.b[last];
      this.alpha[i] = this.alpha[last];
      this.data0[i] = this.data0[last];
      this.data1[i] = this.data1[last];
      this.data2[i] = this.data2[last];
      this.data3[i] = this.data3[last];
    }
    this.count--;
  }

  clear() {
    this.count = 0;
  }
}
