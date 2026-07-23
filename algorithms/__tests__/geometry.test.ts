import { describe, it, expect } from 'vitest';
import { computeGeometry, pointInPolygon } from '../geometry.js';

describe('pointInPolygon (lasso select, v1.1 #6)', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];
  it('is true for a point inside and false for one outside', () => {
    expect(pointInPolygon({ x: 5, y: 5 }, square)).toBe(true);
    expect(pointInPolygon({ x: 15, y: 5 }, square)).toBe(false);
    expect(pointInPolygon({ x: -1, y: 5 }, square)).toBe(false);
  });
  it('treats the ring as implicitly closed (first point not repeated)', () => {
    expect(pointInPolygon({ x: 1, y: 9 }, square)).toBe(true);
  });
  it('handles a concave (non-convex) lasso loop', () => {
    // An arrow/chevron notch: the concavity at x~5 excludes points in the dent.
    const chevron = [
      { x: 0, y: 0 },
      { x: 5, y: 4 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(pointInPolygon({ x: 5, y: 2 }, chevron)).toBe(false); // in the notch
    expect(pointInPolygon({ x: 5, y: 7 }, chevron)).toBe(true); // in the body
  });
  it('a degenerate ring (< 3 vertices) contains nothing', () => {
    expect(pointInPolygon({ x: 0, y: 0 }, [{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe(false);
  });
});

describe('geometry', () => {
  it('computes exact arc length and area for a 2-point straight line (3-4-5 triangle)', () => {
    // Verified live this session: a straight line from (0,0) to (3,4)
    // gives arc length exactly 5 and trapezoidal area exactly 6.
    const result = computeGeometry([{ x: 0, y: 0 }, { x: 3, y: 4 }], false);
    expect(result.arcLength).toBeCloseTo(5, 6);
    expect(result.area).toBeCloseTo(6, 6);
    expect(result.perPoint[0]!.curvature).toBe(0);
    expect(result.perPoint[1]!.curvature).toBe(0);
  });

  it('matches the closed-form arc length and area for a smooth parabola within spline-discretization error', () => {
    // Same 8-point parabola verified live this session: true closed-form
    // arc length ≈ 18.842, true area ≈ 35. Spline through discrete points
    // approximates these closely but not exactly.
    const points = Array.from({ length: 8 }, (_, i) => {
      const x = i * (10 / 7);
      const y = 0.3 * (x - 5) * (x - 5) + 1;
      return { x, y };
    });
    const result = computeGeometry(points, false);
    expect(result.arcLength).toBeCloseTo(18.84, 1);
    expect(result.area).toBeCloseTo(35, 0);
    expect(result.areaLabel).toBe('Area under curve');

    // Curvature should peak near the vertex (x=5, around index 3-4 for
    // this symmetric parabola) and be lowest at the flat outer ends.
    const curvatures = result.perPoint.map((p) => p.curvature);
    const maxIdx = result.maxCurvature.index;
    expect(maxIdx === 3 || maxIdx === 4).toBe(true);
    expect(curvatures[maxIdx]).toBeGreaterThan(curvatures[0]!);
    expect(curvatures[maxIdx]).toBeGreaterThan(curvatures[7]!);
  });

  it('switches to shoelace polygon area when closed=true', () => {
    // A right triangle (0,0)-(5,0)-(5,5) — closed vs open area should differ.
    const points = [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }];
    const open = computeGeometry(points, false);
    const closed = computeGeometry(points, true);
    expect(closed.areaLabel).toBe('Enclosed area');
    expect(closed.area).not.toBeCloseTo(open.area, 1);
  });

  it('cumulative length is monotonically non-decreasing and ends at total arc length', () => {
    const points = [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 0 }, { x: 3, y: 1 }];
    const result = computeGeometry(points, false);
    for (let i = 1; i < result.perPoint.length; i++) {
      expect(result.perPoint[i]!.cumulativeLength).toBeGreaterThanOrEqual(result.perPoint[i - 1]!.cumulativeLength);
    }
    expect(result.perPoint[result.perPoint.length - 1]!.cumulativeLength).toBeCloseTo(result.arcLength, 6);
  });
});
