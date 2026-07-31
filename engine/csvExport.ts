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

/** One export row: its pixel, plus the contract's values (checkpoint 76). */
export interface ExportRow {
  px: number;
  py: number;
  values: ExportValue[];
  /** For an interpolation-assist series only: whether the user ASSIGNED this
   * point (`anchor`) or the spline DERIVED it (`interpolated`). Undefined for an
   * ordinary placed/traced point — the distinction doesn't apply to it (v1.3). */
  role?: PointRole;
}

/** Does any row of this series carry a role? Drives whether the `role` column
 * exists at all: a series with no interpolation exports exactly as it did
 * before, so the column's PRESENCE is itself the signal that some of these
 * points were not placed by hand. */
function hasRoles(rows: readonly ExportRow[]): boolean {
  return rows.some((r) => r.role != null);
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
 * A null value (not measured) exports a blank cell rather than a zero.
 *
 * A trailing `role` column appears only when the series actually carries roles
 * (an interpolation-assist trace), and an ordinary point inside such a series
 * leaves it blank — we state the fact the record holds and invent nothing for
 * the points it doesn't apply to. */
export function flatDataSection(rows: readonly ExportRow[], fields: readonly string[]): TableSection {
  const roles = hasRoles(rows);
  return {
    header: ['x_px', 'y_px', ...fields, ...(roles ? ['role'] : [])],
    rows: rows.map((r) => [
      r.px,
      r.py,
      ...fields.map((_f, i) => r.values[i] ?? ''),
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
 * own "—" placeholder in spirit. Only a group's first data value is
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
export function tupleDataSection(
  pointGroupNames: readonly string[],
  tupleRows: readonly TupleRow[],
  rounder: ValueRounder,
  derivedLabel?: string
): TableSection {
  // Box Plot's axes is Bar (dataDim 1): each group's single value is dimension 0.
  const hasDerived = derivedLabel != null && tupleRows.some((r) => r.derived != null);
  return {
    header: ['category', ...pointGroupNames, ...(hasDerived ? [derivedLabel] : [])],
    rows: tupleRows.map((row) => [
      row.label,
      ...row.points.map((p) => (p?.data ? rounder.at([p.data[0]!], 0) : '')),
      ...(hasDerived ? [row.derived ?? ''] : []),
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
 * per-measurement `Label` column, and Area's `Perimeter`. Both are real; both
 * are a capability change, not a value-contract change. (This once pointed at
 * `core/connectedPoints.ts` for "the math, unused" — that unreachable
 * getPerimeter was deleted in the 2026-07-31 dead-code sweep, so adding the
 * column means writing the arithmetic, not wiring up something dormant.) */
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
  /** Which shape produced the equation — polynomial, exponential, power,
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
  const header: (string | number)[] = ['#'];
  series.forEach((s, si) => {
    for (const label of fields) header.push(`${seriesColumnPrefix(s)} ${label}`);
    if (roleCols[si]) header.push(`${seriesColumnPrefix(s)} role`);
  });
  const maxRows = series.reduce((max, s) => Math.max(max, s.rows.length), 0);
  const rows: (string | number)[][] = [];
  for (let i = 0; i < maxRows; i++) {
    const row: (string | number)[] = [i + 1];
    series.forEach((s, si) => {
      const r = s.rows[i];
      for (let d = 0; d < fields.length; d++) row.push(r?.values[d] ?? '');
      if (roleCols[si]) row.push(r?.role ?? '');
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
        points: s.rows.map((r) => ({
          ...Object.fromEntries(fields.map((label, i) => [label, r.values[i] ?? null])),
          ...(r.role ? { role: r.role } : {}),
        })),
      };
      if (s.relation) entry.relation = { role: s.relation.role, of: s.relation.of };
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
    title: `Fitted curve — ${fit.series}${fit.converged === false ? ' (did not settle)' : ''}`,
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
  name: string,
  pointGroupNames: readonly string[],
  tupleRows: readonly TupleRow[],
  rounder: ValueRounder,
  derivedLabel: string | undefined,
  measurements: readonly MeasurementCsvRow[] = []
): string {
  const doc: Record<string, unknown> = {
    series: [
      {
        name,
        tuples: tupleRows.map((row) => {
          const entry: Record<string, unknown> = {
            category: row.label,
            ...Object.fromEntries(
              pointGroupNames.map((label, i) => {
                const p = row.points[i];
                return [label, p?.data ? rounder.at([p.data[0]!], 0) : null];
              })
            ),
          };
          if (derivedLabel != null && row.derived != null) {
            entry[derivedLabel] = row.derived;
          }
          return entry;
        }),
      },
    ],
  };
  if (measurements.length > 0) {
    doc.measurements = measurements.map((m) => ({ tool: m.tool, value: m.value, unit: m.unit }));
  }
  return JSON.stringify(doc, null, 2);
}
