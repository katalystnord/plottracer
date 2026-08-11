import { describe, expect, it } from 'vitest';
import { CalibrationSession, HEATMAP_AXES_CONFIG, GRAPH_TYPE_METADATA_KEY } from '../calibrationSession.js';
import { XYAxes } from '../../core/axes/xy.js';
import { serializeProject, deserializeProject } from '../projectFile.js';
import { gridFromAxes, gridToAxes, type HeatmapState } from '../heatmapRun.js';

/**
 * A heatmap has to SURVIVE A SAVE (v2.2) — the grid, the colour key, and which
 * kind of chart it was.
 *
 * ⚑ THREE THINGS COULD BE LOST HERE, and each would be lost silently:
 *
 *   1. the GRAPH TYPE. A heatmap calibrates `XYAxes`, and a file says which
 *      type it is through the axes metadata. Without that stamp a saved heatmap
 *      reopens as an XY chart — its key clicks read back as stray axis points.
 *   2. the COLOUR KEY. Its four clicks live in the calibration, and the axes
 *      carries the calibration into the file. Hand the axes only the x/y frame
 *      and the key is written nowhere, so a reopened project has a calibration
 *      it cannot read one cell through.
 *   3. the GRID and the LOG-KEY setting. Neither has a pixel to ride on, so
 *      both live in the axes metadata — pie's total and sweep set that
 *      precedent for exactly this reason.
 *
 * Every one of them opens CLEAN and wrong, which is why they are tested at the
 * file boundary rather than through the click path that never had the problem.
 */

/** The eight clicks of a heatmap calibration, walked as a user walks them. */
function calibratedSession(options: Record<string, string> = {}): CalibrationSession<XYAxes> {
  const s = new CalibrationSession(HEATMAP_AXES_CONFIG);
  for (const [key, value] of Object.entries(options)) s.setOption(key, value);
  const walk: Array<[number, number, string[]]> = [
    [100, 300, ['0']],
    [400, 300, ['10']],
    [100, 300, ['0']],
    [100, 100, ['20']],
    [120, 420, []],
    [380, 420, []],
    [150, 420, ['5']],
    [350, 420, ['95']],
  ];
  for (const [px, py, values] of walk) {
    s.handleCalibrationClick(px, py);
    if (values.length > 0) s.confirmCalibrationValues(values);
  }
  expect(s.runCalibration()).toBe(true);
  return s;
}

/**
 * Save and reopen through the REAL project path — `serializeProject` /
 * `deserializeProject`, the pair the Save Project button uses.
 *
 * ⚑ Not a hand-rolled `PlotData` round trip: the graph type is resolved HERE,
 * from the axes metadata, and that resolution is one of the things under test.
 * Returns the reopened session plus the config id the file claimed.
 */
function roundTrip(session: CalibrationSession<XYAxes>): {
  session: CalibrationSession<XYAxes>;
  configId: string;
} {
  const saved = serializeProject(session, 'data:image/png;base64,AAAA');
  if ('error' in saved) throw new Error(`save refused: ${saved.error}`);
  // Through JSON, because that is what a file is — anything that does not
  // survive stringify/parse does not survive Save.
  const opened = deserializeProject(JSON.parse(JSON.stringify(saved)));
  if ('error' in opened) throw new Error(`open refused: ${opened.error}`);
  const next = new CalibrationSession(HEATMAP_AXES_CONFIG);
  next.loadCalibrated(opened.axes as unknown as XYAxes, opened.datasets, opened.categoryAxis);
  return { session: next, configId: opened.configId };
}

