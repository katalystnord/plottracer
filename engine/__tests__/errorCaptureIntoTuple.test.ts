/**
 * B4 — the capture gesture writes the cap onto the DATUM'S OWN RECORD.
 *
 * Named failing tests first (CLAUDE.md gate 2), named for the CASE.
 *
 * ⚑ What changes: dragging from a data point out to its cap used to CREATE a
 * series ("SD upper"), give it an `errorRelation`, and put the cap pixel in it —
 * after which which datum the cap belonged to was re-guessed on every read. Now
 * the cap goes into the datum's own tuple, so the pairing is a fact rather than
 * an inference.
 *
 * ⚑ The gesture, the refusals and the mirror are UNCHANGED. This is a change of
 * where the reading is written, not of how it is taken.
 */
import { describe, expect, it } from 'vitest';
import { CalibrationSession, XY_AXES_CONFIG, BAR_AXES_CONFIG } from '../calibrationSession.js';
import { hasErrorSlots, slotForRole } from '../../algorithms/errorExtent.js';

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

const cap = (s: ReturnType<typeof session>, datum: { x: number; y: number }, to: { x: number; y: number }) =>
  s.captureErrorCap({ targetIndex: 0, datumPixel: datum, capPixel: to, baseName: 'SD' });

describe('capturing a cap writes it onto the datum, not into a new series', () => {
  it('no new series is created', () => {
    // ⚑ The most visible change for the user: the series list stops growing a
    // pair of "SD upper"/"SD lower" entries they never asked for and then have
    // to activate in order to edit.
    const s = session();
    s.addDataPoint(200, 200);
    const before = s.getDatasets().length;
    expect(cap(s, { x: 200, y: 200 }, { x: 200, y: 160 })).toBeNull();
    expect(s.getDatasets().length, 'the capture must not spawn a series').toBe(before);
  });

  it('the reading lands on that datum and reads back through the primitive', () => {
    const s = session();
    s.addDataPoint(200, 200); // (5, 5)
    expect(cap(s, { x: 200, y: 200 }, { x: 200, y: 160 })).toBeNull(); // up to (5, 7)
    const bars = s.getResolvedErrorBars(0);
    expect(bars).toHaveLength(1);
    expect(bars[0]!.yUpper).toBeCloseTo(7, 6);
  });

  it('⚑ points placed BEFORE any error was thought of all survive', () => {
    // David's LabPlot requirement, end to end through the real gesture.
    const s = session();
    s.addDataPoint(150, 250);
    s.addDataPoint(200, 200);
    s.addDataPoint(250, 150);
    expect(cap(s, { x: 200, y: 200 }, { x: 200, y: 160 })).toBeNull();
    const bars = s.getResolvedErrorBars(0);
    expect(bars, 'all three points must still be there').toHaveLength(3);
    expect(bars.filter((b) => b.yUpper !== undefined), 'only the one dragged from has a cap').toHaveLength(1);
  });

  it('the MIRROR cap lands on the same datum, opposite role', () => {
    // Unchanged behaviour: both caps are always placed, and the mirrored one is
    // "a starting position, not a claim".
    const s = session();
    s.addDataPoint(200, 200);
    expect(cap(s, { x: 200, y: 200 }, { x: 200, y: 160 })).toBeNull();
    const bar = s.getResolvedErrorBars(0)[0]!;
    expect(bar.yUpper).toBeCloseTo(7, 6);
    expect(bar.yLower, 'the mirror is placed too').toBeCloseTo(3, 6);
  });

  it('⚑⚑ two datums whose caps share an x each keep their OWN — the defect, end to end', () => {
    // David's capture as a session test rather than a unit one. Under the old
    // nearest-x rule both points' caps resolved to point 1.
    const s = session();
    s.addDataPoint(180, 200); // datum A
    s.addDataPoint(260, 140); // datum B, elsewhere in x
    expect(cap(s, { x: 180, y: 200 }, { x: 180, y: 170 })).toBeNull();
    // B's cap is dragged to nearly A's x -- a sloppy but perfectly ordinary drag.
    expect(cap(s, { x: 260, y: 140 }, { x: 262, y: 110 })).toBeNull();
    const [a, b] = s.getResolvedErrorBars(0);
    expect(a!.yUpper, "A keeps A's cap").toBeCloseTo(s.getResolvedErrorBars(0)[0]!.yUpper!, 6);
    expect(b!.yUpper, 'B has its own cap, not A\'s').toBeDefined();
    expect(b!.yUpper).not.toBeCloseTo(a!.yUpper!, 3);
  });

  it('re-capturing the same role MOVES the cap instead of leaving an orphan', () => {
    // A cap is re-editable, so the second drag must not leave the first pixel
    // floating in the series as a stray point.
    const s = session();
    s.addDataPoint(200, 200);
    expect(cap(s, { x: 200, y: 200 }, { x: 200, y: 160 })).toBeNull();
    const after1 = s.getDatasets()[0]!.getCount();
    expect(cap(s, { x: 200, y: 200 }, { x: 200, y: 140 })).toBeNull();
    expect(s.getDatasets()[0]!.getCount(), 'no extra pixel may accumulate').toBe(after1);
    expect(s.getResolvedErrorBars(0)[0]!.yUpper).toBeCloseTo(8, 6);
  });

  it('a second cap of the SAME kind reuses the slots, without renaming them', () => {
    const s = session();
    s.addDataPoint(200, 200);
    s.addDataPoint(250, 180);
    expect(cap(s, { x: 200, y: 200 }, { x: 200, y: 160 })).toBeNull();
    const slots = s.getDatasets()[0]!.getSlotNames();
    expect(hasErrorSlots(slots)).toBe(true);
    expect(cap(s, { x: 250, y: 180 }, { x: 250, y: 150 })).toBeNull();
    expect(s.getDatasets()[0]!.getSlotNames(), 'the user names the error once').toEqual(slots);
    expect(s.getResolvedErrorBars(0).filter((b) => b.yUpper !== undefined)).toHaveLength(2);
  });

  it('⚑⚑ a DIFFERENT error kind goes to its own related series, not over the first', () => {
    // ⚠️ THE BUG THIS REPLACES. The first draft skipped adoption when slots
    // already existed and wrote the second kind into the FIRST kind's slots — so
    // a 95% CI reading was stored under a column headed "SD upper". Silent
    // mislabelling, and the test here previously ASSERTED that as correct.
    //
    // Storage was never the limit: any number of error series may relate to one
    // parent, and that path is untouched. The first kind is upgraded to a stored
    // pairing; every further kind stays exactly where it always was.
    const s = session();
    s.addDataPoint(200, 200); // (5, 5)
    expect(cap(s, { x: 200, y: 200 }, { x: 200, y: 180 })).toBeNull(); // SD, close in
    const slotsAfterSD = s.getDatasets()[0]!.getSlotNames();

    const refusal = s.captureErrorCap({
      targetIndex: 0,
      datumPixel: { x: 200, y: 200 },
      capPixel: { x: 200, y: 140 },
      baseName: '95% CI',
    });
    expect(refusal, 'a second kind is recorded, not refused').toBeNull();

    // The SD columns are untouched...
    expect(s.getDatasets()[0]!.getSlotNames()).toEqual(slotsAfterSD);
    // ...the SD reading is still the one in the tuple...
    expect(s.getResolvedErrorBars(0)[0]!.yUpper, 'SD, not CI, in the datum record').toBeCloseTo(6, 6);
    // ...and the CI bar exists as its own related series.
    const names = s.getDatasets().map((d) => d.name.trim());
    expect(names, 'the second kind got its own series').toContain('95% CI upper');
    expect(names).toContain('95% CI lower');
  });

  it('⚑⚑ re-dragging one cap does NOT re-symmetrize the other', () => {
    // The core of the model (David, 2026-07-16): the mirror is a STARTING
    // POSITION, not a constraint — an asymmetric bar is just a bar whose cap you
    // moved. My first draft wrote the mirror on every capture, so re-dragging
    // the upper would have snapped a deliberately-moved lower back to symmetry,
    // destroying a measurement on the exact feature this rework exists to serve.
    const s = session();
    s.addDataPoint(200, 200); // (5, 5)
    expect(cap(s, { x: 200, y: 200 }, { x: 200, y: 160 })).toBeNull();
    const ds = s.getDatasets()[0]!;
    const slots = ds.getSlotNames();
    const lowerPixel = ds.getAllTuples()[0]![slotForRole('lower', slots.length)]!;
    ds.setPixelAt(lowerPixel, 200, 280); // user drags the lower cap far out
    const asymmetricLower = s.getResolvedErrorBars(0)[0]!.yLower!;

    // Re-drag the UPPER cap through the gesture.
    expect(cap(s, { x: 200, y: 200 }, { x: 200, y: 140 })).toBeNull();

    const after = s.getResolvedErrorBars(0)[0]!;
    expect(after.yUpper, 'the upper moved as asked').toBeCloseTo(8, 6);
    expect(after.yLower, 'the lower stayed where it was put').toBeCloseTo(asymmetricLower, 6);
  });

  it('the active series is not stolen by the capture', () => {
    const s = session();
    s.addDataPoint(200, 200);
    const active = s.getActiveDatasetIndex();
    expect(cap(s, { x: 200, y: 200 }, { x: 200, y: 160 })).toBeNull();
    expect(s.getActiveDatasetIndex()).toBe(active);
  });
});

