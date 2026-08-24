import { describe, expect, it } from 'vitest';
import { flatDataSection } from '../csvExport.js';
import {
  serializeProject,
  deserializeProject,
  serializeMultiFigureProject,
  deserializeMultiFigureProject,
} from '../projectFile.js';
import { CalibrationSession, XY_AXES_CONFIG, BAR_AXES_CONFIG, CIRCULAR_CHART_RECORDER_AXES_CONFIG } from '../calibrationSession.js';
import type { XYAxes } from '../../core/axes/xy.js';
import type { BarAxes } from '../../core/axes/bar.js';
import type { CircularChartRecorderAxes } from '../../core/axes/circularChartRecorder.js';
import { walkCategoryAxis } from './helpers/categoryWalk.js';

// Same fixtures as calibrationSession.test.ts's calibrateStandardXY/Bar/CCR --
// duplicated locally rather than imported, since that file doesn't export them.
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

// Slash-delimited, unlike calibrationSession.test.ts's own CCR fixture --
// core/dateConversion.ts's toJD only recognizes a date part (as opposed to
// time-only) when '/' is present (hasDatePart), so this specific round-trip
// test (which checks getStartTime()'s *formatted string* output, not just
// that pixelToData produces a finite number) needs a string that actually
// parses as a date, not just one that happens to calibrate successfully.
function calibrateStandardCCR(session: CalibrationSession<CircularChartRecorderAxes>) {
  session.handleCalibrationClick(200, 200);
  session.confirmCalibrationValues(['2024/01/01 00:00', '1']);
  session.handleCalibrationClick(400, 200);
  session.handleCalibrationClick(300, 100);
  session.confirmCalibrationValues(['10']);
  session.handleCalibrationClick(200, 400);
  session.handleCalibrationClick(400, 400);
}

const FAKE_IMAGE_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

describe('serializeProject', () => {
  it('fails with a clear error for an uncalibrated session', () => {
    const session = new CalibrationSession(XY_AXES_CONFIG);
    const result = serializeProject(session, FAKE_IMAGE_DATA_URL);
    expect(result).toEqual({ error: 'Calibrate the axes before saving a project.' });
  });

  it('embeds the image data URL and file name alongside the serialized plotData', () => {
    const session = new CalibrationSession(XY_AXES_CONFIG);
    calibrateStandardXY(session);
    session.runCalibration();

    const result = serializeProject(session, FAKE_IMAGE_DATA_URL, 'figure3.png');
    if ('error' in result) throw new Error(`unexpected error: ${result.error}`);
    expect(result.plotTracerProject).toBe(1);
    expect(result.image).toEqual({ dataURL: FAKE_IMAGE_DATA_URL, fileName: 'figure3.png' });
    expect(result.plotData.axesColl).toHaveLength(1);
    expect(result.plotData.axesColl[0]!.type).toBe('XYAxes');
    expect(result.plotData.datasetColl).toHaveLength(1);
  });

  it('omits fileName entirely when none is given, rather than writing it as undefined', () => {
    const session = new CalibrationSession(XY_AXES_CONFIG);
    calibrateStandardXY(session);
    session.runCalibration();

    const result = serializeProject(session, FAKE_IMAGE_DATA_URL);
    if ('error' in result) throw new Error(`unexpected error: ${result.error}`);
    expect('fileName' in result.image).toBe(false);
  });

  it('records provenance crops when given, and omits the key when there are none (checkpoint 95)', () => {
    const session = new CalibrationSession(XY_AXES_CONFIG);
    calibrateStandardXY(session);
    session.runCalibration();

    const withCrop = serializeProject(session, FAKE_IMAGE_DATA_URL, undefined, undefined, {
      crops: [{ fromWidth: 1200, fromHeight: 800, rect: { x: 100, y: 50, width: 400, height: 300 } }],
    });
    if ('error' in withCrop) throw new Error(withCrop.error);
    expect(withCrop.provenance?.crops).toHaveLength(1);
    expect(withCrop.provenance?.crops?.[0]?.fromWidth).toBe(1200);

    // No crops -> no provenance key at all (same omit-when-empty rule as measures).
    const noCrop = serializeProject(session, FAKE_IMAGE_DATA_URL, undefined, undefined, { crops: [] });
    if ('error' in noCrop) throw new Error(noCrop.error);
    expect('provenance' in noCrop).toBe(false);
  });

  it('records a PDF source (name + page) as provenance (checkpoint 97)', () => {
    const session = new CalibrationSession(XY_AXES_CONFIG);
    calibrateStandardXY(session);
    session.runCalibration();

    const sourced = serializeProject(session, FAKE_IMAGE_DATA_URL, undefined, undefined, {
      source: { name: 'paper.pdf', page: 4 },
    });
    if ('error' in sourced) throw new Error(sourced.error);
    expect(sourced.provenance?.source).toEqual({ name: 'paper.pdf', page: 4 });

    // An empty source object still counts as nothing to record.
    const empty = serializeProject(session, FAKE_IMAGE_DATA_URL, undefined, undefined, { source: {} });
    if ('error' in empty) throw new Error(empty.error);
    expect('provenance' in empty).toBe(false);
  });

  it('omits categoryAxisColl entirely for a plain XY project -- every pre-v2.0 file stayed this shape', () => {
    // v2.0: a session's CategoryAxis (BAR_AXES_CONFIG's, or a fresh unused one
    // on any other type) must not add a categoryAxisColl key to every saved
    // file regardless of graph type -- that would grow every plain XY/polar/
    // spider project's file for a capability it never uses, unlike
    // captureState's undo snapshot (in memory only, so "unconditional, costs
    // nothing" holds there but not on disk).
    const session = new CalibrationSession(XY_AXES_CONFIG);
    calibrateStandardXY(session);
    session.runCalibration();

    const result = serializeProject(session, FAKE_IMAGE_DATA_URL);
    if ('error' in result) throw new Error(`unexpected error: ${result.error}`);
    expect(result.plotData.categoryAxisColl).toBeUndefined();
    expect(result.plotData.datasetColl[0]!.categoryAxisName).toBeUndefined();
  });

  it('writes categoryAxisColl once a Bar session actually names a category', () => {
    const session = new CalibrationSession(BAR_AXES_CONFIG);
    calibrateStandardBar(session);
    walkCategoryAxis(session);
    session.runCalibration();
    session.addDataPoint(150, 500);
    session.addDataPoint(150, 300);
    session.setTupleLabel(0, 'Wheat');

    const result = serializeProject(session, FAKE_IMAGE_DATA_URL);
    if ('error' in result) throw new Error(`unexpected error: ${result.error}`);
    expect(result.plotData.categoryAxisColl).toHaveLength(1);
    // ⚑ FOUR entries, because the walk DECLARED four categories and one of them
    // has been named. An unnamed category is not an absent one: it is a band the
    // figure has, which is exactly what the declaration is for.
    expect(result.plotData.categoryAxisColl?.[0]?.categories).toEqual(['Wheat', '', '', '']);
    // ⚑ …and the geometry rides with it, so a reopened project has the axis it
    // was calibrated with rather than asking for it again.
    expect(result.plotData.categoryAxisColl?.[0]?.geometry?.countDeclared).toBe(true);
    expect(result.plotData.datasetColl[0]!.categoryAxisName).toBe(result.plotData.categoryAxisColl?.[0]?.name);
  });
});

