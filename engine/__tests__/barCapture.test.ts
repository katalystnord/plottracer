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

describe('a stacked-bar segment (v2.0, Phase 5)', () => {
  it('defaults to no stack group', () => {
    const session = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    expect(session.getDatasetStackGroup(0)).toBeNull();
  });

  it('reads as an UNSIGNED span, regardless of drag direction -- not baseline-relative', () => {
    // ⚑ The reason this can't just reuse the baseline-relative rule: a
    // stacked segment's near end is never the chart's declared baseline --
    // not even the bottommost layer, which sits on nothing but still isn't
    // "at zero" in the sense the baseline convention means. A contribution to
    // a stack is never negative, so magnitude is what's meaningful.
    const session = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    calibratedBar(session);
    session.setDatasetStackGroup(0, 'left');
    session.addDataPoint(150, 420); // value 2
    session.addDataPoint(150, 300); // value 5
    expect(session.getTupleRows()[0]!.derived).toBeCloseTo(3, 9);
  });

  it('reads the SAME unsigned span with drag direction reversed', () => {
    const session = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    calibratedBar(session);
    session.setDatasetStackGroup(0, 'left');
    session.addDataPoint(150, 300); // value 5
    session.addDataPoint(150, 420); // value 2
    expect(session.getTupleRows()[0]!.derived).toBeCloseTo(3, 9); // still +3, not -3
  });

  it('a bottommost layer touching the declared baseline still reads as a span, not baseline-relative', () => {
    // The case that would otherwise be indistinguishable from an ordinary
    // baseline-anchored bar: this segment's near end genuinely IS at the
    // chart's baseline (value 0) -- but it's tagged as part of a stack, so
    // its value must still be its own span (5), not "5 - baseline" (also 5
    // here, coincidentally -- see the next test for where they'd diverge).
    const session = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    calibratedBar(session);
    session.setDatasetStackGroup(0, 'left');
    session.addDataPoint(150, 500); // value 0 -- the baseline itself
    session.addDataPoint(150, 300); // value 5
    expect(session.getTupleRows()[0]!.derived).toBeCloseTo(5, 9);
  });

  it('a non-zero declared baseline does not leak into a stacked segment\'s value', () => {
    // Where the two rules would actually disagree: baseline declared at 2.
    // Baseline-relative would read 5-2=3; the stacked rule ignores the
    // baseline entirely and reads the segment's own span, 20-15=5.
    const session = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    session.setOption('baselineValue', '2');
    calibratedBar(session);
    session.setDatasetStackGroup(0, 'left');
    session.addDataPoint(150, 200); // value 7.5
    session.addDataPoint(150, 100); // value 10
    expect(session.getTupleRows()[0]!.derived).toBeCloseTo(2.5, 9); // |10 - 7.5|, not baseline-relative
  });

  it('removing the stack tag (null) reverts to the ordinary sign convention', () => {
    const session = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    calibratedBar(session);
    session.setDatasetStackGroup(0, 'left');
    session.addDataPoint(150, 700); // value -5
    session.addDataPoint(150, 500); // value 0 (baseline)
    expect(session.getTupleRows()[0]!.derived).toBeCloseTo(5, 9); // stacked: unsigned span

    session.setDatasetStackGroup(0, null);
    expect(session.getDatasetStackGroup(0)).toBeNull();
    // Same two pixels, re-read under the ordinary baseline-relative rule.
    expect(session.getTupleRows()[0]!.derived).toBeCloseTo(-5, 9); // -5 (far) - 0 (baseline)
  });

  it('two independent stack groups keep separate segment counts -- no assumption they match', () => {
    // The real chart this resolves: a bidirectional stacked bar with 2
    // segments on one side and 3 on the other (a real figure from the
    // survey). Nothing here enforces symmetry between groups.
    const session = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    calibratedBar(session);
    session.setDatasetStackGroup(0, 'left');
    session.addDataset('Right layer 1');
    session.addDataset('Right layer 2');
    session.addDataset('Right layer 3');
    session.setDatasetStackGroup(1, 'right');
    session.setDatasetStackGroup(2, 'right');
    session.setDatasetStackGroup(3, 'right');
    expect(session.getDatasetStackGroup(0)).toBe('left');
    expect([1, 2, 3].map((i) => session.getDatasetStackGroup(i))).toEqual(['right', 'right', 'right']);
  });
});
