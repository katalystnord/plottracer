/**
 * Faithful TypeScript port of the pure functions from
 * ui-patches/engauge-algos.js's Geometry & Statistics section (built
 * 2026-07 — see that file's header for the original provenance note:
 * arc length/area follow Engauge's own approach, curvature is an
 * original addition since Engauge's Geometry Window doesn't actually
 * compute it). Ported per CLAUDE.md's Step 1 scope.
 */

import type { Dataset } from '../core/dataset.js';
import type { AnyAxes } from '../core/plotData.js';

export interface Point2D {
  x: number;
  y: number;
}

export const GEOMETRY_ARC_SUBSTEPS = 10;

export interface NaturalSpline {
  values: number[];
  M: number[];
}

/**
 * Natural cubic spline over uniformly-spaced knots t = 0..n-1.
 * M[i] is the (natural-BC) second derivative at knot i, solved via the
 * standard tridiagonal system for h = 1:
 *   M[i-1] + 4*M[i] + M[i+1] = 6*(v[i+1] - 2*v[i] + v[i-1]), M[0]=M[n-1]=0
 */
export function fitNaturalSpline(values: number[]): NaturalSpline {
  const n = values.length;
  const M = new Array<number>(n).fill(0);
  const m = n - 2; // number of interior unknowns
  if (m > 0) {
    // Thomas algorithm for the tridiagonal system (sub/diag/super = 1,4,1).
    const c = new Array<number>(m);
    const d = new Array<number>(m);
    c[0] = 1 / 4;
    d[0] = (6 * (values[2]! - 2 * values[1]! + values[0]!)) / 4;
    for (let i = 1; i < m; i++) {
      const denom = 4 - c[i - 1]!;
      c[i] = 1 / denom;
      const rhs = 6 * (values[i + 2]! - 2 * values[i + 1]! + values[i]!);
      d[i] = (rhs - d[i - 1]!) / denom;
    }
    const x = new Array<number>(m);
    x[m - 1] = d[m - 1]!;
    for (let k = m - 2; k >= 0; k--) x[k] = d[k]! - c[k]! * x[k + 1]!;
    for (let j = 0; j < m; j++) M[j + 1] = x[j]!;
  }
  return { values, M };
}

export interface SplineEval {
  value: number;
  d1: number;
  d2: number;
}

/** Evaluate a spline (and its 1st/2nd derivatives w.r.t. t) at parameter t. */
export function evalSpline(spline: NaturalSpline, t: number): SplineEval {
  const n = spline.values.length;
  let i = Math.floor(t);
  if (i >= n - 1) i = n - 2;
  if (i < 0) i = 0;
  const s = t - i;
  const v0 = spline.values[i]!;
  const v1 = spline.values[i + 1]!;
  const M0 = spline.M[i]!;
  const M1 = spline.M[i + 1]!;
  const value = v0 * (1 - s) + v1 * s + ((Math.pow(1 - s, 3) - (1 - s)) * M0) / 6 + ((Math.pow(s, 3) - s) * M1) / 6;
  const d1 = -v0 + v1 + ((-3 * (1 - s) * (1 - s) + 1) * M0) / 6 + ((3 * s * s - 1) * M1) / 6;
  const d2 = (1 - s) * M0 + s * M1;
  return { value, d1, d2 };
}

/** Points in dataset order (no sorting, no filtering) — required for splines that must support closed/looping curves. */
export function getGeometryPoints(dataset: Dataset, axes: AnyAxes): Point2D[] {
  const pts: Point2D[] = [];
  for (let i = 0; i < dataset.getCount(); i++) {
    const px = dataset.getPixel(i);
    const d = axes.pixelToData(px.x, px.y);
    pts.push({ x: d[0]!, y: d[1]! });
  }
  return pts;
}

export interface GeometryPerPoint {
  x: number;
  y: number;
  cumulativeLength: number;
  curvature: number;
}

export interface GeometryResult {
  arcLength: number;
  area: number;
  areaLabel: 'Enclosed area' | 'Area under curve';
  perPoint: GeometryPerPoint[];
  maxCurvature: { value: number; index: number };
}

export function computeGeometry(points: Point2D[], closed: boolean): GeometryResult {
  const n = points.length;
  const splineX = fitNaturalSpline(points.map((p) => p.x));
  const splineY = fitNaturalSpline(points.map((p) => p.y));

  // Densify each unit interval into GEOMETRY_ARC_SUBSTEPS sub-points,
  // tracking cumulative arc length at each original knot along the way.
  const dense: Point2D[] = [];
  const cumAtKnot = new Array<number>(n);
  cumAtKnot[0] = 0;
  let cum = 0;
  let prev: Point2D = { x: evalSpline(splineX, 0).value, y: evalSpline(splineY, 0).value };
  dense.push(prev);
  for (let i = 0; i < n - 1; i++) {
    for (let s = 1; s <= GEOMETRY_ARC_SUBSTEPS; s++) {
      const t = i + s / GEOMETRY_ARC_SUBSTEPS;
      const pt: Point2D = { x: evalSpline(splineX, t).value, y: evalSpline(splineY, t).value };
      cum += Math.sqrt((pt.x - prev.x) * (pt.x - prev.x) + (pt.y - prev.y) * (pt.y - prev.y));
      dense.push(pt);
      prev = pt;
    }
    cumAtKnot[i + 1] = cum;
  }
  const arcLength = cum;

  let area: number;
  if (closed) {
    let shoelace = 0;
    for (let a = 0; a < dense.length; a++) {
      const p1 = dense[a]!;
      const p2 = dense[(a + 1) % dense.length]!;
      shoelace += p1.x * p2.y - p2.x * p1.y;
    }
    area = Math.abs(shoelace) / 2;
  } else {
    let trap = 0;
    for (let b = 0; b < dense.length - 1; b++) {
      trap += 0.5 * (dense[b]!.y + dense[b + 1]!.y) * (dense[b + 1]!.x - dense[b]!.x);
    }
    area = trap;
  }

  const perPoint: GeometryPerPoint[] = [];
  let maxCurvature = { value: -Infinity, index: 0 };
  for (let k = 0; k < n; k++) {
    const ex = evalSpline(splineX, k);
    const ey = evalSpline(splineY, k);
    const denom = Math.pow(ex.d1 * ex.d1 + ey.d1 * ey.d1, 1.5);
    const curvature = denom > 1e-12 ? Math.abs(ex.d1 * ey.d2 - ey.d1 * ex.d2) / denom : 0;
    perPoint.push({ x: points[k]!.x, y: points[k]!.y, cumulativeLength: cumAtKnot[k]!, curvature });
    if (curvature > maxCurvature.value) maxCurvature = { value: curvature, index: k };
  }

  return {
    arcLength,
    area,
    areaLabel: closed ? 'Enclosed area' : 'Area under curve',
    perPoint,
    maxCurvature,
  };
}

/**
 * Is `pt` inside the polygon `polygon` (an ordered ring of vertices)? Standard
 * even-odd ray cast: count how many polygon edges a rightward ray from `pt`
 * crosses; an odd count means inside. Used by the Select tool's LASSO (v1.1 #6)
 * to test each data point against the freeform loop the user drew. The ring is
 * treated as implicitly closed (last vertex back to first), so the caller need
 * not repeat the first point. A degenerate ring (< 3 vertices) contains nothing.
 */
export function pointInPolygon(pt: Point2D, polygon: readonly Point2D[]): boolean {
  const n = polygon.length;
  if (n < 3) return false;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    const straddles = a.y > pt.y !== b.y > pt.y;
    if (straddles && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}
