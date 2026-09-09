/**
 * ⚑⚑ THE BAR AXES' OWN TRANSFORM, AND THE REFUSALS UNDER IT.
 *
 * ⚠️ FOUND BY MUTATION TESTING, 2026-09-09. `core/axes/bar.ts` scored 85.71%
 * with 27 survivors, and three of them are not cosmetic:
 *
 *   · `Math.log(p1) / Math.log(10)`  ->  `* Math.log(10)` SURVIVED. The log10
 *     conversion of a calibration point could be multiplied instead of divided
 *     and nothing noticed - on a log bar chart that is every value wrong, and
 *     wrong PLAUSIBLY, which is this project's worst failure class.
 *   · `if (!this._isCalibrated) return NaN`  ->  `if (false)` survived.
 *   · `if (denom === 0) return NaN`  ->  `if (false)` survived, and had NO
 *     COVERAGE at all: nothing in the suite reaches it. Same family as the
 *     `calibrate()` that could never fail - a refusal nobody has ever fired.
 *
 * ⚑ `dataToPixel` is the half that had no tests, and it is not decorative: it
 * is what an EDIT goes through. Typing a value into the table moves the datum by
 * inverting the axes, so a wrong inverse silently moves a point somewhere else.
 */
import { describe, expect, it } from 'vitest';
import { BarAxes } from '../axes/bar.js';
import { Calibration } from '../calibration.js';

/** Two points on a vertical value axis, `v1` at the bottom, `v2` at the top. */
function verticalBar(v1: string, v2: string, isLog = false): BarAxes {
  const cal = new Calibration(2);
  cal.addPoint(100, 500, '0', v1);
  cal.addPoint(100, 100, '0', v2);
  const axes = new BarAxes();
  expect(axes.calibrate(cal, isLog, false), `calibrate ${v1}..${v2} log=${isLog}`).toBe(true);
  return axes;
}

describe('a bar axes reads and inverts its own scale', () => {
  it('reads a LINEAR scale off the pixels', () => {
    const axes = verticalBar('0', '400');
    // 400px spans 0..400, so the midpoint is 200 and a quarter down is 300.
    expect(axes.pixelToData(100, 300)[0]).toBeCloseTo(200, 6);
    expect(axes.pixelToData(100, 200)[0]).toBeCloseTo(300, 6);
  });

  it('⚑⚑ reads a LOG scale as powers of ten, not as something near them', () => {
    // ⚠️⚑⚑ NOT STARTING AT 1, AND THAT IS THE WHOLE POINT. The first draft of
    // this test used 1..1000 and the mutant it was written to kill SURVIVED,
    // because `log(1)` is 0 and zero divided by anything equals zero multiplied
    // by anything. I wrote a fixture blind by construction inside the test
    // written to catch fixtures blind by construction. 10 at the bottom makes
    // `log(10)/log(10) = 1` and `log(10)*log(10) = 5.3019` - which disagree.
    //
    // 10 at the bottom, 10000 at the top, over 400px: three decades, one decade
    // is 133.33px, and the midpoint is 10^2.5 = 316.227766.
    const axes = verticalBar('10', '10000', true);
    expect(axes.isLog()).toBe(true);
    expect(axes.pixelToData(100, 300)[0]).toBeCloseTo(316.227766, 4);
    // ⚑ The decade boundaries are what bites: only an exact expectation at each
    // one says the scale is really logarithmic rather than nearly so.
    expect(axes.pixelToData(100, 500)[0]).toBeCloseTo(10, 6);
    expect(axes.pixelToData(100, 500 - 400 / 3)[0]).toBeCloseTo(100, 5);
    expect(axes.pixelToData(100, 100)[0]).toBeCloseTo(10000, 3);
  });

  it('⚑ inverts itself - the path a typed value takes when it moves a datum', () => {
    for (const [v1, v2, isLog] of [
      ['0', '400', false],
      ['10', '10000', true],
    ] as const) {
      const axes = verticalBar(v1, v2, isLog);
      for (const value of isLog ? [10, 100, 1000, 10000] : [0, 100, 250, 400]) {
        const at = axes.dataToPixel(value);
        expect(Number.isFinite(at.y), `${value} has no pixel`).toBe(true);
        expect(axes.pixelToData(at.x, at.y)[0], `${value} did not survive the round trip`).toBeCloseTo(
          value,
          4
        );
      }
    }
  });

  it('⚑⚑ refuses to invert when it is not calibrated, rather than answering 0', () => {
    // ⚠️ The file's own header says why NaN and not {0,0}: a zero would put the
    // datum at the image origin, which is a position, and a position is a
    // reading. This branch had never been reached by any test.
    //
    // ⚑ MEASURED, AND WORTH KNOWING: removing this guard does not change the
    // answer, so its mutant is EQUIVALENT and stays alive. `p1` and `p2` both
    // start at 0, and every refusal inside `calibrate` returns BEFORE they are
    // assigned - so an uncalibrated axes always has a zero span and the
    // denominator guard below catches it anyway. The guard is real defence in
    // depth against a future path that sets one without the other; it is not
    // reachable today, and no test can honestly make it so.
    const fresh = new BarAxes();
    const at = fresh.dataToPixel(42);
    expect(Number.isNaN(at.x) && Number.isNaN(at.y), `answered ${JSON.stringify(at)}`).toBe(true);
  });

  it('⚑ a fresh axes is not in log mode left over from a previous one', () => {
    // ⚑ MEASURED, and equivalent for the same reason as the guard above: every
    // `buildAxes` and both `plotData` load paths construct a NEW `BarAxes`, so
    // `calibrate` is never called twice on one instance and the `else` that
    // clears `isLogScale` cannot be observed. Defence in depth, asserted here so
    // the day someone reuses an instance this is already written down.
    const axes = new BarAxes();
    expect(axes.isLog()).toBe(false);
  });

  it('⚑⚑ refuses to invert a scale with no span - the guard nothing had reached', () => {
    // A calibration whose two values are equal is refused by `calibrate`, so
    // the only way here is a scale whose span collapses after the fact. Both
    // doors matter: the refusal exists because `t = (v - p1) / 0` is Infinity,
    // and an infinite pixel is a datum dragged off the image with no complaint.
    const axes = verticalBar('0', '400');
    (axes as unknown as { p2: number; p1: number }).p2 = (axes as unknown as { p1: number }).p1;
    const at = axes.dataToPixel(42);
    expect(Number.isNaN(at.x) && Number.isNaN(at.y), `answered ${JSON.stringify(at)}`).toBe(true);
  });

  it('⚑ and a non-positive value has no place on a log scale', () => {
    const axes = verticalBar('10', '10000', true);
    for (const bad of [0, -1]) {
      const at = axes.dataToPixel(bad);
      expect(Number.isNaN(at.x), `${bad} was given a pixel`).toBe(true);
    }
  });

  it('⚑ a plain axes is not log until it is told so - the default, asserted', () => {
    expect(new BarAxes().isLog()).toBe(false);
    expect(verticalBar('0', '400').isLog()).toBe(false);
  });
});
