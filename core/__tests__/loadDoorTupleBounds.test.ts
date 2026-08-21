import { describe, expect, it } from 'vitest';
import { PlotData } from '../plotData.js';

/**
 * ⚑⚑ A TUPLE INDEX IN A FILE IS AN ARRAY INDEX (v2.3 re-audit, F35).
 *
 * `addEmptyTupleAt` writes straight into `_tuples[tupleIndex]`, and this door
 * passed the file's number through untouched. So a 200-byte project claiming
 * `"tuple": 1000000` gave the dataset a million-entry array, which
 * `getAllTuples()` then hands to every table, every export and every render -
 * the app stops responding and nothing on screen says why. `"group": 50` on a
 * two-slot type is the same door from the other side: the tuple grows past its
 * own slot names, so every consumer that walks the members against the header
 * reads slots no column exists for.
 *
 * ⚑ Guards belong in the model, and the model has more than one entrance
 * (CLAUDE.md, Key constraints). The interactive path cannot produce either of
 * these; the load path could, and a project file is not a trusted input just
 * because we usually wrote it.
 *
 * ⚑ The bounds are the FILE'S OWN: there cannot be more tuples than pixels, and
 * there cannot be more slots than the dataset declared names for. Neither is a
 * policy about how large a real figure may be.
 */

/** A minimal v4 document with one two-slot dataset and `points` pixels. */
function docWith(points: Array<{ x: number; y: number; tuple?: unknown; group?: unknown }>) {
  return {
    version: [4, 2],
    axesColl: [],
    datasetColl: [
      {
        name: 'S',
        axesName: '',
        metadataKeys: [],
        groupNames: ['Bar start', 'Bar end'],
        data: points,
      },
    ],
    measurementColl: [],
  } as unknown as Parameters<PlotData['deserialize']>[0];
}

function load(points: Parameters<typeof docWith>[0]) {
  const pd = new PlotData();
  expect(pd.deserialize(docWith(points))).not.toBe(false);
  return pd.getDatasets()[0]!;
}

describe('the load door will not let a file choose an array size', () => {
  it('an ordinary two-member tuple still loads exactly as it did', () => {
    const ds = load([
      { x: 10, y: 20, tuple: 0, group: 0 },
      { x: 30, y: 20, tuple: 0, group: 1 },
    ]);
    expect(ds.getCount()).toBe(2);
    expect(ds.getAllTuples()).toEqual([[0, 1]]);
  });

  it('⚑ a huge tuple index allocates a tuple, not a million of them', () => {
    const ds = load([
      { x: 10, y: 20, tuple: 0, group: 0 },
      { x: 30, y: 20, tuple: 1_000_000, group: 1 },
    ]);
    expect(ds.getCount()).toBe(2);
    // Two positions were named, so there are two tuples - not 1,000,001.
    expect(ds.getAllTuples()).toEqual([[0, null], [null, 1]]);
  });

  /**
   * ⚠️⚑⚑ THE FIRST ATTEMPT AT THIS GUARD WAS A RANGE CHECK - "there cannot be
   * more tuples than points" - and it was WRONG in the one direction that
   * matters: it holds for every file we write, so nothing would have caught it,
   * while a file with an unfilled tuple in the middle would have had a real
   * bar's membership silently dropped on load. A position cannot be
   * range-checked against a count the file never states. It can be renumbered.
   */
  it('⚑⚑ a GAP in the tuple positions keeps every membership, in order', () => {
    const ds = load([
      { x: 10, y: 20, tuple: 3, group: 0 },
      { x: 30, y: 20, tuple: 3, group: 1 },
      { x: 50, y: 20, tuple: 9, group: 0 },
      { x: 70, y: 20, tuple: 9, group: 1 },
    ]);
    expect(ds.getCount()).toBe(4);
    // Both bars survive, in the file's own order, renumbered to 0 and 1.
    expect(ds.getAllTuples()).toEqual([[0, 1], [2, 3]]);
  });

  it('⚑ a DENSE file is renumbered to itself - identity, so nothing we write moves', () => {
    const ds = load([
      { x: 10, y: 20, tuple: 0, group: 0 },
      { x: 30, y: 20, tuple: 0, group: 1 },
      { x: 50, y: 20, tuple: 1, group: 0 },
      { x: 70, y: 20, tuple: 1, group: 1 },
    ]);
    expect(ds.getAllTuples()).toEqual([[0, 1], [2, 3]]);
  });

  it('⚑ a group index past the declared slot names does not lengthen the tuple', () => {
    const ds = load([{ x: 10, y: 20, tuple: 0, group: 50 }]);
    // Either the tuple was never created, or it has exactly its declared width.
    for (const tuple of ds.getAllTuples()) expect(tuple.length).toBe(2);
    expect(ds.getCount()).toBe(1);
  });

  it('⚑ a negative or fractional index is not an index', () => {
    const ds = load([
      { x: 10, y: 20, tuple: -1, group: 0 },
      { x: 30, y: 20, tuple: 0.5, group: 0 },
      { x: 50, y: 20, tuple: 0, group: -1 },
    ]);
    expect(ds.getCount()).toBe(3);
    expect(ds.getAllTuples()).toEqual([]);
  });

  it('⚑ a non-numeric index is not an index either', () => {
    const ds = load([{ x: 10, y: 20, tuple: 'abc', group: null }]);
    expect(ds.getCount()).toBe(1);
    expect(ds.getAllTuples()).toEqual([]);
  });
});
