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

/**
 * CATEGORY TICKS, wired into the session (v2.1).
 *
 * ⚑ WHAT THIS FILE IS ACTUALLY FOR. The geometry itself is tested in
 * `core/__tests__/categoryAxis.test.ts`, where it is pure. What only the SESSION
 * can get wrong is the wiring: which graph types may have ticks at all, which
 * placed pixel seeds the axis, and whether the geometry survives the three other
 * entrances this codebase keeps being bitten by — an image edit, the undo
 * snapshot, and a reset.
 *
 * ⚑ Ticks are an AID. Nothing here should ever assert that a tick changes a
 * measured VALUE, because none of them do.
 */

const A = { x: 100, y: 500 };
const B = { x: 600, y: 500 };

/** A calibrated Bar session. P1=0 at the origin (100,500), P2=10 at (100,100). */
function calibratedBar(): CalibrationSession<BarAxes> {
  const s = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
  s.handleCalibrationClick(A.x, A.y);
  s.confirmCalibrationValues(['0']);
  s.handleCalibrationClick(100, 100);
  s.confirmCalibrationValues(['10']);
  expect(s.runCalibration()).toBe(true);
  return s;
}

/** A Bar session whose category axis is marked with `n` categories. */
function withTicks(n = 4): CalibrationSession<BarAxes> {
  const s = calibratedBar();
  const seed = s.categoryTickOriginPixel();
  expect(seed).not.toBeNull();
  expect(s.markCategoryAxis({ x: seed!.px, y: seed!.py }, B)).toBe(true);
  expect(s.setCategoryCount(n)).toBe(true);
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

  it('⚑ NOT categorical Line yet — its points carry a name, not a category index', () => {
    // Its X really is categorical, so it wants ticks. But a declared band has
    // nothing to write to until the per-point path stores an index, and a
    // control that does nothing is worse than no control.
    const s = new CalibrationSession(CATEGORICAL_LINE_CONFIG as never);
    expect(s.supportsCategoryTicks()).toBe(false);
  });

  it('⚑ every mutator refuses on a type with no categories, leaving nothing behind', () => {
    // Otherwise a stray call could give a spider tick geometry, which would then
    // serialize into its project file and mean nothing to anyone.
    const s = new CalibrationSession<CalibratedAxes>(SPIDER_AXES_CONFIG as never);
    expect(s.markCategoryAxis(A, B)).toBe(false);
    expect(s.setCategoryCount(4)).toBe(false);
    expect(s.setCategoryTickConvention('edge')).toBe(false);
    expect(s.moveCategoryTick(0, A)).toBe(false);
    expect(s.clearCategoryAxisGeometry()).toBe(false);
    expect(s.categoryBandAt(300, 300)).toBeNull();
    expect(s.categoryTickOriginPixel()).toBeNull();
    expect(s.getCategoryAxis().hasGeometry()).toBe(false);
  });
});

describe('the seed pixel — what makes marking the axis one click, not two', () => {
  it('is nothing until the seed step has been placed', () => {
    const s = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    expect(s.categoryTickOriginPixel()).toBeNull();
  });

  it('is P1 once placed — the value origin sits on the category axis edge', () => {
    expect(calibratedBar().categoryTickOriginPixel()).toEqual({ px: 100, py: 500 });
  });

  it('Box Plot shares Bar’s steps, so it shares the seed', () => {
    const s = new CalibrationSession<BarAxes>(BOX_PLOT_AXES_CONFIG);
    s.handleCalibrationClick(11, 22);
    s.confirmCalibrationValues(['0']);
    expect(s.categoryTickOriginPixel()).toEqual({ px: 11, py: 22 });
  });
});

