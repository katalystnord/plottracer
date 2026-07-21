import { describe, it, expect } from 'vitest';
import { Calibration } from '../../calibration.js';
import { XYAxes } from '../xy.js';
import { BarAxes } from '../bar.js';
import { PolarAxes } from '../polar.js';
import { TernaryAxes } from '../ternary.js';
import { MapAxes } from '../map.js';
import { CircularChartRecorderAxes } from '../circularChartRecorder.js';
import { ImageAxes } from '../image.js';

describe('XYAxes', () => {
  // Same calibration setup proven correct live in the app throughout this
  // session's testing (Curve Fit/Geometry verification): X1 px=100 dx=0,
  // X2 px=500 dx=10, Y1 py=500 dy=0, Y2 py=100 dy=10, noRotation=true.
  function calibratedAxes(): XYAxes {
    const cal = new Calibration(2);
    cal.addPoint(100, 500, '0', '0');
    cal.addPoint(500, 500, '10', '0');
    cal.addPoint(100, 500, '0', '0');
    cal.addPoint(100, 100, '0', '10');
    const axes = new XYAxes();
    axes.calibrate(cal, false, false, true);
    return axes;
  }

  it('maps calibration pixel corners to their exact calibration values', () => {
    const axes = calibratedAxes();
    expect(axes.pixelToData(100, 500)).toEqual([0, 0]);
    const top = axes.pixelToData(100, 100);
    expect(top[0]).toBeCloseTo(0, 10);
    expect(top[1]).toBeCloseTo(10, 10);
  });

  it('interpolates linearly at the midpoint', () => {
    const axes = calibratedAxes();
    const mid = axes.pixelToData(300, 300);
    expect(mid[0]).toBeCloseTo(5, 10);
    expect(mid[1]).toBeCloseTo(5, 10);
  });

  it('dataToPixel is the exact inverse of pixelToData', () => {
    const axes = calibratedAxes();
    const px = axes.dataToPixel(5, 5);
    expect(px.x).toBeCloseTo(300, 6);
    expect(px.y).toBeCloseTo(300, 6);
  });

  it('rejects fewer than 4 calibration points', () => {
    const cal = new Calibration(2);
    cal.addPoint(0, 0, '0', '0');
    const axes = new XYAxes();
    expect(axes.calibrate(cal, false, false, true)).toBe(false);
    expect(axes.isCalibrated()).toBe(false);
  });

  it('reports its static metadata correctly', () => {
    const axes = new XYAxes();
    expect(axes.numCalibrationPointsRequired()).toBe(4);
    expect(axes.getDimensions()).toBe(2);
    expect(axes.getAxesLabels()).toEqual(['X', 'Y']);
  });
});

describe('BarAxes', () => {
  it('reproduces calibration values exactly at each calibration point (vertical bar)', () => {
    const cal = new Calibration(2);
    cal.addPoint(300, 500, 'ignored', '0');
    cal.addPoint(300, 100, 'ignored', '10');
    const axes = new BarAxes();
    axes.calibrate(cal, false, false);
    expect(axes.pixelToData(300, 500)[0]).toBeCloseTo(0, 10);
    expect(axes.pixelToData(300, 100)[0]).toBeCloseTo(10, 10);
    expect(axes.pixelToData(300, 300)[0]).toBeCloseTo(5, 10);
  });

  it('dataToPixel is an unimplemented stub, matching the original exactly', () => {
    const cal = new Calibration(2);
    cal.addPoint(300, 500, 'ignored', '0');
    cal.addPoint(300, 100, 'ignored', '10');
    const axes = new BarAxes();
    axes.calibrate(cal, false, false);
    expect(axes.dataToPixel(5, 5)).toEqual({ x: 0, y: 0 });
  });

  it('reports its static metadata correctly', () => {
    const axes = new BarAxes();
    expect(axes.numCalibrationPointsRequired()).toBe(2);
    expect(axes.getAxesLabels()).toEqual(['Label', 'Y']);
  });
});

