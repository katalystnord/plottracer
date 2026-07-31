import { describe, expect, it } from 'vitest';
import { clearBand } from '../barSplit.js';

/**
 * Clearing the calibrated axis line from a colour mask.
 *
 * ⚑ This file used to also cover a silhouette-based SPLITTER for merged bar
 * blobs. It was built, unit-tested against drawn fixtures, and then measured
 * against all 192 bar figures of the ICPR corpus — where it turned out to be
 * net negative, fragmenting more single bars than it recovered merges. It was
 * deleted rather than left switched off; the numbers and the reasoning live at
 * the foot of `algorithms/barSplit.ts` so it is not rebuilt blind.
 *
 * What survived is the part that pays: not letting the bars merge in the first
 * place. Monochrome-figure recall 66.2% -> 76.5%, overall 76.9% -> 80.8%.
 */

const W = 60;
const H = 40;

function blank(): Uint8Array {
  return new Uint8Array(W * H);
}

function rect(mask: Uint8Array, x0: number, y0: number, x1: number, y1: number): void {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) mask[y * W + x] = 1;
}

describe('clearing the baseline band', () => {
  it('⚑ disconnects bars joined only through the axis line', () => {
    // Two separated bars standing on a drawn axis are ONE blob because the
    // axis matches their colour. Clearing the calibrated baseline row is what
    // makes them two.
    const mask = blank();
    rect(mask, 5, 15, 15, 35);
    rect(mask, 25, 20, 35, 35);
    rect(mask, 0, 34, W, 36); // the axis line
    clearBand(mask, W, H, { orientation: 'row', at: 35, halfWidth: 1 });
    for (let x = 0; x < W; x++) {
      for (let y = 34; y <= 36; y++) expect(mask[y * W + x]).toBe(0);
    }
    // The bars above it survive.
    expect(mask[20 * W + 10]).toBe(1);
    expect(mask[25 * W + 30]).toBe(1);
  });

  it('clears a column band for a rotated chart', () => {
    const mask = blank();
    rect(mask, 0, 0, W, H);
    clearBand(mask, W, H, { orientation: 'column', at: 10, halfWidth: 2 });
    for (let y = 0; y < H; y++) {
      for (let x = 8; x <= 12; x++) expect(mask[y * W + x]).toBe(0);
      expect(mask[y * W + 7]).toBe(1);
      expect(mask[y * W + 13]).toBe(1);
    }
  });

  it('clips at the image edge rather than reading out of bounds', () => {
    const mask = blank();
    rect(mask, 0, 0, W, H);
    expect(() => clearBand(mask, W, H, { orientation: 'row', at: 0, halfWidth: 3 })).not.toThrow();
    expect(() => clearBand(mask, W, H, { orientation: 'row', at: H - 1, halfWidth: 3 })).not.toThrow();
    expect(() => clearBand(mask, W, H, { orientation: 'column', at: W - 1, halfWidth: 3 })).not.toThrow();
    expect(mask[0]).toBe(0);
  });

  it('clears exactly one row when the half-width is zero', () => {
    const mask = blank();
    rect(mask, 0, 0, W, H);
    clearBand(mask, W, H, { orientation: 'row', at: 20, halfWidth: 0 });
    expect(mask[20 * W + 5]).toBe(0);
    expect(mask[19 * W + 5]).toBe(1);
    expect(mask[21 * W + 5]).toBe(1);
  });
});
