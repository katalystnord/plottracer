import { describe, expect, it } from 'vitest';
import { BAR_AXES_CONFIG, CalibrationSession } from '../calibrationSession.js';
import type { BarAxes } from '../../core/axes/bar.js';

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
function calibratedBar(session: CalibrationSession<BarAxes>): void {
  session.handleCalibrationClick(300, 500);
  session.confirmCalibrationValues(['0']);
  session.handleCalibrationClick(300, 100);
  session.confirmCalibrationValues(['10']);
  expect(session.runCalibration()).toBe(true);
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
    calibratedBar(session);
    session.addDataPoint(150, 500); // bar 0: value 5
    session.addDataPoint(150, 300);
    session.addDataPoint(250, 500); // bar 1: value 2
    session.addDataPoint(250, 420);

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

  it('⚑ naming ONE bar leaves the other blank — two unnamed bars are separate slots', () => {
    // The capture path reserves each tuple its own CategoryAxis index via
    // addCategory(''), NOT setTupleLabel(i, ''), which would reuse an existing
    // category by matching its NAME — collapsing two still-unnamed bars onto
    // one shared '' slot, so naming either would rename BOTH. Nothing looks
    // wrong until a user types the second name and watches the first change.
    const session = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    calibratedBar(session);
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
    calibratedBar(session);
    session.addDataPoint(150, 500); // tuple 0, one corner only (Bar 1)
    expect(session.setSlotCursor(null, 0)).toBe(true); // start a genuinely NEW tuple
    session.addDataPoint(250, 500); // tuple 1, one corner only (Bar 2)
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
    calibratedBar(session);
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
    const session = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    calibratedBar(session);
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

  it('threads a per-series Stack group into the derived value, same as getTupleRows (v2.0 Phase 5)', () => {
    // ⚑ getBarCategoryTable has its own derive.compute call (necessarily --
    // it iterates every series, not just the active one), so the stackGroup
    // wiring could silently drift from getTupleRows's without a direct check.
    const session = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    calibratedBar(session);
    session.setDatasetStackGroup(0, 'left');
    session.addDataPoint(150, 420); // value 2
    session.addDataPoint(150, 300); // value 5 -- unsigned span 3, not baseline-relative
    const table = session.getBarCategoryTable();
    expect(table.columns[0]!.values[0]).toBeCloseTo(3, 9);
  });
});
