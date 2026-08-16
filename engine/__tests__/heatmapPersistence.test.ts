import { describe, expect, it } from 'vitest';
import { CalibrationSession, HEATMAP_AXES_CONFIG, GRAPH_TYPE_METADATA_KEY } from '../calibrationSession.js';
import { XYAxes } from '../../core/axes/xy.js';
import { serializeProject, deserializeProject } from '../projectFile.js';
import { resolveHeatmapGrid } from '../heatmapRun.js';

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
  next.loadCalibrated(opened.axes as unknown as XYAxes, opened.datasets, opened.categoryAxis, opened.heatmapLayer);
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

  it('carries the GRID through the FILE, as PARAMETERS against the axis position', () => {
    // ⚑⚑ P2. The file holds parameters, never absolute coordinates — David:
    // *"The grid is not absolute, but in relation to the calibrated axis
    // position."* So a reopened project draws its grid in the same PLACE on the
    // figure whatever the axes are later corrected to say.
    const before = calibratedSession();
    const grid = { x: [0, 0.1, 0.35, 1], y: [0, 0.2, 1] };
    before.setHeatmapLayer({ grid });
    const { session: after } = roundTrip(before);
    expect(after.getHeatmapLayer()?.grid).toEqual(grid);
  });

  it('carries the axis NAMES through the file, beside the grid', () => {
    // ⚑⚑ A reopened heatmap whose columns lost their names exports the index
    // numbers the names exist to replace — silently, with every value correct.
    const before = calibratedSession();
    before.setHeatmapLayer({ labels: { x: ['BRCA1', 'TP53'], y: ['tumour', 'normal'] } });
    const { session: after } = roundTrip(before);
    expect(after.getHeatmapLayer()?.labels).toEqual({ x: ['BRCA1', 'TP53'], y: ['tumour', 'normal'] });
  });

  it('writes NO layer at all for a value × value heatmap that has none', () => {
    // ⚑ Absent, not empty. Every project that is not a heatmap — and every
    // heatmap whose grid was never read — writes the same file it always did.
    const { session: after } = roundTrip(calibratedSession());
    expect(after.getHeatmapLayer()).toBeNull();
  });

  it('REFUSES a grid from a file that the app would not let you draw', () => {
    // ⚑ A load-path entrance: these numbers can come from a hand-edited file, an
    // older build, or another tool. The same rule the interactive path applies
    // is applied here, so a file cannot install a grid with one boundary, which
    // bounds nothing, or a divider that is not a number.
    for (const bad of [
      { x: [1], y: [0, 5] },
      { x: [0, 'nonsense'], y: [0, 5] },
      { x: [0, 5], y: 'not an array' },
      { x: [0, 5] },
    ]) {
      const session = calibratedSession();
      session.setHeatmapLayer({ grid: bad as unknown as { x: number[]; y: number[] } });
      const { session: after } = roundTrip(session);
      expect(after.getHeatmapLayer()?.grid, JSON.stringify(bad)).toBeUndefined();
    }
  });

  it('sorts a grid that arrives out of order — at the door that RESOLVES it', () => {
    // ⚑ The ordering guard moved with P2, and deliberately. The FILE holds
    // PARAMETERS, where "ascending" is not yet meaningful: an axis calibrated
    // backwards has parameters that ascend while its data coordinates descend.
    // Sorting belongs where the numbers become dividers, which is
    // `resolveHeatmapGrid` → `checkDividers` — the same rule the interactive
    // path applies, applied once.
    const session = calibratedSession();
    session.setHeatmapLayer({ grid: { x: [1, 0, 0.3], y: [1, 0] } });
    const { session: after } = roundTrip(session);
    const params = after.getHeatmapLayer()!.grid!;
    expect(resolveHeatmapGrid(params, { x: [0, 10], y: [0, 5] })).toEqual({
      xDividers: [0, 3, 10],
      yDividers: [0, 5],
    });
  });
});

describe('⚑⚑ the heatmap RECORD is a LAYER, not part of the calibration', () => {
  const LAYER = {
    grid: { x: [0, 0.2, 0.48, 1], y: [0, 0.5, 1] },
    labels: { x: ['BRCA1', 'TP53'], y: ['tumour'] },
    readings: { '1,1': 0.42 },
  };

  it('survives a re-calibration because nothing COPIES it — it was never there', () => {
    // ⚑⚑ THE POINT OF THE WHOLE CHANGE. David: *"Anything detected on the graph
    // sits on TOP of the calibration… not be a part of it. We should and need to
    // be able to adjust the axis calibrations independently of changing the
    // grid."*
    //
    // ⚠️ The record used to live in AXES METADATA, and `runCalibration` ends
    // with `this.axes = result.axes` — a brand-new object — so re-calibrating
    // emptied it. The fix at the time COPIED the metadata across. This asserts
    // the structural version: the layer is on the SESSION, so the two are
    // independent and there is nothing to copy.
    const s = calibratedSession();
    s.setHeatmapLayer(LAYER);

    // The quietest re-calibration there is: the same value typed again.
    expect(s.setCalibrationValues('x1', ['0'])).toBe(true);
    expect(s.getHeatmapLayer()).toEqual(LAYER);

    // And the door a user opens most casually — `setOption` re-calibrates the
    // moment the axes exist.
    s.setOption('isLogValue', 'false');
    expect(s.getHeatmapLayer()).toEqual(LAYER);
  });

  it('rides the UNDO snapshot, which is the entrance this project keeps missing', () => {
    // ⚑ `captureState` is a THIRD entrance for the category axis by its own
    // comment; the heatmap layer is the fourth, and it goes through the same
    // door rather than a new one.
    const s = calibratedSession();
    s.setHeatmapLayer(LAYER);
    const snap = s.captureState();
    s.setHeatmapLayer(null);
    expect(s.getHeatmapLayer()).toBeNull();
    s.restoreState(snap);
    expect(s.getHeatmapLayer()).toEqual(LAYER);
  });

  it('round-trips through the FILE', () => {
    const before = calibratedSession();
    before.setHeatmapLayer(LAYER);
    const { session: after } = roundTrip(before);
    expect(after.getHeatmapLayer()).toEqual(LAYER);
  });

  it('is CLEARED by a reset — the old figure\u2019s grid is not the new one\u2019s', () => {
    // Same sentence `categoryAxis` is cleared on: "discard every series and
    // point" does not promise to keep a grid describing the figure that just
    // went away.
    const s = calibratedSession();
    s.setHeatmapLayer(LAYER);
    s.reset();
    expect(s.getHeatmapLayer()).toBeNull();
  });

  it('DROPS a malformed layer whole rather than reading half of it', () => {
    // ⚑ A load entrance, guarded like every other. A grid with two good
    // dividers and one `"x"` would otherwise place a boundary the user never
    // put anywhere — and on a heatmap a wrong boundary has NO visible symptom,
    // because the colour IS the value.
    const before = calibratedSession();
    before.setHeatmapLayer({ grid: { x: [0, 'x' as unknown as number, 1], y: [0, 1] } });
    const { session: after } = roundTrip(before);
    expect(after.getHeatmapLayer()?.grid).toBeUndefined();
  });

  it('keeps a reading only under the model\u2019s own key format', () => {
    const before = calibratedSession();
    before.setHeatmapLayer({ readings: { '1,1': 0.42, 'not-a-cell': 0.9 } });
    const { session: after } = roundTrip(before);
    expect(after.getHeatmapLayer()?.readings).toEqual({ '1,1': 0.42 });
  });
});

