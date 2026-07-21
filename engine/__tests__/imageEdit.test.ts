import { describe, expect, it } from 'vitest';
import {
  applyImageEditOp,
  clampCropRect,
  cropImage,
  rotateImageByAngle,
  straightenAngleFromPoints,
} from '../imageEdit.js';

// A w×h RGBA image where each pixel encodes its own coords: R=x, G=y, A=255.
function makeImg(w: number, h: number): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      d[i] = x;
      d[i + 1] = y;
      d[i + 3] = 255;
    }
  return d;
}
function px(d: Uint8ClampedArray, w: number, x: number, y: number): [number, number] {
  const i = (y * w + x) * 4;
  return [d[i]!, d[i + 1]!];
}

describe('applyImageEditOp', () => {
  it('rotate-cw swaps dimensions and maps (x,y) -> (h-1-y, x)', () => {
    const w = 3;
    const h = 2;
    const r = applyImageEditOp('rotate-cw', makeImg(w, h), w, h);
    expect([r.width, r.height]).toEqual([2, 3]);
    // Old pixel (2,0) carries [R=2,G=0]; it lands at (h-1-0, 2) = (1, 2).
    expect(r.mapPoint(2, 0)).toEqual({ x: 1, y: 2 });
    expect(px(r.data, r.width, 1, 2)).toEqual([2, 0]);
  });

  it('rotate-ccw swaps dimensions and maps (x,y) -> (y, w-1-x)', () => {
    const w = 3;
    const h = 2;
    const r = applyImageEditOp('rotate-ccw', makeImg(w, h), w, h);
    expect([r.width, r.height]).toEqual([2, 3]);
    expect(r.mapPoint(2, 1)).toEqual({ x: 1, y: 0 });
    expect(px(r.data, r.width, 1, 0)).toEqual([2, 1]);
  });

  it('flip-h keeps dimensions and mirrors x', () => {
    const w = 3;
    const h = 2;
    const r = applyImageEditOp('flip-h', makeImg(w, h), w, h);
    expect([r.width, r.height]).toEqual([3, 2]);
    expect(r.mapPoint(0, 1)).toEqual({ x: 2, y: 1 });
    expect(px(r.data, 3, 2, 1)).toEqual([0, 1]); // old (0,1) now at (2,1)
  });

  it('flip-v keeps dimensions and mirrors y', () => {
    const w = 2;
    const h = 3;
    const r = applyImageEditOp('flip-v', makeImg(w, h), w, h);
    expect([r.width, r.height]).toEqual([2, 3]);
    expect(r.mapPoint(1, 0)).toEqual({ x: 1, y: 2 });
    expect(px(r.data, 2, 1, 2)).toEqual([1, 0]);
  });

  it('two flips (h then h) return the original', () => {
    const w = 4;
    const h = 3;
    const once = applyImageEditOp('flip-h', makeImg(w, h), w, h);
    const twice = applyImageEditOp('flip-h', once.data, once.width, once.height);
    expect(Array.from(twice.data)).toEqual(Array.from(makeImg(w, h)));
  });
});

describe('clampCropRect', () => {
  it('normalizes a negative-size rect and rounds to integer bounds', () => {
    // Drawn bottom-right -> top-left: width/height are negative.
    expect(clampCropRect({ x: 5.4, y: 6.6, width: -3, height: -4 }, 10, 10)).toEqual({
      x: 2,
      y: 3,
      width: 3,
      height: 4,
    });
  });

  it('clamps a rect that overflows the image to the image bounds', () => {
    expect(clampCropRect({ x: -5, y: -5, width: 100, height: 100 }, 8, 6)).toEqual({
      x: 0,
      y: 0,
      width: 8,
      height: 6,
    });
  });

  it('returns null for a sub-pixel / empty rect', () => {
    expect(clampCropRect({ x: 2, y: 2, width: 0.4, height: 5 }, 10, 10)).toBeNull();
    expect(clampCropRect({ x: 20, y: 20, width: 5, height: 5 }, 10, 10)).toBeNull();
  });
});

