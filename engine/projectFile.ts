/**
 * Project save/load (checkpoint 25, see CLAUDE.md) -- the first way to get
 * anything durable out of the engine/ui rebuild. Everything before this
 * checkpoint could calibrate and place points, but had no way to persist
 * that work or reopen it later.
 *
 * The calibration/dataset half of the file uses core/plotData.ts's
 * SerializedPlotData shape completely unmodified -- serializeProject builds
 * a real PlotData with exactly the session's one axes + one dataset and
 * calls its own serialize(), and deserializeProject calls its own
 * deserialize() right back. This matters for the reason CLAUDE.md's
 * "Two-track architecture" section already flags: the JSON project format
 * is a good data model worth preserving exactly, and reusing PlotData's own
 * (de)serialization here means any future WPD-project-file compatibility
 * work doesn't have to reconcile a second, parallel implementation of the
 * same schema.
 *
 * What's added on top, at this file's own top level (not inside plotData),
 * is `image`: the currently loaded image, embedded as a data URL rather
 * than a file-path reference, so a saved project reopens correctly even if
 * the original image file has moved or the project is opened on a
 * different machine -- consistent with this app's "no cloud dependency,
 * fully offline, self-contained" design goals. Real WPD's own project
 * files bundle the image similarly (inside a .tar archive); this rebuild
 * uses a single JSON file with a base64 data URL instead of a tar
 * container, a deliberate simplification, not an attempt at byte-for-byte
 * compatibility with WPD's own project file *container* format (only the
 * embedded plotData JSON schema is shared, per the paragraph above).
 *
 * Scope, deliberately limited to match CalibrationSession's own single-
 * axes model (checkpoint 30 generalized it to *multiple datasets* under
 * that one axes -- see CalibrationSession's header comment for why "one
 * axes, many series" is the scoped interpretation, not full multi-axes/
 * multi-page support): serializeProject requires a calibrated session and
 * writes one axes plus every one of the session's datasets, each linked
 * back to that same axes (core/plotData.ts's own multi-dataset-per-axes
 * model already supported this natively, by name -- see
 * setAxesForDataset/_deserializeVersion4 -- nothing in plotData.ts itself
 * needed to change for this checkpoint). deserializeProject reads
 * axesColl[0] and *every* datasetColl entry, ignoring anything else a
 * hand-edited or externally-produced project file might contain (e.g. a
 * second axes entry, or measurements -- still out of scope here).
 */

import { PlotData, type SerializedPlotData, type AnyAxes } from '../core/plotData.js';
import type { Dataset } from '../core/dataset.js';
import { GRAPH_TYPE_METADATA_KEY } from './calibrationSession.js';
import type { CalibratedAxes, CalibrationSession } from './calibrationSession.js';

/** A recorded Measure result, flattened for JSON. Additive to the project file
 * (checkpoint 56): older files simply have no `measurements`/`measureScale`, and
 * older readers ignore these keys. Geometry is in image-pixel space, so it
 * re-aligns with the embedded image on reopen.
 *
 * **`value`/`note` are GONE (checkpoint 82), and their absence is the fix.**
 * They held the card's formatted string — `"45.0°"`, `"12.5 px"` — produced by
 * `toPrecision(4)`, and that string was the only copy of the number anywhere.
 * The record is `tool` + `points`, which is everything needed to derive the
 * value (`core/measurementValues.ts`); a stored value would be a second source
 * of truth that goes stale the moment the scale or calibration changes. This is
 * the same reason a dataset stores pixels and not values.
 *
 * `label` stays, but only as the drawing's own text placeholder — the canvas
 * label is re-derived at render, so what is written here is not read back as
 * truth. Our file is ours to shape (tenet 6); a 0.2.0 project simply carries a
 * `value` key nothing reads. */
export interface SerializedMeasurement {
  id: string;
  tool: string;
  points: { x: number; y: number }[];
  closed?: boolean;
  label: string;
  labelAt: { x: number; y: number };
}
export interface SerializedMeasureScale {
  unitPerPx: number;
  unit: string;
}

