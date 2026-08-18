/**
 * `getResolvedErrorBars` is THE primitive every error kind resolves to.
 *
 * ⚑⚑ DAVID ASKED FOR THIS EXPLICITLY, 2026-08-17: *"Is there still an underlying
 * primitive that can be referred to from all error types, so that when it is
 * time to write mechanisms around them once they have been recorded, the
 * machinery can coalesce around the data again?"*
 *
 * The answer was yes-in-name-only. `ErrorBarPoint` is documented as *"the
 * model's one derived quantity"* and `getResolvedErrorBars` returns it - with
 * ZERO non-test callers. Meanwhile the drawing reached into
 * `dataset.getAllPixels()` and matched caps itself, and the CSV export worked off
 * series + `ErrorRelation` + deltas. Three consumers, three derivations, none of
 * them the primitive.
 *
 * ⚠️ That is not hypothetical damage: checkpoint 85 exists because the drawing
 * and the record had already DIVERGED on a rotated calibration, pairing caps
 * differently, and had to be forced back onto one matching function. A check
 * computed differently from the thing it checks is not a check.
 *
 * ⇒ B4 adds a SECOND storage form, so without a convergence point the paths
 * multiply - 2 storage × 3 consumers = 6 that must agree. Through the primitive
 * it is 2 producers + 3 consumers, and a continuous BAND later becomes a third
 * PRODUCER rather than a third thing every consumer has to learn.
 */
import { describe, expect, it } from 'vitest';
import { CalibrationSession, XY_AXES_CONFIG } from '../calibrationSession.js';
import { setErrorRelation } from '../errorRelation.js';
import { errorSlotNames, slotForRole } from '../../algorithms/errorExtent.js';

/** A plain screen-aligned calibration: x 0..10 over px 100..300, y 0..10 over py 300..100. */
function session() {
  const s = new CalibrationSession(XY_AXES_CONFIG);
  const steps: Array<[number, number, string]> = [
    [100, 300, '0'],
    [300, 300, '10'],
    [100, 300, '0'],
    [100, 100, '10'],
  ];
  for (const [px, py, v] of steps) {
    expect(s.handleCalibrationClick(px, py)).toBe('awaiting-value');
    expect(s.confirmCalibrationValues([v])).toBe(true);
  }
  expect(s.runCalibration()).toBe(true);
  s.renameDataset(0, 'Sample');
  return s;
}

