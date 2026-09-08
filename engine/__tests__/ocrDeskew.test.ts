/**
 * ⚑⚑ MEASURING THE ANGLE A LABEL BAND RUNS AT, and straightening it.
 *
 * The case: David's candlestick figure draws its dates at 45 degrees, and the
 * quarter-turn sweep has no good answer for it - all four turns are equally
 * wrong, so the card showed the least bad garbage at confidence 29-47.
 */
import { describe, expect, it } from 'vitest';
import { deskewBand, findBandAngle } from '../ocrDeskew.js';

/**
 * A band of "text": evenly spaced dark strokes sitting on rows that run at
 * `deg`. ⚑ Not real glyphs - the angle finder never reads a character, it reads
 * how PEAKY the ink is when summed along a direction, so strokes on rows are
 * exactly the signal it looks for.
 */
function bandAt(deg: number, width = 160, height = 160) {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const ink = (x: number, y: number) => {
    const px = Math.round(x);
    const py = Math.round(y);
    if (px < 0 || py < 0 || px >= width || py >= height) return;
    const i = (py * width + px) * 4;
    data[i] = 0;
    data[i + 1] = 0;
    data[i + 2] = 0;
  };
  // Three text rows, 24px apart in the ROTATED frame, each a run of strokes.
  for (const row of [-24, 0, 24]) {
    for (let t = -60; t <= 60; t += 4) {
      for (let h = -4; h <= 4; h++) {
        // A short vertical stroke, carried along the row's direction.
        const x = width / 2 + t * cos - (row + h) * sin;
        const y = height / 2 + t * sin + (row + h) * cos;
        ink(x, y);
      }
    }
  }
  return { data, width, height };
}

describe('finding the angle by reading at it', () => {
  /** A stand-in reader whose confidence peaks at `trueDeg`, as the real one does:
   *  measured on the 45 degree figure, 88.6 at the angle and under 35 by 10
   *  degrees off. */
  const readerPeakingAt = (trueDeg: number, seen: number[] = []) => async (radians: number) => {
    const deg = (radians * 180) / Math.PI;
    seen.push(Math.round(deg));
    return Math.max(0, 90 - Math.abs(deg - trueDeg) * 6);
  };

  it('⚑⚑ finds the 45 degree angle the quarter turns could not', async () => {
    const { radians } = await findBandAngle(readerPeakingAt(-45));
    expect(Math.round((radians * 180) / Math.PI)).toBe(-45);
  });

  it('leaves a horizontal axis at zero', async () => {
    const { radians } = await findBandAngle(readerPeakingAt(0));
    expect(Math.round((radians * 180) / Math.PI)).toBe(0);
  });

  it('finds the shallower angles chart tools actually offer', async () => {
    for (const want of [30, -30, 60]) {
      const { radians } = await findBandAngle(readerPeakingAt(want));
      expect(Math.round((radians * 180) / Math.PI), `at ${want} degrees`).toBe(want);
    }
  });

  it('⚑ costs a coarse sweep plus a refinement, not a fine sweep of the whole range', async () => {
    const seen: number[] = [];
    await findBandAngle(readerPeakingAt(-45, seen));
    // -60..60 at 15 is 9 reads; refining +-15 at 5 adds 4 more. A 5 degree
    // sweep of the whole range would be 25, and the old path cost 4 x N.
    expect(seen.length).toBeLessThanOrEqual(13);
  });

  it('⚑ reports the whole sweep, so the card can show what it tried', async () => {
    const { sweep } = await findBandAngle(readerPeakingAt(-45));
    expect(sweep.length).toBeGreaterThan(8);
    expect(Math.max(...sweep.map((s) => s.meanConfidence))).toBeGreaterThan(80);
  });
});

describe('straightening the band', () => {
  it('⚑ turns the band by the angle it is given, and back again', () => {
    // ⚠️ This used to check the straightened band by re-measuring its angle with
    // a projection-profile deskew. That method is GONE - it read the real 45
    // degree figure as 0, because a projection profile assumes long shared text
    // rows and a category axis draws short staggered labels. What is left to
    // check here is the geometry: rotating by an angle and mapping back must be
    // an exact round trip, which is what the word boxes depend on.
    const b = bandAt(45, 120, 80);
    const straight = deskewBand(b.data, b.width, b.height, Math.PI / 4);
    for (const [x, y] of [
      [10, 10],
      [60, 40],
      [100, 70],
    ]) {
      const src = straight.toSource(x!, y!);
      // Rotating that source point forward by the same angle returns the point.
      const cos = Math.cos(Math.PI / 4);
      const sin = Math.sin(Math.PI / 4);
      const dx = src.x - b.width / 2;
      const dy = src.y - b.height / 2;
      expect(dx * cos + dy * sin + straight.width / 2).toBeCloseTo(x!, 6);
      expect(-dx * sin + dy * cos + straight.height / 2).toBeCloseTo(y!, 6);
    }
  });

  it('⚑ sizes the output to the ROTATED bounding box, so nothing is clipped', () => {
    // ⚠️ "grows the box" is what I first asserted and it is FALSE: a wide, thin
    // band turned 45 degrees is NARROWER than it was (100x40 -> 99x99), because
    // the bounding box of a rotation is not monotonic in either dimension. The
    // requirement is that the box holds the rotated content, not that it grew.
    const b = bandAt(0, 100, 40);
    const straight = deskewBand(b.data, b.width, b.height, Math.PI / 4);
    const c = Math.abs(Math.cos(Math.PI / 4));
    const s = Math.abs(Math.sin(Math.PI / 4));
    expect(straight.width).toBe(Math.ceil(100 * c + 40 * s));
    expect(straight.height).toBe(Math.ceil(100 * s + 40 * c));

    // ⚑ And the thing that actually matters: every corner of the source is
    // reachable from inside the output, so no ink fell off an edge.
    const corners = [
      [0, 0],
      [100, 0],
      [0, 40],
      [100, 40],
    ];
    for (const [sx, sy] of corners) {
      let found = false;
      for (let y = 0; y < straight.height && !found; y++) {
        for (let x = 0; x < straight.width && !found; x++) {
          const p = straight.toSource(x, y);
          if (Math.abs(p.x - sx!) < 1.5 && Math.abs(p.y - sy!) < 1.5) found = true;
        }
      }
      expect(found, `corner ${sx},${sy} is inside the output`).toBe(true);
    }
  });

  it('⚑⚑ maps a straightened point back to the pixel it came from', () => {
    // This is what turns a word's box into a position on the category axis, so
    // it is the whole reason the rotation returns a transform at all.
    const b = bandAt(0, 120, 80);
    const straight = deskewBand(b.data, b.width, b.height, Math.PI / 6);
    const centre = straight.toSource(straight.width / 2, straight.height / 2);
    expect(centre.x).toBeCloseTo(60, 5);
    expect(centre.y).toBeCloseTo(40, 5);
  });

  it('fills the exposed corners with the band’s paper, not with black', () => {
    const b = bandAt(0, 100, 40);
    const straight = deskewBand(b.data, b.width, b.height, Math.PI / 4);
    // Top-left of the rotated output is outside the source rectangle.
    expect(straight.data[0]).toBeGreaterThan(200);
  });
});
