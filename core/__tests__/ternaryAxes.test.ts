import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { TernaryAxes } from '../axes/ternary.js';
import { Calibration } from '../calibration.js';

/**
 * Ternary calibration.
 *
 * ⚑ WHY THIS FILE EXISTS. Like polar, `core/axes/ternary.ts` has no upstream
 * test to port - WebPlotDigitizer has none, and Engauge does not implement
 * ternary at all (its coordinate types are Cartesian and Polar, which is why our
 * own .dig reader refuses anything else by name). Nobody has ever verified this
 * maths.
 *
 * That absence turns out not to matter, because a ternary plot has a DEFINING
 * PROPERTY: the three components sum to a constant. That is stronger than any
 * borrowed fixture - it holds for every pixel, so it can be asserted over
 * thousands of generated ones rather than a handful of chosen ones. This is the
 * first use of fast-check in the tree.
 *
 * ⚑⚑ ALL THREE CORNERS ARE READ, since 2026-09-10. This file used to say
 * *"corner A at (0,200), corner B at (200,200) - the two calibration points the
 * implementation actually reads. The apex is then implied"*, which was true and
 * was the defect: WPD's own `ternary.js` assigns `x2, y2` from the third click
 * and never reads them again, so the maths assumed the triangle was equilateral
 * however it was actually drawn. Inherited faithfully, and now replaced - a
 * ternary reading is the BARYCENTRIC coordinate of the pixel in the triangle the
 * user clicked, of which the equilateral case is one instance.
 *
 * Geometry: A at (0,200), B at (200,200), C at the exact equilateral apex, so
 * the cases below read identically to the maths they replace.
 */

const EQUILATERAL_APEX_Y = 200 - 200 * Math.sin(Math.PI / 3);

function ternary({ range100 = false, normal = true } = {}): TernaryAxes {
  return ternaryOn([[0, 200], [200, 200], [100, EQUILATERAL_APEX_Y]], { range100, normal });
}

/** A ternary calibrated on ANY triangle - which is the point of the change. */
function ternaryOn(
  corners: [[number, number], [number, number], [number, number]],
  { range100 = false, normal = true } = {}
): TernaryAxes {
  const calib = new Calibration(3);
  for (const [px, py] of corners) calib.addPoint(px, py, '', '');
  const axes = new TernaryAxes();
  expect(axes.calibrate(calib, range100, normal), 'calibration should succeed').toBe(true);
  return axes;
}

describe('TernaryAxes - the defining property', () => {
  it('sums to 1 for ANY pixel, anywhere on the canvas', () => {
    // The invariant that makes a ternary plot a ternary plot. Asserted as a
    // property over generated pixels rather than as a handful of examples: a
    // mutant that corrupts one of the three component formulas breaks the sum,
    // and no single chosen point is needed to catch it.
    const axes = ternary();
    fc.assert(
      fc.property(
        fc.double({ min: -1000, max: 1000, noNaN: true }),
        fc.double({ min: -1000, max: 1000, noNaN: true }),
        (px, py) => {
          const [a, b, c] = axes.pixelToData(px, py);
          expect(a! + b! + c!).toBeCloseTo(1, 9);
        }
      ),
      { numRuns: 1000 }
    );
  });

  it('sums to 100 when the range is 0-100', () => {
    const axes = ternary({ range100: true });
    fc.assert(
      fc.property(
        fc.double({ min: -1000, max: 1000, noNaN: true }),
        fc.double({ min: -1000, max: 1000, noNaN: true }),
        (px, py) => {
          const [a, b, c] = axes.pixelToData(px, py);
          expect(a! + b! + c!).toBeCloseTo(100, 7);
        }
      ),
      { numRuns: 500 }
    );
  });

  it('holds the sum even where the components go negative', () => {
    // ⚑ Worth pinning explicitly (tenets 9 and 10): a pixel outside the triangle
    // produces NEGATIVE components, and the app does not clamp them. That is
    // correct - clamping would be interpretation, and a reading outside the
    // triangle is a fact about where the user clicked, not an error to hide.
    // The sum still holds, which is what makes the negative value trustworthy
    // rather than garbage.
    const [a, b, c] = ternary().pixelToData(999, -40);
    expect(a).toBeLessThan(0);
    expect(a! + b! + c!).toBeCloseTo(1, 9);
  });
});

