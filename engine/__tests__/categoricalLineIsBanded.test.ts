/**
 * ⚑⚑ THE `Line` FIX - a CATEGORY that is MEASURED, not counted.
 *
 * The one type of twelve that FAILED the tenet-11 generation audit
 * (CLAUDE.md, 2026-08-14): *"it stores a value and DERIVES its category from
 * left-to-right capture order, so a library handed our record could not place
 * the points."* Its own config says the same thing in the affirmative - X is
 * *"its ORDINAL position (derived from left-to-right pixel order at
 * export/display time, never stored)"*.
 *
 * ⚠️ MEASURED FIRST, so the defect is a number and not an argument. Two series
 * on one figure, categories at x = 150, 250, 350, and the SECOND series has no
 * reading for the middle one:
 *
 *     Series 1   Position 1 (x=150) · Position 2 (x=250) · Position 3 (x=350)
 *     Series 2   Position 1 (x=150) ·                      Position 2 (x=350)
 *
 * **The same category exports as Position 3 in one series and Position 2 in the
 * other.** Rank is computed per series, so a gap in one of them slides every
 * later reading one category to the left - silently, with every number
 * plausible. A consumer overlays the two and gets the wrong points paired.
 *
 * ⚑⚑ THE FIX IS THE MECHANISM THE OTHER CATEGORICAL TYPES ALREADY HAVE. Bar and
 * Box Plot mark a category axis - two clicked edges plus a declared count - and
 * read each capture's category as the BAND it falls in (`core/bandedAxis.ts`,
 * shipped in v2.1/v2.2 and proven on two consumers). Line's own config predicted
 * this exact change and left the seed named rather than written:
 *
 *     ⚑ NO `categoryTicks` yet, deliberately… When the per-point path moves to
 *       a category index, the seed step here is `v1`, not `p1`.
 *
 * ⚑ A BAND IS DERIVED, AND THAT IS RIGHT HERE - the same argument
 * `categoriesFollowBands` already records: a stored index is a second copy of a
 * fact the geometry answers, and the two disagree the moment a divider moves. It
 * is not the error-bar cap↔datum case, because a band index is a pure function
 * of a pixel and the declared dividers: it cannot be inconsistent, only
 * recomputed.
 *
 * ⚑ AND IT IS STILL MEASURED, not invented (tenet 9): the user CLICKED the two
 * edges of the axis and read the count off the figure. What is derived is which
 * side of a boundary a pixel sits on.
 */
import { describe, it, expect } from 'vitest';
import { CalibrationSession } from '../calibrationSession.js';
import { CATEGORICAL_LINE_CONFIG } from '../axesTypeConfigs.js';
import { walkCategoryAxis } from './helpers/categoryWalk.js';

type LineSession = ReturnType<typeof lineSession>;

/** Value axis: 0 at py 300, 10 at py 100. Categories will run x 100..400. */
function lineSession() {
  const s = new CalibrationSession(CATEGORICAL_LINE_CONFIG);
  s.handleCalibrationClick(100, 300);
  expect(s.confirmCalibrationValues(['0'])).toBe(true);
  s.handleCalibrationClick(100, 100);
  expect(s.confirmCalibrationValues(['10'])).toBe(true);
  walkCategoryAxis(s);
  expect(s.runCalibration()).toBe(true);
  return s;
}

/** Mark the category axis across the plot and declare three categories, so the
 * bands are x 100–200, 200–300, 300–400. */
function withThreeCategories(s: LineSession) {
  expect(s.markCategoryAxis({ x: 100, y: 300 }, { x: 400, y: 300 })).toBe(true);
  expect(s.setCategoryCount(3)).toBe(true);
  return s;
}

/** Every row's Position column, per series. */
const positions = (s: LineSession, index: number) =>
  s.getExportRows(index).map((r) => r.values[0]);

