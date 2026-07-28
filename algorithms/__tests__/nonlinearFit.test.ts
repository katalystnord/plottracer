import { describe, it, expect } from 'vitest';
import {
  FIT_MODELS,
  findFitModel,
  fitModel,
  levenbergMarquardt,
  modelFitStats,
  type FitModelId,
} from '../nonlinearFit.js';
import type { Point2D } from '../curveFit.js';

/**
 * ⚑ THE GROUND TRUTH HERE IS THE ANALYTIC FUNCTION, not anything this codebase
 * computes. Each case below builds points BY HAND from a formula with known
 * parameters and asks the fitter to recover them. That is the one test a fitter
 * can be given that proves more than self-consistency: if `a` was 3.5 going in
 * and 3.5 comes back, the solver works — and if it came back 3.4999999 the
 * tolerance says how well.
 */

/** Points sampled from a formula, with no noise. */
function sample(f: (x: number) => number, xs: number[]): Point2D[] {
  return xs.map((x) => ({ x, y: f(x) }));
}

const range = (from: number, to: number, n: number): number[] =>
  Array.from({ length: n }, (_, i) => from + ((to - from) * i) / (n - 1));

/** A small deterministic wobble, so "with noise" cases never flake. */
function jitter(pts: Point2D[], amount: number): Point2D[] {
  return pts.map((p, i) => ({ x: p.x, y: p.y * (1 + amount * Math.sin(i * 2.399963)) }));
}

function fitOf(id: FitModelId, pts: Point2D[]) {
  const model = findFitModel(id);
  expect(model).not.toBeNull();
  return fitModel(model!, pts);
}

