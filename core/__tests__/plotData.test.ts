import { describe, it, expect } from 'vitest';
import { PlotData } from '../plotData.js';
import { Dataset } from '../dataset.js';
import { Calibration } from '../calibration.js';
import { XYAxes } from '../axes/xy.js';
import { BarAxes } from '../axes/bar.js';
import { TernaryAxes } from '../axes/ternary.js';

describe('PlotData', () => {
  function buildXYProject(): PlotData {
    const pd = new PlotData();
    const cal = new Calibration(2);
    cal.addPoint(100, 500, '0', '0');
    cal.addPoint(500, 500, '10', '0');
    cal.addPoint(100, 500, '0', '0');
    cal.addPoint(100, 100, '0', '10');
    const axes = new XYAxes();
    axes.calibrate(cal, false, false, true);
    axes.name = 'XY Axes';
    pd.addAxes(axes);

    const ds = new Dataset();
    ds.name = 'Sample Dataset';
    ds.addPixel(100, 500);
    ds.addPixel(300, 300);
    ds.addPixel(500, 100);
    pd.addDataset(ds);
    pd.setAxesForDataset(ds, axes);

    return pd;
  }

  it('round-trips a synthetic XY project through serialize/deserialize', () => {
    const pd = buildXYProject();
    const serialized = pd.serialize();

    expect(serialized.version).toEqual([4, 2]);
    expect(serialized.axesColl).toHaveLength(1);
    expect(serialized.axesColl[0]!.type).toBe('XYAxes');
    expect(serialized.datasetColl).toHaveLength(1);
    // Serialized data-space values should reflect the calibration exactly.
    expect(serialized.datasetColl[0]!.data[0]!.value).toEqual([0, 0]);
    expect(serialized.datasetColl[0]!.data[2]!.value).toEqual([10, 10]);

    const pd2 = new PlotData();
    const result = pd2.deserialize(serialized as unknown as Parameters<PlotData['deserialize']>[0]);
    expect(result).not.toBe(false);

    expect(pd2.getAxesNames()).toEqual(['XY Axes']);
    expect(pd2.getDatasetNames()).toEqual(['Sample Dataset']);

    const ds2 = pd2.getDatasets()[0]!;
    const axes2 = pd2.getAxesForDataset(ds2)!;
    expect(axes2.name).toBe('XY Axes');
    expect(ds2.getCount()).toBe(3);
    // Re-derive data-space values from the re-hydrated axes+pixels and
    // confirm they match the original calibration exactly post-round-trip.
    const px = ds2.getPixel(1);
    const reDerived = axes2.pixelToData(px.x, px.y);
    expect(reDerived[0]).toBeCloseTo(5, 10);
    expect(reDerived[1]).toBeCloseTo(5, 10);
  });

  it('round-trips point groups (box-plot/error-bar tuples) correctly', () => {
    const pd = new PlotData();
    const cal = new Calibration(2);
    cal.addPoint(0, 500, 'ignored', '0');
    cal.addPoint(0, 100, 'ignored', '10');
    const axes = new BarAxes();
    axes.calibrate(cal, false, false);
    axes.name = 'Bar Axes';
    pd.addAxes(axes);

    const ds = new Dataset();
    ds.name = 'Grouped';
    ds.setPointGroups(['Value', 'Upper', 'Lower']);
    const idxVal = ds.addPixel(0, 300);
    const idxUp = ds.addPixel(0, 200);
    const idxLo = ds.addPixel(0, 400);
    const tupleIdx = ds.addTuple(idxVal)!;
    ds.addToTupleAt(tupleIdx, 1, idxUp);
    ds.addToTupleAt(tupleIdx, 2, idxLo);
    pd.addDataset(ds);
    pd.setAxesForDataset(ds, axes);

    const serialized = pd.serialize();
    expect(serialized.datasetColl[0]!.groupNames).toEqual(['Value', 'Upper', 'Lower']);
    expect(serialized.datasetColl[0]!.data[0]!.tuple).toBe(0);
    expect(serialized.datasetColl[0]!.data[0]!.group).toBe(0);
    expect(serialized.datasetColl[0]!.data[1]!.group).toBe(1);

    const pd2 = new PlotData();
    pd2.deserialize(serialized as unknown as Parameters<PlotData['deserialize']>[0]);
    const ds2 = pd2.getDatasets()[0]!;
    expect(ds2.getPointGroups()).toEqual(['Value', 'Upper', 'Lower']);
    expect(ds2.getPointGroupIndexInTuple(0, idxVal)).toBe(0);
    expect(ds2.getPointGroupIndexInTuple(0, idxUp)).toBe(1);
  });

  it('preserves ternary Normal orientation through a real JSON persistence cycle', () => {
    // Projects are persisted via JSON.stringify (engine/projectContainer.ts), so
    // the serialized object MUST survive a JSON round-trip, not just an in-memory
    // hand-off. A default (Normal) ternary calibration must reload as Normal;
    // otherwise pixelToData cyclically permutes [a,b,c] -> [c,a,b] and every
    // extracted datum is silently reassigned to the wrong component (Tenet 1).
    const pd = new PlotData();
    const cal = new Calibration(3);
    cal.addPoint(100, 500, '1', '0', '0'); // A vertex
    cal.addPoint(500, 500, '0', '1', '0'); // B vertex
    cal.addPoint(300, 100, '0', '0', '1'); // C vertex
    const axes = new TernaryAxes();
    axes.calibrate(cal, false, true); // range 0..1, Normal orientation
    axes.name = 'Ternary';
    pd.addAxes(axes);

    const ds = new Dataset();
    ds.name = 'Tern';
    ds.addPixel(300, 400); // an interior pixel with a distinct a/b/c triple
    pd.addDataset(ds);
    pd.setAxesForDataset(ds, axes);

    const before = axes.pixelToData(300, 400);

    const serialized = pd.serialize();
    // The genuine persistence path: JSON.stringify drops function-valued keys.
    const throughJson = JSON.parse(JSON.stringify(serialized));

    const pd2 = new PlotData();
    pd2.deserialize(throughJson as unknown as Parameters<PlotData['deserialize']>[0]);
    const ds2 = pd2.getDatasets()[0]!;
    const axes2 = pd2.getAxesForDataset(ds2)! as TernaryAxes;

    expect(axes2.isNormalOrientation()).toBe(true);
    const after = axes2.pixelToData(300, 400);
    expect(after[0]).toBeCloseTo(before[0]!, 10);
    expect(after[1]).toBeCloseTo(before[1]!, 10);
    expect(after[2]).toBeCloseTo(before[2]!, 10);
  });

  it('round-trips dataset metadata overrides (the live-data-table editable-cell mechanism)', () => {
    const pd = buildXYProject();
    const ds = pd.getDatasets()[0]!;
    ds.setMetadataAt(0, { overrides: { y: 99.5 } });
    ds.setMetadataKeys(['overrides']);

    const serialized = pd.serialize();
    expect(serialized.datasetColl[0]!.data[0]!.metadata).toEqual({ overrides: { y: 99.5 } });

    const pd2 = new PlotData();
    pd2.deserialize(serialized as unknown as Parameters<PlotData['deserialize']>[0]);
    const ds2 = pd2.getDatasets()[0]!;
    expect(ds2.getPixel(0).metadata).toEqual({ overrides: { y: 99.5 } });
  });
});
