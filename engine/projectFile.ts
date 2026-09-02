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

import { PlotData, type SerializedPlotData, type AnyAxes, type SerializedHeatmapLayer } from '../core/plotData.js';
import { CategoryAxis } from '../core/categoryAxis.js';
import type { Dataset } from '../core/dataset.js';
import { BarAxes } from '../core/axes/bar.js';
import { barSeating } from '../core/barInterval.js';
import { GRAPH_TYPE_METADATA_KEY } from './calibrationSession.js';
import type { CalibratedAxes, CalibrationSession } from './calibrationSession.js';

/** A recorded Measure result, flattened for JSON. Additive to the project file
 * (checkpoint 56): older files simply have no `measurements`/`measureScale`, and
 * older readers ignore these keys. Geometry is in image-pixel space, so it
 * re-aligns with the embedded image on reopen.
 *
 * **`value`/`note` are GONE (checkpoint 82), and their absence is the fix.**
 * They held the card's formatted string - `"45.0°"`, `"12.5 px"` - produced by
 * `toPrecision(4)`, and that string was the only copy of the number anywhere.
 * The record is `tool` + `points`, which is everything needed to derive the
 * value (`core/measurementValues.ts`); a stored value would be a second source
 * of truth that goes stale the moment the scale or calibration changes. This is
 * the same reason a dataset stores pixels and not values.
 *
 * `label` stays, but only as the drawing's own text placeholder - the canvas
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
  /**
   * The colour a Colour measurement read (v2.3, theme C) - absent for every
   * other tool, and for any file written before the instrument existed.
   *
   * ⚑ STORED, unlike every other measured quantity here, and for a reason the
   * record cares about: a colour is the READING itself rather than a value
   * derived from geometry, and re-sampling it on load would hand back whatever
   * the image says NOW - after a grid removal, an enhancement, or a crop that
   * moved the ink. The value it implies is still derived, through the key.
   */
  rgb?: readonly [number, number, number];
}
export interface SerializedMeasureScale {
  unitPerPx: number;
  unit: string;
}

/** One baked crop, recorded as provenance (checkpoint 95).
 * `from{Width,Height}` are the image's
 * dimensions BEFORE this crop and `rect` is the region kept, in that pre-crop
 * image's own pixels. Crops are baked (checkpoint 63 shifts the whole document
 * by the crop origin and discards the outside), so this is a *citation* of
 * where the figure came from - "the top-left panel of the source" - not a
 * recipe to re-crop, which would need the original bytes we no longer keep.
 * Recorded, not inferred: every field is measured off the drag the user made. */
export interface ProvenanceCrop {
  fromWidth: number;
  fromHeight: number;
  rect: { x: number; y: number; width: number; height: number };
}

/** The document a figure was extracted from, when that is not simply the image
 * file itself (checkpoint 97). For a PDF, `name` is the PDF's file name and
 * `page` the 1-based page the figure was rendered from - "paper.pdf · p.4", the
 * citation the design doc (§2/§3) wants. Recorded off the open + the page shown
 * (tenet 9), never inferred. For a plain image the source *is* the image, so
 * `image.fileName` already carries it and this stays absent. */
export interface ProvenanceSource {
  name?: string;
  page?: number;
}

/** Where a figure came from. Deliberately our own top-level project field
 * (tenet 6, our file is ours), NOT WPD's `documentMetadata` file/page-index
 * structure - that models "which of N loaded files does dataset D belong to",
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

/** Which build wrote a project file, and when.
 *
 * ⚑ DIAGNOSTICS, NOT A MIGRATION MECHANISM. Migrations branch on
 * `plotTracerProject` (the format marker) -- that is what it is for. NOTHING in
 * the load path may branch on `appVersion`: scattered semver comparisons in a
 * reader are exactly the mess the format marker exists to prevent.
 *
 * What it IS for is retroactive identification -- answering "which files could
 * be affected by this?" about a defect the format marker cannot see, because the
 * shape never changed. The standing example is the error-bar rework: once a cap
 * records whether it was MEASURED or app-MIRRORED, every file written before it
 * is silently ambiguous, and without a stamp there is no way to tell which files
 * those are. A stamp cannot fix them; it can tell a future migration which ones
 * to treat as suspect.
 *
 * Both fields are supplied by the CALLER rather than read in here: `ui/` owns
 * the Vite-injected `__APP_VERSION__` (engine/ is framework-agnostic and cannot
 * see it), and passing the timestamp in keeps this function pure and its tests
 * deterministic. */
