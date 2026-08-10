/**
 * Framework-agnostic state machine for a calibration + point-placement
 * workflow, generalized (checkpoint 13, see CLAUDE.md) from the XY-only
 * version built in checkpoints 3+4 to also support Bar axes, generalized
 * again (checkpoint 18) to support Polar, then extended (checkpoint 19)
 * to Ternary and Map.
 *
 * core/axes/xy.ts and core/axes/bar.ts reduce to the same shape once you
 * look past their differing calibrate() signatures: a sequence of steps,
 * each collecting one physical click plus user-entered value(s) that fill
 * one core/calibration.ts Calibration point's dx/dy slots (XY: 4 steps,
 * one value each, 2 populate dx / 2 populate dy; Bar: 2 steps, one value
 * each, both populate dy, dx stays a dummy). Checkpoint 13's CalibStepInfo
 * assumed exactly one value per step to match this.
 *
 * core/axes/polar.ts breaks that assumption: real WPD's own Polar
 * calibration form (wpd-core/javascript/controllers/axesCalibration.js,
 * PolarAxesCalibrator) collects r AND theta for its second click in one
 * go, and a third value-less click for the origin (r=0 is implicit, never
 * asked for). So CalibStepInfo.field (a single 'dx' | 'dy') became
 * `valueFields: readonly CalibValueField[]` -- zero entries for a step
 * needing no typed value at all (Polar's origin: click, place, advance,
 * no value prompt shown), one entry for the XY/Bar case, two for Polar's
 * r+theta points. Polar's third value (theta2, on its second calibration
 * point) is collected to match WPD's own form but never actually read by
 * core/axes/polar.ts's calibration math -- see that file's `_theta2r`
 * comment; preserved here for the same faithful-port reason, not a bug.
 *
 * core/axes/ternary.ts fits the zero-value-step shape Polar's origin
 * already introduced, taken further: all 3 corner clicks (A, B, C) are
 * value-less -- WPD's own TernaryAxesCalibrator never calls
 * calibration.setDataAt() at all, only two global toggles (0-100 vs 0-1
 * scale, normal vs reverse orientation) feed calibrate(), both hardcoded
 * here per the same "no UI yet for this option" precedent XY/Bar/Polar
 * already established for their own analogous options. Corner C's pixel
 * is collected to match WPD's own 3-click UI but never read by
 * ternary.ts's math (corner A as origin + corner B's distance/angle fully
 * determine an equilateral triangle) -- another faithfully-preserved dead
 * value, same category as Polar's theta2.
 *
 * core/axes/map.ts's MapAxes.calibrate() takes scale_length as a
 * standalone parameter, not read from any Calibration point's dx/dy by
 * its own processCalibration -- unlike every axes type above, where the
 * axes class itself pulls typed values out of the Calibration point. Map's
 * MAP_AXES_CONFIG works around this by still storing the value in the P2
 * step's dx slot (Calibration is a fine generic value carrier regardless
 * of whether the axes class reads it that way) and having buildAxes pull
 * it back out with cal.getPoint(1)!.dx before calling calibrate(). Units
 * label and origin-corner (top-left vs bottom-left) are hardcoded --
 * origin-corner in particular would need the loaded image's pixel height,
 * which CalibrationSession has no access to (it's owned by ui/'s
 * ImageCanvas, not passed in here) -- a real, not-yet-plumbed gap, not an
 * oversight to paper over silently.
 *
 * core/axes/circularChartRecorder.ts (checkpoint 20) is the value that
 * finally doesn't fit the per-step model at all: its calibrate() takes a
 * startTimeInput value with no click attached to it -- WPD's own real
 * sidebar shows it as a standalone "Chart Start Time" field, entered once
 * after all 5 points are placed, alongside two more global toggles
 * (rotation direction/period, hardcoded here per the usual precedent).
 * AxesTypeConfig gained `globalFields: readonly GlobalFieldInfo[]` (empty
 * for every other config) and `buildAxes(cal, globalValues)` grew a
 * second parameter -- CalibrationSession collects them once all click-
 * steps are placed but before "Calibrate" is enabled, storing them
 * separately from the per-step `placed` map since they were never tied to
 * a Calibration point's px/py at all. Its 5 points otherwise fit the
 * existing shape cleanly: (T0,R0) and (T0,R2) need typed values (2 and 1
 * respectively, same as Polar/Bar's cases), the other 3 ((T0,R1), (T1,R2),
 * (T2,R2)) are click-only, needed only to fit two circles
 * (`getCircleFrom3Pts`) through -- same "collected but not directly a
 * typed value" shape as Ternary's corner C.
 *
 * Everything else -- step walking, pending-value confirmation, point add/
 * remove/drag -- is identical across all supported axes types and lives
 * once in CalibrationSession.
 *
 * Checkpoint 21 (Box Plot / Point Groups): a second, orthogonal state
 * machine layered on top of the above, ported from wpd-core's own
 * javascript/widgets/pointGroups.js (a module-global cursor there;
 * per-session state here) and javascript/tools/manualDetectionTools.js's
 * ManualSelectionTool.onMouseClick (the click-dispatch logic). Once
 * core/dataset.ts's `setSlotNames` has named groups (e.g. Box Plot's
 * Min/Q1/Median/Q3/Max -- see applyBoxPlotGroups), `addDataPoint` no
 * longer just appends a pixel: it also files the new pixel into a
 * "tuple" (one category/box) at the current group slot, tracked by
 * `slotCursor`, then advances that cursor to the next open slot
 * (nextSlot, a direct port of pointGroups.js's nextGroup -- search
 * the current tuple past the current group, then later tuples, then fall
 * back to "start a new tuple" if nothing open is found). `removeLastPoint`
 * mirrors DeleteDataPointTool's single-point removal path (not its
 * whole-tuple-deletion popup, which real WPD gates behind a confirm
 * dialog and this checkpoint doesn't add): cleans the pixel out of
 * whichever tuple held it, drops the tuple if it's now empty, and walks
 * the cursor back with previousSlot (nextGroup's mirror image).
 * Checkpoint 21 was the interaction-model half of Box Plot support only.
 *
 * Checkpoint 22 adds the box-and-whisker glyph deferred from checkpoint
 * 21, a faithful port of the current app's drawBoxGlyph (commit
 * c0b6021): getBoxPlotGlyphs() recognizes a dataset whose slots
 * are exactly ['min','q1','median','q3','max'] (case-insensitive -- the
 * shape applyBoxPlotGroups creates) on a calibrated Bar-axes session,
 * and returns engine/boxPlotGlyph.ts's pure segment geometry for every
 * *complete* tuple (incomplete ones are skipped, same as the original).
 * Bar axes orientation (vertical vs. horizontal/rotated) comes from
 * BarAxes.calculateOrientation() -- CalibrationSession is generic over
 * any CalibratedAxes, so this needs a narrow cast, gated on
 * `config.axesKind === 'bar'` first (checkpoint 107 made this a capability
 * check, not `config.id === 'bar'`: Box Plot is now a first-class 'boxplot'
 * config AND still reachable via the legacy toggle on 'bar' -- both are
 * axesKind 'bar', both have calculateOrientation), same kind of documented
 * type escape MAP_AXES_CONFIG's buildAxes already uses for scale_length.
 *
 * Checkpoint 23 adds category naming, the other piece deferred from
 * checkpoint 21: a tuple's category name (real WPD calls this a data
 * point's "label") is stored the same way WPD stores it -- as
 * `metadata.label` on the tuple's first (primary group) pixel, per
 * core/dataset.ts's already-ported per-pixel metadata. Starting a new
 * tuple used to auto-label it with WPD's own default
 * (axes.dataPointsLabelPrefix + tuple index --
 * ManualSelectionTool.onMouseClick, manualDetectionTools.js); v2.0 (2026-07-30)
 * dropped that default GENERALLY, not just for Bar -- see autoLabelTuple's own
 * comment. Real WPD lets a user override the (now-gone) default through a
 * shift-click popup (wpd.dataPointLabelEditor, controllers/manualDetection.js)
 * -- deliberately not ported as a popup here: Workspace.tsx instead renders a
 * click-to-edit inline text field in the tuple table (dash at rest, matching
 * Spider's own axis-name cell), consistent with this rebuild's own "no
 * floating popups" design direction (see CLAUDE.md's Product #1 design
 * notes).
 *
 * Checkpoint 25 adds loadCalibrated(axes, dataset), the read side of
 * engine/projectFile.ts's project save/load: jumps straight to the
 * already-calibrated state from a pre-built axes + dataset pair (e.g. from
 * core/plotData.ts's PlotData.deserialize) instead of replaying the
 * click-by-click step walk. `placed` (needed so calibration handles still
 * render and stay draggable) is rebuilt from `axes.calibration`'s points,
 * which are stored in the exact step order runCalibration wrote them in --
 * the same narrow duck-typed-cast precedent as getBoxPlotGlyphs's read of
 * calculateOrientation. Global field values (CCR's Chart Start Time) are
 * restored via the new, optional AxesTypeConfig.extractGlobalValues --
 * buildAxes's inverse, defined only where there's something to extract. The
 * slot cursor isn't part of a serialized project at all, so it's
 * recomputed by scanning the loaded dataset's tuples for the first open
 * slot (recomputePointGroupCursor) rather than round-tripped.
 *
 * Checkpoint 26 adds addSegmentFillPoints(points), a bulk sibling to
 * addDataPoint for engine/segmentFillRun.ts's flood-fill curve tracer (see
 * that file and CLAUDE.md) -- one Segment Fill click can add hundreds of
 * points at once, and unlike a manual click it never files into point
 * groups (there's no natural Min/Q1/Median/Q3/Max slot for a continuous
 * curve trace), so it writes straight to the dataset rather than going
 * through addDataPoint's per-click, groups-aware path.
 *
 * Checkpoint 30 (multi-dataset/series support, see CLAUDE.md) generalizes
 * the single `dataset: Dataset` field this class held through checkpoint
 * 29 into `datasetEntries: DatasetEntry[]` plus `activeDatasetIndex` --
 * one calibrated axes, many datasets/series under it (not multiple
 * independent axes/calibrations -- that's a different, larger feature,
 * deliberately out of scope; see this checkpoint's own CLAUDE.md notes
 * for why "one axes, many series" is the scoped interpretation). Every
 * existing method that used to read/write `this.dataset` or
 * `this.slotCursor` directly now goes through a private
 * `activeEntry` getter instead, so a manual click, a Segment Fill trace,
 * Box Plot slots, etc. all implicitly operate on "whichever
 * dataset is currently active" -- the exact same behavior as before for
 * the single-dataset case (there's always >= 1 dataset; a session that
 * never calls addDataset behaves identically to a pre-checkpoint-30
 * session), with the new dataset-management methods layered on top:
 * addDataset/removeDataset/setActiveDataset/renameDataset/
 * setDatasetColor/getDatasetInfos. `getDataset()`/`getDataPoints()`/
 * `hasSlots()`/etc. keep their exact pre-checkpoint-30 names and
 * signatures -- they now mean "for the active dataset" rather than "for
 * the dataset", which is a no-op distinction until a second dataset
 * exists. `getAllDatasetsData()` is the one genuinely new read: every
 * dataset's own points + color, for ui/'s canvas to render every series
 * at once (only the active one draggable -- see Workspace.tsx). Each
 * dataset keeps its own independent slot cursor (Box Plot state
 * is inherently per-series), computed the same way loadCalibrated always
 * has (computeSlotCursorFor, generalized from the old no-arg
 * recomputePointGroupCursor to take an explicit dataset so it can run
 * once per loaded dataset instead of only for "the" one).
 */

import { Calibration } from '../core/calibration.js';

import { Dataset } from '../core/dataset.js';
import { Color } from '../core/color.js';

import { BarAxes } from '../core/axes/bar.js';

import { SpiderAxes } from '../core/axes/spider.js';
import { PieAxes } from '../core/axes/pie.js';
import { PlotData, type SerializedPlotData, type AnyAxes } from '../core/plotData.js';
import { CategoryAxis, type TickConvention } from '../core/categoryAxis.js';
import { computeBoxPlotGlyph, type BoxPlotGlyphSegment, type BoxPlotOrientation } from './boxPlotGlyph.js';
import { binsFromCorners, type HistogramBin } from '../algorithms/histogram.js';
import { interpolateCurveOrdered } from '../algorithms/interpolate.js';
import { nearestNeighbourOrder, bestInsertionIndex } from '../algorithms/segmentFill.js';
import { computeBinGlyph, type GlyphSegment } from './histogramGlyph.js';
import { computeWhiskerGlyph } from './errorBarGlyph.js';
import { calibrationPreview, type CalibrationPreview } from './calibrationPreview.js';
import {
  matchCapToDatum,
  resolveErrorBars,
  type ErrorBarPoint,
  type ErrorCapSeries,
  type ErrorRole,
} from '../algorithms/errorBar.js';
import {
  capFreeDirection,
  constrainCap,
  errorSeriesBase,
  freeAxisFor,
  errorSeriesName,
  mirrorCap,
  nearestPixel,
  oppositeRole,
  roleFromDrag,
} from '../algorithms/errorCapture.js';
import {
  getErrorRelation,
  setErrorRelation,
  errorSeriesFor,
  hasErrorSeries,
  retargetErrorRelations,
  clearErrorRelationsTo,
  type ErrorRelation,
} from './errorRelation.js';
import { datasetNameError, uniqueDatasetName, dedupeDatasetNames } from './seriesNames.js';
import { valueAtPixel, exportLabelsFor, type ExportValue } from '../core/exportValues.js';
import { halfPixelResolution, roundToResolution, type PrecisionMode } from '../core/exportPrecision.js';

// ⚑ The axes-type configuration system lives in its own module since v2.0 — the
// eleven graph-type declarations plus the shape they satisfy. RE-EXPORTED here
// so every existing import of a config or a config type keeps working
// unchanged; a move that also churned call sites could not be verified by the
// existing tests alone. The dependency runs ONE WAY: that module must never
// import this one.
export * from './axesTypeConfigs.js';
// checkGuards/mustDiffer/PIE_RIM_SNAP_FRACTION are shared between the graph-type
// declarations and this state machine, so they are part of that module's
// surface rather than private to a file the two no longer share.
import {
  type CalibratedAxes,
  type AxesTypeConfig,
  type CalibStepInfo,
  type RepeatingStepInfo,
  type DataPointView,
  defaultOptionValues,
  checkGuards,
  mustDiffer,
  PIE_RIM_SNAP_FRACTION,
  HISTOGRAM_SLOTS,
  BAR_INTERVAL_SLOTS,
  BOX_PLOT_SLOTS,
} from './axesTypeConfigs.js';

/** How a point of an interpolation-assist series came to exist.
 *
 * `anchor` — the user ASSIGNED it: they judged by eye where the curve runs and
 * put a guide point there. That is a human decision about the figure, not a
 * measurement taken off it (the whole reason interpolation-assist exists is the
 * monochrome dashed curve no filter can follow).
 * `interpolated` — the spline DERIVED it from the anchors either side. Nobody
 * looked at the figure at this x at all.
 *
 * An ordinary placed/traced point carries no role (`null`): it isn't part of an
 * interpolation series, so the distinction doesn't apply to it. Keeping the two
 * stored words as the exported vocabulary is deliberate (David, 2026-07-25) —
 * we export the fact the record holds, and leave "so is it trustworthy?" to the
 * reader (tenets 9 + 10). */
export type PointRole = 'anchor' | 'interpolated';

export interface PlacedCalibPoint {
  px: number;
  py: number;
  /** One entered value per this step's valueFields, in the same order. Empty
   * for a value-less step (e.g. Polar's origin). */
  values: string[];
}

/** An opaque, structurally-cloneable capture of a session's *entire* mutable
 * state (checkpoint 38, undo/redo -- see CLAUDE.md). The datasets + axes half
 * rides on core/plotData.ts's own serialize/deserialize (the same lossless
 * round-trip engine/projectFile.ts already relies on, reused rather than
 * reimplemented -- and it handles the pre-calibration null-axes case, so one
 * path covers every state); everything else is session-only bookkeeping that
 * plotData doesn't model (mid-calibration progress, per-series slot
 * cursors, the active-series index, the auto-name counter), captured as plain
 * cloned data. Snapshots are only ever restored into the *same* session that
 * produced them (same AxesTypeConfig) -- History is reset when the axes type
 * changes -- so the `A` cast in restoreState is sound. */
export interface SessionSnapshot {
  placed: Record<string, PlacedCalibPoint>;
  stepIndex: number;
  pendingPixel: { px: number; py: number } | null;
  calibrationError: string | null;
  activeDatasetIndex: number;
  nextDatasetNumber: number;
  globalValues: Record<string, string>;
  /** Per-type calibration settings (checkpoint 68). Part of the snapshot
   * because toggling one re-calibrates and changes every derived value, so an
   * undo that didn't restore it would leave the data and the settings
   * disagreeing. */
  optionValues: Record<string, string>;
  /** How many repeats the variable-length calibration is unrolled to — the spider's
   * spoke count (0 for every fixed-shape type). Part of the snapshot because both
   * rail buttons that change it commit an undo entry, and it is the one piece of
   * session shape that cannot be re-derived from the serialized plotData: an
   * UNCALIBRATED session has no axes to read the count back off, and those buttons
   * only work while the calibration is still uncalibrated. */
  repeatCount: number;
  /** Pie's exploded-slice capture in progress, if any (v1.6) -- the pre-v2.0
   * audit's own "snapshot is a fourth entrance" recipe applied to itself,
   * 2026-07-30: `pendingExplodedTuple` is a tuple INDEX into the very
   * datasets this snapshot's `plotData` restores, so leaving it out let a
   * restore land on a dataset shorter than the stale index -- silently
   * swallowing every click afterward with no error (addDataPoint's guard on
   * `dataset.getAllTuples()[t]` degrades to a no-op when `t` is now out of
   * range, never clearing the pending state that caused it). Captured
   * verbatim rather than reset-on-restore because it is genuinely
   * gesture-in-progress state, exactly like `cursors` below -- an undo
   * mid-explode should land back in the same mid-explode state, not lose it. */
  explodedApexPending: boolean;
  pendingExplodedTuple: number | null;
  pendingApex: { x: number; y: number } | null;
  /** Per-dataset slot cursor, indexed to match plotData's dataset order. */
  cursors: SlotCursor[];
  plotData: SerializedPlotData;
}

/** Where the next Place Point click will file its pixel: `tupleIndex: null` means
 * "starts a new tuple at group 0" (mirrors pointGroups.js's own null-as-sentinel). */
export interface SlotCursor {
  tupleIndex: number | null;
  groupIndex: number;
}

/** One row of a tuple-based (Box Plot / Point Groups) table: one entry per
 * configured group, in group order, `null` for a slot not yet filled. */
export interface TupleRow {
  tupleIndex: number;
  /** Category name (e.g. "Sample A"), stored on the tuple's primary-group
   * pixel's metadata -- see getTupleLabel/setTupleLabel. */
  label: string;
  points: (DataPointView | null)[];
  /**
   * The row's own DERIVED value, for a type whose datum is the tuple rather than
   * its members (v1.6, pie). Null when the tuple is incomplete, or for every type
   * that does not declare `derivedTupleValue`.
   *
   * ⚑ A pie's slice is the case this exists for: its two boundaries are angles, and
   * NEITHER of them is the number the user wants -- the value lives in the
   * difference. Showing the members instead would put "270" and "61.2" on screen for
   * a slice worth 42.
   */
  derived: number | null;
}

/** 'point-placed': a value-less step (e.g. Polar's origin) was placed and the
 * walk advanced immediately, with no value prompt shown. */
export type CalibrationClickResult = 'awaiting-value' | 'point-placed' | 'ignored';
export type DataPointClickResult = 'point-added' | 'ignored';

/** One dataset/series plus its own independent slot cursor (Box Plot
 * state is inherently per-series, checkpoint 30) -- see this file's header
 * comment. */
interface DatasetEntry {
  dataset: Dataset;
  slotCursor: SlotCursor;
}

/** Summary view of one dataset/series for ui/'s series-list panel --
 * checkpoint 30, see CLAUDE.md. */
export interface DatasetInfo {
  index: number;
  name: string;
  color: [number, number, number];
  pointCount: number;
  active: boolean;
}

/** One dataset/series's full point data plus its color, for ui/'s canvas to
 * render every series at once (only the active one draggable) -- checkpoint
 * 30, see CLAUDE.md. */
export interface DatasetPointsView {
  index: number;
  color: [number, number, number];
  active: boolean;
  points: DataPointView[];
}

// A small, standard qualitative palette (matplotlib's default "tab10"
// ordering) for auto-coloring newly added series -- distinguishable at a
// glance without asking the user to pick a color for every one. Cycles by
// index modulo length past the 8th series. Exported (checkpoint 89) so the UI's
// series-colour picker can offer these same swatches, instead of the native
// <input type="color"> dialog that CRASHES this Electron build on Linux.
export const SERIES_COLOR_PALETTE: readonly [number, number, number][] = [
  [31, 119, 180],
  [255, 127, 14],
  [44, 160, 44],
  [214, 39, 40],
  [148, 103, 189],
  [140, 86, 75],
  [227, 119, 194],
  [127, 127, 127],
];

/**
 * A slot cursor that the given dataset can actually honour.
 *
 * A restored cursor is only meaningful against the dataset it was captured
 * with; anything pointing past the rebuilt tuple array is dropped back to
 * "start a new tuple" rather than carried forward to throw on the next click.
 */
function validCursorFor(
  dataset: Dataset,
  cursor: SlotCursor | undefined
): SlotCursor {
  const fresh: SlotCursor = { tupleIndex: null, groupIndex: 0 };
  if (!cursor) return fresh;
  if (cursor.tupleIndex === null) return { ...cursor };
  const tuples = dataset.getAllTuples();
  if (cursor.tupleIndex < 0 || cursor.tupleIndex >= tuples.length) return fresh;
  return { ...cursor };
}

export class CalibrationSession<A extends CalibratedAxes> {
  private placed: Record<string, PlacedCalibPoint> = {};
  private stepIndex = 0;
  private pendingPixel: { px: number; py: number } | null = null;
  private axes: A | null = null;
  private calibrationError: string | null = null;
  private datasetEntries: DatasetEntry[];
  private activeDatasetIndex = 0;
  /** Counter for auto-generated series names ("Series 2", "Series 3", ...) --
   * the first dataset is "Series 1", created in the constructor. Not reset by
   * removeDataset, so names stay unique across an add/remove/add sequence
   * within one session (matches the simplest correct behavior; not worth
   * hunting for a "smallest unused number" instead). */
  private nextDatasetNumber = 2;
  /** Values for config.globalFields, keyed by GlobalFieldInfo.key -- entered
   * once after every click-step is placed, not tied to any Calibration point. */
  private globalValues: Record<string, string> = {};
  /** Values for config.options (checkpoint 68), keyed by AxesOption.key, as
   * strings. Seeded from the config's declared defaults so a session always has
   * a complete set -- buildAxes never has to cope with a missing key. */
  private optionValues: Record<string, string>;
  /** Natural height of the loaded image; only MapAxes's bottom-left origin
   * reads it. Set by ui/ when an image loads (setImageHeight) -- the session
   * has no other way to know it, and a wrong value silently mirrors every
   * y value on a map. */
  private imageHeight = 0;

  /** The canonical category list (v2.0), currently read/written only for
   * `config.id === 'bar'` -- see setTupleLabel/getTupleLabel. Present
   * unconditionally on every session (rather than null until first needed)
   * so no call site has to cope with "not created yet"; every other graph
   * type simply never reads or writes it. Not a CalibratedAxes -- see
   * core/categoryAxis.ts for why. */
  private categoryAxis: CategoryAxis = new CategoryAxis();

  /** How many times `config.repeatingStep` is currently unrolled — the spoke count
   * of the spider being calibrated. Meaningless (and left at 0) for every
   * fixed-shape type. */
  private repeatCount: number;

  /**
   * Armed by the "Slice is exploded" control: the NEXT sector is a pulled-out one,
   * so its first click places its own APEX rather than a boundary (v1.6).
   *
   * ⚑ Why a sector needs its own apex at all: pulling a slice out TRANSLATES it, so
   * its edges no longer point at the pie's centre. Measured from the shared centre a
   * 90-degree slice pulled out by a tenth of the radius reads about 8 degrees wrong,
   * and the two edges err in opposite directions so the errors add. Measured about
   * its own apex it reads exactly as it did before it was pulled out.
   */
  private explodedApexPending = false;

  /** The exploded sector currently being captured, and its apex, held until the
   * tuple has a primary pixel to store it on. Also suppresses chaining for exactly
   * that slice -- see addDataPoint. */
  private pendingExplodedTuple: number | null = null;
  private pendingApex: { x: number; y: number } | null = null;

  constructor(private readonly config: AxesTypeConfig<A>) {
    this.datasetEntries = [this.buildDatasetEntry('Series 1', 0)];
    this.optionValues = defaultOptionValues(config as unknown as AxesTypeConfig<CalibratedAxes>);
    // Prefill any global field that declares a default (v1.6) -- see GlobalFieldInfo.
    for (const gf of config.globalFields) {
      if (gf.defaultValue !== undefined) this.globalValues[gf.key] = gf.defaultValue;
    }
    this.repeatCount = config.repeatingStep?.min ?? 0;
  }

  /**
   * The steps this session is actually walking — the config's fixed steps, plus
   * `repeatCount` copies of its repeating group.
   *
   * ⚑ EVERY read of the step list must come through here rather than
   * `config.steps`. For the eight fixed-shape types the two are identical, which is
   * exactly what makes a stray `config.steps` read dangerous: it keeps working
   * everywhere except on a spider, where it silently sees one step (the origin) and
   * reports a calibration complete with no axes placed.
   */
  getSteps(): readonly CalibStepInfo[] {
    const repeating = this.config.repeatingStep;
    if (!repeating) return this.config.fixedSteps;

    const steps: CalibStepInfo[] = [...this.config.fixedSteps];
    for (let i = 1; i <= this.repeatCount; i++) {
      steps.push({
        ...repeating.step,
        key: `${repeating.step.key}${i}`,
        label: repeating.step.label.replace('#', String(i)),
        prompt: repeating.step.prompt.replace('#', String(i)),
        valueFields: repeating.step.valueFields.map((vf) => ({ ...vf, key: `${vf.key}${i}` })),
      });
    }
    return steps;
  }

  /** How many repeats the user has asked for (0 for a fixed-shape type). */
  getRepeatCount(): number {
    return this.repeatCount;
  }

  getRepeatingStepInfo(): RepeatingStepInfo | undefined {
    return this.config.repeatingStep;
  }

  /** Add one more repeat — one more spoke to place. Returns false for a type that
   * has no repeating group, or once a calibration is already live (the handles are
   * placed; changing the shape underneath them is a re-calibration, via reset). */
  addRepeat(): boolean {
    if (!this.config.repeatingStep || this.axes) return false;
    this.repeatCount += 1;
    return true;
  }

