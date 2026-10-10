/**
 * v2.6 - correcting a found line (docs/v2.6-curves-cases.md, K2-K5, S2+, S3,
 * S5): Cut, Join and Move on a Contour session, and what the record says about
 * points Find lines bridged or shared.
 */
import { describe, expect, it } from 'vitest';
import { CalibrationSession, type CalibratedAxes } from '../calibrationSession.js';
import { CONTOUR_AXES_CONFIG } from '../axesTypeConfigs.js';
import { buildExportSections, type ExportAssemblyInput } from '../exportAssembly.js';
import { serializeProject, deserializeProject } from '../projectFile.js';
import type { LinePoint } from '../lineEdits.js';

const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function calibrated(): CalibrationSession<CalibratedAxes> {
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

const line = (pts: [number, number][], role: LinePoint['role'] = null): LinePoint[] => pts.map(([x, y]) => ({ x, y, role }));
const OPEN = line([[120, 200], [140, 200], [160, 200], [180, 200], [200, 200]]);
const RING = line([[250, 160], [280, 175], [280, 205], [250, 220], [220, 205], [220, 175], [250, 160]]);

function exportRows(s: CalibrationSession<CalibratedAxes>) {
  const sections = buildExportSections({
    session: s, axes: s.getAxes()!, configId: CONTOUR_AXES_CONFIG.id, scope: 'all', measures: [], precision: 'auto',
  } as unknown as ExportAssemblyInput);
  return sections.find((b) => b.header?.[0] === 'Line')!;
}

describe('Find lines into series', () => {
  it('F1 each found line becomes its own series, each in a colour of its own so the lines can be told apart', () => {
    const s = calibrated();
    const idx = s.addFoundLines([OPEN, RING]);
    expect(idx).toEqual([0, 1]);
    expect(s.getDatasetInfos().map((i) => i.pointCount)).toEqual([5, 7]);
    const [c0, c1] = s.getDatasetInfos().map((i) => i.color.join());
    expect(c0).not.toBe(c1);
  });

  it('S2+ a bridged or shared point says so in the export\'s Point column', () => {
    const s = calibrated();
    s.addFoundLines([[...OPEN.slice(0, 2), { x: 150, y: 200, role: 'bridged' }, ...OPEN.slice(2)], line([[120, 230], [200, 230]], 'shared')]);
    const block = exportRows(s);
    const col = block.header!.indexOf('Point');
    expect(col).toBeGreaterThan(0);
    expect(block.rows.map((r) => r[col])).toEqual(['', '', 'bridged', '', '', '', 'shared', 'shared']);
  });

  it('S3 a level used from the label exports as "label" in Level from', () => {
    const s = calibrated();
    s.addFoundLines([OPEN]);
    s.setContourLevel(0, 0.4, 'label');
    const block = exportRows(s);
    const col = block.header!.indexOf('Level from');
    expect(block.rows.every((r) => r[col] === 'label')).toBe(true);
  });

  it('S5 what the label said is kept with the line, through saving and reopening, and is not a data point', () => {
    const s = calibrated();
    s.addFoundLines([OPEN]);
    s.setLabelRead(0, { text: '0.4', value: 0.4, refused: null, at: [160, 200] });
    const file = serializeProject(s, PNG_DATA_URL);
    if ('error' in file) throw new Error(file.error);
    const opened = deserializeProject(JSON.parse(JSON.stringify(file)));
    if ('error' in opened) throw new Error(opened.error);
    const s2 = new CalibrationSession<CalibratedAxes>(CONTOUR_AXES_CONFIG as never);
    s2.loadCalibrated(opened.axes as never, opened.datasets);
    expect(s2.getLabelRead(0)).toEqual({ text: '0.4', value: 0.4, refused: null, at: [160, 200] });
    expect(exportRows(s2).rows.length).toBe(5);
  });
});

describe('correcting a line', () => {
  it('K2 Cut: an open line cut at a point becomes two lines there, both keeping the cut point', () => {
    const s = calibrated();
    s.addFoundLines([OPEN]);
    s.setContourLevel(0, 2, 'typed');
    expect(s.cutLineAt(0, 2)).toBeNull();
    expect(s.getLinePoints(0)!.map((p) => p.x)).toEqual([120, 140, 160]);
    expect(s.getLinePoints(1)!.map((p) => p.x)).toEqual([160, 180, 200]);
    // the new line is the same kind of line: same level, same colour
    expect(s.getContourLevel(1)).toEqual({ value: 2, source: 'typed' });
  });

  it('K2 Cut: a closed line is OPENED at the cut, not split in two', () => {
    const s = calibrated();
    s.addFoundLines([RING]);
    expect(s.cutLineAt(0, 3)).toBeNull();
    expect(s.getDatasetInfos().length).toBe(1);
    const p = s.getLinePoints(0)!;
    expect(p[0]).toEqual({ x: 250, y: 220, role: null });
    expect(p[p.length - 1]).toEqual({ x: 250, y: 220, role: null });
    expect(p.length).toBe(7);
  });

  it('K2 Cut at the very end of a line is refused, and says why', () => {
    const s = calibrated();
    s.addFoundLines([OPEN]);
    expect(s.cutLineAt(0, 4)).toMatch(/end of the line/);
  });

  it('K3 Join: two pieces become one line, the gap between their nearest ends filled with bridged points', () => {
    const s = calibrated();
    s.addFoundLines([line([[120, 200], [140, 200], [160, 200]]), line([[220, 200], [200, 200], [190, 200]])]);
    expect(s.joinLines(0, 1)).toBeNull();
    expect(s.getDatasetInfos().length).toBe(1);
    const p = s.getLinePoints(0)!;
    expect(p[0]!.x).toBe(120);
    expect(p[p.length - 1]!.x).toBe(220);
    const bridged = p.filter((q) => q.role === 'bridged');
    expect(bridged.length).toBeGreaterThan(0);
    expect(bridged.every((q) => q.x > 160 && q.x < 190)).toBe(true);
  });

  it('K3 Join refuses two lines with different levels', () => {
    const s = calibrated();
    s.addFoundLines([OPEN, RING]);
    s.setContourLevel(0, 1, 'typed');
    s.setContourLevel(1, 2, 'typed');
    expect(s.joinLines(0, 1)).toMatch(/different levels/);
    expect(s.getDatasetInfos().length).toBe(2);
  });

  it('K4 Move: selected points move to another line, slotted in drawn order', () => {
    const s = calibrated();
    s.addFoundLines([line([[120, 200], [140, 200], [150, 230], [160, 200]]), line([[120, 230], [140, 230], [160, 230]])]);
    expect(s.movePointsToLine(0, [2], 1)).toBe(1);
    expect(s.getLinePoints(0)!.map((p) => p.x)).toEqual([120, 140, 160]);
    expect(s.getLinePoints(1)!.map((p) => p.x)).toEqual([120, 140, 150, 160]);
  });

  it('K5 two curves swapped at a crossing are put right with Cut and Join', () => {
    const s = calibrated();
    // A runs left-to-right along y=200 but swaps onto B's path after x=200; B the reverse
    const A = line([[120, 200], [160, 200], [200, 215], [240, 230], [280, 230]]);
    const B = line([[120, 230], [160, 230], [200, 215], [240, 200], [280, 200]]);
    s.addFoundLines([A, B]);
    expect(s.cutLineAt(0, 2)).toBeNull(); // A -> A1 (0), A2 (2)
    expect(s.cutLineAt(1, 2)).toBeNull(); // B -> B1 (1), B2 (3)
    expect(s.joinLines(0, 3)).toBeNull(); // A1 + B2: stays on y=200
    const names = s.getDatasetInfos();
    const flat = names.map((i) => s.getLinePoints(i.index)!.map((p) => p.y));
    const straight200 = flat.find((ys) => ys[0] === 200 && ys[ys.length - 1] === 200);
    expect(straight200).toBeTruthy();
  });
});
