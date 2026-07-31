import { describe, expect, it } from 'vitest';
import { CircularChartRecorderAxes } from '../axes/circularChartRecorder.js';
import { Calibration } from '../calibration.js';

/**
 * v2.0 pre-launch audit: `CircularChartRecorderAxes.calibrate()` performed NO
 * input validation at all and always returned `true` -- the only axes class
 * with zero test coverage before this file, despite being a live, shipped
 * graph type with a bundled sample figure. R0/R2 went through a bare
 * `Number()` (bypassing InputParser entirely, so non-numeric input silently
 * became `NaN`), and neither `ip.parse(t0)` nor `ip.parse(startTimeInput)`
 * ever checked `ip.isValid` -- so a blank "Chart Start Time" silently became
 * the Unix epoch via `new Date(null)`.
 *
 * A healthy calibration: pen circle through (200,150)/(150,100)/(100,150)
 * (centre (150,150), r=50), chart circle through (100,150)/(0,250)/(0,50)
 * (centre (0,150), r=100) -- cp2 is the shared rim point both circles fit
 * through, matching how the real 5-click capture works.
 */
function calibrateCcr(
  r0: string,
  r2: string,
  startTime: string,
  { t0 = '0' }: { t0?: string } = {}
): { ok: boolean; axes: CircularChartRecorderAxes } {
  const cal = new Calibration(2);
  cal.addPoint(200, 150, t0, r0);
  cal.addPoint(150, 100, '', '');
  cal.addPoint(100, 150, '', r2);
  cal.addPoint(0, 250, '', '');
  cal.addPoint(0, 50, '', '');
  const axes = new CircularChartRecorderAxes();
  const ok = axes.calibrate(cal, startTime, 'week', 'anticlockwise');
  return { ok, axes };
}

describe('CircularChartRecorderAxes.calibrate refuses invalid input instead of succeeding silently', () => {
  it('refuses a non-numeric R0', () => {
    const { ok, axes } = calibrateCcr('abc', '100', '0');
    expect(ok).toBe(false);
    expect(axes.isCalibrated()).toBe(false);
  });

  it('refuses a non-numeric R2', () => {
    const { ok, axes } = calibrateCcr('0', 'xyz', '0');
    expect(ok).toBe(false);
    expect(axes.isCalibrated()).toBe(false);
  });

  it('refuses a blank Chart Start Time instead of silently becoming the Unix epoch', () => {
    const { ok, axes } = calibrateCcr('0', '100', '');
    expect(ok).toBe(false);
    expect(axes.isCalibrated()).toBe(false);
  });

  it('refuses a non-numeric, non-date Chart Start Time', () => {
    const { ok, axes } = calibrateCcr('0', '100', 'abc');
    expect(ok).toBe(false);
    expect(axes.isCalibrated()).toBe(false);
  });

  it('refuses a thousands separator in R0 -- the whole-string rule, like every other axes type', () => {
    const { ok } = calibrateCcr('1,000', '2000', '0');
    expect(ok).toBe(false);
  });

  it('isCalibrated() reflects real state, not a hardcoded false, once calibration succeeds', () => {
    const { ok, axes } = calibrateCcr('0', '100', '0');
    expect(ok).toBe(true);
    expect(axes.isCalibrated()).toBe(true);
  });

  it('isCalibrated() stays false before any calibrate() call', () => {
    const axes = new CircularChartRecorderAxes();
    expect(axes.isCalibrated()).toBe(false);
  });
});
