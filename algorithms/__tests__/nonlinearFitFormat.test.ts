import { describe, expect, it } from 'vitest';
import { findFitModel } from '../nonlinearFit.js';

/**
 * The two halves of `nonlinearFit.ts` the existing suite does not reach: the
 * EQUATION STRING and the INITIAL GUESS.
 *
 * ⚑ WHY THIS FILE EXISTS. `nonlinearFit.ts` carries 168 mutants no test
 * notices — the most of any file outside `calibrationSession.ts` — and they
 * cluster in exactly these two places, because the existing tests all assert
 * on *fitted parameters* and never on the string beside them or on where the
 * search started.
 *
 * Both matter for tenet 1 in their own way:
 *
 * - The equation is the one part of a fit a user COPIES OUT into a paper. A
 *   number rendered wrong there is a wrong number published, and no fit
 *   assertion anywhere would catch it.
 * - The guess is not cosmetic. Levenberg–Marquardt finds *a* local minimum,
 *   and which one depends entirely on where it starts. The guesses here are
 *   built from MEASURED features of the data (the tallest point, the y-weighted
 *   spread, the half-height crossing) precisely so the start is a reading and
 *   not a default — a guess that quietly degrades to a constant still fits
 *   most textbook curves, so the failure hides.
 */

const gaussian = findFitModel('gaussian')!;
const logistic = findFitModel('logistic')!;
const exponential = findFitModel('exponential')!;
const power = findFitModel('power')!;
const logarithmic = findFitModel('logarithmic')!;

describe('the equation string a user copies out', () => {
  it('shows five significant digits and no trailing zeros', () => {
    // toPrecision(5) alone would render 2 as "2.0000"; the Number() round-trip
    // is what strips it back. Both halves are load-bearing.
    expect(exponential.formatEquation([2, 0.5])).toBe('y = 2·e^(0.5·x)');
    expect(exponential.formatEquation([3.14159265, 1])).toBe('y = 3.1416·e^(1·x)');
  });

  it('⚑ writes zero as "0", not as scientific notation', () => {
    // The `n !== 0` guard: 0 has magnitude below 1e-4, so without it every
    // zero parameter would print as "0.0000e+0" — technically true, and
    // unreadable in a caption.
    expect(exponential.formatEquation([0, 0])).toBe('y = 0·e^(0·x)');
  });

  it('switches to scientific notation for very small and very large magnitudes', () => {
    // A digitized figure spans real physical scales; 0.0000123 rendered at
    // five significant digits is fine, but 1230000 becomes "1230000" and
    // 0.00000123 becomes "0.00000123" — both lose the reader.
    expect(exponential.formatEquation([1.23e-5, 1])).toBe('y = 1.2300e-5·e^(1·x)');
    expect(exponential.formatEquation([1.23e7, 1])).toBe('y = 1.2300e+7·e^(1·x)');
  });

  it('treats each threshold as the code states it, on both sides', () => {
    // The two comparisons are NOT symmetric and the boundary values say so:
    // 1e-4 is `< 1e-4`-false and stays plain, while 1e6 is `>= 1e6`-true and
    // goes scientific. A mutated `<=`/`>` flips exactly one of these.
    expect(exponential.formatEquation([1e-4, 999940])).toBe('y = 0.0001·e^(999940·x)');
    expect(exponential.formatEquation([9.9e-5, 1e6])).toBe('y = 9.9000e-5·e^(1.0000e+6·x)');
  });

  it('uses the magnitude, so a large NEGATIVE number is scientific too', () => {
    // `Math.abs` — without it, −1.23e7 tests as "less than 1e6" and prints in
    // full, while −1.23e-5 tests as "not less than 1e-4" and does the same.
    expect(exponential.formatEquation([-1.23e7, -1.23e-5])).toBe('y = -1.2300e+7·e^(-1.2300e-5·x)');
  });

  it('prints a non-finite parameter as the word, rather than crashing on it', () => {
    // A fit that blew up must still render; `toExponential` on Infinity throws
    // nothing but reads as "Infinity" anyway, and NaN.toPrecision is useless.
    expect(exponential.formatEquation([NaN, Infinity])).toBe('y = NaN·e^(Infinity·x)');
  });
});

