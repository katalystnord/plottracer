/**
 * ⚑⚑ TWO TYPES' DATA IN ONE FIGURE IS LAYERED DATA, AND WE DO NOT SUPPORT IT
 * YET - so the file OPENS, every series is read under its OWN slots, and the
 * app says so. David, 2026-09-14: *"two different types of graphs data in
 * different series on one figure. That is layered data. and we do not support
 * that yet."*
 *
 * ⚑ WHY THE FILE IS THE DOOR, and it is the same door as
 * `spiderSlotMismatch.test.ts`: the click path cannot build one. Checkpoint 109
 * retired the hidden "Box Plot Groups" toggle (*"one discoverable path now, not
 * two"*), so `applyBoxPlotGroups` has no UI caller and nothing on screen
 * reshapes one series out of step with its siblings. A WPD import carrying
 * per-dataset point groups, an old project, or a hand-edited file can.
 *
 * ⚠️ WHAT WAS WRONG BEFORE THIS FILE. `getBarCategoryTable` asked for the slot
 * names ONCE, off the ACTIVE series, under a comment asserting *"the names are a
 * fact about the TYPE, not about a series or a row"* - which `setSlotNames`
 * (active entry only) and `valueColumns.ts`'s own header (*"a session can be
 * reshaped out of that shape at runtime"*) both contradict. It was not only the
 * headers: `ownSlotsForCells` was handed to `valueCells` for EVERY series, and
 * `isReshaped` decides the reading shape from it - so a non-active series of
 * another shape had its NUMBERS read under the wrong premise. A silent wrong
 * number, which is the only kind this project treats as critical.
 *
 * ⚑ REFUSING TO OPEN WAS CONSIDERED AND REJECTED (David). `loadCalibrated`'s
 * standing decision is *"Surfaced, NOT refused... Visible and recoverable beats
 * silent and pristine (tenet 1)"*, and it dedupes colliding names rather than
 * turning the file away. A hard refusal here would stand alone at that door.
 */
import { describe, expect, it } from 'vitest';
import { CalibrationSession, BAR_AXES_CONFIG } from '../calibrationSession.js';
import { BOX_PLOT_SLOTS, OPPOSITE_CORNER_SLOTS } from '../axesTypeConfigs.js';
import { Dataset } from '../../core/dataset.js';
import type { BarAxes } from '../../core/axes/bar.js';
import { walkCategoryAxis } from './helpers/categoryWalk.js';
import type { CategoryAxis } from '../../core/categoryAxis.js';

/**
 * A calibrated Bar session's axes AND its category axis: P1=0 @ (300,500),
 * P2=10 @ (300,100).
 *
 * ⚠️ THE CATEGORY AXIS IS PART OF THE FIXTURE, and leaving it out made the
 * first version of this file measure nothing: `loadCalibrated` defaults to an
 * EMPTY one, the table then has no rows, and every per-series `cells` assertion
 * passes against `[]`. Same trap the spider-mismatch fixture fell into - check
 * the case is reachable by the route the test takes.
 */
function calibratedBar(categories = 2): { axes: BarAxes; categoryAxis: CategoryAxis } {
  const session = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
  session.handleCalibrationClick(300, 500);
  session.confirmCalibrationValues(['0']);
  session.handleCalibrationClick(300, 100);
  session.confirmCalibrationValues(['10']);
  walkCategoryAxis(session, { count: categories });
  expect(session.runCalibration(), session.getCalibrationError() ?? 'no error').toBe(true);
  return { axes: session.getAxes()!, categoryAxis: session.getCategoryAxis() };
}

/**
 * A series holding ONE COMPLETE TUPLE under `names`.
 *
 * ⚑ A tuple, not loose pixels - the load door PRUNES a pixel belonging to no
 * tuple (*"a point with no axis is not a datum"*), which is what made the first
 * spider-mismatch fixture measure the opposite of its subject.
 */
function seriesWithATuple(name: string, names: readonly string[], x: number): Dataset {
  const ds = new Dataset(names.length);
  ds.name = name;
  ds.setSlotNames([...names]);
  const tuple = ds.addTuple(ds.addPixel(x, 400))!;
  names.forEach((_, slot) => {
    if (slot === 0) return;
    ds.addToTupleAt(tuple, slot, ds.addPixel(x, 400 - slot * 30));
  });
  return ds;
}

