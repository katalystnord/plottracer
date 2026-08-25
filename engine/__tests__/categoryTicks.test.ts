import { describe, expect, it } from 'vitest';
import {
  BAR_AXES_CONFIG,
  BOX_PLOT_AXES_CONFIG,
  CATEGORICAL_LINE_CONFIG,
  HISTOGRAM_AXES_CONFIG,
  PIE_AXES_CONFIG,
  POLAR_AXES_CONFIG,
  SPIDER_AXES_CONFIG,
  XY_AXES_CONFIG,
  CalibrationSession,
} from '../calibrationSession.js';
import type { BarAxes } from '../../core/axes/bar.js';
import type { CalibratedAxes } from '../axesTypeConfigs.js';
import { runBarDetect } from '../barDetectRun.js';
import { categoryMissReport } from '../colorTraceReport.js';
import { reconcileWithExpected } from '../../algorithms/barSplit.js';
import { walkCategoryAxis } from './helpers/categoryWalk.js';
import { loadWithoutCategoryAxis } from './helpers/noCategoryAxis.js';

/**
 * CATEGORY TICKS, wired into the session (v2.1).
 *
 * ⚑ WHAT THIS FILE IS ACTUALLY FOR. The geometry itself is tested in
 * `core/__tests__/categoryAxis.test.ts`, where it is pure. What only the SESSION
 * can get wrong is the wiring: which graph types may have ticks at all, which
 * placed pixel seeds the axis, and whether the geometry survives the three other
 * entrances this codebase keeps being bitten by - an image edit, the undo
 * snapshot, and a reset.
 *
 * ⚑ Ticks are an AID. Nothing here should ever assert that a tick changes a
 * measured VALUE, because none of them do.
 */

const A = { x: 100, y: 500 };
const B = { x: 600, y: 500 };

/**
 * A calibrated Bar session whose category axis runs A..B with `n` categories.
 *
 * ⚑⚑ ONE HELPER NOW, NOT TWO (v2.4). There used to be `calibratedBar()` and
 * `withTicks(n)`, because a bar chart could be calibrated WITHOUT its category
 * axis and the ticks were marked afterwards through a fold-out that seeded its
 * first edge from P1. Both ends are calibration steps now, so a calibrated
 * bar-family session has its axis by construction and the second helper has
 * nothing left to do.
 * ⚑ The seed is what made the two-helper shape necessary and it is also what
 * made the axis wrong: P1's prompt is *"a known bar value (e.g. 0)"*, which
 * promises nothing about where the categories start.
 */
function withTicks(n = 4): CalibrationSession<BarAxes> {
  const s = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
  s.handleCalibrationClick(A.x, A.y);
  s.confirmCalibrationValues(['0']);
  s.handleCalibrationClick(100, 100);
  s.confirmCalibrationValues(['10']);
  walkCategoryAxis(s, { from: A, to: B, count: n });
  expect(s.runCalibration()).toBe(true);
  return s;
}

/**
 * The same session with NO category axis - which is what a WPD IMPORT produces,
 * permanently, not a legacy file.
 *
 * ⚠️ THE OLD NOTE HERE SAID *"a project saved before v2.4, which is the only way
 * to reach the un-ticked path now"*, and that was wrong in the direction that
 * matters. This project has no users and owes its own old files nothing
 * ([[feedback_dont_overbuild_legacy_migration]]); `WPD_AXES_TO_CONFIG` maps
 * `BarAxes` to `bar` and WebPlotDigitizer has no category axis, so every
 * imported bar chart lands here - tenet 6, and forever. Describing a permanent
 * interop state as expiring legacy support is how it came to be built by a
 * mutator no user can reach.
 */
function calibratedBar(): CalibrationSession<BarAxes> {
  const s = withTicks();
  loadWithoutCategoryAxis(s, s.getAxes()!, s.getDatasets());
  return s;
}

describe('which graph types have categories at all', () => {
  it('the tuple-shaped bar types, which are the ones that can consume a band', () => {
    for (const config of [BAR_AXES_CONFIG, BOX_PLOT_AXES_CONFIG]) {
      const s = new CalibrationSession(config as never);
      expect(s.supportsCategoryTicks(), config.id).toBe(true);
    }
    for (const config of [XY_AXES_CONFIG, HISTOGRAM_AXES_CONFIG, SPIDER_AXES_CONFIG,
                          PIE_AXES_CONFIG, POLAR_AXES_CONFIG]) {
      const s = new CalibrationSession(config as never);
      expect(s.supportsCategoryTicks(), config.id).toBe(false);
    }
  });

  it('⚑⚑ categorical Line TOO, as of v2.3 - and its seed is `v1`, not `p1`', () => {
    // ⚠️ THIS TEST USED TO ASSERT THE OPPOSITE, and correctly: *"a declared band
    // has nothing to write to until the per-point path stores an index, and a
    // control that does nothing is worse than no control."* The per-point path
    // now reads its category from the marked axis, so the precondition is met
    // and the capability is real.
    //
    // ⚑ It was the LAST type failing the tenet-11 generation audit: its category
    // came from left-to-right click order, which is computed PER SERIES, so a
    // series missing one category slid every later reading a category to the
    // left. See `categoricalLineIsBanded.test.ts` for the measured numbers.
    //
    // ⚑ `v1` because a Line has no origin corner to seed from - its calibration
    // is two points on the VALUE axis. That is exactly why `categoryTicks`
    // declares `originStep` as a name rather than a literal, and this is the
    // prediction the old comment made coming true.
    const s = new CalibrationSession(CATEGORICAL_LINE_CONFIG as never);
    expect(s.supportsCategoryTicks()).toBe(true);
  });

  it('⚑ every mutator refuses on a type with no categories, leaving nothing behind', () => {
    // Otherwise a stray call could give a spider tick geometry, which would then
    // serialize into its project file and mean nothing to anyone.
    const s = new CalibrationSession<CalibratedAxes>(SPIDER_AXES_CONFIG as never);
    expect(s.setCategoryCount(4)).toBe(false);
    expect(s.setCategoryTickConvention('edge')).toBe(false);
    expect(s.moveCategoryTick(0, A)).toBe(false);
    expect(s.markCategories()).toBe(false);
    expect(s.categoryBandAt(300, 300)).toBeNull();
    expect(s.getCategoryAxis().hasGeometry()).toBe(false);
  });
});