/** One baked crop, recorded as provenance (checkpoint 95, see
 * docs/project-container-design.md §2). `from{Width,Height}` are the image's
 * dimensions BEFORE this crop and `rect` is the region kept, in that pre-crop
 * image's own pixels. Crops are baked (checkpoint 63 shifts the whole document
 * by the crop origin and discards the outside), so this is a *citation* of
 * where the figure came from — "the top-left panel of the source" — not a
 * recipe to re-crop, which would need the original bytes we no longer keep.
 * Recorded, not inferred: every field is measured off the drag the user made. */
export interface ProvenanceCrop {
  fromWidth: number;
  fromHeight: number;
  rect: { x: number; y: number; width: number; height: number };
}

/** The document a figure was extracted from, when that is not simply the image
 * file itself (checkpoint 97). For a PDF, `name` is the PDF's file name and
 * `page` the 1-based page the figure was rendered from — "paper.pdf · p.4", the
 * citation the design doc (§2/§3) wants. Recorded off the open + the page shown
 * (tenet 9), never inferred. For a plain image the source *is* the image, so
 * `image.fileName` already carries it and this stays absent. */
export interface ProvenanceSource {
  name?: string;
  page?: number;
}

/** Where a figure came from. Deliberately our own top-level project field
 * (tenet 6, our file is ours), NOT WPD's `documentMetadata` file/page-index
 * structure — that models "which of N loaded files does dataset D belong to",
 * the wrong shape for single-figure origin, and forcing it in would be *more*
 * modeling, not less (tenet 10). A container: the `source` document (checkpoint
 * 97) and the `crops` applied (checkpoint 95). Absent in pre-95 files; `source`
 * absent in pre-97 files and for image-sourced figures. */
export interface Provenance {
  source?: ProvenanceSource;
  crops?: ProvenanceCrop[];
}

/** True when a Provenance actually records something -- used to decide whether
 * to write the key at all (omit-when-empty, like measurements). */
function hasProvenance(p: Provenance): boolean {
  const sourced = !!p.source && (p.source.name != null || p.source.page != null);
  return sourced || (!!p.crops && p.crops.length > 0);
}

export interface ProjectFile {
  /** Format marker for this container (image + plotData), versioned
   * independently of plotData's own `version` field. */
  plotTracerProject: 1;
  image: { dataURL: string; fileName?: string };
  plotData: SerializedPlotData;
  /** Measure-tool results + their px->unit scale (checkpoint 56). Optional and
   * additive -- absent in pre-56 files. */
  measurements?: SerializedMeasurement[];
  measureScale?: SerializedMeasureScale | null;
  /** Where the figure came from (checkpoint 95). Optional and additive -- absent
   * in pre-95 files, and omitted entirely when there is nothing to record. */
  provenance?: Provenance;
  /** The bundled source document (checkpoint 104) -- raw bytes, so it lives in
   * the `.zip` container as its own entry, never inlined in the JSON. Present
   * only for PDF-sourced projects that carry their source. */
  sourceDocument?: SourceDocument;
}

export interface DeserializedProject {
  /** AxesTypeConfig.id for the axes type found in the file (e.g. 'xy') --
   * Workspace.tsx uses this to pick which config to build a fresh
   * CalibrationSession from before calling loadCalibrated. */
  configId: string;
  axes: AnyAxes;
  /** Every dataset/series found under that axes, in file order (checkpoint
   * 30) -- always at least one, per deserializeProject's own guard. */
  datasets: Dataset[];
  imageDataURL: string;
  imageFileName?: string;
  /** Measure results + scale (checkpoint 56); empty/null when the file predates
   * them or none were recorded. */
  measurements: SerializedMeasurement[];
  measureScale: SerializedMeasureScale | null;
  /** Where the figure came from (checkpoint 95); `{}` when the file predates it
   * or nothing was recorded. */
  provenance: Provenance;
  /** The bundled SOURCE document (checkpoint 104) -- e.g. the PDF the figure was
   * extracted from -- when the project archive carried one, so the evidence
   * travels with the record (§5). Undefined for a plain-image project or one
   * that predates this. Only the `.zip` reader ever sets it (binary can't live
   * in the JSON path). */
  sourceDocument?: SourceDocument;
}

/** A source document bundled in a project archive (checkpoint 104): the raw
 * bytes plus enough to identify and re-form them. */
