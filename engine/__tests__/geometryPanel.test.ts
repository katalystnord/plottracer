import { describe, it, expect } from 'vitest';
import { Dataset } from '../../core/dataset.js';
import { CalibrationSession, XY_AXES_CONFIG, BAR_AXES_CONFIG } from '../calibrationSession.js';
import { runGeometry, getGeometryState, setGeometryState } from '../geometryPanel.js';
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

  it('rejects a dataset with slots configured, with a clear error', () => {
    const session = new CalibrationSession(BAR_AXES_CONFIG);
    calibrateStandardBar(session);
    session.runCalibration();
    session.applyBoxPlotGroups();
    for (const py of [500, 460, 420, 380, 340]) session.addDataPoint(300, py);

    const result = runGeometry(session.getDataset(), session.getAxes()!, false);
    expect(result).toEqual({ error: expect.stringContaining('slots') });
  });
});

/**
 * The persisted geometry REQUEST (v1.1). It is what makes geometry a saved,
 * series-bound output rather than WPD's throwaway popup: Workspace writes it when
 * the user turns geometry on, and exportAssembly reads it to decide whether the
 * export carries a geometry section at all. It shares one metadata record with
 * every other per-series output, which is what the first test here is about.
 */
describe('geometry state on the dataset', () => {
  it('round-trips the open/closed choice, and reports none when unset', () => {
    const dataset = new Dataset();
    expect(getGeometryState(dataset)).toBeNull();
    setGeometryState(dataset, { closed: true });
    expect(getGeometryState(dataset)).toEqual({ closed: true });
    setGeometryState(dataset, { closed: false });
    expect(getGeometryState(dataset)).toEqual({ closed: false });
  });

  it('leaves the series’ OTHER outputs alone', () => {
    // The metadata record is shared — the curve fit and the error-bar relation
    // live in it too. Writing geometry by replacing the record instead of
    // extending it would silently delete them, and the user would find out at
    // export time.
    const dataset = new Dataset();
    dataset.setMetadata({ curveFit: { fn: 'a*x+b' }, errorRelation: 'symmetric' });
    setGeometryState(dataset, { closed: true });
    expect(dataset.getMetadata()).toEqual({
      curveFit: { fn: 'a*x+b' },
      errorRelation: 'symmetric',
      geometry: { closed: true },
    });
  });

  it('REMOVES the request when cleared, rather than leaving an empty one behind', () => {
    const dataset = new Dataset();
    setGeometryState(dataset, { closed: true });
    setGeometryState(dataset, null);
    // Absent, not present-and-undefined: the key's presence is what "geometry is
    // on for this series" means to every reader of the record.
    expect(Object.hasOwn(dataset.getMetadata(), 'geometry')).toBe(false);
    expect(getGeometryState(dataset)).toBeNull();
  });

  it('stores it under "geometry", which is a name in the saved file', () => {
    // Not an internal detail: the key travels into the project file, so renaming
    // it loses the request in every project already saved.
    const dataset = new Dataset();
    setGeometryState(dataset, { closed: true });
    expect(dataset.getMetadata()['geometry']).toEqual({ closed: true });
  });
});
