/**
 * Nonlinear curve fitting — standard models solved by Levenberg–Marquardt.
 *
 * Until now fitting was polynomial only (algorithms/curveFit.ts, normal
 * equations). A polynomial can be made to pass near almost anything by raising
 * its degree, which is exactly what makes it a poor description of a process
 * that is actually exponential, saturating, or a peak. These models say
 * something about the SHAPE instead, and their parameters have meaning a reader
 * can use — a rate, a half-max, a width.
 *
 * ⚑ THIS IS INTERPRETATION, AND IT STAYS SEPARATE (tenet 9). A fit is not the
 * record. It already lives apart everywhere it appears — its own export block,
 * its own key in the JSON, never mixed into the traced points — and nothing here
 * changes a single recorded pixel. The rule this module adds to that: **when the
 * fit does not converge, say so.** A model that failed must never be shown as a
 * plausible curve, because a drawn line is read as a result.
 *
 * WHY LEVENBERG–MARQUARDT. It interpolates between gradient descent (reliable
 * far from the solution) and Gauss–Newton (fast near it) by one damping term, so
 * it is the standard choice for small least-squares problems and needs no
 * derivatives supplied by hand — the Jacobian here is numeric. Tenet 10 says the
 * simplest thing that works, and for five models with 2–3 parameters each this
 * is it; nothing here needs a general optimiser.
 *
 * ⚑ THE INITIAL GUESS IS THE WHOLE GAME. LM finds a LOCAL minimum, so a bad
 * start gives a confident wrong answer. Every model below therefore derives its
 * start from the data rather than from a constant: the three log-linearisable
 * models (exponential, power, logarithmic) start from an exact linear least
 * squares fit in transformed space, and the two shaped models start from
 * measured features — the peak for a Gaussian, the range and midpoint for a
 * logistic. That is also why each model states which points it CAN use: a
 * logarithm needs x > 0, and refusing is better than quietly dropping the rest
 * of the series.
 */

import { solveLinearSystem, type Point2D } from './curveFit.js';

export type FitModelId = 'exponential' | 'power' | 'logarithmic' | 'gaussian' | 'logistic';

export interface FitModel {
  id: FitModelId;
  /** What the user picks it by. */
  label: string;
  /** The form, shown beside the label so the choice is not a guess. */
  form: string;
  paramNames: string[];
  /** y for one x, given parameters. */
  evaluate(params: readonly number[], x: number): number;
  /**
   * A starting point derived from the data. Returns null when the data cannot
   * support one — the caller then refuses with `requires` rather than starting
   * LM somewhere arbitrary.
   */
  initialGuess(points: readonly Point2D[]): number[] | null;
  /** Plain-words statement of what the model needs, used in the refusal when
   * `initialGuess` returns null. */
  requires: string;
  /**
   * Can the model be EVALUATED at this point at all?
   *
   * Separate from `initialGuess` on purpose. A guess may only need some points
   * (an exponential is linearised through the positive y values but is perfectly
   * defined at the rest), whereas a point outside the model's DOMAIN — ln(0), a
   * fractional power of a negative x — makes the residual non-finite and the
   * whole fit meaningless. Without this the refusal degrades to "could not be
   * fitted", which tells the user nothing they can act on.
   *
   * Omitted where the model is defined everywhere.
   */
  domain?: (p: Point2D) => boolean;
  /**
   * Plain-words statement for a DOMAIN refusal specifically, when it differs
   * from `requires` (v2.0 pre-launch audit). Power law's domain only checks
   * x > 0 -- a point with x > 0 but y <= 0 passes the domain gate and DOES
   * reach the actual least-squares fit (only `initialGuess`'s own, stricter
   * x>0&&y>0 filter excludes it from seeding). `requires`'s "every x AND y"
   * wording is accurate for an initialGuess refusal but overstates the
   * domain gate's real, narrower requirement -- so a domain failure shows
   * this instead when set. Defaults to `requires` for every model whose
   * domain and initialGuess agree (i.e. every model but power today). */
  domainRequires?: string;
  /** Written out with the fitted numbers. */
  formatEquation(params: readonly number[]): string;
}

const fmt = (n: number): string => {
  if (!Number.isFinite(n)) return String(n);
  if (n !== 0 && (Math.abs(n) < 1e-4 || Math.abs(n) >= 1e6)) return n.toExponential(4);
  return Number(n.toPrecision(5)).toString();
};

const signed = (n: number): string => (n >= 0 ? ` + ${fmt(n)}` : ` − ${fmt(Math.abs(n))}`);

