import { describe, expect, it } from 'vitest';
import { BAR_AXES_CONFIG, CalibrationSession } from '../calibrationSession.js';
import type { BarAxes } from '../../core/axes/bar.js';
import { walkCategoryAxis } from './helpers/categoryWalk.js';
import { loadWithoutCategoryAxis } from './helpers/noCategoryAxis.js';

/**
 * getBarCategoryTable / renameCategory (v2.0) -- the shared Bar table's own
 * data source, one row per category, one column per series (mirroring
 * getSpiderTable's shape). Written after a mutation-testing audit pass found
 * this method had ZERO direct engine-level coverage: it was only exercised
 * indirectly through Workspace.tsx's e2e suite, which the mutation config
 * deliberately excludes for speed (vitest.mutation.config.ts) -- so its own
 * correctness had never actually been checked against a mutant.
 */

// P1=0 @ (300,500), P2=10 @ (300,100) -- same convention as barCapture.test.ts.
function calibratedBar(session: CalibrationSession<BarAxes>, count = 4): void {
  session.handleCalibrationClick(300, 500);
  session.confirmCalibrationValues(['0']);
  session.handleCalibrationClick(300, 100);
  session.confirmCalibrationValues(['10']);
  // ⚑ The category axis is part of the walk since v2.4, so its COUNT is part of
  // the fixture: a test that builds two bars is describing a two-category
  // figure, and the table shows every category the figure declares.
  walkCategoryAxis(session, { count });
  expect(session.runCalibration()).toBe(true);
}

/** The un-ticked path, which since v2.4 only a WPD import reaches.
 * See `unmarkedBarSession` in `calibrationSession.test.ts`. */
function unmarkedBar(session: CalibrationSession<BarAxes>): void {
  calibratedBar(session);
  loadWithoutCategoryAxis(session, session.getAxes()!, session.getDatasets());
}

describe('getBarCategoryTable: gating', () => {
  it('is empty before calibration', () => {
    const session = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    expect(session.getBarCategoryTable()).toEqual({ categoryNames: [], categoryRawNames: [], columns: [], crowded: [] });
  });

  it('is empty for a 5-slot Box Plot session -- no "opposite corners" a bbox could mean there either', () => {
    const session = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    calibratedBar(session);
    session.applyBoxPlotGroups();
    expect(session.getBarCategoryTable()).toEqual({ categoryNames: [], categoryRawNames: [], columns: [], crowded: [] });
  });
});

describe('getBarCategoryTable: single series', () => {
  it('lists one row per bar, positional placeholder names, real derived values', () => {
    const session = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    calibratedBar(session, 2);
    // ⚑ x=150 and x=350: with the axis marked 100..500 and TWO categories the
    // bands are 100-300 and 300-500, so these are two different categories.
    // At 150 and 250 they would be the same one - which is the model working,
    // and a fixture describing two bars stacked on one category position.
    session.addDataPoint(150, 500); // bar 0, category 1: value 5
    session.addDataPoint(150, 300);
    session.addDataPoint(350, 500); // bar 1, category 2: value 2
    session.addDataPoint(350, 420);

    const table = session.getBarCategoryTable();
    expect(table.categoryRawNames).toEqual(['', '']); // never invented (tenet 9)
    expect(table.categoryNames).toEqual(['Category 1', 'Category 2']); // display fallback only
    expect(table.columns).toHaveLength(1);
    const col = table.columns[0]!;
    expect(col.seriesIndex).toBe(0);
    expect(col.seriesName).toBe('Series 1');
    expect(col.values[0]).toBeCloseTo(5, 9);
    expect(col.values[1]).toBeCloseTo(2, 9);
    expect(col.tupleIndices).toEqual([0, 1]);
  });

  it('⚑ naming ONE bar leaves the other blank - two unnamed bars are separate slots', () => {
    // The capture path reserves each tuple its own CategoryAxis index via
    // addCategory(''), NOT setTupleLabel(i, ''), which would reuse an existing
    // category by matching its NAME - collapsing two still-unnamed bars onto
    // one shared '' slot, so naming either would rename BOTH. Nothing looks
    // wrong until a user types the second name and watches the first change.
    const session = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    calibratedBar(session, 2);
    session.addDataPoint(150, 500);
    session.addDataPoint(150, 300);
    session.addDataPoint(250, 500);
    session.addDataPoint(250, 420);

    expect(session.renameCategory(0, 'Flax')).toBe(true);
    expect(session.getBarCategoryTable().categoryRawNames).toEqual(['Flax', '']);
  });

  it('reflects a renamed category immediately, in RAW form (not re-wrapped)', () => {
    const session = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    calibratedBar(session);
    session.addDataPoint(150, 500);
    session.addDataPoint(150, 300);

    expect(session.renameCategory(0, 'Flax')).toBe(true);
    const table = session.getBarCategoryTable();
    expect(table.categoryRawNames[0]).toBe('Flax');
    expect(table.categoryNames[0]).toBe('Flax'); // not "Category 1" once named
  });

  it('renameCategory refuses an out-of-range index, same contract as CategoryAxis', () => {
    const session = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    calibratedBar(session);
    session.addDataPoint(150, 500);
    session.addDataPoint(150, 300);
    expect(session.renameCategory(5, 'Nope')).toBe(false);
    expect(session.renameCategory(-1, 'Nope')).toBe(false);
  });

  it('a half-dragged bar (one corner only) has no derived value yet -- null, not a guess', () => {
    const session = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    calibratedBar(session);
    session.addDataPoint(150, 500); // one corner only
    const table = session.getBarCategoryTable();
    expect(table.columns[0]!.values[0]).toBeNull();
    expect(table.columns[0]!.tupleIndices[0]).toBe(0); // still addressable, for the cell click/delete
  });
});

