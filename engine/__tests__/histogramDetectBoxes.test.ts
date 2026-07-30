import { describe, expect, it } from 'vitest';
import { CalibrationSession, HISTOGRAM_AXES_CONFIG } from '../calibrationSession.js';
import type { XYAxes } from '../../core/axes/xy.js';

/**
 * addBarDetectBoxes, extended to Histogram (v2.0, 2026-07-30).
 *
 * A bin's own two slots are its TOP corners (algorithms/histogram.ts's
 * binFromCorners averages both corners' y into one height) -- NOT opposite
 * corners the way Bar's are. These tests exist specifically to catch the
 * regression that would silently reintroduce the tenet-1 defect this whole
 * capability exists to avoid: feeding a detected box's genuine opposite
 * corners (top-left + bottom-right) would average the bar's TOP with its
 * BASELINE, halving every reading. Every box below has a deliberately
 * different `end.y` from `start.y` so a wrong (averaging) implementation
 * fails loudly instead of coincidentally matching.
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

describe('addBarDetectBoxes on a Histogram session (v2.0, 2026-07-30)', () => {
  it('files a detected box as one bin, reading height off the TOP edge only -- never averaged with the baseline end', () => {
    const session = new CalibrationSession(HISTOGRAM_AXES_CONFIG);
    calibrateXY(session);
    // start.y=200 -> height 5; end.y=280 (the box's BOTTOM/baseline edge) is
    // deliberately different -- if it leaked into an average the height
    // would read 3, not 5.
    const added = session.addBarDetectBoxes([{ start: { x: 150, y: 200 }, end: { x: 250, y: 280 } }]);
    expect(added).toBe(1);
    const bin = session.getHistogramBins()[0]!;
    expect(bin.value).toBeCloseTo(5, 9);
    expect(bin.binStart).toBeCloseTo((150 - 100) / 300 * 10, 9);
    expect(bin.binEnd).toBeCloseTo((250 - 100) / 300 * 10, 9);
  });

  it('does nothing before calibration', () => {
    const session = new CalibrationSession(HISTOGRAM_AXES_CONFIG);
    const added = session.addBarDetectBoxes([{ start: { x: 150, y: 200 }, end: { x: 250, y: 280 } }]);
    expect(added).toBe(0);
    expect(session.getHistogramBins()).toHaveLength(0);
  });

  it('files boxes in READING ORDER along x, regardless of detection order -- same rule as Bar', () => {
    const session = new CalibrationSession(HISTOGRAM_AXES_CONFIG);
    calibrateXY(session);
    const added = session.addBarDetectBoxes([
      { start: { x: 350, y: 100 }, end: { x: 400, y: 290 } }, // rightmost, tallest
      { start: { x: 100, y: 260 }, end: { x: 150, y: 290 } }, // leftmost, shortest
      { start: { x: 220, y: 200 }, end: { x: 280, y: 290 } }, // middle
    ]);
    expect(added).toBe(3);
    const bins = session.getHistogramBins();
    // Left-to-right by x, not input order and not sorted-by-height order.
    for (let i = 1; i < bins.length; i++) expect(bins[i]!.binStart).toBeGreaterThan(bins[i - 1]!.binStart);
  });
});