export interface SourceDocument {
  name?: string;
  mime: string;
  bytes: Uint8Array;
}

export type ProjectResult<T> = T | { error: string };

/** The exact strings core/plotData.ts's serialize() writes into
 * axesColl[].type for each axes class -- reading this instead of any
 * runtime class/constructor introspection is deliberate: constructor names
 * are not guaranteed to survive minification in a production build (ui/dist
 * is built with Vite/esbuild), while these literal strings are hardcoded,
 * stable data. ImageAxes is omitted: it's not offered as a selectable axes
 * type in Workspace.tsx's AXES_TYPE_CONFIGS (see calibrationSession.ts's
 * header comment), so there's no config id to map it to. */
const AXES_TYPE_STRING_TO_CONFIG_ID: Record<string, string> = {
  XYAxes: 'xy',
  BarAxes: 'bar',
  PolarAxes: 'polar',
  TernaryAxes: 'ternary',
  MapAxes: 'map',
  CircularChartRecorderAxes: 'ccr',
};

/** Builds a project file from a calibrated session. Fails (returns
 * {error}) rather than serializing a half-finished session -- an
 * uncalibrated session has no axes for PlotData.addAxes to attach a
 * dataset to, and saving something that can't be meaningfully reopened
 * would be worse than refusing. */
export function serializeProject<A extends CalibratedAxes>(
  session: CalibrationSession<A>,
  imageDataURL: string,
  imageFileName?: string,
  measures?: { measurements: SerializedMeasurement[]; scale: SerializedMeasureScale | null },
  provenance?: Provenance,
  sourceDocument?: SourceDocument
): ProjectResult<ProjectFile> {
  const axes = session.getAxes();
  if (!axes) return { error: 'Calibrate the axes before saving a project.' };

  const plotData = new PlotData();
  const anyAxes = axes as unknown as AnyAxes;
  plotData.addAxes(anyAxes);
  for (const dataset of session.getDatasets()) {
    plotData.addDataset(dataset);
    plotData.setAxesForDataset(dataset, anyAxes);
  }

  const file: ProjectFile = {
    plotTracerProject: 1,
    image: imageFileName ? { dataURL: imageDataURL, fileName: imageFileName } : { dataURL: imageDataURL },
    plotData: plotData.serialize(),
  };
  if (measures && measures.measurements.length > 0) file.measurements = measures.measurements;
  if (measures && measures.scale) file.measureScale = measures.scale;
  // Omit entirely when nothing was recorded, so a plain image project carries no
  // empty provenance key (same discipline as measurements above).
  if (provenance && hasProvenance(provenance)) file.provenance = provenance;
  // The source document (checkpoint 104) rides on the ProjectFile as raw bytes;
  // serializeProjectZip splits it out into its own archive entry (it is never
  // stringified into project.json).
  if (sourceDocument) file.sourceDocument = sourceDocument;
  return file;
}

/** Reads a parsed project file (JSON.parse output, not yet validated) back
 * into an axes + dataset pair plus enough metadata for Workspace.tsx to
 * pick the right AxesTypeConfig and reload the image. Returns {error} for
 * anything that doesn't look like a PlotTracer project file, rather than
 * throwing -- the caller (a file picked via a native "Open Project"
 * dialog) can't assume the file's contents any more than a real file-open
 * flow ever can. */
