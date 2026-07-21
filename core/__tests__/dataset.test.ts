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
    // editable-cell fix relied on — verify the count actually decrements.
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

  it('supports point-group tuples (box plot / error bar mechanics)', () => {
    const ds = new Dataset();
    ds.setPointGroups(['Value', 'Upper', 'Lower']);
    const idxVal = ds.addPixel(0, 0);
    const idxUp = ds.addPixel(0, -10);
    const idxLo = ds.addPixel(0, 10);

    const tupleIdx = ds.addTuple(idxVal)!;
    ds.addToTupleAt(tupleIdx, 1, idxUp);
    ds.addToTupleAt(tupleIdx, 2, idxLo);

    expect(ds.getPointGroupIndexInTuple(tupleIdx, idxVal)).toBe(0);
    expect(ds.getPointGroupIndexInTuple(tupleIdx, idxUp)).toBe(1);
    expect(ds.getTuple(tupleIdx)).toEqual([idxVal, idxUp, idxLo]);
  });

  it('refreshTuplesAfterPixelRemoval decrements/nulls indexes correctly', () => {
    const ds = new Dataset();
    ds.setPointGroups(['A', 'B']);
    ds.addTuple(0);
    ds.addToTupleAt(0, 1, 2);
    ds.refreshTuplesAfterPixelRemoval(1); // removes index 1 -> index 2 becomes 1, index 0 unaffected
    expect(ds.getTuple(0)).toEqual([0, 1]);
  });

  it('selectPixelsInRectangle selects points inside an inverted (SW) rectangle', () => {
    const ds = new Dataset();
    ds.addPixel(5, 5);
    ds.addPixel(50, 50);
    // p1 bottom-right-ish, p2 top-left-ish => "sw" direction per the original logic
    ds.selectPixelsInRectangle({ x: 10, y: 0 }, { x: 0, y: 10 });
    expect(ds.getSelectedPixels()).toEqual([0]);
  });
});