describe('TernaryAxes - the corners', () => {
  const axes = ternary();

  it('reads calibration corner A as a pure first component', () => {
    const [a, b, c] = axes.pixelToData(0, 200);
    expect(a).toBeCloseTo(1, 10);
    expect(b).toBeCloseTo(0, 10);
    expect(c).toBeCloseTo(0, 10);
  });

  it('reads calibration corner B as a pure second component', () => {
    const [a, b, c] = axes.pixelToData(200, 200);
    expect(a).toBeCloseTo(0, 10);
    expect(b).toBeCloseTo(1, 10);
    expect(c).toBeCloseTo(0, 10);
  });

  it('reads the CLICKED apex as a pure third component', () => {
    // ⚑ The apex is a calibration point now, not a consequence of the geometry.
    // It reads (0,0,1) because it was clicked, not because it happens to sit at
    // L*sin(60°) - which is what makes a non-equilateral diagram readable.
    const [a, b, c] = axes.pixelToData(100, EQUILATERAL_APEX_Y);
    expect(c).toBeCloseTo(1, 8);
    expect(a).toBeCloseTo(0, 8);
    expect(b).toBeCloseTo(0, 8);
  });
});

describe('TernaryAxes - orientation', () => {
  it('ROTATES which component is which, without disturbing the sum', () => {
    // Inverted orientation is a relabelling of the same geometry: (a,b,c)
    // becomes (c,a,b). Asserted as the relationship between the two readings
    // rather than as three magic numbers, so it stays true if the fixture moves.
    const normal = ternary({ normal: true }).pixelToData(50, 150);
    const inverted = ternary({ normal: false }).pixelToData(50, 150);

    expect(inverted[0]).toBeCloseTo(normal[2]!, 10);
    expect(inverted[1]).toBeCloseTo(normal[0]!, 10);
    expect(inverted[2]).toBeCloseTo(normal[1]!, 10);
    expect(inverted[0]! + inverted[1]! + inverted[2]!).toBeCloseTo(1, 10);
  });
});

describe('TernaryAxes - what it does NOT provide', () => {
  it('ships the unimplemented dataToPixel stub', () => {
    expect(ternary().dataToPixel(0.5, 0.3, 0.2)).toEqual({ x: 0, y: 0 });
  });
});

describe('TernaryAxes.calibrate refuses too few calibration points (v2.0 audit)', () => {
  it('refuses rather than indexing an out-of-range getPoint() into a crash', () => {
    const calib = new Calibration(3);
    calib.addPoint(0, 200, '', '');
    const axes = new TernaryAxes();
    expect(axes.calibrate(calib, false, true)).toBe(false);
    expect(axes.isCalibrated()).toBe(false);
  });

  it('refuses zero points too', () => {
    const axes = new TernaryAxes();
    expect(axes.calibrate(new Calibration(3), false, true)).toBe(false);
  });
});

/**
 * ⚑ A DEGENERATE TRIANGLE - refused by the model, like map.ts's zero-length scale.
 *
 * Every reading divides by twice the triangle's signed area, so a triangle with
 * no area makes every value non-finite while `calibrate()` reports success - and
 * TERNARY_AXES_CONFIG.buildAxes's `if (!ok) return { error: ... }` becomes a
 * refusal that can never fire.
 *
 * ⚑ The old guard measured only the A-to-B distance, so it caught coincident
 * corners and NOT collinear ones. The determinant catches both, because both are
 * the same fact about the triangle.
 *
 * The click path keeps the corners apart (`distinctPixelSteps`); a loaded
 * project calls `calibrate()` directly and did not.
 */
describe('a ternary diagram with no area is refused', () => {
  function tryCorners(corners: Array<[number, number]>) {
    const cal = new Calibration(3);
    for (const [px, py] of corners) cal.addPoint(px, py, '0', '0');
    const axes = new TernaryAxes();
    return { ok: axes.calibrate(cal, true, true), axes };
  }

  it('refuses corners A and B on the same pixel', () => {
    const { ok, axes } = tryCorners([[100, 400], [100, 400], [250, 150]]);
    expect(ok).toBe(false);
    expect(axes.isCalibrated()).toBe(false);
  });

  it('⚑⚑ refuses THREE COLLINEAR corners, which the old maths accepted', () => {
    // A triangle flat to a line has no interior, so no pixel has a
    // decomposition. The old model never looked: it only measured A-to-B, so a
    // C anywhere on that line calibrated happily and read every pixel through an
    // equilateral triangle that was not there.
    const { ok, axes } = tryCorners([[100, 400], [400, 400], [250, 400]]);
    expect(ok).toBe(false);
    expect(axes.isCalibrated()).toBe(false);
  });

  it('refuses two corners - a triangle needs three', () => {
    // `numCalibrationPointsRequired()` has always said 3; the maths used 2, so
    // the guard could only ever check what it happened to dereference.
    expect(tryCorners([[100, 400], [400, 400]]).ok).toBe(false);
  });

  it('accepts three corners with area between them', () => {
    expect(tryCorners([[100, 400], [400, 400], [250, 150]]).ok).toBe(true);
  });
});