/**
 * ⛔ THE SEED IS GONE (v2.4), and with it this file's `the seed pixel - what
 * makes marking the axis one click, not two` block.
 *
 * It asserted that `categoryTickOriginPixel()` is P1 once placed, *"the value
 * origin sits on the category axis edge"* - a claim about the FIGURE that the
 * calibration never asked for. P1's own prompt is *"a known bar value (e.g.
 * 0)"*, so clicking the zero gridline mid-plot is ordinary calibration and
 * anchored the category axis in the middle of the figure. On David's
 * floating-temperature chart it anchored at -10 on the left spine and the axis
 * came out diagonal. Both ends are calibration steps now; there is no seed to
 * test.
 */

describe('marking the axis and declaring the categories', () => {
  it('the whole gesture: reuse P1, click the far edge, say how many', () => {
    const s = withTicks(4);
    const ca = s.getCategoryAxis();
    expect(ca.hasGeometry()).toBe(true);
    expect(ca.getAxisEdges()).toEqual([{ x: 100, y: 500 }, { x: 600, y: 500 }]);
    expect(ca.getTickPoints().map((p) => p.x)).toEqual([162.5, 287.5, 412.5, 537.5]);
  });

  it('refuses a degenerate axis, the model’s own guard reaching through', () => {
    // ⚑⚑ ASKED OF THE MODEL, because the session wrapper that used to ask it
    // is gone. The WALK's refusal of the same figure is a separate assertion and
    // lives with the walk (`confirmCalibrationValues` runs `checkGuards` the
    // moment the two ends are in); this one keeps the guard itself asserted, so
    // deleting the wrapper did not quietly delete the rule.
    const s = calibratedBar();
    expect(s.getCategoryAxis().setAxisEdges(A, { ...A })).toBe(false);
    expect(s.getCategoryAxis().hasGeometry()).toBe(false);
  });

  it('files a bar under the category it sits in', () => {
    const s = withTicks(4); // bands at x = 100-225, 225-350, 350-475, 475-600
    expect(s.categoryBandAt(150, 300)).toBe(0);
    expect(s.categoryBandAt(300, 300)).toBe(1);
    expect(s.categoryBandAt(550, 300)).toBe(3);
  });

  it('RE-PLACING the axis keeps every category - the user is fixing the axis, not abandoning them', () => {
    // ⚑⚑ RE-PLACING IS DRAGGING THE TWO HANDLES, which is the only gesture
    // that exists for it since v2.4. The names must survive the move: the user
    // is saying where the axis runs, not abandoning the categories they typed.
    const s = withTicks(3);
    s.getCategoryAxis().renameCategory(0, 'Flax');
    s.updateCalibPointPixel('c1', 150, 480);
    s.updateCalibPointPixel('c2', 650, 480);
    expect(s.getCategoryAxis().getAxisEdges()).toEqual([{ x: 150, y: 480 }, { x: 650, y: 480 }]);
    expect(s.getCategoryAxis().getCategories()).toEqual(['Flax', '', '']);
  });

  it('does not gate the calibration - a bar chart calibrates with no ticks at all', () => {
    const s = calibratedBar();
    expect(s.isCalibrated()).toBe(true);
    expect(s.getCategoryAxis().hasGeometry()).toBe(false);
  });
});

