import { describe, expect, it } from 'vitest';
import { BAR_AXES_CONFIG, SPAN_AXES_CONFIG, CalibrationSession } from '../calibrationSession.js';
import type { BarAxes } from '../../core/axes/bar.js';
import { walkCategoryAxis } from './helpers/categoryWalk.js';

/**
 * Capturing a bar - two clicks, opposite corners (v2.0).
 *
 * A bar is a 2-slot OBJECT tuple (`BAR_INTERVAL_SLOTS`), same shape as pie's
 * sector / histogram's bin - see `BAR_AXES_CONFIG` in calibrationSession.ts.
 * These tests exercise the sign convention specifically: a baseline-anchored
 * bar signs by comparing calibrated VALUES to the declared baseline (never
 * raw pixel position - see the file's own comment on why that would be
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
  walkCategoryAxis(session);
  expect(session.runCalibration()).toBe(true);
}

describe('the record shape itself', () => {
  it('is a 2-slot OBJECT tuple, exportShape tuples, from the moment the session exists', () => {
    const session = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    expect(session.getSlotNames()).toEqual(['Min', 'Max']);
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
    walkCategoryAxis(session);
    expect(session.runCalibration()).toBe(false);
    expect(session.getCalibrationError()).toMatch(/baseline/i);
  });
});

/**
 * ⚑⚑ THIS BLOCK MOVED TO SPAN CHART IN v2.5, HELPER AND ALL. The behaviour it
 * describes did not change by one assertion - two measured ends, sorted, no
 * Value column - it simply stopped being something Bar does. Bar now means what
 * its name says: measured from a baseline.
 */