describe('cropImage', () => {
  it('keeps the requested sub-region and shifts points by the crop origin', () => {
    const w = 5;
    const h = 4;
    const r = cropImage(makeImg(w, h), w, h, { x: 1, y: 1, width: 3, height: 2 });
    expect(r).not.toBeNull();
    expect([r!.width, r!.height]).toEqual([3, 2]);
    // The kept region's top-left pixel is old (1,1) -> carries [R=1,G=1].
    expect(px(r!.data, 3, 0, 0)).toEqual([1, 1]);
    expect(px(r!.data, 3, 2, 1)).toEqual([3, 2]); // old (3,2) at new (2,1)
    // A calibration/data point at old (2,2) shifts to (1,1) in the cropped image.
    expect(r!.mapPoint(2, 2)).toEqual({ x: 1, y: 1 });
  });

  it('returns null when the rect clamps away to nothing', () => {
    expect(cropImage(makeImg(4, 4), 4, 4, { x: 10, y: 10, width: 2, height: 2 })).toBeNull();
  });
});

describe('rotateImageByAngle', () => {
  it('0° is a no-op on dimensions and keeps points in place', () => {
    const r = rotateImageByAngle(makeImg(6, 4), 6, 4, 0);
    expect([r.width, r.height]).toEqual([6, 4]);
    const p = r.mapPoint(2, 3);
    expect(p.x).toBeCloseTo(2, 6);
    expect(p.y).toBeCloseTo(3, 6);
  });

  it('grows the canvas to the rotated bounding box (45°)', () => {
    const w = 10;
    const h = 10;
    const r = rotateImageByAngle(makeImg(w, h), w, h, 45);
    // bbox side = (w+h)/sqrt(2) = 20/1.414 ≈ 14.14 -> ceil 15
    expect(r.width).toBe(15);
    expect(r.height).toBe(15);
  });

  it('maps the image centre to the new centre', () => {
    const r = rotateImageByAngle(makeImg(10, 10), 10, 10, 30);
    const p = r.mapPoint(5, 5);
    expect(p.x).toBeCloseTo(r.width / 2, 6);
    expect(p.y).toBeCloseTo(r.height / 2, 6);
  });

  it('mapPoint is a rigid rotation: it preserves the distance between two points', () => {
    const r = rotateImageByAngle(makeImg(20, 12), 20, 12, 17);
    const a = r.mapPoint(3, 4);
    const b = r.mapPoint(15, 9);
    const before = Math.hypot(15 - 3, 9 - 4);
    const after = Math.hypot(b.x - a.x, b.y - a.y);
    expect(after).toBeCloseTo(before, 6);
  });
});

describe('straightenAngleFromPoints', () => {
  it('is 0 for an already-horizontal, rightward pair', () => {
    expect(straightenAngleFromPoints({ x: 10, y: 50 }, { x: 90, y: 50 })).toBeCloseTo(0, 6);
  });

  it('returns the angle that levels a tilted pair (its rotation makes them horizontal)', () => {
    // A pair tilted 10° down-to-the-right (screen y down): dy>0.
    const p1 = { x: 0, y: 0 };
    const p2 = { x: Math.cos((10 * Math.PI) / 180) * 100, y: Math.sin((10 * Math.PI) / 180) * 100 };
    const deg = straightenAngleFromPoints(p1, p2);
    expect(deg).toBeCloseTo(-10, 4); // rotate 10° counter-clockwise to level it
    // Applying that rotation makes p1->p2 horizontal.
    const r = rotateImageByAngle(makeImg(4, 4), 4, 4, deg);
    const a = r.mapPoint(p1.x, p1.y);
    const b = r.mapPoint(p2.x, p2.y);
    expect(b.y - a.y).toBeCloseTo(0, 4);
    expect(b.x - a.x).toBeGreaterThan(0); // still pointing right
  });

  it('returns 0 for a degenerate pair', () => {
    expect(straightenAngleFromPoints({ x: 5, y: 5 }, { x: 5, y: 5 })).toBe(0);
  });
});
