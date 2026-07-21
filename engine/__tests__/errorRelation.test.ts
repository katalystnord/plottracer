import { describe, expect, it } from 'vitest';
import { CalibrationSession, XY_AXES_CONFIG } from '../calibrationSession.js';
import type { XYAxes } from '../../core/axes/xy.js';
import { Dataset } from '../../core/dataset.js';
import {
  getErrorRelation,
  setErrorRelation,
  hasErrorSeries,
  errorSeriesFor,
  retargetErrorRelations,
  clearErrorRelationsTo,
} from '../errorRelation.js';
import { PlotData } from '../../core/plotData.js';

function calibrateStandardXY(session: CalibrationSession<XYAxes>) {
  // The same 4-point setup the rest of engine/'s tests use: X1=0 @ (100,250),
  // X2=10 @ (400,250), Y1=0 @ (100,250), Y2=10 @ (100,100). So a pixel maps to
  // data as x = (px-100)/30, y = (250-py)/15.
  const steps: Array<[number, number, string]> = [
    [100, 250, '0'],
    [400, 250, '10'],
    [100, 250, '0'],
    [100, 100, '10'],
  ];
  for (const [px, py, value] of steps) {
    expect(session.handleCalibrationClick(px, py)).toBe('awaiting-value');
    expect(session.confirmCalibrationValues([value])).toBe(true);
  }
}

describe('errorRelation — storage on the dataset itself', () => {
  it('round-trips a relation through the dataset metadata', () => {
    const ds = new Dataset();
    expect(getErrorRelation(ds)).toBeNull();
    setErrorRelation(ds, { role: 'upper', of: 'Sample A' });
    expect(getErrorRelation(ds)).toEqual({ role: 'upper', of: 'Sample A' });
  });

  it('clears with null rather than storing an empty relation', () => {
    const ds = new Dataset();
    setErrorRelation(ds, { role: 'lower', of: 'Sample A' });
    setErrorRelation(ds, null);
    expect(getErrorRelation(ds)).toBeNull();
    expect(ds.getMetadata()).toEqual({});
  });

  it('does not disturb other metadata keys sharing the dataset', () => {
    // curveFit (ckpt 27) lives in the same bag; the error model must not be
    // the reason someone's fit disappears.
    const ds = new Dataset();
    ds.setMetadata({ curveFit: { degree: 2 } });
    setErrorRelation(ds, { role: 'upper', of: 'A' });
    setErrorRelation(ds, null);
    expect(ds.getMetadata()).toEqual({ curveFit: { degree: 2 } });
  });

  it('refuses a self-relation from a FILE, where no controller ever runs', () => {
    // The session's setErrorRelation refuses this, but that is the controller;
    // a relation also arrives from a file. Left to the controller alone, a
    // self-relating series resolves each of its own points as its own cap and
    // reports error of EXACTLY ZERO -- fabricated certainty, invisible because
    // a zero-length whisker draws nothing. Checkpoint 69's lesson (the guards
    // live in the controller, so the model silently drops them), caught by
    // execution against new code. Verified 2026-07-16.
    const ds = new Dataset();
    ds.name = 'Sample A';
    ds.setMetadata({ errorRelation: { role: 'upper', of: 'Sample A' } });
    expect(getErrorRelation(ds)).toBeNull();
    expect(errorSeriesFor([ds], 'Sample A')).toEqual([]);
  });

  it('reads a malformed relation as no relation, not as a wrong one', () => {
    // Metadata is free-form and survives a hand-edited file and a round trip
    // through upstream WPD, so junk is reachable without a bug of ours.
    // Degrading to an ordinary series shows every point; a bad cast would draw
    // a whisker somewhere arbitrary.
    const ds = new Dataset();
    ds.setMetadata({ errorRelation: { role: 'sideways', of: 'A' } });
    expect(getErrorRelation(ds)).toBeNull();
    ds.setMetadata({ errorRelation: { role: 'upper' } });
    expect(getErrorRelation(ds)).toBeNull();
    ds.setMetadata({ errorRelation: { role: 'upper', of: '  ' } });
    expect(getErrorRelation(ds)).toBeNull();
    ds.setMetadata({ errorRelation: 'upper of A' });
    expect(getErrorRelation(ds)).toBeNull();
  });

  it('survives a project save/load with no work from plotData (the whole point)', () => {
    // The design's claim is "no format invention" -- core/plotData.ts already
    // serializes a dataset's whole metadata object generically. If this ever
    // fails, the model needs a format change and the design doc is wrong.
    const ds = new Dataset();
    ds.name = 'SD';
    setErrorRelation(ds, { role: 'upper', of: 'Sample A' });
    const plotData = new PlotData();
    plotData.addDataset(ds);

    const restored = new PlotData();
    // deserialize returns boolean | DocumentMetadata -- truthy either way.
    expect(restored.deserialize(JSON.parse(JSON.stringify(plotData.serialize())))).toBeTruthy();
    expect(getErrorRelation(restored.getDatasets()[0]!)).toEqual({ role: 'upper', of: 'Sample A' });
  });
});

