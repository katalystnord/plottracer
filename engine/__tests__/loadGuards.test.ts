import { describe, expect, it } from 'vitest';
import { CalibrationSession, XY_AXES_CONFIG, POLAR_AXES_CONFIG, MAP_AXES_CONFIG } from '../calibrationSession.js';
import { XYAxes } from '../../core/axes/xy.js';
import { PolarAxes } from '../../core/axes/polar.js';
import { MapAxes } from '../../core/axes/map.js';
import { Calibration } from '../../core/calibration.js';
import { Dataset } from '../../core/dataset.js';

/**
 * Finding A3 (2026-07-17): `checkGuards` ran in `runCalibration` only, so every
 * refusal was CLICK-PATH-ONLY and opening a project file bypassed all of them.
 *
 * These tests build an axes the way the LOAD path does - `plotData.deserialize`
 * calls `axes.calibrate(...)` directly and hands the built instance to
 * `loadCalibrated` - deliberately never touching the session's click walk. That
 * is the door that was unguarded.
 *
 * The premise worth restating, because it is the whole reason the guards exist
 * (calibrationSession.ts:341): **an axes class reports success on degenerate
 * input.** `calibrate()` returning true proves nothing. Each test below asserts
 * that first, so a future reader can see the guard is load-bearing rather than
 * belt-and-braces.
 *
 * ⚑ UPDATED 2026-07-31: that premise is now NARROWER, and deliberately so. The
 * LOG cases are refused by the model itself - `core/axes/xy.ts` and
 * `polar.ts` were fed `Math.log(0)`/`Math.log(negative)` and returned true
 * anyway, which the StarryDigitizer importer trusted. So `calibrate()` now
 * answers `false` for those, and the helper below says which answer each case
 * expects rather than assuming one.
 *
 * ⚑ It changes NOTHING about this file's subject. `loadCalibrated` builds its
 * state from the axes instance it is handed and never consults
 * `axes.isCalibrated()`, so a refused log project still opens with its points
 * intact and the reason on screen - which is the whole "surface, don't refuse"
 * decision below. And every OTHER degenerate shape here (coincident points,
 * collinear axes, equal radii) still gets `true` out of `calibrate()`, so the
 * session guards remain exactly as load-bearing as they were.
 */

/**
 * Build an XYAxes exactly as the load path does: calibrate() directly, no session.
 *
 * `expectCalibrateOk` states the premise each case rests on, rather than
 * assuming one for all of them: `false` for a log scale the model now refuses
 * outright, `true` for every other degenerate shape - where `calibrate()` is
 * still perfectly happy with input the click path rejects, which is what makes
 * the session's own guard load-bearing.
 */
function loadedXY(
  points: Array<[number, number, string, string]>,
  isLogY = false,
  expectCalibrateOk = true
): XYAxes {
  const cal = new Calibration(2);
  for (const [px, py, dx, dy] of points) cal.addPoint(px, py, dx, dy);
  const axes = new XYAxes();
  // (calib, isLogX, isLogY, noRotationCorrection). noRotationCorrection=false
  // matches checkpoint 68's default - WPD applies tilt correction, and so do we.
  expect(axes.calibrate(cal, false, isLogY, false)).toBe(expectCalibrateOk);
  return axes;
}