describe('PolarAxes', () => {
  it('reproduces r/theta exactly at calibration points', () => {
    const cal = new Calibration(2);
    // Origin at (0,0)px. Point 1 at pixel-distance 5 along the +x ray
    // representing r=5,theta=0deg; point 2 at pixel-distance 10 along the
    // same ray representing r=10 — same ray on purpose so pixel distance
    // maps directly to radius, keeping the expected values easy to verify
    // by hand.
    cal.addPoint(0, 0, '0', '0');
    cal.addPoint(5, 0, '5', '0');
    cal.addPoint(10, 0, '10', '0');
    const axes = new PolarAxes();
    axes.calibrate(cal, true, false, false);
    const p1 = axes.pixelToData(10, 0);
    expect(p1[0]).toBeCloseTo(10, 6);
    expect(p1[1]).toBeCloseTo(0, 6);
  });

  it('reports its static metadata correctly', () => {
    const axes = new PolarAxes();
    expect(axes.numCalibrationPointsRequired()).toBe(3);
    expect(axes.getAxesLabels()).toEqual(['r', 'θ']);
  });
});

describe('TernaryAxes', () => {
  it('reports its static metadata correctly (3-dimensional)', () => {
    const axes = new TernaryAxes();
    expect(axes.numCalibrationPointsRequired()).toBe(3);
    expect(axes.getDimensions()).toBe(3);
    expect(axes.getAxesLabels()).toEqual(['a', 'b', 'c']);
  });

  it('produces a valid a+b+c decomposition at an arbitrary point', () => {
    const cal = new Calibration(2);
    cal.addPoint(0, 100, '0', '0');
    cal.addPoint(100, 100, '0', '0');
    const axes = new TernaryAxes();
    axes.calibrate(cal, true, true);
    const [a, b, c] = axes.pixelToData(50, 50);
    // Range-0-to-100 mode: a+b+c should sum to 100 regardless of position.
    expect(a! + b! + c!).toBeCloseTo(100, 6);
  });
});

describe('MapAxes', () => {
  it('converts pixel distance to a real-world distance via the calibrated scale', () => {
    const cal = new Calibration(2);
    cal.addPoint(0, 0, '', '');
    cal.addPoint(100, 0, '', '');
    const axes = new MapAxes();
    // 100px === 50 real units
    axes.calibrate(cal, 50, 'km', 'top-left', 1000);
    expect(axes.pixelToDataDistance(100)).toBeCloseTo(50, 10);
    expect(axes.pixelToDataDistance(200)).toBeCloseTo(100, 10);
  });

  it('reports its static metadata correctly', () => {
    const axes = new MapAxes();
    expect(axes.numCalibrationPointsRequired()).toBe(2);
    expect(axes.getAxesLabels()).toEqual(['X', 'Y']);
  });
});

describe('CircularChartRecorderAxes', () => {
  it('reports its static metadata correctly', () => {
    const axes = new CircularChartRecorderAxes();
    expect(axes.numCalibrationPointsRequired()).toBe(5);
    expect(axes.getDimensions()).toBe(2);
    expect(axes.getAxesLabels()).toEqual(['Time', 'Magnitude']);
    // isCalibrated() is a hardcoded `return false` in the original — preserved as-is.
    expect(axes.isCalibrated()).toBe(false);
  });
});

describe('ImageAxes', () => {
  it('is the identity transform', () => {
    const axes = new ImageAxes();
    expect(axes.calibrate()).toBe(true);
    expect(axes.isCalibrated()).toBe(true);
    expect(axes.pixelToData(123, 456)).toEqual([123, 456]);
    expect(axes.dataToPixel(123, 456)).toEqual({ x: 123, y: 456 });
  });

  it('reports its static metadata correctly', () => {
    const axes = new ImageAxes();
    expect(axes.numCalibrationPointsRequired()).toBe(0);
    expect(axes.getAxesLabels()).toEqual(['X', 'Y']);
  });
});