  /**
   * Drop the LAST repeat, along with anything already placed for it.
   *
   * Refuses below `min`, and clamps the step cursor so removing the step you were
   * standing on leaves you on a step that exists — otherwise `getCurrentStep()`
   * returns null and the card reads "ready to calibrate" with a hole in the middle
   * of the placed points.
   */
  removeRepeat(): boolean {
    const repeating = this.config.repeatingStep;
    if (!repeating || this.axes) return false;
    if (this.repeatCount <= repeating.min) return false;

    const removed = this.getSteps()[this.config.fixedSteps.length + this.repeatCount - 1]!;
    delete this.placed[removed.key];
    this.repeatCount -= 1;
    if (this.stepIndex > this.getSteps().length) this.stepIndex = this.getSteps().length;
    if (this.pendingPixel && this.stepIndex === this.getSteps().length) this.pendingPixel = null;
    return true;
  }

  /** Current per-type calibration settings (checkpoint 68). */
  getOptions(): Readonly<Record<string, string>> {
    return this.optionValues;
  }

  /** Sets one calibration option. Re-runs the calibration when one is already
   * live, so toggling e.g. Log Y updates every derived value immediately rather
   * than silently waiting for a re-calibrate -- the option describes how the
   * *existing* handles should be read. */
  setOption(key: string, value: string): void {
    this.optionValues[key] = value;
    if (this.axes) this.runCalibration();
  }

  setImageHeight(height: number): void {
    this.imageHeight = height;
  }

  private buildDatasetEntry(name: string, paletteIndex: number): DatasetEntry {
    const dataset = new Dataset(this.config.dataDim);
    dataset.name = name;
    const [r, g, b] = SERIES_COLOR_PALETTE[paletteIndex % SERIES_COLOR_PALETTE.length]!;
    dataset.colorRGB = new Color(r, g, b);
    // Applied here rather than at the one call site, so *every* series gets
    // the graph type's capture shape -- the constructor's "Series 1", each
    // addDataset, and reset alike (checkpoint 66).
    if (this.config.defaultSlots) dataset.setSlotNames([...this.config.defaultSlots]);
    // ...and for a type whose slots are DERIVED from the axes (Spider), from the
    // live calibration. Without this, "+ Add series" on a calibrated spider gave a
    // series with no slots at all, so its points had no axis to be read against —
    // the same "every series gets the graph type's capture shape" reason the
    // static list above is applied here rather than at the one call site, just for
    // the half of the shape that only exists once the axes do.
    const derived = this.config.slotsFromAxes && this.axes ? this.config.slotsFromAxes(this.axes) : null;
    if (derived && derived.length > 0) dataset.setSlotNames([...derived]);
    return { dataset, slotCursor: { tupleIndex: null, groupIndex: 0 } };
  }

  /** The active dataset/series' own entry -- every method below that used to
   * read/write a single `this.dataset`/`this.slotCursor` now goes
   * through this instead, so it implicitly operates on "whichever dataset is
   * currently active" (see this file's header comment). */
  private get activeEntry(): DatasetEntry {
    return this.datasetEntries[this.activeDatasetIndex]!;
  }

  getConfig(): AxesTypeConfig<A> {
    return this.config;
  }

  /**
   * The calibration INPUTS — the placed handles, options and global fields, but
   * not the data (checkpoint 87). What you need to reproduce a calibration in a
   * different session.
   *
   * This exists so a graph-type change can KEEP a calibration it would otherwise
   * throw away: XY and Histogram share `XY_AXES_CONFIG.steps` byte-for-byte, so
   * switching between them used to make you re-click four points for nothing.
   */
  getCalibrationInputs(): {
    placed: Record<string, PlacedCalibPoint>;
    optionValues: Record<string, string>;
    globalValues: Record<string, string>;
  } {
    return {
      placed: structuredClone(this.placed),
      optionValues: { ...this.optionValues },
      globalValues: { ...this.globalValues },
    };
  }

  /**
   * Adopt a calibration captured from a COMPATIBLE config (see
   * `calibrationCompatible`) and re-run it. Returns whether it calibrated.
   *
   * Options are filtered to this config's own keys — a compatible config has the
   * same *steps* but may not carry every option, and an unknown key would just
   * be dead weight. Data is untouched: the caller clears or keeps it, because
   * whether last session's *points* mean anything under the new graph type is a
   * question about the data, not the calibration.
   */
  adoptCalibration(inputs: {
    placed: Record<string, PlacedCalibPoint>;
    optionValues: Record<string, string>;
    globalValues: Record<string, string>;
  }): boolean {
    this.placed = structuredClone(inputs.placed);
    this.stepIndex = this.getSteps().length;
    this.globalValues = { ...inputs.globalValues };
    const validKeys = new Set((this.config.options ?? []).map((o) => o.key));
    this.optionValues = defaultOptionValues(this.config as unknown as AxesTypeConfig<CalibratedAxes>);
    for (const [k, v] of Object.entries(inputs.optionValues)) {
      if (validKeys.has(k)) this.optionValues[k] = v;
    }
    return this.runCalibration();
  }

  isCalibrated(): boolean {
    return this.axes !== null;
  }

  getCurrentStep(): CalibStepInfo | null {
    if (this.axes) return null;
    return this.getSteps()[this.stepIndex] ?? null;
  }

  getStepIndex(): number {
    return this.stepIndex;
  }

  getPlacedPoints(): Readonly<Record<string, PlacedCalibPoint>> {
    return this.placed;
  }

  getPendingPixel(): { px: number; py: number } | null {
    return this.pendingPixel;
  }

  getCalibrationError(): string | null {
    return this.calibrationError;
  }

  getGlobalFieldValues(): Readonly<Record<string, string>> {
    return this.globalValues;
  }

  setGlobalFieldValue(key: string, value: string): void {
    this.globalValues[key] = value;
    // Re-calibrate live once calibrated, mirroring setOption above. A global
    // field (CCR's Chart Start Time) feeds buildAxes exactly as an option does,
    // so editing one after calibration must re-project the values -- without
    // this, changing the start time on a calibrated CCR silently did nothing
    // (checkpoint 86; the audit flagged the asymmetry with setOption as
    // "looks unintentional"). It was: setOption grew this branch at ckpt 68 and
    // its sibling never did.
    if (this.axes) this.runCalibration();
  }

  getAxes(): A | null {
    return this.axes;
  }

  /** The active dataset's underlying Dataset instance -- exposed for
   * engine/projectFile.ts, engine/curveFitPanel.ts, and
   * engine/geometryPanel.ts, which all need the real object (not a derived
   * view like getDataPoints) and all operate on "whichever dataset is
   * currently active" per this file's header comment. */
  getDataset(): Dataset {
    return this.activeEntry.dataset;
  }

  /** Every dataset/series' own Dataset instance, in order -- for
   * engine/projectFile.ts's serializeProject, which needs to write all of
   * them (checkpoint 30), not just the active one. */
  getDatasets(): Dataset[] {
    return this.datasetEntries.map((e) => e.dataset);
  }

  getDatasetCount(): number {
    return this.datasetEntries.length;
  }

  getActiveDatasetIndex(): number {
    return this.activeDatasetIndex;
  }

  /** Summary info for every dataset/series -- ui/'s series-list panel. */
  getDatasetInfos(): DatasetInfo[] {
    return this.datasetEntries.map((entry, index) => ({
      index,
      name: entry.dataset.name,
      color: entry.dataset.colorRGB.getRGB(),
      pointCount: entry.dataset.getCount(),
      active: index === this.activeDatasetIndex,
    }));
  }

  /** The relation a series declares, or null if it is an ordinary series. */
  getErrorRelation(index: number): ErrorRelation | null {
    const entry = this.datasetEntries[index];
    return entry ? getErrorRelation(entry.dataset) : null;
  }

  /**
   * Declare (or clear, with null) that a series records error for another.
   *
   * Returns the reason for a refusal, or null on success -- the same
   * error-string contract as renameDataset, because these are the same kind of
   * refusal (a relation that cannot mean anything) and ui/ can surface both the
   * same way.
   *
   * The two refusals are the ones that would otherwise produce a nonsense
   * model rather than merely an odd one: a series cannot carry error for
   * itself (it would resolve every cap onto the datum it came from), and it
   * cannot point at a name no series holds (a dangling link draws nothing and
   * looks identical to having forgotten to place the caps). A *chain* -- error
   * on an error series -- is deliberately NOT refused: it is strange but it is
   * legible, and the model resolves it fine.
   */
  setErrorRelation(index: number, relation: ErrorRelation | null): string | null {
    const entry = this.datasetEntries[index];
    if (!entry) return null;
    if (relation) {
      if (relation.of === entry.dataset.name) return 'A series cannot carry error for itself.';
      if (!this.datasetEntries.some((e) => e.dataset.name === relation.of)) {
        return `There is no series called "${relation.of}".`;
      }
    }
    setErrorRelation(entry.dataset, relation);
    return null;
  }

  /**
   * A series' data points with their error resolved from every series related
   * to it -- the model's one derived quantity.
   *
   * Empty until calibrated: a cap's position is only meaningful in data space,
   * and resolving in pixel space would pair caps by screen distance, which the
   * axes may not even be linear in. Returns the series' own points with no
   * error fields when nothing is related to it, so a caller can render this
   * unconditionally rather than branching on whether error exists.
   */
  getResolvedErrorBars(index: number): ErrorBarPoint[] {
    const entry = this.datasetEntries[index];
    if (!entry || !this.axes) return [];
    const axes = this.axes;
    const toData = (d: Dataset) =>
      d.getAllPixels().map((p) => {
        const v = axes.pixelToData(p.x, p.y);
        return { x: v[0]!, y: v[1]! };
      });
    const caps: ErrorCapSeries[] = errorSeriesFor(this.getDatasets(), entry.dataset.name).map(
      ({ dataset, role }) => ({ role, caps: toData(dataset) })
    );
    return resolveErrorBars(toData(entry.dataset), caps);
  }

  /**
   * For an ERROR-CAP series, each cap's signed offset from the datum it
   * resolves to — the ± the figure is actually communicating.
   *
   * ⚑ This is what a reader wants and what a plotting library takes. Asked what
   * numbers you would need to REDRAW the figure, the answer is x, y, −Δ and +Δ:
   * matplotlib's `yerr` and Excel's error bars are deltas outright, and
   * ggplot's ymin/ymax are one subtraction away. What none of them take is the
   * cap's own x, which is the datum's x by construction (David, 2026-08-03).
   *
   * ⚑ A delta is SUBTRACTION, not inference. Both ends were measured off the
   * pixels, so computing their difference assumes nothing — unlike halving one
   * cap into a symmetric ±, which would invent the other side. The absolute
   * positions stay the record; this is derived at read time, the same split
   * bar and pie already make with `derivedTupleValue`.
   *
   * Signed by ROLE, not by magnitude: an `upper`/`right` cap reads positive and
   * a `lower`/`left` cap negative, so the two columns of an asymmetric bar can
   * be read apart at a glance. Resolution uses `matchCapToDatum`, the same rule
   * the whisker glyph draws with, so the table cannot disagree with the canvas.
   *
   * `null` for a cap that resolves to no datum, and `[]` for a series that is
   * not an error series at all — never 0, which would read as "measured, and
   * equal".
   */
  getErrorCapDeltas(index: number): (number | null)[] {
    const entry = this.datasetEntries[index];
    if (!entry || !this.axes) return [];
    const relation = getErrorRelation(entry.dataset);
    if (!relation) return [];
    const parent = this.datasetEntries.find((e) => e.dataset.name === relation.of);
    if (!parent) return [];
    const parentData = this.dataValuesOf(parent.dataset);
    const along = freeAxisFor(relation.role);
    return entry.dataset.getAllPixels().map((p) => {
      const cap = this.dataOf(p);
      const di = matchCapToDatum(parentData, cap, relation.role);
      const datum = di > -1 ? parentData[di] : undefined;
      if (!datum) return null;
      const delta = along === 'y' ? cap.y - datum.y : cap.x - datum.x;
      return Number.isFinite(delta) ? delta : null;
    });
  }

  /**
   * The point of series `index` nearest `pixel`, within `maxDistance` image
   * pixels -- what an error drag snaps its *start* to.
   *
   * Snapping the start is what keeps the datum end of a whisker honest: the bar
   * is anchored on a point already placed from the figure rather than on
   * wherever the press landed. The cap end is never snapped; it is the
   * measurement.
   */
  nearestDatumPixel(index: number, pixel: { x: number; y: number }, maxDistance: number)
    : { index: number; point: { x: number; y: number } } | null {
    const entry = this.datasetEntries[index];
    if (!entry) return null;
    return nearestPixel(entry.dataset.getAllPixels(), pixel, maxDistance);
  }

  /**
   * Record one error cap and its mirror: the whole of checkpoint 79's gesture,
   * in one call.
   *
   * `datumPixel` is a point of the target series (the drag's start, already
   * snapped to it); `capPixel` is where the user released. The error series is
   * found-or-created by name and carries the relation -- creating it here
   * rather than making the user create a series first is the point of the
   * gesture: the drag is the link (docs/error-bars-design.md).
   *
   * **Both caps are always placed, and neither is a claim** (David,
   * 2026-07-16). The opposite cap is mirrored across the datum only to give the
   * user something to grab; it is an ordinary point in an ordinary series,
   * draggable to wherever the figure actually draws it, and nothing enforces or
   * later assumes the pair stayed symmetric. Hence no symmetric/asymmetric
   * mode: an asymmetric bar is just a bar whose cap you moved.
   *
   * **Everything here is pixel geometry** -- see algorithms/errorCapture.ts's
   * header. Nothing is asked of the axes, so this works on all 7 graph types,
   * including error on a bar plot.
   *
   * Requires calibration for the same reason addDataPoint does: an uncalibrated
   * pixel has no value to report. Returns the reason for a refusal, or null.
   */
  captureErrorCap(opts: {
    targetIndex: number;
    datumPixel: { x: number; y: number };
    capPixel: { x: number; y: number };
    baseName: string;
  }): string | null {
    const target = this.datasetEntries[opts.targetIndex];
    if (!target) return 'That series no longer exists.';
    if (!this.axes) return 'Calibrate the chart first.';

    const role = roleFromDrag(opts.datumPixel, opts.capPixel);
    if (!role) return 'Drag from a data point out to its error cap.';

    const base = opts.baseName.trim();
    if (base.length === 0) return 'Name the error series first.';

    // The model's one constraint, where this axes can express it: the cap is
    // pinned to the line its datum's value axis runs along. Null direction ->
    // untouched, which is the right answer on the axes that cannot say.
    const direction = capFreeDirection(this.axes, opts.datumPixel, role);
    const cap = constrainCap(opts.datumPixel, opts.capPixel, direction);

    const targetName = target.dataset.name;
    const placed = this.addCapTo(base, role, targetName, cap);
    if (placed) {
      this.switchActiveDataset(opts.targetIndex);
      return placed;
    }

    const mirror = this.addCapTo(base, oppositeRole(role), targetName, mirrorCap(opts.datumPixel, cap));
    // The error caps live in their OWN related series (SD upper / SD lower), which
    // addDataset just made active as a side effect. But the user is working on the
    // TARGET data series -- adding error to a point must never steal "active" from
    // it, or the next Place-Point click silently lands on an error-cap series with
    // nothing on screen saying so (a real trap; the point you added a cap to and
    // the target are always the same series). Restore it.
    this.switchActiveDataset(opts.targetIndex);
    return mirror;
  }

  /**
   * Every recorded error relation drawn as whiskers, in image-pixel space
   * (checkpoint 79) -- one bar per cap, from the datum it resolves to.
   *
   * **This is the check on what the storage leaves implicit.** The link is
   * series->series; the cap->datum correspondence is derived. Drawing it is what
   * makes a mis-resolution visible instead of plausible.
   *
   * **Resolved in DATA space, via the SAME function the record uses**
   * (`matchCapToDatum`) -- corrected at checkpoint 85, finding A6. Checkpoint 79
   * matched here in PIXEL space to avoid needing an axes; since checkpoint 68
   * turned rotation correction on by default, data-x mixes pixel-x and pixel-y,
   * so on a rotated calibration the two rules disagreed and **the glyph could
   * pair a cap to a different datum than the export reported.** A check
   * computed differently from the thing it checks is not a check.
   *
   * The direction is the rule's own: **caps claim data, never the reverse**, so
   * N caps produce exactly N whiskers rather than giving every datum of a dense
   * curve a bar it never had.
   *
   * Deliberate, and worth stating: a cap that LOSES `resolveErrorBars`'
   * nearest-wins arbitration (two caps claiming one datum) still gets a whisker
   * here. It is a real point the user placed, and drawing it is how the
   * mis-click becomes visible -- hiding it would be the silence this feature
   * exists to end. The arbitration decides which cap's VALUE is reported, not
   * which points exist.
   */
  getErrorWhiskers(): GlyphSegment[][] {
    // Requires calibration -- see the note above on why this now resolves in
    // DATA space. Caps cannot exist before it anyway (captureErrorCap refuses),
    // so this costs no reachable behaviour.
    if (!this.axes) return [];
    const axes = this.axes;
    const toData = (p: { x: number; y: number }) => {
      const v = axes.pixelToData(p.x, p.y);
      const x = v[0];
      const y = v[1];
      return x === undefined || y === undefined ? null : { x, y };
    };

    const whiskers: GlyphSegment[][] = [];
    for (const entry of this.datasetEntries) {
      const relation = getErrorRelation(entry.dataset);
      if (!relation) continue;
      const target = this.datasetEntries.find((e) => e.dataset.name === relation.of);
      if (!target) continue;
      const dataPixels = target.dataset.getAllPixels();
      if (dataPixels.length === 0) continue;
      // Pixels and their data twins, index-aligned: the MATCH happens in data
      // space (the record's rule), the DRAWING happens in pixel space.
      const dataValues: { x: number; y: number }[] = [];
      const pixelOf: { x: number; y: number }[] = [];
      for (const p of dataPixels) {
        const d = toData(p);
        if (!d) continue;
        dataValues.push(d);
        pixelOf.push({ x: p.x, y: p.y });
      }
      if (dataValues.length === 0) continue;

      for (const cap of entry.dataset.getAllPixels()) {
        const capData = toData(cap);
        if (!capData) continue;
        // ONE rule, shared with resolveErrorBars (finding A6). Matching here in
        // pixel space -- as checkpoint 79 did -- disagreed with the record on a
        // rotated calibration, so the glyph could pair a cap to a different
        // datum than the export reported. A check computed differently from the
        // thing it checks is not a check.
        const index = matchCapToDatum(dataValues, capData, relation.role);
        if (index < 0) continue;
        whiskers.push(computeWhiskerGlyph(pixelOf[index]!, { x: cap.x, y: cap.y }));
      }
    }
    return whiskers;
  }

  /**
   * The geometry this calibration implies, for the canvas to draw (ckpt 84).
   *
   * Live and progressive: reads whatever is placed right now, so the X axis
   * appears the moment X1 and X2 exist and updates as a handle is dragged. That
   * is the point -- a mis-clicked handle used to produce a wrong-but-plausible
   * chart with nothing on screen wrong.
   */
  getCalibrationPreview(liveSpokeIndex?: number): CalibrationPreview {
    return calibrationPreview(
      {
        axesKind: this.config.axesKind,
        // The UNROLLED steps, not the config's. A spider's spokes exist only in
        // the session, and passing the config's single origin step would leave the
        // preview unable to name — or colour — any ray the user has placed.
        steps: this.getSteps(),
      },
      this.placed,
      // ⚑ An explicit override wins over the capture cursor (David, 2026-07-27):
      // selecting a point must move the live-ray highlight to THAT point's axis.
      // Without it the highlight only ever tracked where the next capture would
      // go, so clicking a recorded point on another spoke left the wrong ray lit —
      // the highlight would be pointing at one axis while the selection was on
      // another, which is worse than no highlight at all.
      liveSpokeIndex != null && liveSpokeIndex >= 0
        ? `spoke${liveSpokeIndex + 1}`
        : this.liveSpokeStepKey()
    );
  }

  /**
   * The calibration step for the spoke the capture cursor is filling, so the
   * canvas can draw that ray as the live one (v1.4, Spider).
   *
   * Nothing is emphasised during the calibration walk — the active step already
   * has its own highlight on the card, and there is no capture cursor yet.
   *
   * ⚑ What actually carries that is the slot check: a spider's groups are
   * derived from the calibrated axes, so they do not exist until calibration
   * succeeds. The `!this.axes` test below is defence in depth and is NOT covered by
   * a failing-first test — neutering it changes nothing today, because no state
   * has this type's groups without its axes. Said plainly rather than left as a
   * comment implying a guarantee the tests do not check.
   */
  private liveSpokeStepKey(): string | undefined {
    if (this.config.axesKind !== 'spider' || !this.axes) return undefined;
    const entry = this.activeEntry;
    if (!entry.dataset.hasSlots()) return undefined;
    // Step keys are `spoke1`-based, the slot cursor is 0-based.
    return `spoke${entry.slotCursor.groupIndex + 1}`;
  }

  /**
   * The pixel-space line an existing error point may be dragged along, or null
   * if it is unconstrained (an ordinary point, or an axes that cannot say).
   *
   * ui/ uses this to axis-lock a cap's drag, so the invariant captureErrorCap
   * establishes keeps holding when the user adjusts the cap afterwards -- which
   * they are meant to do freely along the bar.
   */
  errorCapDragLine(datasetIndex: number, pointIndex: number)
    : { origin: { x: number; y: number }; direction: { x: number; y: number } } | null {
    const entry = this.datasetEntries[datasetIndex];
    if (!entry || !this.axes) return null;
    const relation = getErrorRelation(entry.dataset);
    if (!relation) return null;
    const cap = entry.dataset.getPixel(pointIndex);
    if (!cap) return null;
    const targetEntry = this.datasetEntries.find((e) => e.dataset.name === relation.of);
    if (!targetEntry) return null;

    // The cap's own datum, found by `matchCapToDatum` -- THE one rule, so the
    // drag locks to the line the record will actually resolve against.
    //
    // ⚑⚑ This said "found the same way resolveErrorBars finds it" while being a
    // THIRD implementation: `nearestPixel`, i.e. EUCLIDEAN distance in PIXEL
    // space. The record matches on the cap's INVARIANT axis (x for upper/lower,
    // y for left/right) in DATA space, because that is the axis a cap does not
    // move along and therefore the only one that identifies it.
    //
    // The two disagree exactly when a whisker is longer than the gap to the
    // next point -- ordinary on a decaying curve with wide error at its left-hand
    // end. A cap 100px below its own datum but 58px from the neighbour claimed
    // the neighbour, and constrainCap then projected it onto THAT datum's
    // vertical: the cap jumped sideways onto the bar next to it, and the delta
    // was re-parented with it, so the number moved to the wrong data point too.
    // Reported by David 2026-08-04, driving the asymmetric error-bar example.
    //
    // This is finding A6 recurring in a caller written after it (2026-08-03).
    // algorithms/errorBar.ts exports matchCapToDatum for precisely this reason:
    // "a check computed differently from the thing it checks is not a check."
    const targetData = this.dataValuesOf(targetEntry.dataset);
    const datumIndex = matchCapToDatum(targetData, this.dataOf(cap), relation.role);
    if (datumIndex < 0) return null;
    const datum = targetEntry.dataset.getPixel(datumIndex);
    if (!datum) return null;
    const origin = { x: datum.x, y: datum.y };
    const direction = capFreeDirection(this.axes, origin, relation.role);
    if (!direction) return null;
    return { origin, direction };
  }

  /** Find-or-create `${base} ${role}` related to `targetName`, and put a cap in
   * it. Shared by the dragged cap and its mirror so both take exactly the same
   * path -- a mirrored cap is an ordinary point in an ordinary series, which is
   * the whole model. */
  private addCapTo(
    base: string,
    role: ErrorRole,
    targetName: string,
    capPixel: { x: number; y: number }
  ): string | null {
    const name = errorSeriesName(base, role);
    const found = this.datasetEntries.findIndex((e) => e.dataset.name.trim() === name);

    if (found < 0) {
      const created = this.addDataset(name);
      // addDataset disambiguates rather than refuses, so it can hand back a
      // series called "SD upper (2)". Two near-identically named error series
      // diverging silently is worse than a refusal, so undo it and say so.
      if (this.datasetEntries[created]!.dataset.name.trim() !== name) {
        this.removeDataset(created);
        return `Could not create a series called "${name}".`;
      }
      const refusal = this.setErrorRelation(created, { role, of: targetName });
      if (refusal) {
        this.removeDataset(created);
        return refusal;
      }
      this.datasetEntries[created]!.dataset.addPixel(capPixel.x, capPixel.y);
      return null;
    }

    // The name is taken. Only reuse it if it is already exactly this error
    // series; anything else is the user's own series and adopting it would put
    // caps into data they placed for something else -- silently, since an
    // adopted series simply starts drawing whiskers. This is name-collision
    // handling, not a constraint on where error points may go: the points
    // themselves stay entirely free (David, 2026-07-16).
    const entry = this.datasetEntries[found]!;
    const existing = getErrorRelation(entry.dataset);
    if (!existing) {
      return `A series called "${name}" already exists. Use a different name.`;
    }
    if (existing.of !== targetName || existing.role !== role) {
      return `"${name}" already records ${existing.role} error for "${existing.of}".`;
    }
    entry.dataset.addPixel(capPixel.x, capPixel.y);
    return null;
  }

  /** Every dataset/series' own points plus color, for ui/'s canvas to render
   * all series at once (only the active one draggable -- see
   * Workspace.tsx). Box Plot glyphs (getBoxPlotGlyphs) are deliberately
   * still active-dataset-only: a box-and-whisker rendering per inactive
   * series is a real feature, not built here -- inactive Box Plot datasets
   * show as plain colored dots like any other series, a known, scoped
   * simplification. */
  getAllDatasetsData(): DatasetPointsView[] {
    return this.datasetEntries.map((entry, index) => ({
      index,
      color: entry.dataset.colorRGB.getRGB(),
      active: index === this.activeDatasetIndex,
      points: entry.dataset.getAllPixels().map((p) => ({
        px: p.x,
        py: p.y,
        data: this.axes ? this.axes.pixelToData(p.x, p.y) : null,
      })),
    }));
  }

