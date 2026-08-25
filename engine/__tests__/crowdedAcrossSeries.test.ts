import { describe, expect, it } from 'vitest';
import { CalibrationSession, BAR_AXES_CONFIG } from '../calibrationSession.js';
import type { BarAxes } from '../../core/axes/bar.js';
import { walkCategoryAxis } from './helpers/categoryWalk.js';

/**
 * ⚑⚑ A CROWDED READING BELONGS TO A SERIES, AND THE ACTIONS ON IT MUST TOO.
 *
 * `getBarCategoryTable().crowded` spans EVERY series - it carries a
 * `seriesIndex` for exactly that reason - while `removeTuple` and
 * `pixelsOfTuple` act on whichever series is ACTIVE.
 *
 * ⚠️ FOUND IN THE AUDIT THE NIGHT IT WAS BUILT, and it was the bad kind:
 * pressing the conflict row's delete while a different series was selected
 * removed a perfectly good bar from THAT series, left the crowded reading
 * untouched, and said nothing. Silent data loss on a control whose whole job is
 * to clean up a mistake.
 *
 * ▶ The table's own cells had always guarded this - *"switch AND select, in one
 * click"* - and the conflict block was written without it. The fix makes the
 * series EXPLICIT rather than remembering to switch first, because then there is
 * no order to get wrong.
 */
function twoSeries() {
  const s = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
  s.handleCalibrationClick(100, 500);
  s.confirmCalibrationValues(['0']);
  s.handleCalibrationClick(100, 100);
  s.confirmCalibrationValues(['10']);
  walkCategoryAxis(s, { from: { x: 100, y: 500 }, to: { x: 400, y: 500 }, count: 3 });
  s.runCalibration();
  // Series 1: three good bars, one per band.
  for (const x of [120, 220, 320]) {
    s.addDataPoint(x, 500);
    s.addDataPoint(x + 40, 300);
  }
  // Series 2: two bars in band 1, so its SECOND tuple is crowded out.
  s.addDataset('Series 2');
  s.setActiveDataset(1);
  s.addDataPoint(220, 500);
  s.addDataPoint(240, 300);
  s.addDataPoint(260, 500);
  s.addDataPoint(280, 400);
  s.setActiveDataset(0); // …and the user is looking at series 1
  return s;
}

describe('acting on a crowded reading that belongs to another series', () => {
  it('⚑ names the series it belongs to, not the one that happens to be active', () => {
    const s = twoSeries();
    expect(s.getActiveDatasetIndex()).toBe(0);
    expect(s.getBarCategoryTable().crowded).toEqual([
      { seriesIndex: 1, categoryIndex: 1, tupleIndex: 1 },
    ]);
  });

  it('⚑⚑ removing it takes the bar from ITS series, leaving the active one whole', () => {
    // The defect: `removeTuple(1)` with series 0 active turned [5,5,5] into
    // [5,null,5] - a reading nobody asked to lose - while series 1's doubled
    // band was untouched and the warning stayed on screen.
    const s = twoSeries();
    const before = s.getBarCategoryTable();
    expect(before.columns[0]!.values).toEqual([5, 5, 5]);

    const c = before.crowded[0]!;
    s.setActiveDataset(c.seriesIndex);
    s.removeTuple(c.tupleIndex);

    const after = s.getBarCategoryTable();
    expect(after.columns[0]!.values).toEqual([5, 5, 5]); // untouched
    expect(after.crowded).toEqual([]); // and the crowding is actually resolved
  });

  it('⚑ its pixels come from its own series - asking the active one finds nothing', () => {
    // Which is why the click appeared dead rather than wrong: series 0 has no
    // tuple 1 to light up.
    const s = twoSeries();
    const c = s.getBarCategoryTable().crowded[0]!;
    expect(s.pixelsOfTuple(c.tupleIndex, c.seriesIndex)).toHaveLength(2);
  });
});
