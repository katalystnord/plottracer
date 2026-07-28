import { describe, it, expect } from 'vitest';
import { interpolateCurveOrdered } from '../interpolate.js';
import type { Point2D } from '../segmentFill.js';

// ⚑ This file used to test `interpolateCurve` and `isAnchor` -- both superseded by
// interpolateCurveOrdered and, by v1.5, called by nothing but these tests. The
// LIVE function (engine/calibrationSession.ts:2955) had no coverage at all, so the
// suite was green over the retired pair and silent about the one in use. Inverted
// here, keeping the assertions that still say something true about the record.
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
