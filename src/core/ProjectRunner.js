import { WebcamManager } from './WebcamManager.js';
import { CanvasManager } from './CanvasManager.js';
import { InputState } from './InputState.js';

export class ProjectRunner {
  constructor(canvasElement) {
    this.webcam = new WebcamManager();
    this.canvasManager = new CanvasManager(canvasElement);
    this.input = new InputState(this.webcam, this.canvasManager);
    this.mediaPipeManager = null;

    this._project = null;
    this._projectState = null;
    this._running = false;
    this._rafId = null;
    this._startTime = 0;
    this._lastTime = 0;
    this._frameId = 0;

    // FPS tracking
    this._fpsFrames = 0;
    this._fpsTime = 0;
    this.fps = 0;

    this.canvasManager.onResize((w, h) => {
      if (this._project && this._project.resize && this._projectState) {
        this._project.resize(this._projectState, w, h);
      }
    });
  }

  async setMediaPipeManager(manager) {
    this.mediaPipeManager = manager;
  }

  async loadProject(project) {
    // Cleanup previous
    if (this._project && this._project.cleanup && this._projectState) {
      this._project.cleanup(this._projectState);
    }

    this._project = project;
    this._projectState = null;
    this._frameId = 0;

    // Initialize MediaPipe if project needs it
    if (this.mediaPipeManager && project.mediapipe && project.mediapipe.length > 0) {
      await this.mediaPipeManager.initialize(project.mediapipe);
    }

    // Start webcam if not already running
    if (!this.webcam.ready) {
      await this.webcam.start();
    }

    // Warn if project is missing params
    if (!project.params) {
      console.warn(`[Reflections] Project "${project.id}" is missing a params definition. All projects should declare debug params.`);
    }

    // Initialize project
    const ctx = this.canvasManager.ctx;
    const canvas = this.canvasManager.canvas;
    this._projectState = project.init(ctx, canvas);

    // Extract default param values into state.params
    if (project.params) {
      this._projectState.params = {};
      for (const [key, desc] of Object.entries(project.params)) {
        this._projectState.params[key] = desc.value;
      }
    }

    if (project.resize) {
      project.resize(this._projectState, canvas.width, canvas.height);
    }
  }

  /** Re-initialize the active project from scratch, preserving live params */
  restartProject() {
    if (!this._project || !this._projectState) return;

    if (this._project.cleanup) {
      this._project.cleanup(this._projectState);
    }

    const canvas = this.canvasManager.canvas;
    // Reuse the same params object: the DebugPanel holds a reference to it
    const params = this._projectState.params;
    this._projectState = this._project.init(this.canvasManager.ctx, canvas);
    if (params) {
      this._projectState.params = params;
    }

    if (this._project.resize) {
      this._project.resize(this._projectState, canvas.width, canvas.height);
    }
  }

  /** Get the active project's param descriptors (for DebugPanel) */
  getParamDescriptors() {
    return this._project ? this._project.params : null;
  }

  /** Get the live state.params object (for DebugPanel to mutate) */
  getStateParams() {
    return this._projectState ? this._projectState.params : null;
  }

  /** Get the active project's name */
  getProjectName() {
    return this._project ? this._project.name : '';
  }

  /** Get the active project's presets */
  getProjectPresets() {
    return this._project ? (this._project.presets || []) : [];
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._startTime = performance.now() / 1000;
    this._lastTime = this._startTime;
    this._fpsTime = this._startTime;
    this._fpsFrames = 0;
    this._loop();
  }

  stop() {
    this._running = false;
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  destroy() {
    this.stop();
    if (this._project && this._project.cleanup && this._projectState) {
      this._project.cleanup(this._projectState);
    }
    this._project = null;
    this._projectState = null;
    this.webcam.stop();
    this.canvasManager.destroy();
    if (this.mediaPipeManager) {
      this.mediaPipeManager.teardown();
    }
  }

  _loop() {
    if (!this._running) return;
    this._rafId = requestAnimationFrame(() => this._loop());

    const now = performance.now() / 1000;
    const delta = Math.min(now - this._lastTime, 0.1); // Cap at 100ms
    const elapsed = now - this._startTime;
    this._lastTime = now;
    this._frameId++;

    // FPS
    this._fpsFrames++;
    if (now - this._fpsTime >= 1) {
      this.fps = this._fpsFrames;
      this._fpsFrames = 0;
      this._fpsTime = now;
    }

    // Update input state
    this.input.update(delta, elapsed, this._frameId);

    // Run MediaPipe if available and project needs it
    if (this.mediaPipeManager && this._project.mediapipe && this._project.mediapipe.length > 0) {
      const results = this.mediaPipeManager.detect(this.webcam.getVideo(), now * 1000);
      if (results) {
        this.input.pose = results.pose || null;
        this.input.face = results.face || null;
        this.input.segmentation = results.segmentation || null;
        // Update derived values
        if (results.pose && results.pose.landmarks && results.pose.landmarks.length > 0) {
          const landmarks = results.pose.landmarks[0];
          this.input.derived.isPersonPresent = true;
          // Nose landmark (index 0) for horizontal position
          this.input.derived.horizontalPosition = 1 - landmarks[0].x; // Mirrored
          // Body center from hip midpoint
          const lHip = landmarks[23];
          const rHip = landmarks[24];
          if (lHip && rHip) {
            this.input.derived.bodyCenter = {
              x: 1 - (lHip.x + rHip.x) / 2,
              y: (lHip.y + rHip.y) / 2,
            };
          }
        } else {
          this.input.derived.isPersonPresent = false;
        }
      }
    }

    // Update and render project
    if (this._project && this._projectState) {
      const ctx = this.canvasManager.ctx;
      const canvas = this.canvasManager.canvas;
      this._project.update(this._projectState, this.input, delta);
      this._project.render(this._projectState, this.input, ctx, canvas);
    }
  }
}
