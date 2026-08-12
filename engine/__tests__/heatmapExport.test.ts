import { describe, expect, it } from 'vitest';
import { heatmapCellsSection, heatmapMatrixSection, buildHeatmapJSON, type HeatmapExportCell } from '../csvExport.js';
import { makeRounder } from '../../core/exportPrecision.js';
import { XYAxes } from '../../core/axes/xy.js';
import { Calibration } from '../../core/calibration.js';
import { renderTable } from '../tableFormats.js';
import { buildExportJson, buildExportSections } from '../exportAssembly.js';
import { CalibrationSession, HEATMAP_AXES_CONFIG } from '../calibrationSession.js';

/**
 * The heatmap's exported record (v2.2).
 *
 * ⚑ THE RECORD IS THE LONG FORM AND THE MATRIX IS DERIVED FROM IT — both are
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
  cal.addPoint(400, 300, '10', '');
  cal.addPoint(100, 300, '', '0');
  cal.addPoint(100, 100, '', '20');
  const a = new XYAxes();
  expect(a.calibrate(cal, false, false, true)).toBe(true);
  return a;
}

const cell = (over: Partial<HeatmapExportCell>): HeatmapExportCell => ({
  xMin: 0,
  xMax: 1,
  yMin: 0,
  yMax: 2,
  xCentre: 0.5,
  yCentre: 1,
  value: 42.5,
  low: 41,
  high: 44,
  distance: 0,
  uniformity: 1,
  ...over,
});

/** Two columns × two rows, unequal, with distinct values. */
const GRID: HeatmapExportCell[] = [
  cell({ xMin: 0, xMax: 1, yMin: 0, yMax: 2, xCentre: 0.5, yCentre: 1, value: 10 }),
  cell({ xMin: 1, xMax: 4, yMin: 0, yMax: 2, xCentre: 2.5, yCentre: 1, value: 20 }),
  cell({ xMin: 0, xMax: 1, yMin: 2, yMax: 3, xCentre: 0.5, yCentre: 2.5, value: 30 }),
  cell({ xMin: 1, xMax: 4, yMin: 2, yMax: 3, xCentre: 2.5, yCentre: 2.5, value: 40 }),
];