describe('⚑ the geometry survives the OTHER entrances', () => {
  it('an image edit moves the edges, and the ticks follow', () => {
    const s = withTicks(4);
    s.transformAllPixels((px, py) => ({ x: px + 40, y: py - 25 }));
    const ca = s.getCategoryAxis();
    expect(ca.getAxisEdges()).toEqual([{ x: 140, y: 475 }, { x: 640, y: 475 }]);
    expect(ca.getTickPoints().map((p) => p.x)).toEqual([202.5, 327.5, 452.5, 577.5]);
  });

  it('⚑ an image edit does NOT discard ticks the user dragged', () => {
    // setAxisEdges regenerates, so moving the edges naively would silently undo
    // the user's adjustments -- an image rotation quietly reverting their work.
    const s = withTicks(4);
    s.moveCategoryTick(1, { x: 300, y: 500 });
    const dragged = [...s.getCategoryAxis().getTickParams()];
    s.transformAllPixels((px, py) => ({ x: px + 40, y: py }));
    expect(s.getCategoryAxis().getTickParams()).toEqual(dragged);
    expect(s.getCategoryAxis().hasAdjustments()).toBe(true);
  });

  it('⚑⚑ but re-declaring a DIFFERENT count DOES regenerate, ends unmoved', () => {
    // ⚑⚑ THE COMPANION ASSERTION to the test above, and the reason this one
    // exists: that guard is a DISABLING one. It stops `runCalibration` from
    // rebuilding the ticks, and the only thing separating "does not throw away
    // the user's drags" from "can never change the count again" is that the
    // count is re-read AFTER the ends are compared. Nothing else in the suite
    // says so, so widening the guard by one line would pass everything.
    const s = withTicks(4);
    s.moveCategoryTick(1, { x: 300, y: 500 });
    expect(s.getCategoryAxis().hasAdjustments()).toBe(true);
    const edges = s.getCategoryAxis().getAxisEdges();

    expect(s.setCalibrationValues('c2', ['6'])).toBe(true);

    expect(s.getCategoryAxis().getCategoryCount()).toBe(6);
    expect(s.getCategoryAxis().getTickPoints()).toHaveLength(6);
    // ⚑ And the ENDS did not move, which is what makes this the count's own
    // path rather than `setAxisEdges` regenerating as a side effect.
    expect(s.getCategoryAxis().getAxisEdges()).toEqual(edges);
    // ⚑ A count change is a NEW set of boundaries, so the old drag is gone -
    // correctly. There is no tick 1 of four left to have been adjusted.
    expect(s.getCategoryAxis().hasAdjustments()).toBe(false);
  });

  it('a rotation carries the geometry onto a tilted axis', () => {
    const s = withTicks(2);
    // 90 degrees about the origin: (x,y) -> (-y,x)
    s.transformAllPixels((px, py) => ({ x: -py, y: px }));
    expect(s.getCategoryAxis().getAxisEdges()).toEqual([{ x: -500, y: 100 }, { x: -500, y: 600 }]);
    expect(s.getCategoryAxis().getTickPoints()).toEqual([
      { x: -500, y: 225 },
      { x: -500, y: 475 },
    ]);
  });

  it('⚑ UNDO carries it - the snapshot is an entrance too', () => {
    const s = withTicks(4);
    s.setCategoryTickConvention('edge');
    s.moveCategoryTick(0, { x: 200, y: 500 });
    s.getCategoryAxis().renameCategory(2, 'Jute');
    const before = s.captureState();
    const ticks = [...s.getCategoryAxis().getTickParams()];

    // ⚑⚑ THE MUTATION IS A HANDLE DRAG, the gesture that actually exists.
    // Moving an end regenerates the ticks by design, so the user's dragged tick
    // and its adjusted flag are exactly what undo has to bring back.
    s.updateCalibPointPixel('c2', 800, 500);
    expect(s.getCategoryAxis().getAxisEdges()).toEqual([{ x: 100, y: 500 }, { x: 800, y: 500 }]);
    expect(s.getCategoryAxis().hasAdjustments()).toBe(false);

    s.restoreState(before);
    const ca = s.getCategoryAxis();
    expect(ca.hasGeometry()).toBe(true);
    expect(ca.getConvention()).toBe('edge');
    expect(ca.getTickParams()).toEqual(ticks);
    expect(ca.hasAdjustments()).toBe(true);
    expect(ca.getCategories()[2]).toBe('Jute');
    expect(ca.getAxisEdges()).toEqual([{ x: 100, y: 500 }, { x: 600, y: 500 }]);
  });

  it('⚑⚑ deleting ONE bar under bands does not wipe every category', () => {
    // THE DEFECT (v2.1 audit). `pruneOrphanedCategories` asked which categories
    // are still owned by reading `metadata.categoryIndex` -- the STORED-INDEX
    // door. Under bands capture stores no such index by design, so `owned` came
    // back empty, all four categories were classified orphans, and deleting one
    // row emptied the table while three bars stayed on the canvas.
    const s = withTicks(4);
    const xs = [150, 275, 400, 525];
    for (const x of xs) {
      s.addDataPoint(x, 300);
      s.addDataPoint(x, 500);
    }
    expect(s.getCategoryAxis().getCategories()).toHaveLength(4);
    expect(s.getBarCategoryTable().columns[0]?.values.filter((v) => v !== null)).toHaveLength(4);

    s.removeTuple(0);

    // Three bars remain, so three readings must remain -- and the DECLARED count
    // must not have moved underneath them, because the count is the user's
    // statement about the figure, not a tally of what is captured. An empty
    // category is exactly the state this feature exists to record.
    expect(s.getCategoryAxis().getCategories()).toHaveLength(4);
    expect(s.getCategoryAxis().hasDeclaredCount()).toBe(true);
    expect(s.getBarCategoryTable().columns[0]?.values.filter((v) => v !== null)).toHaveLength(3);
  });

  it('⚑ and the sweep still runs where it belongs - the UN-ticked path', () => {
    // The guard must not switch the sweep off everywhere. Without ticks a
    // category exists only because a bar reserved it, so removing that bar
    // genuinely does leave an orphan, and the old behaviour is correct.
    const s = calibratedBar();
    s.addDataPoint(150, 300);
    s.addDataPoint(150, 500);
    s.addDataPoint(400, 350);
    s.addDataPoint(400, 500);
    expect(s.getCategoryAxis().getCategories()).toHaveLength(2);
    s.removeTuple(0);
    expect(s.getCategoryAxis().getCategories()).toHaveLength(1);
  });

  it('⚑⚑ UNDO does not INVENT a declared count - the rows must not reorder', () => {
    // THE DEFECT, found by two independent reviewers (v2.1 audit).
    //
    // `_countDeclared` was not serialized; the load door guessed it back as
    // "there are categories, so a count was declared". But categories also come
    // into existence one at a time on the UN-ticked path, so the reachable state
    // "axis marked, no count typed, bars captured" round-tripped into BAND mode
    // -- and every bar's category flipped from the index it was captured under
    // to whichever band it happens to sit in. One Ctrl+Z was the whole trigger,
    // and nothing on screen said anything had changed.
    //
    // ⚑⚑ THE FIGURE IS AN IMPORT, not a marked axis with the count left out.
    // That second state is unreachable since v2.4 - the count is typed on the
    // click that places the second end - but the PROPERTY this guards is not:
    // a WPD import has no category axis at all, so `_countDeclared` is false and
    // must still be false after a round trip.
    const s = calibratedBar();
    expect(s.getCategoryAxis().hasDeclaredCount()).toBe(false);

    // Two bars captured RIGHT to LEFT, so band order and capture order disagree.
    s.addDataPoint(520, 300);
    s.addDataPoint(520, 500);
    s.addDataPoint(180, 400);
    s.addDataPoint(180, 500);
    const before = s.getBarCategoryTable().columns[0]?.values.slice();
    expect(before).toHaveLength(2);

    const snap = s.captureState();
    s.restoreState(snap);

    expect(s.getCategoryAxis().hasDeclaredCount()).toBe(false);
    expect(s.getBarCategoryTable().columns[0]?.values).toEqual(before);
  });

  it('⚑ but a count the user DID declare survives the same round trip', () => {
    // The guard must not over-reach: storing the flag has to keep band mode for
    // anyone who actually asked for it, or the fix trades one silent flip for
    // the opposite one.
    const s = withTicks(3);
    expect(s.getCategoryAxis().hasDeclaredCount()).toBe(true);
    const snap = s.captureState();
    s.restoreState(snap);
    expect(s.getCategoryAxis().hasDeclaredCount()).toBe(true);
  });

  it('undo of an unmarked session restores an unmarked one, not a stale axis', () => {
    const s = calibratedBar();
    const blank = s.captureState();
    walkCategoryAxis(s, { from: A, to: B, count: 3 });
    s.runCalibration();
    s.restoreState(blank);
    expect(s.getCategoryAxis().hasGeometry()).toBe(false);
  });

  it('“Reset calibration” discards the marks with everything else', () => {
    const s = withTicks(3);
    s.reset();
    expect(s.getCategoryAxis().hasGeometry()).toBe(false);
    expect(s.getCategoryAxis().getCategories()).toEqual([]);
  });

  it('clearing the POINTS leaves the marks alone - they describe the figure', () => {
    const s = withTicks(3);
    s.addDataPoint(150, 500);
    s.addDataPoint(150, 300);
    s.clearPoints();
    expect(s.getDataset().getTupleCount()).toBe(0);
    expect(s.getCategoryAxis().hasGeometry()).toBe(true);
    expect(s.getCategoryAxis().getTickParams()).toHaveLength(3);
  });
});

