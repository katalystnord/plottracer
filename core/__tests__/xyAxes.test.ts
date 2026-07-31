import { describe, expect, it } from 'vitest';
import { XYAxes } from '../axes/xy.js';
import { Calibration } from '../calibration.js';

/**
 * XY calibration maths — the most-used axes type in the app.
 *
 * ⚑ WHY THIS FILE EXISTS. `core/axes/xy.ts` is a faithful port of wpd-core's
 * `core/axes/xy.js`, and mutation testing scored it 45.13% with 52 mutants that
 * NO test reaches. Our suite exercises XYAxes constantly — through sessions,
 * exports, project round-trips — but never asserts its maths directly: before
 * this file, `dataToPixel` was asserted only for spider, the one axes class that
 * is original work rather than a port (and which scores 83.41%).
 *
 * Cases marked "WPD" are ADAPTED FROM WebPlotDigitizer's `tests/xy_axes_tests.js`
 * (Copyright (C) 2025 Ankit Rohatgi, AGPL-3.0 — the same licence as this
 * project, which is what makes porting legitimate).
 *
 * The calibration shape throughout is WPD's own: four points in a 99x99 box,
 * (0,99) as the origin. Kept because the expected values are hand-derivable
 * from it, which is what makes a failure readable.
 */

/** Build a calibrated XYAxes from four (px, py, dx, dy) points. */
function calibrated(
  points: readonly [number, number, string, string][],
  { logX = false, logY = false, noRotation = false } = {}
): XYAxes {
  const calib = new Calibration(2);
  for (const [px, py, dx, dy] of points) calib.addPoint(px, py, dx, dy);
  const axes = new XYAxes();
  expect(axes.calibrate(calib, logX, logY, noRotation), 'calibration should succeed').toBe(true);
  return axes;
}

/** X1=(0,99)=0, X2=(99,99)=100, Y1=(0,99)=0, Y2=(0,0)=10 — the ordinary "L". */
const ORDINARY: [number, number, string, string][] = [
  [0, 99, '0', '0'],
  [99, 99, '100', '0'],
  [0, 99, '0', '0'],
  [0, 0, '0', '10'],
];

/** The same figure turned 90°: X runs UP the image, Y runs across it. */
const ROTATED_90: [number, number, string, string][] = [
  [0, 99, '0', '0'],
  [0, 0, '10', '0'],
  [0, 99, '0', '0'],
  [99, 99, '0', '100'],
];

describe('XYAxes — linear (WPD)', () => {
  it('round-trips the midpoint through dataToPixel and back', () => {
    const axes = calibrated(ORDINARY);
    const px = axes.dataToPixel(50, 5);
    expect(px.x).toBeCloseTo(99 / 2, 12);
    expect(px.y).toBeCloseTo(99 / 2, 12);

    const data = axes.pixelToData(99 / 2, 99 / 2);
    expect(data[0]).toBeCloseTo(50, 12);
    expect(data[1]).toBeCloseTo(5, 12);
  });

  it('handles a figure whose axes are rotated 90°', () => {
    // X is the VERTICAL screen direction here, so a mutant that assumes x-data
    // maps to x-pixels survives the ordinary case above and dies here.
    const axes = calibrated(ROTATED_90);
    const px = axes.dataToPixel(5, 50);
    expect(px.x).toBeCloseTo(99 / 2, 12);
    expect(px.y).toBeCloseTo(99 / 2, 12);

    const data = axes.pixelToData(99 / 2, 99 / 2);
    // ⚑ WPD's own test labels these two backwards ("pixelToData, X" over the
    // data[1] assertion). The assertions are right, the labels are not — named
    // correctly here rather than inheriting the slip.
    expect(data[0], 'X').toBeCloseTo(5, 12);
    expect(data[1], 'Y').toBeCloseTo(50, 12);
  });
});

