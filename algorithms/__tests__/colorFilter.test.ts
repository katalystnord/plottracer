import { describe, it, expect } from 'vitest';
import { colorFilter, maskToRGBA } from '../colorFilter.js';
import { pointsFromColumnRuns } from '../segmentFill.js';

/** A width x height RGBA image, solid `bg` (opaque) everywhere. */
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

function setPixel(data: Uint8ClampedArray, width: number, x: number, y: number, rgb: [number, number, number], a = 255) {
  const i = (y * width + x) * 4;
  data[i] = rgb[0];
  data[i + 1] = rgb[1];
  data[i + 2] = rgb[2];
  data[i + 3] = a;
}

const WHITE: [number, number, number] = [255, 255, 255];
const RED: [number, number, number] = [220, 30, 30];

describe('colorFilter', () => {
  it('foreground mode selects pixels near the target colour, and counts them', () => {
    const w = 4, h = 4;
    const img = makeImage(w, h, WHITE);
    setPixel(img, w, 1, 1, RED);
    setPixel(img, w, 2, 2, RED);

    const { mask, count } = colorFilter(img, w, h, RED, 40, 'foreground');
    expect(count).toBe(2);
    expect(mask[1 * w + 1]).toBe(1);
    expect(mask[2 * w + 2]).toBe(1);
    expect(mask[0]).toBe(0); // a white pixel is far from red
  });

  it('background mode selects everything NOT the (background) colour', () => {
    const w = 4, h = 4;
    const img = makeImage(w, h, WHITE);
    setPixel(img, w, 1, 1, RED);
    setPixel(img, w, 2, 2, [10, 120, 200]); // a blue series pixel too

    // "keep pixels far from white" -> both non-white pixels, whatever their colour.
    const { mask, count } = colorFilter(img, w, h, WHITE, 40, 'background');
    expect(count).toBe(2);
    expect(mask[1 * w + 1]).toBe(1);
    expect(mask[2 * w + 2]).toBe(1);
  });

  it('tolerance widens/narrows the match (Euclidean RGB distance)', () => {
    const w = 3, h = 1;
    const img = makeImage(w, h, WHITE);
    setPixel(img, w, 0, 0, RED);
    setPixel(img, w, 1, 0, [200, 60, 60]); // near-red, ~50 away

    // dist(RED, near-red) = sqrt(20^2+30^2+30^2) ~= 46.9
    expect(colorFilter(img, w, h, RED, 30, 'foreground').count).toBe(1); // only the exact RED
    expect(colorFilter(img, w, h, RED, 60, 'foreground').count).toBe(2); // both
  });

  it('never selects a fully transparent pixel (not part of the figure)', () => {
    const w = 2, h = 1;
    const img = makeImage(w, h, WHITE);
    setPixel(img, w, 0, 0, RED, 0); // red but transparent
    setPixel(img, w, 1, 0, RED, 255);
    const { mask, count } = colorFilter(img, w, h, RED, 40, 'foreground');
    expect(count).toBe(1);
    expect(mask[0]).toBe(0);
    expect(mask[1]).toBe(1);
  });

  it('restricts to a region when given one (e.g. avoid a legend swatch)', () => {
    const w = 6, h = 1;
    const img = makeImage(w, h, WHITE);
    setPixel(img, w, 0, 0, RED); // outside the region (a legend swatch)
    setPixel(img, w, 4, 0, RED); // inside the region (the curve)
    const { mask, count } = colorFilter(img, w, h, RED, 40, 'foreground', { x: 3, y: 0, width: 3, height: 1 });
    expect(count).toBe(1);
    expect(mask[0]).toBe(0);
    expect(mask[4]).toBe(1);
  });

  it('feeds pointsFromColumnRuns directly — a dashed vertical curve traces in one run', () => {
    // A broken (dashed) vertical red line at x=2 that Segment Fill's connectivity
    // could not span, but colour-filtering can.
    const w = 5, h = 8;
    const img = makeImage(w, h, WHITE);
    for (const y of [1, 2, 5, 6]) setPixel(img, w, 2, y, RED); // two dashes, a gap between
    const { mask } = colorFilter(img, w, h, RED, 40, 'foreground');
    // gap=1 splits the two dashes into two runs -> two points; a larger gap merges.
    const twoRuns = pointsFromColumnRuns(mask, w, h, 1);
    expect(twoRuns.every((p) => p.x === 2)).toBe(true);
    expect(twoRuns).toHaveLength(2);
    const merged = pointsFromColumnRuns(mask, w, h, 10);
    expect(merged).toHaveLength(1); // one column, one point when the gap is bridged
  });
});

describe('maskToRGBA (checkpoint 121 preview overlay)', () => {
  it('paints matched pixels the given colour and leaves the rest fully transparent', () => {
    const w = 3, h = 2;
    const mask = new Uint8Array(w * h); // all 0
    mask[0] = 1; // pixel (0,0)
    mask[4] = 1; // pixel (1,1)
    const rgba = maskToRGBA(mask, w, h, [255, 0, 200, 150]);

    expect(rgba).toHaveLength(w * h * 4);
    // Matched pixel 0 -> the paint colour.
    expect([rgba[0], rgba[1], rgba[2], rgba[3]]).toEqual([255, 0, 200, 150]);
    // Matched pixel 4 (byte offset 16).
    expect([rgba[16], rgba[17], rgba[18], rgba[19]]).toEqual([255, 0, 200, 150]);
    // Every unmatched pixel stays fully transparent (alpha 0), so the base image
    // shows through untouched.
    expect([rgba[4], rgba[5], rgba[6], rgba[7]]).toEqual([0, 0, 0, 0]);
    for (let p = 0; p < w * h; p++) {
      if (mask[p] === 0) expect(rgba[p * 4 + 3]).toBe(0);
    }
  });

  it('an all-zero mask produces a fully transparent overlay (nothing highlighted)', () => {
    const rgba = maskToRGBA(new Uint8Array(4), 2, 2, [255, 0, 200, 150]);
    expect(Array.from(rgba).every((b) => b === 0)).toBe(true);
  });
});