export interface ProjectStamp {
  /** The PlotTracer version that wrote the file, e.g. "1.3.0". */
  appVersion?: string;
  /** ISO-8601 instant the file was written. */
  savedAt?: string;
}

export interface ProjectFile {
  /** Format marker for this container (image + plotData), versioned
   * independently of plotData's own `version` field. */
  plotTracerProject: 1;
  /** Who wrote this file and when (see ProjectStamp). Optional and additive --
   * absent in every file written before v1.4, which is precisely why it had to
   * be added before more of them existed: a file already on disk can never be
   * retro-stamped. */
  appVersion?: string;
  savedAt?: string;
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
  /** The file's own canonical category list (v2.0) -- pass straight to
   * loadCalibrated so a reopened bar/box-plot project keeps its categories'
   * SHARED identity (renaming one still propagates), not just their names.
   * A fresh empty CategoryAxis for any file that predates this or a session
   * whose graph type never uses one. */
  categoryAxis: CategoryAxis;
  /** The heatmap's RECORD (v2.2) - its grid, its axis names and the cells a
   * person read themselves. Pass straight to `loadCalibrated`. Null for every
   * type that is not a heatmap and for a heatmap whose grid was never read;
   * it is a LAYER on the calibration, never part of it. */
  heatmapLayer: SerializedHeatmapLayer | null;
  imageDataURL: string;
  imageFileName?: string;
  /** Measure results + scale (checkpoint 56); empty/null when the file predates
   * them or none were recorded. */
  measurements: SerializedMeasurement[];
  measureScale: SerializedMeasureScale | null;
  /**
   * What the app did to this project on the way in, in plain words - shown, not
   * logged. Absent for the ordinary open, which is nearly every open.
   *
   * ⚑ It borrows the surface a foreign IMPORT already uses (`projectNotice`,
   * *"what an import could not carry across ... NOT an error - the figure
   * opened"*), because it is the same kind of sentence about our own files:
   * the figure opened, and something about it is not what the file said.
   */
  notice?: string;
  /** Where the figure came from (checkpoint 95); `{}` when the file predates it
   * or nothing was recorded. */
  provenance: Provenance;
  /** Which build wrote the file, and when (see ProjectStamp). Undefined for any
   * file written before v1.4, and for each figure of a multi-figure project --
   * there the stamp is written ONCE at the top level, not per figure. */
  appVersion?: string;
  savedAt?: string;
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
  SpiderAxes: 'spider',
  PieAxes: 'pie',
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
  sourceDocument?: SourceDocument,
  stamp?: ProjectStamp
): ProjectResult<ProjectFile> {
  const axes = session.getAxes();
  if (!axes) return { error: 'Calibrate the axes before saving a project.' };

  const plotData = new PlotData();
  const anyAxes = axes as unknown as AnyAxes;
  plotData.addAxes(anyAxes);
  const categoryAxis = session.getCategoryAxis();
  // v2.0: written only when it actually holds something -- unlike
  // captureState/restoreState's undo snapshot (never touches disk, so
  // "unconditional, costs nothing" is true there), a SAVED file follows this
  // module's own "omit entirely when nothing recorded" discipline (see
  // measurements/provenance/sourceDocument below): every plain XY project
  // ever written had no categoryAxisColl key, and staying byte-identical for
  // every session that never used one matters more here than in memory.
  // (This WAS forgotten entirely at first -- see loadCalibrated's own
  // comment on the "round-trips a Box Plot session" test that caught it.)
  const hasCategoryAxis = categoryAxis.getCategoryCount() > 0;
  if (hasCategoryAxis) plotData.addCategoryAxis(categoryAxis);
  // ⚑ The heatmap's RECORD - its grid, its axis names and the cells a person
  // read themselves. A LAYER on top of the calibration (David, 2026-08-16), so
  // it travels beside the category axis rather than inside the axes' metadata,
  // and it follows the same omit-when-empty discipline: null for every type
  // that is not a heatmap, so no other project's file changes at all.
  plotData.setHeatmapLayer(session.getHeatmapLayer());
  for (const dataset of session.getDatasets()) {
    plotData.addDataset(dataset);
    plotData.setAxesForDataset(dataset, anyAxes);
    if (hasCategoryAxis) plotData.setCategoryAxisForDataset(dataset, categoryAxis);
  }

  const file: ProjectFile = {
    plotTracerProject: 1,
    image: imageFileName ? { dataURL: imageDataURL, fileName: imageFileName } : { dataURL: imageDataURL },
    plotData: plotData.serialize(),
  };
  // Omit-when-absent, like every additive key below: a caller that passes no
  // stamp writes a file byte-identical to a pre-v1.4 one.
  if (stamp?.appVersion) file.appVersion = stamp.appVersion;
  if (stamp?.savedAt) file.savedAt = stamp.savedAt;
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
/**
 * ⚑⚑ A SAVED BAR CHART WHOSE BARS ALL FLOAT OPENS AS A SPAN CHART - AND SAYS SO
 * (v2.5, David's call).
 *
 * Bar lost floating to the Span chart, so a file full of floating bars declares
 * a type that can no longer report it: every row would come back with no value.
 * The RECORD needs nothing - a span stores the same two measured corners a bar
 * always did, which is why `samples/bar-floating-temperature` changed type with
 * its committed truth file untouched - so the honest move is to open it as what
 * it is.
 *
 * ⚠️ AND TO SAY SO, WHICH IS THE HALF THAT IS EASY TO SKIP. This reads the type
 * off the PIXELS' arrangement rather than off what the file declares, and that
 * is a judgement the app is making on the user's behalf. I flagged exactly that
 * when it was decided; David chose it anyway, so the notice is not decoration -
 * it is the part that keeps an inference from passing as a fact. A silent
 * relabel would be the app quietly disagreeing with the file.
 *
 * ⚑ ONE SEATED BAR AND IT STAYS A BAR CHART. A figure where most bars sit down
 * and one floats is a bar chart with one unreadable bar, which the panel's own
 * notice already explains; only ALL of them floating says the file was written
 * under a model that has since split.
 *
 * ⚑ A STACKED figure is excluded, and it matters more since v2.5: a stack's
 * segments do not touch the baseline BY CONSTRUCTION, so every stacked bar chart
 * would otherwise be relabelled on open. (Its `isStacked` only survives the save
 * as of this same release - see `core/plotData.ts`.)
 *
 * ⚑ HALF-DRAGGED BARS ARE PASSED OVER rather than counted either way: a tuple
 * with one corner says nothing about where the other one would have landed.
 *
 * ⚑ THE WPD IMPORT DOOR NEEDS NO COPY OF THIS, and the reason is the model, not
 * an oversight: WPD's bar record is ONE value per bar, so an imported bar
 * arrives with a single corner and cannot express a float at all. Such tuples
 * are passed over here, so that door reaches `bars === 0` and declares nothing.
 */
export function relabelAllFloatingBarsAsSpan(
  configId: string,
  axes: AnyAxes,
  datasets: readonly Dataset[]
): { configId: string; notice: string } | null {
  if (configId !== 'bar' || !(axes instanceof BarAxes)) return null;
  if (axes.isStacked()) return null;
  const baseline = axes.getBaselineValue();
  let bars = 0;
  for (const dataset of datasets) {
    for (const tuple of dataset.getAllTuples()) {
      const [first, second] = tuple;
      if (first == null || second == null) continue;
      bars++;
      // With nothing declared there is nothing to sit ON, so every bar in the
      // figure is an interval - which is what the file was recording.
      if (!axes.hasDeclaredBaseline()) continue;
      const a = dataset.getPixel(first);
      const b = dataset.getPixel(second);
      const seating = barSeating(
        { value: axes.pixelToData(a.x, a.y)[0] ?? NaN, px: a.x, py: a.y },
        { value: axes.pixelToData(b.x, b.y)[0] ?? NaN, px: b.x, py: b.y },
        baseline,
        axes
      );
      // ⚑ An unanswerable measurement leaves the file's own declaration
      // standing: a degenerate calibration is not evidence of anything.
      if (!seating || seating.onBaseline) return null;
    }
  }
  if (bars === 0) return null;
  return {
    configId: 'span',
    notice:
      'Saved as a Bar chart, and every bar in it floats clear of the baseline - so it has opened as a Span chart, where both ends are reported as Min and Max. Nothing in the record changed: a span stores the same two measured corners a bar always did. If it really is a bar chart, its bars were captured clear of the baseline and would have to be recaptured from it.',
  };
}

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
  for (const dataset of datasets) dropOrphanedDerivedRole(dataset);

  // ⚑ AT THE LOAD DOOR, where every open path converges (the `.zip` reader and
  // the multi-figure reader both come through here), so no entrance can miss it.
  const relabel = relabelAllFloatingBarsAsSpan(configId, axes, datasets);

  return {
    configId: relabel?.configId ?? configId,
    ...(relabel ? { notice: relabel.notice } : {}),
    axes,
    datasets,
    // Falls back to a fresh empty one for any file predating this (every
    // file before v2.0), the same fallback loadCalibrated itself applies.
    categoryAxis: plotData.getCategoryAxisColl()[0] ?? new CategoryAxis(),
    // Null for a file that carries none - which is every project that is not a
    // heatmap, and every heatmap whose grid was never read.
    heatmapLayer: plotData.getHeatmapLayer(),
    imageDataURL: data.image.dataURL,
    // Absent rather than explicitly undefined, matching readStamp below and
    // the writer at `image:` above -- a file with no remembered name has no
    // key, it does not have a key holding nothing.
    ...(data.image.fileName === undefined ? {} : { imageFileName: data.image.fileName }),
    measurements: Array.isArray(data.measurements) ? data.measurements.map(readMeasurement) : [],
    measureScale: readMeasureScale(data.measureScale),
    // Accept only well-formed parts; a hand-edited or pre-95 file with missing
    // or malformed provenance reads back as `{}` (or a partial), never throws.
    provenance: readProvenance(data.provenance),
    ...readStamp(data),
  };
}

