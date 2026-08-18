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
 * Geometry: corner A at (0,200), corner B at (200,200) - the two calibration
 * points the implementation actually reads. The apex is then implied.
 */

function ternary({ range100 = false, normal = true } = {}): TernaryAxes {
  const calib = new Calibration(3);
  calib.addPoint(0, 200, '', '');
  calib.addPoint(200, 200, '', '');
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

  it('reads the implied apex as a pure third component', () => {
    // The apex is not a calibration point - it falls out of the equilateral
    // geometry at height L*sin(60°) above the base. If the root-3 factor were
    // wrong this is the point that would move.
    const apexY = 200 - 200 * Math.sin(Math.PI / 3);
    const [a, b, c] = axes.pixelToData(100, apexY);
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
 * ⚑ COINCIDENT CORNERS - refused by the model, like map.ts's zero-length scale.
 *
 * `L` is the pixel distance between corners A and B, and every reading divides
 * by it. Two corners on one pixel made L zero, every value read back null, and
 * `calibrate()` returned true - so TERNARY_AXES_CONFIG.buildAxes's
 * `if (!ok) return { error: ... }` was a refusal that could never fire.
 *
 * The click path keeps the corners apart (`distinctPixelSteps`); a loaded
 * project calls `calibrate()` directly and did not.
 */
describe('a ternary diagram with no side length is refused', () => {
  function tryCorners(a: [number, number], b: [number, number]) {
    const cal = new Calibration(2);
    cal.addPoint(a[0], a[1], '0', '0');
    cal.addPoint(b[0], b[1], '0', '0');
    const axes = new TernaryAxes();
    return { ok: axes.calibrate(cal, true, true), axes };
  }

  it('refuses corners A and B on the same pixel', () => {
    const { ok, axes } = tryCorners([100, 400], [100, 400]);
    expect(ok).toBe(false);
    expect(axes.isCalibrated()).toBe(false);
  });

  it('accepts two distinct corners', () => {
    expect(tryCorners([100, 400], [400, 400]).ok).toBe(true);
  });
});