/**
 * ⚑⚑ THE TRIANGLE AS DRAWN - the change itself, in outcomes.
 *
 * ⚠️ MEASURED BEFORE THE CHANGE, so "unchanged" is a pin rather than a claim:
 * the equilateral readings below are the numbers the previous maths produced,
 * captured from it and asserted against the new maths.
 */
describe('a ternary is read from the triangle that was clicked', () => {
  const A: [number, number] = [100, 400];
  const B: [number, number] = [400, 400];
  const EXACT_APEX: [number, number] = [250, 400 - 300 * Math.sin(Math.PI / 3)];

  it('⚑ an EQUILATERAL diagram reads exactly what it read before', () => {
    const axes = ternaryOn([A, B, EXACT_APEX], { range100: true });
    const at = (px: number, py: number) => axes.pixelToData(px, py);
    // Captured from the pre-change implementation, to 10 decimals.
    expect(at(250, 300)[0]).toBeCloseTo(30.7549910270, 8);
    expect(at(250, 300)[1]).toBeCloseTo(30.7549910270, 8);
    expect(at(250, 300)[2]).toBeCloseTo(38.4900179460, 8);
    expect(at(180, 380)[0]).toBeCloseTo(69.4843315387, 8);
    expect(at(180, 380)[1]).toBeCloseTo(22.8176648721, 8);
    expect(at(180, 380)[2]).toBeCloseTo(7.6980035892, 8);
    // Outside the triangle too, where the components go negative.
    expect(at(600, 500)[0]).toBeCloseTo(-47.4216576937, 7);
    expect(at(600, 500)[1]).toBeCloseTo(185.9116756397, 7);
    expect(at(600, 500)[2]).toBeCloseTo(-38.4900179460, 7);
  });

  it('⚑⚑ a RIGHT-ANGLED diagram reads its own corner as that corner', () => {
    // ⚠️ THE DEFECT, in one number. This triangle - A(100,300), B(100,100),
    // C(300,300) - is the shape three fixtures in this repo already used, and
    // the old maths read the CLICKED corner C as
    // `157.7350, 57.7350, -115.4701`: 157% of the first component and minus
    // 115% of the third, at the very pixel the user clicked to say "this corner
    // is pure C". Right-angled ternary diagrams are a real convention.
    const axes = ternaryOn([[100, 300], [100, 100], [300, 300]], { range100: true });
    const [a, b, c] = axes.pixelToData(300, 300);
    expect(a).toBeCloseTo(0, 9);
    expect(b).toBeCloseTo(0, 9);
    expect(c).toBeCloseTo(100, 9);
  });

  it('reads the midpoint of a side as half and half, on ANY triangle', () => {
    // The defining check a distorted diagram would fail: halfway along B-C is
    // 50/50 of those two components and none of the first, whatever the shape.
    const axes = ternaryOn([[100, 300], [100, 100], [300, 300]], { range100: true });
    const [a, b, c] = axes.pixelToData((100 + 300) / 2, (100 + 300) / 2);
    expect(a).toBeCloseTo(0, 9);
    expect(b).toBeCloseTo(50, 9);
    expect(c).toBeCloseTo(50, 9);
  });

  it('reads the centroid as equal thirds, on ANY triangle', () => {
    const axes = ternaryOn([[0, 0], [900, 40], [120, 500]], { range100: true });
    const [a, b, c] = axes.pixelToData((0 + 900 + 120) / 3, (0 + 40 + 500) / 3);
    expect(a).toBeCloseTo(100 / 3, 9);
    expect(b).toBeCloseTo(100 / 3, 9);
    expect(c).toBeCloseTo(100 / 3, 9);
  });

  it('⚑ reads a DOWNWARD-pointing triangle, which the old maths could not express', () => {
    // The old model placed the apex above the A-B line by construction, so a
    // diagram drawn point-down gave a negative third component everywhere
    // inside itself.
    const axes = ternaryOn([[100, 100], [400, 100], [250, 360]], { range100: true });
    const [a, b, c] = axes.pixelToData(250, 360);
    expect(a).toBeCloseTo(0, 9);
    expect(b).toBeCloseTo(0, 9);
    expect(c).toBeCloseTo(100, 9);
    const inside = axes.pixelToData(250, 200);
    expect(inside.every((v) => v > 0)).toBe(true);
  });

  it('keeps the sum on a skewed triangle, inside and out', () => {
    const axes = ternaryOn([[0, 0], [900, 40], [120, 500]], { range100: true });
    fc.assert(
      fc.property(
        fc.double({ min: -1000, max: 1000, noNaN: true }),
        fc.double({ min: -1000, max: 1000, noNaN: true }),
        (px, py) => {
          const [a, b, c] = axes.pixelToData(px, py);
          expect(a! + b! + c!).toBeCloseTo(100, 7);
        }
      ),
      { numRuns: 500 }
    );
  });
});
