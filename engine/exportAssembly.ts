/**
 * Assembling one export.
 *
 * Every non-JSON format (csv/tsv/latex/matlab/python/r AND the two spreadsheet
 * binaries) is built from one list of SECTIONS -- the record's table, then the
 * measurements and each curve fit and each geometry run as their own separate
 * blocks (David; tenet 9: a derived thing is never mixed into the record).
 * JSON is the one format with its own shape.
 *
 * This module holds that assembly and nothing else. It is PURE: it reads the
 * session and returns a payload, and it never touches the clipboard, the save
 * dialog, the unsaved-work flag or any React state. Those decisions -- which
 * renderer to hand the sections to, where the bytes go -- stay with the caller
 * (`ui/src/Workspace.tsx`'s `exportData`).
 *
 * ⚑ WHY IT LIVES HERE rather than in the component. Every section builder it
 * calls is already an engine module (csvExport, curveFitPanel, geometryPanel),
 * so this is the orchestration that belongs beside them. Inside Workspace.tsx
 * it was reachable ONLY through the Electron e2e suite -- ~18 minutes per run
 * to learn whether an export still holds its shape. Here it is reachable by an
 * ordinary unit test.
 */
import type { CalibrationSession, CalibratedAxes } from './calibrationSession.js';
import type { AnyAxes } from '../core/plotData.js';
import { makeRounder, type PrecisionMode } from '../core/exportPrecision.js';
import { getCurveFitState, sampleCurveFitLine, formatCurveFitEquation } from './curveFitPanel.js';
import { runGeometry, getGeometryState } from './geometryPanel.js';
import {
  buildSeriesJSON,
  buildHistogramJSON,
  buildHeatmapJSON,
  buildTupleSeriesJSON,
  flatDataSection,
  type SeriesErrorColumns,
  allSeriesSection,
  tupleDataSection,
  histogramSection,
  heatmapCellsSection,
  heatmapKeySection,
  heatmapMatrixAxesSection,
  heatmapMatrixSection,
  type HeatmapKeyExport,
  type HeatmapExportCell,
  measurementsSection,
  curveFitSummarySection,
  fittedCurveSection,
  geometrySummarySection,
  geometryTableSection,
  type SeriesForCSV,
  type CurveFitExport,
  type MeasurementCsvRow,
} from './csvExport.js';
import type { TableSection } from './tableFormats.js';
import type { GeometryResult } from '../algorithms/geometry.js';

/** Which series an export covers: the active one, or every one. */
export type ExportScope = 'active' | 'all';

export interface ExportAssemblyInput {
  session: CalibrationSession<CalibratedAxes>;
  /** The session's axes, already null-checked by the caller -- an uncalibrated
   * figure is refused before we get here, with a message the user can act on. */
  axes: CalibratedAxes;
  /** The axes-type id whose rules this export follows -- geometry is XY-only.
   * It is `session.getConfig().id`; passing it makes the gate an argument the
   * tests can vary, which is the only way to tell a working gate from one that
   * never fires (see the geometry block in the tests). */
  configId: string;
  scope: ExportScope;
  /** Round to the figure's own resolution, or write full precision (v1.0). */
  precision: PrecisionMode;
  /** Raw measurement numbers + units (checkpoint 82), never a formatted string
   * -- the caller resolves these from its own recorded overlays. */
  measures: readonly MeasurementCsvRow[];
  /**
   * A heatmap's cells (v2.2), supplied by the caller.
   *
   * ⚑ EVERY OTHER SHAPE READS ITS ROWS OFF THE DATASETS; this one cannot. A
   * heatmap's values are read from the IMAGE through the grid, and neither the
   * image nor the reading lives in the session - so the cells arrive the same
   * way `measures` does, resolved by the caller that has them. Absent or empty
   * means the user has not pressed Read cells yet, and the export says so
   * rather than writing an empty table that looks like an empty figure.
   */
  heatmapCells?: readonly HeatmapExportCell[];
  /** The colour key's own extent - the third axis's span. Absent when the key
   * could not be read, in which case nothing is written rather than a guess. */
  heatmapKey?: HeatmapKeyExport;
}

