import { describe, expect, it } from 'vitest';
import { CalibrationSession, XY_AXES_CONFIG, POLAR_AXES_CONFIG } from '../calibrationSession.js';
import { XYAxes } from '../../core/axes/xy.js';
import { PolarAxes } from '../../core/axes/polar.js';
import { Calibration } from '../../core/calibration.js';
import { Dataset } from '../../core/dataset.js';

/**
 * Finding A3 (2026-07-17): `checkGuards` ran in `runCalibration` only, so every
 * refusal was CLICK-PATH-ONLY and opening a project file bypassed all of them.
 *
 * These tests build an axes the way the LOAD path does — `plotData.deserialize`
 * calls `axes.calibrate(...)` directly and hands the built instance to
 * `loadCalibrated` — deliberately never touching the session's click walk. That
 * is the door that was unguarded.
 *
 * The premise worth restating, because it is the whole reason the guards exist
 * (calibrationSession.ts:341): **every axes class reports success on degenerate
 * input.** `calibrate()` returning true proves nothing. Each test below asserts
 * that first, so a future reader can see the guard is load-bearing rather than
 * belt-and-braces.
 */

/** Build an XYAxes exactly as the load path does: calibrate() directly, no session. */
function loadedXY(points: Array<[number, number, string, string]>, isLogY = false): XYAxes {
  const cal = new Calibration(2);
  for (const [px, py, dx, dy] of points) cal.addPoint(px, py, dx, dy);
  const axes = new XYAxes();
  // (calib, isLogX, isLogY, noRotationCorrection). noRotationCorrection=false
  // matches checkpoint 68's default — WPD applies tilt correction, and so do we.
  const ok = axes.calibrate(cal, false, isLogY, false);
  // The premise: the axes is perfectly happy with input the click path refuses.
  expect(ok).toBe(true);
  return axes;
}

describe('A3 — the load path runs the same refusals as the click path', () => {
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
      true
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

  it('SURFACES rather than refuses — the points still load and are still there', () => {
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
      true
    );
    const session = new CalibrationSession(XY_AXES_CONFIG);
    session.loadCalibrated(axes, [dataset]);

    expect(session.getCalibrationError()).toBeTruthy();
    expect(session.isCalibrated()).toBe(true); // the axes loaded
    expect(session.getDataPoints()).toHaveLength(2); // and so did the work
  });

  it('stays RECOVERABLE — fixing the calibration clears the error', () => {
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
    // which is the guarded path — so the drag both fixes and re-checks.
    session.updateCalibPointPixel('x2', 400, 300);
    expect(session.getCalibrationError()).toBeNull();
    expect(session.isCalibrated()).toBe(true);
  });

  it('a HEALTHY project still loads clean — the guard adds no false positive', () => {
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
      true
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
      true
    );
    const session = new CalibrationSession(XY_AXES_CONFIG);
    session.loadCalibrated(axes, [new Dataset(2)]);
    expect(session.getCalibrationError()).toMatch(/change sign/i);
  });

  it('catches distinct-but-collinear calibration points (parallel axes) in a LOADED project', () => {
    // X1->X2 and Y1->Y2 both horizontal: the pixel transform is singular even
    // though no two points share a pixel, so inv2x2 divides by zero and every
    // value reads back NaN while calibrate() still returned true. The same-pixel
    // guard cannot see this — only a determinant/parallel check can.
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

describe('Polar equal-radius guard — P1 and P2 must be at different radii (A3)', () => {
  it('catches P1 and P2 the same distance from the origin in a LOADED project', () => {
    // Origin (200,200); P1 (300,200) and P2 (200,100) are BOTH 100px from the
    // origin -> radial scale dist12 = 0 -> every r reads non-finite, while
    // calibrate() still returned true. distinctPixelSteps can't see this (no
    // shared pixel); only the radial-distinct check can.
    const axes = loadedPolar([
      [200, 200, '', ''], // origin
      [300, 200, '5', '0'], // P1: dist 100
      [200, 100, '10', ''], // P2: dist 100 — equidistant
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