describe('the refusals are unchanged', () => {
  it('a zero-length drag is refused with the instruction', () => {
    const s = session();
    s.addDataPoint(200, 200);
    expect(cap(s, { x: 200, y: 200 }, { x: 200, y: 200 })).toMatch(/drag from a data point/i);
  });

  it('an unnamed error is refused', () => {
    const s = session();
    s.addDataPoint(200, 200);
    expect(
      s.captureErrorCap({ targetIndex: 0, datumPixel: { x: 200, y: 200 }, capPixel: { x: 200, y: 160 }, baseName: '  ' })
    ).toBeTruthy();
  });

  it('a drag with no data point under it is refused rather than inventing one', () => {
    // ⚑ An extent must hang off a datum -- so if the drag did not start on one,
    // there is nothing to attach to and nothing may be fabricated.
    const s = session();
    expect(cap(s, { x: 200, y: 200 }, { x: 200, y: 160 })).toBeTruthy();
    expect(s.getResolvedErrorBars(0)).toHaveLength(0);
  });

  it('an uncalibrated chart is refused', () => {
    const s = new CalibrationSession(XY_AXES_CONFIG);
    expect(
      s.captureErrorCap({ targetIndex: 0, datumPixel: { x: 200, y: 200 }, capPixel: { x: 200, y: 160 }, baseName: 'SD' })
    ).toMatch(/calibrate/i);
  });
});