describe('setSlotCursor: aiming at a specific half-filled bar (v2.0 audit)', () => {
  it('lets Bar use it, unlike Box Plot -- reaches an EARLIER half-filled bar without disturbing a later one', () => {
    // v2.0 pre-launch audit: nextSlot() only ever walks FORWARD from the
    // cursor's current position (never back to an earlier gap), and any
    // full recompute (computeSlotCursorFor) starts scanning from tuple 0 --
    // so once a second bar is started, completing the FIRST one again
    // without the table's aim was unreachable except by accident. Two
    // separate half-filled bars, built via explicit aiming the way two
    // interrupted drags would leave them:
    const session = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    calibratedBar(session, 2);
    session.addDataPoint(150, 500); // tuple 0, one corner only (Bar 1), category 1
    expect(session.setSlotCursor(null, 0)).toBe(true); // start a genuinely NEW tuple
    session.addDataPoint(350, 500); // tuple 1, one corner only (Bar 2), category 2
    expect(session.getBarCategoryTable().columns[0]!.tupleIndices).toEqual([0, 1]);
    expect(session.getBarCategoryTable().columns[0]!.values).toEqual([null, null]);

    // The cursor now sits at tuple 1's own remaining slot (nextSlot() walked
    // forward from where tuple 1 was just filled) -- completing tuple 0
    // again requires aiming BACK at it directly, exactly what the Bar
    // table's empty-cell click now does.
    expect(session.setSlotCursor(0, 1)).toBe(true);
    session.addDataPoint(150, 420); // fills tuple 0's missing corner directly

    const table = session.getBarCategoryTable();
    expect(table.columns[0]!.values[0]).not.toBeNull(); // tuple 0 completed
    expect(table.columns[0]!.values[1]).toBeNull(); // tuple 1 untouched, still half-filled
  });

  it('still refuses for Box Plot -- a 5-slot object tuple built out of order would be left permanently half-made', () => {
    const session = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    calibratedBar(session);
    session.applyBoxPlotGroups();
    session.addDataPoint(150, 500); // Min only
    expect(session.setSlotCursor(0, 3)).toBe(false); // "fill Q3 next" stays refused
  });
});

