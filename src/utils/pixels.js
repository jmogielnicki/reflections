/**
 * Compute a downsampled brightness grid from ImageData.
 * Returns { cells: Float32Array, cols, rows, cellWidth, cellHeight }
 */
export function getBrightnessGrid(imageData, cols = 80, rows = 60) {
  const { data, width, height } = imageData;
  const cellWidth = width / cols;
  const cellHeight = height / rows;
  const cells = new Float32Array(cols * rows);

  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      // Sample the center pixel of each cell
      const px = Math.floor(gx * cellWidth + cellWidth / 2);
      const py = Math.floor(gy * cellHeight + cellHeight / 2);
      const i = (py * width + px) * 4;
      // Luminance formula
      const brightness = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255;
      cells[gy * cols + gx] = brightness;
    }
  }

  return { cells, cols, rows, cellWidth, cellHeight };
}

/** Get pixel color at (x, y) from ImageData */
export function getPixelColor(imageData, x, y) {
  const i = (Math.floor(y) * imageData.width + Math.floor(x)) * 4;
  return [
    imageData.data[i],
    imageData.data[i + 1],
    imageData.data[i + 2],
    imageData.data[i + 3],
  ];
}

/** Get brightness (0-1) at (x, y) */
export function getPixelBrightness(imageData, x, y) {
  const i = (Math.floor(y) * imageData.width + Math.floor(x)) * 4;
  return (imageData.data[i] * 0.299 + imageData.data[i + 1] * 0.587 + imageData.data[i + 2] * 0.114) / 255;
}

/** Sample the brightness from a grid at a canvas position */
export function sampleGrid(grid, canvasX, canvasY, canvasWidth, canvasHeight) {
  const gx = Math.floor((canvasX / canvasWidth) * grid.cols);
  const gy = Math.floor((canvasY / canvasHeight) * grid.rows);
  const clampedX = Math.max(0, Math.min(grid.cols - 1, gx));
  const clampedY = Math.max(0, Math.min(grid.rows - 1, gy));
  return grid.cells[clampedY * grid.cols + clampedX];
}