/**
 * A curve fit ready to export (v0.8): the model (equation + coefficients), its
 * goodness-of-fit, and a dense sampling of the fitted curve in DATA space.
 * Null when a series has no stored fit -- fits are XY-only, so a
 * grouped/histogram series simply contributes no fit block.
 */
function fitFor(
  session: CalibrationSession<CalibratedAxes>,
  index: number,
  name: string
): CurveFitExport | null {
  const ds = session.getDatasets()[index];
  if (!ds) return null;
  const fit = getCurveFitState(ds);
  if (!fit) return null;
  return {
    series: name,
    model: fit.model ?? 'polynomial',
    degree: fit.degree,
    equation: formatCurveFitEquation(fit),
    coefficients: fit.coefficients,
    ...(fit.rSquared === undefined ? {} : { rSquared: fit.rSquared }),
    rms: fit.rms,
    n: fit.n,
    // ⚑ The warning the card shows in red has to ride into the file too.
    // ABSENT for a polynomial, and stays absent -- the export writes "n/a" for
    // that rather than claiming it settled. Reading a missing key still gives
    // undefined, so every consumer of this block is unaffected.
    ...(fit.converged === undefined ? {} : { converged: fit.converged }),
    samples: sampleCurveFitLine(fit, 100).map((p) => ({ x: p.x, y: p.y })),
  };
}

/** Geometry for a series (v1.1), if it's ON and can compute -- a derived block
 * exported separately from the record, like the fit. */
function geometryFor(
  session: CalibrationSession<CalibratedAxes>,
  axes: CalibratedAxes,
  configId: string,
  index: number
): GeometryResult | null {
  const ds = session.getDatasets()[index];
  if (!ds || configId !== 'xy') return null;
  const gs = getGeometryState(ds);
  if (!gs) return null;
  const r = runGeometry(ds, axes as unknown as AnyAxes, gs.closed);
  return 'geometry' in r ? r.geometry : null;
}

/**
 * The JSON export: pixel-free series objects, each carrying whatever derived
 * blocks it owns. JSON is the one format with a shape of its own -- every other
 * format is built from `buildExportSections` below.
 */