describe('errorRelation — finding the series related to one', () => {
  const build = () => {
    const target = new Dataset();
    target.name = 'Sample A';
    const upper = new Dataset();
    upper.name = 'SD';
    setErrorRelation(upper, { role: 'upper', of: 'Sample A' });
    const lower = new Dataset();
    lower.name = 'SD';
    setErrorRelation(lower, { role: 'lower', of: 'Sample A' });
    const unrelated = new Dataset();
    unrelated.name = 'Sample B';
    return [target, upper, lower, unrelated];
  };

  it('finds every series carrying error, with its role', () => {
    const datasets = build();
    expect(hasErrorSeries(datasets, 'Sample A')).toBe(true);
    expect(errorSeriesFor(datasets, 'Sample A').map((e) => e.role)).toEqual(['upper', 'lower']);
  });

  it('reports nothing for a series nothing relates to', () => {
    const datasets = build();
    expect(hasErrorSeries(datasets, 'Sample B')).toBe(false);
    expect(errorSeriesFor(datasets, 'Sample B')).toEqual([]);
  });
});

describe('errorRelation — the integrity cascade (relating BY NAME has to pay for itself)', () => {
  it('retargets every relation pointing at a renamed series', () => {
    const datasets = [new Dataset(), new Dataset()];
    setErrorRelation(datasets[0]!, { role: 'upper', of: 'Sample A' });
    setErrorRelation(datasets[1]!, { role: 'lower', of: 'Sample A' });
    retargetErrorRelations(datasets, 'Sample A', 'Sample A (cured)');
    expect(getErrorRelation(datasets[0]!)).toEqual({ role: 'upper', of: 'Sample A (cured)' });
    expect(getErrorRelation(datasets[1]!)).toEqual({ role: 'lower', of: 'Sample A (cured)' });
  });

  it('leaves relations pointing at other series alone', () => {
    const datasets = [new Dataset()];
    setErrorRelation(datasets[0]!, { role: 'upper', of: 'Sample B' });
    retargetErrorRelations(datasets, 'Sample A', 'Renamed');
    expect(getErrorRelation(datasets[0]!)).toEqual({ role: 'upper', of: 'Sample B' });
  });

  it('clears relations to a deleted series instead of leaving them dangling', () => {
    const datasets = [new Dataset()];
    setErrorRelation(datasets[0]!, { role: 'upper', of: 'Sample A' });
    clearErrorRelationsTo(datasets, 'Sample A');
    expect(getErrorRelation(datasets[0]!)).toBeNull();
  });
});

