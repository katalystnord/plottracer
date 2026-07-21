import { describe, expect, it } from 'vitest';
import {
  CalibrationSession,
  calibrationCompatible,
  XY_AXES_CONFIG,
  HISTOGRAM_AXES_CONFIG,
  BAR_AXES_CONFIG,
  POLAR_AXES_CONFIG,
} from '../calibrationSession.js';
import type { XYAxes } from '../../core/axes/xy.js';

/**
 * Checkpoint 87 — switching graph type keeps a compatible calibration.
 *
 * XY and Histogram share `XY_AXES_CONFIG.steps` byte-for-byte, so re-clicking
 * four calibration points to change a graph-type LABEL was pure waste (and the
 * old path threw the whole document away, unrecoverably).
 */
function calibrateXY(s: CalibrationSession<XYAxes>, logY = false) {
  if (logY) s.setOption('isLogY', 'true');
  const steps: Array<[number, number, string]> = [
    [100, 300, '0'],
    [400, 300, '10'],
    [100, 300, logY ? '1' : '0'],
    [100, 100, logY ? '1000' : '10'],
  ];
  for (const [px, py, v] of steps) {
    expect(s.handleCalibrationClick(px, py)).toBe('awaiting-value');
    expect(s.confirmCalibrationValues([v])).toBe(true);
  }
  expect(s.runCalibration()).toBe(true);
}

describe('calibrationCompatible', () => {
  it('is true for XY <-> Histogram (they share the step list)', () => {
    expect(calibrationCompatible(XY_AXES_CONFIG, HISTOGRAM_AXES_CONFIG)).toBe(true);
    expect(calibrationCompatible(HISTOGRAM_AXES_CONFIG, XY_AXES_CONFIG)).toBe(true);
  });

  it('is false across incompatible frames', () => {
    expect(calibrationCompatible(XY_AXES_CONFIG, BAR_AXES_CONFIG)).toBe(false); // 4 pts vs 2
    expect(calibrationCompatible(XY_AXES_CONFIG, POLAR_AXES_CONFIG)).toBe(false);
    expect(calibrationCompatible(BAR_AXES_CONFIG, POLAR_AXES_CONFIG)).toBe(false); // same count, diff kind
  });
});

describe('adoptCalibration — the transplant', () => {
  it('carries an XY calibration into a Histogram session without re-clicking', () => {
    const xy = new CalibrationSession(XY_AXES_CONFIG);
    calibrateXY(xy);

    const hist = new CalibrationSession(HISTOGRAM_AXES_CONFIG);
    expect(hist.isCalibrated()).toBe(false);
    expect(hist.adoptCalibration(xy.getCalibrationInputs())).toBe(true);
    expect(hist.isCalibrated()).toBe(true);

    // The adopted calibration reads a pixel the same way the source did.
    const a = xy.getAxes()!.pixelToData(250, 200);
    const b = hist.getAxes()!.pixelToData(250, 200);
    expect(b).toEqual(a);
  });

  it('carries the OPTIONS too — a log axis stays log', () => {
    const xy = new CalibrationSession(XY_AXES_CONFIG);
    calibrateXY(xy, true); // log Y over 1..1000

    const hist = new CalibrationSession(HISTOGRAM_AXES_CONFIG);
    hist.adoptCalibration(xy.getCalibrationInputs());
    expect(hist.getOptions()['isLogY']).toBe('true');
    // Same pixel, same (log-projected) value.
    expect(hist.getAxes()!.pixelToData(100, 200)).toEqual(xy.getAxes()!.pixelToData(100, 200));
  });

  it('leaves the adopting session\'s data alone — it transplants calibration only', () => {
    const xy = new CalibrationSession(XY_AXES_CONFIG);
    calibrateXY(xy);
    xy.addDataPoint(200, 200);

    const hist = new CalibrationSession(HISTOGRAM_AXES_CONFIG);
    hist.adoptCalibration(xy.getCalibrationInputs());
    // The fresh Histogram session's own (empty) dataset is untouched: adopting a
    // calibration says nothing about points, whose MEANING differs by type.
    expect(hist.getDataPoints()).toHaveLength(0);
  });
});
