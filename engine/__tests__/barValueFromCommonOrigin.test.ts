import { describe, expect, it } from 'vitest';
import { BAR_AXES_CONFIG, SPAN_AXES_CONFIG, CalibrationSession } from '../calibrationSession.js';
import type { BarAxes } from '../../core/axes/bar.js';
import { walkCategoryAxis } from './helpers/categoryWalk.js';

/**
 * ⚑⚑ A BAR IS MEASURED FROM THE FIGURE'S COMMON ORIGIN (v2.5, David).
 *
 * *"They all NEED (for bars) to come to the same common axis."* And: *"the top
 * corner mark is vital for the value, and the second is vital for the width."*
 *
 * ▶ THE GENERATORS SAY THE SAME THING, which is how the question was settled
 * (tenet 11b). `matplotlib.axes.Axes.bar(x, height, width=0.8, bottom=None)`
 * documents `bottom : float or array-like, default: 0`: a bar chart is ONE
 * number per bar over a SHARED origin, and passing `bottom` as an ARRAY is how
 * the same call draws a floating bar. A per-bar base on a bar chart IS the
 * encoding of a span.
 *
 * ⚠️ WHAT THIS REPLACED, and it lasted about six hours: the near end's y was a
 * gate on the value, so a bar clicked two pixels below the axis reported NOTHING
 * AT ALL. Measured, not imagined - see the case named for it below.
 *
 * ⚑ The near end is still the user's input, still stored and still drawn. It
 * keeps two jobs: the bar's WIDTH (with the far corner's x), and the seating
 * REPORT that tells a user their figure might be a Span chart. What it no longer
 * does is decide whether they are allowed a number.
 */

// P1=0 @ (300,500), P2=10 @ (300,100) - the convention every bar fixture uses,
// so 40 px to the unit.
function calibratedBar(
  session: CalibrationSession<BarAxes>,
  count = 2,
  options: Record<string, string> = {}
): void {
  for (const [k, v] of Object.entries(options)) session.setOption(k, v);
  session.handleCalibrationClick(300, 500);
  session.confirmCalibrationValues(['0']);
  session.handleCalibrationClick(300, 100);
  session.confirmCalibrationValues(['10']);
  walkCategoryAxis(session, { count });
  expect(session.runCalibration()).toBe(true);
}

/** A bar sitting on the baseline in category 1, worth 5. */
function seatedBar(s: CalibrationSession<BarAxes>): void {
  s.addDataPoint(150, 500);
  s.addDataPoint(150, 300);
}

/** Category 2, floating between 2.5 and 7.5 - it touches nothing. */
function floatingBar(s: CalibrationSession<BarAxes>): void {
  s.addDataPoint(350, 400);
  s.addDataPoint(350, 200);
}

describe('a bar reports its value whatever its near end did', () => {
  it('⚑⚑ a bar clicked TWO PIXELS below the baseline still reports - the hand is not a precondition', () => {
    // ⚠️ THE CASE THAT NAMES THE DEFECT. Two pixels is what a person aiming at
    // an axis line is out by; `BASELINE_TOLERANCE_PX` exists precisely because
    // of that, measured on David's own figure. Under the gate this row came back
    // with an empty Value and no way to tell it from a category with no bar.
    const s = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    calibratedBar(s);
    s.addDataPoint(150, 502); // two pixels BELOW the axis
    s.addDataPoint(150, 300); // up to 5
    expect(s.getBarCategoryTable().columns[0]!.cells[0]![0]).toBeCloseTo(5, 6);
  });

  it('⚑ a floating bar reports the corner AWAY from the baseline, measured from it', () => {
    const s = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    calibratedBar(s);
    floatingBar(s); // 2.5 .. 7.5, touching nothing
    // The far corner is 7.5 and the origin is 0, so the bar is worth 7.5 - the
    // number `bar(x, height, bottom=0)` would be handed to draw it.
    expect(s.getBarCategoryTable().columns[0]!.cells[1]![0]).toBeCloseTo(7.5, 6);
  });

  it('a bar drawn DOWN from the origin keeps its sign', () => {
    const s = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    calibratedBar(s);
    s.addDataPoint(150, 500); // on the origin
    s.addDataPoint(150, 600); // 100 px below it: -2.5
    expect(s.getBarCategoryTable().columns[0]!.cells[0]![0]).toBeCloseTo(-2.5, 6);
  });

  it('⚑⚑ and the origin is MEASURED off the category axis, not typed or assumed', () => {
    // David: *"We set the calibration on the value axis (y-axis), and THEN! we
    // also set the x-axis with a value. baseline value == x axis position."*
    // The walk's third click is a point ON the line the bars stand on, so a
    // figure whose x-axis is drawn at 2 - a truncated bar chart - is captured by
    // clicking it there. py 420 IS the value 2 on this scale.
    const s = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    for (const [k, v] of Object.entries({})) s.setOption(k, v as string);
    s.handleCalibrationClick(300, 500);
    s.confirmCalibrationValues(['0']);
    s.handleCalibrationClick(300, 100);
    s.confirmCalibrationValues(['10']);
    walkCategoryAxis(s, { count: 2, from: { x: 100, y: 420 }, to: { x: 500, y: 420 } });
    expect(s.runCalibration()).toBe(true);
    s.addDataPoint(150, 420); // ON the axis the bars stand on
    s.addDataPoint(150, 300); // value 5
    expect(s.getBarCategoryTable().columns[0]!.cells[0]![0]).toBeCloseTo(3, 6);
  });
});