describe('the type declares a category axis', () => {
  it('⚑ it supports category ticks at all', () => {
    expect(lineSession().supportsCategoryTicks()).toBe(true);
  });

  /**
   * ⛔ THE SEED IS GONE (v2.4). This asserted `categoryTickOriginPixel()` is
   * `v1`, *"the click on the Y axis, which IS the left edge of the category
   * axis"*. It is not: V1's prompt is *"a known value on the Y axis (e.g.
   * Y=0)"*, which says nothing about where ALONG the axis to click. Bar proved
   * the same claim false the hard way - a category axis that ran diagonally
   * across David's figure. Both ends are calibration steps now.
   */
  it('⚑⚑ calibrates its category axis in the walk, like Bar and Box Plot', () => {
    const s = lineSession();
    expect(s.getCategoryAxis().getAxisEdges()).not.toBeNull();
    expect(s.getCategoryAxis().hasDeclaredCount()).toBe(true);
  });
});

describe('a category is the band the reading sits in', () => {
  it('⚑⚑ the same category reports the same position in EVERY series', () => {
    // The measured defect, as a test. Series 2 skips the middle category, and
    // under click-order ranking its x=350 reading came out as Position 2 -
    // the same coordinate as another category's reading in series 1.
    const s = withThreeCategories(lineSession());
    s.addDataPoint(150, 250);
    s.addDataPoint(250, 200);
    s.addDataPoint(350, 150);
    s.addDataset('Series 2');
    s.setActiveDataset(1);
    s.addDataPoint(150, 260);
    s.addDataPoint(350, 160); // the THIRD category, with the second skipped
    expect(positions(s, 0)).toEqual([1, 2, 3]);
    expect(positions(s, 1)).toEqual([1, 3]);
  });

  it('⚑ capture order stops mattering', () => {
    // Clicked right, left, middle - and each reading still reports the category
    // the FIGURE puts it in. Under ranking this happened to come out right for a
    // single complete series, which is exactly why the defect stayed invisible
    // until a second series skipped a category.
    //
    // ⚑ ASSERTED AS A PAIRING, not as a sequence, and the difference is a real
    // behaviour worth knowing: a line series INSERTS a point into its geometric
    // place in the polyline rather than appending it, so after an out-of-order
    // capture the stored order is not the click order. Asserting a sequence here
    // would pin that insertion rule by accident while claiming to test
    // categories.
    const s = withThreeCategories(lineSession());
    s.addDataPoint(350, 150);
    s.addDataPoint(150, 250);
    s.addDataPoint(250, 200);
    const byX = s
      .getExportRows(0)
      .map((r) => [r.px, r.values[0]] as const)
      .sort((a, b) => a[0] - b[0]);
    expect(byX).toEqual([
      [150, 1],
      [250, 2],
      [350, 3],
    ]);
  });

  it('⚑ adjust a tick and the readings re-home - nothing is stored to go stale', () => {
    // The same property `categoriesFollowBands` records for bars. A stored index
    // would still say 2 after the boundary moved past the point.
    const s = withThreeCategories(lineSession());
    s.addDataPoint(250, 200);
    expect(positions(s, 0)).toEqual([2]);
    // Slide the axis right so x=250 now falls in the FIRST band (250–400 split
    // into three: 250–300, 300–350, 350–400 - 250 is band 0).
    expect(s.markCategoryAxis({ x: 250, y: 300 }, { x: 400, y: 300 })).toBe(true);
    expect(positions(s, 0)).toEqual([1]);
  });

  it('⚑ a reading just past the last tick belongs to the LAST category', () => {
    // ⚑⚑ THE OUTERMOST BANDS ARE UNBOUNDED, and that is `bandIndexIn`'s
    // `'clamp'` policy, chosen and documented where the three copies of this
    // loop were consolidated: *"a bar sitting just past the last divider still
    // belongs to the category a reader would name it."* The same is true of a
    // line's marker, and the user's two edge clicks are hand-placed, so a few
    // pixels of slop must not cost the reading its category.
    //
    // ⚠️ The heatmap deliberately takes the OPPOSITE policy (`'refuse'`) -
    // *"a point outside a matrix has no row at all, and inventing one would put
    // a value in a cell the figure does not have."* Both are right for their own
    // type; what matters is that each says which it takes. This is Line saying
    // it, with a test rather than by inheriting a default.
    const s = withThreeCategories(lineSession());
    s.addDataPoint(450, 200);
    expect(positions(s, 0)).toEqual([3]);
  });
});

