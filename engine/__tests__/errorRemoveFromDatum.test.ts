/**
 * Removing an error bar, and the cascade that takes it with its point.
 *
 * ⚑⚑ DAVID'S RULES, 2026-08-17: *"we want to remove error bars with its point
 * when it goes"*, and *"we need to add a functionality to add and REMOVE a error
 * bar to a point or line."*
 *
 * ⚑ The removal is not a MODE being switched off. In the tuple record a point
 * whose extent slots are all null IS a plain point — identical in the record to
 * one that never had error. So "remove the error bars from this point" is
 * "clear its extents", and there is no error-ness left over to turn off.
 *
 * ⚑ The CASCADE needs no code at all: a datum and its caps are one tuple, and
 * `removeTuple` already removes a tuple's pixels. It is asserted here because
 * "works by construction" is a claim, and the orphaned-caps defect that started
 * this whole rework was exactly a cascade everyone assumed was happening.
 */
import { describe, expect, it } from 'vitest';
import { CalibrationSession, XY_AXES_CONFIG } from '../calibrationSession.js';
import { errorSlotNames, slotForRole } from '../../algorithms/errorExtent.js';

/** x 0..10 over px 100..300; y 0..10 over py 300..100. */
function session() {
  const s = new CalibrationSession(XY_AXES_CONFIG);
  for (const [px, py, v] of [
    [100, 300, '0'],
    [300, 300, '10'],
    [100, 300, '0'],
    [100, 100, '10'],
  ] as Array<[number, number, string]>) {
    expect(s.handleCalibrationClick(px, py)).toBe('awaiting-value');
    expect(s.confirmCalibrationValues([v])).toBe(true);
  }
  expect(s.runCalibration()).toBe(true);
  s.renameDataset(0, 'Sample');
  return s;
}

/** Two datums, each with an upper and a lower cap, in the B4 tuple shape. */
function twoCappedPoints() {
  const s = session();
  const ds = s.getDatasets()[0]!;
  ds.addPixel(180, 220); // datum A
  ds.addPixel(260, 160); // datum B
  const slots = errorSlotNames('SD');
  ds.adoptSlots(slots);
  const put = (tuple: number, role: 'upper' | 'lower', x: number, y: number) =>
    ds.addToTupleAt(tuple, slotForRole(role, slots.length), ds.addPixel(x, y));
  put(0, 'upper', 180, 190);
  put(0, 'lower', 180, 250);
  put(1, 'upper', 260, 130);
  put(1, 'lower', 260, 190);
  return { s, ds };
}

describe('removing the error from a point leaves the point', () => {
  it('the datum survives and its extents are gone', () => {
    const { s } = twoCappedPoints();
    expect(s.removeErrorFromDatum(0, 0)).toBe(true);
    const bars = s.getResolvedErrorBars(0);
    expect(bars, 'both points are still there').toHaveLength(2);
    expect(bars[0]!.yUpper, 'A has no upper any more').toBeUndefined();
    expect(bars[0]!.yLower, 'A has no lower any more').toBeUndefined();
    expect(bars[0]!.x, "A's own reading is untouched").toBeCloseTo(4, 6);
  });

  it("the other point's error is untouched", () => {
    const { s } = twoCappedPoints();
    s.removeErrorFromDatum(0, 0);
    const bars = s.getResolvedErrorBars(0);
    expect(bars[1]!.yUpper, 'B keeps its error').toBeDefined();
    expect(bars[1]!.yLower).toBeDefined();
  });

  it('the cap pixels really go — no stray points left behind', () => {
    // ⚑ The defect that started this rework was orphaned caps floating on the
    // canvas with no datum under them. Nulling the slot without removing the
    // pixel would recreate it in a new place.
    const { s, ds } = twoCappedPoints();
    const before = ds.getCount();
    s.removeErrorFromDatum(0, 0);
    expect(ds.getCount(), 'two cap pixels removed').toBe(before - 2);
    expect(s.getErrorWhiskers(), "only B's two whiskers remain").toHaveLength(2);
  });

  it('a point with its error removed is indistinguishable from one that never had any', () => {
    // The model has no error-ness to switch off, which is why "remove" needs no
    // mode and no flag.
    const { s, ds } = twoCappedPoints();
    s.removeErrorFromDatum(0, 0);
    const tuple = ds.getAllTuples()[0]!;
    expect(tuple.slice(1), 'every extent slot is empty').toEqual([null, null, null, null]);
  });

  it('is a no-op on a point that has no error, and says so', () => {
    const s = session();
    const ds = s.getDatasets()[0]!;
    ds.addPixel(200, 200);
    ds.adoptSlots(errorSlotNames('SD'));
    expect(s.removeErrorFromDatum(0, 0)).toBe(false);
    expect(s.getResolvedErrorBars(0)).toHaveLength(1);
  });

  it('is a no-op on a series that records no error at all', () => {
    const s = session();
    s.addDataPoint(200, 200);
    expect(s.removeErrorFromDatum(0, 0)).toBe(false);
    expect(s.getResolvedErrorBars(0)).toHaveLength(1);
  });

  it('is a no-op for an out-of-range point', () => {
    const { s } = twoCappedPoints();
    expect(s.removeErrorFromDatum(0, 99)).toBe(false);
    expect(s.getResolvedErrorBars(0)).toHaveLength(2);
  });
});

describe('deleting the POINT takes its error with it — the cascade', () => {
  it('the datum and both its caps go together', () => {
    // ⚑ The orphaned-cap defect, made inexpressible: they are one tuple, so
    // there is no second store that could survive the delete.
    const { s, ds } = twoCappedPoints();
    const before = ds.getCount(); // 2 datums + 4 caps
    s.setActiveDataset(0);
    s.removeTuple(0);
    expect(ds.getCount(), 'datum + 2 caps removed').toBe(before - 3);
    const bars = s.getResolvedErrorBars(0);
    expect(bars, 'only B remains').toHaveLength(1);
    expect(bars[0]!.yUpper, 'and B is whole').toBeDefined();
  });

  it('no whisker is left hanging where the point used to be', () => {
    const { s } = twoCappedPoints();
    s.setActiveDataset(0);
    s.removeTuple(0);
    expect(s.getErrorWhiskers(), "only B's two").toHaveLength(2);
  });
});
