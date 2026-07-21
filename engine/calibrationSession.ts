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
 * core/dataset.ts's `setPointGroups` has named groups (e.g. Box Plot's
 * Min/Q1/Median/Q3/Max -- see applyBoxPlotGroups), `addDataPoint` no
 * longer just appends a pixel: it also files the new pixel into a
 * "tuple" (one category/box) at the current group slot, tracked by
 * `pointGroupCursor`, then advances that cursor to the next open slot
 * (nextGroupCursor, a direct port of pointGroups.js's nextGroup -- search
 * the current tuple past the current group, then later tuples, then fall
 * back to "start a new tuple" if nothing open is found). `removeLastPoint`
 * mirrors DeleteDataPointTool's single-point removal path (not its
 * whole-tuple-deletion popup, which real WPD gates behind a confirm
 * dialog and this checkpoint doesn't add): cleans the pixel out of
 * whichever tuple held it, drops the tuple if it's now empty, and walks
 * the cursor back with previousGroupCursor (nextGroup's mirror image).
 * Checkpoint 21 was the interaction-model half of Box Plot support only.
 *
 * Checkpoint 22 adds the box-and-whisker glyph deferred from checkpoint
 * 21, a faithful port of the current app's drawBoxGlyph (commit
 * c0b6021): getBoxPlotGlyphs() recognizes a dataset whose point groups
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
 * tuple auto-labels it with WPD's own default (axes.dataPointsLabelPrefix
 * + tuple index -- ManualSelectionTool.onMouseClick, manualDetectionTools.js),
 * via a narrow duck-typed read off `this.axes` the same way
 * getBoxPlotGlyphs reads calculateOrientation. Real WPD lets a user
 * override this default through a shift-click popup
 * (wpd.dataPointLabelEditor, controllers/manualDetection.js) --
 * deliberately not ported as a popup here: Workspace.tsx instead renders
 * an always-editable inline text input in the tuple table, consistent
 * with this rebuild's own "no floating popups" design direction (see
 * CLAUDE.md's Product #1 design notes).
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
 * point-groups cursor isn't part of a serialized project at all, so it's
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
 * `this.pointGroupCursor` directly now goes through a private
 * `activeEntry` getter instead, so a manual click, a Segment Fill trace,
 * Box Plot point groups, etc. all implicitly operate on "whichever
 * dataset is currently active" -- the exact same behavior as before for
 * the single-dataset case (there's always >= 1 dataset; a session that
 * never calls addDataset behaves identically to a pre-checkpoint-30
 * session), with the new dataset-management methods layered on top:
 * addDataset/removeDataset/setActiveDataset/renameDataset/
 * setDatasetColor/getDatasetInfos. `getDataset()`/`getDataPoints()`/
 * `hasPointGroups()`/etc. keep their exact pre-checkpoint-30 names and
 * signatures -- they now mean "for the active dataset" rather than "for
 * the dataset", which is a no-op distinction until a second dataset
 * exists. `getAllDatasetsData()` is the one genuinely new read: every
 * dataset's own points + color, for ui/'s canvas to render every series
 * at once (only the active one draggable -- see Workspace.tsx). Each
 * dataset keeps its own independent point-groups cursor (Box Plot state
 * is inherently per-series), computed the same way loadCalibrated always
 * has (computePointGroupCursorFor, generalized from the old no-arg
 * recomputePointGroupCursor to take an explicit dataset so it can run
 * once per loaded dataset instead of only for "the" one).
 */

import { Calibration } from '../core/calibration.js';
import { Dataset } from '../core/dataset.js';
import { Color } from '../core/color.js';
import { XYAxes } from '../core/axes/xy.js';
import { BarAxes } from '../core/axes/bar.js';
import { PolarAxes } from '../core/axes/polar.js';
import { TernaryAxes } from '../core/axes/ternary.js';
import { MapAxes } from '../core/axes/map.js';
import { CircularChartRecorderAxes, type RotationTime, type RotationDirection } from '../core/axes/circularChartRecorder.js';
import { PlotData, type SerializedPlotData, type AnyAxes } from '../core/plotData.js';
import { computeBoxPlotGlyph, type BoxPlotGlyphSegment, type BoxPlotOrientation } from './boxPlotGlyph.js';
import { binsFromCorners, type HistogramBin } from '../algorithms/histogram.js';
import { interpolateCurveOrdered } from '../algorithms/interpolate.js';
import { nearestNeighbourOrder } from '../algorithms/segmentFill.js';
import { computeBinGlyph, type GlyphSegment } from './histogramGlyph.js';
import { computeErrorBarGlyph, computeWhiskerGlyph } from './errorBarGlyph.js';
import { calibrationPreview, type CalibrationPreview } from './calibrationPreview.js';
import {
  errorBarsFromCorners,
  matchCapToDatum,
  resolveErrorBars,
  type ErrorBarPoint,
  type ErrorCapSeries,
  type ErrorRole,
} from '../algorithms/errorBar.js';
import {
  capFreeDirection,
  constrainCap,
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
  retargetErrorRelations,
  clearErrorRelationsTo,
  type ErrorRelation,
} from './errorRelation.js';
import { datasetNameError, uniqueDatasetName, dedupeDatasetNames } from './seriesNames.js';
import { valueAtPixel, exportLabelsFor, type ExportValue } from '../core/exportValues.js';
import { halfPixelResolution, roundToResolution, type PrecisionMode } from '../core/exportPrecision.js';

/** The minimal surface every supported axes type's calibrated instance provides. */
export interface CalibratedAxes {
  pixelToData(px: number, py: number): number[];
  /** The axes' own export column headers. Declared here (checkpoint 76) because
   * all 7 classes have always implemented it (core/axes/types.ts:25) — it was
   * just never named as a requirement, which is how `AxesTypeConfig.valueLabels`
   * grew beside it and diverged. See core/exportValues.ts. */
  getAxesLabels(): string[];
  /**
   * Project a value back to a pixel. Declared here (checkpoint 79) on the same
   * grounds as getAxesLabels: all 7 classes have always implemented it, it was
   * simply never named.
   *
   * **Implemented for real only on XY and Image — the other 5 are stubs
   * returning `{x: 0, y: 0}`** (`core/axes/bar.ts:93` and friends, "not
   * implemented yet — matches the original exactly"). Declaring it does not
   * change that; callers must not assume it inverts. `algorithms/errorCapture.ts`
   * measures whether it does rather than trusting it, and degrades to "no
   * constraint" where it does not.
   */
  dataToPixel(x: number, y: number): { x: number; y: number };
}

export interface CalibValueField {
  /** Stable identity for this field within its step (input testid, React key). */
  key: string;
  /** Short label shown next to this field's input, e.g. "X" or "θ". */
  label: string;
  /** Which Calibration point slot this field's entered value fills. */
  field: 'dx' | 'dy';
  /** When true, the field may be left blank (it defaults to "0" on confirm). For
   * a value the calibration collects but never reads — e.g. Polar P2's θ, which
   * mirrors WebPlotDigitizer's form but is ignored by the math. */
  optional?: boolean;
}

export interface CalibStepInfo {
  key: string;
  label: string;
  /** Marker color for this step's placed handle. */
  color: string;
  prompt: string;
  /** Value(s) collected for this step's point, in entry order. Empty for a
   * point that needs no typed value at all (e.g. Polar's origin). */
  valueFields: readonly CalibValueField[];
}

export type BuildAxesResult<A extends CalibratedAxes> = { axes: A } | { error: string };

/** A value collected once after every click-step is placed, not tied to any
 * specific click (e.g. Circular Chart Recorder's "Chart Start Time"). */
export interface GlobalFieldInfo {
  key: string;
  label: string;
}

/**
 * One per-axes-type calibration *setting* — log scales, orientations, units
 * (checkpoint 68).
 *
 * Distinct from GlobalFieldInfo, which collects a *measured value* (CCR's chart
 * start time). These configure how the axes interpret the values instead: WPD
 * exposes every one as an ordinary control on its calibration sidebar
 * (`wpd-core/templates/_sidebars.html:251-527`).
 *
 * Every one of these was hardcoded to a literal in buildAxes until now, across
 * 6 of the 7 axes types — the single biggest finding of the 2026-07-15 parity
 * re-audit (see CLAUDE.md). `core/` supported all of it the whole time; only
 * the UI was missing, so log axes — table stakes for scientific figures — were
 * unreachable and undiscoverable.
 *
 * Values are carried as strings throughout (a checkbox is 'true'/'false'), so
 * one Record shape serves every kind and rides the same rails globalValues
 * already proved.
 */
export type AxesOption =
  | { key: string; label: string; kind: 'checkbox'; default: boolean }
  | {
      key: string;
      label: string;
      kind: 'choice';
      choices: readonly { value: string; label: string }[];
      default: string;
    }
  | { key: string; label: string; kind: 'text'; default: string; placeholder?: string };

/** Context handed to buildAxes. Grew from a bare `globalValues` argument at
 * checkpoint 68 so options — and MapAxes's image height, which only its
 * bottom-left origin needs and which the session can't otherwise know — reach
 * the axes without every config growing its own argument. */
