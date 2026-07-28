import { describe, expect, it } from 'vitest';
import { Dataset } from '../dataset.js';

/**
 * Removing points from a dataset.
 *
 * ⚑ WHY THIS FILE EXISTS. `removeLastPixel` and `removeNearestPixel` were called
 * by NO test in the suite, and they are the two removals a user actually
 * triggers — Del on the last-placed point, and clicking near a point to take it
 * out. `removePixelAtIndex` (which both delegate to) was covered; the callers
 * were not.
 *
 * ⚑ ADAPTED IN IDEA ONLY from WebPlotDigitizer's `tests/data_set_tests.js`. Their
 * two removal cases test the right behaviour in a way not worth copying:
 *   - both assign `dataset._dataPoints = [a, b, c]` directly, reaching past the
 *     public API into a private field, so the tests would keep passing if
 *     addPixel broke entirely and would break if the internal shape changed;
 *   - `removeNearestPixel` is tested with a sinon stub on `findNearestPixel` —
 *     stubbing a method of the object under test, which verifies the delegation
 *     and nothing about whether the right point is chosen.
 * Written here through the public API instead, and with the search actually
 * doing its work. Their other five cases (initialization, add pixel, metadata,
 * point groups, tuples) are already covered by dataset.test.ts and are not
 * duplicated.
 */

/** A dataset with three points at known positions. */
function threePoints(): Dataset {
  const ds = new Dataset(2);
  ds.addPixel(0, 1);
  ds.addPixel(20, 30);
  ds.addPixel(30, 40);
  return ds;
}

const positions = (ds: Dataset): [number, number][] =>
  ds.getAllPixels().map((p) => [p.x, p.y]);

describe('Dataset.removeLastPixel', () => {
  it('removes from the END, repeatedly, and returns the index it removed', () => {
    const ds = threePoints();

    expect(ds.removeLastPixel()).toBe(2);
    expect(positions(ds)).toEqual([
      [0, 1],
      [20, 30],
    ]);

    expect(ds.removeLastPixel()).toBe(1);
    expect(positions(ds)).toEqual([[0, 1]]);
  });

  it('keeps the metadata count honest when the removed point carried some', () => {
    // removePixelAtIndex decrements a separate counter when the point had
    // metadata. Routing through removeLastPixel must not bypass that — a stale
    // count is how a dataset starts reporting overrides it no longer holds.
    const ds = new Dataset(2);
    ds.setMetadataKeys(['overrides']);
    ds.addPixel(0, 0);
    ds.addPixel(10, 10, { overrides: { y: 5 } });
    expect(ds.hasMetadata()).toBe(true);

    ds.removeLastPixel();

    // The count is private; hasMetadata() is how the rest of the app asks. A
    // stale counter here is how a dataset starts reporting overrides it no
    // longer holds.
    expect(ds.hasMetadata()).toBe(false);
    expect(ds.getCount()).toBe(1);
  });

  it('is safe on an empty dataset', () => {
    // ⚑ THIS TEST FOUND A REAL DEFECT. removeLastPixel computes length - 1 = -1
    // and hands it to removePixelAtIndex, whose guard was `index < length` only:
    // -1 < 0 is true, so it fell through and dereferenced _dataPoints[-1],
    // throwing `TypeError: Cannot read properties of undefined`. Not reachable
    // by a user — CalibrationSession.removeLastPoint checks the count first —
    // but that put the guard in the session rather than the model. Now guarded
    // at both ends in dataset.ts.
    const ds = new Dataset(2);
    expect(() => ds.removeLastPixel()).not.toThrow();
    expect(ds.getCount()).toBe(0);
  });
});

describe('Dataset.removeNearestPixel', () => {
  it('removes the point actually nearest the click, not merely the first in range', () => {
    // ⚑ The case upstream's stub cannot reach. Two points sit within the default
    // 50px threshold; the search must keep looking after the first candidate and
    // return the closer one. A mutant that returns on first match removes the
    // wrong point — and the user sees A point vanish, so nothing looks broken.
    const ds = threePoints();

    const removed = ds.removeNearestPixel(29, 39);

    expect(removed).toBe(2);
    expect(positions(ds)).toEqual([
      [0, 1],
      [20, 30],
    ]);
  });

  it('returns -1 and removes NOTHING when the click is out of range', () => {
    const ds = threePoints();

    expect(ds.removeNearestPixel(5000, 5000)).toBe(-1);
    expect(positions(ds)).toEqual([
      [0, 1],
      [20, 30],
      [30, 40],
    ]);
  });

  it('honours an explicit threshold, both sides of the boundary', () => {
    // The threshold is the difference between "nothing happened" and "a point
    // disappeared", so both sides of it are worth pinning.
    const near = threePoints();
    expect(near.removeNearestPixel(0, 1, 1)).toBe(0);
    expect(near.getCount()).toBe(2);

    const far = threePoints();
    expect(far.removeNearestPixel(10, 11, 1)).toBe(-1);
    expect(far.getCount()).toBe(3);
  });
});