/**
 * Ordinary least squares for y = m·x + c. Exact, and the seed for every
 * log-linearisable model below. Returns null for fewer than two distinct x.
 */
function linearFit(pts: readonly Point2D[]): { m: number; c: number } | null {
  const n = pts.length;
  if (n < 2) return null;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const p of pts) {
    sx += p.x; sy += p.y; sxx += p.x * p.x; sxy += p.x * p.y;
  }
  const denom = n * sxx - sx * sx;
  if (Math.abs(denom) < 1e-12) return null;
  const m = (n * sxy - sx * sy) / denom;
  return { m, c: (sy - m * sx) / n };
}

export const FIT_MODELS: readonly FitModel[] = [
  {
    id: 'exponential',
    label: 'Exponential',
    form: 'y = a·e^(b·x)',
    paramNames: ['a', 'b'],
    evaluate: (p, x) => p[0]! * Math.exp(p[1]! * x),
    requires: 'every y value to be greater than zero',
    // ln y = ln a + b·x — exact linear fit in log space.
    initialGuess: (pts) => {
      const usable = pts.filter((p) => p.y > 0);
      if (usable.length < 2) return null;
      const lin = linearFit(usable.map((p) => ({ x: p.x, y: Math.log(p.y) })));
      if (!lin) return null;
      return [Math.exp(lin.c), lin.m];
    },
    formatEquation: (p) => `y = ${fmt(p[0]!)}·e^(${fmt(p[1]!)}·x)`,
  },
  {
    id: 'power',
    label: 'Power law',
    form: 'y = a·x^b',
    paramNames: ['a', 'b'],
    evaluate: (p, x) => p[0]! * Math.pow(x, p[1]!),
    requires: 'every x and y value to be greater than zero',
    domainRequires: 'every x value to be greater than zero',
    domain: (p) => p.x > 0,
    // ln y = ln a + b·ln x.
    initialGuess: (pts) => {
      const usable = pts.filter((p) => p.x > 0 && p.y > 0);
      if (usable.length < 2) return null;
      const lin = linearFit(usable.map((p) => ({ x: Math.log(p.x), y: Math.log(p.y) })));
      if (!lin) return null;
      return [Math.exp(lin.c), lin.m];
    },
    formatEquation: (p) => `y = ${fmt(p[0]!)}·x^${fmt(p[1]!)}`,
  },
  {
    id: 'logarithmic',
    label: 'Logarithmic',
    form: 'y = a + b·ln(x)',
    paramNames: ['a', 'b'],
    evaluate: (p, x) => p[0]! + p[1]! * Math.log(x),
    requires: 'every x value to be greater than zero',
    domain: (p) => p.x > 0,
    // Linear in its parameters, so this start is already the exact solution and
    // LM simply confirms it. Kept on the one code path rather than special-cased.
    initialGuess: (pts) => {
      const usable = pts.filter((p) => p.x > 0);
      if (usable.length < 2) return null;
      const lin = linearFit(usable.map((p) => ({ x: Math.log(p.x), y: p.y })));
      if (!lin) return null;
      return [lin.c, lin.m];
    },
    formatEquation: (p) => `y = ${fmt(p[0]!)}${signed(p[1]!)}·ln(x)`,
  },
  {
    id: 'gaussian',
    label: 'Gaussian peak',
    form: 'y = a·exp(−(x−b)² / 2c²)',
    paramNames: ['a', 'b', 'c'],
    evaluate: (p, x) => {
      const c = p[2]!;
      if (c === 0) return NaN;
      const d = x - p[1]!;
      return p[0]! * Math.exp(-(d * d) / (2 * c * c));
    },
    requires: 'a visible peak — at least three points',
    // Start from measured features: the tallest point is the peak, and the
    // spread of x weighted by y is the width.
    initialGuess: (pts) => {
      if (pts.length < 3) return null;
      let peak = pts[0]!;
      for (const p of pts) if (p.y > peak.y) peak = p;
      const weights = pts.map((p) => Math.max(p.y, 0));
      const wsum = weights.reduce((s, w) => s + w, 0);
      let c: number;
      if (wsum > 0) {
        let varSum = 0;
        pts.forEach((p, i) => {
          const d = p.x - peak.x;
          varSum += weights[i]! * d * d;
        });
        c = Math.sqrt(varSum / wsum);
      } else {
        c = 0;
      }
      if (!Number.isFinite(c) || c <= 0) {
        const xs = pts.map((p) => p.x);
        c = (Math.max(...xs) - Math.min(...xs)) / 4 || 1;
      }
      return [peak.y, peak.x, c];
    },
    formatEquation: (p) =>
      `y = ${fmt(p[0]!)}·exp(−(x${signed(-p[1]!)})² / 2·${fmt(p[2]!)}²)`,
  },
  {
    id: 'logistic',
    label: 'Logistic (S-curve)',
    form: 'y = a / (1 + e^(−(x−b)/c))',
    paramNames: ['a', 'b', 'c'],
    evaluate: (p, x) => {
      const c = p[2]!;
      if (c === 0) return NaN;
      return p[0]! / (1 + Math.exp(-(x - p[1]!) / c));
    },
    requires: 'at least three points spanning the rise',
    // Plateau from the largest y, midpoint from where y is nearest half that,
    // and a width a quarter of the x span — all read off the data.
    initialGuess: (pts) => {
      if (pts.length < 3) return null;
      const ys = pts.map((p) => p.y);
      const xs = pts.map((p) => p.x);
      const a = Math.max(...ys);
      const half = a / 2;
      let mid = pts[0]!;
      for (const p of pts) if (Math.abs(p.y - half) < Math.abs(mid.y - half)) mid = p;
      const span = Math.max(...xs) - Math.min(...xs);
      const c = span > 0 ? span / 8 : 1;
      return [a, mid.x, c];
    },
    formatEquation: (p) =>
      `y = ${fmt(p[0]!)} / (1 + e^(−(x${signed(-p[1]!)}) / ${fmt(p[2]!)}))`,
  },
];

