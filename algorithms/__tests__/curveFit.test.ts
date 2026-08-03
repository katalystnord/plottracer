import { describe, it, expect } from 'vitest';
import {
  fitPolynomial,
  evaluatePolynomial,
  computeFitStats,
  formatPolynomial,
  solveLinearSystem,
} from '../curveFit.js';

describe('curveFit', () => {
  // Same exact 8-point parabola y = 0.3*(x-5)^2 + 1 verified live in the
  // app this session (Curve Fit feature testing) — exact recovery
  // expected: coefficients [8.5, -3, 0.3], R²=1.
  const points = Array.from({ length: 8 }, (_, i) => {
    const x = i * (10 / 7);
    const y = 0.3 * (x - 5) * (x - 5) + 1;
    return { x, y };
  });

  it('recovers the exact underlying polynomial coefficients', () => {
    const coeffs = fitPolynomial(points, 2);
    expect(coeffs[0]).toBeCloseTo(8.5, 6);
    expect(coeffs[1]).toBeCloseTo(-3, 6);
    expect(coeffs[2]).toBeCloseTo(0.3, 6);
  });

  it('reports R² = 1 for an exact fit', () => {
    const coeffs = fitPolynomial(points, 2);
    const stats = computeFitStats(points, coeffs);
    expect(stats.rSquared).toBeCloseTo(1, 8);
    expect(stats.rms).toBeLessThan(1e-9);
  });

  it('evaluatePolynomial matches the fitted curve at a known point', () => {
    const coeffs = fitPolynomial(points, 2);
    expect(evaluatePolynomial(coeffs, 5)).toBeCloseTo(1, 6); // vertex of the parabola
  });

  it('throws on a singular system (not enough distinct points for the degree)', () => {
    expect(() => fitPolynomial([{ x: 1, y: 1 }], 2)).toThrow(/Singular matrix/);
  });

  it('formatPolynomial produces a readable equation string', () => {
    const formatted = formatPolynomial([8.5, -3, 0.3]);
    expect(formatted).toContain('y = ');
    expect(formatted).toContain('x^2');
  });
});

describe('R² on a series with no spread (v1.5.1)', () => {
  // The same `ssTot > 0 ? … : 1` fallback the nonlinear module copied from here.
  // A horizontal baseline is ordinary in a real figure, not a contrived input.
  it('reports NO R² for a flat series, but still reports RMS', () => {
    const flat = [1, 2, 3, 4].map((x) => ({ x, y: 5 }));
    const stats = computeFitStats(flat, fitPolynomial(flat, 1));
    expect(stats.rSquared).toBeUndefined();
    expect(Number.isFinite(stats.rms)).toBe(true);
  });

  it('still reports a real R² when the data varies', () => {
    const sloped = [1, 2, 3, 4].map((x) => ({ x, y: 2 * x + 1 }));
    const stats = computeFitStats(sloped, fitPolynomial(sloped, 1));
    expect(stats.rSquared).toBeGreaterThan(0.99);
  });
});

describe('a fit that overflowed must refuse, not return a curve', () => {
  // The normal equations raise x to the 2*degree power. Past a magnitude that
  // depends on the degree, XtX overflows to Infinity, the elimination turns
  // that into NaN -- and the singular-matrix guard CANNOT SEE IT, because
  // `Math.abs(NaN) < 1e-10` is false. NaN comparisons are always false, so the
  // one refusal standing between the user and a meaningless curve is skipped by
  // exactly the input that most needs it.
  //
  // Why it must refuse rather than hand back NaN: a dataset's curve fit is
  // stored in its metadata, and `Dataset.setMetadata` deep-clones through
  // `JSON.parse(JSON.stringify(...))`, which rewrites NaN as **null**. Reload
  // the project and `evaluatePolynomial` does arithmetic on nulls, where
  // `null * x === 0` -- so the failure is laundered into a clean flat line
  // through y = 0, drawn on the figure as if it were the answer.
  // See feedback: "a drawn curve is read as an answer".

  const bigX = Array.from({ length: 15 }, (_, i) => ({
    x: 1e18 + i * 1e17,
    y: i * 3 + 1,
  }));

  it('never returns a non-finite coefficient', () => {
    let coefficients: number[] | null = null;
    try {
      coefficients = fitPolynomial(bigX, 9);
    } catch {
      // Refusing is the correct outcome.
    }
    if (coefficients !== null) {
      expect(coefficients.every((c) => Number.isFinite(c))).toBe(true);
    }
  });

  it('refuses a degree-9 fit over x ~1e18 instead of returning NaN', () => {
    expect(() => fitPolynomial(bigX, 9)).toThrow();
  });

  it('does not blame the point count — that would send the user to fix the wrong thing', () => {
    // 15 well-separated distinct points is plenty for degree 9. Reporting
    // "not enough distinct points" here is a wrong diagnosis, the same
    // tenet-7 defect as the map axes' `checkValues` message.
    expect(() => fitPolynomial(bigX, 9)).not.toThrow(/not enough distinct points/);
  });

  it('names the magnitude as the requirement, so the user can act on it', () => {
    expect(() => fitPolynomial(bigX, 9)).toThrow(/too large|overflow|magnitude|rescale/i);
  });

  it('still fits the same shape once the x values are shifted near zero', () => {
    // The refusal must not be over-reach: the data is fittable, the
    // MAGNITUDE is the problem, and the message says so.
    const shifted = bigX.map((p, i) => ({ x: i, y: p.y }));
    const coefficients = fitPolynomial(shifted, 9);
    expect(coefficients.every((c) => Number.isFinite(c))).toBe(true);
  });

  it('solveLinearSystem refuses a non-finite system rather than solving it', () => {
    // The model has more than one entrance: the solver is exported, so the
    // guard belongs here too and not only in fitPolynomial.
    expect(() =>
      solveLinearSystem(
        [
          [Number.POSITIVE_INFINITY, 1],
          [1, 1],
        ],
        [1, 2],
      ),
    ).toThrow();
  });

  it('ordinary and date axes are unaffected', () => {
    // The refusal must not fire on real figures. An epoch-millisecond date
    // axis (~1.7e12) is the largest ordinary case this app produces.
    const dates = Array.from({ length: 15 }, (_, i) => ({
      x: 1.7e12 + i * 1e10,
      y: Math.sin(i) * 10 + 50,
    }));
    expect(fitPolynomial(dates, 9).every((c) => Number.isFinite(c))).toBe(true);
    const ordinary = Array.from({ length: 15 }, (_, i) => ({ x: i * 7, y: i * i }));
    expect(fitPolynomial(ordinary, 5).every((c) => Number.isFinite(c))).toBe(true);
  });
});