export function deserializeProject(raw: unknown): ProjectResult<DeserializedProject> {
  if (typeof raw !== 'object' || raw === null) {
    return { error: 'Not a valid project file.' };
  }
  const data = raw as Partial<ProjectFile>;
  if (data.plotTracerProject !== 1 || !data.plotData || !data.image?.dataURL) {
    return { error: 'Not a valid PlotTracer project file.' };
  }

  const axesEntry = data.plotData.axesColl?.[0];
  const axesType = axesEntry?.type;
  const baseConfigId = axesType ? AXES_TYPE_STRING_TO_CONFIG_ID[axesType] : undefined;
  if (!baseConfigId) {
    return { error: axesType ? `Unsupported axes type in project file: ${axesType}` : 'Project file has no calibrated axes.' };
  }
  // The class name alone no longer identifies the graph type: Histogram
  // serializes as 'XYAxes' too (checkpoint 66 -- see calibrationSession.ts's
  // GRAPH_TYPE_METADATA_KEY for why it must). The axes metadata carries which
  // one it actually was. Falling back to the class-name mapping keeps every
  // project written before this key existed -- and any file produced by
  // upstream WPD or the old wpd-core app, which never write it -- loading
  // exactly as it did, as a plain XY chart.
  const graphType = axesEntry?.metadata?.[GRAPH_TYPE_METADATA_KEY];
  const configId = typeof graphType === 'string' && graphType.length > 0 ? graphType : baseConfigId;

  const plotData = new PlotData();
  const result = plotData.deserialize(data.plotData);
  if (result === false) {
    return { error: 'Failed to parse project data.' };
  }

  const axes = plotData.getAxesColl()[0];
  const datasets = plotData.getDatasets();
  if (!axes || datasets.length === 0) {
    return { error: 'Project file has no calibrated axes or dataset.' };
  }

  return {
    configId,
    axes,
    datasets,
    imageDataURL: data.image.dataURL,
    imageFileName: data.image.fileName,
    measurements: Array.isArray(data.measurements) ? data.measurements : [],
    measureScale: data.measureScale ?? null,
    // Accept only well-formed parts; a hand-edited or pre-95 file with missing
    // or malformed provenance reads back as `{}` (or a partial), never throws.
    provenance: readProvenance(data.provenance),
  };
}

/** Validate a file's `provenance` into a Provenance, dropping anything
 * malformed. Missing/garbage -> `{}`. Keeps deserializeProject tolerant of
 * hand-edited or foreign files, same posture as the rest of that function. */
function readProvenance(raw: unknown): Provenance {
  if (!raw || typeof raw !== 'object') return {};
  const p = raw as { source?: unknown; crops?: unknown };
  const out: Provenance = {};
  if (p.source && typeof p.source === 'object') {
    const s = p.source as { name?: unknown; page?: unknown };
    const source: ProvenanceSource = {};
    if (typeof s.name === 'string') source.name = s.name;
    if (typeof s.page === 'number' && Number.isFinite(s.page)) source.page = s.page;
    if (source.name != null || source.page != null) out.source = source;
  }
  // Validate each crop element (checkpoint 100, audit T5): a shallow
  // Array.isArray was letting `[null]` / `["x"]` through, then the status-bar
  // render read `.fromWidth` off a non-object and threw -- breaking this
  // function's own "never throws" contract. Drop malformed entries.
  if (Array.isArray(p.crops)) {
    const crops = p.crops.filter(isValidCrop);
    if (crops.length > 0) out.crops = crops;
  }
  return out;
}

function isValidCrop(c: unknown): c is ProvenanceCrop {
  const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  if (!c || typeof c !== 'object') return false;
  const crop = c as { fromWidth?: unknown; fromHeight?: unknown; rect?: unknown };
  if (!num(crop.fromWidth) || !num(crop.fromHeight) || !crop.rect || typeof crop.rect !== 'object') return false;
  const r = crop.rect as { x?: unknown; y?: unknown; width?: unknown; height?: unknown };
  return num(r.x) && num(r.y) && num(r.width) && num(r.height);
}

// === Multi-figure projects (checkpoint 115, design §5/§7) ==================
//
// A project can hold several FIGURES (design §1: one figure = image +
// calibration + N series + measurements). The container that carries them is
// deliberately built ON TOP of the single-figure path, not beside it: each
// figure serializes through the same serializeProject/deserializeProject the
// single-figure save already uses, and this layer only assembles them into an
// array plus a shared source. So a multi-figure project is N single-figure
// projects with one shared source document -- no second data model.

/** One figure inside a multi-figure project: a single-figure ProjectFile's
 * payload (minus the format marker and the per-file source, which becomes
 * shared) plus the figure's NAME (design §5a -- its address in the jumper). */
export interface FigureFile {
  name: string;
  image: { dataURL: string; fileName?: string };
  plotData: SerializedPlotData;
  measurements?: SerializedMeasurement[];
  measureScale?: SerializedMeasureScale | null;
  provenance?: Provenance;
}

