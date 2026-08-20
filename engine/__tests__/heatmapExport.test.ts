import { describe, expect, it } from 'vitest';
import { heatmapCellsSection, heatmapKeySection, heatmapMatrixSection, buildHeatmapJSON, type HeatmapExportCell } from '../csvExport.js';
import { makeRounder } from '../../core/exportPrecision.js';
import { XYAxes } from '../../core/axes/xy.js';
import { Calibration } from '../../core/calibration.js';
import { renderTable } from '../tableFormats.js';
import { buildExportJson, buildExportSections } from '../exportAssembly.js';
import { CalibrationSession, HEATMAP_AXES_CONFIG } from '../calibrationSession.js';

/**
 * The heatmap's exported record (v2.2).
 *
 * ⚑ THE RECORD IS THE LONG FORM AND THE MATRIX IS DERIVED FROM IT - both are
 * written, because the two library conventions are real: tidy/one-row-per-cell
 * (ggplot2's `geom_tile`, vega-lite) and wide/matrix (matplotlib, plotly,
 * seaborn, R's `image`). A file serving one fails the other.
 *
 * ⚑ AND THE EVIDENCE RIDES IN THE ROW. In a heatmap the colour IS the value, so
 * a wrong cell has no other symptom; a file that dropped the interval, the
 * colour offset and the uniformity would hand on numbers nobody could check.
 */

function axes(): XYAxes {
  const cal = new Calibration();
  cal.addPoint(100, 300, '0', '');
  cal.addPoint(400, 300, '10', '', '5');
  cal.addPoint(100, 300, '', '0');
  cal.addPoint(100, 100, '', '20', '4');
  const a = new XYAxes();
  expect(a.calibrate(cal, false, false, true)).toBe(true);
  return a;
}

const cell = (over: Partial<HeatmapExportCell>): HeatmapExportCell => ({
  col: 0,
  row: 0,
  xMin: 0,
  xMax: 1,
  yMin: 0,
  yMax: 2,
  xCentre: 0.5,
  yCentre: 1,
  value: 42.5,
  uniformity: 1,
  ...over,
});

/** Two columns × two rows, unequal, with distinct values. */
/** ⚑ A 2 × 2 grid, and its cells now carry their OWN col/row rather than the
 * factory's zeros. A fixture where every cell is `C1 R1` cannot see an identity
 * column that is wrong - which is exactly the blindness that let the export ship
 * without one. */
const GRID: HeatmapExportCell[] = [
  cell({ col: 0, row: 0, xMin: 0, xMax: 1, yMin: 0, yMax: 2, xCentre: 0.5, yCentre: 1, value: 10 }),
  cell({ col: 1, row: 0, xMin: 1, xMax: 4, yMin: 0, yMax: 2, xCentre: 2.5, yCentre: 1, value: 20 }),
  cell({ col: 0, row: 1, xMin: 0, xMax: 1, yMin: 2, yMax: 3, xCentre: 0.5, yCentre: 2.5, value: 30 }),
  cell({ col: 1, row: 1, xMin: 1, xMax: 4, yMin: 2, yMax: 3, xCentre: 2.5, yCentre: 2.5, value: 40 }),
];

