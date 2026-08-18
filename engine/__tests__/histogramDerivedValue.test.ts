import { describe, expect, it } from 'vitest';
import { CalibrationSession, HISTOGRAM_AXES_CONFIG } from '../calibrationSession.js';
import type { XYAxes } from '../../core/axes/xy.js';

/**
 * v2.0 Phase 6 - a histogram bin's height reaches the on-screen tuple table.
 *
 * `getHistogramBins()` (algorithms/histogram.ts's binFromCorners) already
 * computed this correctly for the dedicated bins export path; the gap was
 * that `getTupleRows()[i].derived` - what Workspace.tsx's live tuple table
 * actually reads - stayed null for Histogram, since HISTOGRAM_AXES_CONFIG
 * never declared `derivedTupleValue`. This exercises the same computation
 * (two top corners, average their y) now reaching that column too, reusing
 * binFromCorners itself rather than re-deriving the arithmetic.
 */
function calibrateXY(s: CalibrationSession<XYAxes>): void {
  const steps: Array<[number, number, string]> = [
    [100, 300, '0'],
    [400, 300, '10'],
    [100, 300, '0'],
    [100, 100, '10'],
  ];
  for (const [px, py, v] of steps) {
    expect(s.handleCalibrationClick(px, py)).toBe('awaiting-value');
    expect(s.confirmCalibrationValues([v])).toBe(true);
  }
  expect(s.runCalibration()).toBe(true);
}

describe('Histogram: derivedTupleValue (v2.0 Phase 6)', () => {
  it('has no derived value until the second corner lands', () => {
    const session = new CalibrationSession(HISTOGRAM_AXES_CONFIG);
    calibrateXY(session);
    session.addDataPoint(150, 200);
    expect(session.getTupleRows()[0]!.derived).toBeNull();
  });

  it('averages both corners\' y, agreeing with getHistogramBins()\'s own value', () => {
    const session = new CalibrationSession(HISTOGRAM_AXES_CONFIG);
    calibrateXY(session);
    session.addDataPoint(150, 200); // left top corner
    session.addDataPoint(250, 220); // right top corner, slightly different y
    const derived = session.getTupleRows()[0]!.derived;
    const bin = session.getHistogramBins()[0]!;
    expect(derived).toBeCloseTo(bin.value, 9);
  });

  it('is order-independent -- clicking right-then-left reads the same height', () => {
    const a = new CalibrationSession(HISTOGRAM_AXES_CONFIG);
    calibrateXY(a);
    a.addDataPoint(150, 200);
    a.addDataPoint(250, 220);

    const b = new CalibrationSession(HISTOGRAM_AXES_CONFIG);
    calibrateXY(b);
    b.addDataPoint(250, 220);
    b.addDataPoint(150, 200);

    expect(a.getTupleRows()[0]!.derived).toBeCloseTo(b.getTupleRows()[0]!.derived!, 9);
  });
});
