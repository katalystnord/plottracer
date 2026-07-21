/**
 * Curve Fit orchestration (checkpoint 27, see CLAUDE.md) -- the click/run
 * policy layered on top of algorithms/curveFit.ts's pure fitPolynomial/
 * computeFitStats/getFitPoints, extracted so it's directly vitest-testable
 * without a full Electron+Playwright launch, same reasoning as
 * engine/segmentFillRun.ts.
 *
 * Faithful port of the policy in ui-patches/engauge-algos.js's
 * wpd.runCurveFit (the current, still-running app's own Curve Fit popup,
 * Phase 2.6): gather fit points (already point-groups-aware via
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
import { fitPolynomial, computeFitStats, getFitPoints, evaluatePolynomial, type Point2D } from '../algorithms/curveFit.js';

export interface CurveFitState {
  degree: number;
  restrict: boolean;
  xMin: number | null;
  xMax: number | null;
  coefficients: number[];
  rSquared: number;
  rms: number;
  n: number;
  fitXMin: number;
  fitXMax: number;
}

export interface RunCurveFitOptions {
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

  if (points.length < options.degree + 1) {
    return {
      error: `Not enough points for a degree ${options.degree} fit — need at least ${options.degree + 1}, have ${points.length}.`,
    };
  }

  const xs = points.map((p) => p.x);
  const fitXMin = Math.min(...xs);
  const fitXMax = Math.max(...xs);

  let coefficients: number[];
  try {
    coefficients = fitPolynomial(points, options.degree);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  const stats = computeFitStats(points, coefficients);

  return {
    curveFit: {
      degree: options.degree,
      restrict: options.restrict,
      xMin: options.restrict ? options.xMin! : null,
      xMax: options.restrict ? options.xMax! : null,
      coefficients,
      rSquared: stats.rSquared,
      rms: stats.rms,
      n: points.length,
      fitXMin,
      fitXMax,
    },
  };
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
    pts.push({ x, y: evaluatePolynomial(curveFit.coefficients, x) });
  }
  return pts;
}
