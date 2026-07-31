import { describe, expect, it } from 'vitest';
import { CalibrationSession, PIE_AXES_CONFIG } from '../calibrationSession.js';
import type { PieAxes } from '../../core/axes/pie.js';

/**
 * ⚑⚑ THE TUPLE ARRAY IS SPLICED BY FOUR METHODS, AND THE PENDING APEX IS AN
 * INDEX INTO IT — v2.0 pre-launch audit, round 2.
 *
 * `pendingExplodedTuple` pins an in-progress exploded slice to a tuple INDEX.
 * The v2.0 audit taught `removeTuple` and `discardTuple` to clear or shift it
 * when that array changes shape, and left `removeLastPoint` and
 * `removeDataPointAt` calling `dataset.removeTuple` directly — so pressing
 * Delete on the last point of an in-progress exploded sector stranded the
 * index, and the DISCARDED apex was later written onto whatever ordinary
 * sector next landed there. Nothing on screen was wrong except a stuck
 * "click its edges" prompt.
 *
 * The second case is worse than wrong: an empty tuple is not serialized at
 * all (PlotData records tuples through their member pixels), so an undo onto
 * the apex-click moment restored a cursor pointing past the rebuilt array and
 * the next click threw out of the canvas handler.
 */

/** A calibrated pie: four rim points, total 100, full circle. */
function pieSession(): CalibrationSession<PieAxes> {
  const s = new CalibrationSession<PieAxes>(PIE_AXES_CONFIG);
  for (const [x, y] of [
    [450, 300],
    [300, 450],
    [150, 300],
    [300, 150],
  ] as Array<[number, number]>) {
    s.handleCalibrationClick(x, y);
    s.confirmCalibrationValues([]);
  }
  s.setGlobalFieldValue('total', '100');
  s.setGlobalFieldValue('sweep', '360');
  expect(s.runCalibration()).toBe(true);
  return s;
}

/** A pixel on the rim at `deg`, measured the way the figure is drawn. */
function rim(deg: number): [number, number] {
  const r = (deg * Math.PI) / 180;
  return [300 + 150 * Math.cos(r), 300 + 150 * Math.sin(r)];
}

describe('deleting the last point of an in-progress exploded slice', () => {
  it('⚑ does not re-attach the discarded apex to a later, unrelated sector', () => {
    const s = pieSession();
    s.addDataPoint(...rim(-90));
    s.addDataPoint(...rim(0)); // sector 0 complete, sector 1 chain-opened

    s.setNextSectorExploded(true);
    s.addDataPoint(320, 220); // the apex — mints an EMPTY tuple, pins the index
    s.addDataPoint(...rim(60)); // first edge lands in that tuple
    s.removeLastPoint(); // Delete — the tuple empties and is spliced out

    // Carry on capturing ordinary sectors.
    s.addDataPoint(...rim(60));
    s.addDataPoint(...rim(120));

    const rows = s.getTupleRows();
    // No surviving row may carry the discarded apex.
    for (const row of rows) {
      for (const p of row.points) {
        expect(p?.px === 320 && p?.py === 220).toBe(false);
      }
    }
    // And the in-progress state is genuinely cancelled, not merely unused --
    // stranded, it stayed on 'edges' forever and the prompt stuck with it.
    expect(s.getExplodedStage()).toBe('off');
  });

  it('⚑ every surviving sector reads a value derived from its OWN two edges', () => {
    // The measured harm: a sector that should read 33.3 read 19.2 -- a 42%
    // error -- because the discarded apex was silently reattached to it, and
    // a sector measured about the wrong tip reads the wrong angle. Asserting
    // the values rather than only the absence of the pixel is what makes this
    // a test about the NUMBER.
    const s = pieSession();
    s.addDataPoint(...rim(-90));
    s.addDataPoint(...rim(0)); // sector 0 = a quarter = 25
    s.setNextSectorExploded(true);
    s.addDataPoint(320, 220);
    s.addDataPoint(...rim(60));
    s.removeLastPoint();
    s.addDataPoint(...rim(60));
    s.addDataPoint(...rim(120)); // a sixth of the circle = 16.7

    const derived = s.getTupleRows().map((r) => r.derived);
    expect(derived[0]).toBeCloseTo(25, 1);
    // 0 deg -> 60 deg is a sixth of the circle. Measured about the stranded
    // apex instead it came out near 19.
    expect(derived[1]).toBeCloseTo(16.7, 1);
  });
});

describe('undoing onto the apex click', () => {
  it('⚑ leaves a cursor the next click can honour, rather than throwing', () => {
    // An empty tuple is not serialized, so the restored dataset is SHORTER
    // than the cursor captured beside it. Trusted verbatim, the next
    // addDataPoint threw "Cannot read properties of undefined" straight out
    // of the canvas click handler.
    const s = pieSession();
    s.addDataPoint(...rim(-90));
    s.addDataPoint(...rim(0));
    s.setNextSectorExploded(true);
    s.addDataPoint(320, 220);
    const atApex = s.captureState(); // snapshot with an empty tuple live
    s.addDataPoint(...rim(60));

    s.restoreState(atApex);
    expect(() => s.addDataPoint(...rim(60))).not.toThrow();
  });

  it('an ordinary pie capture still round-trips through undo unchanged', () => {
    // The guard must not drop a legitimate cursor.
    const s = pieSession();
    s.addDataPoint(...rim(-90));
    s.addDataPoint(...rim(0));
    const before = s.getTupleRows().map((r) => r.derived);
    s.restoreState(s.captureState());
    expect(s.getTupleRows().map((r) => r.derived)).toEqual(before);
  });
});