describe('one accessor answers for every way an error is stored', () => {
  it('reads the OLD shape - caps in their own related series', () => {
    const s = session();
    s.addDataPoint(200, 200); // (5, 5)
    const capIndex = s.addDataset('SD upper');
    setErrorRelation(s.getDatasets()[capIndex]!, { role: 'upper', of: 'Sample' });
    s.setActiveDataset(capIndex);
    s.addDataPoint(200, 160); // (5, 7)
    s.setActiveDataset(0);

    const bars = s.getResolvedErrorBars(0);
    expect(bars).toHaveLength(1);
    expect(bars[0]!.x).toBeCloseTo(5, 6);
    expect(bars[0]!.y).toBeCloseTo(5, 6);
    expect(bars[0]!.yUpper, 'the related series must still resolve').toBeCloseTo(7, 6);
  });

  it('reads the NEW shape - caps as extents in the datum\'s own tuple', () => {
    // ⚑ The same call, the same return type, a different storage form. That is
    // the whole point: a consumer written against this cannot tell which shape
    // the figure was captured in, so it needs no branch and gains no bug when a
    // third shape (a band) arrives.
    const s = session();
    const ds = s.getDatasets()[0]!;
    const slots = errorSlotNames('SD');
    ds.addPixel(200, 200); // (5, 5) -- the datum, placed BEFORE error was thought of
    ds.adoptSlots(slots); // ...which is the point: error is added afterwards
    const cap = ds.addPixel(200, 160); // (5, 7)
    ds.addToTupleAt(0, slotForRole('upper', slots.length), cap);

    const bars = s.getResolvedErrorBars(0);
    expect(bars).toHaveLength(1);
    expect(bars[0]!.x).toBeCloseTo(5, 6);
    expect(bars[0]!.y).toBeCloseTo(5, 6);
    expect(bars[0]!.yUpper, 'the tuple extent must resolve through the same call').toBeCloseTo(7, 6);
  });

  it('gives the SAME answer for the same figure captured either way', () => {
    // The two storage forms are not merely both readable - they must agree, or
    // the migration silently changes recorded numbers.
    const oldWay = session();
    oldWay.addDataPoint(200, 200);
    const capIndex = oldWay.addDataset('SD upper');
    setErrorRelation(oldWay.getDatasets()[capIndex]!, { role: 'upper', of: 'Sample' });
    oldWay.setActiveDataset(capIndex);
    oldWay.addDataPoint(200, 160);

    const newWay = session();
    const ds = newWay.getDatasets()[0]!;
    const slots = errorSlotNames('SD');
    ds.addPixel(200, 200);
    ds.adoptSlots(slots);
    const cap = ds.addPixel(200, 160);
    ds.addToTupleAt(0, slotForRole('upper', slots.length), cap);

    expect(newWay.getResolvedErrorBars(0)).toEqual(oldWay.getResolvedErrorBars(0));
  });

  it('⚑ ORDER MATTERS: a cap pixel added BEFORE slots are adopted becomes a phantom datum', () => {
    // ⚠️ Found by writing this suite's setup the wrong way round, and worth
    // pinning because the capture path must not repeat it. `adoptSlots` wraps
    // EVERY existing pixel into a tuple of its own -- that is exactly what makes
    // "add error to points you already placed" safe. But a cap pixel added
    // BEFORE that call is just a pixel, so it gets wrapped too and shows up as a
    // second data point with an error bar of its own.
    //
    // ⇒ `captureErrorCap` must adopt slots FIRST (wrapping the real data
    // points), THEN add the cap pixel and file it into its datum's tuple.
    const wrong = session();
    const dsW = wrong.getDatasets()[0]!;
    const slots = errorSlotNames('SD');
    dsW.addPixel(200, 200);
    const capW = dsW.addPixel(200, 160); // cap added too early
    dsW.adoptSlots(slots);
    dsW.addToTupleAt(0, slotForRole('upper', slots.length), capW);
    expect(wrong.getResolvedErrorBars(0), 'the cap became its own datum').toHaveLength(2);

    const right = session();
    const dsR = right.getDatasets()[0]!;
    dsR.addPixel(200, 200);
    dsR.adoptSlots(slots); // adopt FIRST
    const capR = dsR.addPixel(200, 160);
    dsR.addToTupleAt(0, slotForRole('upper', slots.length), capR);
    expect(right.getResolvedErrorBars(0)).toHaveLength(1);
  });

  it('a series with no error at all still answers, with its points and no fields', () => {
    // Documented behaviour worth pinning: callers render this unconditionally
    // rather than branching on whether error exists.
    const s = session();
    s.addDataPoint(200, 200);
    const bars = s.getResolvedErrorBars(0);
    expect(bars).toHaveLength(1);
    expect(bars[0]!.yUpper).toBeUndefined();
    expect(bars[0]!.yLower).toBeUndefined();
  });

  it('the tuple shape wins when a series somehow has both', () => {
    // A file could arrive with a related cap series AND tuple extents (an import
    // that was half-converted). The datum's OWN record is the more specific
    // claim -- it says which cap belongs to it, where the related series only
    // says one exists somewhere nearby -- so it must not be overridden by a
    // geometric guess.
    const s = session();
    const ds = s.getDatasets()[0]!;
    const slots = errorSlotNames('SD');
    ds.addPixel(200, 200); // (5, 5)
    ds.adoptSlots(slots);
    const cap = ds.addPixel(200, 160); // (5, 7) -- the recorded one
    ds.addToTupleAt(0, slotForRole('upper', slots.length), cap);

    const strayIndex = s.addDataset('SD upper');
    setErrorRelation(s.getDatasets()[strayIndex]!, { role: 'upper', of: 'Sample' });
    s.setActiveDataset(strayIndex);
    s.addDataPoint(200, 120); // (5, 9) -- a different, geometrically plausible answer
    s.setActiveDataset(0);

    expect(s.getResolvedErrorBars(0)[0]!.yUpper, 'the stored pairing must win').toBeCloseTo(7, 6);
  });
});