describe('heatmapCellsSection', () => {
  it('writes the bounds, the centre AND the extent, so no reader does arithmetic', () => {
    // ⚑ Edges → centres is derivable; centres → edges is NOT once cells are
    // unequal. matplotlib settles it: `shading='flat'` REQUIRES n+1 edges and
    // refuses centres, `shading='nearest'` takes centres.
    // ⚑⚑ WIDTH AND HEIGHT ADDED 2026-08-14. The error-bar precedent is to carry
    // the absolutes AND the delta so neither reader computes; cells carried the
    // absolutes and the centre and stopped. `bar(x, height, WIDTH)` takes a
    // width directly, so one of the two real consumer conventions was left to
    // work it out. Area stays DERIVED - colour is the value and the bounds say
    // where it applies; area is measured only in a mosaic, where geometry IS
    // the value.
    const section = heatmapCellsSection(GRID, makeRounder(axes(), 'auto'));
    expect(section.header.slice(0, 2)).toEqual(['column', 'row']);
    expect(section.header.slice(2, 11)).toEqual([
      'x min',
      'x max',
      'y min',
      'y max',
      'x centre',
      'y centre',
      'x width',
      'y height',
      'value',
    ]);
    expect(section.rows).toHaveLength(4);
    expect(section.rows[1]!.slice(2, 11)).toEqual([1, 4, 0, 2, 2.5, 1, 3, 2, 20]);
  });

  it('carries the value, which instrument read it, and the uniformity into the file', () => {
    // ⚑ `value low`, `value high`, `colour offset` and `at key limit` used to sit
    // in this row. They were the old error model's output, and reading a colour
    // is a lookup against the calibrated range now - it is on the range or it is
    // not, so there is no interval to carry. Uniformity stays because it is not
    // about the axis: it says how much of the cell held the colour WE chose to
    // sample.
    const section = heatmapCellsSection(
      [cell({ value: 42.5, uniformity: 0.75 })],
      makeRounder(axes(), 'auto')
    );
    expect(section.header.slice(section.header.indexOf('value') + 1)).toEqual([
      'value source',
      'uniformity',
    ]);
    expect(section.rows[0]!.slice(section.header.indexOf('value') + 1)).toEqual(['colour', 0.75]);
  });

  it('writes an unread cell EMPTY, never as zero', () => {
    // ⚑ `0` is a value a heatmap might really contain, so it can never stand in
    // for "no reading". The bounds are still written: the cell exists, and its
    // absence of a value is the measurement.
    const section = heatmapCellsSection(
      [cell({ value: null, uniformity: 0 })],
      makeRounder(axes(), 'auto')
    );
    // ⚑ The SOURCE still says `colour`: the colour is what was looked at, and
    // finding no value there is the measurement. An empty source would say
    // nothing was read, which is a different claim.
    expect(section.rows[0]!.slice(section.header.indexOf('value'))).toEqual(['', 'colour', 0]);
    // ⚑ Identity is written even for a cell with NO VALUE: the cell exists, and
    // saying which one it is costs nothing. Bounds follow it.
    expect(section.rows[0]!.slice(0, 2)).toEqual(['C1', 'R1']);
    expect(section.rows[0]!.slice(2, 6)).toEqual([0, 1, 0, 2]);
  });

  it('does NOT round the value through the figure’s pixel resolution', () => {
    // ⚑ The value is read off the COLOUR KEY, whose resolution has nothing to do
    // with the plot's pixel pitch. Rounding it through the axes would claim a
    // precision borrowed from the wrong instrument - while the coordinates,
    // which ARE pixel-derived, are rounded exactly as every other export is.
    const section = heatmapCellsSection([cell({ value: 42.123456789 })], makeRounder(axes(), 'auto'));
    expect(section.rows[0]![section.header.indexOf('value')]).toBe(42.123456789);
  });

  // ⚠️ REMOVED WITH `atKeyLimit` - see heatmapRead.test.ts for the argument.
  it('says WHICH INSTRUMENT read every value, in every file', () => {
    // ⚑⚑ B16. The three instruments fail in OPPOSITE ways - OCR reads ink as
    // GLYPHS and fails discretely (right, or badly wrong); the colour reads it
    // as a RAMP and fails continuously (small, silent); a person sees what both
    // machines are blind to. A consumer treating an OCR'd 59 and a
    // colour-inverted 58.7 as the same kind of number is wrong about both, so
    // this is a fact about the VALUE and belongs beside it.
    // ⚑ UNCONDITIONAL, unlike the label columns. A missing `x label` column says
    // plainly that nothing is named; a missing source column would say nothing
    // at all, and leave a reader to assume a default they were never told.
    // Evidence columns are always written here - `uniformity` and `at key limit`
    // set that precedent, and this is one of them.
    const section = heatmapCellsSection(
      [cell({ value: 42.5, source: 'colour' }), cell({ value: 59, source: 'user' })],
      makeRounder(axes(), 'auto')
    );
    const at = section.header.indexOf('value source');
    expect(at).toBeGreaterThan(section.header.indexOf('value'));
    expect(section.rows.map((r) => r[at])).toEqual(['colour', 'user']);
    // A cell whose row says nothing about its source was read the way every
    // cell was read before a second instrument existed.
    expect(heatmapCellsSection([cell({})], makeRounder(axes(), 'auto')).rows[0]![at]).toBe('colour');
  });

  it('carries the source into the JSON too - the machine-readable half', () => {
    // ⚑ The bracket around `[59]` in the table is the half that survives a paste
    // into a spreadsheet; this is the half a program can read. Both channels,
    // because they reach different readers.
    const doc = JSON.parse(
      buildHeatmapJSON([cell({ value: 59, source: 'user' }), cell({ value: 42.5 })])
    ) as { cells: Array<{ valueSource: string }> };
    expect(doc.cells.map((c) => c.valueSource)).toEqual(['user', 'colour']);
  });

  it('renders through the ordinary table formats', () => {
    const csv = renderTable([heatmapCellsSection(GRID, makeRounder(axes(), 'auto'))], 'csv');
    expect(csv).toMatch(/x min,x max,y min,y max,x centre,y centre,x width,y height,value/);
    expect(csv.split('\n').filter((l) => l.trim() !== '')).toHaveLength(6); // title + header + 4
  });
});