describe('heatmapCellsSection', () => {
  it('writes the bounds AND the centre, so neither reader does arithmetic', () => {
    // ⚑ Edges → centres is derivable; centres → edges is NOT once cells are
    // unequal. matplotlib settles it: `shading='flat'` REQUIRES n+1 edges and
    // refuses centres, `shading='nearest'` takes centres.
    const section = heatmapCellsSection(GRID, makeRounder(axes(), 'auto'));
    expect(section.header.slice(0, 7)).toEqual([
      'x min',
      'x max',
      'y min',
      'y max',
      'x centre',
      'y centre',
      'value',
    ]);
    expect(section.rows).toHaveLength(4);
    expect(section.rows[1]!.slice(0, 7)).toEqual([1, 4, 0, 2, 2.5, 1, 20]);
  });

  it('carries the interval, the colour offset and the uniformity into the file', () => {
    const section = heatmapCellsSection(
      [cell({ value: 42.5, low: 41, high: 44, distance: 2.5, uniformity: 0.75 })],
      makeRounder(axes(), 'auto')
    );
    expect(section.header.slice(7)).toEqual([
      'value low',
      'value high',
      'colour offset',
      'uniformity',
      'at key limit',
    ]);
    expect(section.rows[0]!.slice(6)).toEqual([42.5, 41, 44, 2.5, 0.75, '']);
  });

  it('writes an unread cell EMPTY, never as zero', () => {
    // ⚑ `0` is a value a heatmap might really contain, so it can never stand in
    // for "no reading". The bounds are still written: the cell exists, and its
    // absence of a value is the measurement.
    const section = heatmapCellsSection(
      [cell({ value: null, low: null, high: null, distance: null, uniformity: 0 })],
      makeRounder(axes(), 'auto')
    );
    expect(section.rows[0]!.slice(6)).toEqual(['', '', '', '', 0, '']);
    expect(section.rows[0]!.slice(0, 4)).toEqual([0, 1, 0, 2]);
  });

  it('does NOT round the value through the figure’s pixel resolution', () => {
    // ⚑ The value is read off the COLOUR KEY, whose resolution has nothing to do
    // with the plot's pixel pitch. Rounding it through the axes would claim a
    // precision borrowed from the wrong instrument — while the coordinates,
    // which ARE pixel-derived, are rounded exactly as every other export is.
    const section = heatmapCellsSection([cell({ value: 42.123456789 })], makeRounder(axes(), 'auto'));
    expect(section.rows[0]![6]).toBe(42.123456789);
  });

  it('carries the CLIPPING flag, which no number in the row could imply', () => {
    // ⚑ A cell at the key's extreme is exact, uniform and possibly wrong — the
    // figure stopped containing the value. A file that dropped this would hand
    // on a confident number with its one caveat removed.
    const section = heatmapCellsSection([cell({ atKeyLimit: true })], makeRounder(axes(), 'auto'));
    expect(section.rows[0]![11]).toBe('yes');
    expect(JSON.parse(buildHeatmapJSON([cell({ atKeyLimit: true })])).cells[0].atKeyLimit).toBe(true);
  });

  it('renders through the ordinary table formats', () => {
    const csv = renderTable([heatmapCellsSection(GRID, makeRounder(axes(), 'auto'))], 'csv');
    expect(csv).toMatch(/x min,x max,y min,y max,x centre,y centre,value/);
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

describe('a NAMED axis — "the label is the coordinate"', () => {
  /** The same grid with gene names on x and one sample name on y — the shape a
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
    expect(section.header.slice(0, 3)).toEqual(['x label', 'y label', 'x min']);
    expect(section.rows[1]!.slice(0, 9)).toEqual(['TP53', 'tumour', 1, 4, 0, 2, 2.5, 1, 20]);
  });

  it('leaves a VALUE axis exactly as it was — no empty column appears', () => {
    // ⚑ The histogram's `value error` rule: a column exists only when something
    // fills it, so a value × value heatmap's file does not change shape because
    // a feature it does not use was added.
    expect(heatmapCellsSection(GRID, makeRounder(axes(), 'auto')).header[0]).toBe('x min');
    // …and an axis named on ONE side only grows that side's column alone.
    const xOnly = NAMED.map((c) => ({ ...c, yLabel: '' }));
    expect(heatmapCellsSection(xOnly, makeRounder(axes(), 'auto')).header.slice(0, 2)).toEqual(['x label', 'x min']);
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
    // ⚑ Positions AND tick labels, aligned index for index — matplotlib wants
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
      valueLow: 41,
      valueHigh: 44,
      colourOffset: 0,
      uniformity: 1,
      atKeyLimit: false,
    });
    expect(doc.matrix).toEqual({ x: [0.5, 2.5], y: [1, 2.5], values: [[10, 20], [30, 40]] });
  });

  it('uses null for an unread cell, which survives the round trip', () => {
    // ⚑ NaN would not: JSON rewrites it as null anyway, and `null * x === 0` is
    // how a laundered NaN once became a flat line at zero. Writing null on
    // purpose means the reader gets the same thing we meant.
    const doc = JSON.parse(buildHeatmapJSON([cell({ value: null, low: null, high: null, distance: null })])) as {
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
   * reached is this project's own recurring failure — a feature measured
   * against 882 figures in a harness while `Workspace.tsx` never called it.
   * These go through `buildExportSections`/`buildExportJson`, the two functions
   * the Export menu actually calls.
   */
  function heatmapSession(): CalibrationSession<XYAxes> {
    const s = new CalibrationSession(HEATMAP_AXES_CONFIG);
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
    // A heatmap with no cells read is not a heatmap with no data — and the file
    // has no way to say which, so it says what it has: nothing yet.
    const sections = buildExportSections(input([]));
    expect(sections[0]!.rows).toEqual([]);
    expect(JSON.parse(buildExportJson(input([]))).cells).toEqual([]);
  });
});
