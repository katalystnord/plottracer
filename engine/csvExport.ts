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

import type { TupleRow } from './calibrationSession.js';
import type { HistogramBin } from '../algorithms/histogram.js';
import type { GeometryResult } from '../algorithms/geometry.js';
import { errorAbove, errorBelow, type ErrorBarPoint } from '../algorithms/errorBar.js';
import type { ErrorRelation } from './errorRelation.js';
import { type ExportValue } from '../core/exportValues.js';
import type { ValueRounder } from '../core/exportPrecision.js';
import { renderTable, type TableSection } from './tableFormats.js';

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

/** Quotes a field only if it needs it (contains the delimiter, a quote, or a
 * newline), doubling any embedded quotes -- the standard minimal CSV escaping
 * rule (RFC 4180), applied to whichever delimiter is in use. */
function escapeField(value: string | number, delimiter: Delimiter): string {
  const s = String(value);
  if (s.includes(delimiter) || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function toDelimited(rows: (string | number)[][], delimiter: Delimiter = ','): string {
  return rows.map((row) => row.map((f) => escapeField(f, delimiter)).join(delimiter)).join('\n');
}

/** One export row: its pixel, plus the contract's values (checkpoint 76). */
export interface ExportRow {
  px: number;
  py: number;
  values: ExportValue[];
}

/** One row per point: pixel coordinates plus the axes' own columns.
 *
 * Headers come from the axes (`session.getExportFields()`), not from a
 * generated `value`/`value1`/`value2` list — the old generic names were a
 * documented simplification ("axis labels aren't tracked anywhere in ui/ yet")
 * that was false: `getAxesLabels()` has always been there and had zero callers.
 * A Bar chart's first column is now its Label, and a CCR's first column is a
 * time rather than a julian float. See core/exportValues.ts.
 *
 * A null value (not measured) exports a blank cell rather than a zero. */
export function flatDataSection(rows: readonly ExportRow[], fields: readonly string[]): TableSection {
  return {
    header: ['x_px', 'y_px', ...fields],
    rows: rows.map((r) => [r.px, r.py, ...fields.map((_f, i) => r.values[i] ?? '')]),
  };
}
export function buildFlatDataCSV(rows: readonly ExportRow[], fields: readonly string[], sep: Delimiter = ','): string {
  return renderTable([flatDataSection(rows, fields)], delimitedFormat(sep));
}

/** One row per tuple/category: its label plus one column per point group,
 * in group order. An unfilled slot (still-open tuple) exports as a blank
 * cell, matching the points table's own "—" placeholder in spirit. Only
 * a group's first data value is exported (dataDim is always 1 for the Bar
 * axes Box Plot uses this for -- see calibrationSession.ts's
 * getBoxPlotGlyphs, the only place point groups are offered today). */
export function tupleDataSection(
  pointGroupNames: readonly string[],
  tupleRows: readonly TupleRow[],
  rounder: ValueRounder
): TableSection {
  // Box Plot's axes is Bar (dataDim 1): each group's single value is dimension 0.
  return {
    header: ['category', ...pointGroupNames],
    rows: tupleRows.map((row) => [row.label, ...row.points.map((p) => (p?.data ? rounder.at([p.data[0]!], 0) : ''))]),
  };
}
export function buildTupleDataCSV(
  pointGroupNames: readonly string[],
  tupleRows: readonly TupleRow[],
  rounder: ValueRounder,
  sep: Delimiter = ','
): string {
  return renderTable([tupleDataSection(pointGroupNames, tupleRows, rounder)], delimitedFormat(sep));
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
export function histogramSection(bins: readonly (HistogramBin | null)[], rounder: ValueRounder): TableSection {
  const complete = bins.filter((b): b is HistogramBin => b !== null);
  const hasErr = complete.some((b) => b.valueErr !== undefined);
  // Histogram axes is XY: bin edges are X (dim 0), the magnitude is Y (dim 1).
  // Each edge's X-resolution is read at that edge (with the bin's value as the
  // reference Y, which only matters on a rotated calibration).
  return {
    header: ['bin start', 'bin end', 'value', ...(hasErr ? ['value error'] : [])],
    rows: complete.map((b) => [
      rounder.at([b.binStart, b.value], 0),
      rounder.at([b.binEnd, b.value], 0),
      rounder.at([b.binStart, b.value], 1),
      ...(hasErr ? [ropt(rounder, b.valueErr, [b.binStart, b.value], 1)] : []),
    ]),
  };
}
export function buildHistogramCSV(bins: readonly (HistogramBin | null)[], rounder: ValueRounder, sep: Delimiter = ','): string {
  return renderTable([histogramSection(bins, rounder)], delimitedFormat(sep));
}

/** One row per error bar (checkpoint 70): the datum plus its whiskers.
 *
 * Emits BOTH the absolute whisker positions and the derived +/- deltas. The
 * absolutes are the measurement and match the schema the old app's structured
 * export has always written, so anything
 * already ingested lines up; the deltas are what a reader actually wants to
 * see next to a value, and deriving them here means no consumer has to guess
 * our sign convention. A bar with no whiskers captured yet still exports its
 * centre -- unlike a half-captured histogram bin, a lone datum IS meaningful
 * (it is just a point with unknown error), so dropping it would lose data. */
export function errorBarSection(bars: readonly (ErrorBarPoint | null)[], rounder: ValueRounder): TableSection {
  // Error-bar axes is XY: x is dim 0, every y-family value (y, whiskers, deltas)
  // is dim 1. Each whisker/delta is rounded at its OWN y so a log axis keeps small
  // whiskers; the deltas use the datum's y-resolution.
  return {
    header: ['x', 'y', 'y upper', 'y lower', 'error +', 'error -'],
    rows: bars
      .filter((b): b is ErrorBarPoint => b !== null)
      .map((b) => [
        rounder.at([b.x, b.y ?? 0], 0),
        ropt(rounder, b.y, [b.x, b.y ?? 0], 1),
        ropt(rounder, b.yUpper, [b.x, b.yUpper ?? 0], 1),
        ropt(rounder, b.yLower, [b.x, b.yLower ?? 0], 1),
        ropt(rounder, errorAbove(b), [b.x, b.y ?? 0], 1),
        ropt(rounder, errorBelow(b), [b.x, b.y ?? 0], 1),
      ]),
  };
}
export function buildErrorBarCSV(bars: readonly (ErrorBarPoint | null)[], rounder: ValueRounder, sep: Delimiter = ','): string {
  return renderTable([errorBarSection(bars, rounder)], delimitedFormat(sep));
}

/** Structured JSON for an error-bar series (checkpoint 70).
 *
 * Deliberately mirrors the OLD app's shipped export shape:
 * `{x, y, yUpper, yLower}`, absolute positions, and
 * each optional field omitted rather than nulled when it wasn't captured --
 * "not measured" must not read downstream as a value. This is the schema
 * that had to settle before anything ingests it; it settled in 2026-07-06,
 * and this restores it rather than
 * inventing a second one. */
export function buildErrorBarJSON(
  name: string,
  bars: readonly (ErrorBarPoint | null)[],
  rounder: ValueRounder,
  measurements: readonly MeasurementCsvRow[] = []
): string {
  const doc: Record<string, unknown> = {
    series: [
      {
        name,
        errorBars: bars
          .filter((b): b is ErrorBarPoint => b !== null)
          .map((b) => {
            const entry: Record<string, number> = { x: rounder.at([b.x, b.y ?? 0], 0) };
            if (b.y !== undefined) entry['y'] = rounder.at([b.x, b.y], 1);
            if (b.yUpper !== undefined) entry['yUpper'] = rounder.at([b.x, b.yUpper], 1);
            if (b.yLower !== undefined) entry['yLower'] = rounder.at([b.x, b.yLower], 1);
            return entry;
          }),
      },
    ],
  };
  if (measurements.length > 0) {
    doc['measurements'] = measurements.map((m) => ({ tool: m.tool, value: m.value, unit: m.unit }));
  }
  return JSON.stringify(doc, null, 2);
}

/** The Measure tool's recorded results (distance/angle/area/slope) -- a
 * separate collection from the series data, so exported as their own labelled
 * block appended after the data (see docs/competitor-data-panel-study.md §5).
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
 * per-measurement `Label` column, and Area's `Perimeter` (`core/
 * connectedPoints.ts:183` has the math, unused). Both are real; both are a
 * capability change, not a value-contract change. */
export interface MeasurementCsvRow {
  tool: string;
  value: number;
  unit: string;
}
/** The recorded measurements as their own titled section, so they stay a
 * SEPARATE block from the series data in every format (David). */
export function measurementsSection(rows: readonly MeasurementCsvRow[]): TableSection {
  return { title: 'Measurements', header: ['tool', 'value', 'unit'], rows: rows.map((r) => [r.tool, r.value, r.unit]) };
}
export function buildMeasurementsCSV(rows: readonly MeasurementCsvRow[], sep: Delimiter = ','): string {
  const header = ['tool', 'value', 'unit'];
  const data = rows.map((r) => [r.tool, r.value, r.unit]);
  return toDelimited([header, ...data], sep);
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
  degree: number;
  equation: string;
  coefficients: number[];
  rSquared: number;
  rms: number;
  n: number;
  samples: readonly { x: number; y: number }[];
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
  const header: (string | number)[] = ['#'];
  for (const s of series) for (const label of fields) header.push(`${seriesColumnPrefix(s)} ${label}`);
  const maxRows = series.reduce((max, s) => Math.max(max, s.rows.length), 0);
  const rows: (string | number)[][] = [];
  for (let i = 0; i < maxRows; i++) {
    const row: (string | number)[] = [i + 1];
    for (const s of series) {
      const values = s.rows[i]?.values;
      for (let d = 0; d < fields.length; d++) row.push(values?.[d] ?? '');
    }
    rows.push(row);
  }
  return { header, rows };
}
export function buildAllSeriesCSV(series: readonly SeriesForCSV[], fields: readonly string[], sep: Delimiter = ','): string {
  return renderTable([allSeriesSection(series, fields)], delimitedFormat(sep));
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
        points: s.rows.map((r) => Object.fromEntries(fields.map((label, i) => [label, r.values[i] ?? null]))),
      };
      if (s.relation) entry.relation = { role: s.relation.role, of: s.relation.of };
      // The fit is a SEPARATE key from `points` (David) -- a reader takes the
      // record or the derived model, never entangled. `samples` is the sampled
      // fitted curve; the equation/coefficients are the model it came from.
      if (s.fit) {
        entry.fit = {
          degree: s.fit.degree,
          equation: s.fit.equation,
          coefficients: s.fit.coefficients,
          rSquared: s.fit.rSquared,
          rms: s.fit.rms,
          n: s.fit.n,
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
    doc.measurements = measurements.map((m) => ({ tool: m.tool, value: m.value, unit: m.unit }));
  }
  return JSON.stringify(doc, null, 2);
}

/** One "Curve fit" block summarising every fitted series (v0.8): the model
 * (equation, coefficients) and its goodness-of-fit. Titled + separate from the
 * data so a reader can ignore it, or take only it. Absent when nothing is fitted. */
export function curveFitSummarySection(fits: readonly CurveFitExport[]): TableSection {
  return {
    title: 'Curve fit',
    header: ['series', 'equation', 'coefficients', 'R2', 'RMS', 'n', 'degree'],
    rows: fits.map((f) => [f.series, f.equation, f.coefficients.join(' '), f.rSquared, f.rms, f.n, f.degree]),
  };
}

/** The sampled fitted curve for ONE series as its own titled block (David) --
 * the raw traced points and the derived fit never share a table. `valueLabels`
 * names the two columns (the axes' own labels, e.g. X / Y). */
export function fittedCurveSection(fit: CurveFitExport, valueLabels: readonly string[] = ['x', 'y']): TableSection {
  const xl = valueLabels[0] ?? 'x';
  const yl = valueLabels[1] ?? 'y';
  return {
    title: `Fitted curve — ${fit.series}`,
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
    title: `Geometry per-point — ${series}`,
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
export function buildHistogramJSON(
  name: string,
  bins: readonly (HistogramBin | null)[],
  rounder: ValueRounder,
  measurements: readonly MeasurementCsvRow[] = []
): string {
  const doc: Record<string, unknown> = {
    series: [
      {
        name,
        bins: bins
          .filter((b): b is HistogramBin => b !== null)
          .map((b) => {
            const rounded = {
              binStart: rounder.at([b.binStart, b.value], 0),
              binEnd: rounder.at([b.binEnd, b.value], 0),
              value: rounder.at([b.binStart, b.value], 1),
            };
            return b.valueErr === undefined
              ? rounded
              : { ...rounded, valueErr: rounder.scalarAt(b.valueErr, [b.binStart, b.value], 1) };
          }),
      },
    ],
  };
  if (measurements.length > 0) {
    doc.measurements = measurements.map((m) => ({ tool: m.tool, value: m.value, unit: m.unit }));
  }
  return JSON.stringify(doc, null, 2);
}
