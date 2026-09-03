import { describe, expect, it } from 'vitest';
import { BAR_AXES_CONFIG, SPAN_AXES_CONFIG, CalibrationSession } from '../calibrationSession.js';
import type { BarAxes } from '../../core/axes/bar.js';
import { walkCategoryAxis } from './helpers/categoryWalk.js';
import { calibratedHealthy } from './fixtures/anyType.js';
import { BOX_PLOT_AXES_CONFIG } from '../axesTypeConfigs.js';

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
  // ⚑ The category axis is part of the walk since v2.3, so its COUNT is part of
  // the fixture: a test that builds two bars is describing a two-category
  // figure, and the table shows every category the figure declares.
  walkCategoryAxis(session, { count });
  expect(session.runCalibration()).toBe(true);
}

  /** ⚑⚑ `unmarkedBar` IS GONE: nothing can be captured into a
   * figure with no category axis any more, so no test needs to build one.
   * See `CalibrationSession.categoryAxisIncomplete`. */

describe('getBarCategoryTable: gating', () => {
  it('is empty before calibration', () => {
    const session = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    expect(session.getBarCategoryTable()).toEqual({ categoryNames: [], categoryRawNames: [], columns: [], crowded: [], advisory: [], valueColumns: [], derivedColumnIndex: null });
  });

  it('⚑⚑ SERVES a 5-slot Box Plot too - it marks a category axis in the same walk', () => {
    // ⚠️ THIS TEST USED TO PIN THE OPPOSITE, and pinning it is how it survived a
    // release: the table refused a box plot, which then fell to the generic
    // tuple table and listed its boxes in CLICK ORDER while the rest of the
    // family filed theirs under categories. The gate asked "is this captured as
    // opposite corners" when the question it meant was "does this type file its
    // readings under categories".
    const session = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    calibratedBar(session, 2);
    session.applyBoxPlotGroups();
    const table = session.getBarCategoryTable();
    // ⚑ Reached through the LEGACY door - a Bar session reshaped by
    // `applyBoxPlotGroups` - which is the entrance most likely to be forgotten.
    // Five named values, in the order the record answers them - no bespoke
    // declaration, just the type's own slots (`valueColumnNames`' third case).
    expect(table.valueColumns).toEqual(['Min', 'Q1', 'Median', 'Q3', 'Max']);
    // A box plot derives nothing: every one of the five was measured.
    expect(table.derivedColumnIndex).toBeNull();
    expect(table.categoryNames.length).toBeGreaterThan(0);
  });
});

