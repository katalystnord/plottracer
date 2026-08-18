import { describe, it, expect } from 'vitest';
import { interpolateCurveOrdered } from '../interpolate.js';
import type { Point2D } from '../segmentFill.js';

// ⚑ This file used to test `interpolateCurve` and `isAnchor` -- both superseded by
// interpolateCurveOrdered and, by v1.5, called by nothing but these tests. The
// LIVE function (engine/calibrationSession.ts:2955) had no coverage at all, so the
// suite was green over the retired pair and silent about the one in use. Inverted
// here, keeping the assertions that still say something true about the record.
/** Shortest distance from `p` to the polyline through `poly` -- the honest way to
 * compare two samplings of the SAME curve, whose sample positions need not line up
 * point for point. */
function distanceToPolyline(p: { x: number; y: number }, poly: readonly { x: number; y: number }[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length - 1; i++) {
    const a = poly[i]!;
    const b = poly[i + 1]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
    best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
  }
  return best;
}

describe('interpolateCurveOrdered (centripetal Catmull-Rom)', () => {
  const anchors: Point2D[] = [
    { x: 0, y: 0 },
    { x: 10, y: 10 },
    { x: 20, y: 0 },
    { x: 30, y: 10 },
  ];

  it('emits every anchor EXACTLY, tagged as an anchor', () => {
    // The whole reason this replaced the exact-match isAnchor: an interior anchor
    // used to be the sampler evaluated at the knot, ~equal but not bit-equal, so
    // it could lose its identity to float wobble. Here it is emitted verbatim.
    const out = interpolateCurveOrdered(anchors);
    for (const a of anchors) {
      const hit = out.find((s) => s.x === a.x && s.y === a.y);
      expect(hit, `anchor ${a.x},${a.y} must appear exactly`).toBeDefined();
      expect(hit!.anchor).toBe(true);
    }
    expect(out.filter((s) => s.anchor)).toHaveLength(anchors.length);
  });

  it('returns the samples in CURVE ORDER, anchors interleaved with the fill', () => {
    const out = interpolateCurveOrdered(anchors);
    // The anchors appear in the order they were given, not bunched at one end --
    // the defect that made a Guide-points series export out of order.
    expect(out.filter((s) => s.anchor).map((s) => s.x)).toEqual([0, 10, 20, 30]);
    expect(out.length).toBeGreaterThan(anchors.length); // fill really is present
  });

  it('marks derived samples as NOT anchors, so a role column can tell them apart', () => {
    // Tenet 9: a point the user assigned and one the spline invented are not the
    // same claim about the figure.
    expect(interpolateCurveOrdered(anchors).some((s) => !s.anchor)).toBe(true);
  });

  it('returns the anchors unchanged when there are fewer than 2', () => {
    expect(interpolateCurveOrdered([])).toEqual([]);
    expect(interpolateCurveOrdered([{ x: 3, y: 4 }])).toEqual([{ x: 3, y: 4, anchor: true }]);
  });

  it('handles coincident anchors without producing NaN', () => {
    const out = interpolateCurveOrdered([
      { x: 5, y: 5 },
      { x: 5, y: 5 },
      { x: 9, y: 9 },
    ]);
    for (const s of out) {
      expect(Number.isFinite(s.x)).toBe(true);
      expect(Number.isFinite(s.y)).toBe(true);
    }
  });

  // ⚑ EVERY TEST ABOVE IS STRUCTURAL - anchors present, in order, tagged, finite.
  // None of them reads a single INTERPOLATED coordinate, and the anchors are
  // emitted verbatim rather than sampled, so the spline arithmetic could be
  // arbitrarily wrong and the whole block above would still pass. That is what
  // "40% mutation score with zero uncovered mutants" was telling us: the suite ran
  // this file exhaustively and checked almost nothing in it. The derived samples
  // are RECORD - they ride into the user's export beside the anchors - so the
  // curve itself needs assertions. The three below are properties of the curve
  // rather than of this implementation, and each threshold was MEASURED before it
  // was written down, not guessed.

  it('puts every sample EXACTLY on the line when the anchors are collinear', () => {
    // The strongest value check available without hardcoding spline output: each
    // sample is an affine combination of the four control points, so collinear
    // anchors must produce a curve that never leaves their line -- whatever the
    // knots do. Any weight that stops summing to 1 (a flipped sign, a swapped
    // numerator, t2+t for t2-t) lifts the samples off it immediately.
    // Deliberately UNEVENLY spaced, so the non-uniform knots are exercised too.
    const collinear: Point2D[] = [
      { x: 0, y: 1 },
      { x: 10, y: 21 },
      { x: 25, y: 51 },
      { x: 40, y: 81 },
    ];
    const out = interpolateCurveOrdered(collinear, 2);
    expect(out.length).toBeGreaterThan(20); // the fill is really being sampled
    for (const s of out) {
      // Measured worst case: 4.8e-11, which is accumulated float error, not slack.
      expect(Math.abs(s.y - (2 * s.x + 1))).toBeLessThan(1e-8);
    }
  });

  it('samples the curve at the spacing it was asked for', () => {
    // `spacing` is the one knob the caller has, and nothing checked it did
    // anything: the sample count is round(chord/spacing) clamped to [1, 100000],
    // so a mutation of the divisor, the rounding or the clamp changed the density
    // of every exported curve silently.
    const curve: Point2D[] = [
      { x: 0, y: 0 },
      { x: 30, y: 40 },
      { x: 70, y: 10 },
      { x: 110, y: 55 },
      { x: 140, y: 20 },
    ];
    for (const spacing of [1, 4, 10]) {
      const out = interpolateCurveOrdered(curve, spacing);
      const gaps: number[] = [];
      for (let i = 1; i < out.length; i++) {
        gaps.push(Math.hypot(out[i]!.x - out[i - 1]!.x, out[i]!.y - out[i - 1]!.y));
      }
      gaps.sort((a, b) => a - b);
      const median = gaps[Math.floor(gaps.length / 2)]!;
      // Measured medians: 1.09 / 4.24 / 10.92 -- a curve is longer than its chord,
      // so the true spacing runs a little over the request and never under it.
      expect(median).toBeGreaterThan(spacing * 0.8);
      expect(median).toBeLessThan(spacing * 1.5);
      // The joins are the tight ones (a segment's last gap is a remainder), but
      // nothing may open a hole: no gap is twice what was asked for.
      expect(gaps[gaps.length - 1]!).toBeLessThan(spacing * 2);
    }
  });

  it('draws the same curve when the anchors are given in reverse', () => {
    // A curve through a set of points cannot depend on which end you started from,
    // and centripetal knots are symmetric, so this must hold exactly -- measured
    // deviation is 0. It is the check that catches an asymmetry in the weights,
    // the one class of arithmetic error the collinear test above cannot see
    // (a line is symmetric, so a lopsided weight still lands on it).
    const curve: Point2D[] = [
      { x: 0, y: 0 },
      { x: 30, y: 40 },
      { x: 70, y: 10 },
      { x: 110, y: 55 },
      { x: 140, y: 20 },
    ];
    const forward = interpolateCurveOrdered(curve, 1);
    const backward = interpolateCurveOrdered([...curve].reverse(), 1);
    expect(backward).toHaveLength(forward.length);
    for (const s of backward) {
      expect(distanceToPolyline(s, forward)).toBeLessThan(1e-6);
    }
  });

  it('is CENTRIPETAL, not uniform - the knot exponent this file is built on', () => {
    // ⚑ The three tests above kill a lot of arithmetic and cannot touch ALPHA:
    // collinear anchors stay on their line under ANY parameterization, and every
    // variant is symmetric, so alpha=0 passes all of them. Yet alpha=0.5 is the
    // whole premise of the file header -- the choice that cannot cusp between
    // unevenly-spaced guide points, which is exactly what hand-placed anchors are.
    // Pinning it needs the one thing the other tests avoid: measured coordinates.
    //
    // This configuration (a long flat run, then a short steep one) is where the
    // exponent bites. The numbers below were MEASURED off this implementation, and
    // the contrast is what makes them worth storing -- at alpha=0 the second
    // sample is (20.078125, -0.937500) instead:
    const anchors: Point2D[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 110, y: 40 },
      { x: 210, y: 40 },
    ];
    const expected: [number, number][] = [
      [0, 0],
      [13.347498, -1.778221],
      [43.926659, -4.741922],
      [77.54249, -5.334663],
      [100, 0],
      [105, 20],
      [110, 40],
      [132.45751, 45.334663],
      [166.073341, 44.741922],
      [196.652502, 41.778221],
      [210, 40],
    ];
    const out = interpolateCurveOrdered(anchors, 25);
    expect(out).toHaveLength(expected.length);
    out.forEach((s, i) => {
      expect(s.x).toBeCloseTo(expected[i]![0], 5);
      expect(s.y).toBeCloseTo(expected[i]![1], 5);
    });
    // ⚑ If a deliberate change to the spline makes this fail, RE-MEASURE it rather
    // than loosening it -- the point is that the shipped curve cannot change
    // unnoticed, not that these particular digits are sacred.
  });

  it('does not hang or blow up on a non-finite anchor coordinate (v0.6 gate)', () => {
    const out = interpolateCurveOrdered([
      { x: 0, y: 0 },
      { x: Number.POSITIVE_INFINITY, y: 10 },
      { x: 20, y: 0 },
    ]);
    // The sample count falls back to 1 rather than Infinity; what matters is that
    // it terminates and stays bounded.
    expect(out.length).toBeLessThan(100000);
    expect(out.length).toBeGreaterThan(0);
  });
});
