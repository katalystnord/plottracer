import { describe, expect, it } from 'vitest';
import { CalibrationSession, XY_AXES_CONFIG } from '../calibrationSession.js';
import type { XYAxes } from '../../core/axes/xy.js';
import { setErrorRelation } from '../errorRelation.js';

/**
 * Checkpoint 85 — finding A6: the whisker and the record used DIFFERENT rules.
 *
 * Checkpoint 79 resolved cap->datum in PIXEL space inside `getErrorWhiskers`
 * (to avoid needing an axes) while `resolveErrorBars` resolved in DATA space.
 * Checkpoint 68 turned rotation correction on by default, so data-x mixes
 * pixel-x and pixel-y -- and on a rotated calibration the two disagreed.
 *
 * That breaks the design's own safety argument (docs/error-bars-design.md: "the
 * rendering is the check on what the storage leaves implicit"). A check computed
 * differently from the thing it checks is not a check.
 *
 * These tests use a deliberately ROTATED calibration, because on a
 * screen-aligned one the bug is invisible -- which is exactly why it shipped.
 */

/**
 * Calibrate XY at ~45 degrees, so data-x is a genuine mix of pixel-x AND pixel-y.
 *
 * The geometry is chosen so the two rules give DIFFERENT answers -- which took
 * deliberate construction, and is the point. A first draft used a gentle ~11
 * degree tilt and both rules happened to pick the same datum, so the test passed
 * with the bug present and proved nothing.
 *
 * Here: data-x increases along (1,1), so two datums at the SAME pixel-x but
 * different pixel-y are far apart in data-x. Pixel-space matching sees a tie and
 * takes the first; data-space matching sees the real answer.
 */
function tiltedSession() {
  const s = new CalibrationSession(XY_AXES_CONFIG);
  const steps: Array<[number, number, string]> = [
    [100, 100, '0'],   // X1: data-x = 0
    [300, 300, '10'],  // X2: data-x = 10, along (1,1)
    [100, 100, '0'],   // Y1
    [300, -100, '10'], // Y2: along (1,-1), perpendicular
  ];
  for (const [px, py, v] of steps) {
    expect(s.handleCalibrationClick(px, py)).toBe('awaiting-value');
    expect(s.confirmCalibrationValues([v])).toBe(true);
  }
  expect(s.runCalibration()).toBe(true);
  return s;
}

/** Two datums with the SAME pixel-x and very different data-x, plus a cap that
 * belongs to the SECOND by data-x while pixel-x cannot tell them apart. */
const DATUM_A = { x: 200, y: 150 };
const DATUM_B = { x: 200, y: 350 };
const CAP = { x: 240, y: 340 };

describe('A6 — the whisker resolves the same way the record does', () => {
  it('pairs a cap with the datum the RECORD pairs it with, on a rotated chart', () => {
    const s = tiltedSession();
    s.renameDataset(0, 'Sample');
    // Two datums whose DATA-x differ, placed so that pixel-x ordering and
    // data-x ordering are not the same thing under this rotation.
    s.addDataPoint(DATUM_A.x, DATUM_A.y);
    s.addDataPoint(DATUM_B.x, DATUM_B.y);

    const capIndex = s.addDataset('SD upper');
    setErrorRelation(s.getDatasets()[capIndex]!, { role: 'upper', of: 'Sample' });
    s.setActiveDataset(capIndex);
    s.addDataPoint(CAP.x, CAP.y);

    const axes = s.getAxes() as XYAxes;
    const capData = axes.pixelToData(CAP.x, CAP.y);
    const dA = axes.pixelToData(DATUM_A.x, DATUM_A.y);
    const dB = axes.pixelToData(DATUM_B.x, DATUM_B.y);

    // Upper caps match on data-x. Assert the premise first, or this test could
    // pass by coincidence the way its first draft did: PIXEL-x cannot tell these
    // two datums apart, DATA-x clearly can.
    expect(Math.abs(DATUM_A.x - CAP.x)).toBe(Math.abs(DATUM_B.x - CAP.x));
    expect(Math.abs(dB[0]! - capData[0]!)).toBeLessThan(Math.abs(dA[0]! - capData[0]!));

    const whiskers = s.getErrorWhiskers();
    expect(whiskers).toHaveLength(1);
    // The bar segment runs datum -> cap; segment[0].from is the datum end.
    expect(whiskers[0]![0]!.from.x).toBeCloseTo(DATUM_B.x, 6);
    expect(whiskers[0]![0]!.from.y).toBeCloseTo(DATUM_B.y, 6);
    // And it ends exactly where the user released.
    expect(whiskers[0]![0]!.to).toEqual({ x: CAP.x, y: CAP.y });
  });

  it('agrees with resolveErrorBars — the record and the drawing name one datum', () => {
    // The property that matters, stated directly: whatever the export reports as
    // the datum's yUpper must be the datum the whisker is drawn from.
    const s = tiltedSession();
    s.renameDataset(0, 'Sample');
    s.addDataPoint(DATUM_A.x, DATUM_A.y);
    s.addDataPoint(DATUM_B.x, DATUM_B.y);
    const capIndex = s.addDataset('SD upper');
    setErrorRelation(s.getDatasets()[capIndex]!, { role: 'upper', of: 'Sample' });
    s.setActiveDataset(capIndex);
    s.addDataPoint(CAP.x, CAP.y);

    const bars = s.getResolvedErrorBars(0);
    const withError = bars.filter((b) => b.yUpper !== undefined);
    expect(withError).toHaveLength(1);

    const axes = s.getAxes() as XYAxes;
    const whiskers = s.getErrorWhiskers();
    const drawnDatum = whiskers[0]![0]!.from;
    const drawnData = axes.pixelToData(drawnDatum.x, drawnDatum.y);

    // The datum the RECORD gave error to, and the datum the DRAWING hangs it
    // off, are the same point. This is what failed before A6.
    expect(drawnData[0]!).toBeCloseTo(withError[0]!.x, 6);
  });

  it('draws nothing before calibration — a cap has no data position yet', () => {
    const s = new CalibrationSession(XY_AXES_CONFIG);
    expect(s.getErrorWhiskers()).toEqual([]);
  });
});