export interface BuildAxesContext {
  globalValues: Readonly<Record<string, string>>;
  options: Readonly<Record<string, string>>;
  /** Natural height of the loaded image, in pixels. Only MapAxes uses it (to
   * flip y for a bottom-left origin); 0 when no image is loaded. */
  imageHeight: number;
}

/**
 * A declarative guard: "when `option` is on, these calibration values may not
 * be zero" (checkpoint 72).
 *
 * Checkpoint 69 ported WPD's log-zero refusal
 * (`controllers/axesCalibration.js:79-86`) as a hardcoded XY-only function --
 * fixing the *instance* and leaving the *class* open. An adversarial review of
 * that checkpoint found Bar and Polar still calibrating "successfully" and
 * reading back null. Bar is the worst case: **a bar chart's baseline value IS
 * zero**, so entering 0 is the most natural input in that flow -- right next to
 * the Log-scale checkbox checkpoint 68 had just added. Declaring the guard per
 * config makes it impossible to add a log option without deciding this.
 */
export interface LogScaleGuard {
  /** AxesOption key that turns this scale logarithmic. */
  option: string;
  /** Calibration point indices carrying the scale's endpoints. */
  points: readonly number[];
  field: 'dx' | 'dy';
  /** How the axis is named to the user, e.g. "X", "radial". */
  label: string;
}

/**
 * Pre-calibration refusals, run before any axes class sees the values.
 *
 * This is the layer WPD keeps in `controllers/` and we never ported: `core/` is
 * where the math lives, `controllers/` is where the *refusals* live. Every axes
 * class happily reports success on degenerate input, so the refusal cannot live
 * there -- it has to run first, on the entered values.
 *
 * Returns an error message, or null when the calibration is usable.
 */
function checkGuards(
  config: AxesTypeConfig<CalibratedAxes>,
  cal: Calibration,
  options: Readonly<Record<string, string>>
): string | null {
  for (const g of config.logScaleGuards ?? []) {
    if (!optionBool(options, g.option)) continue;
    for (const idx of g.points) {
      const pt = cal.getPoint(idx);
      const raw = g.field === 'dx' ? pt?.dx : pt?.dy;
      if (parseFloat(String(raw ?? '')) === 0) {
        return `A log ${g.label} scale cannot pass through zero — enter non-zero values (e.g. 1 and 100).`;
      }
    }
  }
  // Distinct-pixel invariant. Two points of one axis on a single pixel make the
  // transform singular. Checkpoint 69 filtered only the *reuse buttons*, and did
  // it with a string-shape heuristic on a trailing digit that silently no-opped
  // on Ternary (a/b/c) and CCR (t1r2/t2r2) -- and never covered the drag path at
  // all. Checking the real invariant here catches every route in.
  for (const group of config.distinctPixelSteps ?? []) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const ai = config.steps.findIndex((st) => st.key === group[i]);
        const bi = config.steps.findIndex((st) => st.key === group[j]);
        const a = cal.getPoint(ai);
        const b = cal.getPoint(bi);
        if (a && b && a.px === b.px && a.py === b.py) {
          const la = config.steps[ai]?.label ?? group[i];
          const lb = config.steps[bi]?.label ?? group[j];
          return `${la} and ${lb} are on the same pixel — they must be different points, or the calibration has no scale.`;
        }
      }
    }
  }
  return null;
}

/** True when two steps must never share a pixel, per the config's own
 * declaration -- replaces checkpoint 69's trailing-digit heuristic, which
 * no-opped on Ternary and CCR. Used to filter the reuse-pixel buttons; the
 * calibration itself is guarded by checkGuards above, which also covers drags. */
function mustDiffer(config: AxesTypeConfig<CalibratedAxes>, a: string, b: string): boolean {
  return (config.distinctPixelSteps ?? []).some((g) => g.includes(a) && g.includes(b));
}

/** Reads an option Record as a boolean, for a 'checkbox' option. */
export function optionBool(options: Readonly<Record<string, string>>, key: string): boolean {
  return options[key] === 'true';
}

/** Every option's default, as the string Record buildAxes expects. */
export function defaultOptionValues(config: AxesTypeConfig<CalibratedAxes>): Record<string, string> {
  const values: Record<string, string> = {};
  for (const opt of config.options ?? []) {
    values[opt.key] = opt.kind === 'checkbox' ? String(opt.default) : opt.default;
  }
  return values;
}

/**
 * Can a calibration from `a` be adopted by `b` unchanged (checkpoint 87)?
 *
 * True when they build the same kind of axes from the same clicks: same
 * `axesKind` and the same ordered step keys. That is exactly XY <-> Histogram
 * (Histogram sets `steps: XY_AXES_CONFIG.steps`, so the arrays are literally
 * one object) and any future XY-backed graph type; it is false across
 * incompatible frames (Bar's two points cannot stand in for XY's four).
 *
 * Compares step KEYS, not the array identity, so a type that rebuilt an
 * identical step list rather than sharing the reference still counts — the
 * question is whether the placed handles mean the same thing, and they do iff
 * the keys line up.
 */
export function calibrationCompatible(
  a: AxesTypeConfig<CalibratedAxes>,
  b: AxesTypeConfig<CalibratedAxes>
): boolean {
  if (a.axesKind !== b.axesKind) return false;
  if (a.steps.length !== b.steps.length) return false;
  return a.steps.every((step, i) => step.key === b.steps[i]!.key);
}

/** Axes-metadata key recording which *graph type* built an axes instance.
 *
 * A graph type and an axes class are not the same thing: Histogram is XY
 * axes captured as bins (checkpoint 66), exactly as upstream WPD models it
 * (its "histogram" is BarExtractionAlgo run against XYAxes, relabelled in
 * the dropdown), and the already-flagged Box Plot promotion is the mirror
 * case — Bar axes captured as five-point tuples. So `id` below identifies
 * the graph type, while the underlying class is whatever buildAxes returns.
 *
 * That distinction has to survive a save/load round-trip, and it must do so
 * *without* touching WPD's schema: core/plotData.ts serializes the axes as
 * a class-name string ('XYAxes'/'BarAxes'/...), and inventing a
 * 'HistogramAxes' string would write a project file neither upstream nor
 * this repo's own old wpd-core app could read — breaking CLAUDE.md's
 * "preserve the JSON project file format exactly" constraint. Axes metadata
 * is the format's own extension point: plotData round-trips it verbatim
 * (serialize writes axData.metadata, deserialize calls setMetadata) and
 * upstream deep-clones keys it doesn't know, so a project saved here opens
 * in the old app as a plain XY chart with this key carried along untouched.
 */
export const GRAPH_TYPE_METADATA_KEY = 'graphType';

export interface AxesTypeConfig<A extends CalibratedAxes> {
  /** Identifies the *graph type* (the dropdown entry), not the axes class --
   * see GRAPH_TYPE_METADATA_KEY. */
  id: string;
  label: string;
  steps: readonly CalibStepInfo[];
  /** Dimensionality of the extracted data points (2 for XY/Polar, 1 for Bar). */
  dataDim: number;
  /** Human labels for each data dimension, length === dataDim -- the per-type
   * value-column headers in ui/'s data spreadsheet (checkpoint 57): XY/Map X,Y;
   * Bar value; Polar r,θ; Ternary A,B,C; CCR t,value. */
  valueLabels: readonly string[];
  /** Values collected once after the click-steps, not attached to any one of
   * them. Empty for every axes type except Circular Chart Recorder so far. */
  globalFields: readonly GlobalFieldInfo[];
  /** What one tuple of this graph type is *called* in the UI ("bin", "box").
   * Point groups arrived with Box Plot, so its vocabulary was hardcoded into
   * the shared tuple status line and tip -- which meant Histogram's bins
   * announced themselves as "new box" (caught driving the real app, checkpoint
   * 66). Undefined keeps the Box Plot default, since that's still the only
   * other tuple user. */
  tupleNoun?: string;
  /** True when this type's calibration walks x1 -> x2 -> y1 -> y2, so ui/ can
   * offer "Common origin" (confirming X2 auto-reuses X1's pixel for Y1, the
   * usual axes-cross-at-one-corner case -- checkpoint 50).
   *
   * A declared capability rather than a `config.id === 'xy'` check, because
   * that check is exactly the graph-type/axes-class conflation checkpoint 66
   * removes: Histogram calibrates identically to XY and wants this too, and
   * asking "is it XY?" would silently answer no. */
  supportsCommonOrigin?: boolean;
  /** Point groups every dataset under this graph type is created with, so
   * tuple capture is the type's *inherent* shape rather than something the
   * user must first discover and switch on. Histogram's bins are the first
   * user (['Bin start','Bin end']); Box Plot's Min/Q1/Median/Q3/Max stays an
   * opt-in button on Bar until its own promotion lands, which is precisely
   * the hidden-mode problem CLAUDE.md flags. Undefined = plain, ungrouped
   * points (every other type today). */
  defaultPointGroups?: readonly string[];
  /** Per-type calibration settings exposed to the user (checkpoint 68). WPD
   * has always offered these; we hardcoded them. Undefined = no settings. */
  options?: readonly AxesOption[];
  /** Which axes CLASS this graph type builds — as distinct from `id`, which
   * names the graph *type* (checkpoint 73).
   *
   * Lets ui/ ask a **capability** question ("is this XY underneath?") instead of
   * an **identity** one ("is this the xy config?"). Histogram and Error Bars are
   * real XYAxes with identical steps and a working dataToPixel, but six sites
   * tested `config.id === 'xy'` — so those charts silently lost Curve Fit, slope
   * measurement, auto-straighten and click-to-edit, and were told "Calibrate an
   * XY chart first" on a chart the user had just calibrated as XY. */
  axesKind: 'xy' | 'bar' | 'polar' | 'ternary' | 'map' | 'ccr';
  /** True when fitting a polynomial through this type's points is meaningful
   * (checkpoint 73). XY and Error Bars qualify — for the latter,
   * algorithms/curveFit.ts's getFitPoints already skips non-primary groups so a
   * fit runs through the Values, a branch written at checkpoint 27 that until
   * now could never execute. Histogram does NOT: its group 0 is "Bin start", so
   * a fit would run through bin corners, which means nothing. */
  supportsCurveFit?: boolean;
  /** Log scales this type offers, and which entered values may not be zero
   * (checkpoint 72). Required for any `options` entry that makes a scale
   * logarithmic — see LogScaleGuard on why this is declared, not hardcoded. */
  logScaleGuards?: readonly LogScaleGuard[];
  /** Groups of steps whose pixels must all differ (checkpoint 72). Filters the
   * reuse-pixel buttons AND refuses a degenerate calibration reached by drag. */
  distinctPixelSteps?: readonly (readonly string[])[];
  buildAxes(cal: Calibration, ctx: BuildAxesContext): BuildAxesResult<A>;
  /** Inverse of buildAxes's `options` handling — reads a loaded axes instance's
   * own state back into the option Record, so opening a project restores the
   * settings it was calibrated with rather than silently reverting to defaults.
   * The exact counterpart of extractGlobalValues; required for any config with
   * non-empty `options`. */
  extractOptions?(axes: A): Record<string, string>;
  /** Inverse of buildAxes's globalValues handling -- reads a loaded (e.g.
   * project-file-deserialized) axes instance's own state back into the
   * globalValues shape runCalibration expects, for configs with non-empty
   * globalFields (checkpoint 25's project load; see engine/projectFile.ts).
   * Undefined for every config with no globalFields, since there's nothing
   * to extract. */
  extractGlobalValues?(axes: A): Record<string, string>;
}

