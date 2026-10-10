/**
 * v2.6 - the CONTOUR type's record. The cases agreed with David on 2026-10-07
 * (docs/v2.6-curves-cases.md), one test per case, named for the case.
 *
 * Why the record looks the way it does - checked against the libraries that
 * draw contours, not assumed: R's own `contourLines()` returns exactly
 * `{level, x, y}` per line; ggplot2 draws it from a line/level/x/y table with
 * `geom_path(group = line, colour = level)`; matplotlib redraws it with
 * `ContourSet(ax, levels, allsegs)` (every vertex identical). None of them can
 * rebuild the FIELD from lines - that needs a z grid, i.e. interpolation, which
 * belongs downstream.
 */
import { describe, expect, it } from 'vitest';
import { CalibrationSession, type CalibratedAxes } from '../calibrationSession.js';
import { CONTOUR_AXES_CONFIG } from '../axesTypeConfigs.js';
import { buildExportSections, type ExportAssemblyInput } from '../exportAssembly.js';
import { serializeProject, deserializeProject } from '../projectFile.js';

const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

// The XY fixture used across the suite: X 0..10 over px 100..400, Y 0..10 over
// py 250..100, so x = (px - 100) / 30 and y = (250 - py) / 15.
function calibratedContour(): CalibrationSession<CalibratedAxes> {
  const s = new CalibrationSession<CalibratedAxes>(CONTOUR_AXES_CONFIG as never);
  for (const [px, py, v] of [
    [100, 250, '0'],
    [400, 250, '10'],
    [100, 250, '0'],
    [100, 100, '10'],
  ] as const) {
    s.handleCalibrationClick(px, py);
    s.confirmCalibrationValues([v]);
  }
  expect(s.runCalibration(), s.getCalibrationError() ?? '').toBe(true);
  return s;
}

/** A closed loop and an open line, in the order a user would trace them. */
const LOOP: [number, number][] = [
  [250, 160], [280, 175], [280, 205], [250, 220], [220, 205], [220, 175], [250, 160],
];
const OPEN: [number, number][] = [[130, 240], [190, 200], [250, 190], [340, 230]];

function trace(s: CalibrationSession<CalibratedAxes>, pts: readonly [number, number][]) {
  for (const [px, py] of pts) s.addDataPoint(px, py);
}

function exportOf(s: CalibrationSession<CalibratedAxes>) {
  const sections = buildExportSections({
    session: s,
    axes: s.getAxes()!,
    configId: CONTOUR_AXES_CONFIG.id,
    scope: 'all',
    measures: [],
    precision: 'auto',
  } as unknown as ExportAssemblyInput);
  const block = sections.find((b) => b.header?.[0] === 'Line');
  expect(block, `no Line/Level/X/Y block in ${JSON.stringify(sections.map((b) => b.header))}`).toBeTruthy();
  return block!;
}

