/**
 * ⚑⚑ A PERSON'S CELL READING FOLLOWS THE PATCH OF FIGURE IT WAS TAKEN FROM.
 *
 * ⚠️ FOUND BY AUDIT, 2026-09-10. Readings are keyed `col,row`. Inserting or
 * removing a boundary RENUMBERS every cell past the change, and nothing
 * reindexed them - so a number someone measured off the figure reappeared
 * against a cell they never looked at, while the cell they did read reverted to
 * the colour. Measured on the committed viridis fixture: `42` typed into the
 * cell spanning x 6..7, one boundary added, and the 42 was filed under 5..6
 * while 6..7 went back to -8.44. Both then reach the table, the project file and
 * every export, with `source = user` on the wrong row - and in a heatmap colour
 * IS the value, so there is no second symptom.
 *
 * ⚑ THE RULE WAS ALREADY WRITTEN AND ONLY THE DRAG OBEYED IT. `moveDivider`
 * refuses to re-sort in these words: *"the values would still be right and they
 * would be filed under the wrong column, which is the silent kind of wrong."*
 * Insert, remove and re-detect renumber harder than a drag ever does.
 */
import { describe, expect, it } from 'vitest';
import { reindexCellReadings, cellKey, type HeatmapState } from '../heatmapRun.js';

/** Four bands on x, two on y - so there is a middle to disturb. */
const BEFORE: HeatmapState = { xDividers: [0, 5, 6, 7, 9], yDividers: [0, 4, 8] };

describe('a cell reading travels with its own patch of figure', () => {
  it('⚑⚑ keeps its cell when a boundary is added BEFORE it, though the index changes', () => {
    // `42` was read from the cell spanning x 6..7 - that is col 2 here.
    const readings = { [cellKey(2, 0)]: 0.42 };
    // A boundary at 2.5 pushes every column past it along by one.
    const after: HeatmapState = { xDividers: [0, 2.5, 5, 6, 7, 9], yDividers: [0, 4, 8] };
    const out = reindexCellReadings(readings, BEFORE, after);
    expect(out.dropped).toBe(0);
    // The same patch of figure - x 6..7 - is col 3 now.
    expect(out.readings[cellKey(3, 0)], JSON.stringify(out.readings)).toBe(0.42);
    expect(out.readings[cellKey(2, 0)], 'it stayed on the old index').toBeUndefined();
  });

  it('⚑ keeps its cell when a boundary is REMOVED before it', () => {
    const readings = { [cellKey(2, 0)]: 0.42 };
    const after: HeatmapState = { xDividers: [0, 6, 7, 9], yDividers: [0, 4, 8] };
    const out = reindexCellReadings(readings, BEFORE, after);
    expect(out.dropped).toBe(0);
    expect(out.readings[cellKey(1, 0)]).toBe(0.42);
  });

  it('⚑⚑ DROPS a reading whose cell was split, rather than picking a half', () => {
    // A boundary at 6.5 lands INSIDE the cell that was read. Neither half is the
    // patch the person looked at, so keeping the number for either would be
    // inventing a reading nobody took.
    const readings = { [cellKey(2, 0)]: 0.42 };
    const after: HeatmapState = { xDividers: [0, 5, 6, 6.5, 7, 9], yDividers: [0, 4, 8] };
    const out = reindexCellReadings(readings, BEFORE, after);
    expect(out.dropped, 'the split reading was carried anyway').toBe(1);
    expect(Object.keys(out.readings)).toEqual([]);
  });

  it('⚑ drops a reading whose cell was MERGED away', () => {
    // Removing 6 merges 5..6 and 6..7 into 5..7 - a cell neither reading names.
    const readings = { [cellKey(1, 0)]: 0.1, [cellKey(2, 0)]: 0.42 };
    const after: HeatmapState = { xDividers: [0, 5, 7, 9], yDividers: [0, 4, 8] };
    const out = reindexCellReadings(readings, BEFORE, after);
    expect(out.dropped).toBe(2);
    expect(Object.keys(out.readings)).toEqual([]);
  });

  it('⚑ follows a row change on the OTHER axis too', () => {
    const readings = { [cellKey(2, 1)]: 0.42 };
    const after: HeatmapState = { xDividers: [0, 5, 6, 7, 9], yDividers: [0, 2, 4, 8] };
    const out = reindexCellReadings(readings, BEFORE, after);
    expect(out.dropped).toBe(0);
    expect(out.readings[cellKey(2, 2)]).toBe(0.42);
  });

  it('⚑ an unchanged grid changes nothing - the companion assertion', () => {
    // This is the case every ordinary edit is, and the one a wrong tolerance
    // would break: a divider that has been through data space and back is equal
    // to itself only to within floating point.
    const readings = { [cellKey(2, 0)]: 0.42, [cellKey(0, 1)]: 0.9 };
    const jittered: HeatmapState = {
      xDividers: BEFORE.xDividers.map((d) => d + d * 1e-15),
      yDividers: [...BEFORE.yDividers],
    };
    const out = reindexCellReadings(readings, BEFORE, jittered);
    expect(out.dropped).toBe(0);
    expect(out.readings).toEqual(readings);
  });

  it('⚑ and nothing to carry is not an error', () => {
    const out = reindexCellReadings({}, BEFORE, { xDividers: [0, 9], yDividers: [0, 8] });
    expect(out).toEqual({ readings: {}, dropped: 0 });
  });
});
