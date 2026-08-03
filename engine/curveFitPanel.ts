/**
 * Curve Fit orchestration (checkpoint 27, see CLAUDE.md) -- the click/run
 * policy layered on top of algorithms/curveFit.ts's pure fitPolynomial/
 * computeFitStats/getFitPoints, extracted so it's directly vitest-testable
 * without a full Electron+Playwright launch, same reasoning as
 * engine/segmentFillRun.ts.
 *
 * Faithful port of the policy in ui-patches/engauge-algos.js's
 * wpd.runCurveFit (the current, still-running app's own Curve Fit popup,
 * Phase 2.6): gather fit points (already slot-aware via
 * getFitPoints -- only the primary group, so Error Bar Groups datasets
 * still fit sensibly), optionally restrict to a valid x-range, require at
 * least degree+1 points, run the fit, and report the same error messages
 * verbatim. XY axes only, same restriction as the current app (BarAxes
 * etc. have no numeric x-coordinate to regress against and no working
 * dataToPixel to draw an overlay with) -- enforced by ui/'s Workspace.tsx
 * only offering this panel for `config.id === 'xy'`, not by this module
 * itself (which just takes whatever AnyAxes it's given, same as
 * getFitPoints already does).
 *
 * Persistence: the current app stores a dataset's active curve fit in its
 * own metadata (`dataset.getMetadata().curveFit`) so it survives across
 * popup open/close -- getCurveFitState/setCurveFitState do the same here,
 * which has a free side benefit checkpoint 25's project save/load didn't
 * have to do any extra work for: core/plotData.ts's serialize/deserialize
 * already round-trips a dataset's whole getMetadata() object generically,
 * so a saved-and-reopened project's curve fit comes back automatically.
 */

import type { Dataset } from '../core/dataset.js';
import type { AnyAxes } from '../core/plotData.js';
import { fitPolynomial, computeFitStats, getFitPoints, evaluatePolynomial, formatPolynomial, type Point2D } from '../algorithms/curveFit.js';
import { findFitModel, fitModel, type FitModelId } from '../algorithms/nonlinearFit.js';

/** Which shape was fitted. `'polynomial'` is the original and stays the
 * DEFAULT — an absent `model` on a stored fit means polynomial, so every
 * project saved before nonlinear fitting existed keeps reading correctly.
 * Unlike some past compatibility questions, those files genuinely do exist. */
export type CurveFitModelId = 'polynomial' | FitModelId;

export interface CurveFitState {
  /** Absent on fits saved before nonlinear models existed = polynomial. */
  model?: CurveFitModelId;
  /** Only meaningful for a polynomial; kept for every fit so the stored shape
   * does not change between models. */
  degree: number;
  restrict: boolean;
  xMin: number | null;
  xMax: number | null;
  /** The fitted parameters — polynomial coefficients, or the model's own
   * parameters in the order it names them. */
  coefficients: number[];
  /** Absent for a flat series — R² is undefined when every y is the same. RMS
   * is the number to read there. */
  rSquared?: number;
  rms: number;
  n: number;
  fitXMin: number;
  fitXMax: number;
  /**
   * Did the solver settle? Absent for a polynomial, which is solved directly and
   * has nothing to converge. ⚑ Recorded because a nonlinear fit that ran out of
   * iterations must never be presented as a result — a drawn curve is read as an
   * answer whether or not it earned it.
   */
  converged?: boolean;
}

export interface RunCurveFitOptions {
  /** Defaults to a polynomial, which is what every existing caller means. */
  model?: CurveFitModelId;
  degree: number;
  restrict: boolean;
  xMin?: number;
  xMax?: number;
}

export type RunCurveFitResult = { curveFit: CurveFitState } | { error: string };

