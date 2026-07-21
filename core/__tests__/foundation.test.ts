import { describe, it, expect } from 'vitest';
import { mat, taninverse, dist2d, normalizeAngleDeg, getCircleFrom3Pts, cspline, csplineInterp } from '../mathFunctions.js';
import { Color } from '../color.js';
import { Calibration } from '../calibration.js';
import { InputParser } from '../inputParser.js';

describe('mathFunctions', () => {
  it('mat.inv2x2 inverts a simple matrix', () => {
    const m: [number, number, number, number] = [2, 0, 0, 2];
    expect(mat.inv2x2(m)).toEqual([0.5, -0, -0, 0.5]);
  });

  it('mat.mult2x2Vec transforms a vector', () => {
    expect(mat.mult2x2Vec([1, 0, 0, 1], [3, 4])).toEqual([3, 4]);
  });

  it('taninverse matches atan2 in quadrant I', () => {
    expect(taninverse(1, 1)).toBeCloseTo(Math.PI / 4, 10);
  });

  it('dist2d computes Euclidean distance', () => {
    expect(dist2d(0, 0, 3, 4)).toBe(5);
  });

  it('normalizeAngleDeg wraps negative angles', () => {
    expect(normalizeAngleDeg(-90)).toBe(270);
    expect(normalizeAngleDeg(370)).toBe(10);
  });

  it('getCircleFrom3Pts finds the circumscribed circle of a right triangle', () => {
    const c = getCircleFrom3Pts([[0, 0], [4, 0], [0, 3]]);
    expect(c.radius).toBeCloseTo(2.5, 6);
  });

  it('cspline returns null for fewer than 3 points', () => {
    expect(cspline([0, 1], [0, 1])).toBeNull();
  });

  it('cspline_interp reproduces knot values exactly', () => {
    const cs = cspline([0, 1, 2, 3], [0, 1, 4, 9]);
    expect(cs).not.toBeNull();
    expect(csplineInterp(cs!, 1)).toBeCloseTo(1, 6);
    expect(csplineInterp(cs!, 2)).toBeCloseTo(4, 6);
  });
});

describe('Color', () => {
  it('round-trips serialize/deserialize', () => {
    const c = new Color(10, 20, 30, 255);
    const serialized = c.serialize();
    const c2 = new Color();
    c2.deserialize(serialized);
    expect(c2.toRGBString()).toBe('rgb(10, 20, 30)');
  });
});

describe('Calibration', () => {
  it('stores and retrieves 2D points', () => {
    const cal = new Calibration(2);
    cal.addPoint(100, 500, '0', '0');
    cal.addPoint(500, 500, '10', '0');
    expect(cal.getCount()).toBe(2);
    expect(cal.getPoint(0)).toEqual({ px: 100, py: 500, dx: '0', dy: '0', dz: null });
  });

  it('findNearestPoint respects threshold', () => {
    const cal = new Calibration(2);
    cal.addPoint(0, 0, '0', '0');
    cal.addPoint(100, 100, '10', '10');
    expect(cal.findNearestPoint(5, 5, 50)).toBe(0);
    expect(cal.findNearestPoint(500, 500, 50)).toBe(-1);
  });
});

describe('InputParser', () => {
  it('parses a plain float', () => {
    const p = new InputParser();
    expect(p.parse('3.14')).toBeCloseTo(3.14, 6);
    expect(p.isValid).toBe(true);
    expect(p.isDate).toBe(false);
  });

  it('parses a date string', () => {
    const p = new InputParser();
    const result = p.parse('2024/01/15');
    expect(p.isValid).toBe(true);
    expect(p.isDate).toBe(true);
    expect(typeof result).toBe('number');
  });

  it('parses a bracketed numeric array', () => {
    const p = new InputParser();
    expect(p.parse('[1, 2, 3]')).toEqual([1, 2, 3]);
    expect(p.isArray).toBe(true);
  });

  it('rejects invalid input', () => {
    const p = new InputParser();
    expect(p.parse('not a number')).toBeNull();
    expect(p.isValid).toBe(false);
  });
});