/** Validate a file's `appVersion`/`savedAt` into a ProjectStamp, dropping
 * anything that isn't a non-empty string. Same tolerant posture as
 * readProvenance: a hand-edited or foreign file must not break the open path
 * over a diagnostic field, and a garbage value is worse than none -- it would
 * make a future migration mis-identify which files it applies to. */
function readStamp(raw: { appVersion?: unknown; savedAt?: unknown }): ProjectStamp {
  const out: ProjectStamp = {};
  if (typeof raw.appVersion === 'string' && raw.appVersion.length > 0) out.appVersion = raw.appVersion;
  if (typeof raw.savedAt === 'string' && raw.savedAt.length > 0) out.savedAt = raw.savedAt;
  return out;
}

/** Validate a file's `provenance` into a Provenance, dropping anything
 * malformed. Missing/garbage -> `{}`. Keeps deserializeProject tolerant of
 * hand-edited or foreign files, same posture as the rest of that function. */
/**
 * A point may only claim to be DERIVED if there is a curve it could derive from.
 *
 * ⚑⚑ A FILE CAN DESCRIBE A STATE NO CLICK CAN BUILD: points roled
 * `interpolated` with no anchors anywhere in the series. Nothing on screen says
 * so - they draw and export like any other point - and then
 * `rebuildInterpolation` runs on the next click in Interpolate mode. It snapshots
 * the ANCHORS, deletes every point roled `anchor` OR `interpolated`, finds fewer
 * than two anchors and re-adds only those. Five hundred points, one click, gone.
 *
 * ⚑ THE POINT IS KEPT AND THE CLAIM IS DROPPED, not the other way round. A pixel
 * is a measurement; `role` is provenance about it. A provenance that cannot be
 * true is the half with nothing behind it, so the reading survives as an ordinary
 * recorded point and the story about where it came from does not.
 *
 * ⚑ TWO ANCHORS, matching `rebuildInterpolation`'s own threshold - a curve needs
 * two guide points to exist at all, so below that there is nothing any derived
 * sample could have come from. A genuine interpolation, anchors and all, is
 * untouched.
 */
