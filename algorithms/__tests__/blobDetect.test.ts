import { describe, it, expect } from 'vitest';
import { detectBlobs } from '../blobDetect.js';

/** A width×height binary mask with the given (x,y) pixels set to 1. */
function makeMask(width: number, height: number, set: [number, number][]): Uint8Array {
  const mask = new Uint8Array(width * height);
  for (const [x, y] of set) mask[y * width + x] = 1;
  return mask;
}

describe('detectBlobs', () => {
  it('returns one centroid per connected blob, at the pixel centre (+0.5)', () => {
    // Two separate single-pixel markers, far apart.
    const mask = makeMask(10, 10, [
      [2, 2],
      [7, 8],
    ]);
    const blobs = detectBlobs(mask, 10, 10);
    expect(blobs).toHaveLength(2);
    // Scan order is top-to-bottom, left-to-right, so (2,2) comes first.
    expect(blobs[0]!.centroid).toEqual({ x: 2.5, y: 2.5 });
    expect(blobs[1]!.centroid).toEqual({ x: 7.5, y: 8.5 });
    expect(blobs[0]!.area).toBe(1);
  });

  it('collapses a solid block to a single blob at its centroid', () => {
    // A 3×3 block at columns/rows 1..3 -> centroid (2,2), +0.5 -> (2.5, 2.5).
    const set: [number, number][] = [];
    for (let y = 1; y <= 3; y++) for (let x = 1; x <= 3; x++) set.push([x, y]);
    const blobs = detectBlobs(makeMask(6, 6, set), 6, 6);
    expect(blobs).toHaveLength(1);
    expect(blobs[0]!.area).toBe(9);
    expect(blobs[0]!.centroid).toEqual({ x: 2.5, y: 2.5 });
  });

  it('is 8-connected: diagonally touching pixels are one blob, not two', () => {
    const mask = makeMask(6, 6, [
      [1, 1],
      [2, 2], // diagonal neighbour of (1,1)
    ]);
    const blobs = detectBlobs(mask, 6, 6);
    expect(blobs).toHaveLength(1);
    expect(blobs[0]!.area).toBe(2);
    expect(blobs[0]!.centroid).toEqual({ x: 2, y: 2 }); // (1.5+0.5, 1.5+0.5)
  });

  it('drops blobs below minDiameter (noise specks) and keeps larger ones', () => {
    // A lone pixel (equivalent diameter ~1.13) plus a 3×3 block (~3.38).
    const set: [number, number][] = [[0, 0]];
    for (let y = 3; y <= 5; y++) for (let x = 3; x <= 5; x++) set.push([x, y]);
    const all = detectBlobs(makeMask(8, 8, set), 8, 8);
    expect(all).toHaveLength(2);
    // minDiameter 2 rejects the single pixel, keeps the block.
    const filtered = detectBlobs(makeMask(8, 8, set), 8, 8, { minDiameter: 2 });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.area).toBe(9);
  });

  it('drops blobs above maxDiameter (a merged grid/axis blob)', () => {
    // A small 1-px marker and a big 5×5 block.
    const set: [number, number][] = [[0, 0]];
    for (let y = 2; y <= 6; y++) for (let x = 2; x <= 6; x++) set.push([x, y]);
    const kept = detectBlobs(makeMask(9, 9, set), 9, 9, { maxDiameter: 3 });
    expect(kept).toHaveLength(1);
    expect(kept[0]!.area).toBe(1); // only the small marker survives
  });

  it('returns nothing for an empty mask', () => {
    expect(detectBlobs(new Uint8Array(16), 4, 4)).toHaveLength(0);
  });
});