describe('deserializeProject', () => {
  it('rejects non-objects and objects missing the required fields', () => {
    expect(deserializeProject(null)).toEqual({ error: 'Not a valid project file.' });
    expect(deserializeProject('a string')).toEqual({ error: 'Not a valid project file.' });
    expect(deserializeProject({})).toEqual({ error: 'Not a valid PlotTracer project file.' });
    expect(deserializeProject({ plotTracerProject: 1 })).toEqual({ error: 'Not a valid PlotTracer project file.' });
  });

  it('rejects a project file with no axes at all', () => {
    const result = deserializeProject({
      plotTracerProject: 1,
      image: { dataURL: FAKE_IMAGE_DATA_URL },
      plotData: { version: [4, 2], axesColl: [], datasetColl: [], measurementColl: [] },
    });
    expect(result).toEqual({ error: 'Project file has no calibrated axes.' });
  });

  it('rejects a plotData version this build does not recognize, visibly (v2.0 Phase 8)', () => {
    // ⚑ Before core/plotData.ts's own hardening, an unrecognized version fell
    // through to a silent empty PlotData reported as SUCCESS -- so this path
    // would have read "Project file has no calibrated axes or dataset."
    // (a confusing error blaming the wrong thing) rather than the actual
    // problem: the file's format itself could not be read. A real-looking
    // axesColl[0].type is needed so the EARLIER "no calibrated axes" guard
    // (which reads the raw JSON directly, before plotData.deserialize runs
    // at all) doesn't mask what's actually under test here.
    const result = deserializeProject({
      plotTracerProject: 1,
      image: { dataURL: FAKE_IMAGE_DATA_URL },
      plotData: { version: [99, 0], axesColl: [{ name: 'X', type: 'XYAxes' }], datasetColl: [], measurementColl: [] },
    });
    expect(result).toEqual({ error: 'Failed to parse project data.' });
  });

  it('round-trips a calibrated XY session exactly: axes, dataset points, and image', () => {
    const session = new CalibrationSession(XY_AXES_CONFIG);
    calibrateStandardXY(session);
    session.runCalibration();
    session.addDataPoint(250, 175);
    session.addDataPoint(100, 250);

    const serialized = serializeProject(session, FAKE_IMAGE_DATA_URL, 'figure3.png');
    if ('error' in serialized) throw new Error(`unexpected error: ${serialized.error}`);

    // Round-trip through JSON, exactly like a real save-to-disk/reopen would.
    const reparsed: unknown = JSON.parse(JSON.stringify(serialized));
    const result = deserializeProject(reparsed);
    if ('error' in result) throw new Error(`unexpected error: ${result.error}`);

    expect(result.configId).toBe('xy');
    expect(result.imageDataURL).toBe(FAKE_IMAGE_DATA_URL);
    expect(result.imageFileName).toBe('figure3.png');

    const newSession = new CalibrationSession(XY_AXES_CONFIG);
    newSession.loadCalibrated(result.axes as XYAxes, result.datasets);
    expect(newSession.isCalibrated()).toBe(true);
    const points = newSession.getDataPoints();
    expect(points).toHaveLength(2);
    points[0]!.data!.forEach((v, i) => expect(v).toBeCloseTo([5, 5][i]!, 10));
    points[1]!.data!.forEach((v, i) => expect(v).toBeCloseTo([0, 0][i]!, 10));

    // Calibration handles round-trip too, not just the axes math -- markers
    // in Workspace.tsx are built from getPlacedPoints(), not the axes object.
    const placed = newSession.getPlacedPoints();
    expect(placed['x1']).toEqual({ px: 100, py: 250, values: ['0'] });
    expect(placed['y2']).toEqual({ px: 100, py: 100, values: ['10'] });
  });

  it('round-trips interpolation-assist anchor/interpolated roles (checkpoint 120)', () => {
    const session = new CalibrationSession(XY_AXES_CONFIG);
    calibrateStandardXY(session);
    session.runCalibration();
    // Two anchors -> a derived fill between them; roles live in per-pixel metadata.
    session.addAnchorPoint(120, 240);
    session.addAnchorPoint(380, 120);
    const before = session.getDataPointRoles();
    expect(before.filter((r) => r === 'anchor')).toHaveLength(2);
    expect(before.filter((r) => r === 'interpolated').length).toBeGreaterThan(0);

    const serialized = serializeProject(session, FAKE_IMAGE_DATA_URL, 'figure3.png');
    if ('error' in serialized) throw new Error(`unexpected error: ${serialized.error}`);

    // Round-trip through JSON exactly like a real save-to-disk / reopen would.
    const reparsed: unknown = JSON.parse(JSON.stringify(serialized));
    const result = deserializeProject(reparsed);
    if ('error' in result) throw new Error(`unexpected error: ${result.error}`);

    const newSession = new CalibrationSession(XY_AXES_CONFIG);
    newSession.loadCalibrated(result.axes as XYAxes, result.datasets);
    // Roles survive the save/reopen, index-aligned with the reopened points, so
    // a downstream consumer can still tell measured (anchor) from derived
    // (interpolated) -- the whole tenet-9 point of keeping both.
    expect(newSession.getDataPointRoles()).toEqual(before);
    expect(newSession.getDataPoints()).toHaveLength(before.length);
  });

  it('round-trips Measure results + scale, and defaults them empty for older files (checkpoint 56)', () => {
    const session = new CalibrationSession(XY_AXES_CONFIG);
    calibrateStandardXY(session);
    session.runCalibration();

    const measurements = [
      {
        id: 'meas-1',
        tool: 'distance',
        value: '100 mm',
        note: '300 px',
        points: [
          { x: 10, y: 20 },
          { x: 310, y: 20 },
        ],
        label: '100 mm',
        labelAt: { x: 160, y: 20 },
      },
    ];
    const scale = { unitPerPx: 0.3333, unit: 'mm' };
    const serialized = serializeProject(session, FAKE_IMAGE_DATA_URL, undefined, { measurements, scale });
    if ('error' in serialized) throw new Error(`unexpected error: ${serialized.error}`);

    const result = deserializeProject(JSON.parse(JSON.stringify(serialized)));
    if ('error' in result) throw new Error(`unexpected error: ${result.error}`);
    expect(result.measurements).toEqual(measurements);
    expect(result.measureScale).toEqual(scale);

    // A pre-56 file (no measurements/measureScale keys) deserializes to empty.
    const older = { ...(serialized as object) } as Record<string, unknown>;
    delete older.measurements;
    delete older.measureScale;
    const olderResult = deserializeProject(JSON.parse(JSON.stringify(older)));
    if ('error' in olderResult) throw new Error(`unexpected error: ${olderResult.error}`);
    expect(olderResult.measurements).toEqual([]);
    expect(olderResult.measureScale).toBeNull();
  });

  it('round-trips multiple datasets/series under the same axes (checkpoint 30)', () => {
    const session = new CalibrationSession(XY_AXES_CONFIG);
    calibrateStandardXY(session);
    session.runCalibration();
    session.renameDataset(0, 'Control');
    session.addDataPoint(250, 175); // Control: (5, 5)
    session.addDataset('Treated');
    session.setDatasetColor(1, [10, 20, 30]);
    session.addDataPoint(100, 100); // Treated: (0, 10)

    const serialized = serializeProject(session, FAKE_IMAGE_DATA_URL);
    if ('error' in serialized) throw new Error(`unexpected error: ${serialized.error}`);
    expect(serialized.plotData.datasetColl).toHaveLength(2);

    const result = deserializeProject(JSON.parse(JSON.stringify(serialized)));
    if ('error' in result) throw new Error(`unexpected error: ${result.error}`);
    expect(result.datasets).toHaveLength(2);

    const newSession = new CalibrationSession(XY_AXES_CONFIG);
    newSession.loadCalibrated(result.axes as XYAxes, result.datasets);
    expect(newSession.getDatasetCount()).toBe(2);

    const infos = newSession.getDatasetInfos();
    expect(infos[0]!.name).toBe('Control');
    expect(infos[1]!.name).toBe('Treated');
    expect(infos[1]!.color).toEqual([10, 20, 30]);

    newSession.setActiveDataset(0);
    expect(newSession.getDataPoints()[0]!.data).toEqual(expect.arrayContaining([expect.closeTo(5, 6)]));
    newSession.setActiveDataset(1);
    const treatedPoint = newSession.getDataPoints()[0]!.data!;
    expect(treatedPoint[0]).toBeCloseTo(0, 6);
    expect(treatedPoint[1]).toBeCloseTo(10, 6);
  });

  it('round-trips a Box Plot (Bar + Point Groups) session, including tuple labels', () => {
    const session = new CalibrationSession(BAR_AXES_CONFIG);
    calibrateStandardBar(session);
    walkCategoryAxis(session);
    session.runCalibration();
    session.applyBoxPlotGroups();
    for (const py of [500, 460, 420, 380, 340]) session.addDataPoint(300, py);
    session.setTupleLabel(0, 'Sample A');

    const serialized = serializeProject(session, FAKE_IMAGE_DATA_URL);
    if ('error' in serialized) throw new Error(`unexpected error: ${serialized.error}`);
    const result = deserializeProject(JSON.parse(JSON.stringify(serialized)));
    if ('error' in result) throw new Error(`unexpected error: ${result.error}`);
    expect(result.configId).toBe('bar');

    const newSession = new CalibrationSession(BAR_AXES_CONFIG);
    newSession.loadCalibrated(result.axes as BarAxes, result.datasets, result.categoryAxis);
    expect(newSession.hasSlots()).toBe(true);
    expect(newSession.getSlotNames()).toEqual(['Min', 'Q1', 'Median', 'Q3', 'Max']);
    const rows = newSession.getTupleRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.label).toBe('Sample A');
    expect(rows[0]!.points.every((p) => p !== null)).toBe(true);
    // The completed tuple's cursor should have rolled to a fresh one, same as
    // it would have live -- recomputePointGroupCursor's "no open slot found" path.
    expect(newSession.getCurrentTupleIndex()).toBeNull();
    expect(newSession.getBoxPlotGlyphs()).toHaveLength(1);
  });

  it('round-trips a first-class Bar session\'s category, and its SHARED identity survives too', () => {
    // The real defect this test was written against (v2.0 Phase 6): loadCalibrated
    // had no way to receive the file's own CategoryAxis, so ANY reopened bar/box-plot
    // project lost every category's shared identity even though its NAME still
    // happened to read back correctly via the dataset's own pixel metadata -- a
    // rename through the CategoryAxis itself (e.g. a "manage categories" UI) would
    // silently stop reaching the reopened tuple. Proven here by round-tripping,
    // then renaming through the file's OWN restored CategoryAxis instance.
    const session = new CalibrationSession(BAR_AXES_CONFIG);
    calibrateStandardBar(session);
    walkCategoryAxis(session);
    session.runCalibration();
    session.addDataPoint(150, 500);
    session.addDataPoint(150, 300);
    session.setTupleLabel(0, 'Wheat');

    const serialized = serializeProject(session, FAKE_IMAGE_DATA_URL);
    if ('error' in serialized) throw new Error(`unexpected error: ${serialized.error}`);
    const result = deserializeProject(JSON.parse(JSON.stringify(serialized)));
    if ('error' in result) throw new Error(`unexpected error: ${result.error}`);

    const newSession = new CalibrationSession(BAR_AXES_CONFIG);
    newSession.loadCalibrated(result.axes as BarAxes, result.datasets, result.categoryAxis);
    expect(newSession.getTupleLabel(0)).toBe('Wheat');

    // The regression itself: renaming through the RESTORED CategoryAxis (not
    // through setTupleLabel) must reach the reloaded tuple's read -- proving the
    // dataset's categoryIndex resolves against the SAME instance the file carried,
    // not a fresh disconnected one loadCalibrated would otherwise default to.
    const idx = newSession.getCategoryAxis().getCategoryIndex('Wheat');
    expect(idx).toBeGreaterThanOrEqual(0);
    newSession.getCategoryAxis().renameCategory(idx, 'Hemp');
    expect(newSession.getTupleLabel(0)).toBe('Hemp');
  });

  it('a file predating v2.0 (no categoryAxisColl) opens with a fresh empty CategoryAxis, not a crash', () => {
    const session = new CalibrationSession(BAR_AXES_CONFIG);
    calibrateStandardBar(session);
    walkCategoryAxis(session);
    session.runCalibration();
    session.addDataPoint(150, 500);
    session.addDataPoint(150, 300);
    session.setTupleLabel(0, 'Wheat');

    const serialized = serializeProject(session, FAKE_IMAGE_DATA_URL);
    if ('error' in serialized) throw new Error(`unexpected error: ${serialized.error}`);
    // Simulate a pre-v2.0 file: strip the category axis collection entirely.
    const stripped = JSON.parse(JSON.stringify(serialized));
    delete stripped.plotData.categoryAxisColl;
    for (const ds of stripped.plotData.datasetColl ?? []) delete ds.categoryAxisName;

    const result = deserializeProject(stripped);
    if ('error' in result) throw new Error(`unexpected error: ${result.error}`);
    expect(result.categoryAxis.getCategoryCount()).toBe(0);

    const newSession = new CalibrationSession(BAR_AXES_CONFIG);
    expect(() => newSession.loadCalibrated(result.axes as BarAxes, result.datasets, result.categoryAxis)).not.toThrow();
  });

  it('round-trips a Circular Chart Recorder session, restoring the Chart Start Time global field', () => {
    const session = new CalibrationSession(CIRCULAR_CHART_RECORDER_AXES_CONFIG);
    calibrateStandardCCR(session);
    session.setGlobalFieldValue('startTime', '2024/01/01 00:00');
    session.runCalibration();

    const serialized = serializeProject(session, FAKE_IMAGE_DATA_URL);
    if ('error' in serialized) throw new Error(`unexpected error: ${serialized.error}`);
    const result = deserializeProject(JSON.parse(JSON.stringify(serialized)));
    if ('error' in result) throw new Error(`unexpected error: ${result.error}`);
    expect(result.configId).toBe('ccr');

    const newSession = new CalibrationSession(CIRCULAR_CHART_RECORDER_AXES_CONFIG);
    newSession.loadCalibrated(result.axes as CircularChartRecorderAxes, result.datasets);
    expect(newSession.getGlobalFieldValues()).toEqual({ startTime: '2024/01/01 00:00' });
    expect(newSession.isCalibrated()).toBe(true);
  });

  it('reports an unsupported-axes-type error for a plotData with an ImageAxes entry', () => {
    const result = deserializeProject({
      plotTracerProject: 1,
      image: { dataURL: FAKE_IMAGE_DATA_URL },
      plotData: { version: [4, 2], axesColl: [{ name: 'Image', type: 'ImageAxes' }], datasetColl: [], measurementColl: [] },
    });
    expect(result).toEqual({ error: 'Unsupported axes type in project file: ImageAxes' });
  });

  it('reads provenance back, defaulting to {} for a pre-95 file (checkpoint 95)', () => {
    const session = new CalibrationSession(XY_AXES_CONFIG);
    calibrateStandardXY(session);
    session.runCalibration();

    const file = serializeProject(session, FAKE_IMAGE_DATA_URL, undefined, undefined, {
      crops: [{ fromWidth: 640, fromHeight: 480, rect: { x: 0, y: 0, width: 320, height: 240 } }],
    });
    if ('error' in file) throw new Error(file.error);
    const back = deserializeProject(file);
    if ('error' in back) throw new Error(back.error);
    expect(back.provenance.crops).toHaveLength(1);
    expect(back.provenance.crops![0]!.rect.width).toBe(320);

    // A pre-95 file (no provenance key) reads back as {}, never undefined/throw.
    const legacy = serializeProject(session, FAKE_IMAGE_DATA_URL);
    if ('error' in legacy) throw new Error(legacy.error);
    const legacyBack = deserializeProject(legacy);
    if ('error' in legacyBack) throw new Error(legacyBack.error);
    expect(legacyBack.provenance).toEqual({});
  });

  it('reads a PDF source back, and validates malformed provenance (checkpoint 97)', () => {
    const session = new CalibrationSession(XY_AXES_CONFIG);
    calibrateStandardXY(session);
    session.runCalibration();

    const file = serializeProject(session, FAKE_IMAGE_DATA_URL, undefined, undefined, {
      source: { name: 'paper.pdf', page: 4 },
      crops: [{ fromWidth: 800, fromHeight: 600, rect: { x: 10, y: 20, width: 100, height: 80 } }],
    });
    if ('error' in file) throw new Error(file.error);
    const back = deserializeProject(file);
    if ('error' in back) throw new Error(back.error);
    expect(back.provenance.source).toEqual({ name: 'paper.pdf', page: 4 });
    expect(back.provenance.crops).toHaveLength(1);

    // Garbage in the source is dropped, not trusted or thrown on.
    const garbled = deserializeProject({
      plotTracerProject: 1,
      image: { dataURL: FAKE_IMAGE_DATA_URL },
      plotData: file.plotData,
      provenance: { source: { name: 42, page: 'four' } },
    });
    if ('error' in garbled) throw new Error(garbled.error);
    expect(garbled.provenance).toEqual({});
  });

  it('drops malformed crop entries instead of trusting them (checkpoint 100 - T5)', () => {
    // A hand-edited file with junk in `crops` used to pass the shallow
    // Array.isArray check, then crash the status bar reading .fromWidth off it.
    const base = {
      plotTracerProject: 1 as const,
      image: { dataURL: FAKE_IMAGE_DATA_URL },
      plotData: (() => {
        const session = new CalibrationSession(XY_AXES_CONFIG);
        calibrateStandardXY(session);
        session.runCalibration();
        const f = serializeProject(session, FAKE_IMAGE_DATA_URL);
        if ('error' in f) throw new Error(f.error);
        return f.plotData;
      })(),
    };

    // All-garbage crops -> dropped entirely.
    const junk = deserializeProject({ ...base, provenance: { crops: [null, 'x', {}, { fromWidth: 1 }] } });
    if ('error' in junk) throw new Error(junk.error);
    expect(junk.provenance.crops).toBeUndefined();

    // A mix keeps only the well-formed entry.
    const mixed = deserializeProject({
      ...base,
      provenance: { crops: [null, { fromWidth: 800, fromHeight: 600, rect: { x: 1, y: 2, width: 3, height: 4 } }] },
    });
    if ('error' in mixed) throw new Error(mixed.error);
    expect(mixed.provenance.crops).toHaveLength(1);
    expect(mixed.provenance.crops![0]!.fromWidth).toBe(800);
  });
});

