/**
 * Interpolation-assist — checkpoint 119, the v0.6 answer for MONOCHROME
 * dash-differentiated technical figures (David): when several curves are the same
 * colour and differ only by dash pattern, colour-filtering cannot separate them,
 * and connectivity (Segment Fill) cannot follow a broken line. The human places a
 * handful of GUIDE POINTS along one line and this fills in the curve between them.
 *
 * ⚑ Tenet 9, the whole point: the guide points are the RECORD (measured -- a human
 * identified them off the figure). The interpolated samples are DERIVED, and the
 * caller marks them so (role:'interpolated' vs the anchors' role:'anchor', via
 * core/dataset.ts's per-point metadata). StarryDigitizer does the opposite -- it
 * DELETES the anchors and keeps only the spline samples, so its 194k-curve
 * database cannot tell measured from invented (its own author flags it as needing
 * a redesign). We keep both; a downstream consumer can drop the interpolated ones.
 *
 * The curve is a CENTRIPETAL Catmull-Rom spline (alpha = 0.5). Centripetal is the
 * specific choice that CANNOT cusp or self-intersect between unevenly-spaced
 * anchors -- exactly the failure a user's hand-placed guide points would trigger
 * with a uniform (alpha=0) or chordal (alpha=1) spline, or a natural cubic
 * (which overshoots). Starry's numbers; see CLAUDE.md MAP A #7.
 */

import type { Point2D } from './segmentFill.js';

const ALPHA = 0.5; // centripetal -- the no-cusp property

function dist(a: Point2D, b: Point2D): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** One Catmull-Rom segment P1->P2 (neighbours P0, P3) evaluated at `samples`
 * interior+endpoint positions, non-uniform (centripetal) knots. Endpoints of the
 * whole curve pass a duplicated neighbour so the spline reaches its first/last
 * anchor exactly. */
function segment(p0: Point2D, p1: Point2D, p2: Point2D, p3: Point2D, samples: number): Point2D[] {
  const t0 = 0;
  const t1 = t0 + Math.pow(dist(p0, p1), ALPHA) || t0 + 1e-6;
  const t2 = t1 + (Math.pow(dist(p1, p2), ALPHA) || 1e-6);
  const t3 = t2 + (Math.pow(dist(p2, p3), ALPHA) || 1e-6);
  const out: Point2D[] = [];
  for (let s = 0; s < samples; s++) {
    const t = t1 + ((t2 - t1) * s) / samples; // [t1, t2) -- next segment adds t2
    const a1 = lerp(p0, p1, (t1 - t) / (t1 - t0), (t - t0) / (t1 - t0));
    const a2 = lerp(p1, p2, (t2 - t) / (t2 - t1), (t - t1) / (t2 - t1));
    const a3 = lerp(p2, p3, (t3 - t) / (t3 - t2), (t - t2) / (t3 - t2));
    const b1 = lerp(a1, a2, (t2 - t) / (t2 - t0), (t - t0) / (t2 - t0));
    const b2 = lerp(a2, a3, (t3 - t) / (t3 - t1), (t - t1) / (t3 - t1));
    out.push(lerp(b1, b2, (t2 - t) / (t2 - t1), (t - t1) / (t2 - t1)));
  }
  return out;
}

function lerp(a: Point2D, b: Point2D, wa: number, wb: number): Point2D {
  return { x: a.x * wa + b.x * wb, y: a.y * wa + b.y * wb };
}

/**
 * Interpolate a smooth curve through `anchors` (>= 2), sampled at roughly
 * `spacing` pixels apart. Returns the DERIVED samples INCLUDING the anchors at
 * their exact positions (so the caller can mark anchors vs interpolated by
 * identity). Fewer than 2 anchors -> the anchors unchanged.
 */
export function interpolateCurve(anchors: readonly Point2D[], spacing = 4): Point2D[] {
  if (anchors.length < 2) return anchors.map((p) => ({ ...p }));
  const points: Point2D[] = [];
  for (let i = 0; i < anchors.length - 1; i++) {
    const p1 = anchors[i]!;
    const p2 = anchors[i + 1]!;
    const p0 = i > 0 ? anchors[i - 1]! : p1; // duplicate the endpoint as the phantom neighbour
    const p3 = i + 2 < anchors.length ? anchors[i + 2]! : p2;
    // Samples proportional to the chord, so density is ~uniform along the curve.
    // Clamped to a finite cap: a non-finite anchor coordinate would make `dist`
    // Infinity → `samples` Infinity → an unbounded loop / OOM. Anchor coords come
    // from finite canvas clicks in normal use, so this is purely defensive.
    const raw = Math.round(dist(p1, p2) / spacing);
    const samples = Number.isFinite(raw) ? Math.max(1, Math.min(raw, 100000)) : 1;
    points.push(...segment(p0, p1, p2, p3, samples));
  }
  points.push({ ...anchors[anchors.length - 1]! }); // the final anchor (segments are half-open)
  return points;
}

/** Which of `interpolateCurve`'s output points are the original anchors (by exact
 * position), so the caller can tag role:'anchor' vs role:'interpolated'. NOTE: only
 * the FINAL anchor is bit-identical in the output (it's appended verbatim); the
 * interior segment-start anchors are the sampler evaluated at the knot, which is
 * numerically ~the anchor but not always bit-equal. Prefer `interpolateCurveOrdered`
 * when you need every anchor identified reliably. */
export function isAnchor(point: Point2D, anchors: readonly Point2D[]): boolean {
  return anchors.some((a) => a.x === point.x && a.y === point.y);
}

/** A sample from `interpolateCurveOrdered`: a point plus whether it IS an anchor. */
export interface OrderedSample {
  x: number;
  y: number;
  anchor: boolean;
}

/**
 * Like `interpolateCurve`, but returns the samples in curve order EACH TAGGED as an
 * anchor or a derived point -- by construction, never by float-equality matching.
 * Every segment's first sample is its start anchor (the sampler evaluates the spline
 * at that knot), so we emit the EXACT anchor coordinate there and mark it; the final
 * anchor is appended likewise. This lets a caller rebuild a whole series in curve
 * order -- anchors interleaved with the fill -- without losing an interior anchor's
 * identity (or drifting its position) to the float wobble the exact-match `isAnchor`
 * suffers. Fewer than 2 anchors -> the anchors unchanged, each marked an anchor.
 */
export function interpolateCurveOrdered(anchors: readonly Point2D[], spacing = 4): OrderedSample[] {
  if (anchors.length < 2) return anchors.map((p) => ({ x: p.x, y: p.y, anchor: true }));
  const out: OrderedSample[] = [];
  for (let i = 0; i < anchors.length - 1; i++) {
    const p1 = anchors[i]!;
    const p2 = anchors[i + 1]!;
    const p0 = i > 0 ? anchors[i - 1]! : p1;
    const p3 = i + 2 < anchors.length ? anchors[i + 2]! : p2;
    const raw = Math.round(dist(p1, p2) / spacing);
    const samples = Number.isFinite(raw) ? Math.max(1, Math.min(raw, 100000)) : 1;
    const seg = segment(p0, p1, p2, p3, samples);
    for (let s = 0; s < seg.length; s++) {
      // seg[0] is the start anchor a_i at its own knot -- emit the EXACT anchor
      // coordinate so it round-trips without drift; the rest are derived.
      if (s === 0) out.push({ x: p1.x, y: p1.y, anchor: true });
      else out.push({ x: seg[s]!.x, y: seg[s]!.y, anchor: false });
    }
  }
  const last = anchors[anchors.length - 1]!;
  out.push({ x: last.x, y: last.y, anchor: true });
  return out;
}
