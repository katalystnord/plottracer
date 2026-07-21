import { describe, it, expect } from 'vitest';
import { CalibrationSession, XY_AXES_CONFIG, BAR_AXES_CONFIG } from '../calibrationSession.js';
import { runGeometry } from '../geometryPanel.js';
import type { XYAxes } from '../../core/axes/xy.js';
import type { BarAxes } from '../../core/axes/bar.js';

function calibrateStandardXY(session: CalibrationSession<XYAxes>) {
  const steps: Array<[number, number, string]> = [
    [100, 250, '0'],
    [400, 250, '10'],
    [100, 250, '0'],
    [100, 100, '10'],
  ];
  for (const [px, py, value] of steps) {
    session.handleCalibrationClick(px, py);
    session.confirmCalibrationValues([value]);
  }
}

function calibrateStandardBar(session: CalibrationSession<BarAxes>) {
  const steps: Array<[number, number, string]> = [
    [300, 500, '0'],
    [300, 100, '10'],
  ];
  for (const [px, py, value] of steps) {
    session.handleCalibrationClick(px, py);
    session.confirmCalibrationValues([value]);
  }
}

describe('runGeometry', () => {
  it('computes exact arc length and area for a 2-point straight line (3-4-5 triangle)', () => {
    const session = new CalibrationSession(XY_AXES_CONFIG);
    calibrateStandardXY(session);
    session.runCalibration();
    session.addDataPoint(100, 250); // data (0, 0)
    session.addDataPoint(190, 190); // data (3, 4)

    const result = runGeometry(session.getDataset(), session.getAxes()!, false);
    if ('error' in result) throw new Error(`unexpected error: ${result.error}`);
    expect(result.geometry.arcLength).toBeCloseTo(5, 6);
    expect(result.geometry.area).toBeCloseTo(6, 6);
    expect(result.geometry.areaLabel).toBe('Area under curve');
  });

  it('switches to "Enclosed area" / shoelace computation when closed=true', () => {
    const session = new CalibrationSession(XY_AXES_CONFIG);
    calibrateStandardXY(session);
    session.runCalibration();
    session.addDataPoint(100, 250); // (0, 0)
    session.addDataPoint(250, 250); // (5, 0)
    session.addDataPoint(250, 175); // (5, 5)

    const open = runGeometry(session.getDataset(), session.getAxes()!, false);
    const closed = runGeometry(session.getDataset(), session.getAxes()!, true);
    if ('error' in open || 'error' in closed) throw new Error('unexpected error');
    expect(closed.geometry.areaLabel).toBe('Enclosed area');
    expect(closed.geometry.area).not.toBeCloseTo(open.geometry.area, 1);
  });

  it('rejects a dataset with fewer than 2 points, with a clear error', () => {
    const session = new CalibrationSession(XY_AXES_CONFIG);
    calibrateStandardXY(session);
    session.runCalibration();
    session.addDataPoint(100, 250);

    const result = runGeometry(session.getDataset(), session.getAxes()!, false);
    expect(result).toEqual({ error: expect.stringContaining('at least 2 points') });
  });

  it('rejects a dataset with point groups configured, with a clear error', () => {
    const session = new CalibrationSession(BAR_AXES_CONFIG);
    calibrateStandardBar(session);
    session.runCalibration();
    session.applyBoxPlotGroups();
    for (const py of [500, 460, 420, 380, 340]) session.addDataPoint(300, py);

    const result = runGeometry(session.getDataset(), session.getAxes()!, false);
    expect(result).toEqual({ error: expect.stringContaining('point groups') });
  });
});
