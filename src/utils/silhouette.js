/**
 * Extract a binary mask from MediaPipe segmentation result.
 * The categoryMask from selfie_segmenter uses value > 0 for person pixels.
 * Returns a Uint8Array where 1 = person, 0 = background.
 */
export function extractMask(segmentationResult) {
  const mask = segmentationResult.mask;
  const width = segmentationResult.width;
  const height = segmentationResult.height;

  // The mask may be an MPMask object; get the underlying data
  let maskData;
  if (mask.getAsUint8Array) {
    maskData = mask.getAsUint8Array();
  } else if (mask.getAsFloat32Array) {
    const floats = mask.getAsFloat32Array();
    maskData = new Uint8Array(floats.length);
    for (let i = 0; i < floats.length; i++) {
      maskData[i] = floats[i] > 0.5 ? 1 : 0;
    }
  } else if (mask instanceof Uint8Array) {
    maskData = mask;
  } else {
    // Try to use it directly
    maskData = new Uint8Array(width * height);
  }

  return { data: maskData, width, height };
}

/**
 * Check if a pixel is inside the silhouette mask.
 * Coordinates are in mask space (not canvas space).
 */
export function isInsideMask(maskResult, x, y) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  if (ix < 0 || ix >= maskResult.width || iy < 0 || iy >= maskResult.height) return false;
  return maskResult.data[iy * maskResult.width + ix] > 0;
}

/**
 * Compute center of mass of the mask.
 * Returns { x, y } in normalized coordinates (0-1), or null if no person.
 */
export function getCenterOfMass(maskResult) {
  let sumX = 0, sumY = 0, count = 0;
  const { data, width, height } = maskResult;

  // Sample every 4th pixel for speed
  for (let y = 0; y < height; y += 4) {
    for (let x = 0; x < width; x += 4) {
      if (data[y * width + x] > 0) {
        sumX += x;
        sumY += y;
        count++;
      }
    }
  }

  if (count === 0) return null;
  return {
    x: (sumX / count) / width,
    y: (sumY / count) / height,
  };
}

/**
 * Get all pixel positions that are inside the mask.
 * Returns array of { x, y } in mask coordinates.
 * Optionally downsample by step for performance.
 */
export function getMaskPixels(maskResult, step = 1) {
  const { data, width, height } = maskResult;
  const pixels = [];

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      if (data[y * width + x] > 0) {
        pixels.push({ x, y });
      }
    }
  }

  return pixels;
}

/**
 * Get the bounding box of the silhouette in mask coordinates.
 */
export function getMaskBounds(maskResult) {
  const { data, width, height } = maskResult;
  let minX = width, minY = height, maxX = 0, maxY = 0;
  let found = false;

  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      if (data[y * width + x] > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        found = true;
      }
    }
  }

  if (!found) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
