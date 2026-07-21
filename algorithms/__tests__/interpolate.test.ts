import { describe, it, expect } from 'vitest';
import { interpolateCurve, isAnchor } from '../interpolate.js';
import type { Point2D } from '../segmentFill.js';

describe('interpolateCurve (centripetal Catmull-Rom)', () => {
  it('passes through every anchor exactly (the record is preserved)', () => {
    const anchors: Point2D[] = [
      { x: 0, y: 0 },
      { x: 10, y: 5 },
      { x: 20, y: 3 },
      { x: 30, y: 8 },
    ];
    const curve = interpolateCurve(anchors, 4);
    // Each anchor appears in the output at its exact position.
    for (const a of anchors) {
      expect(curve.some((p) => p.x === a.x && p.y === a.y)).toBe(true);
      expect(isAnchor(a, anchors)).toBe(true);
    }
    // And it is denser than the anchors (it filled the curve in).
    expect(curve.length).toBeGreaterThan(anchors.length);
  });

  it('does not overshoot on a straight line — interpolated points stay collinear', () => {
    // Colinear anchors, unevenly spaced (the case that makes a naive spline bow).
    const anchors: Point2D[] = [
      { x: 0, y: 0 },
      { x: 2, y: 4 },
      { x: 20, y: 40 }, // y = 2x throughout
      { x: 25, y: 50 },
    ];
    const curve = interpolateCurve(anchors, 2);
    // Every sample lies on y = 2x (centripetal cannot cusp/overshoot on a line).
    for (const p of curve) expect(p.y).toBeCloseTo(2 * p.x, 6);
  });

  it('stays within the anchors bounding box (no wild excursions on uneven spacing)', () => {
    const anchors: Point2D[] = [
      { x: 0, y: 0 },
      { x: 1, y: 10 }, // a sharp near-vertical jump right after the start
      { x: 40, y: 12 },
      { x: 80, y: 11 },
    ];
    const curve = interpolateCurve(anchors, 3);
    const minX = Math.min(...anchors.map((a) => a.x));
    const maxX = Math.max(...anchors.map((a) => a.x));
    const minY = Math.min(...anchors.map((a) => a.y));
    const maxY = Math.max(...anchors.map((a) => a.y));
    // A small tolerance for the smooth curve's overshoot; centripetal keeps it tiny.
    const pad = 2;
    for (const p of curve) {
      expect(p.x).toBeGreaterThanOrEqual(minX - pad);
      expect(p.x).toBeLessThanOrEqual(maxX + pad);
      expect(p.y).toBeGreaterThanOrEqual(minY - pad);
      expect(p.y).toBeLessThanOrEqual(maxY + pad);
    }
  });

  it('returns the anchors unchanged when there are fewer than 2', () => {
    expect(interpolateCurve([], 4)).toEqual([]);
    expect(interpolateCurve([{ x: 3, y: 7 }], 4)).toEqual([{ x: 3, y: 7 }]);
  });

  it('handles duplicate/coincident anchors without NaN (degenerate spacing)', () => {
    const anchors: Point2D[] = [
      { x: 5, y: 5 },
      { x: 5, y: 5 }, // coincident -> a zero-length chord
      { x: 10, y: 8 },
    ];
    const curve = interpolateCurve(anchors, 2);
    for (const p of curve) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });

  it('does not hang or blow up on a non-finite anchor coordinate (defensive, v0.6 gate)', () => {
    // A corrupt/edge anchor with Infinity would make the per-segment sample count
    // Infinity and loop forever without the clamp. Must return promptly, bounded.
    const out = interpolateCurve([
      { x: 0, y: 0 },
      { x: Infinity, y: 5 },
      { x: 30, y: 10 },
    ]);
    expect(out.length).toBeLessThan(300000); // bounded, not an OOM
  });
});