describe('the sign of an added term reads as arithmetic', () => {
  it('writes a negative term as a subtraction, never "+ -"', () => {
    expect(logarithmic.formatEquation([1.5, -2.75])).toBe('y = 1.5 − 2.75·ln(x)');
    expect(logarithmic.formatEquation([1.5, 2.75])).toBe('y = 1.5 + 2.75·ln(x)');
  });

  it('⚑ writes zero as an ADDITION, not as "− 0"', () => {
    // The `n >= 0` boundary. "y = 1.5 − 0·ln(x)" is not wrong arithmetic, but
    // it reads as a negative coefficient at a glance.
    expect(logarithmic.formatEquation([1.5, 0])).toBe('y = 1.5 + 0·ln(x)');
  });

  it("negates the Gaussian's centre so the form matches the printed (x − b)", () => {
    // formatEquation passes `signed(-p[1])`: a peak AT x = 3 must print as
    // "(x − 3)", and a peak at x = −3 as "(x + 3)". Dropping the negation
    // silently mirrors every Gaussian equation about the y axis.
    expect(gaussian.formatEquation([4, 3, 1.25])).toBe('y = 4·exp(−(x − 3)² / 2·1.25²)');
    expect(gaussian.formatEquation([4, -3, 1.25])).toBe('y = 4·exp(−(x + 3)² / 2·1.25²)');
  });

  it('does the same for the logistic midpoint', () => {
    expect(logistic.formatEquation([8, 4, 0.9])).toBe('y = 8 / (1 + e^(−(x − 4) / 0.9))');
    expect(logistic.formatEquation([8, -4, 0.9])).toBe('y = 8 / (1 + e^(−(x + 4) / 0.9))');
  });

  it('every model renders its own form, so none is mislabelled in the panel', () => {
    expect(power.formatEquation([2.25, 1.7])).toBe('y = 2.25·x^1.7');
    expect(exponential.formatEquation([3.5, 0.4])).toBe('y = 3.5·e^(0.4·x)');
  });
});

/** Samples of a true Gaussian, so the seed can be compared with the answer. */
function gaussianSamples(a: number, b: number, c: number, xs: number[]) {
  return xs.map((x) => ({ x, y: a * Math.exp(-((x - b) * (x - b)) / (2 * c * c)) }));
}

describe("the Gaussian's guess is read off the data", () => {
  it('takes the peak from the TALLEST point, not the first or the middle one', () => {
    // The peak's height and position are both directly measurable, and the
    // scan must actually compare — mutated to always keep pts[0] it would
    // still fit any curve whose first point happens to be highest.
    const pts = [
      { x: 0, y: 1 },
      { x: 5, y: 9 },
      { x: 10, y: 2 },
    ];
    const g = gaussian.initialGuess(pts)!;
    expect(g[0]).toBe(9);
    expect(g[1]).toBe(5);
  });

  it('lands within a factor of two of a real width, rather than on a constant', () => {
    // The y-weighted spread. A guess that degraded to a fixed number would
    // still converge on this curve, so the assertion is on the GUESS itself.
    const pts = gaussianSamples(4.2, 3, 1.25, [0, 1, 2, 3, 4, 5, 6]);
    const c = gaussian.initialGuess(pts)![2]!;
    expect(c).toBeGreaterThan(1.25 / 2);
    expect(c).toBeLessThan(1.25 * 2);
  });

  it('tracks a WIDER curve to a wider guess', () => {
    const narrow = gaussian.initialGuess(gaussianSamples(4, 10, 1, [6, 8, 10, 12, 14]))![2]!;
    const wide = gaussian.initialGuess(gaussianSamples(4, 10, 4, [6, 8, 10, 12, 14]))![2]!;
    expect(wide).toBeGreaterThan(narrow);
  });

  it('⚑ falls back to a quarter of the x span when no y is positive', () => {
    // An all-negative trough: the weights are all clamped to 0, so the
    // weighted spread is undefined. Without the fallback c is 0, the model
    // evaluates to NaN everywhere, and the fit refuses a curve it could
    // have fitted.
    const pts = [
      { x: 0, y: -1 },
      { x: 4, y: -3 },
      { x: 8, y: -2 },
    ];
    const g = gaussian.initialGuess(pts)!;
    expect(g[2]).toBeCloseTo(2, 9); // span 8 / 4
    expect(Number.isFinite(gaussian.evaluate(g, 4))).toBe(true);
  });

  it('falls back again to 1 when the span is zero as well', () => {
    // Every point stacked on one x. `|| 1` is the last guard before a
    // divide-by-zero inside `evaluate`.
    const pts = [
      { x: 2, y: -1 },
      { x: 2, y: -2 },
      { x: 2, y: -3 },
    ];
    expect(gaussian.initialGuess(pts)![2]).toBe(1);
  });

  it('refuses to guess from fewer than three points, since it has three parameters', () => {
    expect(gaussian.initialGuess([{ x: 0, y: 1 }])).toBeNull();
    expect(
      gaussian.initialGuess([
        { x: 0, y: 1 },
        { x: 1, y: 2 },
      ])
    ).toBeNull();
    expect(
      gaussian.initialGuess([
        { x: 0, y: 1 },
        { x: 1, y: 2 },
        { x: 2, y: 1 },
      ])
    ).not.toBeNull();
  });
});