describe('v2.6 contour - the record', () => {
  it('C1 a contour line is a series that carries a numeric level, and its name stays free text', () => {
    const s = calibratedContour();
    trace(s, LOOP);
    s.renameDataset(0, 'inner ring');
    expect(s.setContourLevel(0, 0.8)).toBeNull();
    expect(s.getContourLevel(0)).toEqual({ value: 0.8, source: 'typed' });
    expect(s.getDatasetInfos()[0]!.name, 'the level is not hidden in the name').toBe('inner ring');
  });

  it('C1 the level survives saving and reopening the project', () => {
    const s = calibratedContour();
    trace(s, LOOP);
    s.setContourLevel(0, 0.8);
    const file = serializeProject(s, PNG_DATA_URL);
    if ('error' in file) throw new Error(file.error);
    const opened = deserializeProject(JSON.parse(JSON.stringify(file)));
    if ('error' in opened) throw new Error(opened.error);
    const back = new CalibrationSession<CalibratedAxes>(CONTOUR_AXES_CONFIG as never);
    back.loadCalibrated(opened.axes as never, opened.datasets);
    expect(back.getContourLevel(0)).toEqual({ value: 0.8, source: 'typed' });
  });

  it('C2 several lines can share one level and stay separate lines', () => {
    const s = calibratedContour();
    trace(s, LOOP);
    s.addDataset('second ring');
    s.setActiveDataset(1);
    trace(s, OPEN);
    s.setContourLevel(0, 0.4);
    s.setContourLevel(1, 0.4);
    const block = exportOf(s);
    const lines = new Set(block.rows.map((r) => r[0]));
    expect(lines.size, 'two lines, not one merged line').toBe(2);
    expect(new Set(block.rows.map((r) => r[1]))).toEqual(new Set([0.4]));
  });

  it('C3 the export is one row per point with line, level, x, y, in drawn order', () => {
    const s = calibratedContour();
    trace(s, OPEN);
    s.setContourLevel(0, 0.8);
    const block = exportOf(s);
    expect(block.header).toEqual(['Line', 'Level', 'X', 'Y']);
    expect(block.rows.length).toBe(OPEN.length);
    const xy = block.rows.map((r) => [Number(r[2]), Number(r[3])]);
    const want = OPEN.map(([px, py]) => [(px - 100) / 30, (250 - py) / 15]);
    xy.forEach((p, i) => {
      expect(p[0]).toBeCloseTo(want[i]![0]!, 1);
      expect(p[1]).toBeCloseTo(want[i]![1]!, 1);
    });
  });

  it('C3 grouping the export by line rebuilds every traced line exactly (the reverse test)', () => {
    const s = calibratedContour();
    trace(s, LOOP);
    s.setContourLevel(0, 0.8);
    s.addDataset('open');
    s.setActiveDataset(1);
    trace(s, OPEN);
    s.setContourLevel(1, 0.2);
    const block = exportOf(s);
    // What ContourSet(levels, allsegs) is handed: per level, the lines' vertices.
    const allsegs = new Map<number, Map<string, number[][]>>();
    for (const [line, level, x, y] of block.rows) {
      const byLine = allsegs.get(Number(level)) ?? new Map<string, number[][]>();
      byLine.set(String(line), [...(byLine.get(String(line)) ?? []), [Number(x), Number(y)]]);
      allsegs.set(Number(level), byLine);
    }
    expect([...allsegs.keys()].sort()).toEqual([0.2, 0.8]);
    const rebuiltOpen = [...allsegs.get(0.2)!.values()][0]!;
    const drawn = OPEN.map(([px, py]) => [(px - 100) / 30, (250 - py) / 15]);
    rebuiltOpen.forEach((p, k) => {
      expect(p[0], `vertex ${k} x`).toBeCloseTo(drawn[k]![0]!, 1);
      expect(p[1], `vertex ${k} y`).toBeCloseTo(drawn[k]![1]!, 1);
    });
    expect(rebuiltOpen.length).toBe(OPEN.length);
    expect([...allsegs.get(0.8)!.values()].length, 'the loop is one line under its level').toBe(1);
  });

  // ⚠️ OPEN, found by this file: R's contourLines() and matplotlib's allsegs both
  // store a closed contour by ENDING ON ITS FIRST POINT. Today's record cannot do
  // that: a click on the start point again is slotted in beside it by the
  // insertion rule, and a traced loop's two ends land 9-14 px apart while a
  // single traced dash can have its ends 3.6 px apart - so no distance rule can
  // tell closed from open (plottracer-ref research/v2.6-today/, 2026-10-07). How a line becomes
  // closed is David's to decide; until then this case is named, not passed.
  // RESOLVED 2026-10-10 (David agreed): a line is closed by the INK - Find lines
  // measures it, and a hand-captured line is checked the same way
  // (algorithms/findLines/closure.ts, findLinesClosure.test.ts). Once closed,
  // the record ends on the first point.
  it('C3 a closed contour is exported ending on its first point, as R and matplotlib store it', () => {
    const s = calibratedContour();
    trace(s, LOOP.slice(0, -1));
    s.closeLine(0);
    const rows = exportOf(s).rows;
    expect(rows[rows.length - 1]!.slice(2, 4)).toEqual(rows[0]!.slice(2, 4));
    expect(rows.length).toBe(LOOP.length);
    s.closeLine(0); // closing a closed line changes nothing
    expect(exportOf(s).rows.length).toBe(LOOP.length);
  });


  it('C4 a line with no level exports a blank level, never 0', () => {
    const s = calibratedContour();
    trace(s, OPEN);
    expect(s.getContourLevel(0)).toBeNull();
    for (const row of exportOf(s).rows) expect(row[1], 'blank, not a made-up 0').toBe('');
  });

  it('C3 a line captured with guide points keeps each point\'s anchor / interpolated role in the export', () => {
    const s = calibratedContour();
    s.addAnchorPoint(130, 240);
    s.addAnchorPoint(250, 190);
    s.addAnchorPoint(340, 230);
    s.setContourLevel(0, 0.3);
    const block = exportOf(s);
    expect(block.header).toEqual(['Line', 'Level', 'X', 'Y', 'Point']);
    const roles = new Set(block.rows.map((r) => r[4]));
    expect(roles).toEqual(new Set(['anchor', 'interpolated']));
  });

  it('C1 a level is typed the way every value in the app is typed - and words are refused, saying so', () => {
    const s = calibratedContour();
    trace(s, OPEN);
    // The same parser as every calibration field, so the same answers: "1,000"
    // is REFUSED there (core/inputParser.ts - it once read as 1, every value
    // 1000x wrong), and it is refused here.
    expect(s.setContourLevelFromText(0, '1,000')).toMatch(/not a number/i);
    expect(s.getContourLevel(0)).toBeNull();
    expect(s.setContourLevelFromText(0, '1e3')).toBeNull();
    expect(s.getContourLevel(0)?.value).toBe(1000);
    expect(s.setContourLevelFromText(0, '-2.5')).toBeNull();
    expect(s.getContourLevel(0)?.value).toBe(-2.5);
    expect(s.setContourLevelFromText(0, 'lots')).toMatch(/not a number/i);
    expect(s.getContourLevel(0)?.value, 'a refused entry leaves the level as it was').toBe(-2.5);
    expect(s.setContourLevelFromText(0, '   ')).toBeNull();
    expect(s.getContourLevel(0), 'clearing the field clears the level').toBeNull();
  });

  it('C4 a level that is not a finite number is refused - when typed, and when a file says so', () => {
    const s = calibratedContour();
    trace(s, OPEN);
    expect(s.setContourLevel(0, Number.NaN)).toMatch(/number/i);
    expect(s.getContourLevel(0)).toBeNull();

    s.setContourLevel(0, 0.5);
    const file = serializeProject(s, PNG_DATA_URL);
    if ('error' in file) throw new Error(file.error);
    const raw = JSON.parse(JSON.stringify(file));
    // Hand-edit the saved level into nonsense: the load door must enforce the same rule.
    const json = JSON.stringify(raw).replace('"value":0.5', '"value":"lots"');
    const opened = deserializeProject(JSON.parse(json));
    if ('error' in opened) throw new Error(opened.error);
    const back = new CalibrationSession<CalibratedAxes>(CONTOUR_AXES_CONFIG as never);
    back.loadCalibrated(opened.axes as never, opened.datasets);
    expect(back.getContourLevel(0)).toBeNull();
  });
});