export function buildExportJson(input: ExportAssemblyInput): string {
  const { session, axes, configId, scope, measures } = input;
  const rounder = makeRounder(axes, input.precision);
  const exportFields = session.getExportFields();
  const seriesRows = (index: number) => session.getExportRows(index, input.precision);
  const activeIndex = session.getActiveDatasetIndex();

  const infos = session.getDatasetInfos();
  const all: SeriesForCSV[] = infos.map((info) => {
    const rel = session.getErrorRelation(info.index);
    const fit = fitFor(session, info.index, info.name);
    const geom = geometryFor(session, axes, configId, info.index);
    return {
      name: info.name,
      rows: seriesRows(info.index),
      // An error series exports as an ordinary series carrying its relation
      // (checkpoint 77) -- which is what it is. Omitted for everything else.
      ...(rel ? { relation: rel } : {}),
      ...(rel ? { deltas: session.getErrorCapDeltas(info.index, input.precision) } : {}),
      ...errorColumnsFor(session, info.index, input.precision),
      ...(fit ? { fit } : {}),
      ...(geom ? { geometry: geom } : {}),
    };
  });
  const scoped = scope === 'all' ? all : [all[activeIndex]!];
  // ⚑ v2.0: generalized off getExportShape() rather than `id === 'histogram'`
  // -- the same fix buildExportSections already made for CSV/TSV/etc (see its
  // own comment). Before this, ANY grouped/tuple-shaped type other than
  // histogram (Pie today; Box Plot and Bar in v2.0) fell through to
  // buildSeriesJSON and exported its raw per-point clicks with no hint they
  // belonged to the same tuple, and no derived value at all -- a known,
  // now-fixed gap, not a deliberate scope limit.
  //
  // Both 'bins' and 'tuples' only export the ACTIVE series (the Active/All
  // toggle is hidden for grouped types, so nothing on screen claims
  // otherwise) -- tracked as a known limitation rather than papered over:
  // fixing it properly means getHistogramBins(datasetIndex)/
  // getTupleRows(datasetIndex).
  const exportShape = session.getExportShape();
  // v2.0 pre-launch audit: was a fabricated 'Series 1' fallback for the
  // (should-never-happen) case of no active dataset -- the same
  // invented-name shape as the Bar0/Slice0 defect fixed elsewhere. If this
  // invariant is ever violated, blank is the honest answer, not a name that
  // could be confused for a real series someone captured.
  const activeName = session.getDatasetInfos().find((i) => i.active)?.name ?? '';
  if (exportShape === 'heatmap') {
    return buildHeatmapJSON(input.heatmapCells ?? [], measures, input.heatmapKey);
  }
  if (exportShape === 'bins') {
    return buildHistogramJSON(
      activeName,
      session.getHistogramBins(),
      rounder,
      measures,
      errorColumnsByTuple(session, activeIndex, input.precision).error
    );
  }
  if (exportShape === 'tuples') {
    // ⚑ EVERY series when the scope says all. This used to pass only the
    // active one, so a grouped or stacked Bar chart -- v2.0's headline --
    // exported ONE series to all nine formats while the shared table on
    // screen showed them all, and the Active/All toggle was hidden for
    // tuple shapes so nothing offered a way to get the rest. That is the
    // same active-series-only defect `AxesTypeConfig.exportShape`'s own doc
    // records as the v1.4 spider export bug. (Round-2 audit.)
    // ⚑ The error columns on BOTH branches, exactly as the CSV path does - the
    // shared accessor's own doc says "one answer, so a column cannot exist on
    // screen and be missing from the file", and this was the caller that did not
    // ask (F26). ⚑ The BY-TUPLE variant, because a tuple series' rows ARE its
    // tuples (F41).
    const tupleSeries =
      scope === 'all'
        ? infos.map((info) => ({
            name: info.name,
            rows: session.getTupleRows(info.index),
            ...errorColumnsByTuple(session, info.index, input.precision),
          }))
        : [{ name: activeName, rows: session.getTupleRows(), ...errorColumnsByTuple(session, activeIndex, input.precision) }];
    return buildTupleSeriesJSON(
      tupleSeries,
      session.getSlotNames(),
      rounder,
      session.getConfig().derivedTupleValue?.label,
      measures,
      session.getConfig().intervalSlots,
      session.getConfig().measuredFromFigureOrigin
    );
  }
  return buildSeriesJSON(scoped, exportFields, measures);
}

/**
 * The section list every non-JSON format renders from: csv/tsv/latex/matlab/
 * python/r as text, .ods and .xlsx as worksheets. Returning SECTIONS rather
 * than a rendered string is what lets one assembly serve all of them.
 */
/**
 * A series' own per-datum extents, in the shape the CSV layer takes - or
 * nothing at all when it carries no error, so an ordinary series exports
 * byte-for-byte as it did before.
 *
 * ⚑ Both export paths go through here, because they are the same question. The
 * on-screen panel asks `getErrorColumns` too: one answer, so a column cannot
 * exist on screen and be missing from the file.
 *
 * ⚑⚑ EXPORTED, because a claim about the screen has to be enforceable from the
 * screen. The comment above has said "one answer" since B4 while the bins panel
 * asked nothing at all - a histogram's caps were captured, drawn on the canvas,
 * and then reported by neither the table nor any of the nine formats. That is
 * gate 3 in CLAUDE.md: a comment asserting what the design requires, above code
 * that does not do it. `HistogramBinsTable` now takes its columns from this
 * function, so the two views cannot answer differently. (v2.3 re-audit, F27.)
 */