export function findFitModel(id: string): FitModel | null {
  return FIT_MODELS.find((m) => m.id === id) ?? null;
}

export interface NonlinearFitResult {
  params: number[];
  /** Did it settle, or did it run out of iterations? Reported, never hidden. */
  converged: boolean;
  iterations: number;
  /** Sum of squared residuals at the returned parameters. */
  sse: number;
}

function sumSquares(
  model: FitModel,
  params: readonly number[],
  pts: readonly Point2D[]
): number {
  let s = 0;
  for (const p of pts) {
    const r = p.y - model.evaluate(params, p.x);
    if (!Number.isFinite(r)) return Number.POSITIVE_INFINITY;
    s += r * r;
  }
  return s;
}

/**
 * Levenberg–Marquardt with a numeric Jacobian.
 *
 * Returns null only when the very first evaluation is unusable (a start that
 * produces no finite residual at all); otherwise it always returns the best
 * parameters it reached, with `converged` saying whether it settled. That
 * distinction is the point — the caller must be able to tell "this is the answer"
 * from "this is where it got to".
 */
export function levenbergMarquardt(
  model: FitModel,
  points: readonly Point2D[],
  start: readonly number[],
  opts: { maxIterations?: number; tolerance?: number } = {}
): NonlinearFitResult | null {
  const maxIterations = opts.maxIterations ?? 200;
  const tolerance = opts.tolerance ?? 1e-10;
  const n = start.length;

  let params = [...start];
  let sse = sumSquares(model, params, points);
  if (!Number.isFinite(sse)) return null;

  let lambda = 1e-3;
  let iterations = 0;
  let converged = false;

  for (; iterations < maxIterations; iterations++) {
    // Numeric Jacobian by central differences. The step is scaled to each
    // parameter so a large and a small parameter are perturbed comparably.
    const J: number[][] = [];
    const residuals: number[] = [];
    let bad = false;
    for (const p of points) {
      const base = model.evaluate(params, p.x);
      if (!Number.isFinite(base)) { bad = true; break; }
      residuals.push(p.y - base);
      const row: number[] = [];
      for (let j = 0; j < n; j++) {
        const h = Math.max(Math.abs(params[j]!) * 1e-6, 1e-8);
        const up = [...params]; up[j] = up[j]! + h;
        const dn = [...params]; dn[j] = dn[j]! - h;
        const fu = model.evaluate(up, p.x);
        const fd = model.evaluate(dn, p.x);
        if (!Number.isFinite(fu) || !Number.isFinite(fd)) { bad = true; break; }
        row.push((fu - fd) / (2 * h));
      }
      if (bad) break;
      J.push(row);
    }
    if (bad) break;

    // JᵀJ and Jᵀr
    const JtJ: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    const Jtr: number[] = new Array<number>(n).fill(0);
    for (let i = 0; i < J.length; i++) {
      for (let a = 0; a < n; a++) {
        Jtr[a] = Jtr[a]! + J[i]![a]! * residuals[i]!;
        for (let b = 0; b < n; b++) JtJ[a]![b] = JtJ[a]![b]! + J[i]![a]! * J[i]![b]!;
      }
    }

    // Damped normal equations: (JᵀJ + λ·diag(JᵀJ))·δ = Jᵀr. Damping the
    // DIAGONAL rather than adding λI keeps the step scale-aware.
    let stepped = false;
    for (let attempt = 0; attempt < 12; attempt++) {
      const A = JtJ.map((row, a) =>
        row.map((v, b) => (a === b ? v + lambda * (v === 0 ? 1 : Math.abs(v)) : v))
      );
      let delta: number[];
      try {
        delta = solveLinearSystem(A, Jtr);
      } catch {
        // Singular even when damped — damp harder rather than give up.
        lambda *= 10;
        continue;
      }
      const trial = params.map((v, i) => v + delta[i]!);
      const trialSse = sumSquares(model, trial, points);
      if (Number.isFinite(trialSse) && trialSse < sse) {
        const improvement = sse - trialSse;
        params = trial;
        const relative = improvement / (sse || 1);
        sse = trialSse;
        lambda = Math.max(lambda / 10, 1e-12);
        stepped = true;
        if (relative < tolerance) converged = true;
        break;
      }
      lambda *= 10;
      if (lambda > 1e12) break;
    }

    if (converged) { iterations++; break; }
    if (!stepped) {
      // No downhill step exists from here: this is a minimum as far as LM can
      // tell, which counts as settled rather than as a failure.
      converged = true;
      iterations++;
      break;
    }
  }

  return { params, converged, iterations, sse };
}

