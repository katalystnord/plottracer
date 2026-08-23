/**
 * CSV export (checkpoint 25, see CLAUDE.md), alongside project save/load in
 * engine/projectFile.ts -- the second, complementary way to get data out of
 * the app: a project file round-trips back into ui/, CSV is for taking the
 * extracted numbers into a spreadsheet or another tool instead.
 *
 * Two shapes, matching the two ways Workspace.tsx already renders its
 * points table (see calibrationSession.ts's TupleRow/DataPointView):
 * buildFlatDataCSV for an ungrouped dataset (one row per point), and
 * buildTupleDataCSV for a Point Groups / Box Plot dataset (one row per
 * category/tuple, one column per group).
 *
 * Column naming is a deliberate simplification, not an oversight: axis
 * labels (e.g. "Strain (%)") aren't tracked anywhere in ui/ yet (a
 * structured export schema is future work), so
 * buildFlatDataCSV names value columns generically (`value` for a 1-D
 * dataset like Bar, `value1`/`value2`/... otherwise) rather than guessing
 * at per-axes-type semantic names.
 */

import type { PointRole, TupleRow } from './calibrationSession.js';
import type { HistogramBin } from '../algorithms/histogram.js';
import type { GeometryResult } from '../algorithms/geometry.js';
import type { ErrorRelation } from './errorRelation.js';
import { type ExportValue } from '../core/exportValues.js';
import type { ValueRounder } from '../core/exportPrecision.js';
import { renderTable, type Cell, type TableSection } from './tableFormats.js';

/**
 * One heatmap cell as the export sees it (v2.2) - structural, so this module
 * stays independent of `engine/heatmapRun.ts` and its image-reading half.
 * `engine/heatmapRun.ts`'s `HeatmapRow` satisfies it.
 */
/**
 * The COLOUR KEY's own extent - the third axis's span.
 *
 * ⚑⚑ David asked whether the weld sample could be regenerated from what we
 * save. The data: yes - `x_edges` and `y_edges` fall out of the cell bounds and
 * the matrix IS the value array, unequal cells included. But the generator also
 * took `vmin=60, vmax=780`, and we exported readings on the colour axis while
 * never exporting the axis itself. A consumer redrawing falls back to the
 * values' own min and max and gets different colours, with nothing saying why.
 *
 * ⚑ x and y have carried their extent all along, because every cell writes its
 * bounds. This is the same fact for the third axis - the last place it was
 * being treated as less than an axis.
 *
 * ⚑ The COLORMAP is deliberately absent: we measure the ramp rather than
 * guessing which published map it is, and a name we inferred would be the one
 * part of the file nobody could check.
 */
export interface HeatmapKeyExport {
  /** The value at each end of the strip, in click order - a key may run
   * high-to-low, and plenty do. */
  from: number;
  to: number;
  log: boolean;
}

export interface HeatmapExportCell {
  /** ⚑⚑ WHICH CELL THIS IS, 0-based, written to the file as `C1`/`R1`.
   *
   * ⚠️ IT WAS NOT HERE AT ALL. `HeatmapRow` has carried `col`/`row` all along
   * and this type dropped them - so the identity was discarded exactly at the
   * boundary to the file, and a value × value heatmap exported bounds with no
   * way to say which cell was which. The v2.2 export audit found this was the
   * only type missing identity. */
  col: number;
  row: number;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  xCentre: number;
  yCentre: number;
  /** Null for a cell that could not be read - written as empty, never 0. */
  value: number | null;
  /**
   * What fraction of the cell's sampled pixels were the colour we read.
   *
   * ⚑ `value low`, `value high`, `colour offset` and `at key limit` used to ride
   * here too. They were the old error model's output - how uncertain our
   * inversion of the colour was - and no other axis in this product exports
   * anything of the sort. Reading a colour is a lookup against the calibrated
   * range now: it is on the range or it is not, so there is no band to carry.
   *
   * This one stays because it is not about the axis: WE chose where to sample
   * inside the cell, so how much of the cell actually held that colour is a fact
   * a consumer needs and cannot re-derive from the image alone.
   */
  uniformity: number;
  /**
   * WHICH INSTRUMENT read this value (v2.2, B16).
   *
   * ⚑⚑ All three are MEASUREMENTS, and they fail in opposite ways: OCR reads ink
   * as GLYPHS and fails discretely (right, or badly wrong); the colour reads it
   * as a RAMP and fails continuously (small, silent); a person reads by eye and
   * sees what both machines are blind to - a hatched cell, an asterisk over the
   * fill, a texture the sampler averages away. A consumer treating an OCR'd 59
   * and a colour-inverted 58.7 as the same kind of number is wrong about both,
   * which is why this is a property of the VALUE and not a footnote.
   *
   * ⚑ NOT declared-versus-measured. Nothing here is invented; the record says
   * which instrument, not whether to believe it.
   *
   * Absent means `colour`, which is how every cell was read before there was a
   * second instrument.
   */
  source?: 'colour' | 'user' | 'ocr';
  /** What the figure PRINTS on each axis for this cell, where it prints a name
   * rather than a number (v2.2). Empty on a value axis. */
  xLabel?: string;
  yLabel?: string;
  /**
   * Is this cell's x / y coordinate an ORDINAL rather than a measurement?
   *
   * ⚑⚑ A category axis's bounds are 0,1,2… - counted positions, not lengths -
   * and they look exactly like a value axis's would. Without saying so the file
   * hands a reader `x_min 3, x_max 4` for "the fourth gene" and invites them to
   * treat it as a distance. The record says which it is; it does not drop the
   * numbers, because the ordinal IS the position the figure drew.
   */
  xIsCategory?: boolean;
  yIsCategory?: boolean;
}

/** Does any cell carry a name on this axis? Decides whether the export grows a
 * label column at all - the same rule the histogram's `value error` column
 * follows, so a value x value heatmap's file stays exactly what it was. */
function hasLabels(cells: readonly HeatmapExportCell[], axis: 'x' | 'y'): boolean {
  return cells.some((c) => (axis === 'x' ? c.xLabel : c.yLabel));
}

// The type-specific exports (box plot / histogram / error bars) don't flow through
// valueAtPixel, so they take a ValueRounder built from the axes + precision mode
// (core/exportPrecision.ts) and round each value to the figure's own resolution --
// same principled rule as the standard series export. A missing optional value
// stays a blank cell (never a fabricated 0).
/** Round an optional number via `rounder.scalarAt`, or a blank cell when missing. */
function ropt(rounder: ValueRounder, v: number | undefined, coords: number[], dim: number): number | string {
  return v != null ? rounder.scalarAt(v, coords, dim) : '';
}

/** A field delimiter (checkpoint 61): CSV uses a comma, TSV a tab. */
export type Delimiter = ',' | '\t';

/** CSV/TSV builders render a single untitled section (v0.8): the section
 * functions below are the one source of truth for a chart type's columns, and
 * LaTeX/MATLAB/Python reuse them via engine/tableFormats.ts. `renderTable` of a
 * lone untitled section is byte-identical to the old `toDelimited(header+body)`,
 * so existing CSV/TSV output is unchanged. */
function delimitedFormat(sep: Delimiter): 'csv' | 'tsv' {
  return sep === '\t' ? 'tsv' : 'csv';
}

/** One export row: its pixel, plus the contract's values (checkpoint 76). */
export interface ExportRow {
  px: number;
  py: number;
  values: ExportValue[];
  /** For an interpolation-assist series only: whether the user ASSIGNED this
   * point (`anchor`) or the spline DERIVED it (`interpolated`). Undefined for an
   * ordinary placed/traced point - the distinction doesn't apply to it (v1.3). */
  role?: PointRole;
  /**
   * Which COLUMNS of this row the user supplied rather than reading off the
   * pixel (A4) - indices into `values`, translated from data dimensions by the
   * session, which is the only place that knows a type's column order.
   *
   * ⚑⚑ THE MACHINE-READABLE HALF OF THE `[BRACKETS]`. The table's mark is text
   * so it survives a paste into a spreadsheet; this is the half a program can
   * read, and they say the same thing: WHICH INSTRUMENT took each reading. A
   * user's own reading is a measurement with a better instrument - their eye -
   * not an invented number, which is why it rides beside the value instead of
   * disqualifying it.
   */
  supplied?: readonly number[];
}