/** Capture one bar as a drag-box at category coordinate `x`. */
function barAt(s: CalibrationSession<BarAxes>, x: number, topY = 300): void {
  s.addDataPoint(x, 500);
  s.addDataPoint(x, topY);
}

describe('⚑ a bar belongs to its BAND - the guess is gone, not fenced', () => {
  /** Three categories across x = 100..600: bands 100-266.7, 266.7-433.3, 433.3-600. */
  const FLAX = 183;
  const HEMP = 350;
  const JUTE = 517;

  it('⚑ THE DEFECT THIS FEATURE EXISTS FOR: the first series is the incomplete one', () => {
    // Verified against the live session before any of this was built: series 1
    // has no Hemp bar, so Hemp never came into being, and series 2's Hemp bar
    // took its nearest donor's name -- exporting a bar labelled "Jute" that is
    // not Jute, with the real Jute bar left blank. Order-dependent, and
    // left-to-right (the natural direction) was the one that lied.
    const s = withTicks(3);
    barAt(s, FLAX);
    s.setTupleLabel(0, 'Flax');
    barAt(s, JUTE);
    s.setTupleLabel(1, 'Jute');

    s.addDataset('Series 2');
    barAt(s, FLAX);
    barAt(s, HEMP); // no donor exists for this one
    barAt(s, JUTE);

    expect([0, 1, 2].map((t) => s.getTupleLabel(t))).toEqual(['Flax', '', 'Jute']);
    // Nothing anywhere claims to be a category it is not.
    expect(s.getCategoryAxis().getCategories()).toEqual(['Flax', '', 'Jute']);
  });

  it('⚑ and the answer does not depend on capture ORDER any more', () => {
    const build = (order: number[]): string[] => {
      const s = withTicks(3);
      barAt(s, FLAX);
      s.setTupleLabel(0, 'Flax');
      barAt(s, JUTE);
      s.setTupleLabel(1, 'Jute');
      s.addDataset('Series 2');
      for (const x of order) barAt(s, x);
      return order.map((_x, t) => s.getTupleLabel(t));
    };
    // Right-to-left produces the same names against the same bars.
    expect(build([FLAX, HEMP, JUTE])).toEqual(['Flax', '', 'Jute']);
    expect(build([JUTE, HEMP, FLAX])).toEqual(['Jute', '', 'Flax']);
  });

  it('⚑ appends no category on capture - the declared count is the count', () => {
    // Without the band, every unmatched bar reserves a fresh empty category,
    // which would push the list past the declared N and leave the ticks stale.
    const s = withTicks(3);
    barAt(s, FLAX);
    barAt(s, HEMP);
    barAt(s, JUTE);
    expect(s.getCategoryAxis().getCategoryCount()).toBe(3);
    expect(s.getCategoryAxis().ticksAreStale()).toBe(false);
  });

  it('renaming a bar renames its BAND, for every series at once', () => {
    const s = withTicks(3);
    barAt(s, HEMP);
    s.addDataset('Series 2');
    barAt(s, HEMP);
    expect(s.setTupleLabel(0, 'Hemp')).toBe(true);
    expect(s.getTupleLabel(0)).toBe('Hemp');
    expect(s.getTupleLabel(0, 0)).toBe('Hemp'); // the other series' bar, same band
    expect(s.getCategoryAxis().getCategories()).toEqual(['', 'Hemp', '']);
  });

  it('⚑ moving a divider RE-HOMES the bars that crossed it', () => {
    // The reason the category is derived rather than stored: a stored index
    // would still say band 0 while the bar now sits in band 1.
    const s = withTicks(2); // divider at x = 350
    barAt(s, 300); // band 0, just left of the divider
    expect(s.getCategoryAxis().getConvention()).toBe('centred');
    expect(s.categoryBandAt(300, 300)).toBe(0);

    // Drag the only centred tick left, pulling the derived midpoint with it.
    s.moveCategoryTick(0, { x: 120, y: 500 });
    expect(s.categoryBandAt(300, 300)).toBe(1);
    const table = s.getBarCategoryTable();
    expect(table.columns[0]!.values[0]).toBeNull(); // band 0 is empty now
    expect(table.columns[0]!.values[1]).not.toBeNull(); // the bar moved into band 1
  });
});