export const XY_AXES_CONFIG: AxesTypeConfig<XYAxes> = {
  id: 'xy',
  label: 'XY',
  axesKind: 'xy',
  supportsCurveFit: true,
  dataDim: 2,
  valueLabels: ['X', 'Y'],
  globalFields: [],
  supportsCommonOrigin: true,
  logScaleGuards: [
    { option: 'isLogX', points: [0, 1], field: 'dx', label: 'X' },
    { option: 'isLogY', points: [2, 3], field: 'dy', label: 'Y' },
  ],
  distinctPixelSteps: [['x1', 'x2'], ['y1', 'y2']],
  // WPD's own XY sidebar options (templates/_sidebars.html:258-297). Note the
  // rotation default: WPD's control is "Skip rotation correction" and ships
  // UNCHECKED, i.e. correction ON. We hardcoded the opposite for 68
  // checkpoints -- see CLAUDE.md's parity re-audit and the ckpt-64 correction.
  options: [
    { key: 'isLogX', label: 'Log X', kind: 'checkbox', default: false },
    { key: 'isLogY', label: 'Log Y', kind: 'checkbox', default: false },
    { key: 'skipRotation', label: 'Skip rotation', kind: 'checkbox', default: false },
  ],
  steps: [
    { key: 'x1', label: 'X1', color: '#e0a458', prompt: 'Click the pixel position of a known X value (e.g. X=0)', valueFields: [{ key: 'x1', label: 'X', field: 'dx' }] },
    { key: 'x2', label: 'X2', color: '#e0a458', prompt: 'Click a second pixel position of a known, different X value', valueFields: [{ key: 'x2', label: 'X', field: 'dx' }] },
    { key: 'y1', label: 'Y1', color: '#5fb4e0', prompt: 'Click the pixel position of a known Y value (e.g. Y=0)', valueFields: [{ key: 'y1', label: 'Y', field: 'dy' }] },
    { key: 'y2', label: 'Y2', color: '#5fb4e0', prompt: 'Click a second pixel position of a known, different Y value', valueFields: [{ key: 'y2', label: 'Y', field: 'dy' }] },
  ],
  buildAxes(cal, ctx) {
    const isLogX = optionBool(ctx.options, 'isLogX');
    const isLogY = optionBool(ctx.options, 'isLogY');
    // A log axis cannot pass through zero. WPD refuses to calibrate in this
    // case -- but its guard lives in the *controller*
    // (controllers/axesCalibration.js:79-86), not in XYAxes, so the faithful
    // core/axes/xy.ts port never carried it: processCalibration happily does
    // Math.log(0) -> -Infinity and still returns true. Without this check the
    // calibration reports success while every X (or Y) reads back null, and
    // getBounds() even looks plausible (Math.pow(10, -Infinity) === 0) -- the
    // silently-wrong-output failure this project cares most about. Checkpoint
    // 68 made log axes reachable, which made this live; checked here rather
    // than in core/ so the port stays faithful (see CLAUDE.md Step 1).
    const axes = new XYAxes();
    const ok = axes.calibrate(cal, isLogX, isLogY, optionBool(ctx.options, 'skipRotation'));
    if (!ok) return { error: 'Calibration failed — check the entered data values are valid numbers.' };
    return { axes };
  },
  extractOptions(axes) {
    return {
      isLogX: String(axes.isLogX()),
      isLogY: String(axes.isLogY()),
      skipRotation: String(axes.noRotation()),
    };
  },
};

/** Group names for a Histogram bin's two captured top corners. Order is the
 * click order the cursor walks, and the index order algorithms/histogram.ts's
 * binsFromCorners reads -- it orders each bin by x itself, so clicking the
 * right corner first still yields the same bin. */
export const HISTOGRAM_POINT_GROUPS = ['Bin start', 'Bin end'] as const;

/**
 * Histogram -- XY axes underneath, captured as bins (checkpoint 66).
 *
 * Calibration is identical to XY (a histogram's x axis is an ordinary
 * numeric axis; that's exactly what separates it from a bar chart, whose
 * BarAxes yields a typed label plus one magnitude and no numeric x at all).
 * What differs is the *capture*: each bin is a tuple of the bar's two top
 * corners, which carries both true edges and the height -- more than
 * upstream's histogram mode records, since that keeps only bar centres. See
 * algorithms/histogram.ts for the geometry and the reasoning.
 */
export const HISTOGRAM_AXES_CONFIG: AxesTypeConfig<XYAxes> = {
  id: 'histogram',
  label: 'Histogram',
  axesKind: 'xy',
  dataDim: 2,
  valueLabels: ['X', 'Y'],
  globalFields: [],
  supportsCommonOrigin: true,
  defaultPointGroups: HISTOGRAM_POINT_GROUPS,
  tupleNoun: 'bin',
  // Same axes, same steps, same options -> same guards. Sharing the arrays
  // rather than re-declaring keeps them from drifting apart.
  logScaleGuards: XY_AXES_CONFIG.logScaleGuards,
  distinctPixelSteps: XY_AXES_CONFIG.distinctPixelSteps,
  steps: XY_AXES_CONFIG.steps,
  options: XY_AXES_CONFIG.options,
  extractOptions: XY_AXES_CONFIG.extractOptions,
  buildAxes(cal, ctx) {
    const result = XY_AXES_CONFIG.buildAxes(cal, ctx);
    if ('error' in result) return result;
    result.axes.setMetadata({ ...result.axes.getMetadata(), [GRAPH_TYPE_METADATA_KEY]: 'histogram' });
    return result;
  },
};

/** Group names for an error bar's three captured points. Order is the click
 * order the cursor walks and the index order algorithms/errorBar.ts reads.
 * Value first: it is the datum, and the whiskers qualify it. */
export const ERROR_BAR_POINT_GROUPS = ['Value', 'Upper', 'Lower'] as const;

/**
 * Error Bars — XY axes underneath, captured as Value/Upper/Lower tuples
 * (checkpoint 70).
 *
 * **A restore, not a new feature.** The old `npm start` app has shipped this
 * since 2026-07-06 — an "Error Bars" entry in its axes-type dialog
 * (`ui-patches/overrides.js:663`), a one-click Value/Upper/Lower quick-setup
 * (`:762`), a direction-aware glyph (`:884`) and a structured export emitting
 * `errorBars:[{x,y,yUpper,yLower}]` (`ui-patches/api-bridge.js:169`). The
 * rebuild began 2026-07-08 and never carried any of it across, because it
 * never got a checkpoint number — while its sibling Box Plot, added a day
 * earlier by the same mechanism, did (checkpoints 21-23). Found only by the
 * third-pass parity audit, 2026-07-15. See CLAUDE.md, and
 * kn-development-principles/PAIRING-PRINCIPLES.md §A1.
 *
 * Structurally identical to HISTOGRAM_AXES_CONFIG: an XY-based graph type whose
 * capture shape is a tuple. That checkpoint 66 generalization is what makes
 * this mostly declaration — exactly the payoff it predicted.
 */
