/**
 * ⚑⚑ MEASURING THE ANGLE A LABEL BAND RUNS AT, and straightening it.
 *
 * The case: David's candlestick figure draws its dates at 45 degrees, and the
 * quarter-turn sweep has no good answer for it - all four turns are equally
 * wrong, so the card showed the least bad garbage at confidence 29-47.
 */
import { describe, expect, it } from 'vitest';
import { deskewBand, estimateTextAngle } from '../ocrDeskew.js';

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

describe('measuring the angle a label band runs at', () => {
  it('reads a horizontal band as level', () => {
    const b = bandAt(0);
    expect(Math.round((estimateTextAngle(b.data, b.width, b.height) * 180) / Math.PI)).toBe(0);
  });

  it('⚑⚑ reads the 45 degree band the quarter turns could not', () => {
    const b = bandAt(45);
    const deg = (estimateTextAngle(b.data, b.width, b.height) * 180) / Math.PI;
    expect(Math.abs(deg - 45)).toBeLessThanOrEqual(2);
  });

  it('reads the other diagonal too, so the sign is real', () => {
    const b = bandAt(-45);
    const deg = (estimateTextAngle(b.data, b.width, b.height) * 180) / Math.PI;
    expect(Math.abs(deg + 45)).toBeLessThanOrEqual(2);
  });

  it('reads the shallower angles chart tools actually offer', () => {
    for (const want of [30, 60, -30]) {
      const b = bandAt(want);
      const deg = (estimateTextAngle(b.data, b.width, b.height) * 180) / Math.PI;
      expect(Math.abs(deg - want), `at ${want} degrees`).toBeLessThanOrEqual(3);
    }
  });

  it('⚑ measures ink against the band’s own paper, so a dark figure reads', () => {
    const b = bandAt(45);
    // Invert: light text on a dark ground, which a hardcoded threshold would
    // read as ink everywhere and score flat at every angle.
    for (let i = 0; i < b.data.length; i += 4) {
      b.data[i] = 255 - b.data[i]!;
      b.data[i + 1] = 255 - b.data[i + 1]!;
      b.data[i + 2] = 255 - b.data[i + 2]!;
    }
    const deg = (estimateTextAngle(b.data, b.width, b.height) * 180) / Math.PI;
    expect(Math.abs(deg - 45)).toBeLessThanOrEqual(2);
  });
});

describe('straightening the band', () => {
  it('⚑ turns a 45 degree band level, so the sweep finds nothing left to correct', () => {
    const b = bandAt(45);
    const angle = estimateTextAngle(b.data, b.width, b.height);
    const straight = deskewBand(b.data, b.width, b.height, angle);
    const left = (estimateTextAngle(straight.data, straight.width, straight.height) * 180) / Math.PI;
    expect(Math.abs(left)).toBeLessThanOrEqual(2);
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