describe('the table shows every declared category, empty ones included', () => {
  it('⚑ a series missing its middle bar leaves a HOLE, not a shifted row', () => {
    const s = withTicks(3);
    barAt(s, 183, 300); // value 5
    barAt(s, 517, 400); // value 2.5
    const table = s.getBarCategoryTable();
    expect(table.categoryNames).toEqual(['Category 1', 'Category 2', 'Category 3']);
    expect(table.columns).toHaveLength(1);
    expect(table.columns[0]!.values).toEqual([5, null, 2.5]);
    expect(table.columns[0]!.tupleIndices).toEqual([0, null, 1]);
  });

  it('declares its rows before any bar is captured at all', () => {
    const s = withTicks(4);
    const table = s.getBarCategoryTable();
    expect(table.categoryNames).toHaveLength(4);
    expect(table.columns[0]!.values).toEqual([null, null, null, null]);
  });
});

describe('the un-ticked path is untouched', () => {
  it('still uses the nearest-donor prefill when no axis is marked', () => {
    const s = calibratedBar();
    barAt(s, 150);
    s.setTupleLabel(0, 'Flax');
    barAt(s, 350);
    s.setTupleLabel(1, 'Jute');
    s.addDataset('Series 2');
    barAt(s, 152);
    expect(s.getTupleLabel(0)).toBe('Flax'); // prefilled from the donor
  });

  /**
   * ⚑⚑ DELETED: `clearing the marks hands the job back to the stored index`.
   *
   * It named a bar, marked an axis AFTER the fact so the band answered instead,
   * then CLEARED the marks and checked the name came back from the stored index.
   * The middle step is fine; the last one has no door left. Nothing keeps a
   * calibrated figure and drops its category axis - `clearCategoryAxisGeometry`
   * and `removeCategoryTicks` were the only two, and both were mutators no
   * production code ever called. A saved file cannot hold named categories with
   * no geometry either, because the walk that names them is the walk that builds
   * them.
   *
   * ▶ The LIVE half of what it guarded - the stored index answering on a figure
   * with no bands - is exercised where that state really occurs: an import, in
   * `categoryOfferPromotes` ("one unmarked series exports Position") and in
   * `barCategoryTable` ("WITHOUT a marked axis ... a bar still gets its own
   * slot").
   */
});

// ---------------------------------------------------------------------------
// Splitting a merged run at the declared dividers, through the detector.
// ---------------------------------------------------------------------------

/** An RGBA image with `bars` drawn in one colour on white. */
function figureWith(w: number, h: number, bars: [number, number, number, number][]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(w * h * 4).fill(255);
  for (const [x0, y0, x1, y1] of bars) {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const o = (y * w + x) * 4;
        data[o] = 20; data[o + 1] = 60; data[o + 2] = 140; data[o + 3] = 255;
      }
    }
  }
  return data;
}

