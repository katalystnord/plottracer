import { describe, expect, it } from 'vitest';
import { Dataset } from '../dataset.js';
import { Color } from '../color.js';

/**
 * `Dataset` — the model every captured point lives in.
 *
 * ⚑ WHY THIS FILE EXISTS. The 2026-07-31 mutation run scored
 * `core/dataset.ts` at **66.59%** with 153 mutants unnoticed. Its siblings
 * (`datasetSelectionAndGroups.test.ts` and the plotData round-trips) cover
 * the tuple/slot machinery and the selection set; what nothing pinned is the
 * quieter half — the DEFAULTS a fresh dataset reports, the index bounds on
 * every mutator, the metadata COUNT that `hasMetadata()` answers from, and
 * the permutation check in `reorderPixels`.
 *
 * ⚑ Two of these have bitten this project before, which is why they are worth
 * the ceremony: `removePixelAtIndex` once guarded only the upper bound, so a
 * negative index dereferenced `_dataPoints[-1]` and threw (fixed, and its
 * comment records the lesson — "the guard was in the session and the model has
 * more than one entrance"); and a reorder that silently re-pointed tuples at
 * whatever landed at their index was a real defect found by the pre-v2.0
 * audit. Both are pinned below.
 */

/** A dataset with `n` points at (10i, 20i), so index and position are linked. */
function datasetOf(n: number): Dataset {
  const ds = new Dataset(2);
  for (let i = 0; i < n; i++) ds.addPixel(i * 10, i * 20);
  return ds;
}

describe('Dataset — what a fresh one reports about itself', () => {
  it('starts empty, unnamed-by-default, with no metadata and no groups', () => {
    // Every one of these defaults mutated to a different literal and survived,
    // because nothing asserted the STARTING state -- only states reached after
    // some mutation.
    const ds = new Dataset(2);
    expect(ds.getCount()).toBe(0);
    expect(ds.name).toBe('Default Dataset');
    expect(ds.variableNames).toEqual(['x', 'y']);
    expect(ds.hasMetadata()).toBe(false);
    expect(ds.getMetadataKeys()).toEqual([]);
    expect(ds.getMetadata()).toEqual({});
    expect(ds.hasSlots()).toBe(false);
    expect(ds.getAllTuples()).toEqual([]);
    expect(ds.getSelectedPixels()).toEqual([]);
  });

  it('starts with the default series colour, which the UI and every export read', () => {
    const ds = new Dataset(2);
    expect(ds.colorRGB.serialize()).toEqual(new Color(200, 0, 0).serialize());
  });
});

describe('Dataset — index bounds on every mutator', () => {
  it('setPixelAt moves the named point and ignores an out-of-range index', () => {
    const ds = datasetOf(3);
    ds.setPixelAt(1, 111, 222);
    expect(ds.getPixel(1)).toMatchObject({ x: 111, y: 222 });
    // Untouched neighbours -- a bound that is off by one corrupts these.
    expect(ds.getPixel(0)).toMatchObject({ x: 0, y: 0 });
    expect(ds.getPixel(2)).toMatchObject({ x: 20, y: 40 });

    // ⚑ A NEGATIVE index used to THROW here, not no-op: the guard was
    // `index < length` only, so `-1 < 3` passed and `_dataPoints[-1].x = ...`
    // died. Exactly the defect removePixelAtIndex's own comment describes
    // being fixed — in that one method, while its two siblings kept it.
    expect(() => ds.setPixelAt(3, 999, 999)).not.toThrow(); // one past the end
    expect(() => ds.setPixelAt(-1, 999, 999)).not.toThrow();
    expect(ds.getCount()).toBe(3);
    expect(ds.getPixel(2)).toMatchObject({ x: 20, y: 40 });
  });

  it('⚑ setMetadataAt refuses a negative index too — the third of the same guard', () => {
    const ds = datasetOf(2);
    expect(() => ds.setMetadataAt(-1, { categoryIndex: 0 })).not.toThrow();
    expect(() => ds.setMetadataAt(9, { categoryIndex: 0 })).not.toThrow();
    // ...and no phantom metadata was counted for a point that does not exist.
    expect(ds.hasMetadata()).toBe(false);
  });

  it('setPixelAt writes the LAST point — the boundary the bound must still admit', () => {
    const ds = datasetOf(3);
    ds.setPixelAt(2, 7, 8);
    expect(ds.getPixel(2)).toMatchObject({ x: 7, y: 8 });
  });

  it('⚑ removePixelAtIndex refuses a NEGATIVE index instead of throwing', () => {
    // The regression its own comment names: the upper test alone let -1
    // through (`-1 < length` is true) and the next line dereferenced
    // `_dataPoints[-1]`, so removeLastPixel() on an EMPTY dataset threw.
    const empty = new Dataset(2);
    expect(() => empty.removePixelAtIndex(-1)).not.toThrow();
    expect(() => empty.removeLastPixel()).not.toThrow();
    expect(empty.getCount()).toBe(0);

    const ds = datasetOf(2);
    ds.removePixelAtIndex(-1);
    ds.removePixelAtIndex(5);
    expect(ds.getCount()).toBe(2);
  });

  it('removePixelAtIndex removes exactly the named point and closes the gap', () => {
    const ds = datasetOf(4);
    ds.removePixelAtIndex(1);
    expect(ds.getCount()).toBe(3);
    expect(ds.getAllPixels().map((p) => p.x)).toEqual([0, 20, 30]);
  });
});