/**
 * A series' own error columns and their per-row readings - B4's per-datum
 * extents, where a cap lives on the datum's record instead of in a series of
 * its own.
 *
 * ⚑ ABSOLUTES AND DELTAS BOTH, for the reason `SeriesForCSV.deltas` states one
 * level down: ggplot's `geom_errorbar` takes ymin/ymax, matplotlib's `errorbar`
 * takes yerr, and neither will do the other's arithmetic. The absolutes are the
 * record (a delta cannot tell "no bound" from "a bound of size zero"); the
 * deltas are the projection.
 *
 * ⚑ `labels` carries only the roles that were MEASURED - presence is the
 * signal, the same rule `role` and `delta` follow here. Absent for a series
 * with no error, which then exports byte-for-byte as it did before.
 */
export interface SeriesErrorColumns {
  /** One per measured role, under the user's own word: 'SD upper'. */
  labels: readonly string[];
  /** Per row, one absolute per label. `null` where that side was never read. */
  values: readonly (readonly (number | null)[])[];
  /** The same rows as signed offsets from the datum. */
  deltas: readonly (readonly (number | null)[])[];
}

/** Does any row of this series carry a role? Drives whether the `role` column
 * exists at all: a series with no interpolation exports exactly as it did
 * before, so the column's PRESENCE is itself the signal that some of these
 * points were not placed by hand. */
function hasRoles(rows: readonly ExportRow[]): boolean {
  return rows.some((r) => r.role != null);
}

/**
 * Which FIELDS any row of this series carries a supplied value in, in column
 * order (A4).
 *
 * ⚑ Same presence-is-the-signal rule as `role` above: a session where every
 * number came off the pixels grows no source column at all, and exports
 * byte-for-byte as it did before this existed. A column of "pixel" repeated
 * down a file nobody typed into asserts a distinction nobody made.
 */
function suppliedFields(rows: readonly ExportRow[]): number[] {
  const fields = new Set<number>();
  for (const r of rows) for (const f of r.supplied ?? []) fields.add(f);
  return [...fields].sort((a, b) => a - b);
}

/** The word for one cell's instrument. `user` where a person supplied the
 * number, `pixel` where we read it off the image - said in full on every row of
 * a column that exists at all, so no reader has to guess what a blank means. */
function sourceWord(row: ExportRow | undefined, field: number): 'user' | 'pixel' {
  return row?.supplied?.includes(field) ? 'user' : 'pixel';
}

/** One row per point: pixel coordinates plus the axes' own columns.
 *
 * Headers come from the axes (`session.getExportFields()`), not from a
 * generated `value`/`value1`/`value2` list - the old generic names were a
 * documented simplification ("axis labels aren't tracked anywhere in ui/ yet")
 * that was false: `getAxesLabels()` has always been there and had zero callers.
 * A Bar chart's first column is now its Label, and a CCR's first column is a
 * time rather than a julian float. See core/exportValues.ts.
 *
 * A null value (not measured) exports a blank cell rather than a zero.
 *
 * A trailing `role` column appears only when the series actually carries roles
 * (an interpolation-assist trace), and an ordinary point inside such a series
 * leaves it blank - we state the fact the record holds and invent nothing for
 * the points it doesn't apply to. */
export function flatDataSection(
  rows: readonly ExportRow[],
  fields: readonly string[],
  /** The datum's own extents, when this series carries any (B4). Row-aligned
   * with `rows`, which are one per DATUM - a cap is not a point. */
  error?: SeriesErrorColumns
): TableSection {
  const roles = hasRoles(rows);
  const err = error?.labels.length ? error : null;
  // ⚑ Beside the values they qualify, before the error columns: a source column
  // is a statement about ITS OWN column, and the two read together.
  const sources = suppliedFields(rows);
  return {
    header: [
      'x_px',
      'y_px',
      ...fields,
      ...sources.map((f) => `${fields[f] ?? f} source`),
      ...(err ? err.labels : []),
      ...(err ? err.labels.map((l) => `${l} delta`) : []),
      ...(roles ? ['role'] : []),
    ],
    rows: rows.map((r, i) => [
      r.px,
      r.py,
      ...fields.map((_f, d) => r.values[d] ?? ''),
      ...sources.map((f) => sourceWord(r, f)),
      // ⚑ Blank, never 0, where a side was never captured. A one-sided error
      // bar is a real figure, and matplotlib ACCEPTS a yerr of 0 and draws a
      // bound sitting exactly on the value - a measurement nobody took, wearing
      // the record's clothes.
      ...(err ? err.labels.map((_l, c) => err.values[i]?.[c] ?? '') : []),
      ...(err ? err.labels.map((_l, c) => err.deltas[i]?.[c] ?? '') : []),
      ...(roles ? [r.role ?? ''] : []),
    ]),
  };
}
export function buildFlatDataCSV(rows: readonly ExportRow[], fields: readonly string[], sep: Delimiter = ','): string {
  return renderTable([flatDataSection(rows, fields)], delimitedFormat(sep));
}

/** One row per tuple/category: its label plus one column per slot,
 * in group order, plus (v2.0) a trailing DERIVED column when the type
 * declares one (`AxesTypeConfig.derivedTupleValue`). An unfilled slot
 * (still-open tuple) exports as a blank cell, matching the points table's
 * own "-" placeholder in spirit. Only a group's first data value is
 * exported (dataDim is always 1 for the Bar axes Box Plot uses this for --
 * see calibrationSession.ts's getBoxPlotGlyphs, the only place slots are
 * offered today).
 *
 * ⚑ `derivedLabel` is what makes this column exist at all -- same
 * presence-is-the-signal rule as `role` above. Before this, a type's own
 * computed tuple value (e.g. a pie sector's proportion, `TupleRow.derived`)
 * reached the on-screen table (Workspace.tsx) but never an export: a reader
 * got the two raw boundary angles and had to recompute the number they
 * actually wanted. Required groundwork for v2.0's bar interval, whose
 * exported "value" is a derived extent, not either of its two stored ends --
 * and a genuine bug fix for Pie today, not just future-proofing.
 *
 * ⚑ `row.derived` is emitted AS-IS, never re-rounded through `rounder` the
 * way the raw per-slot columns are. `AxesTypeConfig.derivedTupleValue.compute`
 * already rounds to that TYPE's own appropriate precision (pie's, to what one
 * pixel at the rim can resolve -- see PIE_AXES_CONFIG's own comment) using
 * whatever geometry it actually has; re-rounding here via `resolutionAtData`
 * would need `axes.dataToPixel` to place the derived value back on a pixel,
 * which is a stub for every non-invertible axes (pie included) and would
 * silently compute a resolution near image origin (0,0) instead of near the
 * sector -- caught by a test that expected the exact analytic value and got a
 * suspiciously round-looking one instead. */
/**
 * One tuple's member values, under the names the RECORD calls them by.
 *
 * ⚑⚑ SORTED WHEN THE SLOTS ARE AN INTERVAL (v2.3). A bar's two slots fill in
 * click order, and the record has discarded that order since 2026-08-03 - so
 * `Min` and `Max` must actually hold the smaller and larger reading, or the
 * rename is a label over an unchanged column and two people capturing the same
 * bar still get two different files. One helper, so the CSV family and the JSON
 * cannot answer differently.
 */
function memberValues(
  row: TupleRow,
  count: number,
  rounder: ValueRounder,
  sortedInterval: boolean
): (number | null)[] {
  const values = row.points
    .slice(0, count)
    .map((p) => (p?.data ? rounder.at([p.data[0]!], 0) : null));
  // ⚑ Only a COMPLETE pair is sorted: a half-dragged bar has one reading and no
  // interval, and moving it into the `Min` column would assert which end of a
  // bar nobody has finished drawing it is.
  if (sortedInterval && values.length === 2 && values[0] != null && values[1] != null) {
    return [Math.min(values[0], values[1]), Math.max(values[0], values[1])];
  }
  return values;
}

