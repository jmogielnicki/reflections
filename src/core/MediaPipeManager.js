import { FilesetResolver, ImageSegmenter, PoseLandmarker, FaceLandmarker } from '@mediapipe/tasks-vision';

const CDN_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm';

export class MediaPipeManager {
  constructor() {
    this._vision = null;
    this._segmenter = null;
    this._poseLandmarker = null;
    this._faceLandmarker = null;
    this._activeCapabilities = [];
    this._lastResults = {};
  }

  async initialize(capabilities = []) {
    // Load WASM fileset once
    if (!this._vision) {
      this._vision = await FilesetResolver.forVisionTasks(CDN_BASE);
    }

    // Tear down tasks we no longer need
    for (const cap of this._activeCapabilities) {
      if (!capabilities.includes(cap)) {
        await this._teardownCapability(cap);
      }
    }

    // Initialize tasks we need
    for (const cap of capabilities) {
      if (!this._activeCapabilities.includes(cap)) {
        await this._initCapability(cap);
      }
    }

    this._activeCapabilities = [...capabilities];
  }

  async _initCapability(cap) {
    switch (cap) {
      case 'segmentation':
        this._segmenter = await ImageSegmenter.createFromOptions(this._vision, {
          baseOptions: {
            modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite',
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          // Confidence masks have unambiguous semantics (per-pixel person
          // probability); category mask values are inconsistent across
          // devices/delegates (see mediapipe#4723, #6155).
          outputCategoryMask: false,
          outputConfidenceMasks: true,
        });
        break;

      case 'pose':
        this._poseLandmarker = await PoseLandmarker.createFromOptions(this._vision, {
          baseOptions: {
            modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task',
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numPoses: 1,
        });
        break;

      case 'face':
        this._faceLandmarker = await FaceLandmarker.createFromOptions(this._vision, {
          baseOptions: {
            modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task',
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numFaces: 1,
          outputFaceBlendshapes: true,
        });
        break;
    }
  }

  async _teardownCapability(cap) {
    switch (cap) {
      case 'segmentation':
        if (this._segmenter) { this._segmenter.close(); this._segmenter = null; }
        break;
      case 'pose':
        if (this._poseLandmarker) { this._poseLandmarker.close(); this._poseLandmarker = null; }
        break;
      case 'face':
        if (this._faceLandmarker) { this._faceLandmarker.close(); this._faceLandmarker = null; }
        break;
    }
  }

  /**
   * Run detection on the current video frame.
   * Returns an object with results for each active capability.
   */
  detect(video, timestampMs) {
    if (!video || video.readyState < 2) return null;

    const results = {};

    if (this._segmenter) {
      try {
        const segResult = this._segmenter.segmentForVideo(video, timestampMs);
        const confidenceMasks = segResult && segResult.confidenceMasks;
        if (confidenceMasks && confidenceMasks.length > 0) {
          // Selfie segmenter labels are [background, person]; person is last
          results.segmentation = {
            mask: confidenceMasks[confidenceMasks.length - 1],
            width: video.videoWidth,
            height: video.videoHeight,
          };
        }
      } catch (e) {
        // Skip frame on error
      }
    }

    if (this._poseLandmarker) {
      try {
        const poseResult = this._poseLandmarker.detectForVideo(video, timestampMs);
        if (poseResult) {
          results.pose = {
            landmarks: poseResult.landmarks,
            worldLandmarks: poseResult.worldLandmarks,
          };
        }
      } catch (e) {
        // Skip frame on error
      }
    }

    if (this._faceLandmarker) {
      try {
        const faceResult = this._faceLandmarker.detectForVideo(video, timestampMs);
        if (faceResult) {
          results.face = {
            landmarks: faceResult.faceLandmarks,
            blendshapes: faceResult.faceBlendshapes,
          };
        }
      } catch (e) {
        // Skip frame on error
      }
    }

    this._lastResults = results;
    return results;
  }

  teardown() {
    if (this._segmenter) { this._segmenter.close(); this._segmenter = null; }
    if (this._poseLandmarker) { this._poseLandmarker.close(); this._poseLandmarker = null; }
    if (this._faceLandmarker) { this._faceLandmarker.close(); this._faceLandmarker = null; }
    this._activeCapabilities = [];
  }
}
