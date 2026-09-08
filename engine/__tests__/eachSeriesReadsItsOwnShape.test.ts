/**
 * ⚑⚑ A ROW'S CELLS ARE READ WITH THE SERIES' OWN SLOTS, NOT THE SELECTED ONE'S.
 *
 * `getTupleRows(datasetIndex)` exists so a multi-series export can reach the
 * series that are NOT selected. Every other line in it threads `datasetIndex` -
 * the label, the position, the points. `cells` asked `this.activeEntry`.
 *
 * ⚠️ `valueCells`' own doc for that argument states the premise it broke: *"The
 * dataset's OWN slot names - what `valueColumnNames` was asked, so the two
 * cannot answer from different premises."* The header comes from one series and
 * the numbers from another's shape, so a bar's single `Value` printed under a
 * box plot's `Q1`. Gate 3.
 *
 * ⚑⚑ AND IT IS THE SAME SHAPE THE COMMENT FIFTEEN LINES BELOW CELEBRATES HAVING
 * FIXED - `activeDatasetIndex` where `datasetIndex` was threaded, found by the
 * v2.3 audit fleet in the stacking argument, reappearing one property up in
 * v2.5. A model with more than one entrance, and this is the entrance nobody
 * watches: it is only reachable when the series you are looking at is not the
 * series being exported.
 */
import { describe, expect, it } from 'vitest';
import { CalibrationSession, BAR_AXES_CONFIG, type CalibratedAxes } from '../calibrationSession.js';
import { buildExportSections } from '../exportAssembly.js';
import type { ExportAssemblyInput } from '../exportAssembly.js';
import { walkCategoryAxis } from './helpers/categoryWalk.js';

function twoSeriesBar(): CalibrationSession<CalibratedAxes> {
  const s = new CalibrationSession<CalibratedAxes>(BAR_AXES_CONFIG as never);
  s.handleCalibrationClick(100, 500);
  s.confirmCalibrationValues(['0']);
  s.handleCalibrationClick(100, 100);
  s.confirmCalibrationValues(['7']);
  walkCategoryAxis(s, { from: { x: 100, y: 500 }, to: { x: 400, y: 500 }, count: 3 });
  s.runCalibration();
  // Series 1: an ordinary bar. Two corners, ONE reported value.
  s.addDataPoint(120, 500);
  s.addDataPoint(120, 313);
  return s;
}

describe('every series is read with its own shape', () => {
  it('an unselected plain bar keeps its own cells when a box-plot series is selected', () => {
    const s = twoSeriesBar();
    const plain = s.getTupleRows(0)[0]!.cells;

    // Series 2, reshaped to a box plot's five slots, and SELECTED.
    s.addDataset('Series 2');
    s.setActiveDataset(1);
    expect(s.applyBoxPlotGroups(), 'the second series reshapes to five slots').toBe(true);

    const afterwards = s.getTupleRows(0)[0]!.cells;
    expect(
      afterwards,
      `series 1 is a plain bar either way; selecting series 2 must not change how it reads.\n` +
        `  before: ${JSON.stringify(plain)}\n  after : ${JSON.stringify(afterwards)}`
    ).toEqual(plain);
  });

  it('the cells a series exports line up with the names that series is given', () => {
    // ⚑ ALIGNED IS THE WHOLE CONTRACT (`valueColumns.ts`): a caller pairs
    // name[i] with cell[i] and needs to know nothing else about the type. A
    // header from one series over numbers from another breaks exactly that.
    const s = twoSeriesBar();
    s.addDataset('Series 2');
    s.setActiveDataset(1);
    s.applyBoxPlotGroups();

    const names = s.getValueColumns(0);
    const cells = s.getTupleRows(0)[0]!.cells;
    expect(cells.length, `names ${JSON.stringify(names)} vs cells ${JSON.stringify(cells)}`).toBe(
      names.length
    );
  });

  it('a multi-series file gives each block ITS OWN headings', () => {
    // ⚑⚑ THE USER-VISIBLE END OF THE SAME DEFECT. `buildExportSections` already
    // fetched the ROWS per series; the slot names and value columns were
    // hoisted from the active one and reused for every block, so a two-series
    // file put one series' words over the other's numbers - and WHICH words
    // depended on what was selected when Export was pressed.
    const s = twoSeriesBar();
    s.addDataset('Series 2');
    s.setActiveDataset(1);
    s.applyBoxPlotGroups();
    for (const y of [483, 441, 377, 313, 259]) s.addDataPoint(220, y);

    const sections = buildExportSections({
      session: s,
      axes: s.getAxes()!,
      configId: 'bar',
      scope: 'all',
      measures: [],
      precision: 'auto',
    } as unknown as ExportAssemblyInput);

    const blocks = sections.filter((b) => b.title != null);
    expect(blocks.length, 'one block per series').toBe(2);
    const headerOf = (title: string) => blocks.find((b) => b.title === title)!.header;

    // The reshaped series names a box plot's five; the plain bar does not.
    expect(headerOf('Series 2')).toEqual(expect.arrayContaining(['Q1', 'Median', 'Q3']));
    expect(
      headerOf('Series 1'),
      `a plain bar has no quartiles: ${JSON.stringify(headerOf('Series 1'))}`
    ).not.toEqual(expect.arrayContaining(['Q1']));

    // ⚑ And every block's numbers still line up with its own words.
    for (const block of blocks) {
      for (const row of block.rows) {
        expect(row.length, `${block.title}: ${JSON.stringify(block.header)} vs ${JSON.stringify(row)}`).toBe(
          block.header.length
        );
      }
    }
  });
});
