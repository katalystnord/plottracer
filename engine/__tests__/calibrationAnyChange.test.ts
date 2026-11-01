import { describe, expect, it } from 'vitest';
import { CalibrationSession, XY_AXES_CONFIG } from '../calibrationSession.js';
import type { XYAxes } from '../../core/axes/xy.js';

/**
 * ⚑⚑ ANY CHANGE TO THE CALIBRATION LOSES IT (David, 2026-10-31 and 2026-11-01,
 * docs/v2.7-workflow-walk.md step 3). A calibration point moved by a drag or a
 * one-pixel nudge, a typed value edited, an option such as Log X ticked: the
 * figure is "Not calibrated" until Calibrate is pressed again. Until v2.7 each of
 * these re-calibrated live; the rule now is one rule, "to be consistent".
 *
 * And any point can be placed at any time by choosing it (its chip in the card),
 * whatever placed the others: a click in the guided order, a choice, or a
 * detection. There is one way of calibrating, not a manual and an automatic one.
 */

// X1=0 @ (100,250), X2=10 @ (400,250), Y1=0 @ (100,250), Y2=10 @ (100,100).
function placeAll(session: CalibrationSession<XYAxes>): void {
  for (const [px, py, value] of [[100, 250, '0'], [400, 250, '10'], [100, 250, '0'], [100, 100, '10']] as const) {
    expect(session.handleCalibrationClick(px, py)).toBe('awaiting-value');
    expect(session.confirmCalibrationValues([value])).toBe(true);
  }
}

function calibrated(): CalibrationSession<XYAxes> {
  const s = new CalibrationSession<XYAxes>(XY_AXES_CONFIG);
  placeAll(s);
  expect(s.runCalibration()).toBe(true);
  return s;
}

describe('any change to the calibration loses it', () => {
  it('moving a calibration point makes the figure Not calibrated, and the data points stay where they are', () => {
    const s = calibrated();
    s.addDataPoint(250, 175);
    s.updateCalibPointPixel('x2', 380, 250);
    expect(s.isCalibrated()).toBe(false);
    const p = s.getDataPoints()[0]!;
    expect([p.px, p.py]).toEqual([250, 175]);
    expect(p.data).toBeNull();
  });

  it('a one-pixel nudge loses it too', () => {
    const s = calibrated();
    s.updateCalibPointPixel('y2', 100, 99);
    expect(s.isCalibrated()).toBe(false);
  });

  it('editing a point\'s typed value loses it', () => {
    const s = calibrated();
    expect(s.setCalibrationValues('x2', ['20'])).toBe(true);
    expect(s.isCalibrated()).toBe(false);
    expect(s.getPlacedPoints()['x2']!.values).toEqual(['20']);
  });

  it('ticking an option such as Log X loses it', () => {
    const s = calibrated();
    s.setOption('isLogX', 'true');
    expect(s.isCalibrated()).toBe(false);
  });

  it('after a change nothing is asked for but Calibrate, and Calibrate reads the data with the new calibration', () => {
    const s = calibrated();
    s.addDataPoint(250, 175);
    s.updateCalibPointPixel('x2', 250, 250); // X2 = 10 now sits where X = 5 was
    expect(s.getCurrentStep()).toBeNull();
    expect(s.runCalibration()).toBe(true);
    expect(s.getDataPoints()[0]!.data![0]).toBeCloseTo(10, 6);
  });

  it('turning the whole image keeps the calibration: nothing about it changed, every point moved together', () => {
    const s = calibrated();
    s.setImageHeight(400);
    s.transformAllPixels((x, y) => ({ x: y, y: x }));
    expect(s.isCalibrated()).toBe(true);
  });
});

