import { describe, expect, it } from 'vitest';
import { CalibrationSession, HEATMAP_AXES_CONFIG, GRAPH_TYPE_METADATA_KEY } from '../calibrationSession.js';
import { XYAxes } from '../../core/axes/xy.js';
import { serializeProject, deserializeProject } from '../projectFile.js';
import { gridFromAxes, gridToAxes, resolveHeatmapGrid, labelsFromAxes, labelsToAxes, readingsFromAxes, readingsToAxes, type HeatmapGridParams, type MetadataCarrier } from '../heatmapRun.js';

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
    [400, 300, ['10', '5']],
    [100, 300, ['0']],
    [100, 100, ['20', '4']],
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

  it('carries the GRID through the file, as PARAMETERS against the axis position', () => {
    // ⚑⚑ P2. The file holds parameters, never absolute coordinates — David:
    // *"The grid is not absolute, but in relation to the calibrated axis
    // position."* So a reopened project draws its grid in the same PLACE on the
    // figure whatever the axes are later corrected to say.
    const before = calibratedSession();
    const grid: HeatmapGridParams = { x: [0, 0.1, 0.35, 1], y: [0, 0.2, 1] };
    gridToAxes(before.getAxes()!, grid);
    const { session: after } = roundTrip(before);
    expect(gridFromAxes(after.getAxes()!)).toEqual(grid);
  });

  it('⚑ IGNORES an older build’s grid rather than reading it as parameters', () => {
    // The two shapes are identical — a bare list per axis — so a v2.2 file's
    // absolute coordinates would be read as parameters and every boundary would
    // land somewhere wrong, silently. The key changed with the meaning, so an
    // old grid is ABSENT instead of WRONG.
    const s = calibratedSession();
    const axes = s.getAxes()!;
    axes.setMetadata({ ...axes.getMetadata(), heatmapGrid: { x: [0, 1, 3.5, 10], y: [0, 2, 20] } });
    expect(gridFromAxes(axes)).toBeNull();
  });

  it('carries the axis NAMES through the file, beside the grid', () => {
    // ⚑⚑ A reopened heatmap whose columns lost their names exports the index
    // numbers the names exist to replace — silently, with every value correct.
    const before = calibratedSession();
    labelsToAxes(before.getAxes()!, { x: ['BRCA1', 'TP53'], y: ['tumour', 'normal'] });
    const { session: after } = roundTrip(before);
    expect(labelsFromAxes(after.getAxes()!)).toEqual({ x: ['BRCA1', 'TP53'], y: ['tumour', 'normal'] });
  });

  it('has no names at all for a value × value heatmap, rather than empty lists in the file', () => {
    expect(labelsFromAxes(calibratedSession().getAxes()!)).toEqual({ x: [], y: [] });
    const session = calibratedSession();
    labelsToAxes(session.getAxes()!, { x: ['A'], y: [] });
    labelsToAxes(session.getAxes()!, { x: [], y: [] });
    expect(session.getAxes()!.getMetadata()['heatmapLabels']).toBeUndefined();
  });

  it('REFUSES what a hand-edited file might carry, rather than printing it on the figure', () => {
    // ⚑ A load-path entrance, so it validates like `gridFromAxes` does.
    // `String(undefined)` would put the word "undefined" on a column of a
    // published figure and export it as the name.
    const session = calibratedSession();
    session.getAxes()!.setMetadata({ ...session.getAxes()!.getMetadata(), heatmapLabels: { x: ['A', 7, null], y: 'nonsense' } });
    expect(labelsFromAxes(session.getAxes()!)).toEqual({ x: ['A', '', ''], y: [] });
    session.getAxes()!.setMetadata({ ...session.getAxes()!.getMetadata(), heatmapLabels: 'not an object' });
    expect(labelsFromAxes(session.getAxes()!)).toEqual({ x: [], y: [] });
  });

  it('is null for an axes carrying no grid, rather than an empty one', () => {
    expect(gridFromAxes(calibratedSession().getAxes()!)).toBeNull();
  });

  it('clears the grid rather than writing one that is not a grid', () => {
    const session = calibratedSession();
    gridToAxes(session.getAxes()!, { x: [0, 1], y: [0, 1] });
    gridToAxes(session.getAxes()!, null);
    expect(gridFromAxes(session.getAxes()!)).toBeNull();
    expect(session.getAxes()!.getMetadata()['heatmapGridParams']).toBeUndefined();
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

  it('sorts a grid that arrives out of order — at the door that RESOLVES it', () => {
    // ⚑ The ordering guard moved with P2, and deliberately. `gridFromAxes` now
    // reads PARAMETERS, where "ascending" is not yet meaningful: an axis
    // calibrated backwards has parameters that ascend while its data
    // coordinates descend. Sorting belongs where the numbers become dividers,
    // which is `resolveHeatmapGrid` → `checkDividers` — the same rule the
    // interactive path applies, applied once.
    const session = calibratedSession();
    const axes = session.getAxes()!;
    axes.setMetadata({ ...axes.getMetadata(), heatmapGridParams: { x: [1, 0, 0.3], y: [1, 0] } });
    const params = gridFromAxes(axes)!;
    expect(resolveHeatmapGrid(params, { x: [0, 10], y: [0, 5] })).toEqual({
      xDividers: [0, 3, 10],
      yDividers: [0, 5],
    });
  });
});