describe('Dataset — the metadata COUNT behind hasMetadata()', () => {
  /**
   * ⚑ `_pixelMetadataCount` is incremented and decremented by hand across
   * three methods, and `hasMetadata()` is the single question every export
   * asks to decide whether to emit a metadata column at all. Both the
   * decrement and its guard survived mutation, so a count that drifts would
   * either hide real metadata from the file or emit an empty column.
   */
  it('goes true when a point gains metadata and false again when it loses it', () => {
    const ds = datasetOf(2);
    expect(ds.hasMetadata()).toBe(false);

    ds.setMetadataAt(0, { categoryIndex: 1 });
    expect(ds.hasMetadata()).toBe(true);

    ds.setMetadataAt(0, null as never);
    expect(ds.hasMetadata()).toBe(false);
  });

  it('does not double-count re-setting metadata on the SAME point', () => {
    // The `metadata == null` guard around the increment: without it, two
    // writes to one point count as two points, and hasMetadata() stays true
    // after the single real one is cleared.
    const ds = datasetOf(2);
    ds.setMetadataAt(0, { categoryIndex: 1 });
    ds.setMetadataAt(0, { categoryIndex: 2 });
    ds.setMetadataAt(0, null as never);
    expect(ds.hasMetadata()).toBe(false);
  });

  it('does not under-count clearing metadata that was never there', () => {
    const ds = datasetOf(2);
    ds.setMetadataAt(0, null as never);
    ds.setMetadataAt(1, null as never);
    ds.setMetadataAt(0, { categoryIndex: 1 });
    expect(ds.hasMetadata()).toBe(true);
    ds.setMetadataAt(0, null as never);
    expect(ds.hasMetadata()).toBe(false);
  });

  it('keeps the count right when a point WITH metadata is removed', () => {
    const ds = datasetOf(2);
    ds.setMetadataAt(1, { categoryIndex: 3 });
    expect(ds.hasMetadata()).toBe(true);
    ds.removePixelAtIndex(1);
    expect(ds.hasMetadata()).toBe(false);
  });

  it('counts metadata added by insertPixel, and by addPixel', () => {
    const ds = datasetOf(1);
    ds.insertPixel(0, 5, 5, { categoryIndex: 0 });
    expect(ds.hasMetadata()).toBe(true);
    ds.removePixelAtIndex(0);
    expect(ds.hasMetadata()).toBe(false);
  });
});

describe('Dataset — insertPixel shifts the tuples that point past it', () => {
  it('⚑ re-points every tuple slot at or after the insertion, so a bar keeps its own corners', () => {
    // Tuples hold pixel INDEXES. Inserting shifts everything after the
    // insertion point by one, so any slot pointing there must move with it --
    // otherwise a bar's second corner silently becomes its neighbour's.
    const ds = new Dataset(2);
    ds.setSlotNames(['start', 'end']);
    const a = ds.addPixel(0, 0);
    const b = ds.addPixel(10, 10);
    const t = ds.addTuple(a);
    expect(t).not.toBeNull();
    ds.addToTupleAt(t!, 1, b);
    expect(ds.getTuple(t!)).toEqual([0, 1]);

    ds.insertPixel(0, -5, -5); // everything shifts up by one
    expect(ds.getTuple(t!)).toEqual([1, 2]);
    // ...and the tuple still names the same two POINTS it did before.
    expect(ds.getPixel(ds.getTuple(t!)[0]!)).toMatchObject({ x: 0, y: 0 });
    expect(ds.getPixel(ds.getTuple(t!)[1]!)).toMatchObject({ x: 10, y: 10 });
  });

  it('leaves slots BEFORE the insertion point alone', () => {
    const ds = new Dataset(2);
    ds.setSlotNames(['start', 'end']);
    const a = ds.addPixel(0, 0);
    const b = ds.addPixel(10, 10);
    const t = ds.addTuple(a)!;
    ds.addToTupleAt(t, 1, b);

    ds.insertPixel(2, 99, 99); // after both
    expect(ds.getTuple(t)).toEqual([0, 1]);
  });
});