describe('heatmapMatrixSection', () => {
  it('pivots the same cells into the wide form', () => {
    const section = heatmapMatrixSection(GRID);
    expect(section.header).toEqual(['y \\ x', 0.5, 2.5]);
    expect(section.rows).toEqual([
      [1, 10, 20],
      [2.5, 30, 40],
    ]);
  });

  it('leaves a missing cell blank rather than shifting the row', () => {
    // A matrix with a hole is still a matrix; a matrix whose row is one short is
    // a different figure.
    const section = heatmapMatrixSection([GRID[0]!, GRID[1]!, GRID[3]!]);
    expect(section.rows).toEqual([
      [1, 10, 20],
      [2.5, '', 40],
    ]);
  });

  it('orders both axes ascending whatever order the cells arrive in', () => {
    const section = heatmapMatrixSection([GRID[3]!, GRID[1]!, GRID[2]!, GRID[0]!]);
    expect(section.header).toEqual(['y \\ x', 0.5, 2.5]);
    expect(section.rows[0]).toEqual([1, 10, 20]);
  });
});

describe('a NAMED axis - "the label is the coordinate"', () => {
  /** The same grid with gene names on x and one sample name on y - the shape a
   * gene × sample or confusion-matrix figure actually has. */
  const NAMED: HeatmapExportCell[] = [
    { ...GRID[0]!, xLabel: 'BRCA1', yLabel: 'tumour' },
    { ...GRID[1]!, xLabel: 'TP53', yLabel: 'tumour' },
    { ...GRID[2]!, xLabel: 'BRCA1' },
    { ...GRID[3]!, xLabel: 'TP53' },
  ];

  it('adds the name BESIDE the measured bounds, never instead of them', () => {
    // ⚑⚑ The bounds are read off the pixels and stay true whatever the axis is
    // called; the name is the coordinate a reader can rejoin to their own data.
    // Dropping either half breaks a real consumer.
    const section = heatmapCellsSection(NAMED, makeRounder(axes(), 'auto'));
    // ⚑ Identity FIRST, unconditionally, then the names where the figure prints them.
    expect(section.header.slice(0, 4)).toEqual(['column', 'row', 'x label', 'y label']);
    expect(section.rows[1]!.slice(0, 13)).toEqual(['C2', 'R1', 'TP53', 'tumour', 1, 4, 0, 2, 2.5, 1, 3, 2, 20]);
  });

  it('leaves a VALUE axis with no NAME columns - but it still gets its identity', () => {
    // ⚑ The histogram's `value error` rule still holds for the NAMES: a label
    // column exists only when something fills it.
    // ⚠️ IDENTITY IS THE EXCEPTION, and deliberately. Those columns used to be
    // the only thing saying which cell a row was, so a value × value heatmap
    // exported bounds and nothing else to join on - David: *"whatever we export
    // needs to be usable as a basis for reconstructing the same graph."*
    const valueOnly = heatmapCellsSection(GRID, makeRounder(axes(), 'auto'));
    expect(valueOnly.header.slice(0, 3)).toEqual(['column', 'row', 'x min']);
    expect(valueOnly.header).not.toContain('x label');
    expect(valueOnly.header).not.toContain('y label');
    expect(valueOnly.rows[3]!.slice(0, 2)).toEqual(['C2', 'R2']);
    // …and an axis named on ONE side only grows that side's column alone.
    const xOnly = NAMED.map((c) => ({ ...c, yLabel: '' }));
    expect(heatmapCellsSection(xOnly, makeRounder(axes(), 'auto')).header.slice(0, 4)).toEqual(['column', 'row', 'x label', 'x min']);
  });

  it('puts the names in the MATRIX headers, where there is only one slot', () => {
    // The matrix cannot carry both, and a named axis whose header row reads
    // "0.5, 2.5" is the file this whole feature exists to stop shipping.
    const section = heatmapMatrixSection(NAMED);
    expect(section.header).toEqual(['y \\ x', 'BRCA1', 'TP53']);
    // The unnamed row keeps its measured centre, so a half-named axis stays
    // addressable instead of going blank.
    expect(section.rows.map((r) => r[0])).toEqual(['tumour', 2.5]);
    expect(section.rows[0]!.slice(1)).toEqual([10, 20]);
  });

  it('carries the names into the JSON, alongside the coordinate vectors', () => {
    const doc = JSON.parse(buildHeatmapJSON(NAMED)) as {
      cells: Array<Record<string, unknown>>;
      matrix: { x: number[]; xLabels?: string[]; yLabels?: string[] };
    };
    expect(doc.cells[1]!['xLabel']).toBe('TP53');
    // ⚑ Positions AND tick labels, aligned index for index - matplotlib wants
    // numbers for the first and strings for the second.
    expect(doc.matrix.x).toEqual([0.5, 2.5]);
    expect(doc.matrix.xLabels).toEqual(['BRCA1', 'TP53']);
    expect(doc.matrix.yLabels).toEqual(['tumour', '']);
    // A value axis writes no label keys at all.
    const plain = JSON.parse(buildHeatmapJSON(GRID)) as { cells: Array<Record<string, unknown>>; matrix: Record<string, unknown> };
    expect('xLabel' in plain.cells[0]!).toBe(false);
    expect('xLabels' in plain.matrix).toBe(false);
  });
});