describe("the logistic's guess is read off the data", () => {
  it('takes the plateau from the largest y', () => {
    const pts = [
      { x: 0, y: 0.2 },
      { x: 4, y: 4 },
      { x: 8, y: 7.9 },
    ];
    expect(logistic.initialGuess(pts)![0]).toBe(7.9);
  });

  it('⚑ puts the midpoint at the HALF-HEIGHT crossing, not at the first point', () => {
    // The defining feature of an S-curve, and the one the LM search is least
    // able to recover on its own: started at the wrong end of the rise the fit
    // flattens instead of turning. Half of 8 is 4, so x = 5 is the crossing —
    // and it is neither the first point nor the middle of the x range.
    const pts = [
      { x: 0, y: 0.1 },
      { x: 5, y: 4.05 },
      { x: 6, y: 6 },
      { x: 20, y: 8 },
    ];
    expect(logistic.initialGuess(pts)![1]).toBe(5);
  });

  it('keeps the FIRST point when nothing is nearer the half-height', () => {
    // The strict `<` in the scan: on a tie the earlier point stands, which
    // keeps the guess independent of point order beyond the first.
    const pts = [
      { x: 1, y: 5 },
      { x: 2, y: 5 },
      { x: 3, y: 10 },
    ];
    expect(logistic.initialGuess(pts)![1]).toBe(1);
  });

  it('scales the width to the x span, so the rise is not assumed', () => {
    const narrow = logistic.initialGuess([
      { x: 0, y: 0 },
      { x: 4, y: 4 },
      { x: 8, y: 8 },
    ])![2]!;
    const wide = logistic.initialGuess([
      { x: 0, y: 0 },
      { x: 40, y: 4 },
      { x: 80, y: 8 },
    ])![2]!;
    expect(narrow).toBeCloseTo(1, 9); // 8 / 8
    expect(wide).toBeCloseTo(10, 9); // 80 / 8
  });

  it('falls back to a width of 1 when every point shares one x', () => {
    const pts = [
      { x: 3, y: 0 },
      { x: 3, y: 4 },
      { x: 3, y: 8 },
    ];
    const g = logistic.initialGuess(pts)!;
    expect(g[2]).toBe(1);
    expect(Number.isFinite(logistic.evaluate(g, 3))).toBe(true);
  });

  it('refuses to guess from fewer than three points', () => {
    expect(
      logistic.initialGuess([
        { x: 0, y: 1 },
        { x: 1, y: 2 },
      ])
    ).toBeNull();
  });
});

describe('a model with a degenerate width evaluates to NaN rather than to Infinity', () => {
  it('Gaussian: a zero width is refused at evaluation', () => {
    // Not a guard against the guess — LM can WALK a parameter to zero. NaN
    // makes the trial step fail its finite check and be rejected; Infinity
    // would compare as "not better" only by luck.
    expect(Number.isNaN(gaussian.evaluate([1, 0, 0], 1))).toBe(true);
  });

  it('logistic: the same', () => {
    expect(Number.isNaN(logistic.evaluate([1, 0, 0], 1))).toBe(true);
  });
});
