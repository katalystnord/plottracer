import { describe, expect, it } from 'vitest';
import { BarAxes } from '../axes/bar.js';
import { Calibration } from '../calibration.js';

/**
 * Checkpoint 81 — finding A2: `BarAxes.calibrate` always returned `true`.
 *
 * Upstream reads its values with a bare `parseFloat`, never checks validity,
 * and ends with an unconditional `return true`. So Bar reported SUCCESS on
 * input XYAxes refuses — and that made
 * `BAR_AXES_CONFIG.buildAxes`'s own error message ("Calibration failed — check
 * the entered data values are valid numbers") **dead code that could never
 * fire**. The message was written, wired, and unreachable.
 */
function calibrateBar(dy1: string, dy2: string, isLog = false): { ok: boolean; axes: BarAxes } {
  const cal = new Calibration(2);
  cal.addPoint(100, 300, '0', dy1);
  cal.addPoint(100, 100, '0', dy2);
  const axes = new BarAxes();
  return { ok: axes.calibrate(cal, isLog, false), axes };
}

describe('BarAxes.calibrate refuses what it used to accept silently', () => {
  it('refuses non-numeric input instead of reporting success with NaN', () => {
    // The whole finding: `"abc"` gave p1 = NaN, calibrate() returned TRUE, and
    // every bar read back NaN with nothing on screen wrong.
    const { ok, axes } = calibrateBar('abc', '100');
    expect(ok).toBe(false);
    expect(axes.isCalibrated()).toBe(false);
  });

  it('refuses a thousands separator — Bar inherits the whole-string rule for free', () => {
    // Not a Bar-specific check: this comes from InputParser (ckpt 81's class
    // fix), which is the point of routing Bar through it rather than giving Bar
    // its own copy of the rule.
    expect(calibrateBar('0', '1,000').ok).toBe(false);
  });

  it('refuses units and malformed numbers', () => {
    expect(calibrateBar('0', '5 kg').ok).toBe(false);
    expect(calibrateBar('0', '1.2.3').ok).toBe(false);
  });

  it('refuses a date — BarAxes has no date concept to honour one with', () => {
    expect(calibrateBar('0', '2024/01/01').ok).toBe(false);
  });

  it('still calibrates a healthy bar chart, and reads back correctly', () => {
    const { ok, axes } = calibrateBar('0', '100');
    expect(ok).toBe(true);
    expect(axes.isCalibrated()).toBe(true);
    // py 200 is halfway between y1(300)=0 and y2(100)=100.
    expect(axes.pixelToData(100, 200)[0]).toBeCloseTo(50, 6);
  });

  it('still calibrates a log bar chart', () => {
    const { ok, axes } = calibrateBar('1', '1000', true);
    expect(ok).toBe(true);
    // halfway up three decades from 1 -> 1000 is 10^1.5.
    expect(axes.pixelToData(100, 200)[0]).toBeCloseTo(Math.pow(10, 1.5), 4);
  });
});
