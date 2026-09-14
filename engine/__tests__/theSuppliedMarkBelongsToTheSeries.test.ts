/**
 * ⚑⚑ A TYPED VALUE IS MARKED AS TYPED IN EVERY SERIES, NOT ONLY THE SELECTED
 * ONE.
 *
 * ⚠️ FOUND BY AUDIT, 2026-09-15, while sweeping `getBarCategoryTable` for the
 * remaining places where one series is read through another's index - the class
 * `fd37c7b` fixed for the value COLUMNS. The `supplied` grid had the same shape
 * and was left behind:
 *
 *     if (seriesIndex !== this.activeDatasetIndex) return false;
 *
 * `[ ]` means *"a value not read off the pixels"* - the output panel's own
 * convention across every type. Returning `false` for every inactive series does
 * not hide a decoration: it REPORTS a number as measured that a person typed,
 * and which of the two series is the selected one is a fact about the UI, not
 * about the reading. Pattern 3 in plain form - reporting something we did not
 * measure - and the reader has nothing on screen saying which cells to trust.
 *
 * ⚑ THE CAUSE IS THE ONE THE COMMIT ABOVE NAMES: `valuePointIndexFor` answers
 * for `this.activeEntry` alone, so the guard was standing in for a question the
 * method could not be asked. It can be asked now; the guard goes.
 */
import { describe, expect, it } from 'vitest';
import { CalibrationSession, BAR_AXES_CONFIG } from '../calibrationSession.js';
import { walkCategoryAxis } from './helpers/categoryWalk.js';

/** An upright bar chart: value 0..10 over py 300..100, four categories. */
function twoBarSeries() {
  const s = new CalibrationSession(BAR_AXES_CONFIG);
  s.handleCalibrationClick(100, 300);
  s.confirmCalibrationValues(['0']);
  s.handleCalibrationClick(100, 100);
  s.confirmCalibrationValues(['10']);
  walkCategoryAxis(s);
  expect(s.runCalibration()).toBe(true);
  // Series 1, one bar in the first band: base corner then top corner.
  s.addDataPoint(150, 300);
  s.addDataPoint(170, 200);
  s.addDataset('Series 2');
  s.addDataPoint(250, 300);
  s.addDataPoint(270, 250);
  return s;
}

describe('the supplied mark belongs to the series, not to the selection', () => {
  it('⚠️⚑⚑ a value typed into series 2 still reads as typed once series 1 is selected', () => {
    const s = twoBarSeries();
    // Series 2 is the active one after `addDataset`; type its value.
    expect(s.getActiveDatasetIndex()).toBe(1);
    const table = s.getBarCategoryTable();
    const column = table.columns[1]!;
    const tupleIndex = column.tupleIndices.find((t): t is number => t !== null)!;
    const columnIndex = column.valueColumns.indexOf('Value') >= 0 ? column.valueColumns.indexOf('Value') : 0;
    const pointIndex = s.valuePointIndexFor(tupleIndex, columnIndex)!;
    expect(s.setDataPointValue(pointIndex, 0, 7)).toBe(true);

    // While it is selected, the mark is there - the premise.
    const selected = s.getBarCategoryTable().columns[1]!;
    const row = selected.tupleIndices.indexOf(tupleIndex);
    expect(selected.supplied[row]![columnIndex], 'the fixture typed nothing').toBe(true);

    // Now look at the other series. Nothing about the reading has changed.
    s.setActiveDataset(0);
    const seen = s.getBarCategoryTable().columns[1]!;
    expect(seen.cells[row]![columnIndex]).toBeCloseTo(7, 6);
    expect(
      seen.supplied[row]![columnIndex],
      'a typed value reads as measured whenever another series is selected'
    ).toBe(true);
  });

  it('⚑ and a measured value is still not marked, whichever series is selected', () => {
    // The companion assertion: answering per series must not mark everything.
    const s = twoBarSeries();
    s.setActiveDataset(0);
    for (const col of s.getBarCategoryTable().columns) {
      for (const row of col.supplied) {
        for (const cell of row) expect(cell).toBe(false);
      }
    }
  });
});
