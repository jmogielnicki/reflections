export class WebcamManager {
  constructor() {
    this.video = document.createElement('video');
    this.video.setAttribute('playsinline', '');
    this.video.setAttribute('autoplay', '');
    this.stream = null;
    this.ready = false;

    // Off-screen canvas for pixel extraction
    this._extractCanvas = null;
    this._extractCtx = null;
    this._cachedFrame = null;
    this._cachedFrameId = -1;
  }

  async start(width = 640, height = 480) {
    const constraints = {
      video: {
        width: { ideal: width },
        height: { ideal: height },
        facingMode: 'user',
      },
      audio: false,
    };

    this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    this.video.srcObject = this.stream;
    await this.video.play();

    // Wait for video dimensions to be known
    await new Promise((resolve) => {
      if (this.video.videoWidth > 0) return resolve();
      this.video.addEventListener('loadeddata', resolve, { once: true });
    });

    this._extractCanvas = new OffscreenCanvas(this.video.videoWidth, this.video.videoHeight);
    this._extractCtx = this._extractCanvas.getContext('2d', { willReadFrequently: true });
    this.ready = true;
  }

  get width() {
    return this.video.videoWidth;
  }

  get height() {
    return this.video.videoHeight;
  }

  getVideo() {
    return this.video;
  }

  /** Get pixel data for the current frame (cached per frameId). Mirrored horizontally. */
  getPixelData(frameId) {
    if (this._cachedFrameId === frameId && this._cachedFrame) {
      return this._cachedFrame;
    }
    const w = this.video.videoWidth;
    const h = this.video.videoHeight;
    const ctx = this._extractCtx;

    // Draw mirrored
    ctx.save();
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(this.video, 0, 0, w, h);
    ctx.restore();

    this._cachedFrame = ctx.getImageData(0, 0, w, h);
    this._cachedFrameId = frameId;
    return this._cachedFrame;
  }

  stop() {
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    this.ready = false;
  }
}