describe('getBarCategoryTable: the Box Plot, first-class', () => {
  it('files its five letter values under the categories its own walk marked', () => {
    // ⚑ The other Box Plot test reaches the 5-slot shape through the LEGACY door
    // (a Bar session plus `applyBoxPlotGroups`). This is the type's own config,
    // which is the door a user actually comes through - "the model has more than
    // one entrance", so both are driven.
    const session = calibratedHealthy('boxplot', BOX_PLOT_AXES_CONFIG);
    const table = session.getBarCategoryTable();
    expect(table.valueColumns).toEqual(['Min', 'Q1', 'Median', 'Q3', 'Max']);
    // ⚑ Nothing is DERIVED: a box plot's five values are five measurements, so
    // no cell carries the `[ ]` mark that means "not read off the pixels".
    expect(table.derivedColumnIndex).toBeNull();
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
    expect(col.cells[0]![0]).toBeCloseTo(5, 9);
    expect(col.cells[1]![0]).toBeCloseTo(2, 9);
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
    expect(table.columns[0]!.cells[0]![0]).toBeNull();
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
    expect(session.getBarCategoryTable().columns[0]!.cells.map((c) => c[0])).toEqual([null, null]);

    // The cursor now sits at tuple 1's own remaining slot (nextSlot() walked
    // forward from where tuple 1 was just filled) -- completing tuple 0
    // again requires aiming BACK at it directly, exactly what the Bar
    // table's empty-cell click now does.
    expect(session.setSlotCursor(0, 1)).toBe(true);
    session.addDataPoint(150, 420); // fills tuple 0's missing corner directly

    const table = session.getBarCategoryTable();
    expect(table.columns[0]!.cells[0]![0]).not.toBeNull(); // tuple 0 completed
    expect(table.columns[0]!.cells[1]![0]).toBeNull(); // tuple 1 untouched, still half-filled
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
    expect(s1.cells[0]![0]).toBeCloseTo(5, 9); // series 1 has Flax
    expect(s1.cells[1]![0]).toBeCloseTo(1, 9); // ...and Hemp
    expect(s2.cells[0]![0]).toBeCloseTo(6.25, 9); // series 2 has Flax
    expect(s2.cells[1]![0]).toBeNull(); // series 2 never reached Hemp
    expect(s2.tupleIndices[1]).toBeNull();
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
    // ⚑ A STACKED figure names TWO values per segment (v2.5) - where it starts
    // and what it contributes - which is what `bar(x, height, bottom)` asks for
    // and the only way a partly captured stack keeps its position.
    expect(table.valueColumns).toEqual(['Base', 'Value']);
    expect(table.columns[0]!.cells[0]![0]).toBeCloseTo(2, 9); // Base: the segment's own foot
    expect(table.columns[0]!.cells[0]![1]).toBeCloseTo(3, 9); // Value: its contribution
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
    // ⚑⚑ WIDENED BY DRAGGING THE HANDLES. `calibratedBar` has already
    // walked the category axis; this fixture wants it to span x 100..900
    // instead, and since v2.3 that axis IS steps c1/c2, so moving it means
    // moving them. `markCategoryAxis` moved the geometry and left the
    // calibration record on the old ends - a state no gesture produces.
    session.updateCalibPointPixel('c1', 100, 500);
    session.updateCalibPointPixel('c2', 900, 500);
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
    const values = table.columns[0]!.cells.map((c) => c[0]);
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
    expect(table.columns[0]!.cells.map((c) => c[0]).every((v) => v !== null)).toBe(true);
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
   * ⚑ Re-placing was where it went wrong, and the two layers disagreed in
   * their own comments about it. `BandedAxis.clearGeometry` said "the declared
   * count survives: how many bands the figure has is a fact about the figure,
   * not about where it was clicked" - and `CategoryAxis.clearGeometry`, one
   * level up, cleared `_countDeclared` anyway. So marking the axis again brought
   * back the bands, the ticks and the names, and left the model believing nobody
   * had ever declared a count.
   *
   * ⚠️ BOTH METHODS ARE GONE NOW, and so is the shape that allowed this: since
   * v2.3 the category axis IS calibration steps c1/c2, so nothing can drop the
   * geometry independently of the declaration and let the two facts disagree.
   * The test stays because the defect it names is about what re-placing must NOT
   * do, and re-placing still exists - it is a handle drag.
   */
  function markedFourBands(): CalibrationSession<BarAxes> {
    const session = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    calibratedBar(session);
    // ⚑⚑ WIDENED BY DRAGGING THE HANDLES. `calibratedBar` has already
    // walked the category axis; this fixture wants it to span x 100..900
    // instead, and since v2.3 that axis IS steps c1/c2, so moving it means
    // moving them. `markCategoryAxis` moved the geometry and left the
    // calibration record on the old ends - a state no gesture produces.
    session.updateCalibPointPixel('c1', 100, 500);
    session.updateCalibPointPixel('c2', 900, 500);
    return session;
  }

  /** Named, re-placed, re-marked - the state his file was saved in. */
  function replacedAxis(): CalibrationSession<BarAxes> {
    const session = markedFourBands();
    ['Day 3', 'Day 7', 'Day 14', 'Day 21'].forEach((name, i) =>
      session.getCategoryAxis().renameCategory(i, name),
    );
    // ⚑ RE-PLACING is dragging the two handles back onto the figure.
    session.updateCalibPointPixel('c1', 100, 500);
    session.updateCalibPointPixel('c2', 900, 500);
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
    expect(table.columns[0]!.cells[0]![0]).not.toBeNull();
    expect(table.columns[0]!.cells.map((c) => c[0]).slice(1)).toEqual([null, null, null]);
  });

  it('⚑ and it still lands in its band when a tick has been DRAGGED first', () => {
    // `geometry.adjusted` is true in his file, so the drag is in the sequence.
    const session = replacedAxis();
    expect(session.moveCategoryTick(1, { x: 420, y: 500 })).toBe(true);
    session.addDataPoint(140, 500);
    session.addDataPoint(220, 300);
    expect(session.getBarCategoryTable().categoryNames).toHaveLength(4);
  });

});

/**
 * ⚑⚑ MOVED TO SPAN CHART (v2.5). The two-column reading is the SPAN's record -
 * both ends measured, neither a baseline. Bar keeps one Value column, because
 * that is what a bar measured from a baseline has.
 */
describe('⚑⚑ the columns are the TYPE\u2019s named values', () => {
  /**
   * David: *"For the floating bars output window, I think we will add another
   * row below #, Category, Series N, that says Min, Max in two separate
   * columns."* And he refused showing `Min` on ordinary bars as well - a column
   * of zeros *"will look like a fault to the users"*.
   *
   * ⚑⚑ v2.5 STATES THE GENERAL RULE INSTEAD OF THE TWO CASES. A datum has N
   * NAMED values and N belongs to the TYPE: 1 for a Bar (`Value`), 2 for a Span
   * (`Min`, `Max`), 4 for a candlestick, 5 for a box plot - which is how every
   * plotting library asks for them (`bar(x, height)`, `broken_barh`,
   * `Candlestick(open, high, low, close)`, `bxp(med, q1, q3, whislo, whishi)`).
   * See `engine/valueColumns.ts`.
   *
   * ⚠️ WHAT THAT REPLACED: two arrays, `values` and `intervals`, with every
   * consumer branching on which was null - the N=1 and N=2 cases carried as
   * separate shapes, where a box plot's five would have wanted a third. David:
   * *"you had a tendency to make special cases for some groups, and forgot to
   * look at the bigger picture for consistency and coherency."*
   */
  function markedFourBands(): CalibrationSession<BarAxes> {
    const session = new CalibrationSession<BarAxes>(SPAN_AXES_CONFIG);
    calibratedBar(session);
    // ⚑⚑ WIDENED BY DRAGGING THE HANDLES. `calibratedBar` has already
    // walked the category axis; this fixture wants it to span x 100..900
    // instead, and since v2.3 that axis IS steps c1/c2, so moving it means
    // moving them. `markCategoryAxis` moved the geometry and left the
    // calibration record on the old ends - a state no gesture produces.
    session.updateCalibPointPixel('c1', 100, 500);
    session.updateCalibPointPixel('c2', 900, 500);
    return session;
  }

  /** The same fixture on a BAR session, for the half of this block that is
   *  about a bar measured from its baseline rather than about a span. */
  function markedFourBandsBar(): CalibrationSession<BarAxes> {
    const session = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    calibratedBar(session);
    session.updateCalibPointPixel('c1', 100, 500);
    session.updateCalibPointPixel('c2', 900, 500);
    return session;
  }

  it('a BAR has ONE named value, and its row has one cell', () => {
    const session = markedFourBandsBar();
    session.addDataPoint(140, 500); // value 0 - the origin
    session.addDataPoint(220, 300); // value 5
    const table = session.getBarCategoryTable();
    expect(table.valueColumns).toEqual(['Value']);
    expect(table.columns[0]!.cells[0]).toHaveLength(1);
    expect(table.columns[0]!.cells[0]![0]).toBeCloseTo(5, 6);
  });

  it('⚑⚑ a SPAN has TWO, and the same table simply has two cells', () => {
    const session = markedFourBands();
    session.addDataPoint(140, 400); // value 2.5
    session.addDataPoint(220, 300); // value 5
    const table = session.getBarCategoryTable();
    expect(table.valueColumns).toEqual(['Min', 'Max']);
    expect(table.columns[0]!.cells[0]![0]).toBeCloseTo(2.5, 6);
    expect(table.columns[0]!.cells[0]![1]).toBeCloseTo(5, 6);
  });

  it('⚑ a row with no datum is still FULL WIDTH, so no column can shift', () => {
    // ⚑ The nulls keep their places. A short row would let a reader (or an
    // exporter) line a Max up under a Min.
    const session = markedFourBands();
    session.addDataPoint(140, 400);
    session.addDataPoint(220, 300);
    const col = session.getBarCategoryTable().columns[0]!;
    expect(col.cells.slice(1)).toEqual([[null, null], [null, null], [null, null]]);
  });

  /**
   * ⚑⚑ THE MIXTURE IS GONE, AND THAT IS THE POINT OF THE SPLIT (v2.5).
   *
   * This used to read *"the two are per SERIES, so one may float while another
   * sits down"* - one figure carrying value rows and interval rows at once,
   * decided per bar by whether its near end happened to touch the baseline.
   * That is exactly the hidden mode Span chart exists to remove: the TYPE now
   * says which record you get, so a reader never has to ask a column what it
   * means this time.
   *
   * ⚑ Nothing is lost. A figure whose bars mostly sit on the baseline and one of
   * which floats is a Span chart; the seated ones simply report a Min that
   * happens to be the baseline value.
   */
  it('⚑⚑ every row of a SPAN is an interval - the type decides, not the bar', () => {
    const session = markedFourBands();
    session.addDataPoint(140, 500); // one end ON the old baseline value
    session.addDataPoint(220, 300);
    session.addDataPoint(340, 400); // and one clear of it
    session.addDataPoint(420, 300);
    const table = session.getBarCategoryTable();
    // ⚑ The TYPE decides, so BOTH rows have the same two named values - the one
    // that happens to touch the old baseline value included. That is the hidden
    // mode this split removed: a figure cannot carry value rows and interval
    // rows at once any more.
    expect(table.valueColumns).toEqual(['Min', 'Max']);
    const col = table.columns[0]!;
    expect(col.cells[0], 'even the one touching the baseline').toHaveLength(2);
    expect(col.cells[1]).toHaveLength(2);
    expect(col.cells[0]!.every((v) => v != null)).toBe(true);
    expect(col.cells[1]!.every((v) => v != null)).toBe(true);
  });

});
