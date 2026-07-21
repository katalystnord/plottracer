import { describe, it, expect } from 'vitest';
import { fitPolynomial, evaluatePolynomial, computeFitStats, formatPolynomial } from '../curveFit.js';

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
