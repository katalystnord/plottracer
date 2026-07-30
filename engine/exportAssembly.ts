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
  buildTupleSeriesJSON,
  flatDataSection,
  allSeriesSection,
  tupleDataSection,
  histogramSection,
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
    rSquared: fit.rSquared,
    rms: fit.rms,
    n: fit.n,
    // ⚑ The warning the card shows in red has to ride into the file too.
    // Undefined for a polynomial, and stays undefined -- the export writes
    // "n/a" for that rather than claiming it settled.
    converged: fit.converged,
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
  const activeName = session.getDatasetInfos().find((i) => i.active)?.name ?? 'Series 1';
  if (exportShape === 'bins') {
    return buildHistogramJSON(activeName, session.getHistogramBins(), rounder, measures);
  }
  if (exportShape === 'tuples') {
    return buildTupleSeriesJSON(
      activeName,
      session.getSlotNames(),
      session.getTupleRows(),
      rounder,
      session.getConfig().derivedTupleValue?.label,
      measures
    );
  }
  return buildSeriesJSON(scoped, exportFields, measures);
}

/**
 * The section list every non-JSON format renders from: csv/tsv/latex/matlab/
 * python/r as text, .ods and .xlsx as worksheets. Returning SECTIONS rather
 * than a rendered string is what lets one assembly serve all of them.
 */
export function buildExportSections(input: ExportAssemblyInput): TableSection[] {
  const { session, axes, configId, scope, measures } = input;
  const rounder = makeRounder(axes, input.precision);
  const exportFields = session.getExportFields();
  const seriesRows = (index: number) => session.getExportRows(index, input.precision);
  const activeIndex = session.getActiveDatasetIndex();

  const sections: TableSection[] = [];
  const fits: CurveFitExport[] = [];
  const geometries: { series: string; result: GeometryResult | null }[] = [];
  // ⚑ The SHAPE is the session's answer, not a cascade of identity checks here
  // (refactor 2): this used to read `id === 'histogram'`, then a grouped test --
  // a cascade of questions about what a type is CALLED, in the UI, where a
  // wrong branch sent every spider export through the tuple table. What a
  // type's data looks like in a file is a property of the type; only the
  // Bar-with-box-plot-groups case is dynamic, and getExportShape is the one
  // place that knows.
  const exportShape = session.getExportShape();
  if (exportShape === 'bins') {
    sections.push(histogramSection(session.getHistogramBins(), rounder));
  } else if (exportShape === 'tuples') {
    sections.push(
      tupleDataSection(session.getSlotNames(), session.getTupleRows(), rounder, session.getConfig().derivedTupleValue?.label)
    );
  } else if (scope === 'all') {
    const seriesList: SeriesForCSV[] = session.getDatasetInfos().map((info) => {
      const rel = session.getErrorRelation(info.index);
      return { name: info.name, rows: seriesRows(info.index), ...(rel ? { relation: rel } : {}) };
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
    sections.push(flatDataSection(seriesRows(activeIndex), exportFields));
    const f = fitFor(session, activeIndex, info?.name ?? 'Series');
    if (f) fits.push(f);
    const g = geometryFor(session, axes, configId, activeIndex);
    if (g) geometries.push({ series: info?.name ?? 'Series', result: g });
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
  const geoms = geometries.filter(
    (g): g is { series: string; result: GeometryResult } => g.result != null
  );
  if (geoms.length > 0) {
    sections.push(geometrySummarySection(geoms));
    for (const g of geoms) sections.push(geometryTableSection(g.series, g.result, exportFields));
  }
  return sections;
}
