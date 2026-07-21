import { describe, expect, it } from 'vitest';
import { runSegmentFill } from '../segmentFillRun.js';

/** Same fixture helpers as algorithms/__tests__/segmentFillAndGridRemoval.test.ts. */
function makeImage(width: number, height: number, bg: [number, number, number]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = bg[0];
    data[i + 1] = bg[1];
    data[i + 2] = bg[2];
    data[i + 3] = 255;
  }
  return data;
}

function setPixel(data: Uint8ClampedArray, width: number, x: number, y: number, rgb: [number, number, number]): void {
  const i = (y * width + x) * 4;
  data[i] = rgb[0];
  data[i + 1] = rgb[1];
  data[i + 2] = rgb[2];
  data[i + 3] = 255;
}

describe('runSegmentFill', () => {
  it('traces a connected horizontal line into an ordered point list', () => {
    const width = 20;
    const height = 3;
    const data = makeImage(width, height, [255, 255, 255]);
    for (let x = 0; x < width; x++) setPixel(data, width, x, 1, [0, 0, 0]);

    const result = runSegmentFill(data, width, height, 5, 1, 10);
    if ('error' in result) throw new Error(`unexpected error: ${result.error}`);
    expect(result.filled).toBe(width);
    expect(result.points).toHaveLength(width);
    expect(result.points.every((p) => p.y === 1)).toBe(true);
    expect(result.points[0]).toEqual({ x: 0, y: 1 });
  });

  it('clamps an out-of-bounds seed to the image edge instead of reading garbage', () => {
    const width = 10;
    const height = 3;
    const data = makeImage(width, height, [255, 255, 255]);
    for (let x = 0; x < width; x++) setPixel(data, width, x, 1, [0, 0, 0]);

    // Seed far outside the image on every axis -- should clamp to (9, 1) or
    // similar and still find the line, rather than throwing or silently
    // reading out-of-bounds array indices.
    const result = runSegmentFill(data, width, height, 999, -50, 10);
    if ('error' in result) throw new Error(`unexpected error: ${result.error}`);
    expect(result.filled).toBe(width);
  });

  it('reports a clear error instead of adding a near-empty trace when nothing matches at the seed', () => {
    const width = 10;
    const height = 10;
    const data = makeImage(width, height, [255, 255, 255]); // uniform, no curve at all
    setPixel(data, width, 5, 5, [0, 0, 0]); // one isolated dark pixel, below the 3-pixel floor

    const result = runSegmentFill(data, width, height, 5, 5, 10);
    expect(result).toEqual({ error: expect.stringContaining('No curve found') });
  });

  it('subsamples a large fill down to maxPoints, evenly spaced', () => {
    const width = 1000;
    const height = 3;
    const data = makeImage(width, height, [255, 255, 255]);
    for (let x = 0; x < width; x++) setPixel(data, width, x, 1, [0, 0, 0]);

    const result = runSegmentFill(data, width, height, 500, 1, 10, 50);
    if ('error' in result) throw new Error(`unexpected error: ${result.error}`);
    expect(result.filled).toBe(width); // raw fill count is unaffected by subsampling
    expect(result.points).toHaveLength(50);
  });

  it('respects the color-distance threshold, not crossing into a differently-colored region', () => {
    const width = 10;
    const height = 1;
    const data = makeImage(width, height, [255, 255, 255]);
    for (let x = 0; x < 5; x++) setPixel(data, width, x, 0, [0, 0, 0]); // black, x=0..4
    for (let x = 5; x < 10; x++) setPixel(data, width, x, 0, [255, 0, 0]); // red, x=5..9

    const result = runSegmentFill(data, width, height, 2, 0, 10); // seed in the black segment
    if ('error' in result) throw new Error(`unexpected error: ${result.error}`);
    expect(result.filled).toBe(5); // stops at the black/red boundary
  });
});