  /** The export column headers, from the axes' own contract (checkpoint 76).
   *
   * NOT `config.valueLabels`, which is hardcoded per graph type and had
   * *diverged* from what the axes says: Bar `['value']` vs `['Label','Y']`,
   * CCR `['t','value']` vs `['Time','Magnitude']`, Ternary `['A','B','C']` vs
   * `['a','b','c']`. These strings are the column headers of every file we
   * emit. See core/exportValues.ts. */
  getExportFields(): string[] {
    // Categorical line (checkpoint 101): the X is a category, so instead of
    // BarAxes' ['Category','Y'] we emit a derived ordinal Position plus the Value.
    // v1.3 #9: once any point has been NAMED, the name is the independent
    // variable a reader actually wants, so it rides out as a Category column.
    //
    // ⚑ Order is Position, Category, VALUE -- independent variables first, then the
    // dependent one, which is what Bar's own inherited contract does (`Label`
    // before the value) and what the on-screen table already showed. The first cut
    // put Category last, reasoning that "reordering columns would break every
    // consumer of the files already in the wild". That reason was hollow: this
    // column cannot EXIST in a file older than v1.3, because nothing before it
    // could name a point, and an unnamed export is still exactly `Position, Value`.
    // There was no consumer to protect, only an incoherent order to inherit
    // (David, 2026-07-26). Absent until something is typed.
    if (this.config.id === 'categorical')
      return this.anyPointLabels() ? ['Position', 'Category', 'Value'] : ['Position', 'Value'];
    // Spider (v1.4): `Axis, Name, Value`, the same independent-variables-first
    // shape. Unconditional, unlike Categorical's Name column — a spoke's name is
    // asked for as part of CALIBRATING the axis, so the column always exists even
    // when a particular axis was left unnamed (it exports blank, and blank is the
    // honest reading: that axis's name was never transcribed).
    if (this.config.axesKind === 'spider') return ['Axis', 'Name', 'Value'];
    return this.axes ? exportLabelsFor(this.axes) : [...this.config.valueLabels];
  }

  /**
   * The value-column headers for the right-panel TABLE -- now the SAME source as
   * the export (checkpoint 92), so the screen and the file cannot disagree on
   * what a column is called. This closed the last v0.3 divergence: the table
   * drove off `config.valueLabels`, which showed `t`/`value` where the file
   * wrote `Time`/`Magnitude` and `A`/`B`/`C` where it wrote `a`/`b`/`c`.
   *
   * **Takes the LAST `dataDim` of the axes' labels.** The table is multi-series
   * and shows only the value dimensions -- it drops the pixel columns and, for
   * Bar, the leading `Category` (the category lives in metadata, not a value
   * column, and the table renders it as its own column via showCategoryColumn).
   * WPD's own contract always puts that category first (`dataProviders.js` ->
   * `['Label','Value']`, whose word we used until v1.3), so the value dimensions
   * are the trailing `dataDim` entries: Bar `['Category','Y']` -> `['Y']`, and
   * every other type's labels already equal its `dataDim`, so the slice is a
   * no-op there.
   *
   * Not `core/dataProviders.ts`: that is WPD's *single-dataset* table contract
   * and our table is multi-series -- a genuine model mismatch, not a wiring the
   * tenets say we owe just because it is ported (tenet 5). The user-facing job
   * was "screen == file", and the axes' labels deliver it directly. */
  getTableValueLabels(): string[] {
    // Categorical line: the table shows the measured Value; Position is a
    // derived export-only column (like the pixel columns), so it isn't a table
    // header -- keeping table headers == the value dimensions the canvas draws.
    if (this.config.id === 'categorical') return ['Value'];
    if (!this.axes) return [...this.config.valueLabels];
    return exportLabelsFor(this.axes).slice(-this.config.dataDim);
  }

  /** The date format (or null) for each table VALUE column, index-aligned with
   * getTableValueLabels() -- so the on-screen table can format a date-calibrated
   * column the same way the export does (v1.2 #16) instead of showing a raw
   * serial. Mirrors getTableValueLabels' slice so the indices line up. Only XY
   * and CCR axes expose isDate/getInitialDateFormat; the rest yield all-null. */
  getTableDateFormats(): (string | null)[] {
    if (this.config.id === 'categorical') return [null];
    if (!this.axes) return this.config.valueLabels.map(() => null);
    const axes = this.axes as unknown as {
      isDate?(i: number): boolean;
      getInitialDateFormat?(i: number): string | null;
    };
    return exportLabelsFor(this.axes)
      .map((_l, i) => (axes.isDate?.(i) ? axes.getInitialDateFormat?.(i) ?? null : null))
      .slice(-this.config.dataDim);
  }

  /** One export row per point of a dataset, values per WPD's own contract
   * (core/exportValues.ts): Bar carries its Label, CCR's time is formatted
   * rather than emitted as a julian float, and a date-calibrated XY column is
   * formatted. Pixels ride along for the flat export, which reports them.
   *
   * Deliberately separate from getAllDatasetsData's `data`, which stays a raw
   * pixelToData projection -- that feeds the canvas and the table, which want
   * numbers, not a formatted date string or a label in slot 0. The contract is
   * about what leaves the app, not what it draws with. */
  /**
   * The shape this session's data takes in an export file — the one place that
   * knows, because it depends on BOTH the graph type and the active series.
   *
   * ⚑ Box Plot is reachable two ways: as its own graph type, and as a toggle that
   * gives a Bar session Min/Q1/Median/Q3/Max groups. So a static config field
   * cannot answer alone — a bar-with-box-groups series exports as tuples while the
   * type says nothing. That dynamic case is what the UI's old `hasSlots()`
   * test was really catching, mixed in with three identity checks.
   *
   * ⚑ And a grouped type whose slots are INDEPENDENT (a spider) is flat: its rows
   * are per reading, carrying the axis each was captured on, across every series.
   * The tuple table would give one series read off the nearest ray — the v1.4
   * audit's export defect.
   */
  getExportShape(): 'flat' | 'tuples' | 'bins' {
    if (this.config.exportShape) return this.config.exportShape;
    const grouped = this.activeEntry.dataset.hasSlots();
    return grouped && this.config.tupleMembers !== 'independent' ? 'tuples' : 'flat';
  }

  getExportRows(
    datasetIndex: number,
    mode: PrecisionMode = 'auto'
  ): { px: number; py: number; values: ExportValue[]; role?: PointRole }[] {
    const entry = this.datasetEntries[datasetIndex];
    if (!entry || !this.axes) return [];
    const axes = this.axes;
    const pixels = entry.dataset.getAllPixels();
    // An interpolation-assist point rides out with its role (v1.3): an ASSIGNED
    // anchor and a spline-DERIVED sample are not the same claim about the figure,
    // and a file that flattens them hands the reader invented points wearing the
    // record's clothes -- the exact thing tenet 9 exists to prevent, and the thing
    // StarryDigitizer's 194k-curve database can no longer undo. Absent (undefined)
    // for an ordinary point, so a series with no interpolation exports byte-for-byte
    // as before.
    const roleAt = (i: number): PointRole | undefined => {
      const r = pixels[i]?.metadata?.['role'];
      return r === 'anchor' || r === 'interpolated' ? r : undefined;
    };
    // Categorical line (checkpoint 101): X is the point's ORDINAL position,
    // DERIVED from left-to-right pixel order at export time -- never stored, so
    // it is a view of the recorded pixels, not a fabricated coordinate (tenet 9).
    // Value comes from the BarAxes value calibration.
    if (this.config.id === 'categorical') {
      // Must stay index-aligned with getExportFields() -- same condition, so the
      // Category cell exists exactly when the header does.
      const withCategory = this.anyPointLabels();
      const rank: number[] = [];
      pixels
        .map((p, i) => ({ i, x: p.x }))
        .sort((a, b) => a.x - b.x)
        .forEach((o, k) => { rank[o.i] = k + 1; });
      return pixels.map((p, i) => {
        // Rank is an exact ordinal (never rounded); the value is a Bar reading,
        // rounded to this pixel's resolution like every other exported value.
        const raw = axes.pixelToData(p.x, p.y)[0] ?? null;
        const res = mode === 'full' ? null : halfPixelResolution(axes, p.x, p.y)[0];
        const value = typeof raw === 'number' && res != null ? roundToResolution(raw, res) : raw;
        const role = roleAt(i);
        const label = p.metadata?.['label'];
        // Position, Category, Value -- independent first, dependent last, matching
        // getExportFields() and the on-screen table. An unnamed point in a figure
        // that HAS names exports a BLANK cell, so a reader can see which ticks were
        // actually transcribed. (Bar's own Label column carried WPD's inherited
        // `Bar<i>` fallback too, in core/exportValues.ts's valueAtPixel -- fixed
        // 2026-07-30, the same tenet-9 pass that found it via this exact comment.)
        const values: ExportValue[] = withCategory
          ? [rank[i]!, typeof label === 'string' ? label : '', value]
          : [rank[i]!, value];
        return { px: p.x, py: p.y, values, ...(role ? { role } : {}) };
      });
    }
    // Spider (v1.4): `Axis, Name, Value` -- the direct analogue of the categorical
    // branch's `Position, Category, Value`, independent variables first.
    //
    // ⚑ THE VALUE IS READ AGAINST THE SPOKE THE POINT WAS CAPTURED ON, taken from
    // its slot, NOT from whichever ray it happens to sit nearest. Those
    // agree for a click that landed on its axis and diverge exactly when the user
    // mis-clicked -- and the nearest-ray reading would then export a number off a
    // DIFFERENT axis's scale while the table still showed it in the slot they
    // aimed at. A wrong number with nothing on screen wrong is the failure this
    // codebase keeps rediscovering, so the axis identity is carried, never guessed.
    if (this.config.axesKind === 'spider') {
      const spider = axes as unknown as SpiderAxes;
      // Invert the tuple table once: pixel index -> which spoke's slot it fills.
      const spokeOf: number[] = [];
      entry.dataset.getAllTuples().forEach((tuple) => {
        tuple.forEach((pixelIndex, groupIndex) => {
          if (pixelIndex != null) spokeOf[pixelIndex] = groupIndex;
        });
      });
      return pixels.map((p, i) => {
        const spokeIndex = spokeOf[i];
        const role = roleAt(i);
        // A point outside every tuple has no axis to be read against. Export it as
        // unmeasured rather than defaulting it onto spoke 0, which would put a real
        // number in the row of an axis nobody assigned it to.
        if (spokeIndex == null) {
          return { px: p.x, py: p.y, values: [null, '', null] as ExportValue[], ...(role ? { role } : {}) };
        }
        const projection = spider.projectOnSpoke(spokeIndex, p.x, p.y);
        const raw = projection?.value ?? null;
        const res = mode === 'full' ? null : halfPixelResolution(axes, p.x, p.y)[0];
        const value = typeof raw === 'number' && res != null ? roundToResolution(raw, res) : raw;
        const values: ExportValue[] = [spokeIndex + 1, spider.getSpokeLabel(spokeIndex), value];
        return { px: p.x, py: p.y, values, ...(role ? { role } : {}) };
      });
    }
    return pixels.map((p, i) => {
      const role = roleAt(i);
      return {
        px: p.x,
        py: p.y,
        values: valueAtPixel(i, axes, p, mode),
        ...(role ? { role } : {}),
      };
    });
  }

  /**
   * Move a click onto the ray of the spoke it is being captured against (v1.4).
   * A no-op for every other graph type, and for a pixel with no spoke to sit on.
   *
   * ⚑ THE RECORD IS SNAPPED, and that is deliberate (David, 2026-07-27). A spoke
   * is a 1-D scale: the value is the click projected onto the ray, and the
   * perpendicular component is discarded either way. What settles it is not the
   * arithmetic but the FEEDBACK LOOP — once the point visibly sits on the axis,
   * the user stops aiming perpendicular-accurately, correctly, because they can
   * see it does not matter. From that moment the perpendicular offset no longer
   * means "this person mis-clicked"; it means "this person was told not to care."
   * Storing it would preserve a number that LOOKS like an error signal and is not,
   * which a downstream reader would reasonably trust. Better not to keep it.
   *
   * The wrong-axis check therefore moves to CAPTURE time — see
   * previewSpiderCapture, whose answer is shown as the click happens and never
   * stored, matching the fact that no other graph type records such a thing.
   *
   * Known cost, accepted: a snapped point does not carry its original observation,
   * so adjusting a spoke's calibration afterwards re-projects from the snapped
   * position rather than from the raw click. The difference is second order (it
   * scales with the perpendicular offset times the angle change), and the offset
   * is now small by construction because the user can see the ray.
   */
  /** Which spoke's slot an active-dataset point fills, or -1 if it fills none.
   * The tuple table is the only thing that knows: a pixel carries no axis of its
   * own, which is exactly why the value is never read off the nearest ray. */
  getSpokeIndexOfPoint(pointIndex: number): number {
    return this.spokeIndexOfPoint(pointIndex);
  }

  private spokeIndexOfPoint(pointIndex: number): number {
    for (const tuple of this.activeEntry.dataset.getAllTuples()) {
      const groupIndex = tuple.indexOf(pointIndex);
      if (groupIndex > -1) return groupIndex;
    }
    return -1;
  }

  /**
   * Tidy a boundary click onto the pie's rim — but only one that was aiming at it.
   *
   * ⚑ THE VALUE CANNOT MOVE. `PieAxes.snapToRim` scales the click's vector in the
   * (a, b) frame, and scaling does not change an atan2, so the recorded angle before
   * and after is the SAME number. This is cosmetic by construction, which is why it is
   * allowed to happen silently — unlike the spider's spoke snap, which really does
   * discard the off-ray distance and therefore has `previewSpiderCapture` to say so.
   *
   * ⚑ AND ONLY NEAR THE RIM, which is the donut. A click on an inner ring is entirely
   * legitimate — angles are scale-invariant, which is the whole reason ONE calibration
   * reads every ring — so snapping it out to the rim would drag the marker off the ink
   * it was measuring and make the app look like it had misunderstood the figure. The
   * band is a fraction of the radius rather than a pixel count so it scales with the
   * figure instead of being generous on a small one and useless on a large one.
   */
  /**
   * The pixel index of the boundary this click would CLOSE THE RING on, or null.
   *
   * ⚑ Public, and that is the whole design. A closing click that only works if you
   * already know it exists is the "shortcut-only path" the keystone rule names as a
   * failure, so the canvas asks this on hover and draws the target — the affordance is
   * on screen before it is used, not discovered by accident afterwards.
   *
   * Available only when closing is actually meaningful: a pie, calibrated, with a
   * sector open and at least two already recorded. One recorded sector plus an open
   * one is a two-slice pie in progress, where the second boundary click IS the closing
   * one by the ordinary path -- offering it there would fire on the user's normal
   * second click and cut the capture short.
   */
  ringClosingPixel(px: number, py: number): number | null {
    if (this.config.axesKind !== 'pie' || !this.axes) return null;
    const entry = this.activeEntry;
    const dataset = entry.dataset;
    const tuples = dataset.getAllTuples();
    const open = entry.slotCursor.tupleIndex;
    if (open === null) return null;
    // The sector in hand must be genuinely open, and cannot be the first one.
    if (open < 2) return null;
    if (tuples[open]?.[entry.slotCursor.groupIndex] != null) return null;
    // An exploded slice shares nothing with anyone, so it never closes a ring.
    if (this.pendingExplodedTuple !== null) return null;
    const firstIndex = tuples[0]?.[0];
    if (firstIndex == null) return null;

    const pie = this.axes as unknown as PieAxes;
    const radius = pie.getRadius();
    if (!(radius > 0)) return null;
    const first = dataset.getPixel(firstIndex);
    // The same band the rim snap uses, for the same reason: a fraction of the figure,
    // so it means one thing at every size.
    const within = radius * PIE_RIM_SNAP_FRACTION;
    return Math.hypot(px - first.x, py - first.y) <= within ? firstIndex : null;
  }

  private snapToRim(px: number, py: number): { x: number; y: number } {
    if (this.config.axesKind !== 'pie' || !this.axes) return { x: px, y: py };
    const pie = this.axes as unknown as PieAxes;
    const apex = this.pendingApex ?? undefined;
    const target = pie.snapToRim(px, py, apex);
    const origin = apex ?? pie.getCentre();
    const radius = pie.getRadius();
    if (!(radius > 0)) return { x: px, y: py };
    const clicked = Math.hypot(px - origin.x, py - origin.y);
    const rim = Math.hypot(target.x - origin.x, target.y - origin.y);
    if (Math.abs(clicked - rim) > radius * PIE_RIM_SNAP_FRACTION) return { x: px, y: py };
    return target;
  }

  private snapToSpoke(px: number, py: number, groupIndex: number): { x: number; y: number } {
    if (this.config.axesKind !== 'spider' || !this.axes) return { x: px, y: py };
    const spider = this.axes as unknown as SpiderAxes;
    const projection = spider.projectOnSpoke(groupIndex, px, py);
    if (!projection) return { x: px, y: py };
    const origin = spider.getOrigin();
    const spoke = spider.getSpokes()[groupIndex]!;
    return {
      x: origin.x + projection.alongPx * spoke.ux,
      y: origin.y + projection.alongPx * spoke.uy,
    };
  }

  /**
   * What a click at (px, py) would be captured as right now — the axis it would
   * fill, and whether it sits nearer a DIFFERENT one (v1.4, Spider).
   *
   * ⚑ Asked BEFORE the click is recorded, because the snap is what destroys the
   * evidence: afterwards the stored point is on its ray and there is no "off" left
   * to measure. The caller shows this as it happens and throws it away. Returns
   * null when there is nothing to say — a different graph type, no calibration, or
   * a click already nearest the axis it is filling.
   */
  previewSpiderCapture(px: number, py: number): {
    capturedOnLabel: string;
    nearestLabel: string;
    offRayPx: number;
  } | null {
    if (this.config.axesKind !== 'spider' || !this.axes) return null;
    const entry = this.activeEntry;
    if (!entry.dataset.hasSlots()) return null;
    const spider = this.axes as unknown as SpiderAxes;

    const groupIndex = entry.slotCursor.groupIndex;
    const own = spider.projectOnSpoke(groupIndex, px, py);
    const nearest = spider.nearestSpoke(px, py);
    if (!own || !nearest || nearest.index === groupIndex) return null;
    return {
      capturedOnLabel: spider.getSpokeLabel(groupIndex),
      nearestLabel: spider.getSpokeLabel(nearest.index),
      offRayPx: own.offRayPx,
    };
  }

  /**
   * The one place `activeDatasetIndex` is written for an actual SWITCH (as
   * opposed to a snapshot restore, which legitimately brings back consistent
   * state for whatever was active then). v2.0 pre-launch audit: an
   * in-progress exploded-slice apex capture is a tuple INDEX with no dataset
   * identity of its own -- it only ever meant "the tuple at this index in
   * whichever dataset is active." Switching the active dataset breaks that
   * meaning: `addDataPoint`'s own consumer of this state reads the CURRENTLY
   * active dataset's tuple at this index, so leaving it set would let a
   * discarded/unrelated apex silently attach to a tuple in the dataset just
   * switched TO. Found initially at `setActiveDataset`/`addDataset` calling
   * it directly-but-inconsistently; centralized here rather than re-adding
   * the same three-line clear at every switch site and risking a future one
   * being missed the way `addDataset` originally was. Same "more than one
   * entrance" class as reset()/restoreState()/loadCalibrated()'s own clears.
   */
  private switchActiveDataset(index: number): void {
    // A no-op "switch" to the dataset already active must not cancel an
    // in-progress capture on it -- e.g. re-clicking the current series tab.
    if (index === this.activeDatasetIndex) return;
    this.activeDatasetIndex = index;
    this.explodedApexPending = false;
    this.pendingExplodedTuple = null;
    this.pendingApex = null;
  }

  /** Switches which dataset new points/slot actions apply to.
   * No-op for an out-of-range index. */
  setActiveDataset(index: number): void {
    if (index < 0 || index >= this.datasetEntries.length) return;
    this.switchActiveDataset(index);
  }

  /** Adds a new, empty dataset/series and makes it active. Returns its
   * index. Deliberately not gated on isCalibrated() here (a session always
   * has >= 1 dataset even pre-calibration, by construction) -- ui/'s
   * Workspace.tsx gates the "Add Series" button on calibration state
   * instead, matching how Place Point/Segment Fill's own buttons are
   * disabled pre-calibration while their session methods just no-op. */
  addDataset(name?: string): number {
    const entry = this.buildDatasetEntry(this.freeDatasetName(name), this.datasetEntries.length);
    this.datasetEntries.push(entry);
    this.switchActiveDataset(this.datasetEntries.length - 1);
    return this.activeDatasetIndex;
  }

  /** A name no existing series holds.
   *
   * The auto-namer walks `Series N` until N is free rather than trusting
   * `nextDatasetNumber` alone -- the counter only tracks names *it* issued, so
   * renaming a series onto a number it hasn't reached yet used to collide
   * ("Series 1" -> "Series 2", Add -> a second "Series 2"). Verified by
   * execution 2026-07-16; the counter's own comment claimed uniqueness it
   * couldn't hold. Same walk as WPD's own default-name loop
   * (`datasetManagement.js:53-56`).
   *
   * A caller-supplied name is disambiguated rather than refused, because
   * addDataset's callers pass names the *user* did not type (the load path,
   * tests). A name the user typed goes through renameDataset, which refuses --
   * matching WPD's own split between bumping its default and rejecting yours. */
  private freeDatasetName(requested?: string): string {
    const existing = this.datasetEntries.map((e) => e.dataset.name);
    if (requested !== undefined) return uniqueDatasetName(requested, existing);
    let name = `Series ${this.nextDatasetNumber}`;
    while (existing.some((other) => other.trim() === name)) {
      this.nextDatasetNumber += 1;
      name = `Series ${this.nextDatasetNumber}`;
    }
    this.nextDatasetNumber += 1;
    return name;
  }

  /** The names of every series except the one at `index`. */
  private otherDatasetNames(index: number): string[] {
    return this.datasetEntries.filter((_, i) => i !== index).map((e) => e.dataset.name);
  }

  /** Why the series at `index` can't be called `name`, or null if it can.
   *
   * Read-only, so ui/ can call it on every keystroke to show the reason as the
   * user types rather than only once they look away. See engine/seriesNames.ts
   * for why the rule exists and where it comes from. */
  datasetNameError(index: number, name: string): string | null {
    return datasetNameError(name, this.otherDatasetNames(index));
  }

  /** Removes a dataset/series. Always keeps at least one -- a no-op if only
   * one remains, or the index is out of range. Picks a sensible fallback
   * active index if the removed one was active or before it. */
  removeDataset(index: number): void {
    if (this.datasetEntries.length <= 1) return;
    if (index < 0 || index >= this.datasetEntries.length) return;
    const removedName = this.datasetEntries[index]!.dataset.name;
    const removingActive = index === this.activeDatasetIndex;
    this.datasetEntries.splice(index, 1);
    // A removed series takes its bars with it, so any category only IT owned
    // is now an orphan -- see pruneOrphanedCategories for what a ghost row
    // costs the user.
    this.pruneOrphanedCategories();
    // Nothing may keep pointing at a series that is gone (engine/errorRelation.ts).
    clearErrorRelationsTo(this.getDatasets(), removedName);
    if (this.activeDatasetIndex >= this.datasetEntries.length) {
      this.activeDatasetIndex = this.datasetEntries.length - 1;
    } else if (this.activeDatasetIndex > index) {
      this.activeDatasetIndex -= 1;
    }
    // v2.0 pre-launch audit: removing the ACTIVE dataset destroys whatever
    // tuple array a pending exploded-slice apex was pinned to -- see
    // switchActiveDataset's own comment. Removing a DIFFERENT dataset leaves
    // the active one's identity (and any pending capture on it) untouched
    // even though its numeric index may shift above, so this must fire only
    // when the removed dataset WAS the active one.
    if (removingActive) {
      this.explodedApexPending = false;
      this.pendingExplodedTuple = null;
      this.pendingApex = null;
    }
  }

  /** Renames a series, refusing a duplicate or blank name.
   *
   * Returns the reason for a refusal, or null on success -- strict rather than
   * permissive because a duplicate name makes the error-capture model's
   * series-to-series relationship ambiguous (docs/error-bars-design.md), and a
   * session that can hold an invalid name is one an export or a save can catch
   * mid-edit. ui/ keeps the in-progress text in its own draft and only calls
   * this once the name is one we'd accept, so typing is never fought.
   *
   * Stores the trimmed name: " Sample A " and "Sample A" are the same column
   * header, so treating them as distinct series would defeat the check. */
  renameDataset(index: number, name: string): string | null {
    const entry = this.datasetEntries[index];
    if (!entry) return null;
    const error = this.datasetNameError(index, name);
    if (error) return error;
    const oldName = entry.dataset.name;
    entry.dataset.name = name.trim();
    // The error model relates series BY NAME, so a rename has to carry its own
    // relations with it or the link silently goes stale -- the whisker just
    // stops being drawn (engine/errorRelation.ts).
    retargetErrorRelations(this.getDatasets(), oldName, entry.dataset.name);
    return null;
  }

  setDatasetColor(index: number, rgb: [number, number, number]): void {
    const entry = this.datasetEntries[index];
    if (!entry) return;
    entry.dataset.colorRGB = new Color(rgb[0], rgb[1], rgb[2]);
  }

  /**
   * Tag a dataset as one LAYER of a stacked-bar group (v2.0, Phase 5) — an
   * arbitrary shared string naming the stack (e.g. "left"/"right" for the
   * two independent sides of a diverging chart, or any name that groups the
   * participating series). Stored as ordinary dataset-level metadata
   * (errorRelation's own mechanism, `core/dataset.ts`'s getMetadata/
   * setMetadata), so it round-trips through project save/load and undo/redo
   * with zero new serialization code.
   *
   * ⚑ Capture itself needs nothing special once a dataset is tagged — each
   * segment is still its own ordinary drag-box (BAR_AXES_CONFIG). What DOES
   * change is the derived VALUE: see its `derivedTupleValue.compute`, which
   * reads this tag back via getTupleRows' ctx and switches to an unsigned
   * span, because a stacked segment's near end is never the chart's
   * declared baseline — not even the bottommost layer — so the ordinary
   * baseline-relative/floating-direction sign convention does not apply.
   * Pass `null` to remove a dataset from whichever stack it was in.
   */
  setDatasetStackGroup(index: number, group: string | null): void {
    const entry = this.datasetEntries[index];
    if (!entry) return;
    const existing = entry.dataset.getMetadata();
    if (group === null) {
      const { stackGroup: _dropped, ...rest } = existing;
      entry.dataset.setMetadata(rest);
    } else {
      entry.dataset.setMetadata({ ...existing, stackGroup: group });
    }
  }

  getDatasetStackGroup(index: number): string | null {
    const entry = this.datasetEntries[index];
    if (!entry) return null;
    const group = entry.dataset.getMetadata()['stackGroup'];
    return typeof group === 'string' ? group : null;
  }

