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

export function sqDist3d(
  x1: number, y1: number, z1: number,
  x2: number, y2: number, z2: number
): number {
  return (x1 - x2) * (x1 - x2) + (y1 - y2) * (y1 - y2) + (z1 - z2) * (z1 - z2);
}

export function dist2d(x1: number, y1: number, x2: number, y2: number): number {
  return Math.sqrt(sqDist2d(x1, y1, x2, y2));
}

export function dist3d(
  x1: number, y1: number, z1: number,
  x2: number, y2: number, z2: number
): number {
  return Math.sqrt(sqDist3d(x1, y1, z1, x2, y2, z2));
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

/** Natural-ish cubic spline coefficient solve — matches wpd.cspline exactly (returns null for len < 3). */
export function cspline(x: number[], y: number[]): CubicSpline | null {
  const len = x.length;
  const d: number[] = [];
  const l: number[] = [];
  const b: number[] = [];

  if (len < 3) {
    return null;
  }

  b[0] = 2.0;
  l[0] = 3.0 * (y[1]! - y[0]!);
  for (let i = 1; i < len - 1; ++i) {
    b[i] = 4.0 - 1.0 / b[i - 1]!;
    l[i] = 3.0 * (y[i + 1]! - y[i - 1]!) - l[i - 1]! / b[i - 1]!;
  }

  b[len - 1] = 2.0 - 1.0 / b[len - 2]!;
  l[len - 1] = 3.0 * (y[len - 1]! - y[len - 2]!) - l[len - 2]! / b[len - 1]!;

  let i = len - 1;
  d[i] = l[i]! / b[i]!;
  while (i > 0) {
    --i;
    d[i] = (l[i]! - d[i + 1]!) / b[i]!;
  }

  return { x, y, len, d };
}

/** Evaluate a cspline() result at x — matches wpd.cspline_interp exactly (null outside domain). */
export function csplineInterp(cs: CubicSpline, x: number): number | null {
  let i = 0;
  if (x >= cs.x[cs.len - 1]! || x < cs.x[0]!) {
    return null;
  }

  while (x > cs.x[i]!) {
    i++;
  }
  i = i > 0 ? i - 1 : 0;

  const t = (x - cs.x[i]!) / (cs.x[i + 1]! - cs.x[i]!);
  const a = cs.y[i]!;
  const b = cs.d[i]!;
  const c = 3.0 * (cs.y[i + 1]! - cs.y[i]!) - 2.0 * cs.d[i]! - cs.d[i + 1]!;
  const dd = 2.0 * (cs.y[i]! - cs.y[i + 1]!) + cs.d[i]! + cs.d[i + 1]!;
  return a + b * t + c * t * t + dd * t * t * t;
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

/** Normalize an angle in degrees to [0, 360) — matches wpd.normalizeAngleDeg exactly. */
export function normalizeAngleDeg(angleDeg: number): number {
  let normDeg = angleDeg % 360;
  if (normDeg < 0) {
    normDeg += 360.0;
  }
  return normDeg;
}