describe('XYAxes — rotation correction', () => {
  // ⚑ WPD has THREE tests for this flag (linear/90°/log, each with
  // noRotationCorrection = true) and all three are inert: they use PERPENDICULAR
  // axes, where the correction is a measured no-op, and then assert exactly the
  // same numbers as their unflagged counterparts. They cannot detect a rotation
  // correction that is completely broken. Replaced by the two cases below: one
  // pins the no-op, the other pins a geometry where the flag actually decides
  // the answer.
  it('is a no-op when the axes are already perpendicular', () => {
    const on = calibrated(ROTATED_90).pixelToData(50, 50);
    const off = calibrated(ROTATED_90, { noRotation: true }).pixelToData(50, 50);
    expect(off[0]).toBeCloseTo(on[0]!, 12);
    expect(off[1]).toBeCloseTo(on[1]!, 12);
  });

  it('CHANGES the reading on a skewed calibration, which is the whole point', () => {
    // The y axis leans: its second point is offset in x, so the two axes are not
    // perpendicular and the correction has something to do.
    const skewed: [number, number, string, string][] = [
      [0, 99, '0', '0'],
      [99, 99, '10', '0'],
      [0, 99, '0', '0'],
      [30, 0, '0', '100'],
    ];
    const corrected = calibrated(skewed).pixelToData(50, 50);
    const uncorrected = calibrated(skewed, { noRotation: true }).pixelToData(50, 50);

    expect(corrected[0]).toBeCloseTo(3.5507, 3);
    expect(uncorrected[0]).toBeCloseTo(5.0505, 3);
    // A 42% divergence in x — if the flag were ignored these would be equal.
    expect(Math.abs(corrected[0]! - uncorrected[0]!)).toBeGreaterThan(1);
    // y is unaffected by the lean, which is what makes the x difference legible.
    expect(corrected[1]).toBeCloseTo(uncorrected[1]!, 12);
  });
});

describe('XYAxes — log scales (WPD)', () => {
  it('places a point by decade across an extreme range', () => {
    // X: 1e-5 -> 1e12 over 99px. Y: 1e-20 -> 1 over 99px.
    const axes = calibrated(
      [
        [0, 99, '1e-5', '0'],
        [99, 99, '1e12', '0'],
        [0, 99, '1e-5', '1e-20'],
        [0, 0, '1e-5', '1'],
      ],
      { logX: true, logY: true }
    );
    const px = axes.dataToPixel(1e6, 1e-3);
    expect(px.x).toBeCloseTo((99 * (6 + 5)) / (12 + 5), 12);
    expect(px.y).toBeCloseTo(99 * (1 - (-3 + 20) / (0 + 20)), 12);
  });

  it('handles a log axis running in the NEGATIVE direction', () => {
    // Both axes are negative throughout. The class carries dedicated
    // isLogScaleXNegative/YNegative state for this, and nothing else in our
    // suite reaches it.
    const axes = calibrated(
      [
        [0, 99, '-1e-5', '0'],
        [99, 99, '-1e12', '0'],
        [0, 99, '-1e-5', '-1e-20'],
        [0, 0, '-1e-5', '-1'],
      ],
      { logX: true, logY: true }
    );
    const px = axes.dataToPixel(-1e6, -1e-3);
    expect(px.x).toBeCloseTo((99 * (6 + 5)) / (12 + 5), 12);
    expect(px.y).toBeCloseTo(99 * (1 - (-3 + 20) / (0 + 20)), 12);
  });

  it('round-trips a point back out of a log calibration', () => {
    // WPD frames this as a "log base 2" test, which is a red herring — the
    // maths is log10 either way and the powers of 2 are just the values chosen.
    // What it uniquely adds is the pixelToData direction on a log axis, which
    // the cases above do not cover.
    const axes = calibrated(
      [
        [0, 99, String(2 ** -5), String(2 ** -20)],
        [99, 99, String(2 ** 12), String(2 ** -20)],
        [0, 99, String(2 ** -5), String(2 ** -20)],
        [0, 0, String(2 ** -5), '1'],
      ],
      { logX: true, logY: true }
    );
    const x = (99 * (6 + 5)) / (12 + 5);
    const y = 99 * (1 - (-3 + 20) / (0 + 20));
    expect(axes.dataToPixel(2 ** 6, 2 ** -3).x).toBeCloseTo(x, 12);

    const data = axes.pixelToData(x, y);
    expect(data[0]).toBeCloseTo(2 ** 6, 10);
    expect(data[1]).toBeCloseTo(2 ** -3, 10);
  });
});

