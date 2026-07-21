/**
 * Faithful TypeScript port of the pure functions from
 * ui-patches/engauge-algos.js's Curve Fitting section (built 2026-07,
 * clean-room reimplementation of the same "naive" normal-equations
 * approach Engauge itself uses — see that file's header for the original
 * provenance note). Ported per CLAUDE.md's Step 1 scope.
 */

import type { Dataset } from '../core/dataset.js';
import type { AnyAxes } from '../core/plotData.js';

export interface Point2D {
  x: number;
  y: number;
}

export const CURVE_FIT_MAX_DEGREE = 9;

/**
 * Solve A*x = b via Gaussian elimination with partial pivoting.
 * Throws on a singular (or near-singular) matrix rather than guessing at
 * a reduced-order fit.
 */
export function solveLinearSystem(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => row.concat([b[i]!]));

  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r]![col]!) > Math.abs(M[pivotRow]![col]!)) pivotRow = r;
    }
    if (Math.abs(M[pivotRow]![col]!) < 1e-10) {
      throw new Error('Singular matrix — not enough distinct points for this degree.');
    }
    if (pivotRow !== col) {
      const tmp = M[col]!;
      M[col] = M[pivotRow]!;
      M[pivotRow] = tmp;
    }
    for (let r2 = col + 1; r2 < n; r2++) {
      const factor = M[r2]![col]! / M[col]![col]!;
      for (let c = col; c <= n; c++) M[r2]![c] = M[r2]![c]! - factor * M[col]![c]!;
    }
  }

  const x = new Array<number>(n);
  for (let i = n - 1; i >= 0; i--) {
    let sum = M[i]![n]!;
    for (let j = i + 1; j < n; j++) sum -= M[i]![j]! * x[j]!;
    x[i] = sum / M[i]![i]!;
  }
  return x;
}

/** points: [{x,y}, ...]. Returns coefficients [a0, a1, ..., aDegree] for y = a0 + a1*x + ... + aDegree*x^degree. */
export function fitPolynomial(points: Point2D[], degree: number): number[] {
  const n = degree + 1;
  const XtX: number[][] = [];
  const Xty: number[] = [];
  for (let i = 0; i < n; i++) {
    XtX.push(new Array(n).fill(0));
    Xty.push(0);
  }
  points.forEach((p) => {
    const powers = new Array<number>(2 * n - 1);
    powers[0] = 1;
    for (let k = 1; k < powers.length; k++) powers[k] = powers[k - 1]! * p.x;
    for (let r = 0; r < n; r++) {
      Xty[r] = Xty[r]! + powers[r]! * p.y;
      for (let c = 0; c < n; c++) XtX[r]![c] = XtX[r]![c]! + powers[r + c]!;
    }
  });
  return solveLinearSystem(XtX, Xty);
}

export function evaluatePolynomial(coefficients: number[], x: number): number {
  let y = 0;
  for (let i = coefficients.length - 1; i >= 0; i--) y = y * x + coefficients[i]!;
  return y;
}

export interface FitStats {
  rSquared: number;
  rms: number;
}

export function computeFitStats(points: Point2D[], coefficients: number[]): FitStats {
  const meanY = points.reduce((s, p) => s + p.y, 0) / points.length;
  let ssRes = 0;
  let ssTot = 0;
  points.forEach((p) => {
    const resid = p.y - evaluatePolynomial(coefficients, p.x);
    ssRes += resid * resid;
    ssTot += (p.y - meanY) * (p.y - meanY);
  });
  return {
    rSquared: ssTot > 0 ? 1 - ssRes / ssTot : 1,
    rms: Math.sqrt(ssRes / points.length),
  };
}

/**
 * Gathers {x, y} data-space points for fitting. For datasets with point
 * groups (Error Bar Groups), only the primary group (index 0, "Value") is
 * included — otherwise the Upper/Lower bound points would be fit as if
 * they were independent curve samples.
 */
export function getFitPoints(dataset: Dataset, axes: AnyAxes): Point2D[] {
  const hasGroups = dataset.hasPointGroups();
  const pts: Point2D[] = [];
  for (let i = 0; i < dataset.getCount(); i++) {
    if (hasGroups) {
      const tupleIdx = dataset.getTupleIndex(i);
      const groupIdx = dataset.getPointGroupIndexInTuple(tupleIdx, i);
      if (groupIdx !== 0) continue;
    }
    const px = dataset.getPixel(i);
    const d = axes.pixelToData(px.x, px.y);
    pts.push({ x: d[0]!, y: d[1]! });
  }
  return pts;
}

export function formatPolynomial(coefficients: number[]): string {
  const terms = coefficients.map((c, i) => {
    if (i === 0) return c.toPrecision(5);
    if (i === 1) return (c >= 0 ? ' + ' : ' - ') + Math.abs(c).toPrecision(5) + '·x';
    return (c >= 0 ? ' + ' : ' - ') + Math.abs(c).toPrecision(5) + '·x^' + i;
  });
  return 'y = ' + terms.join('');
}
