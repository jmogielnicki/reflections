import { getBrightnessGrid } from '../utils/pixels.js';

export class InputState {
  constructor(webcamManager, canvasManager) {
    this._webcam = webcamManager;
    this._canvas = canvasManager;
    this._frameId = 0;
    this._brightnessGrid = null;
    this._pixelData = null;

    // Time
    this.time = { delta: 0, elapsed: 0, frame: 0 };

    // Canvas dimensions
    this.canvas = { width: 0, height: 0 };

    // MediaPipe results (populated by MediaPipeManager)
    this.pose = null;
    this.face = null;
    this.segmentation = null;

    // Derived values
    this.derived = {
      isPersonPresent: false,
      bodyCenter: null,
      horizontalPosition: 0.5,
      smileAmount: 0,
    };
  }

  /** Call once per frame to update time and invalidate caches */
  update(delta, elapsed, frameId) {
    this._frameId = frameId;
    this._brightnessGrid = null;
    this._pixelData = null;
    this.time.delta = delta;
    this.time.elapsed = elapsed;
    this.time.frame = frameId;
    this.canvas.width = this._canvas.width;
    this.canvas.height = this._canvas.height;
  }

  /** Lazy pixel data - only extracted when accessed */
  getPixelData() {
    if (!this._pixelData) {
      this._pixelData = this._webcam.getPixelData(this._frameId);
    }
    return this._pixelData;
  }

  /** Lazy brightness grid - downsampled for performance */
  getBrightnessGrid(cols = 80, rows = 60) {
    if (!this._brightnessGrid) {
      const pixels = this.getPixelData();
      this._brightnessGrid = getBrightnessGrid(pixels, cols, rows);
    }
    return this._brightnessGrid;
  }

  getVideoElement() {
    return this._webcam.getVideo();
  }

  getWebcamDimensions() {
    return { width: this._webcam.width, height: this._webcam.height };
  }
}