export function tupleDataSection(
  pointGroupNames: readonly string[],
  tupleRows: readonly TupleRow[],
  rounder: ValueRounder,
  derivedLabel?: string,
  /** The type's own extents, when this series carries any (B4) - appended after
   * the DERIVED value, because that is the number they qualify. */
  error?: SeriesErrorColumns,
  /** The record's own names for slots that are an unordered INTERVAL - see
   * `AxesTypeConfig.intervalSlots`. Given, these REPLACE `pointGroupNames` in
   * the header and the pair is written smallest first. */
  intervalSlots?: readonly [string, string]
): TableSection {
  // Box Plot's axes is Bar (dataDim 1): each group's single value is dimension 0.
  const hasDerived = derivedLabel != null && tupleRows.some((r) => r.derived != null);
  const err = error?.labels.length ? error : null;
  // ⚑⚑ F21 - THE CATEGORY COORDINATE, and the bar's extent along it. `category`
  // alone is the NAME, which is empty unless someone transcribed the tick labels
  // (autoLabelTuple's documented default), so a bar chart captured the ordinary
  // way exported no category at all while `bandIndexAt` had measured one. The
  // column order mirrors the heatmap's cells: identity, then the name, then the
  // bounds, then the values.
  // ⚑ Presence is the signal, as for `role` and the error columns above: no
  // column where nothing was measured, so a session with no marked axis and no
  // typed name exports exactly what it did before.
  const hasPosition = tupleRows.some((r) => r.position != null);
  const hasSpan = tupleRows.some((r) => r.positionSpan != null);
  // ⚑⚑ A2 - THREE FRAMES, THREE HONEST NAMES. `Position` is claimed when the
  // coordinate is one: the axis was marked, or it was measured off the bars
  // themselves. `Position (in series)` is Line's own wording for a rank that is
  // real but NOT shared - several series unmarked, where a grouped chart's
  // side-by-side bars and two adjacent categories are the same ink. `Category
  // index` survives for the case where nothing framed it at all.
  const frame = tupleRows.find((r) => r.position != null)?.positionFrame ?? 'index';
  const positionLabel =
    frame === 'in-series' ? 'Position (in series)' : frame === 'index' ? 'Category index' : 'Position';
  return {
    header: [
      ...(hasPosition ? [positionLabel] : []),
      'category',
      ...(hasSpan ? ['Position min', 'Position max'] : []),
      ...(intervalSlots ?? pointGroupNames),
      ...(hasDerived ? [derivedLabel] : []),
      ...(err ? err.labels : []),
      ...(err ? err.labels.map((l) => `${l} delta`) : []),
    ],
    rows: tupleRows.map((row, i) => [
      // Blank, never 0, where no category coordinate was measured - the same
      // rule the error columns follow, and 0 is a category index a file may
      // really carry.
      ...(hasPosition ? [row.position ?? ''] : []),
      row.label,
      ...(hasSpan ? [row.positionSpan?.[0] ?? '', row.positionSpan?.[1] ?? ''] : []),
      // ⚑⚑ THE TYPE'S OWN MEMBERS ONLY. A row carries every tuple slot, and once
      // a series gains error that includes the four cap slots - while the header
      // is the type's own names. Mapping the whole row put four values under no
      // heading and shifted the derived column off its own name: three header
      // cells against seven row cells, every number under the wrong word, which
      // is worse than dropping them. Sliced HERE rather than upstream because
      // `TupleRow` is also what the on-screen table reads, where the members are
      // wanted.
      ...memberValues(row, pointGroupNames.length, rounder, intervalSlots !== undefined).map(
        (v) => v ?? ''
      ),
      ...(hasDerived ? [row.derived ?? ''] : []),
      // Blank, never 0, where a side was never captured - see flatDataSection.
      ...(err ? err.labels.map((_l, c) => err.values[i]?.[c] ?? '') : []),
      ...(err ? err.labels.map((_l, c) => err.deltas[i]?.[c] ?? '') : []),
    ]),
  };
}
export function buildTupleDataCSV(
  pointGroupNames: readonly string[],
  tupleRows: readonly TupleRow[],
  rounder: ValueRounder,
  sep: Delimiter = ',',
  derivedLabel?: string
): string {
  return renderTable([tupleDataSection(pointGroupNames, tupleRows, rounder, derivedLabel)], delimitedFormat(sep));
}

/** One row per histogram bin: its interval and magnitude (checkpoint 66).
 *
 * Bins get their own shape rather than riding buildTupleDataCSV, which
 * exports one raw column per group and only each group's *first* value --
 * fine for Box Plot (Bar axes, dataDim 1), but for a bin that would emit the
 * two corners' x and silently drop the height that lives in their y. What a
 * consumer wants from a histogram is the interval and its value, not the two
 * clicks that produced them, so the derived form is the honest export.
 *
 * A bin whose second corner isn't placed yet is skipped -- half a bin has no
 * meaningful interval, and exporting a blank edge would read as a real zero.
 * `valueErr` is emitted only when some bin actually carries one, so today's
 * files stay three columns wide (see algorithms/histogram.ts on why the field
 * exists before anything writes it). */
export function histogramSection(
  bins: readonly (HistogramBin | null)[],
  rounder: ValueRounder,
  /** ⚑⚑ THE CAPS SOMEONE PLACED ON THESE BINS (F27). The error tool is offered
   * on every type that has points - histogram included - and the whiskers are
   * drawn on the canvas, but the bins table, this section and the JSON all
   * reported the interval and the magnitude alone, so a Poisson √N bar a user
   * had measured reached no file at all. Row-aligned with `bins` by tuple
   * index, which is why the nulls are carried through the map rather than
   * filtered away first. */
  error?: SeriesErrorColumns
): TableSection {
  const complete = bins.flatMap((b, i) => (b === null ? [] : [[b, i] as const]));
  const hasErr = complete.some(([b]) => b.valueErr !== undefined);
  const err = error?.labels.length ? error : null;
  // Histogram axes is XY: bin edges are X (dim 0), the magnitude is Y (dim 1).
  // Each edge's X-resolution is read at that edge (with the bin's value as the
  // reference Y, which only matters on a rotated calibration).
  return {
    header: [
      'bin start',
      'bin end',
      'value',
      ...(hasErr ? ['value error'] : []),
      ...(err ? err.labels : []),
      ...(err ? err.labels.map((l) => `${l} delta`) : []),
    ],
    rows: complete.map(([b, i]) => [
      rounder.at([b.binStart, b.value], 0),
      rounder.at([b.binEnd, b.value], 0),
      rounder.at([b.binStart, b.value], 1),
      ...(hasErr ? [ropt(rounder, b.valueErr, [b.binStart, b.value], 1)] : []),
      // Blank, never 0, where a side was never captured - see flatDataSection.
      ...(err ? err.labels.map((_l, c) => err.values[i]?.[c] ?? '') : []),
      ...(err ? err.labels.map((_l, c) => err.deltas[i]?.[c] ?? '') : []),
    ]),
  };
}
/**
 * A heatmap's cells, LONG FORM - one row per cell (v2.2).
 *
 * ⚑⚑ BOUNDS AND CENTRE, BOTH. The asymmetry decided it before any code was
 * written: edges → centres is derivable and centres → edges is NOT once cells
 * are unequal, and a real consumer needs each convention - matplotlib's
 * `shading='flat'` REQUIRES n+1 edges and refuses centres, while
 * `shading='nearest'` takes centres. A record carrying one of them fails
 * against the other, so it carries both and neither reader does arithmetic on
 * the record. Rebuilding the hardest test figure from this shape came back
 * exact; from centres alone it was wrong by 0.375 data units.
 *
 * ⚑⚑ AND THE EVIDENCE RIDES WITH THE VALUE, in the same row. In a heatmap the
 * colour IS the value, so a wrong cell has no other symptom - the interval it
 * could not be told apart from, how far its colour sat off the key, and how
 * much of the cell was actually that colour are the only things that say
 * whether to trust the number. A file that dropped them would hand on 20
 * confident numbers, which is precisely the failure this whole feature is built
 * to prevent. Same precedent as the error-bar Δ, which rides into the file
 * beside the point it belongs to.
 *
 * ⚑ An unread cell writes EMPTY, never 0 - `0` is a value a heatmap might
 * really contain.
 */
/** "x (category index)" where the axis is counted, "x min" where it is
 * measured - the header carries the distinction rather than a footnote. */
function axisHeader(cells: readonly HeatmapExportCell[], axis: 'x' | 'y', suffix: string): string {
  const category = cells.some((c) => (axis === 'x' ? c.xIsCategory : c.yIsCategory));
  return category ? `${axis} ${suffix} (category index)` : `${axis} ${suffix}`;
}

