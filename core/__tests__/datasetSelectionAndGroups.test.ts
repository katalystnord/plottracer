import { describe, expect, it } from 'vitest';
import { Dataset } from '../dataset.js';

/**
 * `Dataset` — the group/slot bookkeeping.
 *
 * ⚑ METHODS OF THE RECORD'S OWN CLASS HAD ZERO TEST REFERENCES ANYWHERE:
 * `getPointGroupsCount`, `getPixelIndexesInGroup`, `removeSlotFromTuples`,
 * `refreshTuplesAfterGroupAdd`, plus `clearAll`. Not weakly tested —
 * untouched. `dataset.ts` scored 53.71% with 136 uncovered mutants, and this
 * is where most of them lived.
 *
 * It matters now because **v2.0 changes the record**, and the slot machinery below is
 * exactly what a bar's value-plus-extent will be built on. These are the operations
 * that keep a tuple pointing at the pixels it means; when one of them is wrong the
 * result is not a crash, it is a reading silently attached to the wrong slot — the
 * shape of three separate defects already fixed this month.
 *
 * ⚑ This file also used to cover `Dataset`'s SELECTION api — nine methods
 * inherited from upstream. They were deleted on 2026-07-31 as unreachable:
 * the app tracks selection in React state (`selectedPointIndices`) and
 * implements its own marquee in `Workspace.tsx`'s `handleSelectRect`, so
 * nothing ever called them and `_selections` was never serialized. Tests
 * existing for a thing does not make it live.
 */

/** A dataset with `n` pixels at (10i, 20i), so index and position are readable. */
function withPixels(n: number): Dataset {
  const ds = new Dataset(1);
  for (let i = 0; i < n; i++) ds.addPixel(10 * i, 20 * i);
  return ds;
}

describe('clearing the dataset', () => {
  it('empties EVERY field, not just the points', () => {
    // ⚑ `clearAll` resets six fields. A mutant dropping any one of them leaves a
    // dataset that looks empty and is not — stale group names would make `hasSlots()`
    // true on a series with no points, and stale tuples would point at pixels that no
    // longer exist. Asserted field by field rather than by "the points are gone".
    const ds = withPixels(3);
    ds.setSlotNames(['Min', 'Max']);
    ds.setMetadataKeys(['label']);
    ds.setMetadataAt(0, { label: 'a' });
    ds.addTuple(0);
    ds.setMetadata({ note: 'series level' });

    ds.clearAll();

    expect(ds.getCount()).toBe(0);
    expect(ds.getAllTuples()).toEqual([]);
    expect(ds.getSlotNames()).toEqual([]);
    expect(ds.hasSlots()).toBe(false);
    expect(ds.getMetadataKeys()).toEqual([]);
    expect(ds.getMetadata()).toEqual({});
    expect(ds.hasMetadata()).toBe(false); // the per-pixel metadata COUNT, reset too
  });
});

describe('the slot machinery v2.0 will build the bar record on', () => {
  it('counts the groups it has', () => {
    const ds = new Dataset(1);
    expect(ds.getPointGroupsCount()).toBe(0);
    ds.setSlotNames(['Min', 'Q1', 'Median', 'Q3', 'Max']);
    expect(ds.getPointGroupsCount()).toBe(5);
  });

  it('reads one slot ACROSS every tuple — the table\'s column', () => {
    // This is how a spider's row and a box plot's column are read: one slot index,
    // every tuple, in order, with a null where the reading is missing.
    const ds = withPixels(4);
    ds.setSlotNames(['Start', 'End']);
    ds.addEmptyTupleAt(0);
    ds.addToTupleAt(0, 0, 0);
    ds.addToTupleAt(0, 1, 1);
    ds.addEmptyTupleAt(1);
    ds.addToTupleAt(1, 0, 2);
    // tuple 1's End is deliberately left empty.
    expect(ds.getPixelIndexesInGroup(0)).toEqual([0, 2]);
    expect(ds.getPixelIndexesInGroup(1)).toEqual([1, null]);
  });

  it('returns nothing for a slot index the dataset does not have', () => {
    // ⚑ Not an exception — an empty list. Callers iterate the result, so throwing
    // here would turn an out-of-range column into a crash mid-render.
    const ds = withPixels(2);
    ds.setSlotNames(['Only']);
    expect(ds.getPixelIndexesInGroup(1)).toEqual([]);
    expect(ds.getPixelIndexesInGroup(99)).toEqual([]);
  });

  it('adds slots to every existing tuple when the figure grows an axis', () => {
    // ⚑ The spider's "+ Add axis" on a series that already has readings. Without
    // this the new slot simply does not exist on the tuples already recorded, and
    // writing to it would extend one tuple and not its neighbours.
    const ds = withPixels(3);
    ds.setSlotNames(['A', 'B']);
    ds.addEmptyTupleAt(0);
    ds.addToTupleAt(0, 0, 0);
    ds.addEmptyTupleAt(1);

    ds.refreshTuplesAfterGroupAdd(2);
    expect(ds.getTuple(0)).toEqual([0, null, null, null]);
    expect(ds.getTuple(1)).toEqual([null, null, null, null]);
  });

  it('removes a slot from every tuple, keeping the others aligned', () => {
    // The mirror of the above — the spider losing an axis. The surviving readings
    // must shift together, or every tuple after the removed slot reads one column
    // across from where it belongs.
    const ds = withPixels(6);
    ds.setSlotNames(['A', 'B', 'C']);
    ds.addEmptyTupleAt(0);
    ds.addToTupleAt(0, 0, 0);
    ds.addToTupleAt(0, 1, 1);
    ds.addToTupleAt(0, 2, 2);
    ds.addEmptyTupleAt(1);
    ds.addToTupleAt(1, 0, 3);
    ds.addToTupleAt(1, 2, 5);

    ds.removeSlotFromTuples(1); // drop the middle slot
    expect(ds.getTuple(0)).toEqual([0, 2]);
    expect(ds.getTuple(1)).toEqual([3, 5]);
  });

  it('ignores a request to remove a slot that does not exist', () => {
    const ds = withPixels(2);
    ds.setSlotNames(['A']);
    ds.addEmptyTupleAt(0);
    ds.addToTupleAt(0, 0, 0);
    ds.removeSlotFromTuples(7);
    expect(ds.getTuple(0)).toEqual([0]);
  });
});
