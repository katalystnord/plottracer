import { describe, it, expect } from 'vitest';
import { runBarDetect } from '../barDetectRun.js';

/** A width×height RGBA image, solid white and opaque. */
function whiteImage(width: number, height: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255;
    data[i + 1] = 255;
    data[i + 2] = 255;
    data[i + 3] = 255;
  }
  return data;
}

function fillBlock(data: Uint8ClampedArray, width: number, x0: number, y0: number, w: number, h: number, rgb: [number, number, number]) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const i = (y * width + x) * 4;
      data[i] = rgb[0];
      data[i + 1] = rgb[1];
      data[i + 2] = rgb[2];
      data[i + 3] = 255;
    }
  }
}

const BLUE: [number, number, number] = [30, 60, 220];

describe('runBarDetect', () => {
  it('returns one opposite-corner box per bar of the target colour, at its TRUE extent (not a centroid)', () => {
    const w = 40, h = 40;
    const img = whiteImage(w, h);
    // Two bars: a tall one at x=[4,8), y=[10,30), and a short one at x=[20,26), y=[24,30).
    fillBlock(img, w, 4, 10, 4, 20, BLUE);
    fillBlock(img, w, 20, 24, 6, 6, BLUE);

    const result = runBarDetect(img, w, h, BLUE, 40);
    if ('error' in result) throw new Error(result.error);
    expect(result.blobs).toBe(2);
    expect(result.boxes).toHaveLength(2);
    expect(result.matched).toBe(4 * 20 + 6 * 6);
    // Scan order top-to-bottom -> the tall bar (rows starting at y=10) comes first.
    expect(result.boxes[0]).toEqual({ start: { x: 4, y: 10 }, end: { x: 8, y: 30 } });
    expect(result.boxes[1]).toEqual({ start: { x: 20, y: 24 }, end: { x: 26, y: 30 } });
  });

  it('errors clearly when the colour matches too little', () => {
    const result = runBarDetect(whiteImage(10, 10), 10, 10, BLUE, 40);
    expect('error' in result && result.error).toMatch(/No pixels matched/);
  });

  it('errors clearly when every blob is filtered out by minDiameter', () => {
    const w = 20, h = 20;
    const img = whiteImage(w, h);
    fillBlock(img, w, 5, 5, 2, 2, BLUE); // a small noise speck, not a real bar
    const result = runBarDetect(img, w, h, BLUE, 40, 'foreground', undefined, { minDiameter: 100 });
    expect('error' in result && result.error).toMatch(/No bars of that size/);
  });

  it('two bars touching with no gap between them read as ONE merged box -- a known limit, not silently hidden', () => {
    // Documents the flood-fill limitation the module's own header comment
    // flags: same colour, zero gap, so they are one connected blob.
    const w = 20, h = 20;
    const img = whiteImage(w, h);
    fillBlock(img, w, 2, 5, 4, 10, BLUE);
    fillBlock(img, w, 6, 8, 4, 7, BLUE); // touches the first bar's right edge, no gap
    const result = runBarDetect(img, w, h, BLUE, 40);
    if ('error' in result) throw new Error(result.error);
    expect(result.blobs).toBe(1);
    expect(result.boxes[0]).toEqual({ start: { x: 2, y: 5 }, end: { x: 10, y: 15 } });
  });
});