describe('getBarCategoryTable: multiple series sharing the category axis', () => {
  it('a series with no bar for a category shows null, not a missing row', () => {
    // ⚑ prefillTupleCategoryLabel's donor search has no distance THRESHOLD -- it
    // always finds the nearest donor across other series regardless of how far,
    // so a lone second-series bar cannot be forced into its own fresh category
    // just by placing it far away (worth a note for a future pass: is that
    // really desirable for two series with very different x-ranges?). To get a
    // genuine null cell here, series 1 needs a SECOND category series 2 never
    // reaches at all.
    const session = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    calibratedBar(session, 2);
    session.addDataPoint(150, 500); // series 1, Flax: value 5
    session.addDataPoint(150, 300);
    session.renameCategory(0, 'Flax');
    session.addDataPoint(400, 500); // series 1, Hemp: value 1
    session.addDataPoint(400, 460);
    session.renameCategory(1, 'Hemp');

    session.addDataset('Alkali');
    session.addDataPoint(155, 500); // near Flax only -- prefills into it
    session.addDataPoint(155, 250); // value 6.25

    const table = session.getBarCategoryTable();
    expect(table.categoryNames).toEqual(['Flax', 'Hemp']);
    expect(table.columns).toHaveLength(2);
    const [s1, s2] = table.columns as [typeof table.columns[0], typeof table.columns[0]];
    expect(s1.values[0]).toBeCloseTo(5, 9); // series 1 has Flax
    expect(s1.values[1]).toBeCloseTo(1, 9); // ...and Hemp
    expect(s2.values[0]).toBeCloseTo(6.25, 9); // series 2 has Flax
    expect(s2.values[1]).toBeNull(); // series 2 never reached Hemp
    expect(s2.tupleIndices[1]).toBeNull();
  });

  it('a shared category (via the nearest-bar prefill) reads BOTH series in the SAME row', () => {
    // ⚑ THE PREFILL, so the UN-TICKED path: with the axis marked, two bars in
    // one band share a category by construction and no prefill runs at all.
    // This still covers a WPD import, where it does.
    const session = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    unmarkedBar(session);
    session.addDataPoint(150, 500); // series 1, value 5
    session.addDataPoint(150, 300);
    session.renameCategory(0, 'Flax');

    session.addDataset('Alkali');
    session.addDataPoint(155, 500); // near x=150 -> prefills into the SAME "Flax" category
    session.addDataPoint(155, 460); // value 1

    const table = session.getBarCategoryTable();
    expect(table.categoryNames).toEqual(['Flax']); // one row, not two
    expect(table.columns).toHaveLength(2);
    expect(table.columns[0]!.values[0]).toBeCloseTo(5, 9);
    expect(table.columns[1]!.values[0]).toBeCloseTo(1, 9);
  });

  it('carries each series own seriesName through, not a shared/global one', () => {
    const session = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    calibratedBar(session);
    session.addDataset('Treatment B');
    const table = session.getBarCategoryTable();
    expect(table.columns.map((c) => c.seriesName)).toEqual(['Series 1', 'Treatment B']);
  });

  it('values a stacked segment the same way getTupleRows does', () => {
    // ⚑ getBarCategoryTable has its own derive.compute call (necessarily --
    // it iterates every series, not just the active one), so the two could
    // silently drift apart without a direct check. Since v2.3 stacking is one
    // declaration on the AXES rather than a per-series tag, which is what
    // removed the drift this test was originally written to catch.
    const session = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    session.setOption('isStacked', 'true');
    calibratedBar(session);
    session.addDataPoint(150, 420); // value 2
    session.addDataPoint(150, 300); // value 5 -- unsigned span 3, not baseline-relative
    const table = session.getBarCategoryTable();
    expect(table.columns[0]!.values[0]).toBeCloseTo(3, 9);
    expect(session.getTupleRows()[0]!.derived).toBeCloseTo(3, 9);
  });
});

/**
 * ⚑⚑⚑ A CAPTURED BAR MUST LAND IN A MARKED BAND, NOT MINT A CATEGORY OF ITS OWN
 * (v2.3, found 2026-08-23 by David driving the built app).
 *
 * He marked the category axis on a four-group bar chart, declared 4 categories,
 * then captured ONE bar whose pixels sit squarely inside the first band. The card
 * went to **5 categories**: `Day 3 / Day 7 / Day 14 / Day 21` with no values, plus
 * a fifth unnamed row holding the reading. David: *"And this now ended up as new
 * categories."*
 *
 * ⚑⚑ THE MODEL HAS TWO ENTRANCES AND THEY DISAGREED - this project's own
 * recurring shape. The READ path (`categoryIndexOfTuple`) checks
 * `categoriesFollowBands()` and resolves a tuple by the band its pixel falls in.
 * The CAPTURE path (`autoLabelTuple` -> `reserveEmptyCategorySlot`) gated on
 * `usesCategoryAxis` instead, so it minted a fresh `addCategory('')` for every new
 * bar whether or not bands had been declared. One entrance answered "band 0" while
 * the other was busy creating category 5.
 *
 * ⚠️ AND A COMMENT 250 LINES AWAY ASSERTED THE GUARD ALREADY EXISTED - the
 * point-capture path says *"the same gate the tuple path already has
 * (`!this.categoriesFollowBands() && ...`)"*. The tuple path had no such gate.
 * CLAUDE.md gate 3: a comment asserting what the design requires, with nothing
 * enforcing it, is false evidence of compliance - and it is why nobody looked.
 *
 * ⚑ Bands span the axis between the two marked edges, so with 4 categories over
 * x = 100..900 each band is 200px wide and a bar at x approx 150 is band 0.
 */