/** The two-series layered file: a Bar-shaped series beside a Box-Plot-shaped one. */
function layeredSession(): CalibrationSession<BarAxes> {
  const session = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
  const { axes, categoryAxis } = calibratedBar();
  session.loadCalibrated(axes, [
    seriesWithATuple('Bar series', OPPOSITE_CORNER_SLOTS, 250),
    seriesWithATuple('Box series', BOX_PLOT_SLOTS, 350),
  ], categoryAxis);
  return session;
}

describe('a file holding two types’ data in one figure', () => {
  it('opens, and does not strand the user’s points', () => {
    const session = layeredSession();
    expect(session.getDatasets()).toHaveLength(2);
    expect(session.getDatasets()[0]!.getSlotNames()).toEqual([...OPPOSITE_CORNER_SLOTS]);
    expect(session.getDatasets()[1]!.getSlotNames()).toEqual([...BOX_PLOT_SLOTS]);
  });

  it('⚑⚑ says point blank that layered graphs are not supported yet', () => {
    // A STATEMENT, not an offer. David, 2026-09-15, after a split feature grew
    // out of a one-line correctness fix: *"we will just point blank say that we
    // do not yet support layered graphs. And that is it."*
    const notice = layeredSession().getLayeredNotice();
    expect(notice).not.toBeNull();
    expect(notice).toMatch(/does not support/i);
    expect(notice).toMatch(/layered graphs/i);
    // Nothing to press, and nothing technical: no series names, no slot names.
    expect(notice).not.toMatch(/Corner|Min, Q1|proceed/);
  });

  it('offers nothing when every series agrees - it must not over-reach', () => {
    const session = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    const { axes, categoryAxis } = calibratedBar();
    session.loadCalibrated(axes, [
      seriesWithATuple('A', OPPOSITE_CORNER_SLOTS, 250),
      seriesWithATuple('B', OPPOSITE_CORNER_SLOTS, 350),
    ], categoryAxis);
    expect(session.getLayeredNotice()).toBeNull();
  });

  it('⚑⚑ names EVERY series’ columns by that series’ own slots', () => {
    const table = layeredSession().getBarCategoryTable();
    expect(table.columns[0]!.valueColumns).toEqual(['Value']);
    expect(table.columns[1]!.valueColumns).toEqual([...BOX_PLOT_SLOTS]);
  });

  it('⚑⚑ READS every series’ numbers by that series’ own slots, not the active one’s', () => {
    const table = layeredSession().getBarCategoryTable();
    // ⚠️ Without rows every assertion below is vacuous - see `calibratedBar`.
    expect(table.categoryNames.length).toBeGreaterThan(0);
    table.columns.forEach((col) => expect(col.cells.length).toBe(table.categoryNames.length));
    // Aligned is the whole contract: one cell per name, on every row.
    table.columns.forEach((col) => {
      col.cells.forEach((row) => expect(row).toHaveLength(col.valueColumns.length));
    });
    // The box series reports FIVE measured numbers, not one derived from a
    // shape it was never captured under.
    const boxRow = table.columns[1]!.cells.find((r) => r.some((v) => v !== null));
    expect(boxRow).toBeDefined();
    expect(boxRow!.filter((v) => v !== null).length).toBeGreaterThan(1);
  });

  it('⚠️ is BLIND to two types that share a slot shape - and so is the file', () => {
    /**
     * David, 2026-09-14: *"So a new type of graph will break your text."* This
     * is the case that would, pinned rather than described.
     *
     * Bar and Span BOTH declare `OPPOSITE_CORNER_SLOTS`, so a Bar-shaped series
     * and a Span-shaped one are indistinguishable here. ⚑ They are also
     * indistinguishable IN THE RECORD: a Span's `Min`/`Max` names come from the
     * document's type config, not from the series, so the two datasets are the
     * same bytes. There is no layering to miss - the file cannot express it.
     *
     * ▶ The boundary this sets, and the one a new type must be read against: a
     * type bringing NEW slots is detected and named; a type REUSING existing
     * slots cannot arrive as a layered file at all.
     */
    const session = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    const { axes, categoryAxis } = calibratedBar();
    session.loadCalibrated(axes, [
      seriesWithATuple('Bar-shaped', OPPOSITE_CORNER_SLOTS, 250),
      seriesWithATuple('Span-shaped', OPPOSITE_CORNER_SLOTS, 350),
    ], categoryAxis);
    expect(session.getLayeredNotice()).toBeNull();
  });

  it('the document-level valueColumns is the ACTIVE series’ answer, from the same computation', () => {
    const session = layeredSession();
    const table = session.getBarCategoryTable();
    expect(table.valueColumns).toEqual(table.columns[session.getActiveDatasetIndex()]!.valueColumns);
  });
});