// === The project stamp (v1.4) =============================================
// Which build wrote a file, and when. DIAGNOSTICS, not a migration mechanism --
// migrations branch on `plotTracerProject`. Its value is retroactive
// identification of files a format marker cannot distinguish, so the tests that
// matter are: it is written, it survives the round trip, its absence is
// harmless, and garbage never becomes a version a migration would trust.
describe('project stamp', () => {
  const calibrated = () => {
    const session = new CalibrationSession(XY_AXES_CONFIG);
    calibrateStandardXY(session);
    session.runCalibration();
    return session;
  };

  it('writes appVersion and savedAt when a stamp is supplied', () => {
    const result = serializeProject(calibrated(), FAKE_IMAGE_DATA_URL, undefined, undefined, undefined, undefined, {
      appVersion: '1.4.0',
      savedAt: '2026-07-26T22:15:00.000Z',
    });
    if ('error' in result) throw new Error(result.error);
    expect(result.appVersion).toBe('1.4.0');
    expect(result.savedAt).toBe('2026-07-26T22:15:00.000Z');
  });

  it('omits both keys entirely when no stamp is supplied, so an unstamped save is unchanged', () => {
    const result = serializeProject(calibrated(), FAKE_IMAGE_DATA_URL);
    if ('error' in result) throw new Error(result.error);
    // `in`, not `=== undefined`: writing the key with an undefined value would
    // still change the JSON, which is the thing "additive" has to mean.
    expect('appVersion' in result).toBe(false);
    expect('savedAt' in result).toBe(false);
  });

  it('round-trips the stamp back out through deserializeProject', () => {
    const written = serializeProject(calibrated(), FAKE_IMAGE_DATA_URL, undefined, undefined, undefined, undefined, {
      appVersion: '1.4.0',
      savedAt: '2026-07-26T22:15:00.000Z',
    });
    if ('error' in written) throw new Error(written.error);
    const read = deserializeProject(JSON.parse(JSON.stringify(written)));
    if ('error' in read) throw new Error(read.error);
    expect(read.appVersion).toBe('1.4.0');
    expect(read.savedAt).toBe('2026-07-26T22:15:00.000Z');
  });

  it('loads a file written before the stamp existed, reporting neither field', () => {
    const written = serializeProject(calibrated(), FAKE_IMAGE_DATA_URL);
    if ('error' in written) throw new Error(written.error);
    const read = deserializeProject(JSON.parse(JSON.stringify(written)));
    if ('error' in read) throw new Error(read.error);
    expect(read.appVersion).toBeUndefined();
    expect(read.savedAt).toBeUndefined();
    // The rest of the file still reads exactly as before.
    expect(read.configId).toBe('xy');
    expect(read.datasets).toHaveLength(1);
  });

  it('drops a malformed stamp rather than reporting a version a migration would trust', () => {
    const base = serializeProject(calibrated(), FAKE_IMAGE_DATA_URL);
    if ('error' in base) throw new Error(base.error);
    const plain = JSON.parse(JSON.stringify(base));

    for (const junk of [{ appVersion: 42 }, { appVersion: '' }, { appVersion: null }, { appVersion: { v: '1.4.0' } }]) {
      const read = deserializeProject({ ...plain, ...junk });
      if ('error' in read) throw new Error(read.error);
      expect(read.appVersion).toBeUndefined();
    }
    // A garbage savedAt is dropped independently -- a good version survives it.
    const mixed = deserializeProject({ ...plain, appVersion: '1.4.0', savedAt: 7 });
    if ('error' in mixed) throw new Error(mixed.error);
    expect(mixed.appVersion).toBe('1.4.0');
    expect(mixed.savedAt).toBeUndefined();
  });

  it('stamps a multi-figure project ONCE at the top level, never per figure', () => {
    const figures = [
      { name: 'Figure 1', session: calibrated(), imageDataURL: FAKE_IMAGE_DATA_URL },
      { name: 'Figure 2', session: calibrated(), imageDataURL: FAKE_IMAGE_DATA_URL },
    ];
    const multi = serializeMultiFigureProject(figures, 0, undefined, {
      appVersion: '1.4.0',
      savedAt: '2026-07-26T22:15:00.000Z',
    });
    if ('error' in multi) throw new Error(multi.error);
    expect(multi.appVersion).toBe('1.4.0');
    expect(multi.savedAt).toBe('2026-07-26T22:15:00.000Z');
    // One fact, stored once: N figures saved in one action are not N versions.
    for (const fig of multi.figures) {
      expect('appVersion' in fig).toBe(false);
      expect('savedAt' in fig).toBe(false);
    }

    const read = deserializeMultiFigureProject(JSON.parse(JSON.stringify(multi)));
    if ('error' in read) throw new Error(read.error);
    expect(read.appVersion).toBe('1.4.0');
    expect(read.savedAt).toBe('2026-07-26T22:15:00.000Z');
    expect(read.figures).toHaveLength(2);
    expect(read.figures[0]!.appVersion).toBeUndefined();
  });
});