export function heatmapCellsSection(
  cells: readonly HeatmapExportCell[],
  rounder: ValueRounder
): TableSection {
  const at = (v: number | null, cell: HeatmapExportCell, dim: 0 | 1): Cell =>
    v === null ? '' : rounder.at([dim === 0 ? v : cell.xCentre, dim === 0 ? cell.yCentre : v], dim);
  const xNamed = hasLabels(cells, 'x');
  const yNamed = hasLabels(cells, 'y');
  return {
    title: 'Cells',
    header: [
      // ⚑⚑ THE NAME COMES FIRST AND THE BOUNDS STAY. On a category axis the
      // label IS the coordinate - a gene name, a treatment, a confusion-matrix
      // class - and a file that exported `1, 2, 3` for it cannot be rejoined to
      // anything the reader has. But the bounds are MEASURED off the pixels and
      // remain true whatever the axis is called, so the name is added beside
      // them rather than in place of them (tenet 9: record, do not choose for
      // the reader).
      // ⚑⚑ IDENTITY, UNCONDITIONALLY - David, 2026-08-16: *"Whatever is needed
      // for a data set to be able to be used to create the same heatmap needs to
      // be recorded by us. Even if something like axis identifier C1/R1 needs to
      // be DERIVED. Whatever we export (for all types of graphs) needs to be
      // usable as a basis for reconstructing the same graph."*
      //
      // ⚠️ The label columns below appear only when the axes are NAMED, so a
      // value × value heatmap exported no identity at all: a reader got bounds
      // and had to reconstruct which cell was which. The v2.2 audit's export
      // pass found this was the ONLY type missing it - bar leads with
      // `category`, spider carries `Axis`, and the flat types export their
      // coordinates.
      //
      // ⚑ IT IS DERIVED, AND THAT IS FINE HERE. Inside the model a derived value
      // stored twice DRIFTS, which is why a cell's colour is computed and never
      // kept. In a FILE the consumer has no access to our derivation, so
      // omitting it makes the data unusable. Opposite failure modes, opposite
      // defaults, and the export is the boundary between them.
      'column',
      'row',
      ...(xNamed ? ['x label'] : []),
      ...(yNamed ? ['y label'] : []),
      axisHeader(cells, 'x', 'min'),
      axisHeader(cells, 'x', 'max'),
      axisHeader(cells, 'y', 'min'),
      axisHeader(cells, 'y', 'max'),
      axisHeader(cells, 'x', 'centre'),
      axisHeader(cells, 'y', 'centre'),
      // ⚑⚑ THE DELTA HALF, which was missing. The error-bar precedent
      // (`39f2d81`) is to carry the absolutes AND the delta "so neither reader
      // does arithmetic on the record" - cells got the absolutes and the centre
      // and stopped there. It is not pedantry: `bar(x, height, WIDTH)` takes a
      // width directly while `pcolormesh` takes edges, so one of the two real
      // consumer conventions had to compute its own input.
      // ⚑ AREA stays derived. Colour is the value and the bounds say where it
      // applies, so an area column would be a second copy of a multiplication.
      // Area becomes a MEASURED quantity only for a mosaic, where the geometry
      // IS the value.
      axisHeader(cells, 'x', 'width'),
      axisHeader(cells, 'y', 'height'),
      'value',
      // ⚑ UNCONDITIONAL, unlike the label columns above. A missing `x label`
      // column says plainly that nothing is named; a missing source column would
      // say nothing at all and leave a reader assuming a default nobody told
      // them. Evidence columns are always written here.
      'value source',
      'uniformity',
    ],
    rows: cells.map((c) => [
      // ⚑ 1-BASED, matching every place these appear on screen - the matrix
      // headers, the picked-cell line and the long table all say `C1`, so the
      // file saying `0` would be a fourth spelling of one thing.
      `C${c.col + 1}`,
      `R${c.row + 1}`,
      ...(xNamed ? [c.xLabel ?? ''] : []),
      ...(yNamed ? [c.yLabel ?? ''] : []),
      at(c.xMin, c, 0),
      at(c.xMax, c, 0),
      at(c.yMin, c, 1),
      at(c.yMax, c, 1),
      at(c.xCentre, c, 0),
      at(c.yCentre, c, 1),
      // ⚑ A WIDTH is a difference, not a position, so it is rounded through the
      // axis's own resolution the same way the bounds are - `at` takes the pair
      // it belongs to, which keeps a log axis honest about what its resolution
      // means at that coordinate.
      at(c.xMax - c.xMin, c, 0),
      at(c.yMax - c.yMin, c, 1),
      // ⚑ The VALUE is not an x or a y - it is read off the colour key, whose
      // resolution has nothing to do with the figure's pixel pitch. Rounding it
      // through the axes' own resolution would claim a precision from the wrong
      // instrument, so it is written as measured.
      c.value === null ? '' : c.value,
      c.source ?? 'colour',
      c.uniformity,
    ]),
  };
}

/**
 * The colour key's extent, as its own small section.
 *
 * ⚑ A SECTION rather than extra columns on every cell: the key's span is a fact
 * about the FIGURE, not about any one cell, and repeating it 20 times would
 * invite the copies disagreeing.
 */
export function heatmapKeySection(key: HeatmapKeyExport): TableSection {
  return {
    title: 'Colour key',
    header: ['key from', 'key to', 'log'],
    rows: [[key.from, key.to, key.log ? 'yes' : '']],
  };
}

/**
 * The same cells as a MATRIX - the convenience view, and the shape the wide /
 * array-style consumers take (matplotlib, plotly, seaborn, R's `image`).
 *
 * ⚑ DERIVED, never the record. It is the long form pivoted, exactly as the
 * error-bar Δ is derived from the two points it spans: written out so nobody
 * has to pivot it by hand, and reconstructible from the section above if it
 * ever disagreed. An unread cell is empty here too.
 */
export function heatmapMatrixSection(cells: readonly HeatmapExportCell[]): TableSection {
  const xs = [...new Set(cells.map((c) => c.xCentre))].sort((a, b) => a - b);
  const ys = [...new Set(cells.map((c) => c.yCentre))].sort((a, b) => a - b);
  const byKey = new Map(cells.map((c) => [`${c.xCentre},${c.yCentre}`, c]));
  // ⚑ THE HEADERS TAKE THE NAME WHERE THERE IS ONE. The matrix has exactly one
  // slot per coordinate, so unlike the long form it cannot carry both - and a
  // named axis whose header row reads `1, 2, 3` is the shape that made this
  // whole feature necessary. A cell with no name keeps its centre, so a
  // half-named axis stays addressable rather than going blank.
  const head = (coord: number, axis: 'x' | 'y'): string | number => {
    const cell = cells.find((c) => (axis === 'x' ? c.xCentre : c.yCentre) === coord);
    const label = axis === 'x' ? cell?.xLabel : cell?.yLabel;
    return label !== undefined && label !== '' ? label : coord;
  };
  return {
    title: 'Matrix (value per cell)',
    header: ['y \\ x', ...xs.map((x) => head(x, 'x'))],
    rows: ys.map((y) => [
      head(y, 'y'),
      ...xs.map((x) => {
        const cell = byKey.get(`${x},${y}`);
        return cell?.value ?? '';
      }),
    ]),
  };
}

/**
 * One axis's cell boundaries, ascending, deduplicated.
 *
 * ⚑ ONE DERIVATION for the table section and the JSON both. Two copies of an
 * arithmetic this small look harmless and are exactly how F22 happened - three
 * JSON builders each writing out one object literal by hand, and the fourth
 * format quietly missing a field for a release. A consumer that compared the
 * CSV's edges with the JSON's and found them different would have no way to
 * decide which to trust.
 *
 * ⚑ The dedupe is what makes a shared boundary ONE edge: adjacent cells report
 * the same divider as one's `xMax` and the next one's `xMin`, so n contiguous
 * cells collapse to n+1 edges. Where they do NOT coincide the count is higher,
 * and that is the honest answer rather than a defect - see the section below.
 */
function edgesOf(cells: readonly HeatmapExportCell[], axis: 'x' | 'y'): number[] {
  const pick = (c: HeatmapExportCell): [number, number] =>
    axis === 'x' ? [c.xMin, c.xMax] : [c.yMin, c.yMax];
  return [...new Set(cells.flatMap(pick))].sort((a, b) => a - b);
}

