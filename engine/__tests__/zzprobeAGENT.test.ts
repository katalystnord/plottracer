import { describe, expect, it } from 'vitest';
import { CalibrationSession, PIE_AXES_CONFIG, BAR_AXES_CONFIG } from '../calibrationSession.js';
import { serializeProject, deserializeProject } from '../projectFile.js';
import type { PieAxes } from '../../core/axes/pie.js';
import type { BarAxes } from '../../core/axes/bar.js';

const CX = 300, CY = 200, R = 120;
function at(deg: number, r = R): [number, number] {
  const t = (deg * Math.PI) / 180;
  return [CX + r * Math.cos(t), CY + r * Math.sin(t)];
}
function calibratedPie(): CalibrationSession<PieAxes> {
  const s = new CalibrationSession(PIE_AXES_CONFIG);
  for (const a of [90, 210, 330]) s.handleCalibrationClick(...at(a));
  s.setGlobalFieldValue('total', '100');
  expect(s.runCalibration()).toBe(true);
  return s;
}
function calibratedBar(): CalibrationSession<BarAxes> {
  const s = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
  s.handleCalibrationClick(300, 500);
  s.confirmCalibrationValues(['0']);
  s.handleCalibrationClick(300, 100);
  s.confirmCalibrationValues(['10']);
  expect(s.runCalibration()).toBe(true);
  return s;
}

describe('PROBE M: real UI undo ordering -> crash', () => {
  it('apex click (commit) -> edge click (commit) -> undo -> click', () => {
    const s = calibratedPie();
    const stack: ReturnType<typeof s.captureState>[] = [];
    s.addDataPoint(...at(-90)); stack.push(s.captureState());
    s.addDataPoint(...at(0));   stack.push(s.captureState());
    s.setNextSectorExploded(true);
    s.addDataPoint(CX + 20, CY + 20); stack.push(s.captureState()); // apex, committed
    s.addDataPoint(...at(60));        stack.push(s.captureState()); // edge 1, committed
    // Ctrl+Z -> back to the apex-committed state
    s.restoreState(stack[2]!);
    console.log('after undo tuples', JSON.stringify(s.getDataset().getAllTuples()),
      'cursor', s.getCurrentTupleIndex(), s.getCurrentSlotIndex(), 'stage', s.getExplodedStage());
    let err: string | null = null;
    try { s.addDataPoint(...at(60)); } catch (e) { err = String(e); }
    console.log('next click ->', err ?? 'ok');
  });
});

describe('PROBE N: orphan category survives save/load and permits duplicate names', () => {
  it('full round trip', () => {
    const s = calibratedBar();
    s.addDataPoint(150, 500); s.addDataPoint(150, 300);
    s.addDataPoint(250, 500); s.addDataPoint(250, 420);
    s.renameCategory(0, 'Flax');
    s.renameCategory(1, 'Hemp');
    s.removeTuple(1); // delete the Hemp bar
    const json = serializeProject({
      session: s as never, configId: 'bar', imageDataURL: 'data:,', measurements: [], measureScale: null, provenance: {},
    } as never);
    console.log('saved categoryAxisColl', JSON.stringify((JSON.parse(JSON.stringify(json)) as Record<string, unknown>)['plotData'] ?? json).slice(0, 400));
    const back = deserializeProject(JSON.parse(JSON.stringify(json)));
    if ('error' in back) { console.log('ERR', back.error); return; }
    const s2 = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    s2.loadCalibrated(back.axes as never, back.datasets, back.categoryAxis);
    console.log('reloaded table', JSON.stringify(s2.getBarCategoryTable()));
    // Add a new bar and name it Hemp again -> two rows both called Hemp
    s2.addDataPoint(350, 500); s2.addDataPoint(350, 200);
    const t = s2.getDataset().getTupleCount() - 1;
    console.log('setTupleLabel ->', s2.setTupleLabel(t, 'Hemp'));
    console.log('after retype', JSON.stringify(s2.getBarCategoryTable().categoryRawNames));
    console.log('table', JSON.stringify(s2.getBarCategoryTable().columns));
  });
});

describe('PROBE O: out-of-range categoryIndex on load', () => {
  it('a tuple pointing past the category list vanishes from the table', () => {
    const s = calibratedBar();
    s.addDataPoint(150, 500); s.addDataPoint(150, 300);
    s.addDataPoint(250, 500); s.addDataPoint(250, 420);
    s.renameCategory(0, 'Flax'); s.renameCategory(1, 'Hemp');
    const json = JSON.parse(JSON.stringify(serializeProject({
      session: s as never, configId: 'bar', imageDataURL: 'data:,', measurements: [], measureScale: null, provenance: {},
    } as never))) as Record<string, unknown>;
    // hand-edit: drop one category from the axis, leaving tuple 1 orphaned
    const pd = (json['plotData'] ?? json) as { categoryAxisColl?: { categories: string[] }[] };
    if (pd.categoryAxisColl) pd.categoryAxisColl[0]!.categories = ['Flax'];
    const back = deserializeProject(json);
    if ('error' in back) { console.log('ERR', back.error); return; }
    const s2 = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    s2.loadCalibrated(back.axes as never, back.datasets, back.categoryAxis);
    console.log('calibrationError', s2.getCalibrationError());
    console.log('tuples', s2.getDataset().getTupleCount(), 'table', JSON.stringify(s2.getBarCategoryTable()));
    console.log('tupleRows', JSON.stringify(s2.getTupleRows().map((r) => ({ t: r.tupleIndex, label: r.label, d: r.derived }))));
  });
});