describe('a marked axis OWNS the categories - capture must not mint more', () => {
  /** Calibrated, axis edges marked at x=100..900 on the baseline, 4 categories. */
  function markedFourBands(): CalibrationSession<BarAxes> {
    const session = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    calibratedBar(session);
    expect(session.markCategoryAxis({ x: 100, y: 500 }, { x: 900, y: 500 })).toBe(true);
    expect(session.setCategoryCount(4)).toBe(true);
    return session;
  }

  it('⚑⚑ one bar in the first band does NOT become a fifth category', () => {
    const session = markedFourBands();
    expect(session.getBarCategoryTable().categoryNames).toHaveLength(4);
    // A bar wholly inside band 0 (x = 100..300), captured corner to corner.
    session.addDataPoint(140, 500);
    session.addDataPoint(220, 300);
    expect(session.getBarCategoryTable().categoryNames).toHaveLength(4);
  });

  it('⚑ and its reading appears in the band it falls in, not in a row of its own', () => {
    const session = markedFourBands();
    session.addDataPoint(140, 500);
    session.addDataPoint(220, 300);
    const table = session.getBarCategoryTable();
    const values = table.columns[0]!.values;
    expect(values).toHaveLength(4);
    // Band 0 holds the reading; every other band is still empty.
    expect(values[0]).not.toBeNull();
    expect(values.slice(1)).toEqual([null, null, null]);
  });

  it('⚑ four bars, one per band, stay four categories', () => {
    const session = markedFourBands();
    for (const x of [140, 340, 540, 740]) {
      session.addDataPoint(x, 500);
      session.addDataPoint(x + 80, 300);
    }
    const table = session.getBarCategoryTable();
    expect(table.categoryNames).toHaveLength(4);
    expect(table.columns[0]!.values.every((v) => v !== null)).toBe(true);
  });

  it('⚑ WITHOUT a marked axis the old behaviour is unchanged - a bar still gets its own slot', () => {
    // The guard must stand down only where bands answer. An unmarked bar chart
    // still needs a distinct addressable slot per bar so a later rename has
    // somewhere to land - which is what `reserveEmptyCategorySlot` is FOR.
    const session = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    unmarkedBar(session);
    session.addDataPoint(140, 500);
    session.addDataPoint(220, 300);
    session.addDataPoint(340, 500);
    session.addDataPoint(420, 300);
    expect(session.getBarCategoryTable().categoryNames).toHaveLength(2);
  });
});

describe("🔴 THE SEQUENCE THAT MINTED A FIFTH CATEGORY - 'Re-place axis'", () => {
  /**
   * David's session, 2026-08-23, reproduced gesture for gesture from his saved
   * project file (archived as `repro_category_mint_2026-08-23.zip`): he marked
   * the axis, declared 4, named them, RE-PLACED THE AXIS because the span was
   * wrong, marked it again, dragged a tick, then captured one bar - and got a
   * fifth, unnamed category holding the reading.
   *
   * ⚑ Re-placing is where it goes wrong, and the two layers already disagree in
   * their own comments about it. `BandedAxis.clearGeometry` says "the declared
   * count survives: how many bands the figure has is a fact about the figure,
   * not about where it was clicked" - and `CategoryAxis.clearGeometry`, one
   * level up, cleared `_countDeclared` anyway. So marking the axis again brought
   * back the bands, the ticks and the names, and left the model believing nobody
   * had ever declared a count.
   */
  function markedFourBands(): CalibrationSession<BarAxes> {
    const session = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    calibratedBar(session);
    expect(session.markCategoryAxis({ x: 100, y: 500 }, { x: 900, y: 500 })).toBe(true);
    expect(session.setCategoryCount(4)).toBe(true);
    return session;
  }

  /** Named, re-placed, re-marked - the state his file was saved in. */
  function replacedAxis(): CalibrationSession<BarAxes> {
    const session = markedFourBands();
    ['Day 3', 'Day 7', 'Day 14', 'Day 21'].forEach((name, i) =>
      session.getCategoryAxis().renameCategory(i, name),
    );
    expect(session.clearCategoryAxisGeometry()).toBe(true);
    expect(session.markCategoryAxis({ x: 100, y: 500 }, { x: 900, y: 500 })).toBe(true);
    return session;
  }

  it('⚑⚑ re-placing the axis does not withdraw the declared count', () => {
    expect(replacedAxis().getCategoryAxis().hasDeclaredCount()).toBe(true);
  });

  it('⚑⚑ so the bar captured afterwards lands in its band, not in a fifth category', () => {
    const session = replacedAxis();
    session.addDataPoint(140, 500);
    session.addDataPoint(220, 300);
    const table = session.getBarCategoryTable();
    expect(table.categoryNames).toEqual(['Day 3', 'Day 7', 'Day 14', 'Day 21']);
    expect(table.columns[0]!.values[0]).not.toBeNull();
    expect(table.columns[0]!.values.slice(1)).toEqual([null, null, null]);
  });

  it('⚑ and it still lands in its band when a tick has been DRAGGED first', () => {
    // `geometry.adjusted` is true in his file, so the drag is in the sequence.
    const session = replacedAxis();
    expect(session.moveCategoryTick(1, { x: 420, y: 500 })).toBe(true);
    session.addDataPoint(140, 500);
    session.addDataPoint(220, 300);
    expect(session.getBarCategoryTable().categoryNames).toHaveLength(4);
  });

  it("⚑ 'Remove ticks' still means what it says - that declaration IS withdrawn", () => {
    // The fix must not blur the two buttons together. "Remove ticks" is "I did
    // not want this declaration"; re-placing is "the axis runs somewhere else".
    const session = markedFourBands();
    expect(session.removeCategoryTicks()).toBe(true);
    expect(session.getCategoryAxis().hasDeclaredCount()).toBe(false);
    expect(session.getCategoryAxis().getCategories()).toEqual([]);
  });
});