/** Goodness of fit for an arbitrary model.
 *
 * ⚑ R² is reported because readers expect it, but for a NONLINEAR model it is
 * not a proportion of explained variance and is not bounded below by 0 — a bad
 * fit can produce a negative value. The RMS residual is the honest headline
 * number and is in the data's own units. */
export function modelFitStats(
  model: FitModel,
  params: readonly number[],
  points: readonly Point2D[]
): { rSquared?: number; rms: number } {
  const meanY = points.reduce((s, p) => s + p.y, 0) / points.length;
  let ssRes = 0;
  let ssTot = 0;
  for (const p of points) {
    const r = p.y - model.evaluate(params, p.x);
    ssRes += r * r;
    ssTot += (p.y - meanY) * (p.y - meanY);
  }
  return {
    // ⚑ ABSENT when there is no variation to explain, never 1. With every y
    // identical, SStot is exactly 0 (each point IS the mean) and R² divides by
    // zero -- it has no value, and the 1 that used to be returned was a written-in
    // default, not arithmetic. Reporting it made a flat series look like a perfect
    // fit beside a red "did not settle". RMS below is honest here and needs no
    // reference variance, which is why it is the number to read (see this
    // function's own note on R² being a courtesy for a nonlinear model).
    ...(ssTot > 0 ? { rSquared: 1 - ssRes / ssTot } : {}),
    rms: Math.sqrt(ssRes / points.length),
  };
}

export interface FitModelOutcome {
  params: number[];
  rSquared?: number;
  rms: number;
  converged: boolean;
  iterations: number;
  equation: string;
}

/**
 * Fit one named model to points, start to finish.
 *
 * Refuses — naming what the model needs — rather than fitting a subset of the
 * data behind the user's back. Dropping the points a model cannot use would
 * silently change what was fitted, and the number would look just as confident.
 */
export function fitModel(
  model: FitModel,
  points: readonly Point2D[]
): FitModelOutcome | { error: string } {
  if (points.length < model.paramNames.length) {
    return {
      error: `Not enough points for ${model.label} — need at least ${model.paramNames.length}, have ${points.length}.`,
    };
  }
  // Domain first: a point the model cannot be evaluated at makes every residual
  // non-finite, and refusing with the REASON beats "could not be fitted".
  // domainRequires (falling back to requires) states what THIS gate actually
  // checks -- see the field's own doc for why that can differ from what
  // initialGuess needs (power law's own case).
  if (model.domain && !points.every((p) => model.domain!(p))) {
    return { error: `${model.label} needs ${model.domainRequires ?? model.requires}.` };
  }
  const start = model.initialGuess(points);
  if (!start) {
    return { error: `${model.label} needs ${model.requires}.` };
  }
  const result = levenbergMarquardt(model, points, start);
  if (!result) {
    return { error: `${model.label} could not be fitted to these points.` };
  }
  const stats = modelFitStats(model, result.params, points);
  if (!Number.isFinite(stats.rms)) {
    return { error: `${model.label} could not be fitted to these points.` };
  }
  return {
    params: result.params,
    rSquared: stats.rSquared,
    rms: stats.rms,
    converged: result.converged,
    iterations: result.iterations,
    equation: model.formatEquation(result.params),
  };
}