/**
 * The matrix's COORDINATE VECTORS - the cell boundaries, n+1 of them per axis.
 *
 * ⚑⚑ WHY THIS IS NOT THE CENTRES IN `heatmapMatrixSection`'s HEADER. The matrix
 * is the block that matches a generator's own input signature, so it is the one
 * block where the coordinate FORM has to be the form that generator accepts -
 * and `pcolormesh(X, Y, C)` with `shading='flat'` REFUSES centres: it requires X
 * of n+1 and Y of m+1. matplotlib settled bounds-vs-centres by itself long
 * before we asked (tenet 11(b)), which is the same fact `shading='flat'` states
 * on the workflow side as *"you must say where the boundaries are"*.
 *
 * ⚑ THE SAMPLE'S OWN GENERATOR IS THE SPECIFICATION, and it lives in this repo:
 *     pcolormesh(x_edges, y_edges, values, cmap="viridis", vmin=60, vmax=780)
 * Three arrays. The export published the third as `Matrix (value per cell)` and
 * the colour axis's span as `Colour key`, and left the first two to be
 * re-derived from the long form by whoever worked out that they had to.
 *
 * ⚑ A SECTION, NOT A HEADER ROW, and the reason is arithmetic rather than taste:
 * a matrix block has n data columns and one corner slot, so n+1 edges do not fit
 * without either a ragged row or a column of blanks under the last edge. The
 * boundaries are also a fact about the FIGURE'S GRID rather than about any one
 * cell - the same argument `heatmapKeySection` makes for the colour key's span,
 * so it gets the same shape. Mirror, do not merely match.
 *
 * ⚑ DERIVED, never the record. Every edge is already in the long form as
 * `x min`/`x max`; this is a pivot of a measurement we hold, which is why it can
 * disagree with nothing. And it asserts only what was measured: a grid with a
 * GAP has more than n+1 boundaries, and it says so rather than closing the hole
 * to make the vector the length a library would prefer.
 */
export function heatmapMatrixAxesSection(cells: readonly HeatmapExportCell[]): TableSection {
  const xs = edgesOf(cells, 'x');
  const ys = edgesOf(cells, 'y');
  const width = Math.max(xs.length, ys.length);
  // ⚑ PADDED to one length. A non-square grid gives x and y different edge
  // counts, and two rows of different length render as ragged CSV - which a
  // spreadsheet reads wrong in silence. Padded with the same empty string an
  // unread cell uses, so a blank means "no such edge" exactly as it already
  // means "no such reading".
  const row = (name: string, e: number[]): (string | number)[] => [
    name,
    ...e,
    ...Array.from({ length: width - e.length }, () => ''),
  ];
  return {
    title: 'Matrix axes (cell boundaries)',
    header: ['axis', ...Array.from({ length: width }, (_, i) => `edge ${i + 1}`)],
    // An unread figure is an empty block, not a broken one - the rule the cells
    // section already follows.
    rows: cells.length === 0 ? [] : [row('x', xs), row('y', ys)],
  };
}

/** The Measure tool's recorded results (distance/angle/area/slope) -- a
 * separate collection from the series data, so exported as their own labelled
 * block appended after the data - the competitor data-panel study's finding.
 *
 * **`value` is a NUMBER (checkpoint 82).** It used to be the card's formatted
 * string, so the file carried `"45.0°"` -- a glyph inside a value, unparseable
 * without re-parsing our own display format, and rounded to 4 significant
 * figures with no un-rounded copy anywhere. That was the fourth "dataProviders"
 * defect and the one checkpoint 76 could not fix from `getValueAtPixel`.
 *
 * The unit moves to **its own column** rather than being concatenated: a reader
 * gets the magnitude without stripping a suffix, which is the same reason WPD's
 * own contract emits raw floats (`dataProviders.js:294-356`: `['Label',
 * 'Distance']`, `['Label','Angle']`, `['Label','Area','Perimeter']`). `note` is
 * dropped entirely -- it was UI guidance ("set a scale for real units"), never
 * data.
 *
 * Deliberately still absent, and logged rather than smuggled in here: WPD's
 * per-measurement `Label` column, and Area's `Perimeter`. Both are real; both
 * are a capability change, not a value-contract change. (This once pointed at
 * `core/connectedPoints.ts` for "the math, unused" - that unreachable
 * getPerimeter was deleted in the 2026-07-31 dead-code sweep, so adding the
 * column means writing the arithmetic, not wiring up something dormant.) */
export interface MeasurementCsvRow {
  tool: string;
  /**
   * Null where the instrument took a reading that is not a number.
   *
   * ⚑ A COLOUR measurement on a figure with no calibrated key has a reading and
   * no value, and so does one whose colour the key answers twice. Blank, never
   * 0 - the same rule the error columns follow, for the same reason: a zero is
   * a number somebody could believe.
   */
  value: number | null;
  unit: string;
  /** The colour a Colour measurement read, as `#rrggbb` - what the instrument
   * actually measured, where every other tool's reading IS its value. */
  colour?: string;
}
/**
 * The measurements as JSON, for whichever builder the type routes to.
 *
 * ⚑⚑ ONE READER, and F22 is what made it one. Three of the four JSON builders
 * had written `{ tool, value, unit }` out by hand, so a Colour measurement -
 * whose ONLY reading is its colour, `value` being null on any figure with no
 * calibrated key - exported as `{"tool":"colour","value":null,"unit":""}` on
 * every type except heatmap. The table formats had carried it since the column
 * was added; three copies of one object literal are how the fourth format got
 * left behind.
 *
 * ⚑ Same presence rule as `measurementsSection` above: `colour` appears for the
 * rows that have one, so a session that never used the instrument exports what
 * it always did.
 */
export function measurementsJson(rows: readonly MeasurementCsvRow[]): Record<string, unknown>[] {
  return rows.map((m) => ({
    tool: m.tool,
    value: m.value,
    unit: m.unit,
    ...(m.colour !== undefined ? { colour: m.colour } : {}),
  }));
}
/** The recorded measurements as their own titled section, so they stay a
 * SEPARATE block from the series data in every format (David). */
export function measurementsSection(rows: readonly MeasurementCsvRow[]): TableSection {
  // ⚑ Presence is the signal, as everywhere else in this file: a session that
  // never used the Colour instrument exports exactly the block it did before.
  const colours = rows.some((r) => r.colour !== undefined);
  return {
    title: 'Measurements',
    header: colours ? ['tool', 'value', 'unit', 'colour'] : ['tool', 'value', 'unit'],
    rows: rows.map((r) => [
      r.tool,
      r.value ?? '',
      r.unit,
      ...(colours ? [r.colour ?? ''] : []),
    ]),
  };
}
/** All series side by side, mirroring the on-screen spreadsheet (checkpoint 60):
 * a `#` column then, per series, one column per value dimension headed
 * "<name> <label>" (e.g. "Series 1 X"). Rows are ragged -- blank cells where a
 * series is shorter than the row. Pixel columns are dropped, like the panel. */
export interface SeriesForCSV {
  name: string;
  rows: readonly ExportRow[];
  /** Set when this series records error for another (checkpoint 77). */
  relation?: ErrorRelation;
  /** For an error-cap series: each row's signed offset from its datum, exported
   * BESIDE the absolute cap position rather than instead of it.
   *
   * ⚑ Both, deliberately. The absolutes are what was measured off the pixels, so
   * they stay the record; the deltas are what a plotting library takes, and
   * making the reader subtract our own two columns to get them is work we can
   * do once. matplotlib's `yerr` and Excel want deltas; ggplot's ymin/ymax want
   * the absolutes. Carrying both means neither has to do arithmetic on the
   * record (David, 2026-08-03: "if I was going to MAKE these plots from
   * numerical values, what are the numbers that I need?"). */
  deltas?: readonly (number | null)[];
  /** This series' OWN per-datum extents (B4) - distinct from `deltas` above,
   * which belongs to the older shape where a cap was a series in its own right.
   * Both survive: a WPD import really does arrive as separate cap series. */
  error?: SeriesErrorColumns;
  /** A curve fit over this series (v0.8), if one was run. Exported SEPARATELY
   * from `points` -- its own JSON key / its own CSV block -- so the derived fit
   * never contaminates the record (David; tenet 9). */
  fit?: CurveFitExport;
  /** Geometry statistics over this series (v1.1), if computed. Same rule as the
   * fit: a SEPARATE derived block, never mixed into the record (tenet 9). */
  geometry?: GeometryResult;
}