function dropOrphanedDerivedRole(dataset: Dataset): void {
  const pixels = dataset.getAllPixels();
  const anchors = pixels.filter((p) => p.metadata?.['role'] === 'anchor').length;
  if (anchors >= 2) return;
  pixels.forEach((p, i) => {
    if (p.metadata?.['role'] !== 'interpolated') return;
    const { role: _drop, ...rest } = p.metadata as Record<string, unknown>;
    dataset.setMetadataAt(i, Object.keys(rest).length > 0 ? rest : null);
  });
}

/**
 * A measurement as it comes off disk, with any colour it claims CHECKED.
 *
 * ⚑⚑ THE ONE STORED READING HERE IS THE ONE THAT NEEDS A DOOR GUARD. Every
 * other field on a measurement is geometry that gets re-derived through the
 * axes on the way to the screen, so a bad number shows up as a bad number.
 * `rgb` is different: it is kept verbatim, on purpose, and then INVERTED
 * through the colour key to produce a value. A channel that is not a channel
 * therefore comes back as a confident reading rather than as nonsense.
 *
 * ⚠️ `null` is the case that arrives by itself, with nobody editing anything:
 * `NaN` serializes to `null` through JSON, and `null` behaves as `0` in the
 * arithmetic on the other side. That laundering has cost this project a
 * released defect once already (the curve fit that came back as a flat line at
 * y=0), so it is worth refusing at the door rather than meeting again downstream.
 *
 * ⚑ The MEASUREMENT survives; only the unusable colour is dropped. Its geometry
 * was never in doubt, and a row that reads as a dash is honest, where a
 * fabricated swatch is not.
 */