describe('marking the axis and declaring the categories', () => {
  it('the whole gesture: reuse P1, click the far edge, say how many', () => {
    const s = withTicks(4);
    const ca = s.getCategoryAxis();
    expect(ca.hasGeometry()).toBe(true);
    expect(ca.getAxisEdges()).toEqual([{ x: 100, y: 500 }, { x: 600, y: 500 }]);
    expect(ca.getTickPoints().map((p) => p.x)).toEqual([162.5, 287.5, 412.5, 537.5]);
  });

  it('refuses a degenerate axis, the model’s own guard reaching through', () => {
    const s = calibratedBar();
    expect(s.markCategoryAxis(A, { ...A })).toBe(false);
    expect(s.getCategoryAxis().hasGeometry()).toBe(false);
  });

  it('files a bar under the category it sits in', () => {
    const s = withTicks(4); // bands at x = 100-225, 225-350, 350-475, 475-600
    expect(s.categoryBandAt(150, 300)).toBe(0);
    expect(s.categoryBandAt(300, 300)).toBe(1);
    expect(s.categoryBandAt(550, 300)).toBe(3);
  });

  it('clearing the marks keeps the category names', () => {
    const s = withTicks(3);
    s.getCategoryAxis().renameCategory(0, 'Flax');
    expect(s.clearCategoryAxisGeometry()).toBe(true);
    expect(s.getCategoryAxis().hasGeometry()).toBe(false);
    expect(s.getCategoryAxis().getCategories()).toEqual(['Flax', '', '']);
  });

  it('does not gate the calibration — a bar chart calibrates with no ticks at all', () => {
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

  it('⚑ UNDO carries it — the snapshot is an entrance too', () => {
    const s = withTicks(4);
    s.setCategoryTickConvention('edge');
    s.moveCategoryTick(0, { x: 200, y: 500 });
    s.getCategoryAxis().renameCategory(2, 'Jute');
    const before = s.captureState();
    const ticks = [...s.getCategoryAxis().getTickParams()];

    s.clearCategoryAxisGeometry();
    expect(s.getCategoryAxis().hasGeometry()).toBe(false);

    s.restoreState(before);
    const ca = s.getCategoryAxis();
    expect(ca.hasGeometry()).toBe(true);
    expect(ca.getConvention()).toBe('edge');
    expect(ca.getTickParams()).toEqual(ticks);
    expect(ca.hasAdjustments()).toBe(true);
    expect(ca.getCategories()[2]).toBe('Jute');
    expect(ca.getAxisEdges()).toEqual([{ x: 100, y: 500 }, { x: 600, y: 500 }]);
  });

  it('undo of an unmarked session restores an unmarked one, not a stale axis', () => {
    const s = calibratedBar();
    const blank = s.captureState();
    s.markCategoryAxis(A, B);
    s.setCategoryCount(3);
    s.restoreState(blank);
    expect(s.getCategoryAxis().hasGeometry()).toBe(false);
  });

  it('“Reset calibration” discards the marks with everything else', () => {
    const s = withTicks(3);
    s.reset();
    expect(s.getCategoryAxis().hasGeometry()).toBe(false);
    expect(s.getCategoryAxis().getCategories()).toEqual([]);
  });

  it('clearing the POINTS leaves the marks alone — they describe the figure', () => {
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

describe('⚑ a bar belongs to its BAND — the guess is gone, not fenced', () => {
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

  it('⚑ appends no category on capture — the declared count is the count', () => {
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

  it('⚑ clearing the marks hands the job back to the stored index', () => {
    const s = calibratedBar();
    barAt(s, 150);
    s.setTupleLabel(0, 'Flax');
    // Mark an axis AFTER the fact: the band now answers instead.
    s.markCategoryAxis(A, B);
    s.setCategoryCount(2);
    expect(s.getTupleLabel(0)).toBe('Flax'); // band 0, still named Flax
    s.clearCategoryAxisGeometry();
    expect(s.getTupleLabel(0)).toBe('Flax'); // stored index again
  });
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
  it('is nothing at all until an axis is marked — so the detector call is unchanged', () => {
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
    });
  });

  it('⚑ MEASURES the direction from the marked axis, not from the option', () => {
    // "Horizontal bars" and the marked axis are independent declarations today,
    // so asking the geometry is the one that cannot disagree with what was drawn.
    const s = calibratedBar();
    s.markCategoryAxis({ x: 90, y: 100 }, { x: 90, y: 600 }); // a vertical axis
    s.setCategoryCount(2);
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
    s.markCategoryAxis({ x: 600, y: 500 }, { x: 100, y: 500 });
    s.setCategoryCount(4);
    const d = s.categoryDividersForDetect()!;
    expect(d.dividers).toEqual([...d.dividers].sort((a, b) => a - b));
    expect(d.dividers).toEqual([100, 225, 350, 475, 600]);
  });
});