export const ERROR_BAR_AXES_CONFIG: AxesTypeConfig<XYAxes> = {
  id: 'errorbar',
  label: 'Error Bars',
  axesKind: 'xy',
  dataDim: 2,
  valueLabels: ['X', 'Y'],
  globalFields: [],
  supportsCommonOrigin: true,
  options: XY_AXES_CONFIG.options,
  extractOptions: XY_AXES_CONFIG.extractOptions,
  defaultPointGroups: ERROR_BAR_POINT_GROUPS,
  tupleNoun: 'error bar',
  // getFitPoints fits through group 0 ("Value") only — a trend line through the
  // data, ignoring the whiskers. The single most obvious thing to do with an
  // error-bar series, implemented at ckpt 27 and unreachable until now.
  supportsCurveFit: true,
  logScaleGuards: XY_AXES_CONFIG.logScaleGuards,
  distinctPixelSteps: XY_AXES_CONFIG.distinctPixelSteps,
  steps: XY_AXES_CONFIG.steps,
  buildAxes(cal, ctx) {
    const result = XY_AXES_CONFIG.buildAxes(cal, ctx);
    if ('error' in result) return result;
    result.axes.setMetadata({ ...result.axes.getMetadata(), [GRAPH_TYPE_METADATA_KEY]: 'errorbar' });
    return result;
  },
};

export const BAR_AXES_CONFIG: AxesTypeConfig<BarAxes> = {
  id: 'bar',
  label: 'Bar',
  axesKind: 'bar',
  dataDim: 1,
  valueLabels: ['value'],
  globalFields: [],
  logScaleGuards: [{ option: 'isLog', points: [0, 1], field: 'dy', label: 'value' }],
  distinctPixelSteps: [['p1', 'p2']],
  // WPD: templates/_sidebars.html bar-axes-scale / bar-axes-rotated.
  options: [
    { key: 'isLog', label: 'Log scale', kind: 'checkbox', default: false },
    { key: 'isRotated', label: 'Horizontal bars', kind: 'checkbox', default: false },
  ],
  steps: [
    { key: 'p1', label: 'P1', color: '#e0a458', prompt: 'Click the pixel position of a known bar value (e.g. 0)', valueFields: [{ key: 'p1', label: 'value', field: 'dy' }] },
    { key: 'p2', label: 'P2', color: '#5fb4e0', prompt: 'Click a second pixel position of a known, different bar value', valueFields: [{ key: 'p2', label: 'value', field: 'dy' }] },
  ],
  buildAxes(cal, ctx) {
    const axes = new BarAxes();
    const ok = axes.calibrate(cal, optionBool(ctx.options, 'isLog'), optionBool(ctx.options, 'isRotated'));
    if (!ok) return { error: 'Calibration failed — check the entered data values are valid numbers.' };
    return { axes };
  },
  extractOptions(axes) {
    return { isLog: String(axes.isLog()), isRotated: String(axes.isRotated()) };
  },
};

// "Line (categorical X)" — checkpoint 101. For a plot whose X axis is CATEGORICAL
// (species, treatments, sites…) with a numeric Y, e.g. Fig 12 of the snow-line
// paper this tool was validated on. "X is not numeric" (David): you cannot
// calibrate an X value where none was measured, so this reuses BarAxes -- whose
// calibration is TWO points on the VALUE axis only, no X clicks (tenet 10, reuse
// the categorical model bars already have). Points are captured like an XY
// series (dots), not bars; each point's Y is read from the value calibration and
// its X is its ORDINAL position (derived from left-to-right pixel order at
// export/display time, never stored -- tenet 9). A per-point NAME is deliberately
// left as reserved metadata (the same slot Bar's label uses), unwritten today so
// a future OCR pass (or a manual rename) can fill in the real category names with
// no migration -- the "window to the future" kept open on purpose (David).
export const CATEGORICAL_LINE_CONFIG: AxesTypeConfig<BarAxes> = {
  id: 'categorical',
  label: 'Line (categorical X)',
  axesKind: 'bar',
  dataDim: 1,
  valueLabels: ['Value'],
  globalFields: [],
  logScaleGuards: [{ option: 'isLog', points: [0, 1], field: 'dy', label: 'value' }],
  distinctPixelSteps: [['v1', 'v2']],
  options: [{ key: 'isLog', label: 'Log scale (value)', kind: 'checkbox', default: false }],
  steps: [
    { key: 'v1', label: 'V1', color: '#e0a458', prompt: 'Click a known value on the Y axis (e.g. Y=0)', valueFields: [{ key: 'v1', label: 'value', field: 'dy' }] },
    { key: 'v2', label: 'V2', color: '#5fb4e0', prompt: 'Click a second, different known value on the Y axis', valueFields: [{ key: 'v2', label: 'value', field: 'dy' }] },
  ],
  buildAxes(cal, ctx) {
    // isRotated is false: the value axis is vertical (Y), the category axis
    // horizontal -- the opposite orientation to a "horizontal bars" chart.
    const axes = new BarAxes();
    const ok = axes.calibrate(cal, optionBool(ctx.options, 'isLog'), false);
    if (!ok) return { error: 'Calibration failed — check the entered values are valid numbers.' };
    axes.setMetadata({ ...axes.getMetadata(), [GRAPH_TYPE_METADATA_KEY]: 'categorical' });
    return { axes };
  },
  extractOptions(axes) {
    return { isLog: String(axes.isLog()) };
  },
};

/** The five captured points of a box-and-whisker tuple, in click order (the
 * order getBoxPlotGlyphs reads, and the shape applyBoxPlotGroups creates). */
export const BOX_PLOT_POINT_GROUPS = ['Min', 'Q1', 'Median', 'Q3', 'Max'] as const;

// "Box Plot" as a first-class graph type (checkpoint 107). BarAxes underneath --
// a box plot is calibrated exactly like a bar chart (two points on the VALUE
// axis; the categories run along the other axis), which is why it was originally
// reached via a hidden "Box Plot Groups" toggle on Bar (checkpoints 21-23). That
// toggle failed CLAUDE.md's keystone test: a mode you can only reach by knowing
// it exists is invisible to someone seeing the tool for the first time. Making it
// a dropdown entry is *correctness*, not polish -- the same promotion Histogram
// got at checkpoint 66, whose graph-type != axes-class generalization
// (`defaultPointGroups`/`tupleNoun`) is exactly what makes this a config object
// rather than a code path. Datasets are auto-created with the Min/Q1/Median/Q3/Max
// point groups, so tuple capture is the type's inherent shape, not something the
// user must first discover and switch on.
export const BOX_PLOT_AXES_CONFIG: AxesTypeConfig<BarAxes> = {
  id: 'boxplot',
  label: 'Box Plot',
  axesKind: 'bar',
  dataDim: 1,
  valueLabels: ['value'],
  globalFields: [],
  defaultPointGroups: BOX_PLOT_POINT_GROUPS,
  tupleNoun: 'box',
  // Shares Bar's calibration, options (log scale + horizontal bars) and guards --
  // reusing the arrays keeps them from drifting apart, as Histogram does with XY.
  logScaleGuards: BAR_AXES_CONFIG.logScaleGuards,
  distinctPixelSteps: BAR_AXES_CONFIG.distinctPixelSteps,
  steps: BAR_AXES_CONFIG.steps,
  options: BAR_AXES_CONFIG.options,
  extractOptions: BAR_AXES_CONFIG.extractOptions,
  buildAxes(cal, ctx) {
    const axes = new BarAxes();
    const ok = axes.calibrate(cal, optionBool(ctx.options, 'isLog'), optionBool(ctx.options, 'isRotated'));
    if (!ok) return { error: 'Calibration failed — check the entered data values are valid numbers.' };
    axes.setMetadata({ ...axes.getMetadata(), [GRAPH_TYPE_METADATA_KEY]: 'boxplot' });
    return { axes };
  },
};