describe('a span has no single VALUE - its record IS the interval', () => {
  /**
   * ⚑⚑ REWRITTEN v2.3, AND THE OLD ANSWER WAS THE DEFECT. These used to assert
   * that a floating bar reports its SPAN. Measured against
   * `samples/bar-floating-temperature.truth.json`, the `Value` column reported
   * -7.95 for January (-8..2) and 15 for April (3..15): a MINIMUM on some rows
   * and a MAXIMUM on others, under one heading. A span is no better - it answers
   * "how tall" where the reader asked "where".
   * ▶ A bar that does not sit on the baseline is an INTERVAL. Both ends are
   * measured, both reach the record, and the panel and the file say `Min` and
   * `Max` rather than inventing one number out of two.
   */
  function floatingBar(): CalibrationSession<BarAxes> {
    const session = new CalibrationSession<BarAxes>(SPAN_AXES_CONFIG);
    session.setOption('hasBaseline', 'false');
    calibratedBar(session);
    return session;
  }

  it('reports NO single value', () => {
    const session = floatingBar();
    session.addDataPoint(150, 420); // value 2
    session.addDataPoint(150, 300); // value 5
    expect(session.getTupleRows()[0]!.derived).toBeNull();
  });

  it('⚑ reports both measured ends, lower first', () => {
    const session = floatingBar();
    session.addDataPoint(150, 420); // value 2
    session.addDataPoint(150, 300); // value 5
    const { interval } = session.getTupleRows()[0]!;
    expect(interval!.min).toBeCloseTo(2, 9);
    expect(interval!.max).toBeCloseTo(5, 9);
  });

  it('⚑⚑ gives the SAME interval whichever corner is clicked first', () => {
    // THE INVARIANT, and it outlived the value rule that used to carry it.
    // Until 2026-08-03 the derived number was `v2 - v1`, so drag order carried a
    // sign: two people capturing the identical bar got +3 and -3. Min and Max
    // are properties of the INTERVAL; which corner the hand reached first is not
    // a property of the figure at all, which is exactly why `Bar start` and
    // `Bar end` were the wrong names for them.
    const upward = floatingBar();
    upward.addDataPoint(150, 420); // value 2
    upward.addDataPoint(150, 300); // value 5

    const downward = floatingBar();
    downward.addDataPoint(150, 300); // value 5 -- the same bar, opposite order
    downward.addDataPoint(150, 420); // value 2

    expect(downward.getTupleRows()[0]!.interval).toEqual(upward.getTupleRows()[0]!.interval);
  });

  it('a bar entirely below zero keeps its POSITION, which a span threw away', () => {
    // The fixture maps py 300 -> 5 and py 700 -> -5, so py 780 is -7.
    // The old rule answered 2 for this bar, which is true of its height and says
    // nothing about where on the axis it sits.
    const session = floatingBar();
    session.addDataPoint(150, 700); // value -5
    session.addDataPoint(150, 780); // value -7
    const { interval } = session.getTupleRows()[0]!;
    expect(interval!.min).toBeCloseTo(-7, 9);
    expect(interval!.max).toBeCloseTo(-5, 9);
  });

  it('a bar that straddles zero needs no special case', () => {
    // A single-coloured floating interval (a monthly mean-to-max range) that
    // happens to cross zero. No splitting, no "crossing" concept anywhere: the
    // two ends are measured and reported as they are.
    const session = floatingBar();
    session.addDataPoint(150, 700); // value -5
    session.addDataPoint(150, 300); // value 5
    const { interval } = session.getTupleRows()[0]!;
    expect(interval!.min).toBeCloseTo(-5, 9);
    expect(interval!.max).toBeCloseTo(5, 9);
  });

  it('⚑⚑ and a DECLARED baseline does not make a floating bar baseline-relative', () => {
    // THE MEASURED DISCRIMINATOR, which is the whole fix. `bar-floating-temperature`
    // declares a baseline of 0 and every one of its bars floats above or below
    // it. Asking "was a baseline declared" got this wrong for every row.
    const session = new CalibrationSession<BarAxes>(SPAN_AXES_CONFIG);
    calibratedBar(session); // hasBaseline true, baseline 0, by default
    session.addDataPoint(150, 420); // value 2
    session.addDataPoint(150, 300); // value 5
    expect(session.getAxes()!.hasDeclaredBaseline()).toBe(true);
    expect(session.getTupleRows()[0]!.derived).toBeNull();
    expect(session.getTupleRows()[0]!.interval!.min).toBeCloseTo(2, 9);
  });

  it('⚑ while a bar that DOES sit on the baseline still reports a signed value', () => {
    const session = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    calibratedBar(session);
    session.addDataPoint(150, 500); // value 0 -- on the baseline
    session.addDataPoint(150, 700); // value -5, drawn downward
    expect(session.getTupleRows()[0]!.derived).toBeCloseTo(-5, 9);
    expect(session.getTupleRows()[0]!.interval).toBeNull();
  });
});

