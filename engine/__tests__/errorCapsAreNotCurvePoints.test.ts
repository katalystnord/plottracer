/**
 * B4 — ⚑⚑ A CAP IS NOT A POINT ON THE CURVE EITHER.
 *
 * The sweep after the export defect (a found bug is a search query, not a
 * ticket closed): WHO ELSE walks a series' pixels as though every one of them
 * were a data point? Two, both deriving something from the whole series:
 *
 *   · `getFitPoints`  (algorithms/curveFit.ts) — a polynomial fitted through
 *     the error caps as well as the data. Nothing refuses it, and the fitted
 *     line is drawn over the figure, so the user meets a curve that is wrong
 *     by however wide the bars are.
 *   · `getGeometryPoints` (algorithms/geometry.ts) — arc length and area over
 *     a path that zig-zags out to every cap and back.
 *
 * ⚑ AND GEOMETRY HAD THE OPPOSITE FAILURE AT THE SAME TIME. Its refusal asks
 * `dataset.hasSlots()` — "a Box Plot's tuples are independent measurements, not
 * a traced curve" — which is right about a Box Plot and wrong about an XY
 * scatter that has acquired extents. So the same series was simultaneously
 * REFUSED geometry (because it now has slots) and, had the refusal not fired,
 * would have measured the caps. The shape question, one layer down: ask what
 * the TYPE is, not what the storage looks like.
 */
import { describe, it, expect } from 'vitest';
import { CalibrationSession, XY_AXES_CONFIG } from '../calibrationSession.js';
import { runCurveFit } from '../curveFitPanel.js';
import { runGeometry } from '../geometryPanel.js';
import type { AnyAxes } from '../../core/plotData.js';

/** x 0..10 over px 100..300; y 0..10 over py 300..100. */
function session() {
  const s = new CalibrationSession(XY_AXES_CONFIG);
  for (const [px, py, v] of [
    [100, 300, '0'],
    [300, 300, '10'],
    [100, 300, '0'],
    [100, 100, '10'],
  ] as Array<[number, number, string]>) {
    s.handleCalibrationClick(px, py);
    s.confirmCalibrationValues([v]);
  }
  s.runCalibration();
  return s;
}

/** Four datums on the exact line y = x, each with a wide symmetric SD bar.
 * The caps sit 3 units above and below, so anything that reads them cannot
 * come out as y = x. */
function lineWithFatErrorBars() {
  const s = session();
  for (const px of [120, 160, 200, 240]) {
    const py = 400 - px; // px 120 -> py 280 -> (1, 1); 240 -> (7, 7)
    s.addDataPoint(px, py);
    expect(
      s.captureErrorCap({
        targetIndex: 0,
        datumPixel: { x: px, y: py },
        capPixel: { x: px, y: py - 60 }, // +3 in data units
        baseName: 'SD',
      })
    ).toBeNull();
  }
  return s;
}

describe('a curve fit reads the data, not its uncertainty', () => {
  it('⚑⚑ a straight line stays a straight line when it gains error bars', () => {
    const s = lineWithFatErrorBars();
    const result = runCurveFit(s.getDataset(), s.getAxes() as unknown as AnyAxes, {
      degree: 1,
      restrict: false,
    });
    expect('error' in result ? result.error : null).toBeNull();
    const fit = 'curveFit' in result ? result.curveFit : null;
    expect(fit).not.toBeNull();
    // y = x exactly. Fitted through the caps the SLOPE survives (they are
    // symmetric) but R² collapses and `n` counts three times the readings — so
    // the assertions that bite are the goodness of fit and the point count, not
    // the coefficients.
    expect(fit!.n).toBe(4);
    expect(fit!.rSquared).toBeCloseTo(1, 6);
  });

  it('⚑ a series with no error fits exactly as it always did', () => {
    const s = session();
    for (const px of [120, 160, 200, 240]) s.addDataPoint(px, 400 - px);
    const result = runCurveFit(s.getDataset(), s.getAxes() as unknown as AnyAxes, {
      degree: 1,
      restrict: false,
    });
    expect('curveFit' in result ? result.curveFit.rSquared : null).toBeCloseTo(1, 6);
  });
});

describe('geometry reads the data, not its uncertainty', () => {
  it('⚑⚑ an XY series with error is not refused as a tuple type', () => {
    const s = lineWithFatErrorBars();
    const result = runGeometry(s.getDataset(), s.getAxes() as unknown as AnyAxes, false);
    expect('error' in result ? result.error : null).toBeNull();
  });

  it('⚑ the arc length is the curve, not the zig-zag out to every cap', () => {
    const s = lineWithFatErrorBars();
    const result = runGeometry(s.getDataset(), s.getAxes() as unknown as AnyAxes, false);
    const geometry = 'geometry' in result ? result.geometry : null;
    // (1,1) to (7,7) along y = x.
    expect(geometry!.arcLength).toBeCloseTo(Math.sqrt(2) * 6, 6);
  });

  it('⚑ a genuine tuple type is STILL refused', () => {
    // The companion assertion. Box Plot's five letter values are independent
    // measurements, not a traced curve — that refusal must survive the change
    // that stopped error slots triggering it.
    const s = session();
    expect(s.applyBoxPlotGroups()).toBe(true);
    s.addDataPoint(150, 280);
    s.addDataPoint(150, 260);
    const result = runGeometry(s.getDataset(), s.getAxes() as unknown as AnyAxes, false);
    expect('error' in result ? result.error : '').toContain('slots');
  });
});
