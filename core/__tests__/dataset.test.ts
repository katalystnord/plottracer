import { describe, it, expect } from 'vitest';
import { Dataset } from '../dataset.js';

describe('Dataset', () => {
  it('adds pixels in order and reports count', () => {
    const ds = new Dataset();
    ds.addPixel(10, 20);
    ds.addPixel(30, 40);
    expect(ds.getCount()).toBe(2);
    expect(ds.getPixel(0)).toEqual({ x: 10, y: 20, metadata: undefined });
    expect(ds.getPixel(1)).toEqual({ x: 30, y: 40, metadata: undefined });
  });

  it('tracks metadata count correctly across set/clear (the override mechanism this session built on)', () => {
    const ds = new Dataset();
    ds.addPixel(0, 0);
    expect(ds.hasMetadata()).toBe(false);

    ds.setMetadataAt(0, { overrides: { y: 99.5 } });
    expect(ds.hasMetadata()).toBe(true);
    expect(ds.getPixel(0).metadata).toEqual({ overrides: { y: 99.5 } });

    // Clearing back to null (not an empty {}) is what the live-data-table
    // editable-cell fix relied on - verify the count actually decrements.
    ds.setMetadataAt(0, null);
    expect(ds.hasMetadata()).toBe(false);
    expect(ds.getPixel(0).metadata).toBeNull();
  });

  it('findNearestPixel respects threshold', () => {
    const ds = new Dataset();
    ds.addPixel(0, 0);
    ds.addPixel(100, 100);
    expect(ds.findNearestPixel(5, 5, 50)).toBe(0);
    expect(ds.findNearestPixel(500, 500, 50)).toBe(-1);
  });

  it('removePixelAtIndex updates count and metadata bookkeeping', () => {
    const ds = new Dataset();
    ds.addPixel(0, 0, { label: 'a' });
    ds.addPixel(1, 1);
    expect(ds.getCount()).toBe(2);
    expect(ds.hasMetadata()).toBe(true);
    ds.removePixelAtIndex(0);
    expect(ds.getCount()).toBe(1);
    expect(ds.hasMetadata()).toBe(false);
  });

  it('supports slot tuples (box plot / error bar mechanics)', () => {
    const ds = new Dataset();
    ds.setSlotNames(['Value', 'Upper', 'Lower']);
    const idxVal = ds.addPixel(0, 0);
    const idxUp = ds.addPixel(0, -10);
    const idxLo = ds.addPixel(0, 10);

    const tupleIdx = ds.addTuple(idxVal)!;
    ds.addToTupleAt(tupleIdx, 1, idxUp);
    ds.addToTupleAt(tupleIdx, 2, idxLo);

    expect(ds.getSlotIndexInTuple(tupleIdx, idxVal)).toBe(0);
    expect(ds.getSlotIndexInTuple(tupleIdx, idxUp)).toBe(1);
    expect(ds.getTuple(tupleIdx)).toEqual([idxVal, idxUp, idxLo]);
  });

  it('refreshTuplesAfterPixelRemoval decrements/nulls indexes correctly', () => {
    const ds = new Dataset();
    ds.setSlotNames(['A', 'B']);
    ds.addTuple(0);
    ds.addToTupleAt(0, 1, 2);
    ds.refreshTuplesAfterPixelRemoval(1); // removes index 1 -> index 2 becomes 1, index 0 unaffected
    expect(ds.getTuple(0)).toEqual([0, 1]);
  });

  // reorderPixels - the model side of checkpoint 130's nearest-neighbour sort.
  // ⚑ It had NO unit test: the sort was exercised only through the e2e, on an
  // ungrouped series, which is why nothing noticed that the tuples did not move
  // with the pixels.

  it('reorderPixels moves each pixel whole, per-pixel metadata included', () => {
    // A Bar's category label and a manual value override ride on the PIXEL, and
    // both are read at export -- rebuilding bare coordinates loses them silently.
    const ds = new Dataset();
    ds.setMetadataKeys(['label']);
    ds.addPixel(10, 10, { label: 'first' });
    ds.addPixel(20, 20, { label: 'second' });
    ds.addPixel(30, 30, { label: 'third' });

    expect(ds.reorderPixels([2, 0, 1])).toBe(true);
    expect(ds.getAllPixels().map((p) => p.x)).toEqual([30, 10, 20]);
    expect(ds.getAllPixels().map((p) => (p.metadata as { label: string }).label)).toEqual([
      'third',
      'first',
      'second',
    ]);
    expect(ds.hasMetadata()).toBe(true);
  });

  it('reorderPixels remaps the tuples, so a pairing still means the same two points', () => {
    // ⚑ THE DEFECT THIS REPLACED. Tuples hold pixel INDEXES. Reversing the pixels
    // while leaving [[0,1],[2,3]] alone left tuple 0 -- which meant (10,20) --
    // meaning (40,30), with no error and nothing to see on screen. On a Box Plot,
    // an error bar or a spider the PAIR is the datum, so that is not a reorder,
    // it is a different record.
    const ds = new Dataset(2);
    ds.setSlotNames(['min', 'max']);
    for (const x of [10, 20, 30, 40]) ds.addPixel(x, x);
    ds.addEmptyTupleAt(0);
    ds.addToTupleAt(0, 0, 0);
    ds.addToTupleAt(0, 1, 1);
    ds.addEmptyTupleAt(1);
    ds.addToTupleAt(1, 0, 2);
    ds.addToTupleAt(1, 1, 3);

    expect(ds.reorderPixels([3, 2, 1, 0])).toBe(true);

    const coordsOf = (t: number) => ds.getTuple(t).map((i) => (i == null ? null : ds.getPixel(i).x));
    expect(coordsOf(0)).toEqual([10, 20]); // the pairing survived the move
    expect(coordsOf(1)).toEqual([30, 40]);
  });

  it('reorderPixels keeps an empty slot empty rather than filling it', () => {
    const ds = new Dataset(2);
    ds.setSlotNames(['min', 'max']);
    ds.addPixel(10, 10);
    ds.addPixel(20, 20);
    ds.addEmptyTupleAt(0);
    ds.addToTupleAt(0, 1, 1); // only the second slot is filled

    expect(ds.reorderPixels([1, 0])).toBe(true);
    expect(ds.getTuple(0)[0]).toBeNull();
    expect(ds.getPixel(ds.getTuple(0)[1]!).x).toBe(20);
  });

  it('insertPixel shifts the tuples along with the pixels', () => {
    // The mirror of refreshTuplesAfterPixelRemoval, which the model had while
    // insertion had nothing -- so a tuple holding index 1 would have gone on
    // meaning index 1, which is now the point that was just spliced in front of it.
    const ds = new Dataset(2);
    ds.setSlotNames(['min', 'max']);
    ds.addPixel(10, 10);
    ds.addPixel(20, 20);
    ds.addEmptyTupleAt(0);
    ds.addToTupleAt(0, 0, 0);
    ds.addToTupleAt(0, 1, 1);

    ds.insertPixel(1, 15, 15); // between them

    expect(ds.getAllPixels().map((p) => p.x)).toEqual([10, 15, 20]);
    // The pair still means (10,20) -- the spliced point belongs to no tuple.
    expect(ds.getTuple(0).map((i) => ds.getPixel(i!).x)).toEqual([10, 20]);
    expect(ds.getTupleIndex(1)).toBe(-1);
  });

  it('reorderPixels refuses anything that is not a permutation, changing nothing', () => {
    // Taking the ORDER rather than the reordered pixels is what makes this
    // checkable at all: the old signature could only trust the caller's comment.
    const fresh = () => {
      const ds = new Dataset();
      ds.addPixel(10, 10);
      ds.addPixel(20, 20);
      ds.addPixel(30, 30);
      return ds;
    };
    for (const bad of [[0, 1], [0, 1, 2, 0], [0, 0, 2], [0, 1, 3], [0, 1, -1], [0, 1, 1.5]]) {
      const ds = fresh();
      expect(ds.reorderPixels(bad), `order ${JSON.stringify(bad)} must be refused`).toBe(false);
      expect(ds.getAllPixels().map((p) => p.x)).toEqual([10, 20, 30]);
    }
  });
});