export const POLAR_AXES_CONFIG: AxesTypeConfig<PolarAxes> = {
  id: 'polar',
  label: 'Polar',
  axesKind: 'polar',
  dataDim: 2,
  valueLabels: ['r', 'θ'],
  globalFields: [],
  logScaleGuards: [{ option: 'isLogR', points: [1, 2], field: 'dx', label: 'radial' }],
  // All three must be distinct: P1 on the origin means r1 = 0 at r = 0.
  distinctPixelSteps: [['origin', 'p1', 'p2']],
  // WPD: polar-axes-angular-units / -orientation / -scale.
  options: [
    { key: 'isDegrees', label: 'Angle', kind: 'choice', default: 'true',
      choices: [{ value: 'true', label: 'Degrees' }, { value: 'false', label: 'Radians' }] },
    { key: 'isClockwise', label: 'Direction', kind: 'choice', default: 'false',
      choices: [{ value: 'false', label: 'Anticlockwise' }, { value: 'true', label: 'Clockwise' }] },
    { key: 'isLogR', label: 'Log radial', kind: 'checkbox', default: false },
  ],
  steps: [
    { key: 'origin', label: 'Origin', color: '#5fb47a', prompt: 'Click the pixel position of the polar origin (r=0)', valueFields: [] },
    {
      key: 'p1',
      label: 'P1',
      color: '#e0a458',
      prompt: 'Click a point with known r and θ values',
      valueFields: [
        { key: 'r1', label: 'r', field: 'dx' },
        { key: 'theta1', label: 'θ', field: 'dy' },
      ],
    },
    {
      key: 'p2',
      label: 'P2',
      color: '#5fb4e0',
      prompt: 'Click a second point with a known r value, at the same θ as P1',
      valueFields: [
        { key: 'r2', label: 'r', field: 'dx' },
        // Collected to match WPD's own calibration form, but never read by
        // core/axes/polar.ts's calibration math (see its `_theta2r` comment) --
        // so it's OPTIONAL: leaving it blank must not block Confirm (a field
        // labelled unused that you're nonetheless forced to fill is a trap).
        { key: 'theta2', label: 'θ (optional)', field: 'dy', optional: true },
      ],
    },
  ],
  buildAxes(cal, ctx) {
    const axes = new PolarAxes();
    const ok = axes.calibrate(
      cal,
      optionBool(ctx.options, 'isDegrees'),
      optionBool(ctx.options, 'isClockwise'),
      optionBool(ctx.options, 'isLogR')
    );
    if (!ok) return { error: 'Calibration failed — check the entered data values are valid numbers.' };
    return { axes };
  },
  extractOptions(axes) {
    return {
      isDegrees: String(axes.isThetaDegrees()),
      isClockwise: String(axes.isThetaClockwise()),
      isLogR: String(axes.isRadialLog()),
    };
  },
};

export const TERNARY_AXES_CONFIG: AxesTypeConfig<TernaryAxes> = {
  id: 'ternary',
  label: 'Ternary',
  axesKind: 'ternary',
  distinctPixelSteps: [['a', 'b', 'c']],
  // WPD: ternary-axes-scale / ternary-axes-normal.
  options: [
    { key: 'isRange100', label: 'Range', kind: 'choice', default: 'true',
      choices: [{ value: 'true', label: '0 to 100' }, { value: 'false', label: '0 to 1' }] },
    { key: 'isNormal', label: 'Orientation', kind: 'choice', default: 'true',
      choices: [{ value: 'true', label: 'Normal' }, { value: 'false', label: 'Reverse' }] },
  ],
  dataDim: 3,
  valueLabels: ['A', 'B', 'C'],
  globalFields: [],
  steps: [
    { key: 'a', label: 'A', color: '#e0a458', prompt: 'Click corner A of the ternary diagram', valueFields: [] },
    { key: 'b', label: 'B', color: '#5fb4e0', prompt: 'Click corner B of the ternary diagram', valueFields: [] },
    // Collected to match WPD's own 3-corner-click UI, but never read by
    // core/axes/ternary.ts's calibration math -- see this file's header
    // comment for why C is geometrically redundant here.
    { key: 'c', label: 'C', color: '#7fcf7f', prompt: 'Click corner C of the ternary diagram', valueFields: [] },
  ],
  buildAxes(cal, ctx) {
    const axes = new TernaryAxes();
    const ok = axes.calibrate(cal, optionBool(ctx.options, 'isRange100'), optionBool(ctx.options, 'isNormal'));
    if (!ok) return { error: 'Calibration failed — check the entered data values are valid numbers.' };
    return { axes };
  },
  extractOptions(axes) {
    // NOTE: isNormalOrientation is a *function reference* on TernaryAxes, not
    // a getter -- core/plotData.ts documents the same upstream quirk it
    // faithfully preserves when serializing. Call it.
    return { isRange100: String(axes.isRange100()), isNormal: String(axes.isNormalOrientation()) };
  },
};

export const MAP_AXES_CONFIG: AxesTypeConfig<MapAxes> = {
  id: 'map',
  label: 'Map',
  axesKind: 'map',
  distinctPixelSteps: [['p1', 'p2']],
  // WPD: map-axes-units / map-axes-origin. NOTE the origin default --
  // WPD's <select> lists "Bottom Left" FIRST, so that is its default
  // (templates/_sidebars.html:352-355); we hardcoded 'top-left', a silent
  // divergence found during the 2026-07-15 parity re-audit. Matching WPD is
  // safe for existing projects: originLocation is serialized explicitly
  // (core/plotData.ts:589) and read back on load, so only *new* calibrations
  // see the corrected default. The bottom-left branch is why buildAxes needs
  // ctx.imageHeight (core/axes/map.ts:65 flips y through it).
  options: [
    { key: 'origin', label: 'Origin', kind: 'choice', default: 'bottom-left',
      choices: [{ value: 'bottom-left', label: 'Bottom left' }, { value: 'top-left', label: 'Top left' }] },
    { key: 'units', label: 'Units', kind: 'text', default: '', placeholder: 'e.g. km' },
  ],
  dataDim: 2,
  valueLabels: ['X', 'Y'],
  globalFields: [],
  steps: [
    { key: 'p1', label: 'P1', color: '#e0a458', prompt: 'Click one end of a reference line of known real-world length', valueFields: [] },
    {
      key: 'p2',
      label: 'P2',
      color: '#5fb4e0',
      prompt: 'Click the other end of the reference line',
      valueFields: [{ key: 'scaleLength', label: 'length', field: 'dx' }],
    },
  ],
  buildAxes(cal, ctx) {
    const axes = new MapAxes();
    // scale_length isn't read from the Calibration point by MapAxes's own
    // processCalibration -- see this file's header comment -- so it's
    // pulled back out of the P2 step's dx slot here instead.
    const scaleLength = cal.getPoint(1)!.dx ?? '0';
    const ok = axes.calibrate(
      cal,
      scaleLength,
      ctx.options['units'] ?? '',
      (ctx.options['origin'] ?? 'bottom-left') as 'top-left' | 'bottom-left',
      ctx.imageHeight
    );
    if (!ok) return { error: 'Calibration failed — check the entered data values are valid numbers.' };
    return { axes };
  },
  extractOptions(axes) {
    return { units: axes.getUnits() ?? '', origin: axes.getOriginLocation() ?? 'bottom-left' };
  },
};

export const CIRCULAR_CHART_RECORDER_AXES_CONFIG: AxesTypeConfig<CircularChartRecorderAxes> = {
  id: 'ccr',
  label: 'Circular Chart Recorder',
  axesKind: 'ccr',
  dataDim: 2,
  valueLabels: ['t', 'value'],
  // Chart Start Time isn't attached to any of the 5 clicks below -- WPD's
  // own sidebar shows it as a standalone field, entered once after all 5
  // points are placed. See this file's header comment for the full shape.
  globalFields: [{ key: 'startTime', label: 'Chart Start Time' }],
  distinctPixelSteps: [['t0r0', 't0r1', 't0r2', 't1r2', 't2r2']],
  // WPD: ccr-rotation-time / ccr-direction. NOTE the period default --
  // WPD's <select> lists "1 Week (7 days)" FIRST (templates/_sidebars.html:487)
  // and its own deserializer falls back to 'week' (core/plotData.js:384), so
  // 'week' is WPD's default on both paths. We hardcoded 'day' while the code
  // comment claimed it "matches WPD's own sidebar defaults" -- it did not.
  // Same silent-divergence class as MapAxes's origin; corrected here.
  options: [
    { key: 'rotationTime', label: 'Rotation', kind: 'choice', default: 'week',
      choices: [{ value: 'week', label: '1 week (7 days)' }, { value: 'day', label: '1 day (24 hours)' }] },
    { key: 'rotationDirection', label: 'Direction', kind: 'choice', default: 'anticlockwise',
      choices: [{ value: 'anticlockwise', label: 'Anticlockwise' }, { value: 'clockwise', label: 'Clockwise' }] },
  ],
  steps: [
    {
      key: 't0r0',
      label: '(T0,R0)',
      color: '#e0a458',
      prompt: 'Click a point on the pen’s time axis at a known, low radial value',
      valueFields: [
        { key: 't0', label: 'Time (T0)', field: 'dx' },
        { key: 'r0', label: 'Value (R0)', field: 'dy' },
      ],
    },
    {
      key: 't0r1',
      label: '(T0,R1)',
      color: '#e0a458',
      // Click-only: fits the pen circle (getCircleFrom3Pts) alongside
      // (T0,R0) and (T0,R2), same shape as Ternary's corner C.
      prompt: 'Click a second point on the same time axis, at a different radial value',
      valueFields: [],
    },
    {
      key: 't0r2',
      label: '(T0,R2)',
      color: '#e0a458',
      prompt: 'Click a third point on the same time axis, at a known, high radial value',
      valueFields: [{ key: 'r2', label: 'Value (R2)', field: 'dy' }],
    },
    {
      key: 't1r2',
      label: '(T1,R2)',
      color: '#5fb4e0',
      // Click-only: fits the chart circle alongside (T0,R2) and (T2,R2).
      prompt: 'Click a point at the same radial value as (T0,R2), at a different time',
      valueFields: [],
    },
    {
      key: 't2r2',
      label: '(T2,R2)',
      color: '#5fb4e0',
      prompt: 'Click a third point at that same radial value, as far from the others as possible',
      valueFields: [],
    },
  ],
  buildAxes(cal, ctx) {
    const axes = new CircularChartRecorderAxes();
    const startTime = ctx.globalValues['startTime'] ?? '';
    const ok = axes.calibrate(
      cal,
      startTime,
      (ctx.options['rotationTime'] ?? 'week') as RotationTime,
      (ctx.options['rotationDirection'] ?? 'anticlockwise') as RotationDirection
    );
    if (!ok) return { error: 'Calibration failed — check the entered data values are valid.' };
    return { axes };
  },
  extractOptions(axes) {
    return {
      rotationTime: axes.getRotationTime() ?? 'week',
      rotationDirection: axes.getRotationDirection() ?? 'anticlockwise',
    };
  },
  extractGlobalValues(axes) {
    return { startTime: axes.getStartTime() ?? '' };
  },
};

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
 * plotData doesn't model (mid-calibration progress, per-series point-group
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
  /** Per-dataset point-group cursor, indexed to match plotData's dataset order. */
  cursors: PointGroupCursor[];
  plotData: SerializedPlotData;
}