/**
 * ⚑⚑ A RE-CALIBRATION MUST NOT SILENTLY EMPTY THE RECORD.
 *
 * `runCalibration()` ends with `this.axes = result.axes` — a BRAND-NEW axes
 * object from `buildAxes`. Everything the heatmap keeps in axes metadata rides
 * on the OLD one: the grid, the axis names, and the cells a person read
 * themselves. Nothing copied them across, so any of these wiped all three:
 *
 *   · editing a calibration value (`setCalibrationValues` re-calibrates)
 *   · nudging or dragging a calibration handle
 *   · ticking an option once the axes exist (`setOption` re-calibrates)
 *
 * ⚠️ AND IT LOSES SILENTLY, WHICH IS WHY IT MATTERS. The Workspace holds the
 * same values in React state, so the SCREEN still shows the grid and the
 * corrected cells afterwards — while the axes a Save serialises no longer has
 * them. The user sees their work; the file does not contain it.
 *
 * ⚑ Found while preparing C3/C4 (warn before a count change discards
 * adjustments). There was no point warning about discarded adjustments while a
 * far quieter path was discarding everything, unasked.
 */
describe('a re-calibration keeps what the axes was carrying', () => {
  it('keeps the grid, the names AND the user’s own cell readings', () => {
    const s = calibratedSession();
    const axes = s.getAxes()! as unknown as MetadataCarrier;
    gridToAxes(axes, { x: [0, 0.2, 0.48, 1], y: [0, 0.5, 1] });
    labelsToAxes(axes, { x: ['BRCA1', 'TP53'], y: ['tumour'] });
    readingsToAxes(axes, { '1,1': 0.42 });

    // The quietest re-calibration there is: the same value typed again.
    expect(s.setCalibrationValues('x1', ['0'])).toBe(true);

    const after = s.getAxes()! as unknown as MetadataCarrier;
    expect(gridFromAxes(after)).toEqual({ x: [0, 0.2, 0.48, 1], y: [0, 0.5, 1] });
    expect(labelsFromAxes(after)).toEqual({ x: ['BRCA1', 'TP53'], y: ['tumour'] });
    expect(readingsFromAxes(after)).toEqual({ '1,1': 0.42 });
  });

  it('keeps them when an OPTION is toggled on a live calibration', () => {
    // `setOption` re-calibrates as soon as the axes exist, so it is the same
    // door by another name — and the one a user opens most casually.
    const s = calibratedSession();
    const axes = s.getAxes()! as unknown as MetadataCarrier;
    readingsToAxes(axes, { '2,0': 0.7 });
    s.setOption('isLogValue', 'false');
    expect(readingsFromAxes(s.getAxes()! as unknown as MetadataCarrier)).toEqual({ '2,0': 0.7 });
  });

  it('still lets the new calibration stamp its own keys', () => {
    // ⚑ The carry must not overwrite what `buildAxes` just wrote: the graph-type
    // stamp is set on the NEW axes, and a blind copy of the old metadata over
    // the top would restore a stale one. New wins where both have a key.
    const s = calibratedSession();
    expect(s.setCalibrationValues('x1', ['0'])).toBe(true);
    expect(
      (s.getAxes()! as unknown as MetadataCarrier).getMetadata()[GRAPH_TYPE_METADATA_KEY]
    ).toBe('heatmap');
  });
});
