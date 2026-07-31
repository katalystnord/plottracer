import { describe, expect, it } from 'vitest';
import { BAR_AXES_CONFIG, CalibrationSession } from '../calibrationSession.js';
import type { BarAxes } from '../../core/axes/bar.js';

function calibratedBar(session: CalibrationSession<BarAxes>): void {
  session.handleCalibrationClick(300, 500);
  session.confirmCalibrationValues(['0']);
  session.handleCalibrationClick(300, 100);
  session.confirmCalibrationValues(['10']);
  expect(session.runCalibration()).toBe(true);
}

describe('PROBE A: orphaned categories', () => {
  it('removeTuple leaves the category behind forever', () => {
    const s = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    calibratedBar(s);
    s.addDataPoint(150, 500);
    s.addDataPoint(150, 300);
    s.addDataPoint(250, 500);
    s.addDataPoint(250, 420);
    expect(s.renameCategory(0, 'Flax')).toBe(true);
    expect(s.renameCategory(1, 'Hemp')).toBe(true);
    console.log('before delete', JSON.stringify(s.getBarCategoryTable()));
    s.removeTuple(1); // delete the Hemp bar
    const t = s.getBarCategoryTable();
    console.log('after removeTuple(1)', JSON.stringify(t));
    // now add a NEW bar -- does it reuse Hemp's slot or mint a third?
    s.addDataPoint(350, 500);
    s.addDataPoint(350, 200);
    console.log('after new bar', JSON.stringify(s.getBarCategoryTable()));
  });

  it('removeDataPoints (marquee) on a bar leaves orphans too', () => {
    const s = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    calibratedBar(s);
    s.addDataPoint(150, 500);
    s.addDataPoint(150, 300);
    s.removeDataPoints([0, 1]);
    console.log('after marquee delete', JSON.stringify(s.getBarCategoryTable()));
  });

  it('removeLastPoint / removeDataPointAt orphan too', () => {
    const s = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    calibratedBar(s);
    s.addDataPoint(150, 500);
    s.addDataPoint(150, 300);
    s.removeLastPoint();
    s.removeLastPoint();
    console.log('after removeLastPoint x2', JSON.stringify(s.getBarCategoryTable()));
    console.log('categories', JSON.stringify(s.getCategoryAxis().getCategories()));
  });

  it('removing a SERIES that solely owns categories', () => {
    const s = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    calibratedBar(s);
    s.addDataPoint(150, 500);
    s.addDataPoint(150, 300);
    s.setTupleLabel(0, 'Flax');
    const i2 = s.addDataset('Series 2');
    s.setActiveDataset(i2);
    s.addDataPoint(400, 500);
    s.addDataPoint(400, 200);
    s.setTupleLabel(0, 'OnlyInSeries2');
    console.log('2 series', JSON.stringify(s.getBarCategoryTable()));
    s.removeDataset(i2);
    s.setActiveDataset(0);
    console.log('after removeDataset(1)', JSON.stringify(s.getBarCategoryTable()));
  });
});

describe('PROBE B: undo round-trip of category metadata', () => {
  it('captureState -> restoreState keeps categoryIndex + names', () => {
    const s = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    calibratedBar(s);
    s.addDataPoint(150, 500);
    s.addDataPoint(150, 300);
    s.setTupleLabel(0, 'Flax');
    const snap = s.captureState();
    console.log('snapshot plotData', JSON.stringify(snap.plotData).slice(0, 2000));
    s.setTupleLabel(0, 'WRONG');
    s.restoreState(snap);
    console.log('after restore, label=', s.getTupleLabel(0));
    console.log('after restore, table=', JSON.stringify(s.getBarCategoryTable()));
  });

  it('stackGroup survives undo', () => {
    const s = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    calibratedBar(s);
    s.addDataPoint(150, 500);
    s.addDataPoint(150, 300);
    s.setDatasetStackGroup(0, 'left');
    const snap = s.captureState();
    s.setDatasetStackGroup(0, null);
    s.restoreState(snap);
    console.log('stackGroup after restore', s.getDatasetStackGroup(0));
  });
});

describe('PROBE C: duplicate category names', () => {
  it('two distinct indexes with the same name', () => {
    const s = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    calibratedBar(s);
    s.addDataPoint(150, 500);
    s.addDataPoint(150, 300);
    const i2 = s.addDataset('Series 2');
    s.setActiveDataset(i2);
    s.addDataPoint(400, 500);
    s.addDataPoint(400, 200);
    // rename BOTH categories to the same string via renameCategory (table path)
    expect(s.renameCategory(0, 'Flax')).toBe(true);
    expect(s.renameCategory(1, 'Flax')).toBe(true);
    console.log('dup names table', JSON.stringify(s.getBarCategoryTable()));
    // Now a THIRD bar in series 1 typed as 'Flax' via setTupleLabel
    s.setActiveDataset(0);
    s.addDataPoint(600, 500);
    s.addDataPoint(600, 400);
    console.log('after 3rd bar', JSON.stringify(s.getBarCategoryTable()));
  });
});