describe('⚑ the detector cuts a merged run at the declared dividers', () => {
  const W = 60;
  const H = 30;
  // Three TOUCHING bars of one colour: one blob, three different heights.
  const TOUCHING = figureWith(W, H, [[0, 4, 19, 25], [20, 14, 39, 25], [40, 9, 59, 25]]);
  const BLUE: [number, number, number] = [20, 60, 140];

  it('without declared categories it is still one oversized bar', () => {
    // The limit this feature exists for, asserted so the fix has something to be
    // measured against.
    const r = runBarDetect(TOUCHING, W, H, BLUE, 30);
    expect('boxes' in r).toBe(true);
    if (!('boxes' in r)) return;
    expect(r.blobs).toBe(1);
    expect(r.boxes).toHaveLength(1);
  });

  it('with them, it recovers three bars from the one blob', () => {
    const r = runBarDetect(TOUCHING, W, H, BLUE, 30, 'foreground', undefined, undefined, {
      dividers: [0, 20, 40, 60],
      categoryAxis: 'x',
      expected: 3,
    });
    expect('boxes' in r).toBe(true);
    if (!('boxes' in r)) return;
    expect(r.blobs).toBe(1); // still one blob...
    expect(r.boxes).toHaveLength(3); // ...but three bars
    // ⚑ Each piece carries its OWN top edge, which is the whole point: a single
    // bounding box would have reported the tallest for all three.
    expect(r.boxes.map((b) => b.start.y)).toEqual([4, 14, 9]);
    expect(r.expectation).toEqual({ expected: 3, found: 3, complete: true, emptyBands: [] });
  });

  it('⚑ NAMES the category that came up empty, rather than returning a short table', () => {
    // Three categories declared; the middle one has no ink at all. A table that
    // is quietly missing a row looks finished, which is the failure this exists
    // to prevent.
    const gapped = figureWith(W, H, [[2, 4, 18, 25], [42, 9, 58, 25]]);
    const r = runBarDetect(gapped, W, H, BLUE, 30, 'foreground', undefined, undefined, {
      dividers: [0, 20, 40, 60],
      categoryAxis: 'x',
      expected: 3,
    });
    if (!('boxes' in r)) throw new Error('expected boxes');
    expect(r.boxes).toHaveLength(2);
    expect(r.expectation).toEqual({ expected: 3, found: 2, complete: false, emptyBands: [1] });
  });

  it('⚑ names an empty band whether it came from a SPLIT or from no blob at all', () => {
    // The middle category is empty here because its bar was never detected --
    // not because a merged run was cut. Equally absent, equally named.
    const gapped = figureWith(W, H, [[2, 4, 18, 25], [42, 9, 58, 25]]);
    const r = runBarDetect(gapped, W, H, BLUE, 30, 'foreground', undefined, undefined, {
      dividers: [0, 20, 40, 60],
      categoryAxis: 'x',
      expected: 3,
    });
    if (!('boxes' in r)) throw new Error('expected boxes');
    expect(r.blobs).toBe(2); // two separate blobs, no split involved
    expect(r.expectation?.emptyBands).toEqual([1]);
  });

  it('leaves a blob that sits inside ONE band exactly as it was', () => {
    // Separated bars already work; re-measuring them could only move a reading
    // that was already right.
    const separated = figureWith(W, H, [[2, 4, 15, 25], [42, 9, 55, 25]]);
    const plain = runBarDetect(separated, W, H, BLUE, 30);
    const withCats = runBarDetect(separated, W, H, BLUE, 30, 'foreground', undefined, undefined, {
      dividers: [0, 20, 40, 60],
      categoryAxis: 'x',
    });
    if (!('boxes' in plain) || !('boxes' in withCats)) throw new Error('expected boxes');
    expect(withCats.boxes).toEqual(plain.boxes);
  });

  it('declared categories with fewer than two dividers change nothing', () => {
    const plain = runBarDetect(TOUCHING, W, H, BLUE, 30);
    const odd = runBarDetect(TOUCHING, W, H, BLUE, 30, 'foreground', undefined, undefined, {
      dividers: [10],
      categoryAxis: 'x',
    });
    if (!('boxes' in plain) || !('boxes' in odd)) throw new Error('expected boxes');
    expect(odd.boxes).toEqual(plain.boxes);
  });

  it('no expectation is reported when no count was declared', () => {
    const r = runBarDetect(TOUCHING, W, H, BLUE, 30, 'foreground', undefined, undefined, {
      dividers: [0, 20, 40, 60],
      categoryAxis: 'x',
    });
    if (!('boxes' in r)) throw new Error('expected boxes');
    expect(r).not.toHaveProperty('expectation');
  });
});

describe('the dividers the DETECTOR is handed', () => {
  it('is nothing at all until an axis is marked - so the detector call is unchanged', () => {
    // ⚑ The whole un-ticked path depends on this being null: a caller passing it
    // straight through gets exactly the pre-v2.1 behaviour.
    expect(calibratedBar().categoryDividersForDetect()).toBeNull();
    const s = new CalibrationSession<CalibratedAxes>(SPIDER_AXES_CONFIG as never);
    expect(s.categoryDividersForDetect()).toBeNull();
  });

  it('hands over scalar positions along the category axis, ascending', () => {
    const s = withTicks(4); // axis x=100..600, centred
    expect(s.categoryDividersForDetect()).toEqual({
      dividers: [100, 225, 350, 475, 600],
      categoryAxis: 'x',
      reversed: false,
    });
  });

  it('⚑ MEASURES the direction from the marked axis, not from the option', () => {
    // "Horizontal bars" and the marked axis are independent declarations today,
    // so asking the geometry is the one that cannot disagree with what was drawn.
    //
    // ⚑⚑ THE FIGURE HAD TO BE MADE POSSIBLE. This used to mark a VERTICAL
    // category axis on a chart whose VALUE axis is vertical too - two parallel
    // axes, which the walk refuses at the gesture. It passed because
    // `markCategoryAxis` wrote the geometry straight into the model and never
    // met the guard. A vertical category axis means HORIZONTAL bars, so the
    // value axis runs across: that is the figure this test is about.
    const s = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    s.handleCalibrationClick(100, 300);
    s.confirmCalibrationValues(['0']);
    s.handleCalibrationClick(500, 300);
    s.confirmCalibrationValues(['10']);
    walkCategoryAxis(s, { from: { x: 90, y: 100 }, to: { x: 90, y: 600 }, count: 2 });
    expect(s.runCalibration()).toBe(true);
    const d = s.categoryDividersForDetect()!;
    expect(d.categoryAxis).toBe('y');
    expect(d.dividers).toEqual([100, 350, 600]);
  });

  it('follows a dragged tick, so what the detector cuts on is what is on screen', () => {
    const s = withTicks(2);
    s.moveCategoryTick(0, { x: 150, y: 500 });
    const d = s.categoryDividersForDetect()!;
    expect(d.dividers[1]).toBeGreaterThan(100);
    expect(d.dividers[1]).toBeLessThan(350); // the midpoint moved with the tick
  });
});

describe('the divider handover holds up against the awkward cases', () => {
  it('⚑ refuses even when geometry was set on the axis DIRECTLY, bypassing the session', () => {
    // The session gate refuses to MARK an axis on a type with no categories, but
    // getCategoryAxis() hands out the object, so the model can be reached around
    // the gate. The guard has to hold on the way out too, or a spider could feed
    // dividers to the bar detector.
    const s = new CalibrationSession<CalibratedAxes>(SPIDER_AXES_CONFIG as never);
    s.getCategoryAxis().setAxisEdges(A, B);
    s.getCategoryAxis().setCategoryCount(3);
    expect(s.getCategoryAxis().hasGeometry()).toBe(true);
    expect(s.categoryDividersForDetect()).toBeNull();
  });

  it('⚑ hands over ASCENDING dividers even for an axis marked right-to-left', () => {
    // Nothing stops a user clicking the far end first. The dividers then come out
    // of the model descending, and splitRunAtDividers requires ascending -- it
    // would cut nothing at all and the feature would silently do nothing.
    const s = calibratedBar();
    walkCategoryAxis(s, { from: { x: 600, y: 500 }, to: { x: 100, y: 500 }, count: 4 });
    s.runCalibration();
    const d = s.categoryDividersForDetect()!;
    expect(d.dividers).toEqual([...d.dividers].sort((a, b) => a - b));
    expect(d.dividers).toEqual([100, 225, 350, 475, 600]);
  });
});