export function errorColumnsFor(
  session: ExportAssemblyInput['session'],
  index: number,
  /** ⚑ The export's own precision, threaded so a cap is reported to the same
   * resolution as the reading it qualifies - see `roundErrorAt`. Defaulted so a
   * caller with no precision of its own (the panel) gets the figure's. */
  precision: PrecisionMode = 'auto'
): { error?: SeriesErrorColumns } {
  const labels = session.getErrorColumns(index).map((c) => c.label);
  if (labels.length === 0) return {};
  return {
    error: {
      labels,
      values: session.getErrorRows(index, precision),
      deltas: session.getErrorDeltaRows(index, precision),
    },
  };
}

/**
 * The same columns, indexed BY TUPLE - for every table whose rows are tuples
 * (bar, box plot, pie, histogram bins) rather than datum rows (F41).
 *
 * ⚑⚑ NOT A SECOND SOURCE OF TRUTH: the labels and the readings come from the
 * same three session accessors, and the ONLY difference is which index the rows
 * are filed under. It is a separate function rather than a flag because a caller
 * must state which alignment its rows have - a boolean would be answered wrong
 * exactly once, silently, and the wrongness is a number under the wrong row.
 */
export function errorColumnsByTuple(
  session: ExportAssemblyInput['session'],
  index: number,
  /** See `errorColumnsFor`. */
  precision: PrecisionMode = 'auto'
): { error?: SeriesErrorColumns } {
  const labels = session.getErrorColumns(index).map((c) => c.label);
  if (labels.length === 0) return {};
  const blank = labels.map(() => null);
  return {
    error: {
      labels,
      // ⚑ A hole becomes a row of nulls at the boundary, because
      // `SeriesErrorColumns` is what the renderers take and they read "no value"
      // per cell. The distinction the session keeps (a tuple that recorded
      // NOTHING) has no column to live in once the table is drawn.
      values: session.getErrorRowsByTuple(index, precision).map((r) => r ?? blank),
      deltas: session.getErrorDeltaRowsByTuple(index, precision).map((r) => r ?? blank),
    },
  };
}