describe('CalibrationSession — the error relation (checkpoint 77)', () => {
  const session = () => new CalibrationSession(XY_AXES_CONFIG) as CalibrationSession<XYAxes>;

  it('declares and reads back a relation between two series', () => {
    const s = session();
    s.renameDataset(0, 'Sample A');
    const sd = s.addDataset('SD');
    expect(s.setErrorRelation(sd, { role: 'upper', of: 'Sample A' })).toBeNull();
    expect(s.getErrorRelation(sd)).toEqual({ role: 'upper', of: 'Sample A' });
  });

  it('refuses a series carrying error for itself', () => {
    const s = session();
    s.renameDataset(0, 'Sample A');
    expect(s.setErrorRelation(0, { role: 'upper', of: 'Sample A' })).toBe(
      'A series cannot carry error for itself.'
    );
    expect(s.getErrorRelation(0)).toBeNull();
  });

  it('refuses a relation to a name no series holds', () => {
    const s = session();
    const sd = s.addDataset('SD');
    expect(s.setErrorRelation(sd, { role: 'upper', of: 'Ghost' })).toBe(
      'There is no series called "Ghost".'
    );
  });

  it('a rename carries its relations with it — the link does not go stale', () => {
    // The bug this prevents is silent: the whisker simply stops being drawn,
    // and nothing on screen says why.
    const s = session();
    s.renameDataset(0, 'Sample A');
    const sd = s.addDataset('SD');
    s.setErrorRelation(sd, { role: 'upper', of: 'Sample A' });

    expect(s.renameDataset(0, 'Sample A (cured)')).toBeNull();
    expect(s.getErrorRelation(sd)).toEqual({ role: 'upper', of: 'Sample A (cured)' });
  });

  it('deleting the target clears the relation but keeps the measured points', () => {
    // Deleting the curve must not silently delete the numbers read off the
    // figure -- the error series survives as an ordinary, re-relatable series.
    const s = session();
    s.renameDataset(0, 'Sample A');
    const sd = s.addDataset('SD');
    s.setErrorRelation(sd, { role: 'upper', of: 'Sample A' });
    calibrateStandardXY(s);
    expect(s.runCalibration()).toBe(true);
    expect(s.addDataPoint(130, 200)).not.toBe('ignored');

    s.removeDataset(0);
    const remaining = s.getDatasets();
    expect(remaining.map((d) => d.name)).toEqual(['SD']);
    expect(getErrorRelation(remaining[0]!)).toBeNull();
    expect(remaining[0]!.getCount()).toBe(1);
  });

  it('resolves error from a related series onto the target\'s own points, in data space', () => {
    // End to end, through the real calibration: pixels -> data -> resolution.
    // With the standard XY setup, x = (px-100)/30 and y = (250-py)/15.
    const s = session();
    calibrateStandardXY(s);
    expect(s.runCalibration()).toBe(true);
    s.renameDataset(0, 'Sample A');
    expect(s.addDataPoint(160, 190)).not.toBe('ignored'); // (2, 4)

    const sd = s.addDataset('SD');
    s.setErrorRelation(sd, { role: 'upper', of: 'Sample A' });
    expect(s.addDataPoint(160, 160)).not.toBe('ignored'); // (2, 6) -- the cap

    const bars = s.getResolvedErrorBars(0);
    expect(bars).toHaveLength(1);
    expect(bars[0]!.x).toBeCloseTo(2);
    expect(bars[0]!.y).toBeCloseTo(4);
    expect(bars[0]!.yUpper).toBeCloseTo(6);
  });

  it('returns a series\' plain points when nothing is related to it', () => {
    const s = session();
    calibrateStandardXY(s);
    expect(s.runCalibration()).toBe(true);
    expect(s.addDataPoint(160, 190)).not.toBe('ignored');
    const bars = s.getResolvedErrorBars(0);
    expect(bars).toHaveLength(1);
    expect(bars[0]!.yUpper).toBeUndefined();
  });

  it('resolves nothing before calibration — a cap has no meaning in pixel space', () => {
    const s = session();
    expect(s.getResolvedErrorBars(0)).toEqual([]);
  });

  it('a dedupe rename on load does NOT retarget — first occurrence keeps the name', () => {
    // Deliberate divergence from renameDataset. A dedupe rename disambiguates
    // rather than changes identity: a file saying `of: "A"` while holding two
    // "A"s never said which, so it resolves to the first -- which still holds
    // the name. Cascading would move the link onto the collision just renamed
    // away, i.e. onto the wrong series.
    const s = session();
    const a1 = new Dataset();
    a1.name = 'A';
    const a2 = new Dataset();
    a2.name = 'A';
    const sd = new Dataset();
    sd.name = 'SD';
    setErrorRelation(sd, { role: 'upper', of: 'A' });

    calibrateStandardXY(s);
    expect(s.runCalibration()).toBe(true);
    const axes = s.getAxes()!;
    s.loadCalibrated(axes, [a1, a2, sd]);

    expect(s.getDatasets().map((d) => d.name)).toEqual(['A', 'A (2)', 'SD']);
    expect(s.getErrorRelation(2)).toEqual({ role: 'upper', of: 'A' });
  });
});