export interface MultiFigureProjectFile {
  plotTracerProject: 1;
  /** Discriminates a multi-figure project from a single one: the single format
   * has a top-level `image`/`plotData`, this has `figures`. The reader checks
   * for this array (see deserializeProjectContainer). */
  figures: FigureFile[];
  /** Which figure is active on reopen (clamped into range on read). */
  activeFigure: number;
  /** The paged source these figures were captured from (design §5/§8) -- stored
   * ONCE and shared, since the common case is several figures from one PDF. Raw
   * bytes, so the `.zip` container splits it into its own entry. */
  sourceDocument?: SourceDocument;
}

export interface DeserializedFigure extends DeserializedProject {
  name: string;
}

export interface DeserializedMultiFigureProject {
  figures: DeserializedFigure[];
  activeFigure: number;
  /** The shared source document, when the project carried one (the `.zip`
   * reader restores the bytes). */
  sourceDocument?: SourceDocument;
}

/** True when a parsed project.json is the multi-figure shape rather than the
 * single-figure one -- the whole discriminator is "does it have a figures
 * array". Lets one open path route both. */
export function isMultiFigureProject(raw: unknown): boolean {
  return typeof raw === 'object' && raw !== null && Array.isArray((raw as { figures?: unknown }).figures);
}

/** Assemble a multi-figure project from N calibrated figures. Each figure goes
 * through serializeProject, so an uncalibrated one fails here exactly as it
 * would in a single-figure save -- named, so the user knows which. */
export function serializeMultiFigureProject(
  figures: ReadonlyArray<{
    name: string;
    session: CalibrationSession<CalibratedAxes>;
    imageDataURL: string;
    imageFileName?: string;
    measures?: { measurements: SerializedMeasurement[]; scale: SerializedMeasureScale | null };
    provenance?: Provenance;
  }>,
  activeFigure: number,
  sourceDocument?: SourceDocument
): ProjectResult<MultiFigureProjectFile> {
  if (figures.length === 0) return { error: 'No figures to save.' };
  const out: FigureFile[] = [];
  for (const f of figures) {
    const single = serializeProject(f.session, f.imageDataURL, f.imageFileName, f.measures, f.provenance);
    if ('error' in single) return { error: `Can't save "${f.name}" — ${single.error}` };
    const fig: FigureFile = { name: f.name, image: single.image, plotData: single.plotData };
    if (single.measurements) fig.measurements = single.measurements;
    if (single.measureScale) fig.measureScale = single.measureScale;
    if (single.provenance) fig.provenance = single.provenance;
    out.push(fig);
  }
  const clampedActive = activeFigure >= 0 && activeFigure < out.length ? activeFigure : 0;
  const result: MultiFigureProjectFile = { plotTracerProject: 1, figures: out, activeFigure: clampedActive };
  if (sourceDocument) result.sourceDocument = sourceDocument;
  return result;
}

/** Read a multi-figure project back into per-figure DeserializedProjects (each
 * via the single-figure deserializeProject, so the two paths converge). The
 * shared source is attached by the `.zip` reader, not here (bytes can't live in
 * the JSON). */
export function deserializeMultiFigureProject(raw: unknown): ProjectResult<DeserializedMultiFigureProject> {
  if (typeof raw !== 'object' || raw === null) return { error: 'Not a valid project file.' };
  const data = raw as Partial<MultiFigureProjectFile>;
  if (data.plotTracerProject !== 1 || !Array.isArray(data.figures) || data.figures.length === 0) {
    return { error: 'Not a valid multi-figure PlotTracer project.' };
  }
  const figures: DeserializedFigure[] = [];
  for (const f of data.figures) {
    const single = deserializeProject({
      plotTracerProject: 1,
      image: f.image,
      plotData: f.plotData,
      measurements: f.measurements,
      measureScale: f.measureScale,
      provenance: f.provenance,
    });
    if ('error' in single) return { error: `Figure "${typeof f.name === 'string' && f.name ? f.name : '?'}" — ${single.error}` };
    figures.push({ ...single, name: typeof f.name === 'string' && f.name ? f.name : `Figure ${figures.length + 1}` });
  }
  const active = typeof data.activeFigure === 'number' && data.activeFigure >= 0 && data.activeFigure < figures.length ? data.activeFigure : 0;
  return { figures, activeFigure: active };
}