/** A curve fit as it leaves the app (v0.8): the model (equation + coefficients),
 * its goodness-of-fit, and a dense sampling of the fitted curve in data space so
 * a consumer can plot it without re-evaluating the polynomial. */
export interface CurveFitExport {
  series: string;
  /** Which shape produced the equation - polynomial, exponential, power,
   * logarithmic, gaussian, logistic. Absent on a fit stored before nonlinear
   * models existed, which means polynomial. A plain string rather than the
   * panel's union, to keep this module free of a dependency on it. */
  model?: string;
  degree: number;
  equation: string;
  coefficients: number[];
  /** Absent for a flat series: R² is undefined with no variation to explain,
   * and a blank cell says that where a 1 would have claimed a perfect fit. */
  rSquared?: number;
  rms: number;
  n: number;
  samples: readonly { x: number; y: number }[];
  /**
   * Did the solver settle? Absent for a polynomial, which is solved directly and
   * has nothing to converge.
   *
   * ⚑ Carried into the FILE, not just the screen (v1.5). Levenberg-Marquardt
   * always returns something, so an abandoned fit and a settled one look alike
   * once they are numbers on a page -- and the file is the half that outlives
   * the session and gets handed to someone who never saw the warning.
   */
  converged?: boolean;
}

/**
 * A series' column-name prefix: its name, plus its role when it carries error.
 *
 * **CSV is flat, so the relationship has to live in the column names** -- which
 * is the same "disambiguated by name alone, no mode flag" rule CLAUDE.md
 * settled on from Vega-Lite, and the reason the error model needs no `errorKind`
 * field: a series named "SD" relating as `upper` exports as `SD upper Y`, and
 * the caption's meaning arrives with it because the user wrote the name.
 *
 * The value dimension stays on the end (`SD upper Y`, not the design doc's
 * shorthand `SD upper`) because an error series is an ordinary series and has a
 * real X as well as a Y. Dropping X to match the shorthand would lose where the
 * cap actually sits, which is exactly the measurement.
 *
 * **The role is not restated when the name already ends with it** (checkpoint
 * 79). The design doc's example names both halves of a symmetric bar "SD" and
 * lets the role tell them apart -- but checkpoint 75 made names unique, so the
 * two halves cannot both be "SD", and the capture UI derives "SD upper"/"SD
 * lower" instead (algorithms/errorCapture.ts's errorSeriesName). Without this
 * check that pair exports as `SD upper upper Y`.
 *
 * Deliberately narrow: it drops a *duplicate* word, never the role itself, so
 * the worst case is a series the user happened to name "Upper bound" reading as
 * `Upper bound upper Y` -- untidy, still correct and still unambiguous. This is
 * a naming rule inside an export, not a guard: unlike checkpoint 72's
 * trailing-digit heuristic, its failure mode is a stuttering header, not a
 * refusal that silently no-ops.
 */
function seriesColumnPrefix(s: SeriesForCSV): string {
  if (!s.relation) return s.name;
  const name = s.name.trim();
  const role = s.relation.role;
  return name.toLowerCase().endsWith(` ${role}`) || name.toLowerCase() === role
    ? name
    : `${name} ${role}`;
}

export function allSeriesSection(series: readonly SeriesForCSV[], fields: readonly string[]): TableSection {
  // Roles are decided PER SERIES: in a multi-series file one traced curve can be
  // interpolation-assisted while the others were placed by hand, so only that
  // one grows a role column (`<series> role`, beside its own value columns).
  const roleCols = series.map((s) => hasRoles(s.rows));
  // Same per-series rule as roles above: only an error-cap series grows a delta
  // column, beside its own value columns. ⚑ Spelled "delta", not the Unicode
  // sign the on-screen table uses -- a CSV header lands in other people's
  // parsers, and an ASCII header cannot arrive mojibaked.
  const deltaCols = series.map((s) => (s.deltas?.length ?? 0) > 0);
  // Same per-series rule again, for the extents a datum carries on its own
  // record: only a series that recorded a side grows that side's column.
  const errCols = series.map((s) => (s.error?.labels.length ? s.error : null));
  // Same per-series rule once more (A4): only a series someone typed into grows
  // a source column, beside the very column that value sits in.
  const sourceCols = series.map((s) => suppliedFields(s.rows));
  const header: (string | number)[] = ['#'];
  series.forEach((s, si) => {
    for (const label of fields) header.push(`${seriesColumnPrefix(s)} ${label}`);
    for (const f of sourceCols[si]!) header.push(`${seriesColumnPrefix(s)} ${fields[f] ?? f} source`);
    const err = errCols[si];
    if (err) {
      for (const label of err.labels) header.push(`${seriesColumnPrefix(s)} ${label}`);
      for (const label of err.labels) header.push(`${seriesColumnPrefix(s)} ${label} delta`);
    }
    if (roleCols[si]) header.push(`${seriesColumnPrefix(s)} role`);
    if (deltaCols[si]) header.push(`${seriesColumnPrefix(s)} delta`);
  });
  const maxRows = series.reduce((max, s) => Math.max(max, s.rows.length), 0);
  const rows: (string | number)[][] = [];
  for (let i = 0; i < maxRows; i++) {
    const row: (string | number)[] = [i + 1];
    series.forEach((s, si) => {
      const r = s.rows[i];
      for (let d = 0; d < fields.length; d++) row.push(r?.values[d] ?? '');
      // ⚑ Blank past the end of a shorter series - a row this series does not
      // have took no reading, by any instrument.
      for (const f of sourceCols[si]!) row.push(r ? sourceWord(r, f) : '');
      const err = errCols[si];
      if (err) {
        // Blank, never 0 - see flatDataSection.
        for (let c = 0; c < err.labels.length; c++) row.push(err.values[i]?.[c] ?? '');
        for (let c = 0; c < err.labels.length; c++) row.push(err.deltas[i]?.[c] ?? '');
      }
      if (roleCols[si]) row.push(r?.role ?? '');
      // Blank, never 0, for a cap that resolves to no datum -- 0 would read as
      // "measured, and equal to the datum".
      if (deltaCols[si]) row.push(s.deltas?.[i] ?? '');
    });
    rows.push(row);
  }
  return { header, rows };
}
/** Structured JSON export (checkpoint 61): every series as { name, points },
 * each point an object keyed by the value-dim labels (e.g. {X, Y}). Pixel-free,
 * like the spreadsheet; measurements ride along as their own array when present.
 * A good shape for downstream ingestion. */