function readMeasurement(raw: SerializedMeasurement): SerializedMeasurement {
  const rgb = raw.rgb;
  const usable =
    Array.isArray(rgb) &&
    rgb.length === 3 &&
    rgb.every((c) => typeof c === 'number' && Number.isFinite(c) && c >= 0 && c <= 255);
  if (usable) return raw;
  const { rgb: _drop, ...rest } = raw;
  return rest;
}

/**
 * The px->unit reference, accepted only when it is a usable RATIO.
 *
 * ⚑⚑ A SCALE OF ZERO IS NOT A SCALE, AND IT DOES NOT LOOK LIKE ONE GOING IN.
 * `scaleFromDraft` now refuses two Set-scale clicks in the same place, but the
 * value that reached this door was `Infinity`, and `Infinity` is `null` by the
 * time JSON has carried it - after which `null` multiplies as `0` and every
 * distance and area in the panel and the exports reads a confident zero.
 *
 * ⚑ Dropping it back to NULL is the honest fallback, not an approximation: with
 * no scale the ruler reports pixels and says `set a scale for real units`, which
 * is a true statement about a figure whose scale was never usable.
 */
function readMeasureScale(raw: unknown): SerializedMeasureScale | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { unitPerPx, unit } = raw as { unitPerPx?: unknown; unit?: unknown };
  if (typeof unitPerPx !== 'number' || !Number.isFinite(unitPerPx) || unitPerPx <= 0) return null;
  return { unitPerPx, unit: typeof unit === 'string' ? unit : 'unit' };
}

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
  /** Which build wrote the file, and when (see ProjectStamp). Written ONCE here,
   * never per figure -- every figure in the archive was saved by the same app in
   * the same action, so a per-figure copy would be N copies of one fact. */
  appVersion?: string;
  savedAt?: string;
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
  /** Which build wrote the archive, and when (see ProjectStamp) -- read from the
   * top level, so the per-figure DeserializedProjects carry none. */
  appVersion?: string;
  savedAt?: string;
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
  sourceDocument?: SourceDocument,
  stamp?: ProjectStamp
): ProjectResult<MultiFigureProjectFile> {
  if (figures.length === 0) return { error: 'No figures to save.' };
  const out: FigureFile[] = [];
  for (const f of figures) {
    const single = serializeProject(f.session, f.imageDataURL, f.imageFileName, f.measures, f.provenance);
    if ('error' in single) return { error: `Can't save "${f.name}" - ${single.error}` };
    const fig: FigureFile = { name: f.name, image: single.image, plotData: single.plotData };
    if (single.measurements) fig.measurements = single.measurements;
    if (single.measureScale) fig.measureScale = single.measureScale;
    if (single.provenance) fig.provenance = single.provenance;
    out.push(fig);
  }
  const clampedActive = activeFigure >= 0 && activeFigure < out.length ? activeFigure : 0;
  const result: MultiFigureProjectFile = { plotTracerProject: 1, figures: out, activeFigure: clampedActive };
  // Top level only -- serializeProject above is deliberately called WITHOUT the
  // stamp, so no figure carries its own copy.
  if (stamp?.appVersion) result.appVersion = stamp.appVersion;
  if (stamp?.savedAt) result.savedAt = stamp.savedAt;
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
    if ('error' in single) return { error: `Figure "${typeof f.name === 'string' && f.name ? f.name : '?'}" - ${single.error}` };
    figures.push({ ...single, name: typeof f.name === 'string' && f.name ? f.name : `Figure ${figures.length + 1}` });
  }
  const active = typeof data.activeFigure === 'number' && data.activeFigure >= 0 && data.activeFigure < figures.length ? data.activeFigure : 0;
  return { figures, activeFigure: active, ...readStamp(data) };
}
