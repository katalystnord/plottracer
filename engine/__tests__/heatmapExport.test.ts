import { describe, expect, it } from 'vitest';
import { heatmapCellsSection, heatmapKeySection, heatmapMatrixSection, heatmapMatrixAxesSection, buildHeatmapJSON, type HeatmapExportCell } from '../csvExport.js';
import { makeRounder } from '../../core/exportPrecision.js';
import { XYAxes } from '../../core/axes/xy.js';
import { Calibration } from '../../core/calibration.js';
import { renderTable } from '../tableFormats.js';
import { buildExportJson, buildExportSections } from '../exportAssembly.js';
import { CalibrationSession, HEATMAP_AXES_CONFIG } from '../calibrationSession.js';
import fs from 'node:fs';
import path from 'node:path';

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

/**
 * ⚑⚑ THE MATRIX'S COORDINATE VECTORS ARE **EDGES** (v2.3, A5).
 *
 * The long form is the record and the matrix is derived from it - but the matrix
 * is the block that matches A GENERATOR'S OWN INPUT SIGNATURE, and it was the
 * one carrying the coordinate form that generator rejects. `pcolormesh(X, Y, C)`
 * with `shading='flat'` **refuses centres**: it requires X of n+1 and Y of m+1.
 * matplotlib settled bounds-vs-centres by itself long before we asked
 * (CLAUDE.md, tenet 11(b)), so a header row of centres is not a smaller version
 * of that input - it is the input that gets refused.
 *
 * ⚑ THE SAMPLE'S OWN GENERATOR IS THE SPECIFICATION, and it is in this repo:
 * `pcolormesh(x_edges, y_edges, values, cmap="viridis", vmin=60, vmax=780)`
 * (see the B10 block below). Three arrays, and until now the export published
 * the third and left the first two to be re-derived from the long form by
 * whoever noticed they had to.
 *
 * ⚑ AND THE FOUNDING MEASUREMENT IS WHY THIS IS NOT TIDYING. Regenerating the
 * hardest figure from bounds came out at max difference **0.0**, while a
 * centres-only record was wrong by up to 0.375 data units - because centres
 * cannot recover UNEQUAL cells. `GRID` is unequal on both axes on purpose
 * (columns 1 and 3 wide, rows 2 and 1 high), so no arithmetic turns its centres
 * back into it.
 *
 * ⚑ NOTHING IS RE-MEASURED. Every edge is already in the long form as
 * `x min`/`x max`, so this is a pivot of a measurement we hold, not a reading.
 */
