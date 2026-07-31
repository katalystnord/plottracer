import { describe, expect, it } from 'vitest';
import { applyImageEditOp, rotateImageByAngle, clampCropRect, cropImage } from '../imageEdit.js';

/**
 * Image edits — **does the RASTER agree with `mapPoint`?**
 *
 * ⚑ WHY THIS FILE EXISTS. `engine/imageEdit.ts` scored **58.37%** with 107
 * mutants unnoticed, almost all of them inside `rotateImageByAngle`'s
 * inverse-map arithmetic. The existing `imageEdit.test.ts` covers the shape
 * well — dimensions, the 90° ops' index formulas, `mapPoint`'s isometry — and
 * stays. What nothing checked is the one thing the module actually promises:
 *
 *   "`mapPoint` is the exact affine rotation about the image centre (not the
 *    pixel-sampled path), so calibration handles / data points / measurement
 *    vertices rotate WITH the raster and keep their geometric relationship —
 *    a calibrated value is unchanged by a deskew."
 *
 * Two independent computations — the pixel sampler and `mapPoint` — must
 * describe the SAME rotation. Nothing compared them. Every sign, every
 * operator and both `± 0.5` terms in the sampler could flip with the suite
 * green, and the symptom would be calibration handles drifting off the image
 * content by up to a pixel after a deskew: not a crash, just every value
 * quietly wrong by a fraction of a division.
 *
 * ⚑ THE CONVENTION, which is what makes this subtle and is asserted here
 * explicitly so nobody has to rediscover it: coordinates are CONTINUOUS, and
 * pixel `i` spans `[i, i+1)`, so its CENTRE is `i + 0.5`. `mapPoint(2, 3)` is
 * therefore the top-left CORNER of pixel (2,3), not the pixel itself. Feeding
 * it a bare pixel index looks almost right and is off by up to one pixel —
 * measured, not assumed (mapPoint(2,3) → (6.00,2.00) where the raster puts
 * that pixel at (5,2); mapPoint(2.5,3.5) → (5.50,2.50), which is that
 * pixel's centre exactly).
 */

/** A blank RGBA raster with one opaque red pixel at (mx,my). */
function rasterWithMark(w: number, h: number, mx: number, my: number): Uint8ClampedArray {
  const src = new Uint8ClampedArray(w * h * 4);
  const i = (my * w + mx) * 4;
  src[i] = 255;
  src[i + 3] = 255;
  return src;
}

/** The brightest red pixel in a raster — where the mark ended up. */
function brightest(data: Uint8ClampedArray, w: number, h: number): { x: number; y: number; value: number } {
  let best = -1;
  let bx = -1;
  let by = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = data[(y * w + x) * 4]!;
      if (v > best) {
        best = v;
        bx = x;
        by = y;
      }
    }
  }
  return { x: bx, y: by, value: best };
}