export interface DataPointView {
  px: number;
  py: number;
  data: number[] | null;
}

/** Where the next Place Point click will file its pixel: `tupleIndex: null` means
 * "starts a new tuple at group 0" (mirrors pointGroups.js's own null-as-sentinel). */
export interface PointGroupCursor {
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
}

/** 'point-placed': a value-less step (e.g. Polar's origin) was placed and the
 * walk advanced immediately, with no value prompt shown. */
export type CalibrationClickResult = 'awaiting-value' | 'point-placed' | 'ignored';
export type DataPointClickResult = 'point-added' | 'ignored';

/** One dataset/series plus its own independent point-groups cursor (Box Plot
 * state is inherently per-series, checkpoint 30) -- see this file's header
 * comment. */
interface DatasetEntry {
  dataset: Dataset;
  pointGroupCursor: PointGroupCursor;
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

  constructor(private readonly config: AxesTypeConfig<A>) {
    this.datasetEntries = [this.buildDatasetEntry('Series 1', 0)];
    this.optionValues = defaultOptionValues(config as unknown as AxesTypeConfig<CalibratedAxes>);
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
    if (this.config.defaultPointGroups) dataset.setPointGroups([...this.config.defaultPointGroups]);
    return { dataset, pointGroupCursor: { tupleIndex: null, groupIndex: 0 } };
  }

