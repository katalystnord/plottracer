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

describe('addBarDetectBoxes (v2.0, Phase 7) -- colour-detected boxes, the SAME record a manual drag-box makes', () => {
  it('files each box as its own bar tuple, two calls per box, in order', () => {
    const session = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    calibratedBar(session);
    const added = session.addBarDetectBoxes([
      { start: { x: 150, y: 500 }, end: { x: 150, y: 300 } }, // value 5
      { start: { x: 200, y: 500 }, end: { x: 200, y: 420 } }, // value 2
    ]);
    expect(added).toBe(2);
    const rows = session.getTupleRows();
    expect(rows).toHaveLength(2);
    expect(rows[0]!.derived).toBeCloseTo(5, 9);
    expect(rows[1]!.derived).toBeCloseTo(2, 9);
  });

  it('does nothing before calibration -- no axes to convert a detected box through yet', () => {
    const session = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    const added = session.addBarDetectBoxes([{ start: { x: 150, y: 500 }, end: { x: 150, y: 300 } }]);
    expect(added).toBe(0);
    expect(session.getTupleRows()).toHaveLength(0);
  });

  it('does nothing on a 5-slot Box Plot session -- no "opposite corners" a bbox could mean there', () => {
    const session = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    calibratedBar(session);
    session.applyBoxPlotGroups();
    const added = session.addBarDetectBoxes([{ start: { x: 150, y: 500 }, end: { x: 150, y: 300 } }]);
    expect(added).toBe(0);
    expect(session.getTupleRows()).toHaveLength(0);
  });

  it('files boxes in READING ORDER along the category axis, regardless of the order detection found them in', () => {
    // ⚑ detectBlobs's own order is a top-to-bottom pixel scan (an
    // implementation detail of the flood fill), which for an ordinary
    // baseline-anchored bar chart reads as tallest-bar-first -- David,
    // driving the real app against a real 6-bar figure: the numbering
    // went 1,3,5,7,9,11 tallest-to-shortest instead of left-to-right,
    // scrambling genuinely ordered categorical data (e.g. day 0,4,7,14).
    // Fed here in an ARBITRARY (deliberately non-positional) order to
    // prove the fix sorts by position, not by input order.
    const session = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    calibratedBar(session);
    const added = session.addBarDetectBoxes([
      { start: { x: 400, y: 500 }, end: { x: 400, y: 100 } }, // rightmost, tallest (value 10)
      { start: { x: 150, y: 500 }, end: { x: 150, y: 460 } }, // leftmost, shortest (value 1)
      { start: { x: 300, y: 500 }, end: { x: 300, y: 300 } }, // middle (value 5)
    ]);
    expect(added).toBe(3);
    const rows = session.getTupleRows();
    // Left-to-right by x, not the input order and not sorted-by-height order.
    expect(rows.map((r) => r.derived)).toEqual([
      expect.closeTo(1, 9),
      expect.closeTo(5, 9),
      expect.closeTo(10, 9),
    ]);
  });

  it('...and sorts top-to-bottom (by y) instead, for a rotated/horizontal bar session', () => {
    const session = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    session.setOption('isRotated', 'true');
    session.handleCalibrationClick(300, 500);
    session.confirmCalibrationValues(['0']);
    session.handleCalibrationClick(700, 500);
    session.confirmCalibrationValues(['10']);
    expect(session.runCalibration()).toBe(true);

    const added = session.addBarDetectBoxes([
      { start: { x: 300, y: 400 }, end: { x: 500, y: 430 } }, // bottom row (value 5)
      { start: { x: 300, y: 100 }, end: { x: 340, y: 130 } }, // top row (value 1)
      { start: { x: 300, y: 250 }, end: { x: 700, y: 280 } }, // middle row (value 10)
    ]);
    expect(added).toBe(3);
    const rows = session.getTupleRows();
    expect(rows.map((r) => r.derived)).toEqual([
      expect.closeTo(1, 9),
      expect.closeTo(10, 9),
      expect.closeTo(5, 9),
    ]);
  });
});

/**
 * ⚑ THE TWO SLOT GUARDS MUST AGREE, and for a while they did not.
 *
 * `setSlotCursor` was loosened in the v2.0 pre-launch audit so Bar's 2-slot
 * object tuple could aim at a particular corner — needed because a plain click
 * (rather than a drag) leaves a bar half-made, and with two such bars the
 * cursor could otherwise only ever default to the first gap.
 *
 * `addDataPoint`'s NEW-TUPLE branch was not loosened with it. It asked only
 * `tupleMembers === 'independent'`, and every other shape fell through to
 * `dataset.addTuple`, which ALWAYS writes slot 0. So a cursor aimed at a new
 * Bar tuple's second corner filed the click as its FIRST — recording a bar's
 * top edge as its bottom, with a plausible wrong number and nothing on screen
 * to say so. Exactly the defect the v1.4 spider audit fixed for independent
 * slots, in the branch right beside it.
 *
 * Not reachable through today's UI (the Bar table only aims at tuples that
 * already exist, and `nextSlot` resets the group to 0 when it hands back a new
 * tuple) — which is the reason to fix it in the MODEL rather than leave it: the
 * guard lived in the session while the model had a second entrance.
 */
describe('aiming the cursor at a slot of a tuple that does not exist yet', () => {
  it('files the click into the slot it was AIMED at, not slot 0', () => {
    const session = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    calibratedBar(session);

    // Aim at "Bar end" (slot 1) of a brand-new tuple.
    expect(session.setSlotCursor(null, 1)).toBe(true);
    session.addDataPoint(150, 300);

    const tuple = session.getDataset().getAllTuples()[0]!;
    expect(tuple[0]).toBeNull();      // Bar start — untouched
    expect(tuple[1]).not.toBeNull();  // Bar end — where the click was aimed
  });

  it('still starts at slot 0 when the cursor was never aimed', () => {
    // The ordinary path must be unchanged: a first click with no aiming fills
    // the first corner, exactly as a drag-capture expects.
    const session = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    calibratedBar(session);
    session.addDataPoint(150, 500);
    const tuple = session.getDataset().getAllTuples()[0]!;
    expect(tuple[0]).not.toBeNull();
    expect(tuple[1]).toBeNull();
  });

  it('leaves a 5-slot box plot refused, so the fix cannot over-reach', () => {
    // setSlotCursor deliberately excludes ordinal multi-slot shapes; the
    // new-tuple branch must not quietly re-admit them.
    const session = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    calibratedBar(session);
    expect(session.setSlotCursor(null, 99)).toBe(false);
  });
});