describe('A3 - the load path runs the same refusals as the click path', () => {
  it('catches a log axis through zero in a LOADED project', () => {
    // Y1 = 0 on a log Y axis. The click path has refused this since ckpt 69;
    // opening a file did not, and every value read back null with no error.
    const axes = loadedXY(
      [
        [100, 300, '0', '0'],
        [400, 300, '10', '0'],
        [100, 300, '0', '0'],
        [100, 0, '0', '1000'],
      ],
      true,
      false // the model refuses a log axis through zero (2026-07-31)
    );
    const session = new CalibrationSession(XY_AXES_CONFIG);
    session.loadCalibrated(axes, [new Dataset(2)]);
    expect(session.getCalibrationError()).toMatch(/log .* cannot pass through zero/i);
  });

  it('catches coincident calibration points in a LOADED project', () => {
    // X1 and X2 on one pixel -> singular transform -> every value null, while
    // calibrate() still returned true.
    const axes = loadedXY([
      [100, 300, '0', '0'],
      [100, 300, '10', '0'],
      [100, 300, '0', '0'],
      [100, 0, '0', '10'],
    ]);
    const session = new CalibrationSession(XY_AXES_CONFIG);
    session.loadCalibrated(axes, [new Dataset(2)]);
    expect(session.getCalibrationError()).toMatch(/same pixel/i);
  });

  it('SURFACES rather than refuses - the points still load and are still there', () => {
    // Deliberate: refusing to open would strand data the previous version
    // wrote (the same reasoning as loadCalibrated's dedupe). The user must be
    // able to SEE their work and the reason at the same time.
    const dataset = new Dataset(2);
    dataset.addPixel(200, 200);
    dataset.addPixel(250, 180);
    const axes = loadedXY(
      [
        [100, 300, '0', '0'],
        [400, 300, '10', '0'],
        [100, 300, '0', '0'],
        [100, 0, '0', '1000'],
      ],
      true,
      false // the model refuses a log axis through zero (2026-07-31)
    );
    const session = new CalibrationSession(XY_AXES_CONFIG);
    session.loadCalibrated(axes, [dataset]);

    expect(session.getCalibrationError()).toBeTruthy();
    expect(session.isCalibrated()).toBe(true); // the axes loaded
    expect(session.getDataPoints()).toHaveLength(2); // and so did the work
  });

  it('keeps the refusal through an undo round-trip - the snapshot is the THIRD door', () => {
    // ⚑ `restoreState` assigns `this.axes` without running checkGuards, unlike both
    // other entrances. That is sound only because the refusal travels IN the
    // snapshot: the round-trip goes back through `plotData.deserialize`, which
    // calls `axes.calibrate` directly - the same call that "reports success on
    // degenerate input" the whole file is premised on. So if the error did not
    // survive the trip, one undo would launder a refused calibration into a clean
    // one: identical null-valued readings with the on-screen reason gone, which is
    // strictly worse than the file that was refused in the first place.
    const axes = loadedXY(
      [
        [100, 300, '0', '0'],
        [400, 300, '10', '0'],
        [100, 300, '0', '0'],
        [100, 0, '0', '1000'],
      ],
      true,
      false // the model refuses a log axis through zero (2026-07-31)
    );
    const session = new CalibrationSession(XY_AXES_CONFIG);
    session.loadCalibrated(axes, [new Dataset(2)]);
    const before = session.getCalibrationError();
    expect(before).toMatch(/log .* cannot pass through zero/i);

    session.restoreState(session.captureState());

    expect(session.getCalibrationError()).toBe(before);
    expect(session.isCalibrated()).toBe(true);
    // The option the guard is conditional on has to come back too, or the next
    // handle drag would re-guard against a linear axis and clear a live refusal.
    expect(session.getOptions()['isLogY']).toBe('true');
  });

  it('stays RECOVERABLE - fixing the calibration clears the error', () => {
    // The escape hatch that makes "surface, don't refuse" honest: the handles
    // are live, and moving one re-runs runCalibration, which re-guards.
    const axes = loadedXY([
      [100, 300, '0', '0'],
      [100, 300, '10', '0'], // X2 coincident with X1
      [100, 300, '0', '0'],
      [100, 0, '0', '10'],
    ]);
    const session = new CalibrationSession(XY_AXES_CONFIG);
    session.loadCalibrated(axes, [new Dataset(2)]);
    expect(session.getCalibrationError()).toMatch(/same pixel/i);

    // updateCalibPointPixel re-runs runCalibration when already calibrated,
    // which is the guarded path - so the drag both fixes and re-checks.
    session.updateCalibPointPixel('x2', 400, 300);
    expect(session.getCalibrationError()).toBeNull();
    expect(session.isCalibrated()).toBe(true);
  });

  it('a HEALTHY project still loads clean - the guard adds no false positive', () => {
    const axes = loadedXY([
      [100, 300, '0', '0'],
      [400, 300, '10', '0'],
      [100, 300, '0', '0'],
      [100, 0, '0', '10'],
    ]);
    const session = new CalibrationSession(XY_AXES_CONFIG);
    session.loadCalibrated(axes, [new Dataset(2)]);
    expect(session.getCalibrationError()).toBeNull();
    expect(session.isCalibrated()).toBe(true);
  });

  it('reads the LOADED options, not the defaults, when guarding', () => {
    // The ordering trap: the log guard is conditional on isLogY, and
    // loadCalibrated extracts the options FROM the axes. Guard before extract
    // and this project would open clean, because the default is isLogY=false.
    const axes = loadedXY(
      [
        [100, 300, '0', '0'],
        [400, 300, '10', '0'],
        [100, 300, '0', '0'],
        [100, 0, '0', '1000'],
      ],
      true,
      false // the model refuses a log axis through zero (2026-07-31)
    );
    const session = new CalibrationSession(XY_AXES_CONFIG);
    session.loadCalibrated(axes, [new Dataset(2)]);
    expect(session.getOptions()['isLogY']).toBe('true');
    expect(session.getCalibrationError()).toBeTruthy();
  });

  it('catches a log axis whose endpoints change sign in a LOADED project', () => {
    // The old guard only tested === 0. A log axis with one negative and one
    // positive endpoint falls to the else-branch's Math.log(negative) = NaN, so
    // every value reads back NaN while calibrate() still returned true.
    const axes = loadedXY(
      [
        [100, 300, '0', '0'],
        [400, 300, '10', '0'],
        [100, 300, '0', '-5'],
        [100, 0, '0', '1000'],
      ],
      true,
      false // the model refuses a sign-mixed log axis too (2026-07-31)
    );
    const session = new CalibrationSession(XY_AXES_CONFIG);
    session.loadCalibrated(axes, [new Dataset(2)]);
    expect(session.getCalibrationError()).toMatch(/change sign/i);
  });

  it('catches distinct-but-collinear calibration points (parallel axes) in a LOADED project', () => {
    // X1->X2 and Y1->Y2 both horizontal: the pixel transform is singular even
    // though no two points share a pixel, so inv2x2 divides by zero and every
    // value reads back NaN while calibrate() still returned true. The same-pixel
    // guard cannot see this - only a determinant/parallel check can.
    const axes = loadedXY([
      [100, 300, '0', '0'],
      [200, 300, '10', '0'],
      [100, 300, '0', '0'],
      [300, 300, '0', '10'],
    ]);
    const session = new CalibrationSession(XY_AXES_CONFIG);
    session.loadCalibrated(axes, [new Dataset(2)]);
    expect(session.getCalibrationError()).toMatch(/parallel/i);
  });
});