describe('Dataset.findNearestPixel', () => {
  it('returns the nearest point by real 2-D distance', () => {
    // The squared-difference product and both comparisons survived; a wrong
    // metric picks the wrong point, which the Eraser then deletes.
    const ds = new Dataset(2);
    ds.addPixel(0, 0);
    ds.addPixel(40, 30); // exactly 50 from the origin
    expect(ds.findNearestPixel(3, 4)).toBe(0);
    expect(ds.findNearestPixel(38, 28)).toBe(1);
  });

  it('applies a default threshold of 50 when none is given', () => {
    const ds = new Dataset(2);
    ds.addPixel(0, 0);
    expect(ds.findNearestPixel(30, 40)).toBe(0); // exactly 50 -- inside
    expect(ds.findNearestPixel(0, 51)).toBe(-1); // just outside
  });

  it('accepts a threshold given as a STRING, as the signature allows', () => {
    // `parseFloat(String(threshold))` -- callers hand this in from a field.
    const ds = new Dataset(2);
    ds.addPixel(0, 0);
    expect(ds.findNearestPixel(0, 10, '5')).toBe(-1);
    expect(ds.findNearestPixel(0, 10, '20')).toBe(0);
  });

  it('returns -1 on an empty dataset rather than a bogus index 0', () => {
    expect(new Dataset(2).findNearestPixel(0, 0)).toBe(-1);
  });

  it('removeNearestPixel removes it and reports which, or -1 for a miss', () => {
    const ds = datasetOf(3);
    expect(ds.removeNearestPixel(11, 21)).toBe(1);
    expect(ds.getCount()).toBe(2);
    expect(ds.removeNearestPixel(9999, 9999)).toBe(-1);
    expect(ds.getCount()).toBe(2);
  });
});

describe('Dataset.reorderPixels — a permutation, checked rather than promised', () => {
  /**
   * ⚑ THE DEFECT THIS DESCENDS FROM: reordering a series moved the pixels and
   * left `_tuples` — which hold pixel INDEXES — pointing at whatever landed
   * there. Found by the pre-v2.0 audit. The method now takes the ORDER so the
   * permutation is a fact it can verify, and six of its validation mutants
   * survived the last run.
   */
  it('reorders the points and carries every tuple slot with them', () => {
    const ds = new Dataset(2);
    ds.setSlotNames(['start', 'end']);
    ds.addPixel(0, 0); // 0
    ds.addPixel(10, 10); // 1
    ds.addPixel(20, 20); // 2
    const t = ds.addTuple(0)!;
    ds.addToTupleAt(t, 1, 2);

    expect(ds.reorderPixels([2, 0, 1])).toBe(true);
    expect(ds.getAllPixels().map((p) => p.x)).toEqual([20, 0, 10]);
    // The tuple named pixels 0 and 2; those are now at 1 and 0.
    expect(ds.getTuple(t)).toEqual([1, 0]);
    expect(ds.getPixel(ds.getTuple(t)[0]!)).toMatchObject({ x: 0 });
    expect(ds.getPixel(ds.getTuple(t)[1]!)).toMatchObject({ x: 20 });
  });

  it('refuses anything that is not a permutation, changing NOTHING', () => {
    // Each refusal is a separate clause that mutated and survived. The
    // "changing nothing" half matters as much as the false: a half-applied
    // reorder would be worse than a refused one.
    const ds = datasetOf(3);
    const before = ds.getAllPixels().map((p) => p.x);

    expect(ds.reorderPixels([0, 1])).toBe(false); // too short
    expect(ds.reorderPixels([0, 1, 2, 3])).toBe(false); // too long
    expect(ds.reorderPixels([0, 1, 1])).toBe(false); // a repeat
    expect(ds.reorderPixels([0, 1, 3])).toBe(false); // out of range high
    expect(ds.reorderPixels([0, 1, -1])).toBe(false); // out of range low
    expect(ds.reorderPixels([0, 1, 1.5])).toBe(false); // not an integer

    expect(ds.getAllPixels().map((p) => p.x)).toEqual(before);
  });

  it('accepts the identity order, and an empty dataset', () => {
    const ds = datasetOf(3);
    expect(ds.reorderPixels([0, 1, 2])).toBe(true);
    expect(ds.getAllPixels().map((p) => p.x)).toEqual([0, 10, 20]);
    expect(new Dataset(2).reorderPixels([])).toBe(true);
  });

  it('nulls a tuple slot that was already dangling rather than re-pointing it', () => {
    // Its own comment: a slot pointing outside the pixel list "does not
    // survive the move as a number that now means something else" -- the
    // silent-wrong-pairing class again.
    const ds = new Dataset(2);
    ds.setSlotNames(['start', 'end']);
    ds.addPixel(0, 0);
    ds.addPixel(10, 10);
    const t = ds.addTuple(0)!;
    ds.addToTupleAt(t, 1, 1);
    ds.removePixelAtIndex(1); // leaves the slot pointing at a gone pixel

    expect(ds.reorderPixels([0])).toBe(true);
    expect(ds.getTuple(t)[1]).toBeNull();
  });
});
