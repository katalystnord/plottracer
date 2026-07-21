import { describe, expect, it } from 'vitest';
import { serializeProject, deserializeProject } from '../projectFile.js';
import { CalibrationSession, XY_AXES_CONFIG, BAR_AXES_CONFIG, CIRCULAR_CHART_RECORDER_AXES_CONFIG } from '../calibrationSession.js';
import type { XYAxes } from '../../core/axes/xy.js';
import type { BarAxes } from '../../core/axes/bar.js';
import type { CircularChartRecorderAxes } from '../../core/axes/circularChartRecorder.js';

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
    newSession.loadCalibrated(result.axes as BarAxes, result.datasets);
    expect(newSession.hasPointGroups()).toBe(true);
    expect(newSession.getPointGroups()).toEqual(['Min', 'Q1', 'Median', 'Q3', 'Max']);
    const rows = newSession.getTupleRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.label).toBe('Sample A');
    expect(rows[0]!.points.every((p) => p !== null)).toBe(true);
    // The completed tuple's cursor should have rolled to a fresh one, same as
    // it would have live -- recomputePointGroupCursor's "no open slot found" path.
    expect(newSession.getCurrentTupleIndex()).toBeNull();
    expect(newSession.getBoxPlotGlyphs()).toHaveLength(1);
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

  it('drops malformed crop entries instead of trusting them (checkpoint 100 — T5)', () => {
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