  /** The active dataset/series' own entry -- every method below that used to
   * read/write a single `this.dataset`/`this.pointGroupCursor` now goes
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
    this.stepIndex = this.config.steps.length;
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
    return this.config.steps[this.stepIndex] ?? null;
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
      this.activeDatasetIndex = opts.targetIndex;
      return placed;
    }

    const mirror = this.addCapTo(base, oppositeRole(role), targetName, mirrorCap(opts.datumPixel, cap));
    // The error caps live in their OWN related series (SD upper / SD lower), which
    // addDataset just made active as a side effect. But the user is working on the
    // TARGET data series -- adding error to a point must never steal "active" from
    // it, or the next Place-Point click silently lands on an error-cap series with
    // nothing on screen saying so (a real trap; the point you added a cap to and
    // the target are always the same series). Restore it.
    this.activeDatasetIndex = opts.targetIndex;
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
  getCalibrationPreview(): CalibrationPreview {
    return calibrationPreview(
      this.config as unknown as { axesKind: 'xy' | 'bar' | 'polar' | 'ternary' | 'map' | 'ccr'; steps: { key: string; color: string }[] },
      this.placed
    );
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

    // The cap's own datum, found the same way resolveErrorBars finds it, so the
    // drag locks to the line the resolution will actually use.
    const datum = nearestPixel(targetEntry.dataset.getAllPixels(), cap, Infinity);
    if (!datum) return null;
    const direction = capFreeDirection(this.axes, datum.point, relation.role);
    if (!direction) return null;
    return { origin: datum.point, direction };
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
    // BarAxes' ['Label','Y'] we emit a derived ordinal Position plus the Value.
    if (this.config.id === 'categorical') return ['Position', 'Value'];
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
   * Bar, the leading `Label` (the category lives in metadata, not a value
   * column). WPD's own contract always puts that Label first
   * (`dataProviders.js` -> `['Label','Value']`), so the value dimensions are the
   * trailing `dataDim` entries: Bar `['Label','Y']` -> `['Y']`, and every other
   * type's labels already equal its `dataDim`, so the slice is a no-op there.
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

  /** One export row per point of a dataset, values per WPD's own contract
   * (core/exportValues.ts): Bar carries its Label, CCR's time is formatted
   * rather than emitted as a julian float, and a date-calibrated XY column is
   * formatted. Pixels ride along for the flat export, which reports them.
   *
   * Deliberately separate from getAllDatasetsData's `data`, which stays a raw
   * pixelToData projection -- that feeds the canvas and the table, which want
   * numbers, not a formatted date string or a label in slot 0. The contract is
   * about what leaves the app, not what it draws with. */
  getExportRows(datasetIndex: number, mode: PrecisionMode = 'auto'): { px: number; py: number; values: ExportValue[] }[] {
    const entry = this.datasetEntries[datasetIndex];
    if (!entry || !this.axes) return [];
    const axes = this.axes;
    const pixels = entry.dataset.getAllPixels();
    // Categorical line (checkpoint 101): X is the point's ORDINAL position,
    // DERIVED from left-to-right pixel order at export time -- never stored, so
    // it is a view of the recorded pixels, not a fabricated coordinate (tenet 9).
    // Value comes from the BarAxes value calibration.
    if (this.config.id === 'categorical') {
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
        return { px: p.x, py: p.y, values: [rank[i]!, value] as ExportValue[] };
      });
    }
    return pixels.map((p, i) => ({
      px: p.x,
      py: p.y,
      values: valueAtPixel(i, axes, p, mode),
    }));
  }

  /** Switches which dataset new points/point-groups actions apply to.
   * No-op for an out-of-range index. */
  setActiveDataset(index: number): void {
    if (index < 0 || index >= this.datasetEntries.length) return;
    this.activeDatasetIndex = index;
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
    this.activeDatasetIndex = this.datasetEntries.length - 1;
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
    this.datasetEntries.splice(index, 1);
    // Nothing may keep pointing at a series that is gone (engine/errorRelation.ts).
    clearErrorRelationsTo(this.getDatasets(), removedName);
    if (this.activeDatasetIndex >= this.datasetEntries.length) {
      this.activeDatasetIndex = this.datasetEntries.length - 1;
    } else if (this.activeDatasetIndex > index) {
      this.activeDatasetIndex -= 1;
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
  loadCalibrated(axes: A, datasets: Dataset[]): void {
    this.placed = {};
    const cal = (axes as unknown as { calibration: Calibration | null }).calibration;
    if (cal) {
      this.config.steps.forEach((step, i) => {
        const cp = cal.getPoint(i);
        if (!cp) return;
        const values = step.valueFields.map((vf) => String(vf.field === 'dx' ? cp.dx : cp.dy));
        this.placed[step.key] = { px: cp.px, py: cp.py, values };
      });
    }
    this.stepIndex = this.config.steps.length;
    this.pendingPixel = null;
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
      ? checkGuards(this.config as unknown as AxesTypeConfig<CalibratedAxes>, cal, this.optionValues)
      : null;
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
        pointGroupCursor: this.computePointGroupCursorFor(dataset),
      };
    });
    this.activeDatasetIndex = 0;
  }

  /** Finds the first open point-group slot across a dataset's tuples (same
   * target nextGroupCursor would walk to), or "new tuple" if none -- used
   * by loadCalibrated for every loaded dataset, since the cursor isn't part
   * of the serialized project file (see engine/projectFile.ts). Takes an
   * explicit dataset (generalized in checkpoint 30 from a no-arg version
   * that only ever recomputed "the" dataset's cursor) so it can run once per
   * loaded dataset. */
  private computePointGroupCursorFor(dataset: Dataset): PointGroupCursor {
    if (!dataset.hasPointGroups()) {
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
   * the pixel through yet. When the active dataset has point groups
   * configured (Box Plot etc.), the new pixel is also filed into a tuple at
   * that dataset's own cursor position, which then advances -- see
   * nextGroupCursor and this file's header comment. Starting a new tuple
   * auto-labels it (see autoLabelTuple), matching real WPD's own
   * ManualSelectionTool.onMouseClick behavior for Bar axes datasets. */
  addDataPoint(px: number, py: number): DataPointClickResult {
    if (!this.axes) return 'ignored';
    const entry = this.activeEntry;
    const index = entry.dataset.addPixel(px, py);
    if (entry.dataset.hasPointGroups()) {
      const { tupleIndex, groupIndex } = entry.pointGroupCursor;
      if (tupleIndex === null) {
        const newTupleIndex = entry.dataset.addTuple(index);
        entry.pointGroupCursor.tupleIndex = newTupleIndex;
        if (newTupleIndex !== null) this.autoLabelTuple(newTupleIndex);
      } else {
        entry.dataset.addToTupleAt(tupleIndex, groupIndex, index);
      }
      this.nextGroupCursor();
    }
    return 'point-added';
  }

  /** Bulk-adds pixels produced by a Segment Fill trace (checkpoint 26, see
   * CLAUDE.md and engine/segmentFillRun.ts) to the active dataset --
   * addDataPoint above handles one click at a time; a trace can add
   * hundreds in one go. Ignored until calibrated, same as addDataPoint.
   * Deliberately not point-groups-aware, unlike addDataPoint -- a
   * continuous curve trace has no natural Min/Q1/Median/Q3/Max slot to file
   * into, and the current app's own Segment Fill tool
   * (ui-patches/engauge-algos.js) never interacts with point groups either.
   * Returns the number of points actually added (0 if not calibrated or the
   * active dataset has point groups configured). */
  addSegmentFillPoints(points: readonly { x: number; y: number }[]): number {
    if (!this.axes) return 0;
    const entry = this.activeEntry;
    if (entry.dataset.hasPointGroups()) return 0;
    for (const p of points) entry.dataset.addPixel(p.x, p.y);
    return points.length;
  }

  /** Interpolation-assist (checkpoint 120, David's LIVE mode): the human drops a
   * handful of GUIDE POINTS along one curve and the tool fills the curve between
   * them (algorithms/interpolate.ts, a centripetal Catmull-Rom spline). This is
   * the v0.6 answer for MONOCHROME dash-differentiated technical figures, where
   * colour-filtering can't separate same-colour dashed lines and connectivity
   * (Segment Fill) can't follow a broken line -- see CLAUDE.md.
   *
   * ⚑ Tenet 9, the whole point: an anchor is the RECORD (a human measured it off
   * the figure), the samples between are DERIVED. We mark each pixel's role in its
   * own per-pixel metadata (core/dataset.ts) -- role:'anchor' vs role:'interpolated'
   * -- so a downstream consumer can tell measured from invented, and drop the
   * derived ones. StarryDigitizer does the opposite: it deletes the anchors and
   * keeps only the spline, so its 194k-curve database can't (its own author flags
   * this as needing a redesign).
   *
   * Adds one anchor and rebuilds the derived curve live. Ignored until calibrated
   * (like addDataPoint -- no axes to convert the pixel through yet) or if the
   * active dataset has point groups (a continuous curve has no Min/Q1/... slot,
   * same reason Segment Fill declines). */
  addAnchorPoint(px: number, py: number): DataPointClickResult {
    if (!this.axes) return 'ignored';
    const entry = this.activeEntry;
    if (entry.dataset.hasPointGroups()) return 'ignored';
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
  getDataPointRoles(): ('anchor' | 'interpolated' | null)[] {
    return this.activeEntry.dataset.getAllPixels().map((p) => {
      const r = p.metadata?.['role'];
      return r === 'anchor' || r === 'interpolated' ? r : null;
    });
  }

  /** Assigns a default category label to a newly started tuple, e.g. "Bar0" --
   * a direct port of real WPD's own default (axes.dataPointsLabelPrefix +
   * tuple index, wpd-core/javascript/tools/manualDetectionTools.js), stored the
   * same way WPD stores it: as `metadata.label` on the tuple's first (primary
   * group) pixel. Meant to be renamed via setTupleLabel, not kept as-is --
   * WPD's own real UI (wpd.dataPointLabelEditor, shift-click to rename) is
   * "optional" per this feature's own commit history; this rebuild exposes an
   * always-editable inline input instead (Workspace.tsx's tuple table) rather
   * than a shift-click popup, per this rebuild's own "no floating popups"
   * design direction. */
  private autoLabelTuple(tupleIndex: number): void {
    const prefix = (this.axes as unknown as { dataPointsLabelPrefix?: string })?.dataPointsLabelPrefix ?? 'Category';
    this.setTupleLabel(tupleIndex, `${prefix}${tupleIndex}`);
  }

  /** The category label for a tuple (Box Plot's per-box name) in the active
   * dataset, stored as `metadata.label` on the tuple's first (primary
   * group) pixel. Empty string if the tuple doesn't exist, has no
   * primary-group point yet, or has never been labeled. */
  getTupleLabel(tupleIndex: number): string {
    const dataset = this.activeEntry.dataset;
    const primaryIndex = dataset.getAllTuples()[tupleIndex]?.[0];
    if (primaryIndex === null || primaryIndex === undefined) return '';
    const label = dataset.getPixel(primaryIndex).metadata?.['label'];
    return typeof label === 'string' ? label : '';
  }

  /** Sets a tuple's category label in the active dataset, registering the
   * dataset's "label" metadata key if this is the first one -- mirrors
   * wpd.dataPointLabelEditor.ok(). */
  setTupleLabel(tupleIndex: number, label: string): void {
    const dataset = this.activeEntry.dataset;
    const primaryIndex = dataset.getAllTuples()[tupleIndex]?.[0];
    if (primaryIndex === null || primaryIndex === undefined) return;
    const existing = dataset.getPixel(primaryIndex).metadata ?? {};
    dataset.setMetadataAt(primaryIndex, { ...existing, label });
    const keys = dataset.getMetadataKeys();
    if (!keys.includes('label')) dataset.setMetadataKeys([...keys, 'label']);
  }

  /** The active dataset's registered per-pixel metadata keys (e.g. "label"
   * once any tuple has been labeled) -- core/dataset.ts's
   * setMetadataKeys/getMetadataKeys. */
  getMetadataKeys(): string[] {
    return this.activeEntry.dataset.getMetadataKeys();
  }

  /** Whether the active dataset has named point groups configured (Box Plot etc.). */
  hasPointGroups(): boolean {
    return this.activeEntry.dataset.hasPointGroups();
  }

  getPointGroups(): string[] {
    return this.activeEntry.dataset.getPointGroups();
  }

  /** Configure named point groups for tuple-based data entry on the active
   * dataset (WPD's Point Groups feature, wpd-core's
   * javascript/widgets/pointGroups.js). Declines (returns false, no
   * mutation) if the active dataset already has groups configured --
   * safely diffing an in-use tuple structure is the current app's separate
   * "Edit Point Groups" popup, not this convenience. */
  setPointGroups(names: string[]): boolean {
    const entry = this.activeEntry;
    if (entry.dataset.hasPointGroups()) return false;
    entry.dataset.setPointGroups(names);
    entry.pointGroupCursor = { tupleIndex: null, groupIndex: 0 };
    return true;
  }

  /** Quick-setup for the common Box Plot shape, mirroring the current app's
   * "Box Plot Groups" button (commit 011ef1c). */
  applyBoxPlotGroups(): boolean {
    return this.setPointGroups([...BOX_PLOT_POINT_GROUPS]);
  }

  getCurrentGroupIndex(): number {
    return this.activeEntry.pointGroupCursor.groupIndex;
  }

  getCurrentTupleIndex(): number | null {
    return this.activeEntry.pointGroupCursor.tupleIndex;
  }

  /** Label for the group the next Place Point click will fill -- mirrors
   * wpd.pointGroups.refreshControls()'s fallback naming for an unnamed group. */
  getCurrentGroupLabel(): string {
    const entry = this.activeEntry;
    const name = entry.dataset.getPointGroups()[entry.pointGroupCursor.groupIndex];
    if (name) return name;
    return entry.pointGroupCursor.groupIndex === 0 ? 'Primary group' : `Group ${entry.pointGroupCursor.groupIndex}`;
  }

  /** Advance the active dataset's cursor to the next open group slot: the
   * current tuple past the current group, then later tuples' first open
   * slot, else "new tuple" (tupleIndex null, groupIndex 0). Direct port of
   * pointGroups.js's nextGroup(). */
  nextGroupCursor(): void {
    const cursor = this.activeEntry.pointGroupCursor;
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
   * nextGroupCursor's mirror image, direct port of pointGroups.js's
   * previousGroup(). Used for manual navigation and to keep the cursor sane
   * after removeLastPoint. */
  previousGroupCursor(): void {
    const cursor = this.activeEntry.pointGroupCursor;
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

  /** One row per tuple (category) in the active dataset, in group order --
   * the shape a Box Plot table needs instead of dataDim's flat per-point
   * list. */
  getTupleRows(): TupleRow[] {
    const dataset = this.activeEntry.dataset;
    return dataset.getAllTuples().map((tuple, tupleIndex) => ({
      tupleIndex,
      label: this.getTupleLabel(tupleIndex),
      points: tuple.map((pixelIndex) => {
        if (pixelIndex === null) return null;
        const p = dataset.getPixel(pixelIndex);
        return { px: p.x, py: p.y, data: this.axes ? this.axes.pixelToData(p.x, p.y) : null };
      }),
    }));
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

  /** The active series' error bars, one entry per captured tuple in capture
   * order, `null` where nothing is placed yet. A thin adapter over the pure
   * geometry (leg (c)); returns [] for any other graph type or before
   * calibration, mirroring getHistogramBins/getBoxPlotGlyphs. */
  getErrorBars(): (ErrorBarPoint | null)[] {
    if (this.config.id !== 'errorbar' || !this.axes) return [];
    return errorBarsFromCorners(
      this.getTupleRows().map((row) =>
        row.points.map((p) => (p?.data ? { x: p.data[0]!, y: p.data[1]! } : null))
      )
    );
  }

  /** Error-bar glyph segments (image-pixel space) for every tuple with BOTH
   * whiskers placed. The Value point needs no glyph -- it renders as an
   * ordinary data dot -- so a bar with only a centre draws nothing, same rule
   * getBoxPlotGlyphs uses for an incomplete tuple. */
  getErrorBarGlyphs(): GlyphSegment[][] {
    if (this.config.id !== 'errorbar') return [];
    const glyphs: GlyphSegment[][] = [];
    for (const row of this.getTupleRows()) {
      const upper = row.points[1];
      const lower = row.points[2];
      if (!upper || !lower) continue;
      glyphs.push(computeErrorBarGlyph({ x: upper.px, y: upper.py }, { x: lower.px, y: lower.py }));
    }
    return glyphs;
  }

  /** Box-and-whisker glyph segments (image-pixel space) for every *complete*
   * tuple of the active dataset -- empty unless calibrated, Bar axes, and
   * that dataset's point groups are exactly Min/Q1/Median/Q3/Max
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
    const groups = dataset.getPointGroups().map((g) => g.trim().toLowerCase());
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
    // Never offer the *same axis's* other end: reusing X1's pixel for X2 (or
    // Y1's for Y2) puts both calibration points on one pixel, which makes the
    // transform matrix singular -- and XYAxes still returns true, so every
    // value reads back null with no error shown. Legitimate reuse is across
    // axes (X1 <-> Y1, the shared-origin case checkpoint 50's "Common origin"
    // automates). WPD has no reuse buttons at all, so checkpoint 49 made a
    // degenerate calibration *easier to reach than upstream*; this filter is
    // what keeps that convenience honest.
    return this.config.steps.filter(
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
    // the calibration never reads) may be blank and defaults to "0".
    if (step.valueFields.some((f, i) => !f.optional && trimmed[i] === '')) return false;
    const filled = trimmed.map((v, i) => (v === '' && step.valueFields[i]!.optional ? '0' : v));
    this.placed[step.key] = { px: this.pendingPixel.px, py: this.pendingPixel.py, values: filled };
    this.pendingPixel = null;
    this.stepIndex += 1;
    return true;
  }

  /** Build the Calibration + axes instance from the placed calibration points
   * and any global field values. */
  runCalibration(): boolean {
    const points: PlacedCalibPoint[] = [];
    for (const step of this.config.steps) {
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

    const cal = new Calibration(2);
    this.config.steps.forEach((step, i) => {
      const point = points[i]!;
      let dx = '0';
      let dy = '0';
      step.valueFields.forEach((vf, fi) => {
        if (vf.field === 'dx') dx = point.values[fi]!;
        else dy = point.values[fi]!;
      });
      cal.addPoint(point.px, point.py, dx, dy);
    });

    // Refusals run BEFORE the axes class sees anything: every axes class
    // reports success on degenerate input, so a guard placed after calibrate()
    // is a guard that never fires (checkpoint 72).
    const guardError = checkGuards(this.config as unknown as AxesTypeConfig<CalibratedAxes>, cal, this.optionValues);
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
    return true;
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
   * When point groups are configured, also cleans up its tuple slot
   * (dropping the tuple entirely if it's now empty) and walks the cursor
   * back -- mirrors DeleteDataPointTool's single-point removal path in
   * manualDetectionTools.js (not its whole-tuple-deletion popup, which this
   * checkpoint doesn't add). */
  removeLastPoint(): void {
    const dataset = this.activeEntry.dataset;
    const count = dataset.getCount();
    if (count === 0) return;
    const index = count - 1;
    const wasAnchor = dataset.getPixel(index)?.metadata?.['role'] === 'anchor';
    if (dataset.hasPointGroups()) {
      const tupleIndex = dataset.getTupleIndex(index);
      dataset.removePixelAtIndex(index);
      dataset.refreshTuplesAfterPixelRemoval(index);
      if (tupleIndex > -1 && dataset.isTupleEmpty(tupleIndex)) {
        dataset.removeTuple(tupleIndex);
      }
      this.previousGroupCursor();
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
    if (dataset.hasPointGroups()) {
      const tupleIndex = dataset.getTupleIndex(index);
      dataset.removePixelAtIndex(index);
      dataset.refreshTuplesAfterPixelRemoval(index);
      if (tupleIndex > -1 && dataset.isTupleEmpty(tupleIndex)) {
        dataset.removeTuple(tupleIndex);
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
    const descending = [...new Set(indices)].sort((a, b) => b - a);
    for (const i of descending) this.removeDataPointAt(i);
  }

  /** Delete an ENTIRE tuple -- a Box Plot box / a Histogram bin, i.e. one whole
   * row of the category table -- from the active dataset in one action
   * (checkpoint 129, v0.7 "tuple delete"). Every point filed under that
   * category goes, along with the tuple slot and its label. The trash button
   * peels points one at a time, and a mis-placed box is a whole tuple; this is
   * the missing bulk gesture for grouped types. No-op for a dataset without
   * point groups or an out-of-range index.
   *
   * Removes the tuple's pixels high-index -> low so each splice leaves the lower
   * indices (and this tuple's not-yet-removed pixels) valid, refreshing the
   * remaining tuples' pixel indices after each removal -- the exact pixel-removal
   * contract removeDataPointAt honours. The tuple's ARRAY position is untouched
   * by pixel removal (refreshTuplesAfterPixelRemoval only rewrites indices
   * inside tuples), so the passed tupleIndex still addresses it at the end. A
   * grouped dataset never holds interpolation anchors (addAnchorPoint declines
   * point-group datasets), so no rebuildInterpolation is needed. */
  removeTuple(tupleIndex: number): void {
    const dataset = this.activeEntry.dataset;
    if (!dataset.hasPointGroups()) return;
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
    this.activeEntry.pointGroupCursor = this.computePointGroupCursorFor(dataset);
  }

  /** Whether sortByNearestNeighbour would do anything for the active series --
   *  the UI gate for its button (checkpoint 130). See that method for the rules. */
  canSortByNearestNeighbour(): boolean {
    const dataset = this.activeEntry.dataset;
    if (dataset.hasPointGroups()) return false;
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
   *  rides on the Dataset itself and setAllPixels leaves it untouched. */
  sortByNearestNeighbour(): void {
    if (!this.canSortByNearestNeighbour()) return;
    const dataset = this.activeEntry.dataset;
    const pixels = dataset.getAllPixels();
    const order = nearestNeighbourOrder(pixels.map((p) => ({ x: p.x, y: p.y })));
    dataset.setAllPixels(order.map((i) => pixels[i]!));
  }

  /** Reposition an already-placed calibration handle (drag-to-adjust). Re-runs calibration
   * immediately if it was already calibrated, so the live pixel→data readout stays correct. */
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
    const wasAnchor = dataset.getPixel(index)?.metadata?.['role'] === 'anchor';
    dataset.setPixelAt(index, px, py);
    if (wasAnchor) this.rebuildInterpolation();
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
    // point groups" test) -- but a Histogram's bin groups are the type's
    // inherent capture shape, not something the user switched on, so clearing
    // its points must not quietly leave a Histogram that can't record a bin.
    if (this.config.defaultPointGroups) fresh.setPointGroups([...this.config.defaultPointGroups]);
    entry.dataset = fresh;
    entry.pointGroupCursor = { tupleIndex: null, groupIndex: 0 };
  }

  reset(): void {
    this.placed = {};
    this.stepIndex = 0;
    this.pendingPixel = null;
    this.axes = null;
    this.calibrationError = null;
    this.globalValues = {};
    this.datasetEntries = [this.buildDatasetEntry('Series 1', 0)];
    this.activeDatasetIndex = 0;
    this.nextDatasetNumber = 2;
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
    for (const entry of this.datasetEntries) {
      plotData.addDataset(entry.dataset);
      if (axes) plotData.setAxesForDataset(entry.dataset, axes);
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
      cursors: this.datasetEntries.map((e) => ({ ...e.pointGroupCursor })),
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
    this.datasetEntries = datasets.map((dataset, i) => ({
      dataset,
      pointGroupCursor: snapshot.cursors[i]
        ? { ...snapshot.cursors[i]! }
        : { tupleIndex: null, groupIndex: 0 },
    }));
    this.placed = structuredClone(snapshot.placed);
    this.stepIndex = snapshot.stepIndex;
    this.pendingPixel = snapshot.pendingPixel ? { ...snapshot.pendingPixel } : null;
    this.calibrationError = snapshot.calibrationError;
    this.activeDatasetIndex = Math.min(snapshot.activeDatasetIndex, this.datasetEntries.length - 1);
    this.nextDatasetNumber = snapshot.nextDatasetNumber;
    this.globalValues = { ...snapshot.globalValues };
    this.optionValues = { ...snapshot.optionValues };
  }
}