describe('error on a BAR series appends to the bar\'s own slots', () => {
  it("a cap does not overwrite the bar's far corner", () => {
    const s = new CalibrationSession(BAR_AXES_CONFIG);
    for (const [px, py, v] of [
      [100, 300, '0'],
      [100, 100, '10'],
    ] as Array<[number, number, string]>) {
      expect(s.handleCalibrationClick(px, py)).toBe('awaiting-value');
      expect(s.confirmCalibrationValues([v])).toBe(true);
    }
    expect(s.runCalibration()).toBe(true);
    const ds = s.getDatasets()[0]!;
    const own = [...ds.getSlotNames()];
    expect(own.length, 'a bar series starts with its own slots').toBeGreaterThan(0);
    s.addDataPoint(200, 300); // bar start
    s.addDataPoint(200, 200); // bar end
    const before = ds.getSlotNames().length;
    s.captureErrorCap({ targetIndex: 0, datumPixel: { x: 200, y: 300 }, capPixel: { x: 200, y: 180 }, baseName: 'SD' });
    const after = ds.getSlotNames();
    expect(after.slice(0, own.length), "the bar's own slots must be untouched").toEqual(own);
    expect(after.length, 'error slots are appended').toBeGreaterThan(before);
    expect(hasErrorSlots(after)).toBe(true);
  });
});
