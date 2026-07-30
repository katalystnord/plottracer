import { describe, it, expect } from 'vitest';
import { runBlobDetect } from '../blobDetectRun.js';

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

const RED: [number, number, number] = [220, 30, 30];

describe('runBlobDetect', () => {
  it('returns one centroid per marker of the target colour', () => {
    const w = 24, h = 24;
    const img = whiteImage(w, h);
    // Three separate 2×2 red markers.
    fillBlock(img, w, 3, 3, 2, 2, RED);
    fillBlock(img, w, 15, 6, 2, 2, RED);
    fillBlock(img, w, 9, 18, 2, 2, RED);

    const result = runBlobDetect(img, w, h, RED, 40);
    if ('error' in result) throw new Error(result.error);
    expect(result.blobs).toBe(3);
    expect(result.points).toHaveLength(3);
    expect(result.matched).toBe(12); // 3 markers × 4 px
    // First marker's centroid: block at (3,3)-(4,4) -> mean (3.5,3.5) + 0.5.
    expect(result.points[0]).toEqual({ x: 4, y: 4 });
  });

  it('errors clearly when the colour matches too little', () => {
    const result = runBlobDetect(whiteImage(10, 10), 10, 10, RED, 40);
    expect('error' in result && result.error).toMatch(/No pixels matched/);
  });

  it('errors clearly when every blob is filtered out by minDiameter', () => {
    const w = 20, h = 20;
    const img = whiteImage(w, h);
    fillBlock(img, w, 5, 5, 2, 2, RED); // a small marker, ~2.3 px equivalent diameter
    const result = runBlobDetect(img, w, h, RED, 40, 'foreground', undefined, { minDiameter: 100 });
    expect('error' in result && result.error).toMatch(/No markers of that size/);
  });

  it('returns points sorted ascending by (x, then y) -- not detectBlobs\' own scan order', () => {
    // ⚑ detectBlobs's own order is a top-to-bottom, left-to-right PIXEL SCAN
    // -- an implementation detail of how the flood fill finds its seeds, not
    // a reading order. For ordered scatter data (e.g. a dose-response curve)
    // that scan order numbers points top-of-page-first, which for a rising
    // curve reads as highest-value-first -- scrambled, not ascending. David,
    // driving the real app against a real 26-point figure: exactly this.
    // Placed here in an order that would read WRONG under scan order (the
    // highest marker planted first) to prove the fix sorts by position.
    const w = 40, h = 40;
    const img = whiteImage(w, h);
    fillBlock(img, w, 30, 2, 2, 2, RED); // top-right: scanned FIRST under raster order
    fillBlock(img, w, 5, 30, 2, 2, RED); // bottom-left: smallest x
    fillBlock(img, w, 18, 15, 2, 2, RED); // middle

    const result = runBlobDetect(img, w, h, RED, 40);
    if ('error' in result) throw new Error(result.error);
    expect(result.points.map((p) => Math.round(p.x))).toEqual([6, 19, 31]);
  });
});
