import { describe, expect, it } from 'vitest';
import { BAR_AXES_CONFIG, CalibrationSession } from '../calibrationSession.js';
import type { BarAxes } from '../../core/axes/bar.js';

/**
 * Capturing a bar — two clicks, opposite corners (v2.0).
 *
 * A bar is a 2-slot OBJECT tuple (`BAR_INTERVAL_SLOTS`), same shape as pie's
 * sector / histogram's bin — see `BAR_AXES_CONFIG` in calibrationSession.ts.
 * These tests exercise the sign convention specifically: a baseline-anchored
 * bar signs by comparing calibrated VALUES to the declared baseline (never
 * raw pixel position — see the file's own comment on why that would be
 * backwards for a bar below baseline); a floating bar (no declared
 * baseline) signs by drag/click order instead, since there is no reference
 * to compare against.
 */

// P1=0 @ (300,500), P2=10 @ (300,100) -- vertical bar-value scale, increasing
// upward. value(y) = (500 - y) / 40.
function calibratedBar(session: CalibrationSession<BarAxes>): void {
  session.handleCalibrationClick(300, 500);
  session.confirmCalibrationValues(['0']);
  session.handleCalibrationClick(300, 100);
  session.confirmCalibrationValues(['10']);
  expect(session.runCalibration()).toBe(true);
}

describe('the record shape itself', () => {
  it('is a 2-slot OBJECT tuple, exportShape tuples, from the moment the session exists', () => {
    const session = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    expect(session.getSlotNames()).toEqual(['Bar start', 'Bar end']);
    expect(session.hasSlots()).toBe(true);
    expect(session.getExportShape()).toBe('tuples');
  });

  it('has no derived value until the second corner lands', () => {
    const session = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    calibratedBar(session);
    session.addDataPoint(150, 500);
    expect(session.getTupleRows()[0]!.derived).toBeNull();
  });
});

describe('a baseline-anchored bar (the default: hasBaseline true, value 0)', () => {
  it('defaults to a shared baseline at zero -- walked past, no setup needed', () => {
    const session = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    expect(session.getOptions()).toMatchObject({ hasBaseline: 'true', baselineValue: '0' });
  });

  it('reads a POSITIVE bar above the baseline', () => {
    const session = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    calibratedBar(session);
    // Drag from the baseline (y=500, value 0) up to the bar's top (y=300, value 5).
    session.addDataPoint(150, 500);
    session.addDataPoint(150, 300);
    expect(session.getTupleRows()[0]!.derived).toBeCloseTo(5, 9);
  });

  it('reads the SAME value with the drag direction reversed', () => {
    const session = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    calibratedBar(session);
    session.addDataPoint(150, 300); // top first
    session.addDataPoint(150, 500); // baseline second
    expect(session.getTupleRows()[0]!.derived).toBeCloseTo(5, 9);
  });

  it('reads a NEGATIVE bar below the baseline correctly -- sign from VALUE comparison, not pixel position', () => {
    // ⚑ The case a pixel-position rule ("smaller y = far end") gets backwards:
    // this bar's far end has a LARGER y-pixel than its baseline end, since it
    // extends further DOWN the image. Comparing calibrated values instead
    // needs no special-casing for this at all.
    const session = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    calibratedBar(session);
    session.addDataPoint(150, 500); // baseline, value 0
    session.addDataPoint(150, 700); // value -5, extrapolated below the reference
    expect(session.getTupleRows()[0]!.derived).toBeCloseTo(-5, 9);
  });

  it('reads the same negative value with the drag direction reversed too', () => {
    const session = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    calibratedBar(session);
    session.addDataPoint(150, 700);
    session.addDataPoint(150, 500);
    expect(session.getTupleRows()[0]!.derived).toBeCloseTo(-5, 9);
  });

  it('honours a non-zero declared baseline', () => {
    const session = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    session.setOption('baselineValue', '2');
    calibratedBar(session);
    session.addDataPoint(150, 420); // value 2 -- the declared baseline
    session.addDataPoint(150, 300); // value 5
    expect(session.getTupleRows()[0]!.derived).toBeCloseTo(3, 9); // 5 - 2
  });

  it('checkValues refuses a non-numeric declared baseline, on the interactive door', () => {
    const session = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    session.setOption('baselineValue', 'abc');
    session.handleCalibrationClick(300, 500);
    session.confirmCalibrationValues(['0']);
    session.handleCalibrationClick(300, 100);
    session.confirmCalibrationValues(['10']);
    expect(session.runCalibration()).toBe(false);
    expect(session.getCalibrationError()).toMatch(/baseline/i);
  });
});

describe('a floating bar (no declared baseline)', () => {
  function floatingBar(): CalibrationSession<BarAxes> {
    const session = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    session.setOption('hasBaseline', 'false');
    calibratedBar(session);
    return session;
  }

  it('signs the value by DRAG ORDER, not by distance to any reference', () => {
    // A temperature-range-style bar: drag from the lower value to the higher.
    const session = floatingBar();
    session.addDataPoint(150, 420); // value 2
    session.addDataPoint(150, 300); // value 5
    expect(session.getTupleRows()[0]!.derived).toBeCloseTo(3, 9); // end - start
  });

  it('reverses sign when the drag direction reverses -- direction IS the recorded information', () => {
    const session = floatingBar();
    session.addDataPoint(150, 300); // value 5
    session.addDataPoint(150, 420); // value 2
    expect(session.getTupleRows()[0]!.derived).toBeCloseTo(-3, 9);
  });

  it('correctly signs a bar that straddles zero, with no special-casing needed', () => {
    // The real case this resolves: a single-coloured floating interval (e.g. a
    // monthly temperature mean-to-max range) that happens to cross zero. No
    // splitting, no "crossing" concept anywhere in the capture -- the two ends
    // are just measured, and the difference is exactly what it is.
    const session = floatingBar();
    session.addDataPoint(150, 700); // value -5
    session.addDataPoint(150, 300); // value 5
    expect(session.getTupleRows()[0]!.derived).toBeCloseTo(10, 9); // 5 - (-5)
  });
});