describe('buildHeatmapJSON', () => {
  it('writes the record and the matrix, both', () => {
    const doc = JSON.parse(buildHeatmapJSON(GRID)) as {
      cells: Array<Record<string, unknown>>;
      matrix: { x: number[]; y: number[]; values: (number | null)[][] };
    };
    expect(doc.cells).toHaveLength(4);
    expect(doc.cells[0]).toEqual({
      xMin: 0,
      xMax: 1,
      yMin: 0,
      yMax: 2,
      xCentre: 0.5,
      yCentre: 1,
      value: 10,
      valueSource: 'colour',
      uniformity: 1,
    });
    expect(doc.matrix).toEqual({ x: [0.5, 2.5], y: [1, 2.5], values: [[10, 20], [30, 40]] });
  });

  it('uses null for an unread cell, which survives the round trip', () => {
    // ⚑ NaN would not: JSON rewrites it as null anyway, and `null * x === 0` is
    // how a laundered NaN once became a flat line at zero. Writing null on
    // purpose means the reader gets the same thing we meant.
    const doc = JSON.parse(buildHeatmapJSON([cell({ value: null })])) as {
      cells: Array<Record<string, unknown>>;
      matrix: { values: (number | null)[][] };
    };
    expect(doc.cells[0]!['value']).toBeNull();
    expect(doc.matrix.values[0]![0]).toBeNull();
  });

  it('appends measurements when there are any, and nothing when there are not', () => {
    expect(JSON.parse(buildHeatmapJSON(GRID))).not.toHaveProperty('measurements');
    const withMeasures = JSON.parse(
      buildHeatmapJSON(GRID, [{ tool: 'distance', value: 3, unit: 'mm' }])
    ) as Record<string, unknown>;
    expect(withMeasures['measurements']).toEqual([{ tool: 'distance', value: 3, unit: 'mm' }]);
  });

  it('is an empty record, not a broken one, before any cell has been read', () => {
    const doc = JSON.parse(buildHeatmapJSON([])) as { cells: unknown[]; matrix: { values: unknown[] } };
    expect(doc.cells).toEqual([]);
    expect(doc.matrix).toEqual({ x: [], y: [], values: [] });
  });
});

