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

  // ⚑ WHY the solver must refuse a non-finite fit rather than return one.
  // The store is `Dataset.setMetadata`, which deep-clones through
  // `JSON.parse(JSON.stringify(...))` -- and that rewrites NaN as **null**.
  // `coefficients` is declared `number[]`, so nothing downstream expects a
  // null, and `null * x === 0` in JS: the evaluator would quietly return a
  // flat line through y = 0 and draw it on the figure as the answer. The NaN
  // is not merely stored, it is LAUNDERED into a plausible number.
  //
  // This test characterises the storage layer, so if the clone is ever
  // replaced (structuredClone preserves NaN) the reasoning behind
  // curveFit.ts's overflow refusal is still on record and still checked.
  it('the metadata clone rewrites a non-finite coefficient as null', () => {
    const session = buildCalibratedSessionWithLine();
    const dataset = session.getDataset();
    const broken: CurveFitState = {
      degree: 1,
      restrict: false,
      xMin: null,
      xMax: null,
      coefficients: [Number.NaN, Number.NaN],
      rSquared: 1,
      rms: 0,
      n: 4,
      fitXMin: 0,
      fitXMax: 3,
    };
    setCurveFitState(dataset, broken);

    const readBack = getCurveFitState(dataset);
    expect(readBack).not.toBeNull();
    // NaN went in; null comes out -- not a number, and not NaN either.
    expect(readBack!.coefficients).toEqual([null, null]);
    // And null arithmetic turns it into a clean, entirely fictional zero.
    const asNumbers = readBack!.coefficients;
    expect(asNumbers[0]! * 5).toBe(0);
    expect(Number.isNaN(asNumbers[0]!)).toBe(false);
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

/**
 * Nonlinear models (v1.5). The solver itself is proved in
 * algorithms/__tests__/nonlinearFit.test.ts by recovering known parameters from
 * analytic data; these cover the PLUMBING - that a model reaches the fit, comes
 * back on the stored state, survives save/load, and that fits written before
 * models existed still read as polynomials.
 */
describe('curve fit models', () => {
  it('defaults to a polynomial when no model is asked for, exactly as before', () => {
    const session = buildCalibratedSessionWithLine();
    const r = runCurveFit(session.getDataset(), session.getAxes()!, { degree: 1, restrict: false });
    if ('error' in r) throw new Error(r.error);
    expect(r.curveFit.model).toBe('polynomial');
    // y = 2x + 1 -> [1, 2]
    expect(r.curveFit.coefficients[0]).toBeCloseTo(1, 6);
    expect(r.curveFit.coefficients[1]).toBeCloseTo(2, 6);
    // Nothing to converge when it is solved directly.
    expect(r.curveFit.converged).toBeUndefined();
  });

  it('fits a named model and records which one, plus whether it settled', () => {
    const session = buildCalibratedSessionWithLine();
    const r = runCurveFit(session.getDataset(), session.getAxes()!, {
      model: 'exponential',
      degree: 1,
      restrict: false,
    });
    if ('error' in r) throw new Error(r.error);
    expect(r.curveFit.model).toBe('exponential');
    expect(r.curveFit.converged).toBe(true);
    expect(r.curveFit.coefficients).toHaveLength(2);
  });

  it('passes the model’s own refusal through rather than rewording it', () => {
    const session = buildCalibratedSessionWithLine();
    // The line passes through y = 1..7, all positive, so use a model whose
    // requirement the data genuinely fails: x reaches 0, so ln(x) cannot.
    const r = runCurveFit(session.getDataset(), session.getAxes()!, {
      model: 'logarithmic',
      degree: 1,
      restrict: false,
    });
    expect('error' in r && r.error).toMatch(/greater than zero/i);
  });

  it('⚑ a fit stored WITHOUT a model still reads as a polynomial', () => {
    // Projects saved before nonlinear fitting existed carry no `model` key, and
    // those files really do exist -- unlike some past compatibility questions,
    // this one is about an artifact that can actually be on disk.
    const session = buildCalibratedSessionWithLine();
    const legacy = {
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
    } as CurveFitState;
    setCurveFitState(session.getDataset(), legacy);
    const back = getCurveFitState(session.getDataset())!;
    expect(back.model).toBeUndefined();
    // Sampled as a polynomial: y = 2x + 1.
    const line = sampleCurveFitLine(back, 3);
    expect(line[0]!.y).toBeCloseTo(1, 6);
    expect(line[3]!.y).toBeCloseTo(7, 6);
  });

  it('samples a nonlinear fit through its own model, not as a polynomial', () => {
    const fit = {
      model: 'exponential',
      degree: 1,
      restrict: false,
      xMin: null,
      xMax: null,
      coefficients: [2, 0.5], // y = 2·e^(0.5x)
      rSquared: 1,
      rms: 0,
      n: 4,
      fitXMin: 0,
      fitXMax: 2,
      converged: true,
    } as CurveFitState;
    const line = sampleCurveFitLine(fit, 2);
    expect(line[0]!.y).toBeCloseTo(2, 6); // x=0
    expect(line[2]!.y).toBeCloseTo(2 * Math.exp(1), 6); // x=2
    // A polynomial reading of [2, 0.5] would give 2 + 0.5x = 3 at x=2.
    expect(line[2]!.y).not.toBeCloseTo(3, 3);
  });

  it('a model round-trips through the dataset metadata that save/load uses', () => {
    const session = buildCalibratedSessionWithLine();
    const r = runCurveFit(session.getDataset(), session.getAxes()!, {
      model: 'exponential',
      degree: 1,
      restrict: false,
    });
    if ('error' in r) throw new Error(r.error);
    setCurveFitState(session.getDataset(), r.curveFit);
    const back = getCurveFitState(session.getDataset())!;
    expect(back.model).toBe('exponential');
    expect(back.converged).toBe(true);
  });
});