  /** Enter an already-calibrated state directly from a pre-built axes +
   * dataset array, bypassing the click-by-click step walk -- the load half
   * of checkpoint 25's project save/load (see engine/projectFile.ts),
   * generalized in checkpoint 30 from a single dataset to however many the
   * loaded project has. Restores `placed` (so calibration handles still
   * render/drag correctly) from `axes.calibration`'s points, in the same
   * step order runCalibration wrote them in -- the same narrow duck-typed-
   * cast precedent as getBoxPlotGlyphs's read of calculateOrientation.
   * Global field values (CCR's Chart Start Time) are restored via the
   * optional AxesTypeConfig.extractGlobalValues -- buildAxes's inverse,
   * defined only where there's something to extract. Falls back to one
   * fresh dataset if given none, matching the invariant every other path
   * through this class maintains (a session always has >= 1 dataset). */
  /**
   * Drop points that belong to no tuple, on a type whose tuples ARE the axes.
   *
   * Returns how many were dropped, so a caller can say so. Only applies where the
   * slot carries the datum's identity (`tupleMembers: 'independent'`): on a box
   * plot a stray point is an incomplete box, which is a different question with a
   * different answer.
   */
  private dropAxislessPoints(): number {
    if (this.config.tupleMembers !== 'independent') return 0;
    let dropped = 0;
    for (const entry of this.datasetEntries) {
      const dataset = entry.dataset;
      // ⚑ No `hasSlots()` guard. A dataset that arrived with no slots at all
      // has no tuples either, so EVERY one of its points is axis-less — which is
      // exactly the case this is for, not one to skip. (It was written with that
      // guard first, and the file-with-no-groups test said so.)
      const owned = new Set<number>();
      for (const tuple of dataset.getAllTuples()) {
        for (const pixelIndex of tuple) if (pixelIndex != null) owned.add(pixelIndex);
      }
      // Highest index first, so the earlier indices stay valid as later ones go.
      for (let i = dataset.getCount() - 1; i >= 0; i--) {
        if (owned.has(i)) continue;
        dataset.removePixelAtIndex(i);
        dataset.refreshTuplesAfterPixelRemoval(i);
        dropped += 1;
      }
      entry.slotCursor = this.computeSlotCursorFor(dataset);
    }
    return dropped;
  }

  /** v2.0: `categoryAxis` is the file's own canonical category list (see
   * engine/projectFile.ts's serializeProject/deserializeProject, which now
   * carry it through PlotData the same way captureState/restoreState already
   * do for undo) -- omitted falls back to a fresh empty one, exactly as a
   * brand-new session already starts. Without this parameter, opening a
   * saved bar/box-plot project silently dropped every category's shared
   * identity: renaming would no longer propagate to anything, since a freshly
   * constructed session's own empty CategoryAxis has no relation to the one
   * the file's category names actually pointed at (found via the "round-trips
   * a Box Plot session" test, once usesCategoryAxis widened to cover it). */
  loadCalibrated(axes: A, datasets: Dataset[], categoryAxis?: CategoryAxis): void {
    this.categoryAxis = categoryAxis ?? new CategoryAxis();
    this.placed = {};
    const cal = (axes as unknown as { calibration: Calibration | null }).calibration;
    // ⚑ THE SHAPE COMES FROM THE FILE, not from the config. A variable-length
    // calibration has no shape until something says how long it is, and on this
    // entrance the loaded axes is the only thing that knows: a 9-spoke spider
    // reopened into a session still sitting at the default 3 would render 3
    // handles, walk 3 steps, and re-save a project with six axes deleted. Same
    // "the model has more than one entrance" class as the guards below, reached by
    // a different route — there, a file skipped a refusal; here, a file's own
    // shape is overwritten by a default.
    if (cal && this.config.repeatingStep) {
      this.repeatCount = Math.max(this.config.repeatingStep.min, cal.getCount() - this.config.fixedSteps.length);
    }
    if (cal) {
      this.getSteps().forEach((step, i) => {
        const cp = cal.getPoint(i);
        if (!cp) return;
        const values = step.valueFields.map((vf) =>
          String(vf.field === 'dx' ? cp.dx : vf.field === 'dy' ? cp.dy : (cp.dz ?? ''))
        );
        this.placed[step.key] = { px: cp.px, py: cp.py, values };
      });
    }
    this.stepIndex = this.getSteps().length;
    this.pendingPixel = null;
    // ⚑ THE THIRD ENTRANCE (found alongside restoreState's own fix, 2026-07-30,
    // same audit recipe). A project FILE has no serialized concept of "an
    // exploded-slice capture was mid-way through" -- there is nowhere for one
    // to have come FROM here, unlike restoreState's undo/redo, where the
    // in-progress gesture genuinely is document state to bring back. So this
    // entrance's fix is a plain reset, not a restore: without it, opening any
    // new project while mid-explode on a DIFFERENT figure left a stale tuple
    // index pointing into a dataset that has nothing to do with it -- the
    // same silent-forever-swallowed-clicks failure restoreState's fix
    // prevents, reached a third way.
    this.explodedApexPending = false;
    this.pendingExplodedTuple = null;
    this.pendingApex = null;

    this.globalValues = this.config.extractGlobalValues?.(axes) ?? {};
    // Options come back from the axes instance itself, so a reopened project
    // keeps the settings it was calibrated with (its log scales, orientation,
    // units) instead of silently reverting to defaults and changing every
    // value on screen. Falls back to defaults for a config with no options.
    // MUST precede checkGuards below: the log-scale guards are conditional on
    // these very options.
    this.optionValues =
      this.config.extractOptions?.(axes) ??
      defaultOptionValues(this.config as unknown as AxesTypeConfig<CalibratedAxes>);
    // ⚑ THE SECOND DOOR (finding A3, 2026-07-17). checkGuards used to run in
    // runCalibration ONLY -- so every refusal was click-path-only, and opening a
    // *file* bypassed all of them. `plotData.deserialize` calls `axes.calibrate`
    // directly, and every axes class reports success on degenerate input, so a
    // project holding a log axis through zero, or two calibration points on one
    // pixel, opened clean and reported no error while reading back `null` for
    // every value. A file the click path would refuse to build was openable.
    //
    // This is checkpoint 69's lesson for the THIRD time -- 69 found it, 72's
    // whole point was "fix the guard CLASSES, not two more instances", and 77
    // reproduced it in brand-new code hours after reading 72. The class is
    // "guards belong in the model, and the model has more than one entrance."
    // Both doors are now guarded; there is no third (`axes` is only assigned
    // here and in runCalibration).
    //
    // Surfaced, NOT refused -- and that is deliberate. The dedupe below sets the
    // precedent: "refusing it would strand data the previous version wrote."
    // Refusing to open would hide the user's own points from them to punish a
    // calibration they may not have made. So the axes loads, every point still
    // renders, and the reason is on screen; dragging any handle re-runs
    // runCalibration, which re-guards. Visible and recoverable beats silent and
    // pristine (tenet 1).
    this.calibrationError = cal
      ? checkGuards(this.config as unknown as AxesTypeConfig<CalibratedAxes>, cal, this.optionValues, this.globalValues, this.getSteps())
      : null;
    // ⚑ THE AXES CLASS'S OWN VERDICT, which the file door was throwing away.
    // `core/plotData.ts` calls `calibrate()` and pushes the axes whatever it
    // answers, so a project whose calibration value is unparseable -- a
    // hand-edited file, a truncated one, a foreign importer's output -- opened
    // with NO error and read 0 for every point, while the click path refused
    // the identical input by name. `checkGuards` covers log-through-zero,
    // coincident pixels and collinearity; it deliberately leaves parseability
    // "to the parser", and on this entrance nobody was listening to the
    // parser. Surfaced rather than refused, matching the decision the rest of
    // this method documents: the user sees their points AND the reason.
    // (Round-2 audit.)
    const axesSelfCheck = axes as unknown as { isCalibrated?: () => boolean } | null;
    if (!this.calibrationError && axesSelfCheck?.isCalibrated?.() === false) {
      this.calibrationError =
        'This project\u2019s calibration could not be read \u2014 check the calibration values, then press Calibrate to redo it.';
    }
    this.axes = axes;
    const finalDatasets = datasets.length > 0 ? datasets : [new Dataset(this.config.dataDim)];
    // De-duplicate on load, don't refuse. A project can arrive violating the
    // uniqueness invariant the rest of the app now depends on -- our own 0.2.0
    // files can, because the auto-namer collided with renamed series (see
    // freeDatasetName), and a WPD project is only as unique as its own guard.
    // Renaming the later collisions keeps the file openable; refusing it would
    // strand data the previous version wrote. Only names that actually clash
    // change, so an unaffected project is untouched.
    //
    // Deliberately does NOT retargetErrorRelations, unlike renameDataset. A
    // dedupe rename is a disambiguation, not a change of identity: the FIRST
    // occurrence keeps the name, so a relation reading `of: "Sample A"` still
    // resolves -- to that first series, which is the only reading the file
    // supports. Cascading here would repoint it onto the collision that was
    // just renamed away, i.e. would move the link to the wrong series. A file
    // with two "Sample A"s never said which one its error belonged to; first
    // wins, and that is why checkpoint 75 had to make names unique going in.
    const settledNames = dedupeDatasetNames(finalDatasets.map((d) => d.name));
    this.datasetEntries = finalDatasets.map((dataset, i) => {
      dataset.name = settledNames[i]!;
      return {
        dataset,
        slotCursor: this.computeSlotCursorFor(dataset),
      };
    });
    this.activeDatasetIndex = 0;
    // The second entrance again (v1.4). A loaded spider's groups come from the
    // file's own datasets, but a project written before the names existed -- or
    // one whose series was added without them -- would otherwise show numbered
    // slots next to a calibration that knows every axis's name. Runs AFTER the
    // entries are built so it can see which datasets already hold points.
    this.applyAxesDerivedSlots();
    // ⚑ A POINT WITH NO AXIS IS NOT A DATUM (David, 2026-07-27): "a point that
    // belongs to no tuple carries NO meaning, and should not be allowed."
    //
    // On an N x 1D chart the datum is the PAIR — the vector and the position along
    // it — so a pixel outside every tuple stands for no number and belongs in no
    // row. It is a mark on an image, not data. The click path cannot make one
    // (every capture files into a slot), so the file is the door, which is the same
    // second entrance the guards above exist for.
    //
    // ⚑ AFTER the slots are named, not before: a loaded dataset gets its point
    // groups from the axes here, so running this any earlier asks "is it in a
    // tuple?" of a dataset that has not been given its tuples yet, and the answer
    // is a meaningless no. (It was written above first, and both tests said so.)
    this.dropAxislessPoints();
  }

  /** Finds the first open slot slot across a dataset's tuples (same
   * target nextSlot would walk to), or "new tuple" if none -- used
   * by loadCalibrated for every loaded dataset, since the cursor isn't part
   * of the serialized project file (see engine/projectFile.ts). Takes an
   * explicit dataset (generalized in checkpoint 30 from a no-arg version
   * that only ever recomputed "the" dataset's cursor) so it can run once per
   * loaded dataset. */
  private computeSlotCursorFor(dataset: Dataset): SlotCursor {
    if (!dataset.hasSlots()) {
      return { tupleIndex: null, groupIndex: 0 };
    }
    const tuples = dataset.getAllTuples();
    for (let tupleIndex = 0; tupleIndex < tuples.length; tupleIndex++) {
      const groupIndex = tuples[tupleIndex]!.indexOf(null);
      if (groupIndex > -1) {
        return { tupleIndex, groupIndex };
      }
    }
    return { tupleIndex: null, groupIndex: 0 };
  }

  /** Handle a click while in Calibrate tool mode: advances the current calibration
   * step. Ignored once already calibrated (redo the walk via "Reset calibration"
   * instead, or drag an existing handle -- see updateCalibPointPixel). A step
   * with no valueFields (e.g. Polar's origin) is placed immediately, with no
   * value prompt shown. */
  handleCalibrationClick(px: number, py: number): CalibrationClickResult {
    if (this.axes) return 'ignored';
    const step = this.getCurrentStep();
    if (!step) return 'ignored';
    if (step.valueFields.length === 0) {
      this.placed[step.key] = { px, py, values: [] };
      this.stepIndex += 1;
      return 'point-placed';
    }
    this.pendingPixel = { px, py };
    return 'awaiting-value';
  }

  /** Handle a click while in Place Point tool mode: adds a data point to the
   * active dataset. Ignored until calibrated -- there's no axes to convert
   * the pixel through yet. When the active dataset has slots
   * configured (Box Plot etc.), the new pixel is also filed into a tuple at
   * that dataset's own cursor position, which then advances -- see
   * nextSlot and this file's header comment. Starting a new tuple
   * auto-labels it (see autoLabelTuple), matching real WPD's own
   * ManualSelectionTool.onMouseClick behavior for Bar axes datasets. */
  addDataPoint(px: number, py: number): DataPointClickResult {
    if (!this.axes) return 'ignored';
    const entry = this.activeEntry;
    const dataset = entry.dataset;
    if (dataset.hasSlots()) {
      // ⚑ AN EXPLODED SLICE'S APEX (v1.6, pie). Armed by the "Slice is exploded"
      // control, the first click after it places the slice's own TIP rather than a
      // boundary -- apex first, so the guide arc can be drawn about it WHILE its two
      // edges are placed, which is the whole point of having a guide.
      //
      // ⚑ It also BREAKS THE CHAIN, and that falls out of the geometry rather than
      // being a rule imposed on it: a pulled-out slice does not share its boundaries
      // with anyone -- there is a visible gap on both sides -- so its two edges are
      // its own and must be clicked as a pair. Chaining and explosion are mutually
      // exclusive per sector.
      if (this.explodedApexPending) {
        this.explodedApexPending = false;
        // ⚑ DISCARD A STRANDED CHAIN FIRST. Completing an ordinary sector pre-opens
        // the next one holding the shared boundary -- but a pulled-out slice shares
        // nothing, so that half-open tuple is now for a sector that will never exist.
        // Left behind it becomes a permanently incomplete row in the table and an
        // orphan in the file.
        //
        // ⚑ AND ITS PIXEL GOES WITH IT. This once read "the PIXEL stays: it is a real
        // click, and it still belongs to the completed sector before it" -- which is
        // false, and cost a duplicate every time. Chaining does not SHARE the boundary
        // pixel, it COPIES it (a pixel serialises with one {tuple, group}, so sharing
        // could not survive the file); the sector before already holds its own copy.
        // What was left behind was therefore a second marker sitting exactly on the
        // first, in no tuple, riding into the project file for good.
        const open = entry.slotCursor.tupleIndex;
        if (open !== null && dataset.getAllTuples()[open]?.some((v) => v === null)) {
          this.discardTuple(open);
        }
        // Start a fresh tuple for this slice; its apex rides on the tuple, and the
        // next two clicks fill its edges as an ordinary (unchained) pair.
        const t = dataset.getAllTuples().length;
        dataset.addEmptyTupleAt(t);
        entry.slotCursor.tupleIndex = t;
        entry.slotCursor.groupIndex = 0;
        this.pendingExplodedTuple = t;
        this.pendingApex = { x: px, y: py };
        // ⚑ NOT LABELLED HERE. A label is metadata on the tuple's PRIMARY PIXEL, and
        // this tuple has none yet -- the apex is not a pixel, it is per-tuple metadata,
        // so the tuple is genuinely empty until the first edge lands. `setTupleLabel`
        // returns silently in that case, which is how the exploded slice shipped with a
        // blank category between Slice0 and Slice2. It is labelled below, at the same
        // point the apex is written, for exactly the same reason: that is the first
        // moment there is somewhere to put it.
        return 'point-added';
      }
      // ⚑ CLOSING THE RING (v1.6, pie). The last sector's far edge is the FIRST
      // boundary already clicked, and David went looking for exactly that: "when I
      // come to the end of the ring, I naturally want to click the first point to
      // close it." Clicking near it lands the closing edge on that same pixel's
      // coordinates and stops chaining, because there is no next sector to open.
      //
      // ⚑ This does NOT auto-close. The click is still the user's, which is the point:
      // whether the last sector wraps round to the first boundary is something only
      // the figure knows -- a half pie does not -- so inferring "you must be finished"
      // from a click count would be modelling rather than measuring. All that changes
      // is that the closing click is recognised for what it is instead of quietly
      // opening a sector that will never exist.
      const closing = this.ringClosingPixel(px, py);
      if (closing !== null) {
        const first = dataset.getPixel(closing);
        // Its own copy at the same place, exactly as chaining makes one: a pixel
        // serialises with one {tuple, group}, so a shared index could not survive the
        // project file (the trap that made every sector after the first reopen missing
        // its opening edge).
        const copy = dataset.addPixel(first.x, first.y);
        dataset.addToTupleAt(entry.slotCursor.tupleIndex!, entry.slotCursor.groupIndex, copy);
        this.nextSlot();
        return 'point-added';
      }
      // Slots (Box Plot etc.) file each click into a tuple slot at the
      // cursor -- APPEND, then wire that new index in; the tuple layout, not the
      // point sequence, carries the meaning here, so insert-in-place must not run.
      const onSpoke = this.snapToSpoke(px, py, entry.slotCursor.groupIndex);
      const snapped = this.snapToRim(onSpoke.x, onSpoke.y);
      const index = dataset.addPixel(snapped.x, snapped.y);
      const { tupleIndex, groupIndex } = entry.slotCursor;
      if (tupleIndex === null) {
        // ⚑ BUILD THE TUPLE EMPTY AND FILE BY SLOT where the slots are independent
        // (N x 1D). `addTuple` always writes slot 0 — fine for a box plot, whose
        // cursor starts at Min and walks in order, and WRONG the moment a capture
        // can start anywhere: aiming at "Cost index" on a series with no readings
        // yet recorded the click as Axis 1, at the value that point projects to on
        // ray 1, while the tips bar, the status line and the live ray all said Cost
        // index. Found by the v1.4 release audit; `addSpiderTracePoints` already
        // documented the same trap and avoided it the same way.
        let newTupleIndex: number | null;
        // ⚑ THE PREDICATE HERE MUST MATCH `setSlotCursor`'S. That method was
        // loosened for Bar's 2-slot object tuple (v2.0 pre-launch audit) so a
        // half-dragged bar's missing corner could be aimed at directly -- but
        // this branch, the one that decides WHICH SLOT a click lands in when the
        // tuple does not exist yet, was left keyed on `independent` alone. A
        // cursor aimed at a NEW Bar tuple's slot 1 would therefore have its
        // click filed into slot 0 by `addTuple`, recording a bar's top corner as
        // its bottom one: a silently wrong reading, and the exact defect the
        // v1.4 spider audit already fixed for independent slots (see the note
        // above). No caller reaches it today -- the Bar table only ever aims at
        // an EXISTING tuple, and `nextSlot` resets groupIndex to 0 when it
        // hands back a new one -- which is precisely why it belongs in the
        // model: this is the third time a guard has sat in the session while
        // the model had another entrance.
        if (this.config.tupleMembers === 'independent' || this.isBarIntervalShape(dataset)) {
          newTupleIndex = dataset.getAllTuples().length;
          dataset.addEmptyTupleAt(newTupleIndex);
          dataset.addToTupleAt(newTupleIndex, groupIndex, index);
        } else {
          newTupleIndex = dataset.addTuple(index);
        }
        entry.slotCursor.tupleIndex = newTupleIndex;
        // v2.0: a bar tuple tries the smart cross-series prefill first (same
        // convenience plain Bar always had, ported from per-point to
        // per-tuple); every other slotted type keeps its plain default,
        // since prefillTupleCategoryLabel no-ops immediately for them.
        // v2.1: with the axis marked there is nothing to guess and nothing to
        // store -- the band answers, and reserveEmptyCategorySlot would append a
        // category BEYOND the declared count, which is exactly the drift
        // `ticksAreStale` exists to detect.
        if (
          newTupleIndex !== null &&
          !this.categoriesFollowBands() &&
          !this.prefillTupleCategoryLabel(dataset, newTupleIndex)
        ) {
          this.autoLabelTuple(newTupleIndex);
        }
      } else {
        dataset.addToTupleAt(tupleIndex, groupIndex, index);
      }
      this.nextSlot();
      // ⚑ CHAINED TUPLES (v1.6, pie). A pie's slices SHARE their boundaries: the end
      // of one sector is the start of the next, so making the user click each
      // boundary twice would be asking them to measure the same piece of ink again --
      // twenty clicks for a ten-slice pie, and two subtly different answers for one
      // line. Filing the same pixel into the next sector's opening slot turns it into
      // one click per boundary, which is how a pie is actually read.
      //
      // Deliberately NOT auto-closing the ring: whether the last sector wraps to the
      // first boundary is something only the figure knows (a half pie does not), and
      // guessing "you must be finished now" from a click count would be inferring
      // rather than measuring. Closing is the user's own final click.
      // The apex is written once the tuple has a primary pixel to hang it on.
      if (this.pendingExplodedTuple !== null && this.pendingApex) {
        const t = this.pendingExplodedTuple;
        if (dataset.getAllTuples()[t]?.[0] != null) {
          this.setSectorApex(t, this.pendingApex.x, this.pendingApex.y);
          // The tuple now has a primary pixel, so it finally has somewhere to hold a
          // name -- see the apex branch above for why this could not happen earlier.
          this.autoLabelTuple(t);
        }
        // Hold the suppression until this slice's SECOND edge lands, then release.
        if (dataset.getAllTuples()[t]?.every((v) => v !== null)) {
          this.pendingExplodedTuple = null;
          this.pendingApex = null;
        }
        return 'point-added'; // no chaining out of, or into, an exploded slice
      }
      if (this.config.chainTuples) this.chainToNextTuple(index);
      return 'point-added';
    }
    // Insert-in-place (v1.1 #1): splice the new point into the curve edge it
    // least disturbs instead of always appending, so re-adding a point removed
    // from the middle of a series lands back in curve order -- moving only that
    // one point. A normal left-to-right trace still appends (bestInsertionIndex
    // returns the end when the new point is nearest the last). Skipped for an
    // interpolation series, whose order is anchor-derived (same roles the NN sort
    // refuses to reorder, canSortByNearestNeighbour) -- there we keep the append.
    const pixels = dataset.getAllPixels();
    const anchorDerived = pixels.some(
      (p) => p.metadata?.['role'] === 'anchor' || p.metadata?.['role'] === 'interpolated'
    );
    if (anchorDerived) {
      dataset.addPixel(px, py);
      this.prefillCategoryLabel(dataset, dataset.getAllPixels().length - 1);
    } else {
      const index = bestInsertionIndex(pixels, { x: px, y: py });
      dataset.insertPixel(index, px, py);
      // Prefill by ROW index -- the position the table shows and the user reasons
      // about -- not by the categorical export's x-sorted Position, which is a
      // separate derivation and would surprise anyone reading the panel.
      this.prefillCategoryLabel(dataset, index);
    }
    return 'point-added';
  }

  /** Bulk-adds pixels produced by a Segment Fill trace (checkpoint 26, see
   * CLAUDE.md and engine/segmentFillRun.ts) to the active dataset --
   * addDataPoint above handles one click at a time; a trace can add
   * hundreds in one go. Ignored until calibrated, same as addDataPoint.
   * Deliberately not slot-aware, unlike addDataPoint -- a
   * continuous curve trace has no natural Min/Q1/Median/Q3/Max slot to file
   * into, and the current app's own Segment Fill tool
   * (ui-patches/engauge-algos.js) never interacts with slots either.
   * Returns the number of points actually added (0 if not calibrated or the
   * active dataset has slots configured). */
  addSegmentFillPoints(points: readonly { x: number; y: number }[]): number {
    if (!this.axes) return 0;
    const entry = this.activeEntry;
    if (entry.dataset.hasSlots()) return 0;
    for (const p of points) entry.dataset.addPixel(p.x, p.y);
    return points.length;
  }

  /**
   * Record an axis-aware colour trace's readings into this series' spider slots
   * (v1.4) — one entry per spoke, in spoke order, null where the trace declined to
   * offer one. The grouped sibling of addSegmentFillPoints: a spider trace DOES
   * have a natural slot for every reading, because it searched one ray per slot.
   *
   * ⚑ It fills the profile the capture cursor is on, and only its EMPTY slots. A
   * trace assists; it never overwrites a reading the user placed by hand, so
   * running it after fixing one axis by eye cannot silently undo that fix. The
   * cursor is then recomputed to the first slot still open, exactly as loading a
   * project does — so whatever the trace refused is what the user is next asked
   * for, and the refusals become the worklist.
   *
   * ⚑ Every point goes through the same snapToSpoke as a click. The tracer's
   * candidates are already on their rays, so this changes nothing today; it means
   * there is no second, unguarded route into the record if that ever stops being
   * true (the "the model has more than one entrance" rule).
   *
   * Returns how many readings were actually recorded.
   */
  addSpiderTracePoints(points: readonly ({ x: number; y: number } | null)[]): number {
    if (!this.axes || this.config.axesKind !== 'spider') return 0;
    const entry = this.activeEntry;
    const dataset = entry.dataset;
    if (!dataset.hasSlots()) return 0;

    let tupleIndex = entry.slotCursor.tupleIndex;
    let createdTuple = false;
    let added = 0;
    const slots = dataset.getSlotNames().length;
    for (let groupIndex = 0; groupIndex < Math.min(points.length, slots); groupIndex++) {
      const point = points[groupIndex];
      if (!point) continue;
      if (tupleIndex !== null && dataset.getAllTuples()[tupleIndex]?.[groupIndex] != null) continue;
      const snapped = this.snapToSpoke(point.x, point.y, groupIndex);
      const pixelIndex = dataset.addPixel(snapped.x, snapped.y);
      if (tupleIndex === null) {
        // Built empty and filled by SLOT, not via addTuple -- which puts its pixel
        // in slot 0. A trace whose first reading is for axis 2 (because axis 0 was
        // ambiguous) would otherwise have that reading filed against axis 0: the
        // right number on the wrong axis, which is worse than no number at all.
        tupleIndex = dataset.getAllTuples().length;
        dataset.addEmptyTupleAt(tupleIndex);
        createdTuple = true;
      }
      dataset.addToTupleAt(tupleIndex, groupIndex, pixelIndex);
      added++;
    }
    // The category label lives on the tuple's primary-group pixel, so it can only
    // be written once that slot exists -- same as the click path, which always
    // fills slot 0 first.
    if (createdTuple && tupleIndex !== null && dataset.getAllTuples()[tupleIndex]?.[0] != null) {
      this.autoLabelTuple(tupleIndex);
    }
    entry.slotCursor = this.computeSlotCursorFor(dataset);
    return added;
  }

  /** Bulk-adds bar/bin boxes detected by colour (v2.0 Phase 7, extended to
   * Histogram 2026-07-30 -- see engine/barDetectRun.ts), via the SAME
   * two-clicks-per-tuple path a manual drag-box uses (Workspace.tsx's
   * handleBoxRect). Gated to the two shapes a bounding box can fill:
   *
   * - Bar: the box's two OPPOSITE corners ARE a bar's two measured ends.
   * - Histogram: a bin's two slots are its TOP corners, averaged into one
   *   height by binFromCorners -- NOT opposite corners. Feeding it the true
   *   opposite corners would average the top edge with the baseline,
   *   silently halving every reading (the same defect this capability
   *   exists to avoid). So both filed points share the box's own top edge
   *   (`box.start.y`) -- only their x's differ.
   *
   * Box Plot has neither shape (five letter values), so it stays refused.
   * Returns how many boxes were added (0 if not calibrated or neither shape). */
  addBarDetectBoxes(boxes: readonly { start: { x: number; y: number }; end: { x: number; y: number } }[]): number {
    if (!this.axes) return 0;
    const dataset = this.activeEntry.dataset;
    const isBar = this.isBarIntervalShape(dataset);
    const isHistogramBin = this.isHistogramBinShape(dataset);
    if (!isBar && !isHistogramBin) return 0;
    // ⚑ Sorted into READING ORDER along the category axis before filing --
    // detectBlobs's own order is a top-to-bottom pixel scan (an
    // implementation detail of how the flood fill finds its seeds), which
    // for an ordinary baseline-anchored bar chart happens to read as
    // tallest-bar-first, not left-to-right. Real ordered categorical data
    // (e.g. "day 0, 4, 7, 14") reads as scrambled in scan order; sorted by
    // each box's own position along the category axis instead (x for a
    // normal vertical bar, y when the chart is rotated/horizontal), so the
    // captured tuples list the same way the figure itself reads. A
    // histogram is never rotated (no orientation option -- always upright),
    // so `rotated` naturally stays false there.
    const rotated = this.axes instanceof BarAxes && this.axes.isRotated();
    const sorted = [...boxes].sort((a, b) =>
      rotated ? a.start.y + a.end.y - (b.start.y + b.end.y) : a.start.x + a.end.x - (b.start.x + b.end.x)
    );
    for (const box of sorted) {
      this.addDataPoint(box.start.x, box.start.y);
      this.addDataPoint(box.end.x, isHistogramBin ? box.start.y : box.end.y);
    }
    return boxes.length;
  }