export function buildSeriesJSON(
  series: readonly SeriesForCSV[],
  fields: readonly string[],
  measurements: readonly MeasurementCsvRow[] = []
): string {
  const doc: Record<string, unknown> = {
    // An error series stays a top-level series, because that is exactly what it
    // is (docs/error-bars-design.md): the relation is one more key on it, not a
    // different kind of entry. `relation` is omitted entirely for an ordinary
    // series rather than nulled -- the same rule the whole error schema follows,
    // where an absent field means "not measured" and never a value.
    series: series.map((s) => {
      const entry: Record<string, unknown> = {
        name: s.name,
        // `role` is attached only to a point that HAS one (an interpolation-assist
        // series), never nulled onto ordinary points -- the same "an absent field
        // means it doesn't apply" rule the error schema follows. A reader that
        // wants only what a human put on the figure keeps role != "interpolated".
        points: s.rows.map((r, i) => ({
          ...Object.fromEntries(fields.map((label, d) => [label, r.values[d] ?? null])),
          // ⚑ The datum's own extents, under exactly the names the CSV headers
          // use - mirror, not merely match: a reader who switches format meets
          // the same words, so nothing has to be explained twice.
          //
          // ⚑ A side that was never read carries NO KEY, rather than a null.
          // "An absent field means it was not measured" is the rule the whole
          // error schema follows, and a null here would be a claim that we
          // looked.
          ...Object.fromEntries(
            (s.error?.labels ?? []).flatMap((label, c) => {
              const value = s.error!.values[i]?.[c];
              const delta = s.error!.deltas[i]?.[c];
              return value == null ? [] : [[label, value], [`${label} delta`, delta ?? null]];
            })
          ),
          ...(r.role ? { role: r.role } : {}),
          // ⚑ Attached only to the value it applies to, under the CSV's own
          // words - mirror, not merely match, exactly as the error columns do.
          // An absent key means the number came off the pixels, which is the
          // rule this whole schema follows for "not measured, not applicable".
          ...Object.fromEntries((r.supplied ?? []).map((f) => [`${fields[f] ?? f} source`, 'user'])),
        })),
      };
      if (s.relation) entry.relation = { role: s.relation.role, of: s.relation.of };
      // ⚑ The Δ ships in JSON too, as `deltas` already promises: the absolutes
      // stay the record, the deltas are what matplotlib's `yerr` and Excel take.
      // Until v2.1 this key existed, was computed by buildExportJson's caller and
      // silently dropped here, so the JSON reader alone had to re-derive the
      // cap→datum pairing -- the one rule that has shipped wrong twice. A `null`
      // marks a row with no cap, the same way an unmeasured value is null rather
      // than absent.
      if (s.deltas) entry.deltas = [...s.deltas];
      // The fit is a SEPARATE key from `points` (David) -- a reader takes the
      // record or the derived model, never entangled. `samples` is the sampled
      // fitted curve; the equation/coefficients are the model it came from.
      if (s.fit) {
        entry.fit = {
          model: s.fit.model ?? 'polynomial',
          ...(s.fit.model && s.fit.model !== 'polynomial' ? {} : { degree: s.fit.degree }),
          equation: s.fit.equation,
          coefficients: s.fit.coefficients,
          // Omitted rather than nulled when undefined: an absent field means
          // "does not apply" throughout this schema.
          ...(s.fit.rSquared === undefined ? {} : { rSquared: s.fit.rSquared }),
          rms: s.fit.rms,
          n: s.fit.n,
          // Absent for a polynomial rather than `true` -- an absent field means
          // "does not apply" throughout this schema, and a `true` here would
          // assert something the solver never tested.
          ...(s.fit.converged === undefined ? {} : { converged: s.fit.converged }),
          samples: s.fit.samples.map((p) => ({ x: p.x, y: p.y })),
        };
      }
      // Geometry -- another SEPARATE derived key (v1.1): the summary stats plus
      // the per-point cumulative-length / curvature series, never mixed into
      // `points`. Point index is 1-based to match the on-canvas labels.
      if (s.geometry) {
        entry.geometry = {
          arcLength: s.geometry.arcLength,
          area: s.geometry.area,
          areaLabel: s.geometry.areaLabel,
          maxCurvature: { value: s.geometry.maxCurvature.value, point: s.geometry.maxCurvature.index + 1 },
          perPoint: s.geometry.perPoint.map((p, i) => ({ point: i + 1, x: p.x, y: p.y, cumulativeLength: p.cumulativeLength, curvature: p.curvature })),
        };
      }
      return entry;
    }),
  };
  if (measurements.length > 0) {
    doc.measurements = measurementsJson(measurements);
  }
  return JSON.stringify(doc, null, 2);
}

/** One "Curve fit" block summarising every fitted series (v0.8): the model
 * (equation, coefficients) and its goodness-of-fit. Titled + separate from the
 * data so a reader can ignore it, or take only it. Absent when nothing is fitted. */
export function curveFitSummarySection(fits: readonly CurveFitExport[]): TableSection {
  return {
    title: 'Curve fit',
    // `settled` is APPENDED: every curve-fit export written since v0.8 carries
    // this header, so a name-based reader keeps working and an index-based one
    // finds every column it knew about where it left it.
    // `model` and `settled` are both APPENDED, after the seven columns every
    // curve-fit export has carried since v0.8, so a reader finds the old ones
    // where it left them.
    header: ['series', 'equation', 'coefficients', 'R2', 'RMS', 'n', 'degree', 'model', 'settled'],
    rows: fits.map((f) => [
      f.series,
      f.equation,
      f.coefficients.join(' '),
      // A blank cell, never a fabricated number -- the same rule the rest of this
      // module follows for a value that was not measured.
      f.rSquared ?? '',
      f.rms,
      f.n,
      // ⚑ Degree belongs to the polynomial alone. The UI merely UNMOUNTS the
      // Degree control for the other models, so the stored number is whatever the
      // spinner last held -- exporting it beside a Gaussian states a fact about a
      // control, not about the fit.
      f.model && f.model !== 'polynomial' ? '' : f.degree,
      f.model ?? 'polynomial',
      // Three states, spelled out rather than left blank: a blank cell would be
      // read as "no" by anyone scanning the column.
      f.converged === undefined ? 'n/a' : f.converged ? 'yes' : 'no',
    ]),
  };
}

/** The sampled fitted curve for ONE series as its own titled block (David) --
 * the raw traced points and the derived fit never share a table. `valueLabels`
 * names the two columns (the axes' own labels, e.g. X / Y). */
export function fittedCurveSection(fit: CurveFitExport, valueLabels: readonly string[] = ['x', 'y']): TableSection {
  const xl = valueLabels[0] ?? 'x';
  const yl = valueLabels[1] ?? 'y';
  return {
    // The caveat rides in the TITLE because this block is designed to be taken
    // on its own -- these 101 points ARE the unsettled curve, and lifted out of
    // the document they would otherwise carry no trace of it.
    title: `Fitted curve - ${fit.series}${fit.converged === false ? ' (did not settle)' : ''}`,
    header: [xl, yl],
    rows: fit.samples.map((p) => [p.x, p.y]),
  };
}

/** One "Geometry" block summarising every series with geometry (v1.1): arc
 * length, area (its own label -- enclosed vs under-curve), and the max-curvature
 * value + its 1-based point. Titled + separate from the record (tenet 9). */
export function geometrySummarySection(geometries: readonly { series: string; result: GeometryResult }[]): TableSection {
  return {
    title: 'Geometry',
    header: ['series', 'arc_length', 'area', 'area_kind', 'max_curvature', 'max_curvature_point'],
    rows: geometries.map((g) => [
      g.series,
      g.result.arcLength,
      g.result.area,
      g.result.areaLabel,
      g.result.maxCurvature.value,
      g.result.maxCurvature.index + 1,
    ]),
  };
}

/** The per-point geometry series for ONE series as its own titled block (v1.1):
 * cumulative length + curvature at each point, in curve order, 1-based to match
 * the on-canvas labels. `valueLabels` names the x/y columns (the axes' labels). */
export function geometryTableSection(series: string, result: GeometryResult, valueLabels: readonly string[] = ['x', 'y']): TableSection {
  const xl = valueLabels[0] ?? 'x';
  const yl = valueLabels[1] ?? 'y';
  return {
    title: `Geometry per-point - ${series}`,
    header: ['point', xl, yl, 'cumulative_length', 'curvature'],
    rows: result.perPoint.map((p, i) => [i + 1, p.x, p.y, p.cumulativeLength, p.curvature]),
  };
}

/** Structured JSON for a histogram (checkpoint 66): bins rather than points.
 *
 * Deliberately not routed through buildSeriesJSON, which would emit each bin
 * as its two raw corner points -- technically the captured data, but it
 * describes the *clicks* rather than the histogram, and a consumer would have
 * to know our capture model to reconstruct an interval from it. Bins are the
 * measurement; the corners are just how they were obtained.
 *
 * `valueErr` is included per bin only when present, so the shape stays clean
 * until error capture lands (see algorithms/histogram.ts). */
/**
 * The heatmap's JSON export (v2.2): the record, then the derived matrix.
 *
 * ⚑ THE SAME TWO SHAPES THE TABLE FORMATS GET, because the two library
 * conventions are real and a file serving one fails the other: LONG/tidy (one
 * row per cell - ggplot2's `geom_tile`, vega-lite) and WIDE/matrix (a 2D array
 * plus coordinate vectors - matplotlib, plotly, seaborn, R's `image`). Our
 * record IS the tidy one, and it pivots into the other, so both are written and
 * neither consumer has to reshape anything by hand.
 *
 * ⚑ `null`, not 0, for a cell that could not be read - and JSON's null survives
 * the round trip where a NaN would not (`setMetadata`'s own JSON pass rewrites
 * NaN as null, and `null * x === 0` is how a laundered NaN became a flat line
 * at zero once already).
 */