describe('the matrix publishes the cell BOUNDARIES its generator demands', () => {
  it('⚑⚑ x is n+1 EDGES, not n centres', () => {
    // Two columns, so three edges - and they are the measured dividers, not
    // centres and not a spacing we chose.
    expect(heatmapMatrixAxesSection(GRID).rows[0]).toEqual(['x', 0, 1, 4]);
  });

  it('⚑ y gets exactly the same treatment, because it is the same kind of axis', () => {
    // Pattern 1 from CLAUDE.md: if it belongs to an AXIS, every axis gets it. A
    // block whose x carried edges and whose y carried centres would be worse
    // than one wrong twice, because half of it would be believed.
    expect(heatmapMatrixAxesSection(GRID).rows[1]).toEqual(['y', 0, 2, 3]);
  });

  it('⚑⚑ UNEQUAL cells survive the round trip, which is the whole reason for edges', () => {
    // From these edges a consumer recovers columns 1 and 3 wide, rows 2 and 1
    // high. From the centres 0.5 / 2.5 and 1 / 2.5 it cannot: any spacing rule
    // it applies is an invention, and that invention was measured at up to 0.375
    // data units of error.
    const span = (row: readonly (string | number)[]) => {
      const e = row.slice(1) as number[];
      return e.slice(1).map((v, i) => v - e[i]!);
    };
    const section = heatmapMatrixAxesSection(GRID);
    expect(span(section.rows[0]!)).toEqual([1, 3]);
    expect(span(section.rows[1]!)).toEqual([2, 1]);
  });

  it('⚑ a NON-SQUARE grid is padded, so the block is never ragged', () => {
    // Two rows of different length in one section render as ragged CSV, and a
    // ragged block is one a spreadsheet reads wrong in silence. Padded with the
    // same empty string an unread cell uses.
    const wide = [
      ...GRID,
      cell({ col: 2, row: 0, xMin: 4, xMax: 5, yMin: 0, yMax: 2, xCentre: 4.5, yCentre: 1, value: 50 }),
      cell({ col: 2, row: 1, xMin: 4, xMax: 5, yMin: 2, yMax: 3, xCentre: 4.5, yCentre: 2.5, value: 60 }),
    ];
    const section = heatmapMatrixAxesSection(wide);
    expect(section.rows[0]).toEqual(['x', 0, 1, 4, 5]);
    expect(section.rows[1]).toEqual(['y', 0, 2, 3, '']);
    expect(section.header.length).toBe(section.rows[0]!.length);
    expect(section.rows[1]!.length).toBe(section.rows[0]!.length);
  });

  it('⚑ a GAP reports the boundaries it MEASURED rather than inventing contiguity', () => {
    // Tenet 9 at the pivot. A grid with a missing column has more than n+1
    // boundaries, and saying so is the honest answer: a consumer sees the hole
    // where we saw it, instead of us closing it to make the vector the length a
    // library would prefer.
    const gapped = [
      cell({ col: 0, row: 0, xMin: 0, xMax: 1, yMin: 0, yMax: 2, xCentre: 0.5, yCentre: 1, value: 10 }),
      cell({ col: 1, row: 0, xMin: 3, xMax: 4, yMin: 0, yMax: 2, xCentre: 3.5, yCentre: 1, value: 20 }),
    ];
    expect(heatmapMatrixAxesSection(gapped).rows[0]).toEqual(['x', 0, 1, 3, 4]);
  });

  it('⚑ an unread figure is an empty block, not a broken one', () => {
    expect(heatmapMatrixAxesSection([]).rows).toEqual([]);
  });

  it('⚑ it renders through the ordinary table formats like every other section', () => {
    const csv = renderTable([heatmapMatrixAxesSection(GRID)], 'csv');
    expect(csv).toContain('x,0,1,4');
    expect(csv).toContain('y,0,2,3');
  });

  it('⚑⚑ the JSON carries the edges BESIDE the centres, not instead of them', () => {
    // Same rule the labels already follow here: a vector rides ALONGSIDE rather
    // than replacing one, because the two serve different readers. `geom_tile`
    // takes centres plus a size and `pcolormesh` refuses them, so a document
    // that dropped either half would fail a real consumer - and a reader who
    // switches format meets the same words.
    const doc = JSON.parse(buildHeatmapJSON(GRID)) as {
      matrix: { x: number[]; xEdges: number[]; y: number[]; yEdges: number[]; values: (number | null)[][] };
    };
    expect(doc.matrix.xEdges).toEqual([0, 1, 4]);
    expect(doc.matrix.yEdges).toEqual([0, 2, 3]);
    expect(doc.matrix.x).toEqual([0.5, 2.5]);
    // ⚑ AND THE SHAPES AGREE, which is the assertion a generator actually makes:
    // C is m x n, X is n+1, Y is m+1. A file where those three disagree is
    // refused at the call, so it is checked here rather than discovered there.
    expect(doc.matrix.values.length).toBe(doc.matrix.yEdges.length - 1);
    expect(doc.matrix.values[0]!.length).toBe(doc.matrix.xEdges.length - 1);
  });
});

/**
 * ⚑⚑ THE REVERSE TEST, RUN AGAINST GROUND TRUTH RATHER THAN INVENTED GEOMETRY.
 *
 * Tenet 11 asks what a consumer needs in order to REGENERATE the figure, and for
 * a heatmap that answer was settled by measurement: regenerating the hardest
 * figure from bounds came out at max difference **0.0**, while a centres-only
 * record was wrong by up to 0.375 data units. This is that measurement re-run on
 * the block A5 added - do the edges we now publish reproduce the boundaries the
 * generator actually drew?
 *
 * ⚑ THE INSTRUMENT IS THE `.truth.json`, not a fixture. Every bundled heatmap
 * ships the grid its generator was given, so this compares our derivation with
 * an answer written down by something other than us. A test that builds its own
 * grid and then agrees with itself proves self-consistency and nothing else -
 * see the standing note on ground truth being the instrument.
 *
 * ⚑ AND THE WELD FIGURE IS THE ONE THAT MATTERS: unequal on BOTH axes (columns
 * 2, 3, 1, 3 and 5 wide; rows 1, 2.5, 0.5 and 2 high), which is precisely the
 * shape no centres-only vector can be turned back into.
 */
