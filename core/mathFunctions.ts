/**
 * Faithful TypeScript port of wpd-core's core/mathFunctions.js.
 * Original: WebPlotDigitizer, Copyright (C) 2025 Ankit Rohatgi, AGPL-3.0.
 * Ported 2026-07 as part of PlotTracer's Product #1 rebuild (see
 * CLAUDE.md "Current scoped task — Step 1: extract core/"). Behavior is
 * intended to be bit-for-bit identical to the original — verified by
 * golden-value tests and a cross-check against the live wpd-core.
 */

/** Inverse tan with range [0, 2π), matching wpd.taninverse exactly. */
export function taninverse(y: number, x: number): number {
  let invAns: number;
  if (y > 0) {
    invAns = Math.atan2(y, x);
  } else {
    invAns = Math.atan2(y, x) + 2 * Math.PI;
  }
  if (invAns >= 2 * Math.PI) {
    invAns = 0.0;
  }
  return invAns;
}

export function sqDist2d(x1: number, y1: number, x2: number, y2: number): number {
  return (x1 - x2) * (x1 - x2) + (y1 - y2) * (y1 - y2);
}

export function dist2d(x1: number, y1: number, x2: number, y2: number): number {
  return Math.sqrt(sqDist2d(x1, y1, x2, y2));
}

/** A 2x2 matrix is represented as a flat 4-tuple [a, b, c, d] === [[a,b],[c,d]]. */
export type Mat2x2 = [number, number, number, number];
export type Vec2 = [number, number];

export const mat = {
  det2x2(m: Mat2x2): number {
    return m[0] * m[3] - m[1] * m[2];
  },

  inv2x2(m: Mat2x2): Mat2x2 {
    const det = mat.det2x2(m);
    return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det];
  },

  mult2x2(m1: Mat2x2, m2: Mat2x2): Mat2x2 {
    return [
      m1[0] * m2[0] + m1[1] * m2[2], m1[0] * m2[1] + m1[1] * m2[3],
      m1[2] * m2[0] + m1[3] * m2[2], m1[2] * m2[1] + m1[3] * m2[3],
    ];
  },

  mult2x2Vec(m: Mat2x2, v: Vec2): Vec2 {
    return [m[0] * v[0] + m[1] * v[1], m[2] * v[0] + m[3] * v[1]];
  },

  multVec2x2(v: Vec2, m: Mat2x2): Vec2 {
    return [m[0] * v[0] + m[2] * v[1], m[1] * v[0] + m[3] * v[1]];
  },
};

export interface CubicSpline {
  x: number[];
  y: number[];
  len: number;
  d: number[];
}

export interface Circle {
  x0: number;
  y0: number;
  radius: number;
}

/** Circumscribed circle through 3 points — matches wpd.getCircleFrom3Pts exactly. */
export function getCircleFrom3Pts(pts: [Vec2, Vec2, Vec2]): Circle {
  const Ax = pts[0][0], Bx = pts[1][0], Cx = pts[2][0];
  const Ay = pts[0][1], By = pts[1][1], Cy = pts[2][1];
  const a = dist2d(Cx, Cy, Bx, By);
  const b = dist2d(Ax, Ay, Cx, Cy);
  const c = dist2d(Bx, By, Ax, Ay);
  const s = (a + b + c) / 2.0;
  const R = (a * b * c) / 4.0 / Math.sqrt(s * (s - a) * (s - b) * (s - c));
  const b1 = a * a * (b * b + c * c - a * a);
  const b2 = b * b * (a * a + c * c - b * b);
  const b3 = c * c * (a * a + b * b - c * c);
  const X: Vec2 = [
    (Ax * b1 + Bx * b2 + Cx * b3) / (b1 + b2 + b3),
    (Ay * b1 + By * b2 + Cy * b3) / (b1 + b2 + b3),
  ];
  return { x0: X[0], y0: X[1], radius: R };
}

/**
 * Best-fit circle through 3 OR MORE points (v1.6, the pie's outline).
 *
 * Three points define a circle exactly, and that case delegates to
 * `getCircleFrom3Pts` above so the two never disagree. Beyond three there is no
 * exact answer, so this is Kåsa's algebraic least-squares fit: minimising
 * (x²+y²) - (2x·x0 + 2y·y0 + c) is LINEAR in the unknowns, which makes it a 3x3
 * solve with no iteration, no initial guess and no convergence to report — the
 * least modelling that answers the question (tenet 10).
 *
 * ⚑ Why more than three is worth allowing: three rim clicks always fit perfectly,
 * so a bad one is undetectable. A fourth is genuine redundancy about the FIGURE
 * (different ink, not the same boundary twice), and the residual it produces says
 * something real — a rim that will not fit a circle is a pie that is not circular.
 *
 * Returns null when the points are collinear or too few, rather than a circle of
 * infinite radius.
 */
export function fitCircle(pts: readonly Vec2[]): Circle | null {
  if (pts.length < 3) return null;
  if (pts.length === 3) {
    const c = getCircleFrom3Pts([pts[0]!, pts[1]!, pts[2]!]);
    return Number.isFinite(c.x0) && Number.isFinite(c.y0) && Number.isFinite(c.radius) && c.radius > 0 ? c : null;
  }
  const n = pts.length;
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0, sz = 0;
  for (const [x, y] of pts) {
    const z = x * x + y * y;
    sx += x; sy += y; sz += z;
    sxx += x * x; syy += y * y; sxy += x * y;
    sxz += x * z; syz += y * z;
  }
  // Normal equations for [2x0, 2y0, c] against the centred moments.
  const a11 = sxx - (sx * sx) / n;
  const a12 = sxy - (sx * sy) / n;
  const a22 = syy - (sy * sy) / n;
  const b1 = (sxz - (sx * sz) / n) / 2;
  const b2 = (syz - (sy * sz) / n) / 2;
  const det = a11 * a22 - a12 * a12;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null; // collinear
  const x0 = (b1 * a22 - b2 * a12) / det;
  const y0 = (b2 * a11 - b1 * a12) / det;
  let r = 0;
  for (const [x, y] of pts) r += Math.hypot(x - x0, y - y0);
  r /= n;
  return Number.isFinite(r) && r > 0 ? { x0, y0, radius: r } : null;
}

/** How far the points stray from a fitted circle (RMS, in pixels) — a property of
 * the FIGURE, not of the fit: a rim that will not sit on a circle is telling you the
 * pie is tilted or was drawn as an ellipse. Reported, never acted on (the app does
 * not infer tilt). */
export function circleFitResidual(pts: readonly Vec2[], circle: Circle): number {
  if (pts.length === 0) return 0;
  let acc = 0;
  for (const [x, y] of pts) {
    const d = Math.hypot(x - circle.x0, y - circle.y0) - circle.radius;
    acc += d * d;
  }
  return Math.sqrt(acc / pts.length);
}

/** Normalize an angle in degrees to [0, 360) — matches wpd.normalizeAngleDeg exactly. */
export function normalizeAngleDeg(angleDeg: number): number {
  let normDeg = angleDeg % 360;
  if (normDeg < 0) {
    normDeg += 360.0;
  }
  return normDeg;
}
