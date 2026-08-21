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
function docWith(points: Array<{ x: unknown; y: unknown; tuple?: unknown; group?: unknown }>) {
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

/**
 * ⚑⚑ A HOLE IS NOT A TUPLE, AND IT USED TO THROW (v2.3 audit fleet, A4).
 *
 * F35 caps the tuple array's SIZE, and that is not the same as making it dense:
 * a renumbered position whose only point is DROPPED - a non-finite coordinate,
 * or a group index outside the declared slots - is never created, leaving a
 * literal hole in the middle of `_tuples`.
 *
 * `getAllTuples()` hands that array to everything, and `.entries()` yields the
 * hole as `undefined`. `tupleIndexOfPixel` walks it on EVERY RENDER for every
 * graph type (it feeds `activeTupleIndex`), so one damaged file turned the whole
 * Workspace render into a TypeError.
 *
 * ⚠️ The existing group-bound test above could not catch this: its dataset has a
 * SINGLE point, so `_tuples` stays `[]` and the `for...of` body never runs. A
 * fixture blind to what it lacks.
 */
describe('a dropped point leaves no hole behind', () => {
  it('⚑ a point whose GROUP is out of range does not leave an undefined tuple', () => {
    const ds = load([
      { x: 10, y: 20, tuple: 0, group: 50 }, // dropped: no such slot
      { x: 30, y: 20, tuple: 1, group: 0 },
    ]);
    const tuples = ds.getAllTuples();
    for (const [i, tuple] of tuples.entries()) {
      expect(tuple, `tuple ${i} is a hole`).toBeDefined();
      expect(Array.isArray(tuple)).toBe(true);
    }
  });

  it('⚑ nor does a point with no position', () => {
    const ds = load([
      { x: null, y: null, tuple: 0, group: 0 },
      { x: 30, y: 20, tuple: 1, group: 0 },
    ]);
    for (const [i, tuple] of ds.getAllTuples().entries()) {
      expect(tuple, `tuple ${i} is a hole`).toBeDefined();
    }
  });
});