describe('a bar that does not reach the origin is REPORTED, not refused', () => {
  it('⚑⚑ says so beside the number, because that is how a user finds the Span chart', () => {
    const s = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    calibratedBar(s);
    seatedBar(s);
    floatingBar(s);
    const table = s.getBarCategoryTable();
    // Both bars report. THAT is the correction.
    expect(table.columns[0]!.cells.map((c) => c[0]).map((v) => v !== null)).toEqual([true, true]);
    // And the one that floats is named.
    expect(table.advisory).toEqual([
      { seriesIndex: 0, categoryIndex: 1, tupleIndex: 1, kind: 'off-baseline' },
    ]);
  });

  it('says nothing about a figure whose bars all sit down', () => {
    const s = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    calibratedBar(s);
    seatedBar(s);
    expect(s.getBarCategoryTable().advisory).toEqual([]);
  });

  it('⚠️ a half-dragged bar is INCOMPLETE - a different state, with its own cell', () => {
    const s = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    calibratedBar(s);
    s.addDataPoint(150, 500); // one corner only
    expect(s.getBarCategoryTable().advisory).toEqual([]);
  });

  it('⚑ a STACKED segment is SUPPOSED to sit clear of it, so the observation carries nothing', () => {
    const s = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    calibratedBar(s, 2, { isStacked: 'true' });
    floatingBar(s);
    const table = s.getBarCategoryTable();
    expect(table.columns[0]!.cells[1]![0]).toBeCloseTo(5, 6); // its own height
    expect(table.advisory).toEqual([]);
  });

  it('⚑⚑ a SPAN reports both ends and has no origin to miss', () => {
    const s = new CalibrationSession<BarAxes>(SPAN_AXES_CONFIG);
    calibratedBar(s, 2);
    floatingBar(s);
    const table = s.getBarCategoryTable();
    expect(table.columns[0]!.cells[1]).toEqual([2.5, 7.5]);
    expect(table.advisory).toEqual([]);
  });
});

/**
 * ⚑⚑ A SPAN IS CAPTURED THE WAY A BAR IS, AND THE SPLIT LEFT THAT BEHIND (v2.5).
 *
 * `capturesAsBox` is the type saying its two points are OPPOSITE CORNERS. Bar
 * declared it; Span, whose whole datum IS the box, did not - so two things went
 * missing at once, and only one of them was visible.
 *
 * ⚠️ MEASURED IN THE BUILT APP, not reasoned about: a corner-to-corner drag on a
 * Span chart recorded NOTHING - zero rows - while the tips bar told the user to
 * make exactly that gesture. The invisible half is below.
 */
describe('a span records what it measured along the category axis', () => {
  it('⚑⚑ its EXTENT is kept, not derived from where two clicks happened to land', () => {
    const s = new CalibrationSession<BarAxes>(SPAN_AXES_CONFIG);
    calibratedBar(s, 2);
    s.addDataPoint(120, 400);
    s.addDataPoint(180, 200);
    const row = s.getTupleRows()[0]!;
    // ⚑ Without `capturesAsBox` this is null, and the width the user measured is
    // dropped on the floor - a COORDINATE DERIVED where it should have been
    // MEASURED, which is one of tenet 11's two named failure modes.
    expect(row.positionSpan).not.toBeNull();
    expect(row.positionSpan![0]).toBeLessThan(row.positionSpan![1]);
  });

  it('⚑ and a BAR keeps the same extent, because that is what its second corner is FOR', () => {
    // David: *"the top corner mark is vital for the value, and the second is
    // vital for the width... to separate columns from each other."*
    const s = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    calibratedBar(s, 2);
    s.addDataPoint(120, 500);
    s.addDataPoint(180, 300);
    const row = s.getTupleRows()[0]!;
    expect(row.positionSpan).not.toBeNull();
    expect(row.positionSpan![0]).toBeLessThan(row.positionSpan![1]);
  });
});