/**
 * ⚑⚑ WHAT THE LOAD DOOR ACCEPTS (v2.3 audit, F4).
 *
 * The interactive path cannot produce either of these: a dimension index comes
 * from a table column, and a colour comes from `samplePixelRgb` on real image
 * bytes. A FILE can produce both, and the file is the model's other entrance -
 * the standing rule this project keeps rediscovering. Neither is exotic damage;
 * `NaN` in particular arrives by itself, because JSON rewrites it as `null` on
 * the way out and `null` then behaves as `0` in the arithmetic downstream.
 */
describe('a project file carrying values the app could never have written', () => {
  const FORGED_IMAGE = FAKE_IMAGE_DATA_URL;

  function xyFileWithOnePoint() {
    const session = new CalibrationSession(XY_AXES_CONFIG);
    calibrateStandardXY(session);
    session.runCalibration();
    session.addDataPoint(200, 200);
    const file = serializeProject(session, FORGED_IMAGE);
    if ('error' in file) throw new Error(file.error);
    return file;
  }

  it('⚑ a supplied-dimension index the type does not have is dropped, not carried into the export', () => {
    // An XY point has two values. A file claiming dimension 99 was user-typed
    // reached `csvExport`'s `${fields[f] ?? f} source`, which wrote a column
    // literally named "99 source".
    const file = xyFileWithOnePoint();
    (file.plotData.datasetColl![0]!.data[0] as unknown as Record<string, unknown>).metadata = { supplied: [99] };

    const back = deserializeProject(file);
    if ('error' in back) throw new Error(back.error);
    const reopened = new CalibrationSession(XY_AXES_CONFIG);
    reopened.loadCalibrated(back.axes as XYAxes, back.datasets, back.categoryAxis, back.heatmapLayer);
    expect(reopened.getSuppliedDimsFor(0)).toEqual([[]]);
  });

  it('⚑⚑ and the EXPORT reader is bounded too, which F4 claimed and did not do', () => {
    // ⚠️ F4's own comment said *"Filtering HERE covers every reader at once,
    // since they all come through this method."* They do not: `getExportRows`
    // has its own `suppliedAt`, reading the metadata directly, and it is the one
    // that reaches the FILE. So the screen was clean and the export still wrote
    // a column literally headed `99 source` - the exact symptom the fix's own
    // commit message quotes as the defect.
    const file = xyFileWithOnePoint();
    (file.plotData.datasetColl![0]!.data[0] as unknown as Record<string, unknown>).metadata = {
      supplied: [99],
    };
    const back = deserializeProject(file);
    if ('error' in back) throw new Error(back.error);
    const reopened = new CalibrationSession(XY_AXES_CONFIG);
    reopened.loadCalibrated(back.axes as XYAxes, back.datasets, back.categoryAxis, back.heatmapLayer);

    const fields = reopened.getExportFields();
    const rows = reopened.getExportRows(0);
    const section = flatDataSection(rows, fields);
    expect(section.header.filter((h) => /source/.test(String(h)))).toEqual([]);
  });

  it('⚑ a real supplied dimension still survives - the guard must not over-reach', () => {
    const file = xyFileWithOnePoint();
    (file.plotData.datasetColl![0]!.data[0] as unknown as Record<string, unknown>).metadata = { supplied: [1] };
    const back = deserializeProject(file);
    if ('error' in back) throw new Error(back.error);
    const reopened = new CalibrationSession(XY_AXES_CONFIG);
    reopened.loadCalibrated(back.axes as XYAxes, back.datasets, back.categoryAxis, back.heatmapLayer);
    expect(reopened.getSuppliedDimsFor(0)).toEqual([[1]]);
  });

  it('⚑⚑ a measurement colour that is not a colour is dropped, so nothing reads a value off it', () => {
    // `null` here is what `NaN` becomes on its way through JSON. Left in place
    // it flows into the key inversion as 0 and comes back as a confident number
    // for a channel that was never measured.
    const session = new CalibrationSession(XY_AXES_CONFIG);
    calibrateStandardXY(session);
    session.runCalibration();
    const file = serializeProject(session, FORGED_IMAGE, undefined, {
      measurements: [
        {
          id: 'm',
          tool: 'colour',
          points: [{ x: 1, y: 1 }],
          closed: false,
          label: '',
          labelAt: { x: 1, y: 1 },
          rgb: [999, -12, null] as unknown as readonly [number, number, number],
        },
      ],
      scale: null,
    });
    if ('error' in file) throw new Error(file.error);

    const back = deserializeProject(file);
    if ('error' in back) throw new Error(back.error);
    // The measurement itself survives - its geometry was never in doubt.
    expect(back.measurements).toHaveLength(1);
    expect(back.measurements![0]!.points).toEqual([{ x: 1, y: 1 }]);
    // The colour does not.
    expect(back.measurements![0]!.rgb).toBeUndefined();
  });

  it('⚑⚑ the MULTI-FIGURE door refuses it too, because both doors are one door', () => {
    // The container claims to be "N single-figure projects with one shared
    // source, no second data model". This is that claim asserted rather than
    // trusted: a guard added to the single-figure reader is only a guard if the
    // other entrance really does come through it.
    const session = new CalibrationSession(XY_AXES_CONFIG);
    calibrateStandardXY(session);
    session.runCalibration();
    const multi = serializeMultiFigureProject(
      [{ name: 'Fig 1', session, imageDataURL: FORGED_IMAGE }],
      0
    );
    if ('error' in multi) throw new Error(multi.error);
    multi.figures[0]!.measurements = [
      {
        id: 'm',
        tool: 'colour',
        points: [{ x: 1, y: 1 }],
        closed: false,
        label: '',
        labelAt: { x: 1, y: 1 },
        rgb: [Number.NaN, 0, 0] as unknown as readonly [number, number, number],
      },
    ];

    const back = deserializeMultiFigureProject(multi);
    if ('error' in back) throw new Error(back.error);
    expect(back.figures[0]!.measurements).toHaveLength(1);
    expect(back.figures[0]!.measurements[0]!.rgb).toBeUndefined();
  });

  it('⚑⚑ a px->unit scale that is not a usable ratio is dropped, not read as zero', () => {
    // The other end of F5. A Set-scale built from two clicks in one place was
    // `Infinity`, and `Infinity` is `null` by the time it comes back through
    // JSON - at which point every distance and area reads a confident 0. The
    // gesture refuses it now; a file written before that, or by hand, arrives
    // here instead.
    const session = new CalibrationSession(XY_AXES_CONFIG);
    calibrateStandardXY(session);
    session.runCalibration();
    const file = serializeProject(session, FORGED_IMAGE, undefined, { measurements: [], scale: null });
    if ('error' in file) throw new Error(file.error);
    (file as { measureScale?: unknown }).measureScale = { unitPerPx: null, unit: 'mm' };

    const back = deserializeProject(file);
    if ('error' in back) throw new Error(back.error);
    // No scale at all, so distances read in PIXELS and say so - the honest
    // fallback the ruler already has, rather than a silent zero.
    expect(back.measureScale).toBeNull();
  });

  it('⚑ a real px->unit scale still loads - the guard must not over-reach', () => {
    const session = new CalibrationSession(XY_AXES_CONFIG);
    calibrateStandardXY(session);
    session.runCalibration();
    const file = serializeProject(session, FORGED_IMAGE, undefined, {
      measurements: [],
      scale: { unitPerPx: 0.25, unit: 'mm' },
    });
    if ('error' in file) throw new Error(file.error);
    const back = deserializeProject(file);
    if ('error' in back) throw new Error(back.error);
    expect(back.measureScale).toEqual({ unitPerPx: 0.25, unit: 'mm' });
  });

  it('⚑ a real measurement colour still loads - the guard must not over-reach', () => {
    const session = new CalibrationSession(XY_AXES_CONFIG);
    calibrateStandardXY(session);
    session.runCalibration();
    const file = serializeProject(session, FORGED_IMAGE, undefined, {
      measurements: [
        { id: 'm', tool: 'colour', points: [{ x: 1, y: 1 }], closed: false, label: '', labelAt: { x: 1, y: 1 }, rgb: [68, 1, 84] },
      ],
      scale: null,
    });
    if ('error' in file) throw new Error(file.error);
    const back = deserializeProject(file);
    if ('error' in back) throw new Error(back.error);
    expect(back.measurements![0]!.rgb).toEqual([68, 1, 84]);
  });
});