/** Build a PolarAxes the way the load path does. Points: origin, P1, P2. */
function loadedPolar(points: Array<[number, number, string, string]>): PolarAxes {
  const cal = new Calibration(2);
  for (const [px, py, dx, dy] of points) cal.addPoint(px, py, dx, dy);
  const axes = new PolarAxes();
  const ok = axes.calibrate(cal, true, false, false); // degrees, anticlockwise, linear r
  expect(ok).toBe(true); // the axes is happy with input the guard refuses
  return axes;
}

describe('Polar equal-radius guard - P1 and P2 must be at different radii (A3)', () => {
  it('catches P1 and P2 the same distance from the origin in a LOADED project', () => {
    // Origin (200,200); P1 (300,200) and P2 (200,100) are BOTH 100px from the
    // origin -> radial scale dist12 = 0 -> every r reads non-finite, while
    // calibrate() still returned true. distinctPixelSteps can't see this (no
    // shared pixel); only the radial-distinct check can.
    const axes = loadedPolar([
      [200, 200, '', ''], // origin
      [300, 200, '5', '0'], // P1: dist 100
      [200, 100, '10', ''], // P2: dist 100 - equidistant
    ]);
    const session = new CalibrationSession(POLAR_AXES_CONFIG);
    session.loadCalibrated(axes, [new Dataset(2)]);
    expect(session.getCalibrationError()).toMatch(/same distance from the origin/i);
  });

  it('a healthy Polar project (P1 and P2 at different radii) loads clean', () => {
    const axes = loadedPolar([
      [200, 200, '', ''], // origin
      [300, 200, '5', '0'], // P1: dist 100
      [400, 200, '10', ''], // P2: dist 200
    ]);
    const session = new CalibrationSession(POLAR_AXES_CONFIG);
    session.loadCalibrated(axes, [new Dataset(2)]);
    expect(session.getCalibrationError()).toBeNull();
    expect(session.isCalibrated()).toBe(true);
  });
});

/**
 * ⚑ THE MAP SCALE - a length of zero measured everything as zero.
 *
 * Found in the same 2026-07-31 sweep as the log-axis defect above, and the
 * more serious of the two because it needs no file at all: a user draws a
 * scale bar, types `0` for its real-world length, and the calibration reports
 * SUCCESS with no error while every distance and area reads exactly 0.
 *
 * `core/axes/map.ts` now refuses it, which finally lets MAP_AXES_CONFIG's own
 * `if (!ok)` fire - but that message says "check the entered data values are
 * valid numbers", and 0 is a valid number. Telling a user to fix what is not
 * broken is a UX defect in its own right (tenet 7), so the requirement is
 * stated by a `checkValues` that runs on BOTH doors.
 */