  /** Interpolation-assist (checkpoint 120, David's LIVE mode): the human drops a
   * handful of GUIDE POINTS along one curve and the tool fills the curve between
   * them (algorithms/interpolate.ts, a centripetal Catmull-Rom spline). This is
   * the v0.6 answer for MONOCHROME dash-differentiated technical figures, where
   * colour-filtering can't separate same-colour dashed lines and connectivity
   * (Segment Fill) can't follow a broken line -- see CLAUDE.md.
   *
   * ⚑ Tenet 9, the whole point: an anchor is the RECORD (a human ASSIGNED it --
   * judged by eye where the curve runs; not a measurement taken off the figure,
   * which is precisely why this tool exists for dashed monochrome curves no
   * filter can follow), the samples between are DERIVED. Both are marked, and
   * the distinction survives into the export, so a reader can weigh them
   * differently. We mark each pixel's role in its
   * own per-pixel metadata (core/dataset.ts) -- role:'anchor' vs role:'interpolated'
   * -- so a downstream consumer can tell measured from invented, and drop the
   * derived ones. StarryDigitizer does the opposite: it deletes the anchors and
   * keeps only the spline, so its 194k-curve database can't (its own author flags
   * this as needing a redesign).
   *
   * Adds one anchor and rebuilds the derived curve live. Ignored until calibrated
   * (like addDataPoint -- no axes to convert the pixel through yet) or if the
   * active dataset has slots (a continuous curve has no Min/Q1/... slot,
   * same reason Segment Fill declines). */
  addAnchorPoint(px: number, py: number): DataPointClickResult {
    if (!this.axes) return 'ignored';
    const entry = this.activeEntry;
    if (entry.dataset.hasSlots()) return 'ignored';
    entry.dataset.addPixel(px, py, { role: 'anchor' });
    this.registerRoleMetadataKey();
    this.rebuildInterpolation();
    return 'point-added';
  }

  /** Re-derive the interpolated samples of the active dataset from its anchors.
   * Drops every previously-derived point (role:'interpolated') and re-runs the
   * spline through the anchors in placement order, so the curve tracks live as
   * anchors are added, moved, or removed. Anchors keep their identity and exact
   * position; only the derived fill is regenerated. A dataset with fewer than two
   * anchors has no curve to fill -- the anchors stand alone. */
  private rebuildInterpolation(): void {
    const dataset = this.activeEntry.dataset;
    // Snapshot the anchors (the record) in their current order BEFORE clearing.
    const anchors = dataset
      .getAllPixels()
      .filter((p) => p.metadata?.['role'] === 'anchor')
      .map((p) => ({ x: p.x, y: p.y }));
    // Remove EVERY interpolation point -- anchors and derived alike -- high->low so
    // earlier indexes stay valid, then rebuild the whole series in CURVE ORDER.
    const pixels = dataset.getAllPixels();
    for (let i = pixels.length - 1; i >= 0; i--) {
      const role = pixels[i]!.metadata?.['role'];
      if (role === 'anchor' || role === 'interpolated') dataset.removePixelAtIndex(i);
    }
    if (anchors.length < 2) {
      // No curve with <2 anchors; re-add the lone anchor(s) unchanged so a single
      // guide point isn't silently dropped by the clear above.
      for (const a of anchors) dataset.addPixel(a.x, a.y, { role: 'anchor' });
      return;
    }
    // interpolateCurveOrdered returns the samples in CURVE ORDER, each tagged anchor
    // vs derived by construction (anchors carry their EXACT clicked coordinate -- no
    // float drift, no interior anchor lost to an exact-match miss). Re-add in that
    // order so the series reads as ONE monotonic pass along the curve -- anchors in
    // their true place, not parked in a block at the front with the fill "restarting"
    // after them (which read as points appearing at the beginning, and exported out
    // of order).
    for (const s of interpolateCurveOrdered(anchors)) {
      dataset.addPixel(s.x, s.y, { role: s.anchor ? 'anchor' : 'interpolated' });
    }
  }

  /** Register "role" as a per-pixel metadata key on the active dataset so it
   * round-trips through core/plotData.ts (the same registration box-plot labels
   * and error relations do). Idempotent. */
  private registerRoleMetadataKey(): void {
    const dataset = this.activeEntry.dataset;
    const keys = dataset.getMetadataKeys();
    if (!keys.includes('role')) dataset.setMetadataKeys([...keys, 'role']);
  }

  /** The role of each active-dataset point, index-aligned with getDataPoints()
   * (both map dataset.getAllPixels() in order). 'anchor'/'interpolated' for
   * interpolation-assist points, null for an ordinary placed/traced point. Lets
   * the UI draw anchors big and derived samples small (checkpoint 120). */
  getDataPointRoles(): (PointRole | null)[] {
    return this.getDataPointRolesFor(this.activeDatasetIndex);
  }

  /** The role of each point of ANY dataset, index-aligned with that dataset's
   * points (getAllDatasetsData / getExportRows for the same index).
   *
   * The active-series wrapper above drives the canvas; this indexed form is what
   * the multi-series spreadsheet and the export need, because "is this point
   * derived?" is a per-SERIES fact and both render every series at once. An
   * out-of-range index yields an empty list, like the other indexed getters. */
  getDataPointRolesFor(datasetIndex: number): (PointRole | null)[] {
    const entry = this.datasetEntries[datasetIndex];
    if (!entry) return [];
    return entry.dataset.getAllPixels().map((p) => {
      const r = p.metadata?.['role'];
      return r === 'anchor' || r === 'interpolated' ? r : null;
    });
  }

  /** Called when a new tuple starts, to give it a category identity. Used to
   * write a WPD-ported default like "Bar0" (axes.dataPointsLabelPrefix +
   * index) into metadata.label -- removed v2.0, 2026-07-30, for every tuple
   * type at once (found on Bar, then the identical bug live on Pie as
   * "Slice0"/"Slice1"): position already identifies a row; a name is the
   * user's to type, never invented (tenet 9), matching how Spider's own
   * spoke naming already worked (core/axes/spider.ts). Bar-family tuples
   * still need a distinct, ADDRESSABLE CategoryAxis slot reserved up front
   * so a later rename has somewhere to land (reserveEmptyCategorySlot);
   * every other type needs nothing here at all. */
  private autoLabelTuple(tupleIndex: number): boolean {
    const dataset = this.activeEntry.dataset;
    if (this.usesCategoryAxis(dataset)) return this.reserveEmptyCategorySlot(tupleIndex);
    return true;
  }

  /** The bar-family counterpart of autoLabelTuple's plain no-op: reserves a
   * fresh, unnamed categoryIndex. NOT `setTupleLabel(tupleIndex, '')` --
   * that reuses an EXISTING category by matching name, and two still-unnamed
   * bars must not collapse onto one shared '' category the instant a second
   * is added (naming one would then rename both). addCategory('') always
   * mints a distinct index instead. */
  private reserveEmptyCategorySlot(tupleIndex: number): boolean {
    const dataset = this.activeEntry.dataset;
    const tuple = dataset.getAllTuples()[tupleIndex];
    if (!tuple) return false;
    const pixels = tuple.filter((v): v is number => v !== null && v !== undefined);
    if (pixels.length === 0) return false;
    const target = pixels[0]!;
    const idx = this.categoryAxis.addCategory('');
    for (const pixelIndex of pixels) {
      const existing = dataset.getPixel(pixelIndex).metadata ?? {};
      if (pixelIndex === target) {
        dataset.setMetadataAt(pixelIndex, { ...existing, categoryIndex: idx });
      } else if ('categoryIndex' in existing) {
        const { categoryIndex: _dropped, ...rest } = existing;
        dataset.setMetadataAt(pixelIndex, rest);
      }
    }
    this.registerCategoryIndexMetadataKey(dataset);
    return true;
  }

  /**
   * The category label for a tuple (Box Plot's per-box name) in the active dataset.
   *
   * ⚑ SCANS THE WHOLE TUPLE rather than reading slot 0. The label is metadata on ONE
   * of the tuple's pixels, and which one depends on what was filled when it was typed
   * -- so a read fixed on slot 0 loses it the moment the name was set before slot 0
   * existed, and a read fixed on "the first non-null slot" loses it the moment an
   * EARLIER slot is filled afterwards. Scanning is the only version that keeps
   * agreeing with the write as the tuple fills up. `setTupleLabel` keeps exactly one
   * label per tuple, so the scan can stop at the first it finds.
   */
  getTupleLabel(tupleIndex: number, datasetIndex?: number): string {
    const dataset = this.datasetAt(datasetIndex);
    const tuple = dataset.getAllTuples()[tupleIndex];
    if (!tuple) return '';
    // v2.0: any bar-FAMILY tuple (Bar's interval, Box Plot's letter values)
    // resolves through the canonical CategoryAxis (metadata.categoryIndex),
    // not a per-tuple copied string -- see setTupleLabel's own comment for
    // why, and usesCategoryAxis's for exactly which shapes this covers.
    if (this.usesCategoryAxis(dataset)) {
      const idx = this.categoryIndexOfTuple(dataset, tupleIndex);
      return idx === null ? '' : (this.categoryAxis.getCategories()[idx] ?? '');
    }
    for (const pixelIndex of tuple) {
      if (pixelIndex === null || pixelIndex === undefined) continue;
      const label = dataset.getPixel(pixelIndex).metadata?.['label'];
      if (typeof label === 'string') return label;
    }
    return '';
  }

  /**
   * Set a tuple's category label. Returns whether it was actually stored.
   *
   * ⚑ THIS USED TO GO NOWHERE IN SILENCE. It wrote to the tuple's slot-0 pixel and
   * returned void if there was none -- so a name typed against a tuple whose slot 0
   * happened to be empty vanished with nothing on screen to say so. That is ordinary
   * use on a spider, whose slots are N x 1D: the table's empty cells exist precisely so
   * a reading can be aimed at a particular gap, so starting a profile on axis 2 leaves
   * slot 0 null. It also produced the pie's blank category by a second route (the apex
   * click creates the tuple wholly empty). One class of bug, two sightings.
   *
   * ⚑ ONE label per tuple, enforced on write. Writing to whichever pixel exists means
   * a rename can land on a DIFFERENT pixel than the original did; leaving both would
   * mean deleting a point could resurrect an old name.
   *
   * The remaining false is honest rather than silent: a wholly empty tuple has no
   * pixel to hang metadata on, and inventing one would put a mark on the figure the
   * user never made.
   *
   * ⚑ v2.0: a bar-interval tuple goes through the CategoryAxis instead of
   * copying a string per tuple (David's steer, Phase 3: "category axis
   * wiring + grouped bars") -- this is what lets renaming a category
   * propagate to every series sharing it, which a per-tuple string copy
   * structurally cannot do. The rule, and why it is NOT simply "always
   * rename in place": if this tuple is the tuple SOLE owner of its current
   * category, retyping renames it in place (safe -- nothing else is
   * affected, and this is what lets a genuine typo fix propagate once a
   * second series later adopts the same name). If the category is SHARED
   * with another series' bar, retyping instead reuses an existing category
   * with that exact name or creates a new one -- covering the real case
   * this needed fixing for (v1.3 #9's "series 2 has no Hemp bar": its
   * prefilled "Hemp" guess is wrong, and correcting it must not silently
   * rename series 1's genuinely-Hemp bar too).
   */
  setTupleLabel(tupleIndex: number, label: string): boolean {
    const dataset = this.activeEntry.dataset;
    const tuple = dataset.getAllTuples()[tupleIndex];
    if (!tuple) return false;
    const pixels = tuple.filter((v): v is number => v !== null && v !== undefined);
    if (pixels.length === 0) return false;
    const target = pixels[0]!;

    if (this.usesCategoryAxis(dataset)) {
      // v2.1: with the axis marked, the BAND is the category's identity, so
      // renaming a bar renames its band -- for every series at once, which is
      // correct, because one band is one category. None of the reuse-or-create
      // reasoning below applies: it exists to resolve WHICH category an
      // unmarked bar means, and a declared band leaves nothing to resolve.
      if (this.categoriesFollowBands()) {
        const band = this.categoryIndexOfTuple(dataset, tupleIndex);
        return band === null ? false : this.categoryAxis.renameCategory(band, label);
      }
      const existingRaw = dataset.getPixel(target).metadata?.['categoryIndex'];
      const existingIdx = typeof existingRaw === 'number' ? existingRaw : -1;
      let idx: number;
      if (existingIdx >= 0 && !this.categoryIndexHasOtherOwner(existingIdx, dataset, tupleIndex)) {
        // Sole owner of this category: renaming it in place is unambiguous
        // (no other bar, in any series, is affected) -- this is what lets a
        // genuine typo fix propagate once a SECOND series adopts it later.
        this.categoryAxis.renameCategory(existingIdx, label);
        idx = existingIdx;
      } else {
        // Either unassigned yet, or SHARED with another series' bar (e.g. a
        // prefilled guess that turned out wrong -- v1.3 #9's "series 2 has no
        // Hemp bar" case). Never silently rename a category out from under
        // another series' bar; reuse an existing category with this exact
        // name, or create a new one.
        idx = this.categoryAxis.getCategoryIndex(label);
        if (idx < 0) idx = this.categoryAxis.addCategory(label);
      }
      for (const pixelIndex of pixels) {
        const existing = dataset.getPixel(pixelIndex).metadata ?? {};
        if (pixelIndex === target) {
          dataset.setMetadataAt(pixelIndex, { ...existing, categoryIndex: idx });
        } else if ('categoryIndex' in existing) {
          const { categoryIndex: _dropped, ...rest } = existing;
          dataset.setMetadataAt(pixelIndex, rest);
        }
      }
      this.registerCategoryIndexMetadataKey(dataset);
      return true;
    }

    for (const pixelIndex of pixels) {
      const existing = dataset.getPixel(pixelIndex).metadata ?? {};
      if (pixelIndex === target) {
        dataset.setMetadataAt(pixelIndex, { ...existing, label });
      } else if ('label' in existing) {
        const { label: _dropped, ...rest } = existing;
        dataset.setMetadataAt(pixelIndex, rest);
      }
    }
    this.registerLabelMetadataKey(dataset);
    return true;
  }

  /** Register "categoryIndex" as a per-pixel metadata key so it round-trips
   * through core/plotData.ts -- same registration registerLabelMetadataKey
   * does for "label". Idempotent. */
  private registerCategoryIndexMetadataKey(dataset: Dataset): void {
    const keys = dataset.getMetadataKeys();
    if (!keys.includes('categoryIndex')) dataset.setMetadataKeys([...keys, 'categoryIndex']);
  }

  /** Register "label" as a per-pixel metadata key so it round-trips through
   * core/plotData.ts -- the same registration the role key does. Idempotent. */
  private registerLabelMetadataKey(dataset: Dataset): void {
    const keys = dataset.getMetadataKeys();
    if (!keys.includes('label')) dataset.setMetadataKeys([...keys, 'label']);
  }

  /** The category name of each point of a dataset, index-aligned with its points
   * ('' where unnamed). The independent variable of a Bar / categorical-line
   * figure is a NAME, and until now there was nowhere to put it: Bar's export
   * read `metadata.label` but nothing in the UI could write it (only Box Plot's
   * per-tuple field could), and the categorical line exported a bare ordinal
   * Position. Reading it per index -- rather than active-only -- is what lets the
   * multi-series spreadsheet show every series' categories at once (v1.3 #9). */
  getPointLabels(datasetIndex: number): string[] {
    const entry = this.datasetEntries[datasetIndex];
    if (!entry) return [];
    return entry.dataset.getAllPixels().map((p) => {
      const label = p.metadata?.['label'];
      return typeof label === 'string' ? label : '';
    });
  }

  /** Names one point of the ACTIVE dataset (its category / tick label). The name
   * is TRANSCRIBED off the figure by the reader -- it is the one thing about a
   * categorical axis that pixels cannot carry -- so it is stored per point, with
   * the point, and travels with it through insert/delete/reorder. */
  setPointLabel(pointIndex: number, label: string): void {
    const dataset = this.activeEntry.dataset;
    if (pointIndex < 0 || pointIndex >= dataset.getAllPixels().length) return;
    const existing = dataset.getPixel(pointIndex).metadata ?? {};
    dataset.setMetadataAt(pointIndex, { ...existing, label });
    this.registerLabelMetadataKey(dataset);
  }

  /** Does any series carry a category name? Decides whether the categorical
   * export grows its Category column at all (the same "the column's presence is
   * the signal" rule the interpolation role follows), so a figure whose
   * categories were never typed exports exactly as it did before. */
  private anyPointLabels(): boolean {
    return this.datasetEntries.some((e) =>
      e.dataset.getAllPixels().some((p) => {
        const label = p.metadata?.['label'];
        return typeof label === 'string' && label.length > 0;
      })
    );
  }

  /** Copy a category name onto a newly added point from the NEAREST already-named
   * bar in another series, measured along the category axis (v1.3 #9, David's
   * call: per-point storage + prefill).
   *
   * A grouped bar chart repeats one category set across series, so typing
   * Flax/Hemp/Jute again for every series is pure friction. The name is still
   * written ON the point -- it is a real, editable value the table shows
   * immediately, not a live link to another series -- so a series that skips a
   * category is corrected by retyping that one cell, and nothing else shifts.
   *
   * ⚑ v1.3 gate: this used to match by ROW INDEX, which is CLICK ORDER, not
   * category identity -- so the two most ordinary grouped-bar situations silently
   * fabricated a wrong name. A series with no Hemp bar (click Flax, then Jute) got
   * row 1 prefilled "Hemp", and that wrong name went into the Label / Category
   * column of every export, indistinguishable from a transcription. Clicking the
   * rightmost bar first did the same. Now the pairing is a MEASUREMENT: the donor
   * is whichever named bar sits nearest along the CATEGORY axis (x for upright
   * bars, y when the chart is rotated), which lands on the right category however
   * the user clicks and whatever they skip. Side-by-side sub-bars of a group are
   * offset from their donor but still nearest to it, so grouped charts -- the case
   * the feature exists for -- keep working.
   *
   * Fails SAFE rather than guessing: if that donor's name is already carried by
   * another point in this same series, nothing is written (a category appears at
   * most once per series, so a second claim on one name means the pairing is
   * ambiguous). A blank cell the user fills in is honest; a wrong name that looks
   * typed is not (tenets 9 + 10).
   *
   * Bar-family only (Box Plot and Histogram return before this -- they file into
   * tuples and already have their own per-tuple name field). */
  private prefillCategoryLabel(dataset: Dataset, index: number): void {
    if (this.config.axesKind !== 'bar') return;
    const target = dataset.getAllPixels()[index];
    if (!target) return;
    // The category axis is the one the bars are spread ALONG: x for upright bars,
    // y once "Horizontal bars" is checked. Read it off the live axes so the two
    // orientations share one code path.
    const rotated = this.axes instanceof BarAxes ? this.axes.isRotated() : false;
    const categoryOf = (p: { x: number; y: number }): number => (rotated ? p.y : p.x);
    const here = categoryOf(target);

    let bestLabel: string | null = null;
    let bestDistance = Infinity;
    for (const other of this.datasetEntries) {
      if (other.dataset === dataset) continue;
      for (const pixel of other.dataset.getAllPixels()) {
        const label = pixel.metadata?.['label'];
        if (typeof label !== 'string' || label.length === 0) continue;
        const distance = Math.abs(categoryOf(pixel) - here);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestLabel = label;
        }
      }
    }
    if (bestLabel === null) return;

    // Already used in THIS series -> the pairing is ambiguous, so record nothing.
    const taken = dataset.getAllPixels().some((p, i) => i !== index && p.metadata?.['label'] === bestLabel);
    if (taken) return;

