export class CanvasManager {
  constructor(canvasElement) {
    this.canvas = canvasElement;
    this.ctx = this.canvas.getContext('2d');
    this._onResize = this._handleResize.bind(this);
    this._resizeCallback = null;
    window.addEventListener('resize', this._onResize);
    this._handleResize();
  }

  _handleResize() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
    if (this._resizeCallback) {
      this._resizeCallback(this.canvas.width, this.canvas.height);
    }
  }

  onResize(callback) {
    this._resizeCallback = callback;
  }

  get width() {
    return this.canvas.width;
  }

  get height() {
    return this.canvas.height;
  }

  clear(color = '#000') {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  fade(alpha = 0.05) {
    this.ctx.fillStyle = `rgba(0, 0, 0, ${alpha})`;
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  destroy() {
    window.removeEventListener('resize', this._onResize);
  }
}
