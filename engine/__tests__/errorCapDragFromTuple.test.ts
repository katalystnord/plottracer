/**
 * The cap's drag locks to ITS OWN datum's line — read from the record.
 *
 * ⚑⚑ THE DEFECT THIS INHERITS. David, 2026-08-04, driving the asymmetric
 * error-bar example: a cap 100px below its own datum but 58px from the NEIGHBOUR
 * claimed the neighbour, `constrainCap` projected it onto that datum's vertical,
 * and **the cap jumped sideways onto the bar next to it** — taking its delta with
 * it, so the number moved to the wrong data point too. Ordinary on a decaying
 * curve with wide error at its left-hand end, i.e. whenever a whisker is longer
 * than the gap to the next point.
 *
 * That was a nearest-match question. With the pairing stored there is no
 * question: the tuple says which datum this cap belongs to, so a cap CANNOT be
 * re-parented by being dragged near something else. The failure mode is removed
 * rather than tuned.
 */
import { describe, expect, it } from 'vitest';
import { CalibrationSession, XY_AXES_CONFIG } from '../calibrationSession.js';
import { setErrorRelation } from '../errorRelation.js';
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

describe('a cap recorded in its datum\'s tuple drags along that datum\'s line', () => {
  it('locks to the vertical through its own datum', () => {
    const s = session();
    const ds = s.getDatasets()[0]!;
    ds.addPixel(200, 200); // datum
    const slots = errorSlotNames('SD');
    ds.adoptSlots(slots);
    const capIndex = ds.addPixel(200, 150);
    ds.addToTupleAt(0, slotForRole('upper', slots.length), capIndex);

    const line = s.errorCapDragLine(0, capIndex);
    expect(line, 'a recorded cap must be constrained').not.toBeNull();
    expect(line!.origin.x).toBeCloseTo(200, 6);
    expect(line!.origin.y).toBeCloseTo(200, 6);
    expect(Math.abs(line!.direction.x), 'vertical: no x component').toBeLessThan(1e-6);
  });

  it('⚑⚑ a cap nearer the NEIGHBOUR still locks to its own datum', () => {
    // David's 2026-08-04 geometry: the whisker is longer than the gap to the
    // next point, so euclidean-nearest picks the wrong datum and the cap jumps
    // onto the neighbouring bar. Structurally impossible now.
    const s = session();
    const ds = s.getDatasets()[0]!;
    ds.addPixel(150, 280); // datum A -- this cap's owner, far above
    ds.addPixel(210, 190); // datum B -- much closer to where the cap sits
    const slots = errorSlotNames('SD');
    ds.adoptSlots(slots);
    const capIndex = ds.addPixel(150, 180); // A's cap: 100px from A, ~60px from B
    ds.addToTupleAt(0, slotForRole('upper', slots.length), capIndex);

    const line = s.errorCapDragLine(0, capIndex);
    expect(line).not.toBeNull();
    expect(line!.origin.x, 'must anchor on A, not the nearer B').toBeCloseTo(150, 6);
    expect(line!.origin.y).toBeCloseTo(280, 6);
  });

  it('a horizontal cap locks to the HORIZONTAL through its datum', () => {
    const s = session();
    const ds = s.getDatasets()[0]!;
    ds.addPixel(200, 200);
    const slots = errorSlotNames('SD');
    ds.adoptSlots(slots);
    const capIndex = ds.addPixel(240, 200);
    ds.addToTupleAt(0, slotForRole('right', slots.length), capIndex);

    const line = s.errorCapDragLine(0, capIndex);
    expect(line).not.toBeNull();
    expect(Math.abs(line!.direction.y), 'horizontal: no y component').toBeLessThan(1e-6);
  });

  it('the DATUM itself is not constrained — it is not a cap', () => {
    // Dragging the data point must stay free; only its extents are locked.
    const s = session();
    const ds = s.getDatasets()[0]!;
    const datumIndex = ds.addPixel(200, 200);
    const slots = errorSlotNames('SD');
    ds.adoptSlots(slots);
    ds.addToTupleAt(0, slotForRole('upper', slots.length), ds.addPixel(200, 150));
    expect(s.errorCapDragLine(0, datumIndex)).toBeNull();
  });

  it('a plain series with no error at all constrains nothing', () => {
    const s = session();
    s.addDataPoint(200, 200);
    expect(s.errorCapDragLine(0, 0)).toBeNull();
  });

  it('a pixel that is in no tuple constrains nothing', () => {
    const s = session();
    const ds = s.getDatasets()[0]!;
    ds.addPixel(200, 200);
    const slots = errorSlotNames('SD');
    ds.adoptSlots(slots);
    const stray = ds.addPixel(260, 120); // added, never filed into a tuple
    expect(s.errorCapDragLine(0, stray)).toBeNull();
  });
});

describe('the imported shape still constrains — no regression', () => {
  it('a cap in a related series is still locked to its datum', () => {
    const s = session();
    s.addDataPoint(200, 200);
    const capIndex = s.addDataset('SD upper');
    setErrorRelation(s.getDatasets()[capIndex]!, { role: 'upper', of: 'Sample' });
    s.setActiveDataset(capIndex);
    s.addDataPoint(200, 150);
    const line = s.errorCapDragLine(capIndex, 0);
    expect(line).not.toBeNull();
    expect(line!.origin.y).toBeCloseTo(200, 6);
  });
});