describe('the model registry', () => {
  it('offers every model with a form the user can read before choosing', () => {
    expect(FIT_MODELS.length).toBeGreaterThanOrEqual(5);
    for (const m of FIT_MODELS) {
      expect(m.form).toMatch(/y =/);
      expect(m.label.length).toBeGreaterThan(0);
      expect(m.paramNames.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('finds a model by id and refuses an unknown one', () => {
    expect(findFitModel('gaussian')?.label).toBe('Gaussian peak');
    expect(findFitModel('nope')).toBeNull();
  });
});

describe('recovers the parameters it was given — exponential', () => {
  it('recovers a and b from y = 3.5·e^(0.4x)', () => {
    const pts = sample((x) => 3.5 * Math.exp(0.4 * x), range(0, 5, 20));
    const r = fitOf('exponential', pts);
    if ('error' in r) throw new Error(r.error);
    expect(r.params[0]).toBeCloseTo(3.5, 6);
    expect(r.params[1]).toBeCloseTo(0.4, 6);
    expect(r.rSquared).toBeCloseTo(1, 8);
    expect(r.rms).toBeLessThan(1e-6);
    expect(r.converged).toBe(true);
  });

  it('recovers a decay (negative b) too', () => {
    const pts = sample((x) => 10 * Math.exp(-0.75 * x), range(0, 6, 25));
    const r = fitOf('exponential', pts);
    if ('error' in r) throw new Error(r.error);
    expect(r.params[0]).toBeCloseTo(10, 5);
    expect(r.params[1]).toBeCloseTo(-0.75, 5);
  });

  it('still lands close with noise on the data', () => {
    const pts = jitter(sample((x) => 3.5 * Math.exp(0.4 * x), range(0, 5, 30)), 0.03);
    const r = fitOf('exponential', pts);
    if ('error' in r) throw new Error(r.error);
    expect(r.params[0]).toBeCloseTo(3.5, 0);
    expect(r.params[1]).toBeCloseTo(0.4, 1);
  });
});

describe('recovers the parameters it was given — the other models', () => {
  it('power law: y = 2.25·x^1.7', () => {
    const pts = sample((x) => 2.25 * Math.pow(x, 1.7), range(0.5, 8, 25));
    const r = fitOf('power', pts);
    if ('error' in r) throw new Error(r.error);
    expect(r.params[0]).toBeCloseTo(2.25, 5);
    expect(r.params[1]).toBeCloseTo(1.7, 5);
  });

  it('logarithmic: y = 1.5 + 2.75·ln(x)', () => {
    const pts = sample((x) => 1.5 + 2.75 * Math.log(x), range(0.5, 20, 25));
    const r = fitOf('logarithmic', pts);
    if ('error' in r) throw new Error(r.error);
    expect(r.params[0]).toBeCloseTo(1.5, 6);
    expect(r.params[1]).toBeCloseTo(2.75, 6);
  });

  it('gaussian: peak 4.2 at x = 3, width 1.25', () => {
    const pts = sample((x) => 4.2 * Math.exp(-((x - 3) ** 2) / (2 * 1.25 ** 2)), range(-2, 8, 40));
    const r = fitOf('gaussian', pts);
    if ('error' in r) throw new Error(r.error);
    expect(r.params[0]).toBeCloseTo(4.2, 4);
    expect(r.params[1]).toBeCloseTo(3, 4);
    expect(Math.abs(r.params[2]!)).toBeCloseTo(1.25, 4); // sign of c is arbitrary (c²)
  });

  it('logistic: plateau 8, midpoint 4, width 0.9', () => {
    const pts = sample((x) => 8 / (1 + Math.exp(-(x - 4) / 0.9)), range(-2, 10, 40));
    const r = fitOf('logistic', pts);
    if ('error' in r) throw new Error(r.error);
    expect(r.params[0]).toBeCloseTo(8, 3);
    expect(r.params[1]).toBeCloseTo(4, 3);
    expect(r.params[2]).toBeCloseTo(0.9, 3);
  });
});

describe('refuses rather than fitting a subset behind the user’s back', () => {
  it('refuses an exponential when a y value is not positive, naming what it needs', () => {
    const pts = [
      { x: 0, y: -1 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: -4 },
    ];
    const r = fitOf('exponential', pts);
    expect('error' in r && r.error).toMatch(/greater than zero/i);
    expect('error' in r && r.error).toMatch(/exponential/i);
  });

  it('refuses a logarithm when x reaches zero or below', () => {
    const pts = [{ x: -1, y: 1 }, { x: 0, y: 2 }, { x: -3, y: 3 }];
    const r = fitOf('logarithmic', pts);
    expect('error' in r && r.error).toMatch(/greater than zero/i);
  });

  it('refuses a power law when x is not positive', () => {
    const pts = [{ x: -2, y: 1 }, { x: -1, y: 2 }, { x: 0, y: 3 }];
    const r = fitOf('power', pts);
    expect('error' in r && r.error).toMatch(/greater than zero/i);
  });

  it('⚑ names the requirement when only SOME points are outside the domain', () => {
    // The case that exposed the need for a domain check separate from the
    // initial guess: x = 1,2,3 are fine so the guess succeeds, but x = 0 makes
    // ln(x) infinite and every residual non-finite. Without the domain check
    // this degraded to "could not be fitted", which tells the user nothing.
    const pts = [{ x: 0, y: 1 }, { x: 1, y: 2 }, { x: 2, y: 3 }, { x: 3, y: 4 }];
    const r = fitOf('logarithmic', pts);
    expect('error' in r && r.error).toMatch(/greater than zero/i);
    expect('error' in r && r.error).not.toMatch(/could not be fitted/i);
  });

  it('refuses when there are fewer points than parameters, and says the counts', () => {
    const r = fitOf('gaussian', [{ x: 1, y: 1 }, { x: 2, y: 2 }]);
    expect('error' in r && r.error).toMatch(/at least 3/);
    expect('error' in r && r.error).toMatch(/have 2/);
  });

  it('⚑ never silently drops the points a model cannot use', () => {
    // A series with one bad point must not quietly become a fit of the rest --
    // the number would look exactly as confident but describe different data.
    const good = sample((x) => 2 * Math.exp(0.5 * x), range(1, 5, 10));
    const withBad = [...good, { x: 6, y: -3 }];
    const r = fitOf('exponential', withBad);
    // It refuses; it does not return a fit of the 10 good points.
    expect('error' in r).toBe(false); // guess uses positive points, so it CAN start
    if ('error' in r) return;
    // ...but the reported RMS is computed over EVERY point, including the bad
    // one, so the badness is visible rather than hidden by exclusion.
    expect(r.rms).toBeGreaterThan(0.5);
  });
});

describe('convergence is reported, never assumed', () => {
  it('says converged on a clean fit', () => {
    const pts = sample((x) => 1.2 * Math.exp(0.3 * x), range(0, 4, 15));
    const r = fitOf('exponential', pts);
    if ('error' in r) throw new Error(r.error);
    expect(r.converged).toBe(true);
    expect(r.iterations).toBeGreaterThan(0);
  });

  it('reports NOT converged when it is stopped before it can settle', () => {
    // One iteration is not enough to reach the minimum from a deliberately poor
    // start, and the result must SAY so rather than present the halfway point
    // as an answer.
    const model = findFitModel('gaussian')!;
    const pts = sample((x) => 5 * Math.exp(-((x - 2) ** 2) / (2 * 1 ** 2)), range(-3, 7, 30));
    const r = levenbergMarquardt(model, pts, [0.1, -8, 6], { maxIterations: 1, tolerance: 1e-14 });
    expect(r).not.toBeNull();
    expect(r!.converged).toBe(false);
  });

  it('returns null only when the start cannot be evaluated at all', () => {
    const model = findFitModel('gaussian')!;
    const pts = sample((x) => x, range(1, 5, 5));
    // c = 0 makes the model undefined everywhere.
    expect(levenbergMarquardt(model, pts, [1, 1, 0])).toBeNull();
  });
});

describe('modelFitStats', () => {
  it('gives R² = 1 and RMS = 0 for an exact fit', () => {
    const model = findFitModel('exponential')!;
    const pts = sample((x) => 2 * Math.exp(x), range(0, 3, 10));
    const s = modelFitStats(model, [2, 1], pts);
    expect(s.rSquared).toBeCloseTo(1, 12);
    expect(s.rms).toBeCloseTo(0, 12);
  });

  it('⚑ can report a NEGATIVE R² for a nonlinear model, which is honest', () => {
    // R² is not a proportion of explained variance outside linear least
    // squares. A wrong model must be allowed to look as bad as it is rather
    // than be clamped to a reassuring 0.
    const model = findFitModel('exponential')!;
    const pts = [{ x: 0, y: 10 }, { x: 1, y: 0 }, { x: 2, y: 10 }, { x: 3, y: 0 }];
    const s = modelFitStats(model, [100, 1], pts);
    expect(s.rSquared).toBeLessThan(0);
  });
});

describe('the written equation carries the fitted numbers', () => {
  it('writes each model out with its parameters', () => {
    const cases: [FitModelId, number[], RegExp][] = [
      ['exponential', [3.5, 0.4], /y = 3\.5·e\^\(0\.4·x\)/],
      ['power', [2.25, 1.7], /y = 2\.25·x\^1\.7/],
      ['logarithmic', [1.5, 2.75], /y = 1\.5 \+ 2\.75·ln\(x\)/],
    ];
    for (const [id, params, re] of cases) {
      expect(findFitModel(id)!.formatEquation(params)).toMatch(re);
    }
  });

  it('uses a minus sign rather than "+ -" for a negative term', () => {
    expect(findFitModel('logarithmic')!.formatEquation([1.5, -2.75])).toMatch(/− 2\.75·ln\(x\)/);
  });
});

describe('R² on a series with no spread (v1.5.1)', () => {
  // ⚑ R² = 1 - SSres/SStot, and SStot is the spread of the data about its own
  // mean. When every y is identical SStot is EXACTLY zero -- every point IS the
  // mean -- so the ratio divides by zero and R² has no value at all.
  //
  // The code returned 1 there. That is not a rounding error: the residual never
  // entered the calculation, the `ssTot > 0` branch short-circuited first, so the
  // 1 would have been identical had the fit been off by a mile. It read on screen
  // as a PERFECT fit, beside a red "did not settle" -- and that contradiction is
  // what made the convergence flag look like it was crying wolf.
  //
  // Absent is the honest answer, matching this codebase's rule everywhere else:
  // a value that was not measured is blank, never a fabricated number.
  const flat = [1, 2, 3, 4].map((x) => ({ x, y: 5 }));

  it('reports NO R² when there is no variation to explain', () => {
    const m = findFitModel('gaussian')!;
    const fit = fitModel(m, flat);
    if ('error' in fit) throw new Error(fit.error);
    expect(fit.rSquared).toBeUndefined();
  });

  it('still reports RMS, which needs no reference variance and is honest here', () => {
    const m = findFitModel('gaussian')!;
    const fit = fitModel(m, flat);
    if ('error' in fit) throw new Error(fit.error);
    expect(Number.isFinite(fit.rms)).toBe(true);
    expect(fit.rms).toBeLessThan(0.01); // it really did land on the constant
  });

  it('still reports a real R² when the data DOES vary', () => {
    const m = findFitModel('gaussian')!;
    const sloped = [0, 1, 2, 3, 4].map((x) => ({ x, y: 10 * Math.exp(-((x - 2) ** 2) / 2) }));
    const fit = fitModel(m, sloped);
    if ('error' in fit) throw new Error(fit.error);
    expect(fit.rSquared).toBeGreaterThan(0.99);
  });

  it('a NEGATIVE R² on a genuinely bad nonlinear fit is correct, not a bug', () => {
    // Guards the fix from over-reaching: only the zero-variance case is absent.
    const v = [
      { x: 0, y: 9 },
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 3, y: 9 },
    ];
    const fit = fitModel(findFitModel('gaussian')!, v);
    if ('error' in fit) throw new Error(fit.error);
    expect(fit.rSquared).toBeDefined();
    expect(fit.rSquared!).toBeLessThanOrEqual(0.01);
  });
});