describe('⚑ the two ways a bar could vanish from the table (code review, 2026-08-10)', () => {
  it('⚑⚑ an axis with GEOMETRY but no declared COUNT cannot be reached', () => {
    // ⚑⚑ WHAT THIS REPLACES, and why it is stronger. Two tests used to
    // describe what happens in that state - every captured bar existing in the
    // record with NO ROW AT ALL, and a count-less axis behaving as an unmarked
    // one. Both were real defects, and both were reachable only because
    // `markCategoryAxis` wrote geometry with no count beside it.
    //
    // Since v2.4 the count is typed on the SAME click that places the second
    // end, and `applyCalibratedCategoryAxis` refuses to build any geometry
    // without a valid one. So the honest assertion is not "here is what the bad
    // state does" but "the bad state has no door" - which is also what protects
    // it if anyone later splits the count back off its step.
    const s = calibratedBar();
    s.handleCalibrationClick(A.x, A.y);
    s.handleCalibrationClick(B.x, B.y);
    // Both ends clicked, no count yet: no geometry, and nothing to file bars in.
    expect(s.getCategoryAxis().hasGeometry()).toBe(false);
    expect(s.confirmCalibrationValues([''])).toBe(false);
    expect(s.confirmCalibrationValues(['0'])).toBe(false);
    expect(s.getCategoryAxis().hasGeometry()).toBe(false);
    // And a real count produces both together, never one without the other.
    expect(s.confirmCalibrationValues(['2'])).toBe(true);
    expect(s.runCalibration()).toBe(true);
    expect(s.getCategoryAxis().hasGeometry()).toBe(true);
    expect(s.getCategoryAxis().hasDeclaredCount()).toBe(true);
  });

  it('⚑ HIGH: two bars of one series in ONE band - the first keeps its row, the rest are REPORTED', () => {
    // This was last-wins, so the second bar silently evicted the first one's
    // row. The outer bands are unbounded, so a stray bar or a mis-declared count
    // was enough, and the table came back looking complete with a real reading
    // missing. One cell cannot show two bars -- but the omission must not be
    // silent.
    const s = withTicks(2); // bands 100..350, 350..600
    barAt(s, 150, 300); // band 0
    barAt(s, 200, 400); // band 0 as well
    barAt(s, 500, 350); // band 1
    const table = s.getBarCategoryTable();
    expect(s.getDataset().getTupleCount()).toBe(3);
    expect(table.columns[0]!.tupleIndices).toEqual([0, 2]); // FIRST kept, not last
    expect(table.crowded).toEqual([{ seriesIndex: 0, categoryIndex: 0, tupleIndex: 1 }]);
  });

  it('reports nothing crowded in an ordinary figure', () => {
    const s = withTicks(3);
    barAt(s, 150);
    barAt(s, 350);
    barAt(s, 550);
    expect(s.getBarCategoryTable().crowded).toEqual([]);
  });

  it('names the series a crowded bar belongs to, not just the category', () => {
    const s = withTicks(2);
    barAt(s, 150);
    s.addDataset('Series 2');
    barAt(s, 160);
    barAt(s, 170);
    const crowded = s.getBarCategoryTable().crowded;
    expect(crowded).toHaveLength(1);
    expect(crowded[0]!.seriesIndex).toBe(1);
  });
});

describe('⚑ the split REPORT is surfaced, and points at the right category', () => {
  it('says nothing when every declared category got a bar', () => {
    expect(categoryMissReport([])).toBe('');
  });

  it('names the one that came up empty', () => {
    expect(categoryMissReport(['Lactose'])).toBe(' - no bar found for Lactose.');
  });

  it('counts them when there is more than one', () => {
    expect(categoryMissReport(['Lactose', 'Maltose'])).toBe(
      ' - no bar found for 2 categories: Lactose, Maltose.'
    );
  });

  it('⚑ complete means EVERY CATEGORY GOT A BAR, not that the totals agree', () => {
    // Counting alone reads true when two bars land in one band and another is
    // empty: the totals match while a category has nothing in it.
    const twoInOneBand = { pieces: [{}, {}, {}], emptyBands: [1] };
    expect(reconcileWithExpected(twoInOneBand, 3)).toMatchObject({
      expected: 3,
      found: 3,
      complete: false,
      emptyBands: [1],
    });
  });

  it('⚑ maps a split BAND back to the category the user declared', () => {
    // The splitter works in image order; the categories run along the axis as it
    // was marked. Those are opposite whenever the axis runs right-to-left.
    const s = withTicks(4);
    expect(s.categoryDividersForDetect()!.reversed).toBe(false);
    expect(s.categoryIndexOfBand(0, false)).toBe(0);
    expect(s.categoryIndexOfBand(3, false)).toBe(3);

    const back = calibratedBar();
    walkCategoryAxis(back, { from: { x: 600, y: 500 }, to: { x: 100, y: 500 }, count: 4 }); // right to left
    back.runCalibration();
    expect(back.categoryDividersForDetect()!.reversed).toBe(true);
    // Band 0 is the LEFTMOST in image order, which is the LAST category here.
    expect(back.categoryIndexOfBand(0, true)).toBe(3);
    expect(back.categoryIndexOfBand(3, true)).toBe(0);
  });

  it('the dividers stay ascending either way - the splitter requires it', () => {
    const back = calibratedBar();
    walkCategoryAxis(back, { from: { x: 600, y: 500 }, to: { x: 100, y: 500 }, count: 3 });
    back.runCalibration();
    const d = back.categoryDividersForDetect()!.dividers;
    expect(d).toEqual([...d].sort((a, b) => a - b));
  });
});