export function runCurveFit(dataset: Dataset, axes: AnyAxes, options: RunCurveFitOptions): RunCurveFitResult {
  let points = getFitPoints(dataset, axes);

  if (options.restrict) {
    const { xMin, xMax } = options;
    if (xMin === undefined || xMax === undefined || Number.isNaN(xMin) || Number.isNaN(xMax) || xMin >= xMax) {
      return { error: 'Enter a valid x-range (min less than max).' };
    }
    points = points.filter((p) => p.x >= xMin && p.x <= xMax);
  }

  const modelId: CurveFitModelId = options.model ?? 'polynomial';

  if (modelId === 'polynomial' && points.length < options.degree + 1) {
    return {
      error: `Not enough points for a degree ${options.degree} fit — need at least ${options.degree + 1}, have ${points.length}.`,
    };
  }

  const xs = points.map((p) => p.x);
  const fitXMin = Math.min(...xs);
  const fitXMax = Math.max(...xs);
  const common = {
    restrict: options.restrict,
    xMin: options.restrict ? options.xMin! : null,
    xMax: options.restrict ? options.xMax! : null,
    n: points.length,
    fitXMin,
    fitXMax,
  };

  // A named shape (exponential, power, logarithmic, Gaussian, logistic), solved
  // by Levenberg-Marquardt. Its own refusals already name what the model needs,
  // so they are passed through rather than reworded here.
  if (modelId !== 'polynomial') {
    const model = findFitModel(modelId);
    if (!model) return { error: `Unknown curve fit model: ${modelId}.` };
    const outcome = fitModel(model, points);
    if ('error' in outcome) return outcome;
    return {
      curveFit: {
        ...common,
        model: modelId,
        degree: options.degree,
        coefficients: outcome.params,
        // Spread-when-defined, not `rSquared: undefined`. R² is ABSENT for a
        // series with no spread rather than being some value -- writing the key
        // with an undefined in it is a different claim, and the one that
        // shipped as "R² = 1.00000" in v1.5.0.
        ...(outcome.rSquared === undefined ? {} : { rSquared: outcome.rSquared }),
        rms: outcome.rms,
        converged: outcome.converged,
      },
    };
  }

  let coefficients: number[];
  try {
    coefficients = fitPolynomial(points, options.degree);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  const stats = computeFitStats(points, coefficients);

  return {
    curveFit: {
      ...common,
      model: 'polynomial',
      degree: options.degree,
      coefficients,
      ...(stats.rSquared === undefined ? {} : { rSquared: stats.rSquared }),
      rms: stats.rms,
    },
  };
}

/** Evaluate whatever shape this fit is, at one x. The ONE place that knows a
 * fit might not be a polynomial, so no caller has to branch on the model. */
export function evaluateCurveFit(curveFit: CurveFitState, x: number): number {
  const id = curveFit.model ?? 'polynomial';
  if (id === 'polynomial') return evaluatePolynomial(curveFit.coefficients, x);
  const model = findFitModel(id);
  return model ? model.evaluate(curveFit.coefficients, x) : NaN;
}

/** The fitted equation, written out. Same reasoning as evaluateCurveFit: the
 * UI and the exporters ask for it rather than knowing how each model reads. */
export function formatCurveFitEquation(curveFit: CurveFitState): string {
  const id = curveFit.model ?? 'polynomial';
  if (id === 'polynomial') return formatPolynomial(curveFit.coefficients);
  const model = findFitModel(id);
  return model ? model.formatEquation(curveFit.coefficients) : '';
}

const CURVE_FIT_METADATA_KEY = 'curveFit';

export function getCurveFitState(dataset: Dataset): CurveFitState | null {
  const meta = dataset.getMetadata();
  return (meta[CURVE_FIT_METADATA_KEY] as CurveFitState | undefined) ?? null;
}

export function setCurveFitState(dataset: Dataset, curveFit: CurveFitState | null): void {
  const meta = { ...dataset.getMetadata() };
  if (curveFit) meta[CURVE_FIT_METADATA_KEY] = curveFit;
  else delete meta[CURVE_FIT_METADATA_KEY];
  dataset.setMetadata(meta);
}

/** Samples the fitted polynomial as {x,y} *data-space* points across its
 * fit x-range, matching the current app's own overlay-drawing sample count
 * (SAMPLES in ui-patches/engauge-algos.js's drawPoints override). ui/
 * converts each point to pixel space via the axes' own dataToPixel before
 * rendering -- this module has no pixel/canvas concept at all. */
export function sampleCurveFitLine(curveFit: CurveFitState, samples = 100): Point2D[] {
  const span = curveFit.fitXMax - curveFit.fitXMin;
  const pts: Point2D[] = [];
  for (let i = 0; i <= samples; i++) {
    const x = curveFit.fitXMin + (span * i) / samples;
    pts.push({ x, y: evaluateCurveFit(curveFit, x) });
  }
  return pts;
}