describe('the map scale states its own requirement, on both doors', () => {
  function clickedMap(length: string): CalibrationSession<MapAxes> {
    const session = new CalibrationSession<MapAxes>(MAP_AXES_CONFIG);
    session.handleCalibrationClick(100, 100);
    session.confirmCalibrationValues([]);
    session.handleCalibrationClick(300, 100);
    session.confirmCalibrationValues([length]);
    return session;
  }

  it('⚑ names the ZERO requirement rather than calling a valid number invalid', () => {
    const session = clickedMap('0');
    expect(session.runCalibration()).toBe(false);
    expect(session.getCalibrationError()).toMatch(/greater than zero/i);
    // And it says WHY, because "greater than zero" alone reads as a rule
    // rather than a consequence.
    expect(session.getCalibrationError()).toMatch(/every measurement read 0/i);
  });

  it('refuses a negative length with the same words', () => {
    const session = clickedMap('-5');
    expect(session.runCalibration()).toBe(false);
    expect(session.getCalibrationError()).toMatch(/greater than zero/i);
  });

  it('names a non-numeric length differently, because that is a different fix', () => {
    const session = clickedMap('abc');
    expect(session.runCalibration()).toBe(false);
    expect(session.getCalibrationError()).toMatch(/must be a number/i);
  });

  it('accepts an ordinary length, including a fractional one', () => {
    expect(clickedMap('10').runCalibration()).toBe(true);
    expect(clickedMap('2.5').runCalibration()).toBe(true);
  });

  it('⚑ catches the same zero length in a LOADED project', () => {
    // The model refuses it now, so `calibrate()` answers false - and the
    // session guard is what turns that into words the user can act on.
    const cal = new Calibration(2);
    cal.addPoint(100, 100, '0', '0');
    cal.addPoint(300, 100, '0', '0'); // the length rides in P2's dx
    const axes = new MapAxes();
    expect(axes.calibrate(cal, '0', 'mm', 'top-left', 500)).toBe(false);

    const session = new CalibrationSession<MapAxes>(MAP_AXES_CONFIG);
    session.loadCalibrated(axes, [new Dataset(2)]);
    expect(session.getCalibrationError()).toMatch(/greater than zero/i);
  });

  it('a healthy map project still loads clean', () => {
    const cal = new Calibration(2);
    cal.addPoint(100, 100, '0', '0');
    cal.addPoint(300, 100, '10', '0');
    const axes = new MapAxes();
    expect(axes.calibrate(cal, '10', 'mm', 'top-left', 500)).toBe(true);

    const session = new CalibrationSession<MapAxes>(MAP_AXES_CONFIG);
    session.loadCalibrated(axes, [new Dataset(2)]);
    expect(session.getCalibrationError()).toBeNull();
  });
});

/**
 * ⚑ THE AXES CLASS'S OWN VERDICT, on the file door - round-2 audit.
 *
 * `core/plotData.ts` calls `calibrate()` when loading and pushes the axes
 * whatever it answers. So a project whose calibration value is unparseable -
 * hand-edited, truncated, or written by a foreign importer - opened with NO
 * error at all and read 0 for every point, while the click path refused the
 * identical input by name.
 *
 * `checkGuards` covers log-through-zero, coincident pixels and collinearity,
 * and deliberately leaves parseability "to the parser" (its own comment says
 * so) - and on this entrance nobody was listening to the parser.
 */
describe('a file whose calibration the model could not read says so', () => {
  it('⚑ surfaces an error for an unparseable calibration value', () => {
    const cal = new Calibration(2);
    cal.addPoint(100, 300, '0', '0');
    cal.addPoint(400, 300, 'abc', '0'); // not a number
    cal.addPoint(100, 300, '0', '0');
    cal.addPoint(100, 0, '0', '10');
    const axes = new XYAxes();
    // The model refuses it -- this is the answer the file door discarded.
    expect(axes.calibrate(cal, false, false, false)).toBe(false);

    const session = new CalibrationSession(XY_AXES_CONFIG);
    session.loadCalibrated(axes, [new Dataset(2)]);
    expect(session.getCalibrationError()).toBeTruthy();
    expect(session.getCalibrationError()).toMatch(/calibration/i);
  });

  it('⚑ still SURFACES rather than refuses - the points come with it', () => {
    // Same decision the rest of this file documents: refusing to open would
    // strand data the previous version wrote.
    const cal = new Calibration(2);
    cal.addPoint(100, 300, '0', '0');
    cal.addPoint(400, 300, 'abc', '0');
    cal.addPoint(100, 300, '0', '0');
    cal.addPoint(100, 0, '0', '10');
    const axes = new XYAxes();
    axes.calibrate(cal, false, false, false);
    const dataset = new Dataset(2);
    dataset.addPixel(200, 200);
    dataset.addPixel(250, 180);
    const session = new CalibrationSession(XY_AXES_CONFIG);
    session.loadCalibrated(axes, [dataset]);
    expect(session.getDataPoints()).toHaveLength(2);
  });

  it('a healthy project still loads with no error - the guard adds no false positive', () => {
    const axes = loadedXY([
      [100, 300, '0', '0'],
      [400, 300, '10', '0'],
      [100, 300, '0', '0'],
      [100, 0, '0', '10'],
    ]);
    const session = new CalibrationSession(XY_AXES_CONFIG);
    session.loadCalibrated(axes, [new Dataset(2)]);
    expect(session.getCalibrationError()).toBeNull();
  });
});
