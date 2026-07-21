import { describe, it, expect } from 'vitest';
import { halfPixelResolution, roundToResolution, makeRounder, FULL_PRECISION_ROUNDER } from '../exportPrecision.js';
import { XYAxes } from '../axes/xy.js';
import { Calibration } from '../calibration.js';

/**
 * The v1.0 export-precision blocker fix: round to the figure's OWN resolution
 * (~half a pixel), NEVER a fixed number of decimals that zeroes small data.
 */

function xy(min: number, max: number): XYAxes {
  // X 0..10, Y min..max, both over 300px.
  const cal = new Calibration(2);
  cal.addPoint(100, 300, '0', '');
  cal.addPoint(400, 300, '10', '');
  cal.addPoint(100, 300, '', String(min));
  cal.addPoint(100, 0, '', String(max));
  const axes = new XYAxes();
  axes.calibrate(cal, false, false, true);
  return axes;
}

describe('roundToResolution', () => {
  it('keeps enough decimals for a small resolution (never zeroes a small value)', () => {
    // halfStep ~1.7e-5 -> 5 decimals; 0.0034 must survive.
    expect(roundToResolution(0.0034, 1.7e-5)).toBeCloseTo(0.0034, 5);
    expect(roundToResolution(0.0012, 1.7e-5)).not.toBe(0);
  });

  it('caps decimals for a coarse resolution rather than fabricating digits', () => {
    // halfStep ~0.017 -> 2 decimals.
    expect(roundToResolution(4.566666, 0.017)).toBe(4.57);
    // halfStep 17 -> 0 decimals (integer).
    expect(roundToResolution(5432.9, 17)).toBe(5433);
  });

  it('returns the value UNCHANGED when the resolution is unknown — never coerces toward zero', () => {
    expect(roundToResolution(0.001, 0)).toBe(0.001); // degenerate calibration
    expect(roundToResolution(0.001, NaN)).toBe(0.001);
    expect(roundToResolution(0.001, -1)).toBe(0.001);
    expect(roundToResolution(NaN, 0.01)).toBeNaN();
  });
});

describe('halfPixelResolution', () => {
  it('is small for a small-magnitude axis and large for a wide one', () => {
    const small = halfPixelResolution(xy(0, 0.01), 250, 150)[1]!; // Y over 0..0.01/300px
    const wide = halfPixelResolution(xy(0, 10000), 250, 150)[1]!; // Y over 0..10000/300px
    expect(small).toBeGreaterThan(0);
    expect(small).toBeLessThan(1e-4);
    expect(wide).toBeGreaterThan(10);
  });
});

describe('makeRounder', () => {
  it('auto mode rounds to resolution; full mode is identity', () => {
    const axes = xy(0, 0.01);
    const auto = makeRounder(axes, 'auto');
    const full = makeRounder(axes, 'full');
    // A small Y (dim 1) at data (5, 0.0034): auto preserves it, full is untouched.
    expect(auto.at([5, 0.0034], 1)).toBeCloseTo(0.0034, 4);
    expect(auto.at([5, 0.0034], 1)).not.toBe(0);
    expect(full.at([5, 0.0034], 1)).toBe(0.0034);
    expect(full).toBe(FULL_PRECISION_ROUNDER);
  });
});