describe('rotateImageByAngle — the raster and mapPoint describe ONE rotation', () => {
  it('⚑ puts the marked pixel exactly where mapPoint says, at 90° (where sampling is exact)', () => {
    // At a right angle cos/sin are 0/1, so bilinear sampling lands on a whole
    // pixel and the agreement can be asserted EXACTLY rather than within a
    // tolerance -- the sharpest form of this check.
    const src = rasterWithMark(9, 9, 2, 3);
    const r = rotateImageByAngle(src, 9, 9, 90);

    const landed = brightest(r.data, r.width, r.height);
    expect(landed.value).toBe(255); // survived the rotation undimmed

    // The pixel's CENTRE through mapPoint must be the centre of the pixel the
    // raster actually lit.
    const mapped = r.mapPoint(2 + 0.5, 3 + 0.5);
    expect(mapped.x).toBeCloseTo(landed.x + 0.5, 6);
    expect(mapped.y).toBeCloseTo(landed.y + 0.5, 6);
  });

  it('agrees within a pixel at 45°, where sampling necessarily spreads the mark', () => {
    // Off-axis the mark is split across neighbours by bilinear sampling, so
    // the brightest pixel is the nearest one rather than an exact hit -- but
    // mapPoint must still land inside it.
    const src = rasterWithMark(9, 9, 2, 3);
    const r = rotateImageByAngle(src, 9, 9, 45);

    const landed = brightest(r.data, r.width, r.height);
    const mapped = r.mapPoint(2 + 0.5, 3 + 0.5);
    expect(Math.abs(mapped.x - (landed.x + 0.5))).toBeLessThanOrEqual(1);
    expect(Math.abs(mapped.y - (landed.y + 0.5))).toBeLessThanOrEqual(1);
  });

  it('⚑ a 90° fine rotation reproduces the dedicated rotate-cw op, pixel for pixel', () => {
    // Two INDEPENDENT implementations of the same transform: the general
    // bilinear inverse map, and the integer index formula (x,y) -> (h-1-y, x).
    // Agreement between them is a far stronger statement than either checked
    // against a fixture, and it is what a sign flip in either would break.
    const w = 6;
    const h = 4;
    const src = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        src[i] = (x * 40) % 256; // a gradient, so position is identifiable
        src[i + 1] = (y * 60) % 256;
        src[i + 2] = 10;
        src[i + 3] = 255;
      }
    }

    const viaOp = applyImageEditOp('rotate-cw', src, w, h);
    const viaAngle = rotateImageByAngle(src, w, h, 90);
    expect(viaAngle.width).toBe(viaOp.width);
    expect(viaAngle.height).toBe(viaOp.height);

    for (let y = 0; y < viaOp.height; y++) {
      for (let x = 0; x < viaOp.width; x++) {
        const i = (y * viaOp.width + x) * 4;
        for (let c = 0; c < 3; c++) {
          // Bilinear sampling at a right angle is exact up to float rounding.
          expect(Math.abs(viaAngle.data[i + c]! - viaOp.data[i + c]!)).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('⚑ keeps the canvas EXACTLY square-on at a right angle (bounding-box epsilon regression)', () => {
    // THE SECOND, WORSE BUG the cross-check exposed. |w*cos| + |h*sin| for a
    // 5x5 at 180 degrees is 5.0000000000000006, and Math.ceil of that is SIX.
    // The canvas grew a pixel each way, which shifted its centre by half a
    // pixel, so the source stopped tiling the destination and the inverse map
    // sent the outer row AND column outside the source: a 5x5 came back 4x4
    // of real content padded with blanks. Silent data loss.
    for (const deg of [90, 180, 270, -90, -180, 360]) {
      const r = rotateImageByAngle(new Uint8ClampedArray(5 * 5 * 4), 5, 5, deg);
      expect(r.width, `${deg}deg width`).toBe(5);
      expect(r.height, `${deg}deg height`).toBe(5);
    }
  });

  it('⚑ does not blank the outermost row/column at a right angle (float-epsilon regression)', () => {
    // THE BUG THIS PINS: cos(pi/2) is 6.12e-17, not 0, so at 90/180/270 an
    // edge pixel's inverse-mapped coordinate lands a rounding error outside
    // the source -- measured at -1.5e-16 -- and an exact `< 0` bounds test
    // discarded it as out-of-source, writing a transparent pixel. The result
    // was a one-pixel transparent edge on every right-angle deskew, silently
    // eating the extreme edge of the figure. Found by the cross-check above,
    // which disagreed with the integer rotate-cw op on exactly one corner.
    const w = 5;
    const h = 5;
    const src = new Uint8ClampedArray(w * h * 4).fill(255); // fully opaque
    for (const deg of [90, 180, 270, -90, 360]) {
      const r = rotateImageByAngle(src, w, h, deg);
      let transparent = 0;
      for (let i = 3; i < r.data.length; i += 4) if (r.data[i] === 0) transparent++;
      // A right-angle rotation of a square is area-preserving: EVERY
      // destination pixel comes from a real source pixel, so none may be
      // transparent.
      expect(transparent, `${deg}° left ${transparent} blank pixels`).toBe(0);
    }
  });

  it('leaves the corners created by the rotation fully transparent, not black', () => {
    // The out-of-source branch writes 0 to all four channels; if it wrote only
    // RGB, a deskewed scan would gain opaque black wedges. Corner (0,0) of a
    // 45° rotation is always outside the source.
    const src = new Uint8ClampedArray(9 * 9 * 4).fill(255);
    const r = rotateImageByAngle(src, 9, 9, 45);
    expect(r.data[3]).toBe(0); // alpha at (0,0)
  });

  it('rotating by 0° leaves every pixel exactly where it was', () => {
    const src = rasterWithMark(7, 5, 3, 1);
    const r = rotateImageByAngle(src, 7, 5, 0);
    expect(r.width).toBe(7);
    expect(r.height).toBe(5);
    const landed = brightest(r.data, r.width, r.height);
    expect(landed).toMatchObject({ x: 3, y: 1, value: 255 });
  });

  it('grows the canvas to the rotated bounding box, never smaller than a pixel', () => {
    // The ceil/abs bounding-box arithmetic: a 45° rotation of a square grows
    // by root two, and a degenerate input still yields a usable raster.
    const r = rotateImageByAngle(new Uint8ClampedArray(10 * 10 * 4), 10, 10, 45);
    expect(r.width).toBe(Math.ceil(10 * Math.SQRT2));
    expect(r.height).toBe(Math.ceil(10 * Math.SQRT2));

    const tiny = rotateImageByAngle(new Uint8ClampedArray(1 * 1 * 4), 1, 1, 45);
    expect(tiny.width).toBeGreaterThanOrEqual(1);
    expect(tiny.height).toBeGreaterThanOrEqual(1);
  });
});

describe('clampCropRect — the boundary between a usable crop and none', () => {
  it('keeps a rect exactly one pixel wide or tall', () => {
    // ⚑ `width < 1 || height < 1` mutated to `<= 1` and survived: that would
    // reject the smallest legitimate crop. One pixel is the boundary both
    // mutants straddle, so it needs a case on the KEEP side.
    expect(clampCropRect({ x: 3, y: 4, width: 1, height: 1 }, 20, 20)).toEqual({ x: 3, y: 4, width: 1, height: 1 });
    expect(clampCropRect({ x: 3, y: 4, width: 1, height: 9 }, 20, 20)).toEqual({ x: 3, y: 4, width: 1, height: 9 });
  });

  it('refuses a rect with no area at all', () => {
    expect(clampCropRect({ x: 3, y: 4, width: 0, height: 5 }, 20, 20)).toBeNull();
    expect(clampCropRect({ x: 3, y: 4, width: 5, height: 0 }, 20, 20)).toBeNull();
  });

  it('refuses a rect entirely outside the image rather than clamping it to a sliver', () => {
    expect(clampCropRect({ x: 50, y: 50, width: 10, height: 10 }, 20, 20)).toBeNull();
    expect(clampCropRect({ x: -50, y: -50, width: 10, height: 10 }, 20, 20)).toBeNull();
  });
});

describe('cropImage — the kept region really is the region asked for', () => {
  it('⚑ copies the requested sub-region pixel for pixel, at the right offset', () => {
    // The copy loops' bounds and the source/destination index arithmetic had
    // six survivors between them (`ry <= c.height`, `rx <= c.width`, `d - 2`,
    // `s - 2`, `s - 3`). Nothing had compared the CONTENT of the crop against
    // the source; a shifted or short copy would silently mis-register every
    // point that survived the crop.
    const w = 6;
    const h = 5;
    const src = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        src[i] = x * 10; // red encodes the column
        src[i + 1] = y * 10; // green encodes the row
        src[i + 2] = 7; // a constant, so a channel shift shows
        src[i + 3] = 255;
      }
    }

    const out = cropImage(src, w, h, { x: 2, y: 1, width: 3, height: 3 });
    expect(out).not.toBeNull();
    expect(out!.width).toBe(3);
    expect(out!.height).toBe(3);

    for (let ry = 0; ry < 3; ry++) {
      for (let rx = 0; rx < 3; rx++) {
        const d = (ry * 3 + rx) * 4;
        expect(out!.data[d]).toBe((rx + 2) * 10); // the source column it came from
        expect(out!.data[d + 1]).toBe((ry + 1) * 10); // the source row
        expect(out!.data[d + 2]).toBe(7); // channels not rotated
        expect(out!.data[d + 3]).toBe(255); // alpha carried, not dropped
      }
    }
  });

  it('shifts a point by the crop origin, keeping it aligned with the pixels it names', () => {
    const out = cropImage(new Uint8ClampedArray(6 * 5 * 4), 6, 5, { x: 2, y: 1, width: 3, height: 3 })!;
    expect(out.mapPoint(4, 3)).toEqual({ x: 2, y: 2 });
    // A point outside the kept region maps NEGATIVE rather than being clamped
    // -- the documented "keep the data, let the geometry fall where it may".
    expect(out.mapPoint(0, 0)).toEqual({ x: -2, y: -1 });
  });

  it('returns null rather than an empty raster when the rect clamps away', () => {
    expect(cropImage(new Uint8ClampedArray(6 * 5 * 4), 6, 5, { x: 99, y: 99, width: 3, height: 3 })).toBeNull();
  });
});