export function buildHeatmapJSON(
  cells: readonly HeatmapExportCell[],
  measurements: readonly MeasurementCsvRow[] = [],
  key?: HeatmapKeyExport
): string {
  const xs = [...new Set(cells.map((c) => c.xCentre))].sort((a, b) => a - b);
  const ys = [...new Set(cells.map((c) => c.yCentre))].sort((a, b) => a - b);
  const byKey = new Map(cells.map((c) => [`${c.xCentre},${c.yCentre}`, c]));
  const doc: Record<string, unknown> = {
    // ⚑ The third axis's own span, beside the readings taken on it.
    ...(key ? { colourKey: { from: key.from, to: key.to, log: key.log } } : {}),
    cells: cells.map((c) => ({
      xMin: c.xMin,
      xMax: c.xMax,
      yMin: c.yMin,
      yMax: c.yMax,
      xCentre: c.xCentre,
      yCentre: c.yCentre,
      value: c.value,
      // ⚑ The machine-readable half of the source. The table's square brackets
      // around `[59]` are the half that survives a paste into a spreadsheet;
      // this is the half a program can read. Both channels, because they reach
      // different readers.
      valueSource: c.source ?? 'colour',
      // ⚑ The evidence travels with the value, in the same object. It used to be
      // four numbers - the interval, the colour offset, the clipping flag and
      // this one; the first three were the old error model's output and went
      // with it. What remains is the fact a consumer cannot re-derive from the
      // image alone: how much of the cell actually was the colour WE sampled.
      uniformity: c.uniformity,
      // Written only where the figure prints a name, so a value x value heatmap's
      // JSON is byte-for-byte what it was before names existed.
      ...(c.xLabel ? { xLabel: c.xLabel } : {}),
      ...(c.yLabel ? { yLabel: c.yLabel } : {}),
    })),
    // ⚑ Said ONCE for the whole figure rather than repeated per cell: it is a
    // property of the axis, and a reader deciding how to plot this needs it
    // before they look at any row.
    axes: {
      x: cells.some((c) => c.xIsCategory) ? 'category' : 'value',
      y: cells.some((c) => c.yIsCategory) ? 'category' : 'value',
    },
    matrix: {
      x: xs,
      // ⚑⚑ THE EDGES RIDE ALONGSIDE THE CENTRES, not instead of them - the same
      // rule the tick labels below already follow, for the same reason. The two
      // conventions are both real and both in use: `geom_tile` takes centres
      // plus a size, `pcolormesh` with `shading='flat'` refuses them and demands
      // n+1. A document that dropped either half would fail a real consumer.
      // See `heatmapMatrixAxesSection` for the whole argument.
      xEdges: edgesOf(cells, 'x'),
      y: ys,
      yEdges: edgesOf(cells, 'y'),
      // ⚑ The names ride ALONGSIDE the coordinate vectors rather than replacing
      // them: `matplotlib`/`plotly` want numbers for positions and strings for
      // tick labels, and both are here, aligned index for index.
      ...(hasLabels(cells, 'x') ? { xLabels: xs.map((x) => cells.find((c) => c.xCentre === x)?.xLabel ?? '') } : {}),
      ...(hasLabels(cells, 'y') ? { yLabels: ys.map((y) => cells.find((c) => c.yCentre === y)?.yLabel ?? '') } : {}),
      values: ys.map((y) => xs.map((x) => byKey.get(`${x},${y}`)?.value ?? null)),
    },
  };
  if (measurements.length > 0) doc['measurements'] = measurementsJson(measurements);
  return JSON.stringify(doc, null, 2);
}

export function buildHistogramJSON(
  name: string,
  bins: readonly (HistogramBin | null)[],
  rounder: ValueRounder,
  measurements: readonly MeasurementCsvRow[] = [],
  /** The caps someone placed on these bins - see `histogramSection` (F27). */
  error?: SeriesErrorColumns
): string {
  const doc: Record<string, unknown> = {
    series: [
      {
        name,
        bins: bins.flatMap((b, i) => {
          if (b === null) return [];
          const rounded: Record<string, unknown> = {
            binStart: rounder.at([b.binStart, b.value], 0),
            binEnd: rounder.at([b.binEnd, b.value], 0),
            value: rounder.at([b.binStart, b.value], 1),
          };
          if (b.valueErr !== undefined) {
            rounded['valueErr'] = rounder.scalarAt(b.valueErr, [b.binStart, b.value], 1);
          }
          // Same keys, same "an absent key means nobody looked" rule as
          // `buildSeriesJSON` - a reader who switches format meets the same words.
          for (const [c, label] of (error?.labels ?? []).entries()) {
            const value = error!.values[i]?.[c];
            if (value == null) continue;
            rounded[label] = value;
            rounded[`${label} delta`] = error!.deltas[i]?.[c] ?? null;
          }
          return [rounded];
        }),
      },
    ],
  };
  if (measurements.length > 0) {
    doc.measurements = measurementsJson(measurements);
  }
  return JSON.stringify(doc, null, 2);
}

/** Structured JSON for a tuple-shaped type (Pie today; Box Plot and Bar in
 * v2.0) -- one object per tuple/category, keyed by slot name, plus (v2.0) the
 * type's own derived value when it declares one.
 *
 * Same reasoning as `buildHistogramJSON`: `buildExportJson`'s previous only
 * choice besides histogram was `buildSeriesJSON`, which emits each tuple's
 * members as flat, unrelated points -- a Pie's two boundary angles with no
 * hint they belong to the same sector, and no derived value at all. This is
 * the tuple-shaped counterpart, giving Box Plot/Bar/Pie tuples a real
 * structured export instead of falling through to the flat per-point shape.
 *
 * A still-open tuple's unfilled slot is `null`, matching the CSV blank cell
 * and the table's own placeholder -- never a fabricated 0.
 *
 * ⚑ `row.derived` is emitted as-is, never re-rounded through `rounder` --
 * see `tupleDataSection`'s matching comment for why (the type's own
 * `derivedTupleValue.compute` already applied the right precision; routing
 * it back through the axis-resolution rounder would need a working
 * `dataToPixel`, which most non-invertible axes -- pie included -- don't
 * have). */
export function buildTupleSeriesJSON(
  series: readonly { name: string; rows: readonly TupleRow[]; error?: SeriesErrorColumns }[],
  pointGroupNames: readonly string[],
  rounder: ValueRounder,
  derivedLabel: string | undefined,
  measurements: readonly MeasurementCsvRow[] = [],
  /** See `tupleDataSection`'s parameter of the same name - the same names and
   * the same ordering rule, because a reader who switches format must meet the
   * same words. */
  intervalSlots?: readonly [string, string]
): string {
  const doc: Record<string, unknown> = {
    series: series.map(({ name, rows: tupleRows, error }) => (
      {
        name,
        tuples: tupleRows.map((row, i) => {
          const entry: Record<string, unknown> = {
            // F21: the same coordinate the tables carry - `tupleDataSection`'s
            // comment has the why. Absent, never null, where nothing measured
            // it: a key that is there says a reading was taken.
            ...(row.position != null
              ? { [row.positionFrame === 'index' ? 'categoryIndex' : 'position']: row.position }
              : {}),
            category: row.label,
            ...(row.positionSpan
              ? { positionMin: row.positionSpan[0], positionMax: row.positionSpan[1] }
              : {}),
            ...Object.fromEntries(
              (intervalSlots ?? pointGroupNames).map((label, slot) => [
                label,
                memberValues(row, pointGroupNames.length, rounder, intervalSlots !== undefined)[slot] ??
                  null,
              ])
            ),
          };
          if (derivedLabel != null && row.derived != null) {
            entry[derivedLabel] = row.derived;
          }
          // ⚑⚑ THE EXTENTS, in the format that used to be the only one without
          // them. The CSV path has passed `errorColumnsFor` since B4; this
          // builder took `{name, rows}` and there was nowhere for them to go, so
          // a bar chart with SD caps on screen and in its .csv exported a .json
          // with no error at all - and JSON is the format a program reads. Same
          // keys, same order, same "an absent key means nobody looked" rule as
          // `buildSeriesJSON`, because a reader who switches format must meet
          // the same words. (v2.3 re-audit, F26.)
          for (const [c, label] of (error?.labels ?? []).entries()) {
            const value = error!.values[i]?.[c];
            if (value == null) continue;
            entry[label] = value;
            entry[`${label} delta`] = error!.deltas[i]?.[c] ?? null;
          }
          return entry;
        }),
      }
    )),
  };
  if (measurements.length > 0) {
    doc.measurements = measurementsJson(measurements);
  }
  return JSON.stringify(doc, null, 2);
}