describe('the export ROUTES a heatmap session to those sections', () => {
  /**
   * ⚑ THE GATE, not the sections. A shape that renders perfectly and is never
   * reached is this project's own recurring failure - a feature measured
   * against 882 figures in a harness while `Workspace.tsx` never called it.
   * These go through `buildExportSections`/`buildExportJson`, the two functions
   * the Export menu actually calls.
   */
  function heatmapSession(): CalibrationSession<XYAxes> {
    const s = new CalibrationSession(HEATMAP_AXES_CONFIG);
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

  const input = (cells: HeatmapExportCell[]) => {
    const session = heatmapSession();
    return {
      session: session as unknown as CalibrationSession<XYAxes>,
      axes: session.getAxes()!,
      configId: 'heatmap',
      scope: 'active' as const,
      precision: 'auto' as const,
      measures: [],
      heatmapCells: cells,
    };
  };

  it('declares the heatmap shape rather than falling through to flat rows', () => {
    expect(heatmapSession().getExportShape()).toBe('heatmap');
  });

  it('builds the cells section and the matrix, in that order', () => {
    const sections = buildExportSections(input(GRID));
    expect(sections[0]!.title).toBe('Cells');
    expect(sections[0]!.rows).toHaveLength(4);
    expect(sections[1]!.title).toBe('Matrix (value per cell)');
  });

  it('writes the heatmap JSON, not the generic series JSON', () => {
    const doc = JSON.parse(buildExportJson(input(GRID))) as Record<string, unknown>;
    expect(doc).toHaveProperty('cells');
    expect(doc).toHaveProperty('matrix');
    expect(doc).not.toHaveProperty('series');
  });

  it('exports an empty table before Read cells, rather than an empty FIGURE', () => {
    // A heatmap with no cells read is not a heatmap with no data - and the file
    // has no way to say which, so it says what it has: nothing yet.
    const sections = buildExportSections(input([]));
    expect(sections[0]!.rows).toEqual([]);
    expect(JSON.parse(buildExportJson(input([]))).cells).toEqual([]);
  });
});

describe('B10 - the colour key’s extent travels with the export', () => {
  /**
   * ⚑⚑ David asked whether the weld sample could be regenerated from what we
   * save. Its generator is in the repo:
   *
   *   pcolormesh(x_edges, y_edges, values, cmap="viridis", vmin=60, vmax=780)
   *
   * The DATA reproduced exactly - `x_edges` and `y_edges` fall out of the cell
   * bounds and the matrix IS the value array, unequal cells included. But
   * `vmin`/`vmax` never left the app: we exported readings taken ON the colour
   * axis and never the axis's own span, while x and y have carried theirs all
   * along because every cell writes its bounds. A consumer redrawing falls back
   * to the values' own min and max and gets different colours, with nothing
   * saying why.
   *
   * ⚑ The COLORMAP stays out. We measure the ramp rather than guessing which
   * published map it is, and an inferred name would be the one part of the file
   * nobody could check.
   */
  const KEY = { from: 60, to: 780, log: false };

  it('writes the key’s span as its own section', () => {
    const section = heatmapKeySection(KEY);
    expect(section.title).toBe('Colour key');
    expect(section.header).toEqual(['key from', 'key to', 'log']);
    expect(section.rows[0]).toEqual([60, 780, '']);
  });

  it('keeps the click ORDER, because a key may run high to low', () => {
    expect(heatmapKeySection({ from: 780, to: 60, log: false }).rows[0]).toEqual([780, 60, '']);
  });

  it('says when the key is logarithmic', () => {
    expect(heatmapKeySection({ ...KEY, log: true }).rows[0]).toEqual([60, 780, 'yes']);
  });

  it('carries it in the JSON beside the cells', () => {
    const doc = JSON.parse(buildHeatmapJSON(GRID, [], KEY)) as {
      colourKey?: { from: number; to: number; log: boolean };
    };
    expect(doc.colourKey).toEqual({ from: 60, to: 780, log: false });
  });

  it('writes NOTHING when the key could not be read, rather than a guess', () => {
    // ⚑ The same rule the grid follows: assert only what was measured.
    const doc = JSON.parse(buildHeatmapJSON(GRID, [])) as Record<string, unknown>;
    expect(doc['colourKey']).toBeUndefined();
  });
});
