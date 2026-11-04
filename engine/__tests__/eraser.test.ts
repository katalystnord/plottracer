import { describe, expect, it } from 'vitest';
import { CalibrationSession, BAR_AXES_CONFIG, XY_AXES_CONFIG } from '../calibrationSession.js';
import type { CalibratedAxes } from '../calibrationSession.js';
import { walkCategoryAxis } from './helpers/categoryWalk.js';

/**
 * The Eraser's box on every graph type (v2.7; David, 2026-10-31, "yes!": the Eraser erases what it touches, and a
 * dragged box erases everything inside it on every graph type; the cases in docs/v2.7-workflow-walk.md, under the
 * Eraser). Until v2.7 the box was Find lines' types only (`eraseLinesInRect`).
 */

/** Value axis: 0 at py 300, 10 at py 100; the category axis from the shared walk. */
function barSession() {
  const s = new CalibrationSession(BAR_AXES_CONFIG);
  s.handleCalibrationClick(100, 300);
  expect(s.confirmCalibrationValues(['0'])).toBe(true);
  s.handleCalibrationClick(100, 100);
  expect(s.confirmCalibrationValues(['10'])).toBe(true);
  walkCategoryAxis(s);
  expect(s.runCalibration()).toBe(true);
  return s;
}

function xySession(): CalibrationSession<CalibratedAxes> {
  const s = new CalibrationSession<CalibratedAxes>(XY_AXES_CONFIG as never);
  for (const [px, py, v] of [[100, 250, '0'], [400, 250, '10'], [100, 250, '0'], [100, 100, '10']] as const) {
    s.handleCalibrationClick(px, py);
    s.confirmCalibrationValues([v]);
  }
  expect(s.runCalibration()).toBe(true);
  return s;
}

const counts = (s: CalibrationSession<CalibratedAxes> | ReturnType<typeof barSession>) =>
  s.getDatasets().map((d) => d.getAllPixels().length);

describe('a box dragged with the Eraser erases everything inside it, on every graph type', () => {
  it('given a bar chart with two series and a box over one bar of each, both bars are gone and the others stay', () => {
    const s = barSession();
    s.addDataPoint(140, 300);
    s.addDataPoint(160, 200); // series 1, bar 1
    s.addDataPoint(240, 300);
    s.addDataPoint(260, 150); // series 1, bar 2
    s.addDataset();
    s.addDataPoint(170, 300);
    s.addDataPoint(190, 250); // series 2, bar 1
    s.addDataPoint(270, 300);
    s.addDataPoint(290, 120); // series 2, bar 2
    expect(counts(s)).toEqual([4, 4]);
    // a box over the TOPS of the first bars only: a bar goes whole, as a click on its corner takes it
    expect(s.eraseInRect({ x: 130, y: 190, width: 70, height: 70 })).toBeGreaterThan(0);
    expect(counts(s)).toEqual([2, 2]);
    expect(s.getDatasets()[0]!.getAllPixels().map((p) => p.x)).toEqual([240, 260]);
    expect(s.getDatasets()[1]!.getAllPixels().map((p) => p.x)).toEqual([270, 290]);
  });

  it('given an XY series with error bars and a box over one datum, its error bar goes with it', () => {
    const s = xySession();
    s.addDataPoint(200, 200);
    s.addDataPoint(300, 150);
    s.captureErrorCap({ targetIndex: 0, datumPixel: { x: 200, y: 200 }, capPixel: { x: 200, y: 170 }, baseName: 'SD' });
    s.captureErrorCap({ targetIndex: 0, datumPixel: { x: 300, y: 150 }, capPixel: { x: 300, y: 120 }, baseName: 'SD' });
    expect(s.getResolvedErrorBars(0)).toHaveLength(2);
    s.eraseInRect({ x: 190, y: 190, width: 20, height: 20 }); // datum 0 only, not its caps
    const bars = s.getResolvedErrorBars(0);
    expect(bars).toHaveLength(1);
    expect(bars[0]!.yUpper).toBeDefined();
  });

  it('given placed points in two XY series, the points inside go from both and nothing else moves', () => {
    const s = xySession();
    for (const [x, y] of [[120, 200], [200, 200], [300, 200]] as const) s.addDataPoint(x, y);
    s.addDataset();
    for (const [x, y] of [[120, 150], [200, 150], [300, 150]] as const) s.addDataPoint(x, y);
    expect(s.eraseInRect({ x: 180, y: 140, width: 40, height: 70 })).toBe(2);
    expect(s.getDatasets().map((d) => d.getAllPixels().map((p) => p.x))).toEqual([[120, 300], [120, 300]]);
  });

  it('given a found line, it is still split at the hole, exactly as before', () => {
    const s = xySession();
    s.addFoundLines([[120, 140, 160, 180, 200].map((x) => ({ x, y: 200, role: null }))]);
    const found = s.getDatasets().length;
    s.eraseInRect({ x: 150, y: 190, width: 20, height: 20 });
    expect(s.getDatasets().length).toBe(found + 1);
  });

  it('given a box over nothing, nothing is erased', () => {
    const s = barSession();
    s.addDataPoint(140, 300);
    s.addDataPoint(160, 200);
    expect(s.eraseInRect({ x: 350, y: 100, width: 20, height: 20 })).toBe(0);
    expect(counts(s)).toEqual([2]);
  });
});