describe('⚑⚑ a FLOATING bar takes two columns in the shared table, not one', () => {
  /**
   * David: *"For the floating bars output window, I think we will add another
   * row below #, Category, Series N, that says Min, Max in two separate
   * columns."*
   *
   * ⚑ ONLY WHERE THE BAR ACTUALLY FLOATS. He refused showing `Min` on ordinary
   * bars as well - a column of zeros *"will look like a fault to the users"* -
   * and adaptive columns are already this project's house rule: `getErrorColumns`
   * omits left/right on a vertical-error figure because four columns of blanks
   * assert an emptiness nobody looked for.
   */
  function markedFourBands(): CalibrationSession<BarAxes> {
    const session = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    calibratedBar(session);
    expect(session.markCategoryAxis({ x: 100, y: 500 }, { x: 900, y: 500 })).toBe(true);
    expect(session.setCategoryCount(4)).toBe(true);
    return session;
  }

  it('a bar that sits on the baseline reports a value and NO interval', () => {
    const session = markedFourBands();
    session.addDataPoint(140, 500); // value 0 - the baseline
    session.addDataPoint(220, 300); // value 5
    const col = session.getBarCategoryTable().columns[0]!;
    expect(col.values[0]).toBeCloseTo(5, 6);
    expect(col.intervals[0]).toBeNull();
  });

  it('⚑⚑ a bar that floats reports an interval and NO value', () => {
    const session = markedFourBands();
    session.addDataPoint(140, 400); // value 2.5
    session.addDataPoint(220, 300); // value 5 - neither end is the baseline
    const col = session.getBarCategoryTable().columns[0]!;
    expect(col.values[0]).toBeNull();
    expect(col.intervals[0]!.min).toBeCloseTo(2.5, 6);
    expect(col.intervals[0]!.max).toBeCloseTo(5, 6);
  });

  it('⚑ an empty cell has neither, so the row still reads as empty', () => {
    const session = markedFourBands();
    session.addDataPoint(140, 400);
    session.addDataPoint(220, 300);
    const col = session.getBarCategoryTable().columns[0]!;
    expect(col.values.slice(1)).toEqual([null, null, null]);
    expect(col.intervals.slice(1)).toEqual([null, null, null]);
  });

  it('⚑ the two are per SERIES, so one may float while another sits down', () => {
    // The columns grow a block per series, which is how this table already grows.
    const session = markedFourBands();
    session.addDataPoint(140, 500); // series 1: on the baseline
    session.addDataPoint(220, 300);
    session.addDataset('Range');
    session.setActiveDataset(1);
    session.addDataPoint(340, 400); // series 2: floating
    session.addDataPoint(420, 300);
    const [first, second] = session.getBarCategoryTable().columns;
    expect(first!.intervals.every((iv) => iv === null)).toBe(true);
    expect(second!.intervals.some((iv) => iv !== null)).toBe(true);
  });
});