export function buildExportSections(input: ExportAssemblyInput): TableSection[] {
  const { session, axes, configId, scope, measures } = input;
  const rounder = makeRounder(axes, input.precision);
  const exportFields = session.getExportFields();
  const seriesRows = (index: number) => session.getExportRows(index, input.precision);
  const activeIndex = session.getActiveDatasetIndex();

  const sections: TableSection[] = [];
  const fits: CurveFitExport[] = [];
  // ⚑ Non-null, and it is the push sites that make it true: both are guarded by
  // `if (g)`. Declaring it nullable and filtering the nulls out again at the end
  // put a second gate behind the first, so neither could be shown to matter --
  // the same mutual masking the geometry panel's doubled refusal had.
  const geometries: { series: string; result: GeometryResult }[] = [];
  // ⚑ The SHAPE is the session's answer, not a cascade of identity checks here
  // (refactor 2): this used to read `id === 'histogram'`, then a grouped test --
  // a cascade of questions about what a type is CALLED, in the UI, where a
  // wrong branch sent every spider export through the tuple table. What a
  // type's data looks like in a file is a property of the type; only the
  // Bar-with-box-plot-groups case is dynamic, and getExportShape is the one
  // place that knows.
  const exportShape = session.getExportShape();
  if (exportShape === 'heatmap') {
    // ⚑ The record FIRST, the convenience view second. A reader opening the file
    // meets the long form - bounds, centre, value and the evidence for it -
    // before the pivoted matrix, which is derived from it.
    const cells = input.heatmapCells ?? [];
    sections.push(heatmapCellsSection(cells, rounder));
    // ⚑⚑ THE BOUNDARIES IMMEDIATELY BEFORE THE VALUES THEY BOUND (A5). A
    // generator's three arguments are X, Y and C, so they are adjacent here
    // rather than one of them being left to re-derive from the long form:
    // `pcolormesh` with `shading='flat'` refuses the centres the matrix header
    // carries, so the matrix alone was the one block whose coordinate form its
    // own consumer rejects.
    sections.push(heatmapMatrixAxesSection(cells));
    sections.push(heatmapMatrixSection(cells));
    // ⚑ Last, because it describes the FIGURE rather than the data - a reader
    // scanning for values meets those first.
    if (input.heatmapKey) sections.push(heatmapKeySection(input.heatmapKey));
  } else if (exportShape === 'bins') {
    sections.push(histogramSection(session.getHistogramBins(), rounder, errorColumnsByTuple(session, activeIndex, input.precision).error));
  } else if (exportShape === 'tuples') {
    // One titled block per series when the scope says all -- see buildExportJson's
    // note. A single series keeps its untitled block, so existing files are
    // byte-identical.
    const derivedLabel = session.getConfig().derivedTupleValue?.label;
    const slots = session.getSlotNames();
    const infosForScope = scope === 'all' ? session.getDatasetInfos() : [];
    if (infosForScope.length > 1) {
      for (const info of infosForScope) {
        const block = tupleDataSection(
          slots,
          session.getTupleRows(info.index),
          rounder,
          derivedLabel,
          errorColumnsByTuple(session, info.index, input.precision).error,
          session.getConfig().intervalSlots,
          session.getConfig().measuredFromFigureOrigin
        );
        sections.push({ ...block, title: info.name });
      }
    } else {
      sections.push(
        tupleDataSection(
          slots,
          session.getTupleRows(),
          rounder,
          derivedLabel,
          errorColumnsByTuple(session, activeIndex, input.precision).error,
          session.getConfig().intervalSlots,
          session.getConfig().measuredFromFigureOrigin
        )
      );
    }
  } else if (scope === 'all') {
    const seriesList: SeriesForCSV[] = session.getDatasetInfos().map((info) => {
      const rel = session.getErrorRelation(info.index);
      return {
        name: info.name,
        rows: seriesRows(info.index),
        ...(rel ? { relation: rel, deltas: session.getErrorCapDeltas(info.index, input.precision) } : {}),
        ...errorColumnsFor(session, info.index, input.precision),
      };
    });
    sections.push(allSeriesSection(seriesList, exportFields));
    for (const info of session.getDatasetInfos()) {
      const f = fitFor(session, info.index, info.name);
      if (f) fits.push(f);
      const g = geometryFor(session, axes, configId, info.index);
      if (g) geometries.push({ series: info.name, result: g });
    }
  } else {
    const info = session.getDatasetInfos().find((i) => i.index === activeIndex);
    sections.push(
      flatDataSection(
        seriesRows(activeIndex),
        exportFields,
        errorColumnsFor(session, activeIndex, input.precision).error
      )
    );
    // ⚑ Blank, not 'Series'. The v2.0 audit removed this fabricated fallback
    // from the JSON path and left it here, one function below -- and this is
    // the assembly every NON-JSON format renders through, so the invented name
    // rode into the CSV/ODS/XLSX curve-fit and geometry blocks and into the
    // sheet title. Same defect, same file, missed by grep because the earlier
    // fix searched for 'Series 1'. (Round-2 audit.)
    const f = fitFor(session, activeIndex, info?.name ?? '');
    if (f) fits.push(f);
    const g = geometryFor(session, axes, configId, activeIndex);
    if (g) geometries.push({ series: info?.name ?? '', result: g });
  }
  if (measures.length > 0) sections.push(measurementsSection(measures));
  // Curve fits as their own SEPARATE blocks (David): a summary of every fit,
  // then each fitted curve's samples -- never mixed into the data.
  if (fits.length > 0) {
    sections.push(curveFitSummarySection(fits));
    for (const f of fits) sections.push(fittedCurveSection(f, exportFields));
  }
  // Geometry the same way (v1.1): a summary block, then each series'
  // per-point cumulative-length / curvature table -- both derived, separate.
  if (geometries.length > 0) {
    sections.push(geometrySummarySection(geometries));
    for (const g of geometries) sections.push(geometryTableSection(g.series, g.result, exportFields));
  }
  return sections;
}
