import { describe, it, expect } from 'vitest';
import { CalibrationSession, XY_AXES_CONFIG } from '../calibrationSession.js';
import { runCurveFit, getCurveFitState, setCurveFitState, sampleCurveFitLine, type CurveFitState } from '../curveFitPanel.js';
import type { XYAxes } from '../../core/axes/xy.js';

// Same fixture shape as calibrationSession.test.ts's calibrateStandardXY:
// X1=0 @ (100,250), X2=10 @ (400,250) -- x_data = (px-100)/30.
// Y1=0 @ (100,250), Y2=10 @ (100,100) -- y_data = (250-py)/15.
function calibrateStandardXY(session: CalibrationSession<XYAxes>) {
  const steps: Array<[number, number, string]> = [
    [100, 250, '0'],
    [400, 250, '10'],
    [100, 250, '0'],
    [100, 100, '10'],
  ];
  for (const [px, py, value] of steps) {
    session.handleCalibrationClick(px, py);
    session.confirmCalibrationValues([value]);
  }
}

// Pixels chosen to land exactly on the data-space line y = 2x + 1 at
// x = 0, 1, 2, 3 given the calibration above.
const LINE_PIXELS: Array<[number, number]> = [
  [100, 235], // x=0, y=1
  [130, 205], // x=1, y=3
  [160, 175], // x=2, y=5
  [190, 145], // x=3, y=7
];

function buildCalibratedSessionWithLine(): CalibrationSession<XYAxes> {
  const session = new CalibrationSession(XY_AXES_CONFIG);
  calibrateStandardXY(session);
  session.runCalibration();
  for (const [px, py] of LINE_PIXELS) session.addDataPoint(px, py);
  return session;
}

describe('runCurveFit', () => {
  it('fits an exact line through points lying on y = 2x + 1', () => {
    const session = buildCalibratedSessionWithLine();
    const result = runCurveFit(session.getDataset(), session.getAxes()!, { degree: 1, restrict: false });
    if ('error' in result) throw new Error(`unexpected error: ${result.error}`);
    expect(result.curveFit.coefficients[0]).toBeCloseTo(1, 6); // intercept
    expect(result.curveFit.coefficients[1]).toBeCloseTo(2, 6); // slope
    expect(result.curveFit.rSquared).toBeCloseTo(1, 6);
    expect(result.curveFit.n).toBe(4);
    expect(result.curveFit.restrict).toBe(false);
    expect(result.curveFit.xMin).toBeNull();
  });

  it('rejects too few points for the requested degree, with a clear error', () => {
    const session = new CalibrationSession(XY_AXES_CONFIG);
    calibrateStandardXY(session);
    session.runCalibration();
    session.addDataPoint(100, 235);
    session.addDataPoint(130, 205);

    const result = runCurveFit(session.getDataset(), session.getAxes()!, { degree: 2, restrict: false });
    expect(result).toEqual({ error: expect.stringContaining('Not enough points') });
  });

  it('restricts to a valid x-range, excluding points outside it', () => {
    const session = buildCalibratedSessionWithLine();
    const result = runCurveFit(session.getDataset(), session.getAxes()!, { degree: 1, restrict: true, xMin: 0, xMax: 1.5 });
    if ('error' in result) throw new Error(`unexpected error: ${result.error}`);
    expect(result.curveFit.n).toBe(2); // x=0 and x=1 only
    expect(result.curveFit.restrict).toBe(true);
    expect(result.curveFit.xMin).toBe(0);
    expect(result.curveFit.xMax).toBe(1.5);
  });

  it('rejects an invalid x-range (min >= max) with a clear error', () => {
    const session = buildCalibratedSessionWithLine();
    const result = runCurveFit(session.getDataset(), session.getAxes()!, { degree: 1, restrict: true, xMin: 5, xMax: 1 });
    expect(result).toEqual({ error: 'Enter a valid x-range (min less than max).' });
  });

  it('rejects a missing x-range when restrict is true', () => {
    const session = buildCalibratedSessionWithLine();
    const result = runCurveFit(session.getDataset(), session.getAxes()!, { degree: 1, restrict: true });
    expect(result).toEqual({ error: 'Enter a valid x-range (min less than max).' });
  });
});

describe('getCurveFitState / setCurveFitState', () => {
  it('round-trips through the dataset metadata, defaulting to null', () => {
    const session = buildCalibratedSessionWithLine();
    const dataset = session.getDataset();
    expect(getCurveFitState(dataset)).toBeNull();

    const state: CurveFitState = {
      degree: 1,
      restrict: false,
      xMin: null,
      xMax: null,
      coefficients: [1, 2],
      rSquared: 1,
      rms: 0,
      n: 4,
      fitXMin: 0,
      fitXMax: 3,
    };
    setCurveFitState(dataset, state);
    expect(getCurveFitState(dataset)).toEqual(state);

    setCurveFitState(dataset, null);
    expect(getCurveFitState(dataset)).toBeNull();
  });
});

describe('sampleCurveFitLine', () => {
  it('samples the fitted line evenly across its fit x-range', () => {
    const curveFit: CurveFitState = {
      degree: 1,
      restrict: false,
      xMin: null,
      xMax: null,
      coefficients: [1, 2],
      rSquared: 1,
      rms: 0,
      n: 4,
      fitXMin: 0,
      fitXMax: 3,
    };
    const pts = sampleCurveFitLine(curveFit, 3);
    expect(pts).toHaveLength(4);
    expect(pts[0]).toEqual({ x: 0, y: 1 });
    expect(pts[3]).toEqual({ x: 3, y: 7 });
    expect(pts[1]!.x).toBeCloseTo(1, 10);
    expect(pts[1]!.y).toBeCloseTo(3, 10);
  });
});