describe('the published edges reproduce the figure the generator drew', () => {
  const SAMPLES = path.join(import.meta.dirname, '..', '..', 'samples');

  /** One bundled heatmap's ground truth: the grid it was drawn from, and its cells. */
  function truth(name: string): {
    grid: { x: number[]; y: number[] };
    cells: HeatmapExportCell[];
  } {
    const raw = JSON.parse(fs.readFileSync(path.join(SAMPLES, `${name}.truth.json`), 'utf8')) as {
      grid: { x: number[]; y: number[] };
      cells: Array<{ xMin: number; xMax: number; yMin: number; yMax: number; xCentre: number; yCentre: number; value: number }>;
    };
    return {
      grid: raw.grid,
      cells: raw.cells.map((c, i) => ({ ...c, col: i, row: 0, uniformity: 1 })),
    };
  }

  /** The x and y vectors as the export writes them, numbers only. */
  function published(cells: HeatmapExportCell[]): { x: number[]; y: number[] } {
    const rows = heatmapMatrixAxesSection(cells).rows;
    const numbers = (row: readonly (string | number)[]): number[] =>
      row.slice(1).filter((v): v is number => typeof v === 'number');
    return { x: numbers(rows[0]!), y: numbers(rows[1]!) };
  }

  for (const name of ['heatmap-timecourse', 'heatmap-weld-temperature', 'heatmap-assay-log']) {
    it(`⚑⚑ ${name}: the edges ARE the grid, exactly`, () => {
      const { grid, cells } = truth(name);
      const got = published(cells);
      // Not "close to" - equal. The boundaries are the dividers the figure was
      // generated from, and a heatmap's wrong cell is silent by construction, so
      // an approximate match here is a defect nothing downstream would report.
      expect(got.x).toEqual(grid.x);
      expect(got.y).toEqual(grid.y);
    });

    it(`⚑ ${name}: n+1 and m+1, so the value array's own shape checks out`, () => {
      // The assertion a generator makes at the call: C is m x n, X is n+1, Y is
      // m+1. Checked here rather than discovered as a refusal in someone's script.
      const { cells } = truth(name);
      const got = published(cells);
      expect(cells).toHaveLength((got.x.length - 1) * (got.y.length - 1));
    });
  }

  it('⚑ and the centres alone could NOT have reproduced the weld figure', () => {
    // The other half of the founding measurement, stated as a test rather than
    // as a claim in a comment: the weld grid is unequal, so no single spacing
    // rule applied to its centres regenerates it. If this ever passes with equal
    // widths, the fixture has stopped being able to see the defect.
    const { grid } = truth('heatmap-weld-temperature');
    const widths = grid.x.slice(1).map((e, i) => e - grid.x[i]!);
    const heights = grid.y.slice(1).map((e, i) => e - grid.y[i]!);
    expect(new Set(widths).size).toBeGreaterThan(1);
    expect(new Set(heights).size).toBeGreaterThan(1);
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
      matrix: { x: number[]; xEdges: number[]; y: number[]; yEdges: number[]; values: (number | null)[][] };
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
    // ⚑ Centres AND edges, because two live library conventions want different
    // ones - see `heatmapMatrixAxesSection`. An exhaustive `toEqual` on purpose:
    // this is the document a consumer parses, so a key appearing or vanishing
    // unnoticed is exactly the failure to catch here.
    expect(doc.matrix).toEqual({
      x: [0.5, 2.5],
      xEdges: [0, 1, 4],
      y: [1, 2.5],
      yEdges: [0, 2, 3],
      values: [[10, 20], [30, 40]],
    });
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
    expect(doc.matrix).toEqual({ x: [], xEdges: [], y: [], yEdges: [], values: [] });
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

  it('builds the record, then the boundaries, then the matrix, in that order', () => {
    // ⚑ The RECORD first and the convenience view second: a reader opening the
    // file meets the long form - bounds, centre, value and the evidence for it -
    // before anything derived from it. The boundaries sit between them because
    // they are the derived block's coordinate vectors.
    const sections = buildExportSections(input(GRID));
    expect(sections.map((sec) => sec.title).slice(0, 3)).toEqual([
      'Cells',
      'Matrix axes (cell boundaries)',
      'Matrix (value per cell)',
    ]);
    expect(sections[0]!.rows).toHaveLength(4);
  });

  it('⚑⚑ puts the matrix AXES beside the matrix they bound (A5)', () => {
    // A section nothing pushes is a section nobody reads - this file's own
    // standing lesson. The boundaries sit with the values they bound, so the
    // three arrays a generator eats (X, Y, C) are adjacent in the document
    // rather than one of them being left to re-derive from the long form.
    const titles = buildExportSections(input(GRID)).map((sec) => sec.title);
    const axesAt = titles.indexOf('Matrix axes (cell boundaries)');
    expect(axesAt).toBeGreaterThan(-1);
    expect(titles[axesAt + 1]).toBe('Matrix (value per cell)');
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