describe('any calibration point can be placed at any time, by choosing it', () => {
  it('choosing X2 first places X2 with the next click, and then the walk asks for the first point still missing', () => {
    const s = new CalibrationSession<XYAxes>(XY_AXES_CONFIG);
    expect(s.chooseStep('x2')).toBe(true);
    expect(s.getCurrentStep()!.key).toBe('x2');
    expect(s.handleCalibrationClick(400, 250)).toBe('awaiting-value');
    expect(s.confirmCalibrationValues(['10'])).toBe(true);
    expect(s.getPlacedPoints()['x2']).toEqual({ px: 400, py: 250, values: ['10'] });
    expect(s.getCurrentStep()!.key).toBe('x1');
  });

  it('choosing a point that is already placed places it again', () => {
    const s = new CalibrationSession<XYAxes>(XY_AXES_CONFIG);
    placeAll(s);
    expect(s.chooseStep('y2')).toBe(true);
    s.handleCalibrationClick(100, 90);
    expect(s.confirmCalibrationValues(['12'])).toBe(true);
    expect(s.getPlacedPoints()['y2']).toEqual({ px: 100, py: 90, values: ['12'] });
    expect(s.getCurrentStep()).toBeNull();
  });

  it('on a calibrated figure, choosing a point changes nothing until it is placed, and placing it loses the calibration', () => {
    const s = calibrated();
    expect(s.chooseStep('y2')).toBe(true);
    expect(s.isCalibrated()).toBe(true);
    expect(s.getCurrentStep()!.key).toBe('y2');
    s.handleCalibrationClick(100, 90);
    expect(s.confirmCalibrationValues(['12'])).toBe(true);
    expect(s.isCalibrated()).toBe(false);
  });

  it('a point that is not a step of this graph type cannot be chosen', () => {
    const s = new CalibrationSession<XYAxes>(XY_AXES_CONFIG);
    expect(s.chooseStep('nope')).toBe(false);
    expect(s.getCurrentStep()!.key).toBe('x1');
  });
});

/**
 * While the figure is Not calibrated the data table keeps its rows and greys out the values (David, 2026-11-01:
 * "just greying out the values"). The greyed numbers are the last calibration's reading; the record, the canvas
 * and the export still treat the figure as Not calibrated.
 */
describe('while Not calibrated, the table reads the points with the last calibration', () => {
  it('after a handle is moved, the table still reads the point as the last calibration did', () => {
    const s = calibrated();
    s.addDataPoint(250, 175);
    s.updateCalibPointPixel('x2', 250, 250);
    const read = s.readWithLastCalibration(() => s.getDataPoints()[0]!.data);
    expect(read![0]).toBeCloseTo(5, 6);
    expect(read![1]).toBeCloseTo(5, 6);
    expect(s.isCalibrated()).toBe(false);
    expect(s.showsLastCalibration()).toBe(true);
    expect(s.getDataPoints()[0]!.data).toBeNull();
  });

  it('Calibrate replaces the last reading with the new one', () => {
    const s = calibrated();
    s.addDataPoint(250, 175);
    s.updateCalibPointPixel('x2', 250, 250);
    expect(s.runCalibration()).toBe(true);
    expect(s.readWithLastCalibration(() => s.getDataPoints()[0]!.data)![0]).toBeCloseTo(10, 6);
  });

  it('a figure that was never calibrated has no last reading', () => {
    const s = new CalibrationSession<XYAxes>(XY_AXES_CONFIG);
    placeAll(s);
    expect(s.showsLastCalibration()).toBe(false);
    expect(s.readWithLastCalibration(() => s.isCalibrated())).toBe(false);
  });

  it('Reset calibration forgets the last reading', () => {
    const s = calibrated();
    s.addDataPoint(250, 175);
    s.updateCalibPointPixel('x2', 250, 250);
    s.reset();
    placeAll(s);
    expect(s.showsLastCalibration()).toBe(false);
    expect(s.readWithLastCalibration(() => s.isCalibrated())).toBe(false);
  });

  it('a read that throws still leaves the figure Not calibrated', () => {
    const s = calibrated();
    s.updateCalibPointPixel('x2', 250, 250);
    expect(() => s.readWithLastCalibration(() => { throw new Error('boom'); })).toThrow('boom');
    expect(s.isCalibrated()).toBe(false);
  });
});