describe('a name belongs to the CATEGORY, not to each point that lands in it', () => {
  /** Three categories, the middle one named. */
  function namedMiddle() {
    const s = withThreeCategories(lineSession());
    s.addDataPoint(250, 200);
    expect(s.setPointLabel(0, 'Hemp')).not.toBe(false);
    return s;
  }

  it('⚑⚑ every series reads the same name for the same band', () => {
    // The other half of the tenet-11 failure. A position that means the same
    // thing everywhere is only useful if its NAME does too - with the name
    // copied onto each point, two series could disagree about what category 2
    // is called, and a reader has nothing to say which is right. The band is the
    // category's identity, so the name lives with the band. This is exactly what
    // Bar's `setTupleLabel` already does; the point-level path had no
    // counterpart.
    // ⚠️ NAMED *AFTER* BOTH POINTS EXIST, deliberately. The per-point PREFILL
    // copies a name onto a new point from the nearest already-named point in
    // another series - so naming first and capturing second would make this pass
    // by the very mechanism the shared axis exists to replace, and the test
    // would be green over the old model. Naming afterwards cannot propagate by
    // prefill; only a shared identity can carry it.
    const s = withThreeCategories(lineSession());
    s.addDataPoint(250, 200);
    s.addDataset('Series 2');
    s.setActiveDataset(1);
    s.addDataPoint(260, 210); // the same band, in a different series
    s.setActiveDataset(0);
    s.setPointLabel(0, 'Hemp');
    expect(s.getPointLabels(1)).toEqual(['Hemp']);
  });

  it('⚑ renaming from one series renames the category, for all of them', () => {
    const s = namedMiddle();
    s.addDataset('Series 2');
    s.setActiveDataset(1);
    s.addDataPoint(260, 210);
    s.setPointLabel(0, 'Flax');
    expect(s.getPointLabels(0)).toEqual(['Flax']);
    expect(s.getPointLabels(1)).toEqual(['Flax']);
  });

  it('⚑ the name rides out with the reading', () => {
    const s = namedMiddle();
    expect(s.getExportRows(0)[0]!.values).toEqual([2, 'Hemp', 5]);
  });

  it('⚑ an unnamed band is BLANK, not invented', () => {
    // The fabricated-category defect v2.1 fixed: `Bar1`, `Slice0` and friends
    // are names nobody typed. A band with no name transcribed reads empty.
    const s = withThreeCategories(lineSession());
    s.addDataPoint(150, 250);
    expect(s.getPointLabels(0)).toEqual(['']);
  });
});

describe('what must NOT change', () => {
  it('⚑ with no axis marked, the ordinal is exactly what it was', () => {
    // The companion assertion. A Line that never marks an axis keeps today's
    // left-to-right reading of its own pixels - a faithful view of one series,
    // and the honest answer when nobody has said where the categories are.
    const s = lineSession();
    // ⚑ "No axis marked" is reached by WITHDRAWING the declaration since v2.4 -
    // a pre-v2.4 project file. The behaviour it guards is unchanged.
    s.removeCategoryTicks();
    s.addDataPoint(350, 150);
    s.addDataPoint(150, 250);
    expect(positions(s, 0)).toEqual([2, 1]);
  });

  it('⚑ the VALUE is still read from the value calibration, untouched', () => {
    const s = withThreeCategories(lineSession());
    s.addDataPoint(250, 200);
    expect(s.getExportRows(0)[0]!.values[1]).toBeCloseTo(5, 6);
  });
});