/**
 * ⚑ THE LOG AXIS THAT CANNOT EXIST — refused by the MODEL, not only by the UI.
 *
 * `Math.log(0)` is −Infinity and `Math.log(negative)` is NaN, and
 * `processCalibration` fed both straight into the transform matrix and then
 * returned true regardless: `isCalibrated()` said yes while every reading came
 * back null.
 *
 * The interactive path already refused this (calibrationSession's
 * `logScaleGuards`), and its comment named the defect exactly — "every value
 * reads back NaN while calibrate() still reports success (core/axes/xy.ts:88)".
 * But the model has MORE THAN ONE ENTRANCE: `core/plotData.ts` calls
 * `calibrate()` when loading a project and never inspects the result, and the
 * StarryDigitizer/Engauge importers call it directly too. Everything that
 * arrives by file therefore walked past the guard.
 *
 * Found while writing importer tests: a StarryDigitizer project with a log
 * axis calibrated at zero imported "successfully".
 */
describe('a log axis whose endpoints cannot be logged is refused', () => {
  const box = (x1: string, x2: string, y1: string, y2: string) =>
    [
      [0, 99, x1, '0'],
      [99, 99, x2, '0'],
      [0, 99, '0', y1],
      [0, 0, '0', y2],
    ] as const;

  function tryCalibrate(pts: readonly (readonly [number, number, string, string])[], opts: { logX?: boolean; logY?: boolean }) {
    const calib = new Calibration(2);
    for (const [px, py, dx, dy] of pts) calib.addPoint(px, py, dx, dy);
    const axes = new XYAxes();
    return { ok: axes.calibrate(calib, opts.logX ?? false, opts.logY ?? false, false), axes };
  }

  it('refuses a log X axis with a zero endpoint', () => {
    const { ok, axes } = tryCalibrate(box('0', '100', '0', '10'), { logX: true });
    expect(ok).toBe(false);
    expect(axes.isCalibrated()).toBe(false);
  });

  it('refuses a log Y axis with a zero endpoint', () => {
    const { ok } = tryCalibrate(box('0', '10', '0', '100'), { logY: true });
    expect(ok).toBe(false);
  });

  it('⚑ refuses endpoints of MIXED sign, which log10 turns into NaN', () => {
    // The all-negative case below is legitimate and must stay legitimate; it
    // is the MIX that has no logarithm. A guard written as "both must be
    // positive" would break the negative decade axis WPD supports.
    expect(tryCalibrate(box('-1', '100', '0', '10'), { logX: true }).ok).toBe(false);
    expect(tryCalibrate(box('1', '-100', '0', '10'), { logX: true }).ok).toBe(false);
  });

  it('still accepts an all-NEGATIVE log axis, which WPD supports', () => {
    const { ok, axes } = tryCalibrate(box('-100', '-1', '0', '10'), { logX: true });
    expect(ok).toBe(true);
    // −100 at the left edge and −1 at the right: the midpoint is −10.
    expect(axes.pixelToData(49.5, 99)[0]).toBeCloseTo(-10, 6);
  });

  it('still accepts an ordinary positive log axis', () => {
    const { ok, axes } = tryCalibrate(box('1', '100', '0', '10'), { logX: true });
    expect(ok).toBe(true);
    expect(axes.pixelToData(49.5, 99)[0]).toBeCloseTo(10, 6);
  });

  it('leaves a LINEAR axis through zero completely alone', () => {
    // The commonest calibration there is. The guard must be conditional on the
    // log flag, or it refuses almost every real figure.
    expect(tryCalibrate(box('0', '100', '-50', '50'), {}).ok).toBe(true);
  });

  it('⚑ a refused calibration reads NOTHING, rather than reading NaN', () => {
    // The point of returning false: `isCalibrated()` is what every caller
    // consults before showing a number, so an honest false is what keeps the
    // NaN off the screen and out of the export.
    const { axes } = tryCalibrate(box('0', '100', '0', '10'), { logX: true });
    expect(axes.isCalibrated()).toBe(false);
  });
});