describe('a stacked-bar segment (declared on the AXES since v2.3)', () => {
  /** A calibrated bar session that declares the figure draws stacked bars. */
  function stackedBar(baselineValue = '0'): CalibrationSession<BarAxes> {
    const session = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    session.setOption('isStacked', 'true');
    session.setOption('baselineValue', baselineValue);
    calibratedBar(session);
    return session;
  }

  it('⚑⚑ the declaration is asked ONCE, on the calibration card, not per series', () => {
    // It replaces `Stack group`, a per-series free-text field whose NAME was
    // never read: its only consumer tested it for non-empty, so any two strings
    // behaved identically. David: *"THIS is where we should ask if the bars are
    // stacked!"* - beside the two questions of the same kind already there.
    const keys = BAR_AXES_CONFIG.options?.map((o) => o.key) ?? [];
    expect(keys).toContain('isStacked');
    expect(keys).toContain('hasBaseline');
    expect(keys).toContain('isRotated');
  });

  it('defaults to not stacked, which is the ordinary bar chart', () => {
    const session = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    calibratedBar(session);
    expect(session.getAxes()!.isStacked()).toBe(false);
  });

  it('reads as an UNSIGNED span, regardless of drag direction -- not baseline-relative', () => {
    // ⚑ The reason this can't just reuse the baseline-relative rule: a
    // stacked segment's near end is never the chart's declared baseline --
    // not even the bottommost layer, which sits on nothing but still isn't
    // "at zero" in the sense the baseline convention means. A contribution to
    // a stack is never negative, so magnitude is what's meaningful.
    const session = stackedBar();
    session.addDataPoint(150, 420); // value 2
    session.addDataPoint(150, 300); // value 5
    expect(session.getTupleRows()[0]!.derived).toBeCloseTo(3, 9);
  });

  it('reads the SAME unsigned span with drag direction reversed', () => {
    const session = stackedBar();
    session.addDataPoint(150, 300); // value 5
    session.addDataPoint(150, 420); // value 2
    expect(session.getTupleRows()[0]!.derived).toBeCloseTo(3, 9); // still +3, not -3
  });

  it('a bottommost layer touching the declared baseline still reads as a span', () => {
    // The case that would otherwise be indistinguishable from an ordinary
    // baseline-anchored bar: this segment's near end genuinely IS at the
    // chart's baseline (value 0) -- but the figure is declared stacked, so its
    // value must still be its own span.
    const session = stackedBar();
    session.addDataPoint(150, 500); // value 0 -- the baseline itself
    session.addDataPoint(150, 300); // value 5
    expect(session.getTupleRows()[0]!.derived).toBeCloseTo(5, 9);
  });

  it("a non-zero declared baseline does not leak into a stacked segment's value", () => {
    // Where the two rules actually disagree: baseline declared at 2.
    // Baseline-relative would read 10-2=8; the stacked rule ignores the
    // baseline entirely and reads the segment's own span, 10-7.5=2.5.
    const session = stackedBar('2');
    session.addDataPoint(150, 200); // value 7.5
    session.addDataPoint(150, 100); // value 10
    expect(session.getTupleRows()[0]!.derived).toBeCloseTo(2.5, 9);
  });

  it('⚑⚑ every series is stacked together, because the figure is', () => {
    // ⚑ THE DEFECT SHAPE THIS DELETES (v2.3 audit fleet, R1). The old per-series
    // tag was read off the ACTIVE dataset index while the apex beside it was
    // read off the ROW'S index, so on a stacked chart every series but one was
    // valued by the wrong rule - and which one was right depended on what
    // happened to be selected when Export was pressed. One declaration on the
    // axes has no per-series index to get wrong.
    const session = stackedBar();
    session.addDataPoint(150, 420);
    session.addDataPoint(150, 300);
    session.addDataset('Layer 2');
    session.setActiveDataset(1);
    session.addDataPoint(250, 300);
    session.addDataPoint(250, 100); // values 5 and 10 -> span 5
    expect(session.getTupleRows(0)[0]!.derived).toBeCloseTo(3, 9);
    expect(session.getTupleRows(1)[0]!.derived).toBeCloseTo(5, 9);
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
    // ⚑⚑ THE CATEGORY AXIS RUNS DOWN, because on a HORIZONTAL bar chart the
    // value axis is the horizontal one. The default helper marks it across,
    // which on this figure would put both axes on the same line - and the
    // v2.3 parallel-axes guard refuses it, which is how this fixture was found
    // to be describing a figure nobody can draw.
    walkCategoryAxis(session, { from: { x: 300, y: 100 }, to: { x: 300, y: 500 } });
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
 * object tuple could aim at a particular corner - needed because a plain click
 * (rather than a drag) leaves a bar half-made, and with two such bars the
 * cursor could otherwise only ever default to the first gap.
 *
 * `addDataPoint`'s NEW-TUPLE branch was not loosened with it. It asked only
 * `tupleMembers === 'independent'`, and every other shape fell through to
 * `dataset.addTuple`, which ALWAYS writes slot 0. So a cursor aimed at a new
 * Bar tuple's second corner filed the click as its FIRST - recording a bar's
 * top edge as its bottom, with a plausible wrong number and nothing on screen
 * to say so. Exactly the defect the v1.4 spider audit fixed for independent
 * slots, in the branch right beside it.
 *
 * Not reachable through today's UI (the Bar table only aims at tuples that
 * already exist, and `nextSlot` resets the group to 0 when it hands back a new
 * tuple) - which is the reason to fix it in the MODEL rather than leave it: the
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
    expect(tuple[0]).toBeNull();      // Bar start - untouched
    expect(tuple[1]).not.toBeNull();  // Bar end - where the click was aimed
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

/**
 * ⚑⚑⚑ A STRAY HALF-FINISHED BAR MUST NOT ABSORB THE NEXT CAPTURE.
 *
 * David, driving his own five-colour bar chart: *"no matter if I try to place
 * points by hand or use the auto trace, the first bar gets registered on the
 * third category."*
 *
 * ⚠️ MEASURED OFF HIS SCREEN, and the arithmetic is the proof. A stray click sat
 * above the plot in the GREEN band. `addDataPoint` fills the NEXT OPEN SLOT - the
 * right rule for finishing a bar by hand, and the wrong one for a gesture that
 * carries BOTH corners - so the trace's first corner completed that stray tuple
 * and its second corner opened a new one. The record got a single bar reading
 * `Green 7.98 .. 14.19`: the stray's height paired with the red bar's top, filed
 * under a category neither of them is in.
 *
 * ⚑⚑ AND THE TWO HALVES OF ONE OPERATION DISAGREED IN WRITING. `runBarDetect`
 * had the box in band 0 throughout and said so - *"no bar found for 4 categories:
 * Blue, Green, Yellow, Pink"* - while the table filed it under Green. A detector
 * and a session contradicting each other inside one click is the tell that the
 * fault is in the FILING, not in the measurement.
 */
describe('a bar left half-finished does not swallow the next one', () => {
  /** Five categories across x 191..921, so each band is 146px wide. */
  function fiveCategories(): CalibrationSession<BarAxes> {
    const s = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    s.handleCalibrationClick(191, 900);
    s.confirmCalibrationValues(['0']);
    s.handleCalibrationClick(191, 300);
    s.confirmCalibrationValues(['20']);
    walkCategoryAxis(s, { from: { x: 191, y: 900 }, to: { x: 921, y: 900 }, count: 5 });
    expect(s.runCalibration()).toBe(true);
    return s;
  }

  it('⚑⚑ a detected box lands in ITS OWN band, with a stray sitting in another', () => {
    const s = fiveCategories();
    s.addDataPoint(544, 200); // the stray: one corner only, in band 2
    s.addBarDetectBoxes([{ start: { x: 246, y: 900 }, end: { x: 356, y: 500 } }]);
    const values = s.getBarCategoryTable().columns[0]!.values;
    // Band 0 is the traced bar's own; band 2 is the stray's and holds no reading.
    expect(values[0]).toBeCloseTo(13.33, 1);
    expect(values[2]).toBeNull();
  });

  it('⚑⚑ and neither does a hand-dragged box - the same defect, the other door', () => {
    const s = fiveCategories();
    s.addDataPoint(544, 200); // the stray
    // What `handleBoxRect` does for a real drag: start a new tuple, then both
    // corners. Without the reset these two would complete the stray's tuple.
    s.setSlotCursor(null, 0);
    s.addDataPoint(246, 900);
    s.addDataPoint(356, 500);
    const values = s.getBarCategoryTable().columns[0]!.values;
    expect(values[0]).toBeCloseTo(13.33, 1);
    expect(values[2]).toBeNull();
  });

  /**
   * ⚑ THE TWO-CLICK PATH KEEPS THE OLD RULE, deliberately: a plain click fills
   * the next open slot, which is how a bar interrupted half-way is finished on
   * purpose. Taking that away to fix the drag would break the fallback.
   */
  it('⚑ but a plain CLICK still finishes the bar that was left open', () => {
    const s = fiveCategories();
    s.addDataPoint(246, 900); // first corner by hand
    s.addDataPoint(356, 500); // second click completes THAT bar
    expect(s.getTupleRows()).toHaveLength(1);
    expect(s.getBarCategoryTable().columns[0]!.values[0]).toBeCloseTo(13.33, 1);
  });
});