describe('⚑ the run is cut at INTERIOR dividers only (review #3)', () => {
  const W = 80;
  const H = 30;
  const BLUE: [number, number, number] = [20, 60, 140];

  it('a run reaching past "categories end" is not sliced at the edge', () => {
    // The outermost bands are UNBOUNDED -- everything right of the last interior
    // divider is the last category. Cutting at the edge produced a sliver piece
    // beyond the last band, which then clamped onto that category and evicted
    // the real bar's row.
    const img = figureWith(W, H, [[0, 4, 19, 25], [20, 14, 45, 25]]);
    const r = runBarDetect(img, W, H, BLUE, 30, 'foreground', undefined, undefined, {
      dividers: [0, 20, 40], // the axis was marked as ending at x=40
      categoryAxis: 'x',
      expected: 2,
    });
    if (!('boxes' in r)) throw new Error('expected boxes');
    // Two bars, not three: nothing was sliced at x=40 where the ink runs on.
    expect(r.boxes).toHaveLength(2);
    expect(r.boxes[1]!.end.x).toBeGreaterThan(40); // the piece keeps its real end
    expect(r.expectation).toMatchObject({ complete: true, emptyBands: [] });
  });

  it('a bar starting left of the marked span is not sliced at the first edge either', () => {
    const img = figureWith(W, H, [[2, 6, 30, 25], [40, 12, 60, 25]]);
    const r = runBarDetect(img, W, H, BLUE, 30, 'foreground', undefined, undefined, {
      dividers: [10, 35, 70], // the span starts at x=10, the ink starts at x=2
      categoryAxis: 'x',
    });
    if (!('boxes' in r)) throw new Error('expected boxes');
    expect(r.boxes).toHaveLength(2);
    expect(r.boxes[0]!.start.x).toBeLessThan(10);
  });

  it('still cuts a run that crosses a real interior divider', () => {
    const img = figureWith(W, H, [[0, 4, 39, 25]]); // one blob spanning two bands
    const r = runBarDetect(img, W, H, BLUE, 30, 'foreground', undefined, undefined, {
      dividers: [0, 20, 40],
      categoryAxis: 'x',
    });
    if (!('boxes' in r)) throw new Error('expected boxes');
    expect(r.blobs).toBe(1);
    expect(r.boxes).toHaveLength(2);
  });
});

describe('⚑ the split measures the blob, not its bounding box (review #8)', () => {
  const W = 80;
  const H = 40;
  const BLUE: [number, number, number] = [20, 60, 140];

  it('same-coloured ink INSIDE the run’s box, over most of a band, does not move the reading', () => {
    // Two touching bars form one merged run whose bbox is x 0..39, y 10..35.
    // A disconnected strip of the same colour sits INSIDE that box, spanning 13
    // of band 0's 20 columns -- a MAJORITY, which is the only case the median
    // cannot absorb. Measuring from the mask inside the bbox would have taken
    // the strip's top as the short bar's; measuring from the blob's own pixels
    // cannot see it at all.
    const img = figureWith(W, H, [
      [0, 20, 19, 35], // short bar, its own top at y=20
      [20, 10, 39, 35], // taller bar, touching it
      [0, 12, 12, 14], // the strip: inside the run's bbox, not part of it
    ]);
    const r = runBarDetect(img, W, H, BLUE, 30, 'foreground', undefined, undefined, {
      dividers: [0, 20, 40],
      categoryAxis: 'x',
    });
    if (!('boxes' in r)) throw new Error('expected boxes');
    // The strip is its own blob, so it also produces a box -- what matters is
    // that the SHORT BAR's piece kept its own top rather than the strip's.
    const shortBar = r.boxes.filter((b) => b.end.x <= 20 && b.end.y > 30);
    expect(shortBar).toHaveLength(1);
    expect(shortBar[0]!.start.y).toBe(20);
  });

  it('the strip really is inside the merged run’s bounding box', () => {
    // Guards the fixture itself: if the contamination sat outside the box, the
    // test above would pass without proving anything. An earlier draft did
    // exactly that.
    const runBox = { minY: 10, maxY: 35, minX: 0, maxX: 39 };
    const strip = { y0: 12, y1: 14, x0: 0, x1: 12 };
    expect(strip.y0).toBeGreaterThan(runBox.minY);
    expect(strip.y1).toBeLessThan(runBox.maxY);
    expect(strip.x1).toBeLessThanOrEqual(runBox.maxX);
    expect(strip.x1 - strip.x0 + 1).toBeGreaterThan(20 / 2); // a MAJORITY of band 0
  });
});

/**
 * ⚑⚑ DELETED: the `"Remove ticks" takes back what the declaration created`
 * block (six tests).
 *
 * `Remove ticks` was a BUTTON, and the v2.4 card rebuild removed it: *"there is
 * no state with an axis and no ticks to get back to."* Its session method had no
 * production caller afterwards, and these tests were the only thing keeping it
 * and its forty lines of tuple-remapping alive.
 *
 * ▶ THE REMAP ITSELF IS NOT LOST. Dropping categories and renumbering the bars
 * bound to them is also what `pruneOrphanedCategories` does - four live callers,
 * every deletion door - and `categoryOrphans.test.ts` covers it directly,
 * including `⚑ renumbers the SURVIVING bars, so their labels do not shift`.
 * What went is a second copy of that job, performed by a gesture that no longer
 * exists.
 */