    const existing = target.metadata ?? {};
    dataset.setMetadataAt(index, { ...existing, label: bestLabel });
    this.registerLabelMetadataKey(dataset);
  }

  /** Category-axis coordinate of a pixel: x for upright bars, y once
   * "Horizontal bars" is checked. Shared by prefillCategoryLabel (per-point)
   * and prefillTupleCategoryLabel (per-tuple, v2.0) so the two agree on which
   * axis "along the bars" means. */
  private categoryCoordOf(p: { x: number; y: number }): number {
    const rotated = this.axes instanceof BarAxes ? this.axes.isRotated() : false;
    return rotated ? p.y : p.x;
  }

  /** True for any bar-FAMILY tuple type (v2.0 Phase 6: Bar's 2-slot interval
   * AND Box Plot's 5-slot letter values, whichever door reaches the 5-slot
   * shape -- its own first-class config or the legacy "Box Plot Groups"
   * toggle on a Bar session). getTupleLabel/setTupleLabel resolve through
   * the canonical CategoryAxis for all of these -- a grouped box plot wants
   * the same shared-rename behaviour a grouped bar chart does. Excludes
   * Categorical Line (axesKind 'bar' but never slotted -- "points are
   * captured like an XY series, not bars") and every non-bar-family type,
   * which keep the plain per-tuple string label (metadata.label). */
  private usesCategoryAxis(dataset: Dataset): boolean {
    return this.config.axesKind === 'bar' && dataset.hasSlots();
  }

  /**
   * Whether a bar's category is DERIVED from the declared bands rather than
   * stored on the pixel (v2.1) — true exactly while the category axis is marked.
   *
   * ⚑ THIS IS WHAT MAKES "adjust a tick and the bars re-home" WORK. A stored
   * index is a second copy of a fact the geometry already answers, and the two
   * disagree the moment a divider moves: the bar sits in band 2 and the file
   * still says 3. Deriving it means there is nothing to go stale.
   *
   * ⚑ The usual objection to deriving — that a derived link has no model
   * entrance to guard, the lesson the error-bar cap/datum link taught — does not
   * apply here, because there is nothing to guard. A band index is a pure
   * function of a pixel and the declared dividers; it cannot be inconsistent,
   * only recomputed.
   */
  private categoriesFollowBands(): boolean {
    // ⚑ A COUNT IS REQUIRED, not just an axis, and leaving it out was a real
    // defect (code review, 2026-08-10). `markCategoryAxis` succeeds while the
    // category list is still empty, and the fold-out's Done button lets the user
    // leave in exactly that state. Bands then "answered" for every bar while
    // there were no categories to answer WITH: capture stopped appending one,
    // and getBarCategoryTable iterates the category list for its rows -- so every
    // captured bar existed on the canvas and in the record with no row at all.
    // A table that looks complete and is not is the precise failure this whole
    // feature was built to remove.
    //
    // With no count declared there are no bands, so this reads exactly as an
    // unmarked session and the ordinary prefill path runs.
    return (
      this.supportsCategoryTicks() &&
      this.categoryAxis.hasGeometry() &&
      this.categoryAxis.hasDeclaredCount()
    );
  }

  /** The category a tuple belongs to: its BAND while the axis is marked, the
   * stored `metadata.categoryIndex` otherwise. Null when neither can answer. */
  private categoryIndexOfTuple(dataset: Dataset, tupleIndex: number): number | null {
    const tuple = dataset.getAllTuples()[tupleIndex];
    if (!tuple) return null;
    if (this.categoriesFollowBands()) {
      const primary = tuple.find((v): v is number => v !== null && v !== undefined);
      if (primary === undefined) return null;
      const p = dataset.getPixel(primary);
      return this.categoryAxis.bandIndexAt({ x: p.x, y: p.y });
    }
    for (const pixelIndex of tuple) {
      if (pixelIndex === null || pixelIndex === undefined) continue;
      const idx = dataset.getPixel(pixelIndex).metadata?.['categoryIndex'];
      if (typeof idx === 'number') return idx;
    }
    return null;
  }

  /** True only for a genuine bar-INTERVAL tuple (BAR_INTERVAL_SLOTS), never a
   * 5-slot Box Plot (its own config, or the legacy toggle on a Bar session).
   * Gates the auto-category-PREFILL convenience (wantsAutoCategoryPrefill
   * below) and the CategoryAxis-backed bar table (getBarCategoryTable) --
   * neither has a Box Plot or Histogram counterpart: a box's five letter
   * values have no "one repeated category set across series" pattern to
   * prefill from, and Histogram bins aren't named at all (see
   * isHistogramBinShape below for the ONE thing they DO share with Bar). */
  private isBarIntervalShape(dataset: Dataset): boolean {
    return this.config.id === 'bar' && dataset.getSlotNames().length === BAR_INTERVAL_SLOTS.length;
  }

  /** True for a genuine 2-slot Histogram bin (HISTOGRAM_SLOTS). v2.0, 2026-07-30:
   * split out from isBarIntervalShape rather than folded into it, because the two
   * shapes are NOT interchangeable everywhere -- a histogram bin has no category
   * name to prefill or share (isBarIntervalShape's other two uses stay Bar-only),
   * but it DOES have a genuine bounding box a colour trace can find: see
   * addBarDetectBoxes, which is the one place this predicate is used. */
  private isHistogramBinShape(dataset: Dataset): boolean {
    return this.config.id === 'histogram' && dataset.getSlotNames().length === HISTOGRAM_SLOTS.length;
  }

  /** Gates the auto-PREFILL convenience specifically (not category storage
   * generally, see usesCategoryAxis above) -- see isBarIntervalShape for why
   * this is Bar-2-slot-interval only. */
  private wantsAutoCategoryPrefill(dataset: Dataset): boolean {
    return this.isBarIntervalShape(dataset);
  }

  /** Does any tuple OTHER than (dataset, tupleIndex) already reference this
   * categoryIndex? Answers whether renaming it in place is safe (no other
   * bar, in any series, would be silently relabeled) or whether it must be
   * treated as a reassignment instead -- see setTupleLabel's own comment for
   * why this distinction is the whole point. */
  private categoryIndexHasOtherOwner(categoryIndex: number, dataset: Dataset, tupleIndex: number): boolean {
    for (const entry of this.datasetEntries) {
      const tuples = entry.dataset.getAllTuples();
      for (let i = 0; i < tuples.length; i++) {
        if (entry.dataset === dataset && i === tupleIndex) continue;
        const owns = tuples[i]!.some(
          (pixelIndex) =>
            pixelIndex !== null &&
            pixelIndex !== undefined &&
            entry.dataset.getPixel(pixelIndex).metadata?.['categoryIndex'] === categoryIndex
        );
        if (owns) return true;
      }
    }
    return false;
  }

  /**
   * Tuple-shaped counterpart of prefillCategoryLabel (v2.0). A bar is now TWO
   * pixels (its dragged corners), not one, so a NEW TUPLE — not a new pixel —
   * is the thing that needs a category name, and the donor search/ambiguity
   * guard both need to compare TUPLES (via getTupleLabel-style scanning and
   * each tuple's PRIMARY pixel for position) rather than raw pixel indexes.
   * Same algorithm, same fail-safe-on-ambiguity rule as prefillCategoryLabel
   * — see its doc comment for the full reasoning, not repeated here.
   *
   * Bar-only (`config.id === 'bar'`, not just `axesKind === 'bar'`): Box Plot
   * shares BarAxes but a box has no comparable "one repeated category set
   * across series" pattern to prefill from, and keeps its own plain
   * `Bar<i>`-via-autoLabelTuple default.
   *
   * Returns whether it wrote a name, so the caller can fall back to
   * autoLabelTuple's plain default when there is no donor — mirroring how
   * the old per-point path left a name blank rather than inventing one.
   *
   * ⚑ v2.0: assigns the donor's CATEGORYINDEX, not a copied string -- the new
   * tuple shares canonical identity with its donor from the moment it's
   * created, so renaming either one afterward (setTupleLabel) renames both.
   * A copied string would have looked identical on screen at prefill time but
   * silently diverged the instant either series' name was corrected.
   */
  private prefillTupleCategoryLabel(dataset: Dataset, tupleIndex: number): boolean {
    if (!this.wantsAutoCategoryPrefill(dataset)) return false;
    const tuple = dataset.getAllTuples()[tupleIndex];
    const primaryPixelIndex = tuple?.find((v): v is number => v !== null && v !== undefined);
    if (primaryPixelIndex === undefined) return false;
    const here = this.categoryCoordOf(dataset.getPixel(primaryPixelIndex));

    let bestIdx: number | null = null;
    let bestDistance = Infinity;
    for (const other of this.datasetEntries) {
      if (other.dataset === dataset) continue;
      for (const otherTuple of other.dataset.getAllTuples()) {
        const otherPrimary = otherTuple.find((v): v is number => v !== null && v !== undefined);
        if (otherPrimary === undefined) continue;
        let idx: number | null = null;
        for (const pixelIndex of otherTuple) {
          if (pixelIndex === null || pixelIndex === undefined) continue;
          const candidate = other.dataset.getPixel(pixelIndex).metadata?.['categoryIndex'];
          if (typeof candidate === 'number') {
            idx = candidate;
            break;
          }
        }
        if (idx === null) continue;
        const distance = Math.abs(this.categoryCoordOf(other.dataset.getPixel(otherPrimary)) - here);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIdx = idx;
        }
      }
    }
    if (bestIdx === null) return false;

    // Already used by another tuple in THIS dataset -> ambiguous, write nothing.
    const taken = dataset.getAllTuples().some((t, i) => {
      if (i === tupleIndex) return false;
      return t.some(
        (pixelIndex) =>
          pixelIndex !== null &&
          pixelIndex !== undefined &&
          dataset.getPixel(pixelIndex).metadata?.['categoryIndex'] === bestIdx
      );
    });
    if (taken) return false;

    // Same write shape as setTupleLabel, parameterized on `dataset` rather
    // than assumed to be the active one -- matching prefillCategoryLabel's
    // own defensive style above.
    const pixels = tuple!.filter((v): v is number => v !== null && v !== undefined);
    const target = pixels[0]!;
    for (const pixelIndex of pixels) {
      const existing = dataset.getPixel(pixelIndex).metadata ?? {};
      if (pixelIndex === target) {
        dataset.setMetadataAt(pixelIndex, { ...existing, categoryIndex: bestIdx });
      } else if ('categoryIndex' in existing) {
        const { categoryIndex: _dropped, ...rest } = existing;
        dataset.setMetadataAt(pixelIndex, rest);
      }
    }
    this.registerCategoryIndexMetadataKey(dataset);
    return true;
  }

  /** The active dataset's registered per-pixel metadata keys (e.g. "label"
   * once any tuple has been labeled) -- core/dataset.ts's
   * setMetadataKeys/getMetadataKeys. */
  getMetadataKeys(): string[] {
    return this.activeEntry.dataset.getMetadataKeys();
  }

  /** Whether the active dataset has named slots configured (Box Plot etc.). */
  hasSlots(): boolean {
    return this.activeEntry.dataset.hasSlots();
  }

  /** The session's canonical category list (v2.0) -- see the field's own
   * comment for why this exists on every session rather than only bar ones. */
  getCategoryAxis(): CategoryAxis {
    return this.categoryAxis;
  }

  // ---------------------------------------------------------------------------
  // Category TICKS (v2.1). Thin, and deliberately so: the geometry itself lives
  // in core/categoryAxis.ts where it is pure and mutation-testable. What these
  // add is the one thing the model cannot know -- whether this GRAPH TYPE has
  // categories at all, and which placed calibration pixel seeds the axis. Every
  // mutator is gated on that, so a spider or polar session cannot acquire tick
  // geometry through a stray call and then serialize it.
  //
  // ⚑ An AID, not a calibration. None of this is a step in the walk, none of it
  // gates `runCalibration`, and no measured value depends on it.
  // ---------------------------------------------------------------------------

  /** Whether this graph type has categories the user can mark out. */
  supportsCategoryTicks(): boolean {
    return this.config.categoryTicks !== undefined;
  }

  /**
   * The already-placed calibration pixel that seeds the category axis's first
   * edge — the value origin, which sits on that edge in an ordinary bar chart.
   * Null when the type has no categories or the seed step is not placed yet.
   *
   * ⚑ Offered, never imposed: this is what lets the UI put the first edge down
   * for free, exactly as an XY calibration reuses X1 for Y1, and the user can
   * place both edges by hand when P1 was clicked partway up the axis instead of
   * at the corner.
   */
  categoryTickOriginPixel(): { px: number; py: number } | null {
    const ticks = this.config.categoryTicks;
    if (!ticks) return null;
    const seed = this.placed[ticks.originStep];
    return seed ? { px: seed.px, py: seed.py } : null;
  }

  /** Mark the two edges that ARE the category axis. Refuses for a type with no
   * categories, and for a degenerate axis (the model's own guard). */
  markCategoryAxis(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
    if (!this.supportsCategoryTicks()) return false;
    return this.categoryAxis.setAxisEdges(a, b);
  }

  /** Declare how many categories the figure has, regenerating the ticks. */
  setCategoryCount(count: number): boolean {
    if (!this.supportsCategoryTicks()) return false;
    return this.categoryAxis.setCategoryCount(count);
  }

  /** Switch between ticks under the categories and ticks between them. */
  setCategoryTickConvention(convention: TickConvention): boolean {
    if (!this.supportsCategoryTicks()) return false;
    return this.categoryAxis.setConvention(convention);
  }

  /** Drag one tick; the model clamps it between its neighbours. */
  moveCategoryTick(index: number, point: { x: number; y: number }): boolean {
    if (!this.supportsCategoryTicks()) return false;
    return this.categoryAxis.moveTick(index, point);
  }

  /** Drop the marks, keeping the category NAMES — working without ticks is a
   * supported way to use the tool, not a broken state. */
  clearCategoryAxisGeometry(): boolean {
    if (!this.supportsCategoryTicks()) return false;
    this.categoryAxis.clearGeometry();
    return true;
  }

  /**
   * The declared category dividers, ready for the bar detector: scalar positions
   * along the category axis, plus which image axis that is.
   *
   * Null whenever there is nothing declared, so a caller passing this straight
   * through gets exactly the pre-v2.1 behaviour when the user has not marked
   * anything — the un-ticked path stays untouched by construction.
   *
   * ⚑ The direction is MEASURED from the marked axis, not read off the
   * "Horizontal bars" option: the two are independent declarations today and
   * asking the geometry is the one that cannot disagree with what was drawn.
   */
  categoryDividersForDetect(): { dividers: number[]; categoryAxis: 'x' | 'y' } | null {
    if (!this.supportsCategoryTicks()) return null;
    const edges = this.categoryAxis.getAxisEdges();
    if (!edges) return null;
    const horizontal = Math.abs(edges[1].x - edges[0].x) >= Math.abs(edges[1].y - edges[0].y);
    const axis: 'x' | 'y' = horizontal ? 'x' : 'y';
    const points = this.categoryAxis.getDividerPoints();
    if (points.length < 2) return null;
    const dividers = points.map((p) => (axis === 'x' ? p.x : p.y)).sort((a, b) => a - b);
    return { dividers, categoryAxis: axis };
  }

  /** Which category a pixel falls under, or null when no axis is marked. This
   * is what replaces the nearest-donor name guess once ticks exist. */
  categoryBandAt(px: number, py: number): number | null {
    if (!this.supportsCategoryTicks()) return null;
    return this.categoryAxis.bandIndexAt({ x: px, y: py });
  }

  getSlotNames(): string[] {
    return this.activeEntry.dataset.getSlotNames();
  }

  /** Configure named slots for tuple-based data entry on the active
   * dataset (WPD's Point Groups feature, wpd-core's
   * javascript/widgets/pointGroups.js). Declines (returns false, no
   * mutation) if the active dataset already has CAPTURED DATA under its
   * current slots -- safely diffing an in-use tuple structure is the
   * current app's separate "Edit Point Groups" popup, not this convenience.
   *
   * ⚑ v2.0: relaxed from "declines whenever `hasSlots()`" to "declines only
   * when a tuple actually exists" -- Bar now declares `defaultSlots`
   * (`BAR_INTERVAL_SLOTS`) unconditionally, so EVERY Bar dataset has slots
   * from the moment it's created, before anything is captured. Under the
   * old guard, `applyBoxPlotGroups()` (this method's only caller) would
   * silently no-op on every fresh Bar session -- a UI button that stopped
   * working, not a feature that stopped applying. Checking tuple count
   * instead of slot presence preserves the actual safety property (never
   * reshape a slot structure that already holds real clicks) while letting
   * the legacy toggle upgrade an untouched Bar session's default 2 slots
   * into Box Plot's 5, exactly as it always could before Bar had any
   * default shape of its own. */
  setSlotNames(names: string[]): boolean {
    const entry = this.activeEntry;
    if (entry.dataset.hasSlots() && entry.dataset.getTupleCount() > 0) return false;
    entry.dataset.setSlotNames(names);
    entry.slotCursor = { tupleIndex: null, groupIndex: 0 };
    return true;
  }

  /** Quick-setup for the common Box Plot shape, mirroring the current app's
   * "Box Plot Groups" button (commit 011ef1c). */
  applyBoxPlotGroups(): boolean {
    return this.setSlotNames([...BOX_PLOT_SLOTS]);
  }

  getCurrentSlotIndex(): number {
    return this.activeEntry.slotCursor.groupIndex;
  }

  getCurrentTupleIndex(): number | null {
    return this.activeEntry.slotCursor.tupleIndex;
  }

  /**
   * Aim the capture cursor at ONE named slot (v1.4, David: *"Can I make an empty
   * slot active again, so that I can re-add a point that is missing?"*).
   *
   * The cursor otherwise walks to the first open slot it finds, which is right
   * while stepping round a chart and useless once there are two gaps: the second
   * one cannot be reached until the first is filled. This is the deliberate route
   * to a particular gap — the table's empty cells call it.
   *
   * ⚑ REFUSES A SLOT THAT IS ALREADY FILLED. Capturing into it would overwrite
   * that slot's pixel index and orphan the point it displaced — a reading lost
   * with nothing on screen to say so. Re-taking a reading is delete-then-place,
   * two visible steps, not one silent one.
   *
   * ⚑ INDEPENDENT SLOTS (N x 1D, Spider), OR BAR'S OWN 2-SLOT OBJECT TUPLE.
   * A 5-slot box plot is refused: "fill Q3 next" would let a box be built out
   * of order and left permanently half-made, since that tuple's letter
   * values only mean anything read as a whole. Bar's object tuple has just
   * two members (its two dragged corners) with no such ordinal risk -- a
   * capture normally fills both in one drag, but a plain click (not a drag)
   * can leave one corner missing (BAR_AXES_CONFIG.derivedTupleValue's own
   * "a half-dragged bar has no value yet" case), and with two or more
   * missing categories the cursor can only default to the FIRST gap -- the
   * same reachability problem this method exists to solve for Spider,
   * v2.0 pre-launch audit. `isBarIntervalShape` is the same predicate this
   * file already uses to gate Bar-2-slot-specific behaviour elsewhere.
   *
   * `tupleIndex` null aims at a NEW tuple, starting at `groupIndex`.
   */
  setSlotCursor(tupleIndex: number | null, groupIndex: number): boolean {
    const entry = this.activeEntry;
    const dataset = entry.dataset;
    if (!dataset.hasSlots()) return false;
    if (this.config.tupleMembers !== 'independent' && !this.isBarIntervalShape(dataset)) return false;
    if (groupIndex < 0 || groupIndex >= dataset.getSlotNames().length) return false;
    if (tupleIndex !== null) {
      const tuple = dataset.getAllTuples()[tupleIndex];
      if (!tuple) return false;
      if (tuple[groupIndex] != null) return false; // occupied -- see above
    }
    entry.slotCursor = { tupleIndex, groupIndex };
    return true;
  }

  /** Label for the group the next Place Point click will fill -- mirrors
   * wpd.pointGroups.refreshControls()'s fallback naming for an unnamed group. */
  getCurrentSlotLabel(): string {
    const entry = this.activeEntry;
    const name = entry.dataset.getSlotNames()[entry.slotCursor.groupIndex];
    if (name) return name;
    return entry.slotCursor.groupIndex === 0 ? 'Primary group' : `Group ${entry.slotCursor.groupIndex}`;
  }

  /** Advance the active dataset's cursor to the next open group slot: the
   * current tuple past the current group, then later tuples' first open
   * slot, else "new tuple" (tupleIndex null, groupIndex 0). Direct port of
   * pointGroups.js's nextGroup(). */
  /**
   * Seed the NEXT tuple's first slot with a pixel that has just completed one.
   *
   * Only fires when the tuple it belongs to is now full, so a half-captured sector
   * is never chained out of.
   *
   * ⚑ THE BOUNDARY IS STORED TWICE, once per sector, rather than the two tuples
   * sharing one pixel index (David's call). Sharing was the first design and it is
   * unrepresentable in the project file: each pixel serialises with ONE
   * {tuple, group}, since getTupleIndex returns the FIRST tuple containing it -- so
   * every sector after the first reopened having lost its opening edge, incomplete,
   * with no label and no value. Found by driving the real app; the engine tests all
   * passed because they never went through a file.
   *
   * The cost is that the two copies can drift apart if one is dragged, which is the
   * same "the pairing is not stored" weakness as the error-bar cap and is already
   * v2.0's business. The alternative -- rebuilding the chain on load -- would leave
   * the file lossy and make the reader know something the record does not say.
   */
  private chainToNextTuple(pixelIndex: number): void {
    const entry = this.activeEntry;
    const dataset = entry.dataset;
    const tuples = dataset.getAllTuples();
    // The tuple the pixel just landed in, and only if it is now complete.
    const owning = tuples.findIndex((t) => t.includes(pixelIndex));
    if (owning === -1) return;
    if (tuples[owning]!.some((v) => v === null)) return;
    // Open the next tuple and give it its OWN copy of the shared boundary, so the
    // record says outright which pixels each sector is made of.
    const shared = dataset.getPixel(pixelIndex);
    const copy = dataset.addPixel(shared.x, shared.y);
    const next = tuples.length;
    dataset.addEmptyTupleAt(next);
    dataset.addToTupleAt(next, 0, copy);
    entry.slotCursor.tupleIndex = next;
    entry.slotCursor.groupIndex = 1;
    this.autoLabelTuple(next);
  }

  /**
   * Arm (or disarm) the next sector as an exploded one.
   *
   * ⚑ Arms ONE sector, then reverts -- explosion is a per-slice exception, not a mode
   * the figure is in. In a real figure nine slices share the centre and one does not;
   * a sticky mode would quietly make the other nine wrong.
   */
  setNextSectorExploded(on: boolean): void {
    this.explodedApexPending = on;
  }

  /** Is the next click an exploded slice's apex? Drives the capture prompt. */
  isAwaitingExplodedApex(): boolean {
    return this.explodedApexPending;
  }

  /**
   * How far through an exploded slice's three clicks we are: `'off'` when none is
   * armed, `'apex'` when the next click places the slice's tip, `'edges'` while its
   * two boundaries are being clicked.
   *
   * ⚑ ONE value rather than the two private booleans it is derived from, because the
   * screen has to say which of three things the next click does. A caller reading only
   * `isAwaitingExplodedApex()` reverts to "off" the instant the tip lands -- which is
   * precisely the point where the user most needs telling that this slice is being
   * measured about its own tip and NOT the pie's centre, and that the chain is broken
   * so both its edges have to be clicked.
   */
  getExplodedStage(): 'off' | 'apex' | 'edges' {
    if (this.explodedApexPending) return 'apex';
    return this.pendingExplodedTuple !== null ? 'edges' : 'off';
  }

  /**
   * Abandon the exploded slice in progress: disarm, and discard the half-built sector
   * along with whatever edges were already clicked.
   *
   * ⚑ Needed because the control offers to cancel through ALL THREE clicks, and
   * `setNextSectorExploded(false)` can only undo the first of them -- past the apex
   * the arming flag is already down and the state that matters lives in the pending
   * tuple. A button that says "cancel" and silently does nothing for two of the three
   * states it is shown in is worse than no button.
   *
   * The edges go with it rather than being left as a sector missing its apex: they
   * were clicked as an exploded slice's edges, and read about the shared centre they
   * would be several points wrong -- keeping them would turn a cancel into a silently
   * mis-measured row.
   */
  cancelExplodedSector(): void {
    this.explodedApexPending = false;
    const t = this.pendingExplodedTuple;
    this.pendingExplodedTuple = null;
    this.pendingApex = null;
    if (t === null) return;
    this.discardTuple(t);
  }

  /**
   * Remove a tuple AND the pixels only it held, keeping every other tuple pointing at
   * the same pixels it did before.
   *
   * ⚑ `Dataset.removeTuple` drops the tuple alone, which is right for it -- the model
   * cannot know whether a pixel is wanted without its tuple. Every caller that wants
   * the whole sector gone has to do this, and both pie callers did it differently
   * (one not at all, leaving a duplicate marker in the file), so it lives in one place.
   * Highest index first, so the lower ones keep their numbering while we work down.
   */
  private discardTuple(tupleIndex: number): void {
    const entry = this.activeEntry;
    const dataset = entry.dataset;
    const tuple = dataset.getAllTuples()[tupleIndex];
    if (!tuple) return;
    const pixels = [...new Set(tuple.filter((v): v is number => v !== null))].sort((a, b) => b - a);
    for (const i of pixels) {
      dataset.removePixelAtIndex(i);
      dataset.refreshTuplesAfterPixelRemoval(i);
    }
    dataset.removeTuple(tupleIndex);
    if (entry.slotCursor.tupleIndex !== null && entry.slotCursor.tupleIndex >= tupleIndex) {
      entry.slotCursor.tupleIndex = null;
      entry.slotCursor.groupIndex = 0;
    }
    // v2.0 pre-launch audit: same shift-or-clear this needs wherever the tuple
    // array is spliced -- see removeTuple's own comment. `cancelExplodedSector`
    // already clears these three fields itself before calling in here, so this
    // is a no-op for that caller; it protects every OTHER caller of this shared
    // helper (e.g. discarding a stranded chain while arming a new explode).
    this.fixPendingExplodedAfterTupleRemoval(tupleIndex);
  }

  /** How many of the armed slice's edges are already placed (0-2); 0 when none is
   * armed. Lets the guidance tick off what is done instead of restating all of it. */
  getExplodedEdgesPlaced(): number {
    const t = this.pendingExplodedTuple;
    if (t === null) return 0;
    const tuple = this.activeEntry.dataset.getAllTuples()[t];
    if (!tuple) return 0;
    return tuple.filter((v) => v !== null).length;
  }

  /** The apex a sector was measured about, or null for an ordinary slice sharing the
   * pie's fitted centre. Stored per-tuple, read back for every reading. */
  getSectorApex(tupleIndex: number, datasetIndex?: number): { x: number; y: number } | null {
    const dataset = this.datasetAt(datasetIndex);
    const primaryIndex = dataset.getAllTuples()[tupleIndex]?.[0];
    if (primaryIndex === null || primaryIndex === undefined) return null;
    const meta = dataset.getPixel(primaryIndex).metadata as Record<string, unknown> | null | undefined;
    const x = Number(meta?.['apexX']);
    const y = Number(meta?.['apexY']);
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  }

  /** Record the apex on the tuple's own primary pixel — the same per-pixel metadata
   * channel the category label uses, so it round-trips through the project file
   * without a new home in the format. */
  private setSectorApex(tupleIndex: number, x: number, y: number): void {
    const dataset = this.activeEntry.dataset;
    const primaryIndex = dataset.getAllTuples()[tupleIndex]?.[0];
    if (primaryIndex === null || primaryIndex === undefined) return;
    const existing = dataset.getPixel(primaryIndex).metadata ?? {};
    dataset.setMetadataAt(primaryIndex, { ...existing, apexX: x, apexY: y });
    const keys = dataset.getMetadataKeys();
    for (const k of ['apexX', 'apexY']) {
      if (!keys.includes(k)) dataset.setMetadataKeys([...dataset.getMetadataKeys(), k]);
    }
  }

  nextSlot(): void {
    const cursor = this.activeEntry.slotCursor;
    if (cursor.tupleIndex === null) return;
    const tuples = this.activeEntry.dataset.getAllTuples();
    let nextTupleIndex = -1;
    let nextGroupIndex = -1;
    for (let tupleIndex = cursor.tupleIndex; tupleIndex < tuples.length; tupleIndex++) {
      const tuple = tuples[tupleIndex]!;
      const startGroupIndex = tupleIndex === cursor.tupleIndex ? cursor.groupIndex + 1 : 0;
      const groupIndex = tuple.indexOf(null, startGroupIndex);
      if (groupIndex > -1) {
        nextTupleIndex = tupleIndex;
        nextGroupIndex = groupIndex;
        break;
      }
    }
    if (nextTupleIndex === -1 && nextGroupIndex === -1) {
      cursor.tupleIndex = null;
      cursor.groupIndex = 0;
    } else {
      cursor.tupleIndex = nextTupleIndex;
      cursor.groupIndex = nextGroupIndex;
    }
  }

  /** Walk the active dataset's cursor back to the previous open group slot --
   * nextSlot's mirror image, direct port of pointGroups.js's
   * previousGroup(). Used for manual navigation and to keep the cursor sane
   * after removeLastPoint. */
  previousSlot(): void {
    const cursor = this.activeEntry.slotCursor;
    if (cursor.tupleIndex === 0 && cursor.groupIndex === 0) return;
    const tuples = this.activeEntry.dataset.getAllTuples();
    let previousTupleIndex: number | null = -1;
    let previousGroupIndex = -1;
    const startTupleIndex = cursor.tupleIndex === null ? tuples.length - 1 : cursor.tupleIndex;
    for (let tupleIndex = startTupleIndex; tupleIndex >= 0; tupleIndex--) {
      const tuple = tuples[tupleIndex];
      if (tuple === undefined) {
        previousTupleIndex = null;
        previousGroupIndex = 0;
        break;
      }
      let startGroupIndex = tuple.length - 1;
      if (tupleIndex === cursor.tupleIndex) {
        startGroupIndex = cursor.groupIndex - 1;
      }
      if (startGroupIndex > -1) {
        const groupIndex = tuple.lastIndexOf(null, startGroupIndex);
        if (groupIndex > -1) {
          previousTupleIndex = tupleIndex;
          previousGroupIndex = groupIndex;
          break;
        }
      }
    }
    if (previousTupleIndex !== -1 && previousGroupIndex !== -1) {
      cursor.tupleIndex = previousTupleIndex;
      cursor.groupIndex = previousGroupIndex;
    }
  }

  /** The dataset at `index`, or the active one when no index is given. */
  private datasetAt(index?: number): Dataset {
    if (index === undefined) return this.activeEntry.dataset;
    return (this.datasetEntries[index] ?? this.activeEntry).dataset;
  }

  /** One row per tuple (category) in the active dataset, in group order --
   * the shape a Box Plot table needs instead of dataDim's flat per-point
   * list. */
  getTupleRows(datasetIndex?: number): TupleRow[] {
    // ⚑ Defaults to the ACTIVE series, but takes an index so a multi-series
    // export can reach the others. Without it every tuple-shaped type (Bar,
    // Box Plot, Pie) exported exactly one series to all nine formats while the
    // v2.0 shared table on screen showed them all -- see exportAssembly's
    // scope handling. (Round-2 audit.)
    const dataset = this.datasetAt(datasetIndex);
    const derive = this.config.derivedTupleValue;
    return dataset.getAllTuples().map((tuple, tupleIndex) => {
      const points = tuple.map((pixelIndex) => {
        if (pixelIndex === null) return null;
        const p = dataset.getPixel(pixelIndex);
        return { px: p.x, py: p.y, data: this.axes ? this.axes.pixelToData(p.x, p.y) : null };
      });
      return {
        tupleIndex,
        label: this.getTupleLabel(tupleIndex, datasetIndex),
        points,
        // The arithmetic stays in the CONFIG, where that type's model lives; the
        // session only supplies what no config can reach on its own -- the axes, the
        // tuple's own apex, and the whole the values are read against.
        derived:
          derive && this.axes
            ? derive.compute(points, this.axes, {
                apex: this.getSectorApex(tupleIndex, datasetIndex),
                stackGroup: this.getDatasetStackGroup(this.activeDatasetIndex),
              })
            : null,
      };
    });
  }

  /**
   * The spider table (v1.4): one ROW per axis, one COLUMN per series —
   * `# | Category | Series 1 | Series 2 | …` (David, 2026-07-27).
   *
   * ⚑ Why this shape and not the grouped table's. The slot table shows the
   * ACTIVE series only, so adding a second series made the first one's readings
   * vanish from the screen — caught by driving the app, not by any test. Every
   * ungrouped type already shows all series at once, so the grouped table was the
   * outlier. Rows-as-axes is also the layout a radar chart's own data is published
   * in, and it stays compact as series are added instead of growing sideways by
   * one block of axis columns each time.
   *
   * ⚑ This alignment is REAL, not assumed. Row k is axis k for every series
   * because every series has exactly one slot per axis, by construction of the
   * slots. The same side-by-side layout LIED for error bars, where the
   * pairing was derived at read time and never stored.
   *
   * A series holding more than one profile contributes one column per profile, so
   * nothing is hidden; the common single-profile case just reads as the series name.
   */
  getSpiderTable(): {
    axisNames: string[];
    /** The names AS STORED — empty where the figure's own label was illegible and
     * the user left it blank. `axisNames` carries the positional fallback for
     * display; an editable field must show this one, or it offers "Axis 3" as if
     * someone had typed it (the same invented-value trap the calibration card's
     * blankValue closed). */
    axisRawNames: string[];
    columns: {
      seriesIndex: number;
      seriesName: string;
      profileIndex: number;
      label: string;
      values: (number | null)[];
      /** Which point fills each axis's slot, so clicking a cell can select it. */
      pointIndices: (number | null)[];
    }[];
  } {
    if (this.config.axesKind !== 'spider' || !this.axes) return { axisNames: [], axisRawNames: [], columns: [] };
    const spider = this.axes as unknown as SpiderAxes;
    const axisNames = spider.getSpokes().map((_, i) => spider.getSpokeLabel(i));
    const axisRawNames = spider.getSpokes().map((spoke) => spoke.name);

    const columns: ReturnType<CalibrationSession<A>['getSpiderTable']>['columns'] = [];
    this.datasetEntries.forEach((entry, seriesIndex) => {
      const tuples = entry.dataset.getAllTuples();
      // A series with nothing captured still gets a column, so it is visible as
      // soon as it is added rather than appearing only once it has data.
      const profiles = tuples.length > 0 ? tuples : [[]];
      profiles.forEach((tuple, profileIndex) => {
        const pointIndices = axisNames.map((_, axisIndex) => tuple[axisIndex] ?? null);
        const values = axisNames.map((_, axisIndex) => {
          const pixelIndex = pointIndices[axisIndex];
          if (pixelIndex == null) return null;
          const p = entry.dataset.getPixel(pixelIndex);
          // Read against THIS axis, never the nearest ray — the same rule the
          // export follows, for the same reason.
          return spider.projectOnSpoke(axisIndex, p.x, p.y)?.value ?? null;
        });
        columns.push({
          seriesIndex,
          seriesName: entry.dataset.name,
          profileIndex,
          label: profiles.length > 1 ? `${entry.dataset.name} · ${profileIndex + 1}` : entry.dataset.name,
          values,
          pointIndices,
        });
      });
    });
    return { axisNames, axisRawNames, columns };
  }

  /**
   * The bar table (v2.0): `# | Category | Series 1 | Series 2 | …` — one ROW
   * per CATEGORY, one COLUMN per series, mirroring getSpiderTable's own
   * shape and reasoning exactly (David: "we need to store them, series by
   * series, as columns. Like this [spider's table]").
   *
   * ⚑ Replaces the per-series switching table Bar used to fall into
   * (`hasSlots` below): that table showed the ACTIVE series' bars only, so a
   * second series' bars vanished from the screen the moment you switched —
   * the same defect getSpiderTable's own comment describes, on the same
   * underlying table.
   *
   * Rows are the canonical CategoryAxis, in ITS OWN order (not any one
   * series' capture order) — the whole point of a shared axis is that every
   * series aligns to the same row regardless of which order each series was
   * captured in. A series with no bar for a given category yet leaves that
   * cell null, exactly like Spider's own empty cells.
   */
  getBarCategoryTable(): {
    categoryNames: string[];
    /** The names AS STORED — empty where a bar was captured but never
     * named (autoLabelTuple's v2.0 change: position alone is enough for
     * OUR identification, so nothing is invented here). `categoryNames`
     * carries the positional fallback for display; an editable field must
     * show THIS one, exactly as spider's axisRawNames/axisNames split. */
    categoryRawNames: string[];
    columns: {
      seriesIndex: number;
      seriesName: string;
      values: (number | null)[];
      /** Which tuple (in that series' OWN dataset) fills each row, so a
       * click can select/delete it -- one series' tupleIndex is meaningless
       * against another series' dataset, so this is per-column, not global. */
      tupleIndices: (number | null)[];
    }[];
    /** Bars that could not be shown because another bar of the same series
     * already fills that category's cell. Empty in every ordinary figure.
     *
     * ⚑ EXISTS SO NOTHING IS DROPPED WITHOUT A TRACE. One cell holds one bar, so
     * a second one landing in the same category cannot be displayed -- but a
     * table that quietly omits a real reading is the failure this feature was
     * built to remove, so the omission is handed back to be surfaced. */
    crowded: { seriesIndex: number; categoryIndex: number; tupleIndex: number }[];
  } {
    if (!this.axes || !this.isBarIntervalShape(this.activeEntry.dataset)) {
      return { categoryNames: [], categoryRawNames: [], columns: [], crowded: [] };
    }
    const axes = this.axes;
    const categories = this.categoryAxis.getCategories();
    const categoryRawNames = [...categories];
    const categoryNames = categories.map((name, i) => (name === '' ? `Category ${i + 1}` : name));
    const derive = this.config.derivedTupleValue;

    const crowded: { seriesIndex: number; categoryIndex: number; tupleIndex: number }[] = [];
    const columns = this.datasetEntries.map((entry, seriesIndex) => {
      const dataset = entry.dataset;
      const tuples = dataset.getAllTuples();
      // categoryIndex -> tupleIndex, for this series only.
      const tupleForCategory = new Map<number, number>();
      tuples.forEach((_tuple, tupleIndex) => {
        const idx = this.categoryIndexOfTuple(dataset, tupleIndex);
        if (idx === null) return;
        // ⚑ FIRST WINS, and the loser is REPORTED (code review, 2026-08-10).
        // This was `set(idx, tupleIndex)` -- last-wins -- so a second bar of the
        // same series landing in one category silently evicted the first one's
        // row. The outer bands are unbounded, so a stray bar, a mis-declared
        // count, or a bar outside the marked span was enough to do it, and the
        // table came back looking complete with a real reading missing.
        //
        // One cell cannot show two bars, so the table keeps the first (capture
        // order, deterministic) and hands the rest back in `crowded` for the UI
        // to surface. Dropping is survivable; dropping SILENTLY is not.
        if (tupleForCategory.has(idx)) {
          crowded.push({ seriesIndex, categoryIndex: idx, tupleIndex });
          return;
        }
        tupleForCategory.set(idx, tupleIndex);
      });
      const values: (number | null)[] = [];
      const tupleIndices: (number | null)[] = [];
      categories.forEach((_, categoryIndex) => {
        const tupleIndex = tupleForCategory.get(categoryIndex);
        if (tupleIndex === undefined) {
          values.push(null);
          tupleIndices.push(null);
          return;
        }
        const tuple = tuples[tupleIndex]!;
        const points = tuple.map((pixelIndex) => {
          if (pixelIndex === null || pixelIndex === undefined) return null;
          const p = dataset.getPixel(pixelIndex);
          return { px: p.x, py: p.y, data: axes.pixelToData(p.x, p.y) };
        });
        const derived =
          derive?.compute(points, axes, { apex: null, stackGroup: this.getDatasetStackGroup(seriesIndex) }) ?? null;
        values.push(derived);
        tupleIndices.push(tupleIndex);
      });
      return { seriesIndex, seriesName: dataset.name, values, tupleIndices };
    });
    return { categoryNames, categoryRawNames, columns, crowded };
  }

  /** Renames a category directly by its canonical CategoryAxis index — the
   * bar table's own counterpart of setSpokeName, and simpler than
   * setTupleLabel: a shared table's row already names an EXISTING,
   * unambiguous categoryIndex (there is nothing to look up or merge, unlike
   * setTupleLabel's job of deciding whether a freshly-typed name matches an
   * existing category or starts a new one). Every series sharing this
   * category sees the new name immediately, since all of them resolve the
   * name through this same index. */
  renameCategory(categoryIndex: number, name: string): boolean {
    return this.categoryAxis.renameCategory(categoryIndex, name);
  }

  /** The active series' bins, one entry per captured tuple in capture order,
   * `null` where a bin's second corner isn't placed yet (so a half-captured
   * bin still occupies its own row -- see algorithms/histogram.ts).
   *
   * A thin adapter over the pure geometry, per CLAUDE.md's leg (c): all this
   * does is turn tuples into data-space corners and hand them over. Returns
   * [] for any other graph type or before calibration, mirroring how
   * getBoxPlotGlyphs gates on its own config id -- bins are meaningless
   * without a numeric x axis to measure the edges against. */
  getHistogramBins(): (HistogramBin | null)[] {
    if (this.config.id !== 'histogram' || !this.axes) return [];
    return binsFromCorners(
      this.getTupleRows().map((row) =>
        row.points.map((p) => (p?.data ? { x: p.data[0]!, y: p.data[1]! } : null))
      )
    );
  }

  /** Bin glyph segments (image-pixel space) for every *complete* bin of the
   * active series -- what the canvas draws so a captured bin reads as an
   * interval rather than two loose dots. Incomplete bins draw nothing, the
   * same rule getBoxPlotGlyphs uses for a half-filled tuple. */
  getHistogramBinGlyphs(): GlyphSegment[][] {
    if (this.config.id !== 'histogram') return [];
    const glyphs: GlyphSegment[][] = [];
    for (const row of this.getTupleRows()) {
      const [a, b] = row.points;
      if (!a || !b) continue;
      glyphs.push(computeBinGlyph({ x: a.px, y: a.py }, { x: b.px, y: b.py }));
    }
    return glyphs;
  }

  /** Box-and-whisker glyph segments (image-pixel space) for every *complete*
   * tuple of the active dataset -- empty unless calibrated, Bar axes, and
   * that dataset's slots are exactly Min/Q1/Median/Q3/Max
   * (case-insensitive, the shape applyBoxPlotGroups creates). Deliberately
   * still active-dataset-only after checkpoint 30 -- see
   * getAllDatasetsData's own doc comment. See this file's header comment
   * for the axes-type cast. */
  getBoxPlotGlyphs(): BoxPlotGlyphSegment[][] {
    // Capability, not identity (checkpoint 73): gate on axesKind, so both the
    // 'bar' config (via the legacy Box Plot Groups toggle) and the first-class
    // 'boxplot' config (checkpoint 107) qualify -- and the orientation cast below
    // stays safe, since only a BarAxes has calculateOrientation(). The exact
    // Min/Q1/Median/Q3/Max group check next narrows this to real box-plot
    // datasets, so a plain Bar or Categorical dataset (no groups) still yields [].
    if (!this.axes || this.config.axesKind !== 'bar') return [];
    const dataset = this.activeEntry.dataset;
    const groups = dataset.getSlotNames().map((g) => g.trim().toLowerCase());
    const expected = ['min', 'q1', 'median', 'q3', 'max'];
    if (groups.length !== expected.length || !groups.every((g, i) => g === expected[i])) return [];

    const orientation: BoxPlotOrientation =
      (this.axes as unknown as { calculateOrientation(): { axes: 'X' | 'Y' } }).calculateOrientation().axes === 'Y'
        ? 'vertical'
        : 'horizontal';

    const glyphs: BoxPlotGlyphSegment[][] = [];
    for (const tuple of dataset.getAllTuples()) {
      if (tuple.some((pixelIndex) => pixelIndex === null)) continue; // incomplete tuple
      const [minI, q1I, medianI, q3I, maxI] = tuple as number[];
      glyphs.push(
        computeBoxPlotGlyph(
          {
            min: dataset.getPixel(minI!),
            q1: dataset.getPixel(q1I!),
            median: dataset.getPixel(medianI!),
            q3: dataset.getPixel(q3I!),
            max: dataset.getPixel(maxI!),
          },
          orientation
        )
      );
    }
    return glyphs;
  }

  /** Which already-placed steps' pixels the current step could reuse instead of a new click
   * (e.g. X1 and Y1 sharing one physical origin pixel — a common real calibration pattern). */
  getReusableSteps(): CalibStepInfo[] {
    if (this.axes || this.pendingPixel) return [];
    const current = this.getCurrentStep();
    if (!current) return [];
    // A repeating calibration has nothing to reuse, and offering it would invite a
    // real mistake. Reuse exists for the shared-corner case — X1 and Y1 being one
    // physical pixel — but a spider's origin is shared BY CONSTRUCTION (placed
    // once, used by every spoke), and two spokes on one pixel is two axes pointing
    // the same way, recorded as if the figure drew them that way.
    if (this.config.repeatingStep) return [];
    // Never offer the *same axis's* other end: reusing X1's pixel for X2 (or
    // Y1's for Y2) puts both calibration points on one pixel, which makes the
    // transform matrix singular -- and XYAxes still returns true, so every
    // value reads back null with no error shown. Legitimate reuse is across
    // axes (X1 <-> Y1, the shared-origin case checkpoint 50's "Common origin"
    // automates). WPD has no reuse buttons at all, so checkpoint 49 made a
    // degenerate calibration *easier to reach than upstream*; this filter is
    // what keeps that convenience honest.
    return this.getSteps().filter(
      (s) =>
        s.key !== current.key &&
        this.placed[s.key] &&
        !mustDiffer(this.config as unknown as AxesTypeConfig<CalibratedAxes>, s.key, current.key)
    );
  }

  /** Reuse an already-placed step's pixel as the pending pixel for the current step,
   * instead of requiring a fresh click at the same physical location. */
  reuseStepPixel(fromKey: string): boolean {
    if (this.axes) return false;
    const step = this.getCurrentStep();
    const source = this.placed[fromKey];
    if (!step || !source) return false;
    this.pendingPixel = { px: source.px, py: source.py };
    return true;
  }

  /** Confirm the pending calibration point's value(s) -- one per the current step's
   * valueFields, in order -- advancing to the next step. */
  confirmCalibrationValues(values: string[]): boolean {
    const step = this.getCurrentStep();
    if (!step || !this.pendingPixel || values.length !== step.valueFields.length) return false;
    const trimmed = values.map((v) => v.trim());
    // Required fields must be filled; an OPTIONAL field (e.g. Polar P2's θ, which
    // the calibration never reads) may be blank and falls back to its declared
    // `blankValue` -- "0" unless the field says otherwise. See CalibValueField.
    if (step.valueFields.some((f, i) => !f.optional && trimmed[i] === '')) return false;
    const filled = trimmed.map((v, i) => {
      const field = step.valueFields[i]!;
      return v === '' && field.optional ? (field.blankValue ?? '0') : v;
    });
    this.placed[step.key] = { px: this.pendingPixel.px, py: this.pendingPixel.py, values: filled };
    this.pendingPixel = null;
    this.stepIndex += 1;
    return true;
  }

  /** Build the Calibration + axes instance from the placed calibration points
   * and any global field values. */
  runCalibration(): boolean {
    const steps = this.getSteps();
    const points: PlacedCalibPoint[] = [];
    for (const step of steps) {
      const point = this.placed[step.key];
      if (!point) return false;
      points.push(point);
    }

    for (const gf of this.config.globalFields) {
      if (!this.globalValues[gf.key]?.trim()) {
        this.calibrationError = `Enter a value for "${gf.label}" before calibrating.`;
        return false;
      }
    }

    const cal = new Calibration(this.config.calibrationDimensions ?? 2);
    steps.forEach((step, i) => {
      const point = points[i]!;
      let dx = '0';
      let dy = '0';
      // Empty, not '0': the third slot is a NAME for its only user, and "0" is a
      // name a figure could plausibly have printed. An absent name must stay
      // absent so the axes class can fall back positionally rather than
      // displaying a value nobody transcribed.
      let dz = '';
      step.valueFields.forEach((vf, fi) => {
        const value = point.values[fi]!;
        if (vf.field === 'dx') dx = value;
        else if (vf.field === 'dy') dy = value;
        else dz = value;
      });
      cal.addPoint(point.px, point.py, dx, dy, dz);
    });

    // Refusals run BEFORE the axes class sees anything: every axes class
    // reports success on degenerate input, so a guard placed after calibrate()
    // is a guard that never fires (checkpoint 72).
    const guardError = checkGuards(this.config as unknown as AxesTypeConfig<CalibratedAxes>, cal, this.optionValues, this.globalValues, steps);
    if (guardError) {
      this.calibrationError = guardError;
      return false;
    }

    const result = this.config.buildAxes(cal, {
      globalValues: this.globalValues,
      options: this.optionValues,
      imageHeight: this.imageHeight,
    });
    if ('error' in result) {
      this.calibrationError = result.error;
      return false;
    }
    this.calibrationError = null;
    this.axes = result.axes;
    this.applyAxesDerivedSlots();
    return true;
  }

  /**
   * Name every dataset's slots after the calibrated axes (v1.4, Spider):
   * one slot per spoke, in spoke order, so a captured tuple reads "Strength,
   * Weight, Cost" instead of "1, 2, 3".
   *
   * ⚑ Why this can't be `defaultSlots`. That field is a static list on the
   * config, which suits Histogram's fixed ['Bin start','Bin end']; a spider's
   * groups do not exist until its axes have been calibrated, and their names are
   * transcribed from the figure at that moment. So the config declares a FUNCTION
   * of the built axes instead.
   *
   * ⚑ It will not restructure a dataset that already holds points. Renaming in
   * place is safe (`Dataset.setSlotNames` only assigns names; it never touches
   * recorded pixels), so a re-calibration that keeps the same spoke count just
   * relabels. But when the COUNT changed, slot k of an existing tuple no longer
   * means the axis it was recorded against, and silently renaming would make the
   * table assert a pairing nobody measured — the exact failure the error-bar
   * record is parked on. In that case the recorded data keeps the names it was
   * captured under, and the mismatch stays visible rather than being papered over.
   */
  private applyAxesDerivedSlots(): void {
    const derive = this.config.slotsFromAxes;
    if (!derive || !this.axes) return;
    const names = [...derive(this.axes)];
    if (names.length === 0) return;

    for (const entry of this.datasetEntries) {
      const hasPoints = entry.dataset.getCount() > 0;
      const existing = entry.dataset.getSlotNames();
      if (hasPoints && existing.length !== names.length) continue;
      entry.dataset.setSlotNames(names);
      if (!hasPoints) entry.slotCursor = { tupleIndex: null, groupIndex: 0 };
    }
  }

  /** The active dataset's points -- see this file's header comment. */
  getDataPoints(): DataPointView[] {
    return this.activeEntry.dataset.getAllPixels().map((p) => ({
      px: p.x,
      py: p.y,
      data: this.axes ? this.axes.pixelToData(p.x, p.y) : null,
    }));
  }

  /** Removes the most recently placed data point from the active dataset.
   * When slots are configured, also cleans up its tuple slot
   * (dropping the tuple entirely if it's now empty) and walks the cursor
   * back -- mirrors DeleteDataPointTool's single-point removal path in
   * manualDetectionTools.js (not its whole-tuple-deletion popup, which this
   * checkpoint doesn't add). */
  /**
   * Fix up the pending exploded-slice state after a tuple has been spliced out.
   *
   * ⚑ ONE OMISSION, FOUR SITES. `pendingExplodedTuple` is a tuple INDEX into an
   * array that four different methods splice: `removeTuple`, `discardTuple`,
   * `removeLastPoint` and `removeDataPointAt`. The v2.0 audit fixed the first
   * two and left the other two calling `dataset.removeTuple` directly, so
   * deleting the last point of an in-progress exploded sector stranded the
   * index -- and `addDataPoint` then wrote the DISCARDED apex onto whatever
   * ordinary sector next landed at that index. Measured: a sector that should
   * read 33.3 read 19.2, exported and saved, with nothing on screen wrong
   * except a stuck "click its edges" prompt. (Round-2 audit.)
   */
  /**
   * Drop categories no tuple owns any more, shifting the rest down.
   *
   * ⚑ WHY IT EXISTS. Every new bar reserves a fresh category slot
   * (`reserveEmptyCategorySlot`), and NOTHING gave one back: deleting a bar,
   * a point, or a whole series left the category behind. The shared v2.0 Bar
   * table draws its rows from the CategoryAxis, not from the tuples, so each
   * deleted bar left a dead row with a null value and no tuple — and the
   * per-cell delete only renders where a value exists, so the ghost row had
   * **no delete affordance on any cell**. It rode into the saved file and
   * reloaded. Adding a replacement bar minted `Category 3` rather than reusing
   * the freed slot, and retyping the freed NAME hit `setTupleLabel`'s
   * sole-owner branch and renamed in place, leaving TWO identically named rows
   * — after which `getCategoryIndex` resolved that name to the invisible one.
   *
   * `CategoryAxis.removeCategory` had existed since v2.0 with zero callers;
   * its own doc says the wiring layer must check every bound dataset first,
   * and that layer was never written. This is it. Removing an index shifts
   * every later one, so the stored `categoryIndex` metadata is renumbered in
   * the same pass — which is exactly why it could not be a bare call.
   * (Round-2 audit.)
   */
  private pruneOrphanedCategories(): void {
    if (this.categoryAxis.getCategories().length === 0) return;
    // Which indexes does any tuple, in any series, still point at?
    const owned = new Set<number>();
    for (const entry of this.datasetEntries) {
      if (!this.usesCategoryAxis(entry.dataset)) continue;
      for (const tuple of entry.dataset.getAllTuples()) {
        for (const pixelIndex of tuple) {
          if (pixelIndex === null) continue;
          const raw = entry.dataset.getPixel(pixelIndex).metadata?.['categoryIndex'];
          const idx = typeof raw === 'number' ? raw : Number(raw);
          if (Number.isInteger(idx) && idx >= 0) owned.add(idx);
        }
      }
    }
    const total = this.categoryAxis.getCategories().length;
    const orphans: number[] = [];
    for (let i = 0; i < total; i++) if (!owned.has(i)) orphans.push(i);
    if (orphans.length === 0) return;

    // Highest first, so the indexes still to be removed stay valid.
    for (const orphan of [...orphans].reverse()) {
      if (!this.categoryAxis.removeCategory(orphan)) continue;
      for (const entry of this.datasetEntries) {
        if (!this.usesCategoryAxis(entry.dataset)) continue;
        const dataset = entry.dataset;
        for (let p = 0; p < dataset.getCount(); p++) {
          const existing = dataset.getPixel(p).metadata ?? {};
          const raw = existing['categoryIndex'];
          const idx = typeof raw === 'number' ? raw : Number(raw);
          if (Number.isInteger(idx) && idx > orphan) {
            dataset.setMetadataAt(p, { ...existing, categoryIndex: idx - 1 });
          }
        }
      }
    }
  }

  private fixPendingExplodedAfterTupleRemoval(removedIndex: number): void {
    if (this.pendingExplodedTuple === null) return;
    if (this.pendingExplodedTuple === removedIndex) {
      this.explodedApexPending = false;
      this.pendingExplodedTuple = null;
      this.pendingApex = null;
    } else if (this.pendingExplodedTuple > removedIndex) {
      this.pendingExplodedTuple -= 1;
    }
  }

  removeLastPoint(): void {
    const dataset = this.activeEntry.dataset;
    const count = dataset.getCount();
    if (count === 0) return;
    const index = count - 1;
    const wasAnchor = dataset.getPixel(index)?.metadata?.['role'] === 'anchor';
    if (dataset.hasSlots()) {
      const tupleIndex = dataset.getTupleIndex(index);
      dataset.removePixelAtIndex(index);
      dataset.refreshTuplesAfterPixelRemoval(index);
      if (tupleIndex > -1 && dataset.isTupleEmpty(tupleIndex)) {
        dataset.removeTuple(tupleIndex);
        this.fixPendingExplodedAfterTupleRemoval(tupleIndex);
        this.pruneOrphanedCategories();
      }
      this.previousSlot();
    } else {
      dataset.removePixelAtIndex(index);
    }
    // Deleting an interpolation-assist anchor changes the curve (checkpoint 120):
    // re-derive the fill so it doesn't span a guide point that no longer exists.
    if (wasAnchor) this.rebuildInterpolation();
  }

  /** Remove one specific data point from the active dataset by index (checkpoint
   * 58's click-to-select-then-delete). Mirrors removeLastPoint's tuple cleanup
   * for a Box Plot dataset, minus the previous-group cursor walk-back -- deleting
   * an arbitrary mid-sequence point has no single "previous" step to return to
   * (the cursor is left where it is; Box Plot's own arbitrary-delete UX is out of
   * scope). No-op for an out-of-range index. */
  removeDataPointAt(index: number): void {
    const dataset = this.activeEntry.dataset;
    if (index < 0 || index >= dataset.getCount()) return;
    const wasAnchor = dataset.getPixel(index)?.metadata?.['role'] === 'anchor';
    if (dataset.hasSlots()) {
      const tupleIndex = dataset.getTupleIndex(index);
      dataset.removePixelAtIndex(index);
      dataset.refreshTuplesAfterPixelRemoval(index);
      if (tupleIndex > -1 && dataset.isTupleEmpty(tupleIndex)) {
        dataset.removeTuple(tupleIndex);
        this.fixPendingExplodedAfterTupleRemoval(tupleIndex);
        this.pruneOrphanedCategories();
      }
    } else {
      dataset.removePixelAtIndex(index);
    }
    // Deleting an interpolation-assist anchor changes the curve (checkpoint 120):
    // re-derive the fill so it doesn't span a guide point that no longer exists.
    if (wasAnchor) this.rebuildInterpolation();
  }

  /** Bulk-delete data points from the active series by index (the Select tool's
   * marquee delete). Removes HIGHEST index first so earlier indices stay valid as
   * later ones drop; reuses removeDataPointAt so tuple/anchor/interpolation
   * handling lives in one place. Deduped. The caller commits once, so undo
   * captures the whole set as a single step. */
  removeDataPoints(indices: readonly number[]): void {
    const dataset = this.activeEntry.dataset;

    // Active series IS an error series (SD upper/lower): a selected cap stands for
    // its whole error bar (David 2026-07-22). Delete the matched PAIR -- this cap
    // plus its sibling in the other error series, both resolving to the same
    // datum -- and leave the parent data point. Resolve datums BEFORE removing
    // anything, because removal shifts indices.
    const relation = this.axes ? getErrorRelation(dataset) : null;
    if (relation) {
      const parent = this.datasetEntries.find((e) => e.dataset.name === relation.of);
      if (parent) {
        const parentData = this.dataValuesOf(parent.dataset);
        // The selected caps live in ONE error series (e.g. "SD upper"). Deleting
        // a cap deletes its whole error BAR -- this series plus its opposite-role
        // sibling of the SAME base ("SD lower") -- but must NOT touch a different
        // error-bar TYPE on the same parent (a "95% CI" bar), which iterating
        // every error series would (v1.0.1). Restrict to this bar's own pair.
        const base = errorSeriesBase(dataset.name, relation.role);
        const pair = new Set([
          dataset.name.trim(),
          errorSeriesName(base, oppositeRole(relation.role)),
        ]);
        const datums = new Set<number>();
        for (const i of indices) {
          const cap = dataset.getPixel(i);
          if (!cap) continue;
          const di = matchCapToDatum(parentData, this.dataOf(cap), relation.role);
          if (di > -1) datums.add(di);
        }
        for (const di of datums)
          this.removeErrorCapsForDatum(parent.dataset.name, parentData, di, pair);
        return;
      }
    }

    // Active series is a PARENT that carries error bars: deleting a point takes
    // its error bar with it (cascade, A -- David 2026-07-22). Drop each point's
    // matched caps (datum indices valid against the CURRENT parent data), then
    // remove the parent points high-index first.
    if (this.axes && hasErrorSeries(this.getDatasets(), dataset.name)) {
      const parentData = this.dataValuesOf(dataset);
      const uniq = [...new Set(indices)].filter((i) => i >= 0 && i < dataset.getCount());
      for (const di of uniq) this.removeErrorCapsForDatum(dataset.name, parentData, di);
      for (const i of [...uniq].sort((a, b) => b - a)) this.removeDataPointAt(i);
      return;
    }

    // Grouped series. What removing ONE member means depends on what the members
    // ARE to each other -- see AxesTypeConfig.tupleMembers.
    if (dataset.hasSlots()) {
      // N x 1D (spider): the slots are independent readings, so remove exactly the
      // ones asked for and leave their neighbours standing. The freed slot is not
      // a hole to be tidied away: it is the next thing to capture, which is why the
      // cursor is re-aimed at it below -- the same worklist the axis-aware trace
      // leaves behind when it refuses a ray.
      //
      // ⚑ This branch exists because the whole-tuple rule below deleted a six-axis
      // profile when the Eraser was asked for one reading (David, driving the app).
      // The rule was right for the type it was written for and wrong for the type
      // that inherited it.
      if (this.config.tupleMembers === 'independent') {
        const uniq = [...new Set(indices)].filter((i) => i >= 0 && i < dataset.getCount());
        for (const i of uniq.sort((a, b) => b - a)) this.removeDataPointAt(i);
        this.activeEntry.slotCursor = this.computeSlotCursorFor(dataset);
        return;
      }
      // 1.5D (box plot / histogram): a selected member stands for its whole tuple
      // -- removing one member would leave a partial box, which is not half the
      // data but nonsense. Map to unique tuples, remove each whole, high index first.
      const tuples = new Set<number>();
      for (const i of indices) {
        const t = dataset.getTupleIndex(i);
        if (t > -1) tuples.add(t);
      }
      for (const t of [...tuples].sort((a, b) => b - a)) this.removeTuple(t);
      return;
    }

    const descending = [...new Set(indices)].sort((a, b) => b - a);
    for (const i of descending) this.removeDataPointAt(i);
  }

  /** True when another series records error bars for the ACTIVE series. */
  activeHasErrorSeries(): boolean {
    return hasErrorSeries(this.getDatasets(), this.activeEntry.dataset.name);
  }

  /** Data-space {x,y} for one pixel (NaN-filled when the axes cannot say). */
  private dataOf(p: { x: number; y: number }): { x: number; y: number } {
    const v = this.axes ? this.axes.pixelToData(p.x, p.y) : [];
    return { x: v[0] ?? NaN, y: v[1] ?? NaN };
  }

  /** Data-space {x,y} for every pixel of a dataset, index-aligned. */
  private dataValuesOf(dataset: Dataset): { x: number; y: number }[] {
    return dataset.getAllPixels().map((p) => this.dataOf(p));
  }

  /** Remove every error cap that resolves to the datum at `parentDatumIndex`
   * -- i.e. the whole error bar for that one data point -- and leave the parent
   * point itself. `parentData` is the parent's data values, passed in so a
   * caller deleting several points matches every cap against the same
   * pre-removal snapshot.
   *
   * `only` scopes WHICH error series are touched, by series name (trimmed):
   *   - omitted -> every error series of the parent. This is the CASCADE door
   *     (deleting the data point takes ALL its error bars, every type).
   *   - a set -> just those series. This is the CAP-delete door: the caller
   *     passes the selected bar's own upper/lower pair, so deleting one "SD"
   *     cap does not also wipe a separate "95% CI" bar on the same datum. */
  private removeErrorCapsForDatum(
    parentName: string,
    parentData: { x: number; y: number }[],
    parentDatumIndex: number,
    only?: ReadonlySet<string>
  ): void {
    for (const { dataset, role } of errorSeriesFor(this.getDatasets(), parentName)) {
      if (only && !only.has(dataset.name.trim())) continue;
      const drop: number[] = [];
      dataset.getAllPixels().forEach((cap, ci) => {
        if (matchCapToDatum(parentData, this.dataOf(cap), role) === parentDatumIndex) drop.push(ci);
      });
      for (const ci of drop.sort((a, b) => b - a)) dataset.removePixelAtIndex(ci);
    }
  }

  /** Delete an ENTIRE tuple -- a Box Plot box / a Histogram bin, i.e. one whole
   * row of the category table -- from the active dataset in one action
   * (checkpoint 129, v0.7 "tuple delete"). Every point filed under that
   * category goes, along with the tuple slot and its label. The trash button
   * peels points one at a time, and a mis-placed box is a whole tuple; this is
   * the missing bulk gesture for grouped types. No-op for a dataset without
   * slots or an out-of-range index.
   *
   * Removes the tuple's pixels high-index -> low so each splice leaves the lower
   * indices (and this tuple's not-yet-removed pixels) valid, refreshing the
   * remaining tuples' pixel indices after each removal -- the exact pixel-removal
   * contract removeDataPointAt honours. The tuple's ARRAY position is untouched
   * by pixel removal (refreshTuplesAfterPixelRemoval only rewrites indices
   * inside tuples), so the passed tupleIndex still addresses it at the end. A
   * grouped dataset never holds interpolation anchors (addAnchorPoint declines
   * slot datasets), so no rebuildInterpolation is needed. */
  removeTuple(tupleIndex: number): void {
    const dataset = this.activeEntry.dataset;
    if (!dataset.hasSlots()) return;
    if (tupleIndex < 0 || tupleIndex >= dataset.getTupleCount()) return;
    const pixelIndices = dataset
      .getTuple(tupleIndex)
      .filter((i): i is number => i !== null)
      .sort((a, b) => b - a);
    for (const index of pixelIndices) {
      dataset.removePixelAtIndex(index);
      dataset.refreshTuplesAfterPixelRemoval(index);
    }
    dataset.removeTuple(tupleIndex);
    // Removing a tuple shifts every later tuple's position, so recompute where
    // the next Place Point click files -- the same reset the load path uses.
    this.activeEntry.slotCursor = this.computeSlotCursorFor(dataset);
    // v2.0 pre-launch audit: a pending exploded-slice apex is pinned to a
    // tuple INDEX (see setActiveDataset's own comment on this state). Deleting
    // the pinned tuple itself must cancel the in-progress capture, not leave a
    // stale index that later silently reattaches this discarded apex to
    // whatever tuple next lands at the same index (`addDataPoint`'s consumer
    // of this state has no way to tell the difference). Deleting an EARLIER
    // tuple shifts every later one down by one -- same array-splice this
    // method's own pixel removal already accounts for -- so the pending index
    // has to shift with it or it will point at the wrong tuple from here on.
    this.fixPendingExplodedAfterTupleRemoval(tupleIndex);
    this.pruneOrphanedCategories();
  }

  /** Whether sortByNearestNeighbour would do anything for the active series --
   *  the UI gate for its button (checkpoint 130). See that method for the rules. */
  canSortByNearestNeighbour(): boolean {
    const dataset = this.activeEntry.dataset;
    if (dataset.hasSlots()) return false;
    const pixels = dataset.getAllPixels();
    if (pixels.length < 3) return false;
    return !pixels.some(
      (p) => p.metadata?.['role'] === 'anchor' || p.metadata?.['role'] === 'interpolated'
    );
  }

  /** Reorder the active series' points into a continuous nearest-neighbour path
   *  (checkpoint 130, v0.7 "NN sort") -- the manual counterpart to the ordering
   *  Segment Fill / colour-trace already apply internally (ckpt 78, WPD's
   *  dataTable.js connectivity branch). Useful when points were placed out of
   *  order, or came from the Blob Detector (marker-discovery order is arbitrary):
   *  the connecting line, CSV row order and geometry all follow point order.
   *
   *  It ONLY reorders -- never moves, adds or drops a point -- so it is a
   *  traversal of the same record, not interpretation (tenet 9). No-op unless the
   *  active series is a plain ungrouped one with 3+ points and no interpolation
   *  roles (canSortByNearestNeighbour): a Box Plot's tuples and an interpolation
   *  series' anchor-derived order each carry meaning a free reorder would destroy.
   *
   *  Permutes the ACTUAL pixels (each carrying its per-pixel metadata) by the
   *  nearest-neighbour index order -- it does NOT rebuild bare coordinates. That
   *  matters because an ungrouped series loaded from a WPD project can hold
   *  per-pixel metadata a plain click-placed one never does: a Bar's per-point
   *  `label` (category name) and a manual value `overrides`, both read at export
   *  (core/exportValues.ts, core/dataProviders.ts). The first cut stripped those
   *  to `undefined` -- a silent data loss the gate's "no per-pixel metadata"
   *  reasoning missed, because that reasoning only held for the click path and
   *  the load path is a second entrance (the guards-belong-in-the-model lesson,
   *  ckpts 69/72/77/80). Series-level metadata (name, colour, error relation)
   *  rides on the Dataset itself and reorderPixels leaves it untouched, as do
   *  the tuples -- which it remaps rather than stranding (see its own note). */
  sortByNearestNeighbour(): void {
    if (!this.canSortByNearestNeighbour()) return;
    const dataset = this.activeEntry.dataset;
    const pixels = dataset.getAllPixels();
    dataset.reorderPixels(nearestNeighbourOrder(pixels.map((p) => ({ x: p.x, y: p.y }))));
  }

  /** Reposition an already-placed calibration handle (drag-to-adjust). Re-runs calibration
   * immediately if it was already calibrated, so the live pixel→data readout stays correct. */
  /**
   * Rename one spoke, from the spreadsheet (v1.4, David: *"I cannot edit the axis
   * in the spreadsheet. THAT I want to fix"*).
   *
   * ⚑ The name is the ONE thing on a spider that is transcribed rather than
   * measured — everything else on that row was read off the pixels — so it is
   * editable for exactly the reason a bar's category name is, and correcting a
   * typo must not mean re-walking the calibration.
   *
   * ⚑ IT LIVES IN THE CALIBRATION, NOT ON THE POINTS. A spoke's name is a property
   * of the AXIS, so this writes it to that spoke's calibration point and re-derives
   * — which is what carries it into the axes object, the slot names, the
   * table and the export in one move, with no second copy to disagree. Same route a
   * dragged handle takes.
   */
  setSpokeName(index: number, name: string): boolean {
    const repeating = this.config.repeatingStep;
    if (!repeating || this.config.axesKind !== 'spider') return false;
    const point = this.placed[`${repeating.step.key}${index + 1}`];
    if (!point) return false;
    const fieldIndex = repeating.step.valueFields.findIndex((f) => f.field === 'dz');
    if (fieldIndex < 0) return false;
    while (point.values.length <= fieldIndex) point.values.push('');
    point.values[fieldIndex] = name;
    // ⚑ RELABEL, DO NOT RE-DERIVE (David: "I do not see how changing them should
    // re-drive anything"). A name carries no geometry, so nothing about the axes
    // needs recomputing — and running the calibration to change a string would make
    // a typo fix depend on that calibration still succeeding, which is a way for
    // renaming an axis to drop the calibration. The name goes onto the live axes,
    // and the capture slots are relabelled by the same in-place path a real
    // re-calibration uses (which preserves recorded tuples when the count matches).
    if (this.axes) {
      // ⚑ THE PERSISTED COPY FIRST. Serialization reads a spoke's name from its
      // CALIBRATION POINT (`dz`), not from the live axes — so writing only the
      // derived copies made the rename vanish on save and reopen, and left undo
      // restoring a state where the table and the calibration card disagreed. The
      // comment here used to claim this was written "to that spoke's calibration
      // point"; it was not. Caught by the v1.4 release audit, which round-tripped
      // through a real project file — the test that passed had reloaded from the
      // live axes and could never have seen it.
      const calibration = (this.axes as unknown as { calibration: Calibration | null }).calibration;
      const calibrationIndex = this.config.fixedSteps.length + index; // origin steps, then one per spoke
      const cp = calibration?.getPoint(calibrationIndex);
      if (calibration && cp) calibration.setDataAt(calibrationIndex, cp.dx ?? '', cp.dy ?? '', name);
      (this.axes as unknown as SpiderAxes).setSpokeName(index, name);
      this.applyAxesDerivedSlots();
    }
    return true;
  }

  updateCalibPointPixel(key: string, px: number, py: number): void {
    const point = this.placed[key];
    if (!point) return;
    point.px = px;
    point.py = py;
    if (this.axes) this.runCalibration();
  }

  /** Reposition an already-placed data point in the active dataset (drag-to-adjust).
   * If the moved point is an interpolation-assist anchor (checkpoint 120), the
   * derived curve is rebuilt from the new anchor positions so it doesn't go stale
   * under the moved guide point -- keeping the "curve redraws live" promise on
   * drag, keyboard nudge, and value-edit alike (all route through here). */
  updateDataPointPixel(index: number, px: number, py: number): void {
    const dataset = this.activeEntry.dataset;
    const role = dataset.getPixel(index)?.metadata?.['role'];
    // ⚑ A derived sample is not editable, and the guard belongs HERE -- this is
    // where every move converges (drag, keyboard nudge, value-edit). v1.3 put it
    // in commitDataPointEdit, a UI handler, while its own comment claimed to be
    // "the model-side rule"; the v1.3 gate then walked around it by clicking an
    // italic table row and pressing an arrow key. Moving an interpolated point
    // "sticks" only until the next anchor moves, which silently discards it --
    // exactly the defect the read-only rows were added to close.
    if (role === 'interpolated') return;
    // A spider point stays ON its axis however it is moved — drag, arrow nudge or
    // value edit all land here. Without this a drag would lift the point off the
    // ray it belongs to, and the marker would once again sit somewhere that does
    // not correspond to its own exported value. The spoke comes from the point's
    // own tuple slot, so a drag can never move it onto a different axis: changing
    // which axis a reading belongs to is a delete-and-re-place, not a nudge.
    // An ERROR CAP stays ON the bar its datum anchors, however it is moved --
    // exactly the spider rule below, for the same reason. captureErrorCap
    // axis-locks the cap when it is first dragged out (capFreeDirection +
    // constrainCap), and until 2026-08-03 nothing re-applied that lock when the
    // user adjusted the cap AFTERWARDS -- which the error-bars card explicitly
    // tells them to do ("pick its series under Recorded below, then drag the
    // cap"). A sideways drag drifted the cap off its datum: a slanted whisker,
    // and a recorded X the figure never showed.
    //
    // ⚑ errorCapDragLine was written for precisely this call and had NO caller
    // at all -- its own comment asserted "ui/ uses this to axis-lock a cap's
    // drag, so the invariant captureErrorCap establishes keeps holding". It did
    // not. The guard belongs here rather than in ui/, because this is where
    // drag, arrow-nudge and value-edit converge; putting it in the drag handler
    // is the v1.3 mistake the derived-sample guard above already records.
    const capLine = this.errorCapDragLine(this.activeDatasetIndex, index);
    const onBar = capLine ? constrainCap(capLine.origin, { x: px, y: py }, capLine.direction) : { x: px, y: py };
    const snapped = this.snapToSpoke(onBar.x, onBar.y, this.spokeIndexOfPoint(index));
    dataset.setPixelAt(index, snapped.x, snapped.y);
    if (role === 'anchor') this.rebuildInterpolation();
  }

  /** Carry every stored pixel -- calibration handles, the pending pixel, and all
   * datasets' points -- through a coordinate map (checkpoint 62's image editing),
   * so the whole document tracks the image when it's rotated/flipped. Re-runs
   * calibration afterward so the axes recompute from the moved handles; because
   * the handles move with the image, the calibrated data values are preserved. */
  transformAllPixels(map: (px: number, py: number) => { x: number; y: number }): void {
    for (const key of Object.keys(this.placed)) {
      const p = this.placed[key]!;
      const m = map(p.px, p.py);
      p.px = m.x;
      p.py = m.y;
    }
    if (this.pendingPixel) {
      const m = map(this.pendingPixel.px, this.pendingPixel.py);
      this.pendingPixel = { px: m.x, py: m.y };
    }
    // v2.1: the two category-axis EDGES are stored pixels too, so they move with
    // the image like every other handle.
    //
    // ⚑ The TICKS need no pass of their own, and that is why they are stored as
    // parameters along the axis rather than as pixels: moving the two edges
    // carries the whole set by construction. A tick list transformed
    // independently could drift off the axis it belongs to; this cannot.
    const edges = this.categoryAxis.getAxisEdges();
    if (edges) {
      const a = map(edges[0].x, edges[0].y);
      const b = map(edges[1].x, edges[1].y);
      // Keep the ticks: setAxisEdges regenerates, which would silently discard
      // any the user had dragged. An image edit must not undo their work.
      const ticks = [...this.categoryAxis.getTickParams()];
      const adjusted = this.categoryAxis.hasAdjustments();
      if (this.categoryAxis.setAxisEdges({ x: a.x, y: a.y }, { x: b.x, y: b.y })) {
        this.categoryAxis.restoreTickParams(ticks, adjusted);
      }
    }
    for (const entry of this.datasetEntries) {
      entry.dataset.getAllPixels().forEach((pt, i) => {
        const m = map(pt.x, pt.y);
        entry.dataset.setPixelAt(i, m.x, m.y);
      });
    }
    if (this.axes) this.runCalibration();
  }

  /** Clears the active dataset's points, preserving its name/color (unlike a
   * pre-checkpoint-30 clearPoints, which discarded the whole Dataset object
   * and so silently reset a custom name/color back to class defaults --
   * harmless when every session only ever had one, unnamed dataset, but a
   * real regression once series have meaningful names). */
  clearPoints(): void {
    const entry = this.activeEntry;
    const fresh = new Dataset(this.config.dataDim);
    fresh.name = entry.dataset.name;
    fresh.colorRGB = entry.dataset.colorRGB;
    // Only the *graph type's own* groups come back. Clearing a Box Plot still
    // drops its Min/Q1/Median/Q3/Max entirely -- those are opt-in user state
    // this deliberately resets (see this file's "reset and clearPoints drop
    // slots" test) -- but a Histogram's bin groups are the type's
    // inherent capture shape, not something the user switched on, so clearing
    // its points must not quietly leave a Histogram that can't record a bin.
    if (this.config.defaultSlots) fresh.setSlotNames([...this.config.defaultSlots]);
    // ⚑ ...and the same for a type whose capture shape is DERIVED from the axes.
    // A spider has no `defaultSlots` — its slots are its calibrated spokes —
    // so clearing left the series with no slots at all. Every later capture then
    // took the ungrouped path: unsnapped, absent from the table, and deleted
    // wholesale by the load-time axis-less drop when the project was reopened.
    // Same reason the Histogram case above exists (the type's inherent capture
    // shape must survive a clear), for the half of the shape that only exists once
    // the axes do. Found by the v1.4 release audit.
    const derived = this.config.slotsFromAxes && this.axes ? this.config.slotsFromAxes(this.axes) : null;
    if (derived && derived.length > 0) fresh.setSlotNames([...derived]);
    entry.dataset = fresh;
    entry.slotCursor = { tupleIndex: null, groupIndex: 0 };
    // v2.0 pre-launch audit: the fresh dataset above has no tuples, so a
    // pending exploded-slice apex pinned to a tuple INDEX in the discarded
    // dataset is now pointing at nothing -- left set, it would silently
    // reattach to whatever tuple the next capture creates at that same
    // index. Same clear reset()/restoreState()/loadCalibrated() already
    // apply, extended to this entrance too.
    this.explodedApexPending = false;
    this.pendingExplodedTuple = null;
    this.pendingApex = null;
  }

  reset(): void {
    this.placed = {};
    this.stepIndex = 0;
    this.pendingPixel = null;
    this.axes = null;
    this.calibrationError = null;
    // Back to the DEFAULTS, not to empty -- a prefilled global (the pie's total and
    // sweep) must survive a reset the same way it survives a fresh session, or the
    // second figure of a session would be greeted by blank fields the first had
    // filled in for it.
    this.globalValues = {};
    for (const gf of this.config.globalFields) {
      if (gf.defaultValue !== undefined) this.globalValues[gf.key] = gf.defaultValue;
    }
    // Back to the starting spoke count. Leaving a previous figure's count behind
    // would greet the next figure with handles it never asked for.
    this.repeatCount = this.config.repeatingStep?.min ?? 0;
    this.datasetEntries = [this.buildDatasetEntry('Series 1', 0)];
    this.activeDatasetIndex = 0;
    this.nextDatasetNumber = 2;
    // ⚑ THE FOURTH ENTRANCE (same audit recipe, 2026-07-30, alongside
    // restoreState's and loadCalibrated's own fixes). "Reset calibration"
    // (this method's real, direct call site) promises to discard every
    // series and point -- a stale `pendingExplodedTuple` pointing into the
    // dataset that just got wiped down to one empty series would silently
    // swallow every click afterward (the same failure the other two fixes
    // prevent), and a stale `categoryAxis` would leave the OLD figure's
    // category names available for the new one to silently reuse, which
    // "discard every series and point" does not actually promise to keep.
    this.explodedApexPending = false;
    this.pendingExplodedTuple = null;
    this.pendingApex = null;
    this.categoryAxis = new CategoryAxis();
  }

  /** Capture the whole mutable state for the undo stack (checkpoint 38, see
   * SessionSnapshot). Cheap enough to call on every committed action: for the
   * hundreds-of-points scale this app targets, PlotData.serialize is
   * sub-millisecond, and it's only invoked per discrete gesture, never per
   * frame. Mirrors engine/projectFile.ts's serializeProject assembly (add each
   * dataset, link it to the axes if calibrated) but does *not* require a
   * calibrated session -- an uncalibrated snapshot just has an empty axesColl,
   * which deserialize round-trips fine. */
  captureState(): SessionSnapshot {
    const plotData = new PlotData();
    const axes = this.axes as unknown as AnyAxes | null;
    if (axes) plotData.addAxes(axes);
    // v2.0: the category axis is a THIRD entrance the undo snapshot must not
    // miss (the pre-v2.0 audit's own lesson -- "the undo snapshot is an
    // entrance", found on the spider's repeat count). Bound to every dataset
    // unconditionally, same as `axes` above: non-bar types simply never read
    // or write it, so binding it costs nothing and there's no type to check.
    plotData.addCategoryAxis(this.categoryAxis);
    for (const entry of this.datasetEntries) {
      plotData.addDataset(entry.dataset);
      if (axes) plotData.setAxesForDataset(entry.dataset, axes);
      plotData.setCategoryAxisForDataset(entry.dataset, this.categoryAxis);
    }
    return {
      placed: structuredClone(this.placed),
      stepIndex: this.stepIndex,
      pendingPixel: this.pendingPixel ? { ...this.pendingPixel } : null,
      calibrationError: this.calibrationError,
      optionValues: { ...this.optionValues },
      activeDatasetIndex: this.activeDatasetIndex,
      nextDatasetNumber: this.nextDatasetNumber,
      globalValues: { ...this.globalValues },
      repeatCount: this.repeatCount,
      explodedApexPending: this.explodedApexPending,
      pendingExplodedTuple: this.pendingExplodedTuple,
      pendingApex: this.pendingApex ? { ...this.pendingApex } : null,
      cursors: this.datasetEntries.map((e) => ({ ...e.slotCursor })),
      plotData: plotData.serialize(),
    };
  }

  /** Restore a snapshot captured earlier (undo/redo). Rebuilds datasets + axes
   * from the plotData round-trip -- fresh core instances, so restoring never
   * aliases the live objects a later mutation would touch -- and reattaches the
   * session-only bookkeeping. `activeDatasetIndex` is re-clamped defensively in
   * case a snapshot is ever restored against a shorter dataset list. */
  restoreState(snapshot: SessionSnapshot): void {
    const plotData = new PlotData();
    plotData.deserialize(snapshot.plotData);
    const datasets = plotData.getDatasets();
    this.axes = (plotData.getAxesColl()[0] ?? null) as A | null;
    // v2.0: restore the SAME category-axis instance captureState bound every
    // dataset to -- falls back to a fresh empty one only if the snapshot
    // somehow predates this field entirely (never true in practice, since
    // captureState always adds one; defensive rather than assumed).
    this.categoryAxis = plotData.getCategoryAxisColl()[0] ?? new CategoryAxis();
    // ⚑ THE SPOKE COUNT IS DOCUMENT STATE (v1.4's variable-length calibration).
    // Restored BEFORE `placed` and `stepIndex` below, since both are read against
    // the step list this count decides. The other two entrances already handle it —
    // loadCalibrated takes it from the file's own calibration length, reset() puts
    // it back to the minimum — and this one was left out, so an undo of "+ axis"
    // changed nothing on screen, and an undo of "− axis" brought the placed point
    // back with no step to hang it on: an orphan the calibration could not see and
    // the next "+ axis" silently inherited. Same "the model has more than one
    // entrance" class as the guards in loadCalibrated, reached by a third route.
    // Clamped to the config's own minimum rather than trusted outright — the same
    // defensive posture as activeDatasetIndex below.
    const repeating = this.config.repeatingStep;
    this.repeatCount = repeating ? Math.max(repeating.min, snapshot.repeatCount) : 0;
    this.datasetEntries = datasets.map((dataset, i) => ({
      dataset,
      // ⚑ VALIDATE the cursor against the dataset just REBUILT, don't trust it.
      // `PlotData.serialize` records tuples through their member pixels, so a
      // tuple with NO pixels is not written at all -- and pie's apex click
      // mints exactly that. Restoring a snapshot taken at that moment gave a
      // cursor pointing at tuple 1 of a dataset that now has one tuple, and
      // the next click threw straight out of the canvas handler:
      // "Cannot read properties of undefined (reading 'includes')" in
      // dataset.addToTupleAt. An uncaught throw needs no unusual input -- just
      // Ctrl+Z at the wrong moment. (Round-2 audit.)
      slotCursor: validCursorFor(dataset, snapshot.cursors[i]),
    }));
    this.placed = structuredClone(snapshot.placed);
    this.stepIndex = snapshot.stepIndex;
    this.pendingPixel = snapshot.pendingPixel ? { ...snapshot.pendingPixel } : null;
    this.calibrationError = snapshot.calibrationError;
    this.activeDatasetIndex = Math.min(snapshot.activeDatasetIndex, this.datasetEntries.length - 1);
    this.nextDatasetNumber = snapshot.nextDatasetNumber;
    this.globalValues = { ...snapshot.globalValues };
    this.optionValues = { ...snapshot.optionValues };
    // ⚑ Found via the pre-v2.0 audit's own recipe applied to itself, 2026-07-30:
    // these three were the fourth+fifth+sixth fields missing from the snapshot,
    // same class of bug as repeatCount above. `pendingExplodedTuple` is a tuple
    // INDEX into the datasets just restored above, so leaving it at its stale
    // live value (from AFTER this snapshot was taken) could point past the
    // now-shorter dataset -- and addDataPoint's own guard on
    // `dataset.getAllTuples()[t]` degrades to a silent no-op when `t` is out of
    // range, permanently swallowing every future click with no error shown.
    // Restored verbatim (not reset to "off"): an undo landing mid-explode
    // should show mid-explode, matching what `cursors` already does for the
    // ordinary per-series capture cursor.
    this.explodedApexPending = snapshot.explodedApexPending;
    this.pendingExplodedTuple = snapshot.pendingExplodedTuple;
    this.pendingApex = snapshot.pendingApex ? { ...snapshot.pendingApex } : null;
  }
}