/**
 * ⚑⚑ A DERIVED POINT WITH NOTHING TO DERIVE FROM (v2.3 audit, F11).
 *
 * `rebuildInterpolation` snapshots the ANCHORS, deletes every point roled
 * `anchor` or `interpolated`, and re-adds only the anchors when there are fewer
 * than two. That is right for the state it was written for - a user deleting
 * guide points until the curve can no longer exist, where the derived samples
 * are stale remnants of a curve we made.
 *
 * ⚠️ A FILE CAN ARRIVE IN A STATE NO CLICK CAN BUILD: points marked
 * `interpolated` with no anchors at all. They are not remnants of anything we
 * made, and the next click in Interpolate mode deletes every one of them.
 * Measured on the shape: 500 points, one click, all gone.
 *
 * ⚑ The POINTS are kept and the false claim is dropped, rather than the reverse.
 * A pixel is a measurement; `role: interpolated` is provenance, and provenance
 * that cannot be true is the part with nothing behind it.
 */
describe('a file whose points claim to be derived from anchors that are not there', () => {
  it('⚑⚑ keeps the points and drops the impossible claim', () => {
    const session = new CalibrationSession(XY_AXES_CONFIG);
    calibrateStandardXY(session);
    session.runCalibration();
    for (const [x, y] of [[150, 200], [200, 210], [250, 220]] as [number, number][]) {
      session.addDataPoint(x, y);
    }
    const file = serializeProject(session, FAKE_IMAGE_DATA_URL);
    if ('error' in file) throw new Error(file.error);
    // Forge: every point derived, nothing to derive from.
    for (const p of file.plotData.datasetColl![0]!.data) {
      (p as unknown as Record<string, unknown>).metadata = { role: 'interpolated' };
    }

    const back = deserializeProject(file);
    if ('error' in back) throw new Error(back.error);
    const pixels = back.datasets[0]!.getAllPixels();
    expect(pixels).toHaveLength(3); // nothing thrown away
    expect(pixels.map((p) => p.metadata?.['role'])).toEqual([undefined, undefined, undefined]);
  });

  it('⚑ a REAL interpolation is untouched - the guard must not over-reach', () => {
    const session = new CalibrationSession(XY_AXES_CONFIG);
    calibrateStandardXY(session);
    session.runCalibration();
    const file = serializeProject(session, FAKE_IMAGE_DATA_URL);
    if ('error' in file) throw new Error(file.error);
    file.plotData.datasetColl![0]!.data = [
      { x: 100, y: 100, metadata: { role: 'anchor' } },
      { x: 150, y: 150, metadata: { role: 'interpolated' } },
      { x: 200, y: 200, metadata: { role: 'anchor' } },
    ] as never;

    const back = deserializeProject(file);
    if ('error' in back) throw new Error(back.error);
    expect(back.datasets[0]!.getAllPixels().map((p) => p.metadata?.['role'])).toEqual([
      'anchor',
      'interpolated',
      'anchor',
    ]);
  });
});