describe('a heatmap survives a save', () => {
  it('says it is a heatmap, not an XY chart', () => {
    const before = calibratedSession();
    expect(before.getAxes()!.getMetadata()[GRAPH_TYPE_METADATA_KEY]).toBe('heatmap');
    // ⚑ And the FILE says so: without the stamp `deserializeProject` falls back
    // to the axes CLASS, which is `XYAxes` — so the project reopens as a plain
    // XY chart with eight stray calibration points.
    expect(roundTrip(before).configId).toBe('heatmap');
  });

  it('carries the COLOUR KEY’s four clicks through the file', () => {
    // ⚑ The four x/y points are not the calibration — they are the first half
    // of it. A file holding only them reopens as a heatmap with no key.
    const before = calibratedSession();
    const { session: after } = roundTrip(before);
    const placed = after.getPlacedPoints();
    expect(Object.keys(placed).sort()).toEqual(['k1', 'k2', 'kv1', 'kv2', 'x1', 'x2', 'y1', 'y2']);
    expect(placed['k1']).toEqual({ px: 120, py: 420, values: [] });
    expect(placed['k2']).toEqual({ px: 380, py: 420, values: [] });
    expect(placed['kv1']!.px).toBe(150);
    expect(placed['kv1']!.values).toEqual(['5']);
    expect(placed['kv2']!.values).toEqual(['95']);
  });

  it('reads the same values after reopening as before saving', () => {
    const before = calibratedSession();
    const { session: after } = roundTrip(before);
    expect(after.getAxes()!.pixelToData(250, 200)).toEqual(before.getAxes()!.pixelToData(250, 200));
  });

  it('remembers a LOG colour key, which nothing else could tell you', () => {
    // ⚑ Same shape as pie's tilt: the setting is not part of `XYAxes`, so
    // without its own home in the metadata a reopened project reads every cell
    // off a linear key it was never calibrated with — and looks fine doing it.
    const before = calibratedSession({ isLogValue: 'true' });
    expect(before.getAxes()!.getMetadata()['heatmapLogValue']).toBe('true');
    expect(roundTrip(before).session.getOptions()['isLogValue']).toBe('true');
    // …and a linear key stays linear rather than defaulting to anything.
    expect(roundTrip(calibratedSession()).session.getOptions()['isLogValue']).toBe('false');
  });

  it('carries the GRID through the file, in data coordinates', () => {
    const before = calibratedSession();
    const grid: HeatmapState = { xDividers: [0, 1, 3.5, 10], yDividers: [0, 2, 20] };
    gridToAxes(before.getAxes()!, grid);
    const { session: after } = roundTrip(before);
    expect(gridFromAxes(after.getAxes()!)).toEqual(grid);
  });

  it('is null for an axes carrying no grid, rather than an empty one', () => {
    expect(gridFromAxes(calibratedSession().getAxes()!)).toBeNull();
  });

  it('clears the grid rather than writing one that is not a grid', () => {
    const session = calibratedSession();
    gridToAxes(session.getAxes()!, { xDividers: [0, 5], yDividers: [0, 5] });
    gridToAxes(session.getAxes()!, null);
    expect(gridFromAxes(session.getAxes()!)).toBeNull();
    expect(session.getAxes()!.getMetadata()['heatmapGrid']).toBeUndefined();
  });

  it('REFUSES a grid from a file that the app would not let you draw', () => {
    // ⚑ A load-path entrance: these numbers can come from a hand-edited file, an
    // older build, or another tool. The same rule the interactive path applies
    // is applied here, so a file cannot install a grid with a cell that has no
    // interior — or one boundary, which bounds nothing.
    const session = calibratedSession();
    const axes = session.getAxes()!;
    for (const bad of [
      { x: [1], y: [0, 5] },
      { x: [0, 5], y: [2, 2] },
      { x: [0, 'nonsense'], y: [0, 5] },
      { x: [0, 5], y: 'not an array' },
      { x: [0, 5] },
    ]) {
      axes.setMetadata({ ...axes.getMetadata(), heatmapGrid: bad });
      expect(gridFromAxes(axes), JSON.stringify(bad)).toBeNull();
    }
  });

  it('sorts a grid that arrives out of order', () => {
    const session = calibratedSession();
    const axes = session.getAxes()!;
    axes.setMetadata({ ...axes.getMetadata(), heatmapGrid: { x: [10, 0, 3], y: [5, 0] } });
    expect(gridFromAxes(axes)).toEqual({ xDividers: [0, 3, 10], yDividers: [0, 5] });
  });
});
