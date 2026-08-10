/**
 * THE AXES-TYPE CONFIGURATION SYSTEM — the shape of a graph type's declaration,
 * and the eleven declarations themselves.
 *
 * Split out of calibrationSession.ts on 2026-08-03 (v2.0), which had reached
 * 5,873 lines. The boundary is a real one rather than a size cut: everything
 * here DECLARES what a graph type is — how many clicks it asks for, what values
 * those clicks carry, which refusals those values must pass, and how to build
 * its axes — while calibrationSession.ts is the state machine that WALKS a
 * declaration. Adding a graph type is now one file, and all of it is data.
 *
 * ⚑ Nothing here may import calibrationSession.ts. The dependency runs one way,
 * which is what keeps the split from becoming a cycle. `DataPointView` moved
 * here for exactly that reason: `derivedTupleValue.compute` takes one.
 *
 * ⚑ calibrationSession.ts RE-EXPORTS this whole module, so every existing
 * import of a config or a config type keeps working unchanged. A move that also
 * churned its call sites could not be verified by the existing tests alone.
 */

import { Calibration } from '../core/calibration.js';
import { InputParser } from '../core/inputParser.js';

import { XYAxes } from '../core/axes/xy.js';
import { BarAxes } from '../core/axes/bar.js';
import { PolarAxes } from '../core/axes/polar.js';
import { TernaryAxes } from '../core/axes/ternary.js';
import { MapAxes } from '../core/axes/map.js';
import { CircularChartRecorderAxes, type RotationTime, type RotationDirection } from '../core/axes/circularChartRecorder.js';
import { SpiderAxes } from '../core/axes/spider.js';
import { PieAxes } from '../core/axes/pie.js';

import { binFromCorners } from '../algorithms/histogram.js';

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
  /** Which Calibration point slot this field's entered value fills.
   *
   * `dz` is the third slot, which needs the config to declare
   * `calibrationDimensions: 3` for the Calibration to have one at all. Spider
   * uses it for the axis's NAME — a string rather than a coordinate, which is why
   * it is worth saying plainly here: `dz` is a slot, not a Z axis. */
  field: 'dx' | 'dy' | 'dz';
  /** When true, the field may be left blank. For a value the calibration collects
   * but never reads — e.g. Polar P2's θ, which mirrors WebPlotDigitizer's form but
   * is ignored by the math. */
  optional?: boolean;
  /** Prefilled into the input when the step becomes active, so the user walks
   * past it and can change it rather than typing it from scratch (v1.4: Spider's
   * centre value, 0). ⚑ A default is not an invention — the distinction is whether
   * the user is SHOWN the value and can overrule it. Contrast the mirrored error
   * cap, which was never presented as a value anyone chose. */
  defaultValue?: string;
  /** What a blank `optional` field is stored as. Defaults to "0", which suits a
   * numeric slot nothing reads.
   *
   * ⚑ Declared rather than inferred, because "0" is a real answer in a slot that
   * holds text: Spider's axis NAME is optional, and defaulting it to "0" produced
   * an axis called `0` — a name that looks transcribed off the figure and never
   * was. A blank name has to stay blank so the axes class can fall back to the
   * positional "Axis N", which is true by construction. */
  blankValue?: string;
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

/**
 * A calibration step group repeated once per unit the FIGURE has, not once per
 * entry in a fixed list (v1.4, Spider).
 *
 * ⚑ Every axes type until now declared a FIXED `steps` array — XY 4, Bar 2, Polar
 * 3, Ternary 3, CCR 5 — because every one of them calibrates a frame whose shape
 * the tool already knows. A spider chart does not have a knowable shape: it has as
 * many axes as the chart's author drew, and the user is the only one who can say
 * how many. So the step list becomes a property of the SESSION rather than of the
 * config, and this describes how to grow it.
 *
 * The repeated group is APPENDED after `steps`, which is all Spider needs (one
 * origin click, then one click per spoke) and is deliberately not generalised
 * further: an interleaved or prefixed repeat has no user today, and the step
 * cursor's meaning would stop being obvious.
 *
 * ⚑ `min` is a floor on CALIBRATING, not on adding. The user always sees the "add
 * another" affordance, so nothing is hidden behind an invisible precondition; what
 * `min` prevents is *finishing* with fewer axes than the shape needs.
 */
export interface RepeatingStepInfo {
  /** Template for one repeat. Its `key`/`label` gain the 1-based repeat number,
   * so the placed-point Record stays keyed uniquely (`spoke1`, `spoke2`, ...). */
  step: CalibStepInfo;
  /** What one repeat is CALLED on screen ("axis"), for the add/remove controls and
   * the progress line. Same job as `tupleNoun` does for slots. */
  noun: string;
  /** The plural, DECLARED rather than derived: "axis" pluralises to "axes", and
   * appending an s produced "3 axiss" on screen the moment a second type needed the
   * wording generalised. */
  nounPlural: string;
  /** The one-line "why would I add another?" shown beside the count. Declared per
   * type because the reason differs: a spider grows an AXIS, a pie needs more of the
   * rim to fit a circle (or an ellipse) through. */
  hint: string;
  /** How many repeats a session starts with, and the fewest it can calibrate. */
  min: number;
}

export type BuildAxesResult<A extends CalibratedAxes> = { axes: A } | { error: string };

/** A value collected once after every click-step is placed, not tied to any
 * specific click (e.g. Circular Chart Recorder's "Chart Start Time"). */
export interface GlobalFieldInfo {
  key: string;
  label: string;
  /** Prefilled value (v1.6). A default the user WALKS PAST and can change is not an
   * invention -- the spider's centre value established the rule, and the pie's total
   * is the same shape: leave 100 and the slices read as percentages, which is what a
   * pie is, or type the figure's own total and they read in its units. */
  defaultValue?: string;
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
 * Two pixel-space axis directions that must not be parallel. When a graph type
 * inverts a 2x2 pixel matrix (XY and its Histogram/Error-Bar variants), distinct
 * but COLLINEAR calibration points make that matrix singular — inv2x2 divides by
 * zero and every value reads back NaN, while calibrate() still returns true. The
 * same-pixel guard (distinctPixelSteps) only catches the coincident sub-case; a
 * determinant/parallel check is what catches the rest. Each vector is the pixel
 * difference of the two named steps; if the two vectors are parallel (cross ~ 0)
 * the calibration has no 2-D scale.
 */
export interface ParallelAxisGuard {
  v1: readonly [string, string];
  v2: readonly [string, string];
  /** How the two axes are named to the user, e.g. "X and Y". */
  label: string;
}

/**
 * Two radial calibration points that must sit at DIFFERENT distances from the
 * origin. A Polar chart derives its radial scale from
 * dist(origin, P2) - dist(origin, P1) (core/axes/polar.ts `dist12`); when P1 and
 * P2 are equidistant from the origin that difference is zero, so every r reads
 * back non-finite while calibrate() still returns true -- the radial sibling of
 * ParallelAxisGuard. distinctPixelSteps only catches coincident pixels, not
 * equal radii, so a determinant-style check is what surfaces this.
 */
export interface RadialDistinctGuard {
  origin: string;
  p1: string;
  p2: string;
  /** How the radial axis is named to the user, e.g. "radial". */
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
export function checkGuards(
  config: AxesTypeConfig<CalibratedAxes>,
  cal: Calibration,
  options: Readonly<Record<string, string>>,
  globalValues: Readonly<Record<string, string>>,
  /** The steps the Calibration was actually built from, in the same order. Only
   * differs from `config.fixedSteps` for a type with a repeating group (v1.4),
   * where the key -> Calibration-index mapping below has to resolve against the
   * unrolled list or it lands on the wrong point.
   *
   * ⚑ REQUIRED, and deliberately so: this used to default to `config.fixedSteps`,
   * which is the one shape of stray `config.steps` read that getSteps()'s own
   * comment warns about. It reads as harmless — the two lists ARE identical for
   * all eight fixed-shape types — so an omitted argument would test clean
   * everywhere and, on a spider, silently guard the origin alone while every
   * spoke went unchecked. A default that is right eight times out of nine is a
   * trap, not a convenience; both callers already pass `this.getSteps()`. */
  steps: readonly CalibStepInfo[]
): string | null {
  for (const g of config.logScaleGuards ?? []) {
    if (!optionBool(options, g.option)) continue;
    const vals: number[] = [];
    for (const idx of g.points) {
      const pt = cal.getPoint(idx);
      const raw = g.field === 'dx' ? pt?.dx : pt?.dy;
      vals.push(parseFloat(String(raw ?? '')));
    }
    // A log axis maps through log10: it must not pass through zero, and both
    // endpoints must share a sign. WPD supports an all-negative log axis (both
    // < 0), but a zero endpoint or a sign MIX sends the else-branch to
    // Math.log(negative) = NaN, so every value reads back NaN while calibrate()
    // still reports success (core/axes/xy.ts:88). The old guard only caught the
    // exactly-zero case. NaN entries (non-numeric) are left to the parser.
    const anyZero = vals.some((v) => v === 0);
    const mixedSign = vals.some((v) => v > 0) && vals.some((v) => v < 0);
    if (anyZero || mixedSign) {
      return `A log ${g.label} scale cannot pass through zero or change sign — enter non-zero values with the same sign (e.g. 1 and 100).`;
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
        const ai = steps.findIndex((st) => st.key === group[i]);
        const bi = steps.findIndex((st) => st.key === group[j]);
        const a = cal.getPoint(ai);
        const b = cal.getPoint(bi);
        if (a && b && a.px === b.px && a.py === b.py) {
          const la = steps[ai]?.label ?? group[i];
          const lb = steps[bi]?.label ?? group[j];
          return `${la} and ${lb} are on the same pixel — they must be different points, or the calibration has no scale.`;
        }
      }
    }
  }
  // Distinct-but-collinear invariant. Runs AFTER distinctPixelSteps so the
  // coincident sub-case keeps its own "same pixel" message; this catches the
  // rest — two axes pointing the same way make the 2x2 pixel transform singular
  // (inv2x2 divides by zero -> every value NaN, calibrate() still true).
  const pag = config.parallelAxisGuard;
  if (pag) {
    const dirOf = (pair: readonly [string, string]): { x: number; y: number } | null => {
      const ia = steps.findIndex((st) => st.key === pair[0]);
      const ib = steps.findIndex((st) => st.key === pair[1]);
      const a = cal.getPoint(ia);
      const b = cal.getPoint(ib);
      return a && b ? { x: a.px - b.px, y: a.py - b.py } : null;
    };
    const d1 = dirOf(pag.v1);
    const d2 = dirOf(pag.v2);
    if (d1 && d2) {
      const cross = d1.x * d2.y - d1.y * d2.x;
      if (Math.abs(cross) < 1e-9) {
        return `The ${pag.label} calibration axes are parallel — they must point in different directions, or the calibration has no scale.`;
      }
    }
  }
  // Equal-radius invariant (Polar). P1 and P2 at the same distance from the
  // origin make the radial scale dist12 = 0 -> every r reads non-finite while
  // calibrate() still returns true (the radial analogue of parallelAxisGuard;
  // distinctPixelSteps only catches coincident pixels, not equal radii).
  const rdg = config.radialDistinctGuard;
  if (rdg) {
    const distFrom = (originKey: string, ptKey: string): number | null => {
      const oi = steps.findIndex((st) => st.key === originKey);
      const pi = steps.findIndex((st) => st.key === ptKey);
      const o = cal.getPoint(oi);
      const p = cal.getPoint(pi);
      return o && p ? Math.hypot(p.px - o.px, p.py - o.py) : null;
    };
    const d1 = distFrom(rdg.origin, rdg.p1);
    const d2 = distFrom(rdg.origin, rdg.p2);
    if (d1 != null && d2 != null && Math.abs(d2 - d1) < 1e-6) {
      return `The ${rdg.label} calibration points are the same distance from the origin — they must be at different radii, or the calibration has no radial scale.`;
    }
  }
  // ⚑ A type's own check on the VALUES that were typed, last because it is the most
  // specific. Declared on the config rather than performed in buildAxes, and that
  // distinction is the whole point: buildAxes runs on the CLICK PATH ONLY, so a check
  // living there is not a guard at all -- a hand-edited or foreign file walks straight
  // past it. Pie found this the moment it was tested (a total of -50 opened clean),
  // which is the same "guards belong in the model, and the model has more than one
  // entrance" lesson as checkpoints 69/72/77/80. Anything that refuses a calibration
  // belongs here, where both doors run it.
  const valueError = config.checkValues?.(cal, options, globalValues);
  if (valueError) return valueError;
  return null;
}

/** True when two steps must never share a pixel, per the config's own
 * declaration -- replaces checkpoint 69's trailing-digit heuristic, which
 * no-opped on Ternary and CCR. Used to filter the reuse-pixel buttons; the
 * calibration itself is guarded by checkGuards above, which also covers drags. */
export function mustDiffer(config: AxesTypeConfig<CalibratedAxes>, a: string, b: string): boolean {
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
  if (a.fixedSteps.length !== b.fixedSteps.length) return false;
  return a.fixedSteps.every((step, i) => step.key === b.fixedSteps[i]!.key);
}

/**
 * Should the walk auto-reuse the shared-origin pixel at this moment?
 *
 * Answers the whole question in one place: the type declares a shared corner,
 * the user has left the option on, the walk has just arrived at the reusing
 * step, the donor is placed and the target is not. Returns what to do, or null.
 *
 * ⚑ Every one of those conditions used to sit inline in `Workspace.tsx` with
 * the step keys written as literals, which is why the capability was declared
 * and the geometry was not. Pure, so it can be mutation-tested; `ui/` cannot.
 *
 * ⚑ `placed[to]` is checked so this cannot re-fire and overwrite a pixel the
 * user has already put down by hand -- reuse is an offer on arrival, not a rule
 * that keeps reasserting itself.
 */
export function commonOriginReuse(
  config: Pick<AxesTypeConfig<CalibratedAxes>, 'commonOrigin'>,
  enabled: boolean,
  nextStepKey: string | undefined,
  placed: Readonly<Record<string, unknown>>
): { from: string; prefill: string[] } | null {
  const shared = config.commonOrigin;
  if (!enabled || !shared) return null;
  if (nextStepKey !== shared.to) return null;
  if (!placed[shared.from] || placed[shared.to]) return null;
  return { from: shared.from, prefill: [...(shared.prefill ?? [])] };
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
  /** The FIXED steps, in order. For a type with a `repeatingStep` these are only
   * the prefix — ask the SESSION (`getSteps()`) for the list a user is actually
   * walking, never this array. */
  /** ⚑ The FIXED steps only. Never read this directly — a session's real step
   * list is `session.getSteps()`, which unrolls the repeating group. Named
   * `fixedSteps` rather than `steps` precisely so a stray read cannot compile:
   * for the eight fixed-shape types the two are identical, which is what made the
   * mistake invisible, and on a spider it silently sees one step (the origin) and
   * reports a calibration complete with no axes placed. */
  fixedSteps: readonly CalibStepInfo[];
  /** A step group repeated as many times as the figure needs (v1.4, Spider).
   * Undefined = a fixed-shape calibration, which is every other type. */
  repeatingStep?: RepeatingStepInfo;
  /** How many value slots each Calibration point carries. Undefined = 2 (dx, dy),
   * which is every type that predates Spider. Spider declares 3 because it stores
   * the axis NAME in `dz`; a 2-slot Calibration would drop it on the floor while
   * every number still read back correctly — a silent loss, not a visible one. */
  calibrationDimensions?: 2 | 3;
  /**
   * A type's own refusal based on the VALUES entered, returning the message or null.
   *
   * ⚑ Runs inside checkGuards, so it fires on BOTH entrances -- the click path and a
   * loaded file. Put a refusal here rather than in `buildAxes`, which only the click
   * path calls: a check that lives there passes every test written against clicking
   * and lets a hand-edited file through untouched.
   */
  checkValues?: (
    cal: Calibration,
    options: Readonly<Record<string, string>>,
    globalValues: Readonly<Record<string, string>>
  ) => string | null;
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
   * Slots arrived with Box Plot, so its vocabulary was hardcoded into
   * the shared tuple status line and tip -- which meant Histogram's bins
   * announced themselves as "new box" (caught driving the real app, checkpoint
   * 66). Undefined keeps the Box Plot default, since that's still the only
   * other tuple user. */
  tupleNoun?: string;
  /**
   * What a tuple's members ARE to each other (David's dimensional taxonomy,
   * 2026-07-27).
   *
   * - `'object'` (default) — the members describe ONE thing, and only together:
   *   a box's Min/Q1/Median/Q3/Max is a single distribution, a histogram bin's
   *   two corners are a single interval. Half a box is not half the data, it is
   *   nonsense. David calls these **1.5D**: one axis carries arbitrary
   *   categories, only the other does mathematical work.
   * - `'independent'` — the tuple is a ROW of separate readings, one per named
   *   slot, each meaningful on its own and each legitimately absent. A spider is
   *   **N × 1D**: N independent 1-D scales sharing an origin, and a datum is one
   *   number on one named axis. Nothing pairs slot 2 with slot 5.
   *
   * ⚑ WHY THIS IS A CAPABILITY AND NOT A `config.axesKind === 'spider'` CHECK. Spider
   * REUSED the Box Plot slot machinery, which was the right call — the
   * capture workflow is genuinely the same — but every rule keyed on
   * `hasSlots()` came along with it, including rules that only hold for an
   * indivisible object. That is how the Eraser came to delete a whole six-axis
   * profile when asked to remove one reading (David, driving the app). The
   * machinery is shared; the MEANING is not, and the meaning is what these rules
   * actually depend on.
   */
  tupleMembers?: 'object' | 'independent';
  /**
   * Whether a completed tuple's LAST point also opens the next one (v1.6, pie).
   *
   * For a type whose tuples share a boundary -- a pie's slices meet along one line --
   * this halves the clicking and, more importantly, stops the same piece of ink being
   * measured twice and answered differently. A histogram's bins do NOT set this: bins
   * can have gaps and uneven spacing, so its two corners belong to that bar alone.
   */
  chainTuples?: boolean;
  /**
   * A per-TUPLE derived value, shown as one column instead of one-per-slot (v1.6).
   *
   * ⚑ For most tuple types each member IS a number the reader wants -- a box plot's
   * Min/Q1/Median are five real readings. A pie's are not: its two boundaries are
   * angles, and the slice's value lives in the DIFFERENCE, so showing the members
   * would put "270" and "61.2" on screen for a slice worth 42.
   */
  derivedTupleValue?: {
    label: string;
    compute(
      points: (DataPointView | null)[],
      axes: A,
      ctx: {
        apex: { x: number; y: number } | null;
        /** v2.0, Phase 5: the active dataset's stack group (setDatasetStackGroup),
         * or null when it isn't part of one. A stacked segment's value is its own
         * SPAN -- neither end is the chart's declared baseline, even for the
         * bottommost layer, so the ordinary baseline-relative/floating-direction
         * sign convention (see BAR_AXES_CONFIG) does not apply; see its own
         * derivedTupleValue for how this is used. */
        stackGroup: string | null;
      }
    ): number | null;
  };
  /**
   * What auto-extract MEANS on this graph type — a declared capability, because
   * every caller was asking `config.axesKind === 'spider'` or `axesKind === 'bar'` and
   * getting the answer from the type's NAME rather than from what it can do.
   *
   * - `'curve'` (default) — the mechanisms that follow a drawn line: flood fill,
   *   colour trace by column, blob detection. Right wherever a series IS a curve.
   * - `'along-axes'` — the reading is where the series crosses a calibrated ray,
   *   so the trace walks the rays instead of the columns (Spider).
   * - `'bounding-box'` (v2.0 Phase 7) — the direct fix for the `'none'` case
   *   below, for the one bar-family type where it actually applies: a bar
   *   blob's OWN bounding box is its two measured ends (see
   *   engine/barDetectRun.ts), so nothing is averaged or centroided away.
   *   Bar only — Box Plot/Histogram/categorical Line still have no bounding
   *   box that would mean their own record (a box's whiskers, a bin's
   *   height-only extent, a line's ordinal click), so they stay `'none'`.
   * - `'none'` — refused, and this is a CORRECTNESS gate rather than a missing
   *   feature: every CURVE mechanism returns the MIDDLE of a filled shape, and
   *   a bar's value is its end, so the number produced was never the datum
   *   (`59f94a6`). Histogram, Box Plot, categorical Line.
   */
  autoExtractKind?: 'curve' | 'along-axes' | 'bounding-box' | 'none';
  /**
   * The SHAPE this type's data takes in an export file — declared, because the
   * assembly was an if/else cascade in the UI reading `id === 'errorbar'`, then
   * `id === 'histogram'`, then a grouped test. A type's export shape is a property
   * of the type, and the v1.4 audit's export defect was a wrong branch in exactly
   * that chain: a spider fell into the tuple-table case, which is active-series
   * only and reads values off the nearest ray.
   *
   * - `'flat'` (default) — one row per point, honouring the Active/All scope.
   * - `'tuples'` — the tuple table: one row per box/bin, columns for its members.
   *   For types whose tuple IS one object (see tupleMembers).
   * - `'bins'` — histogram bins, as true edges.
   *
   * ⚑ Resolve it through `session.getExportShape()`, never by reading this field
   * directly: Box Plot is ALSO reachable as a toggle on a Bar session, so the
   * shape depends on the series as well as the type. That method is the one place
   * that knows.
   */
  exportShape?: 'flat' | 'tuples' | 'bins';

  /* ⚑ THREE QUESTIONS THAT LOOK ALIKE AND ARE NOT, since confusing two of them is
   * what cost this release its audit findings:
   *   1. "Does this SERIES have slots?" -> dataset.hasSlots(). Structural.
   *   2. "What do the slots MEAN?" -> tupleMembers. One object, or independent
   *      readings. Getting this from (1) is what made the Eraser delete a whole
   *      six-axis profile, and the CSV carry one series read off the wrong ray.
   *   3. "Which AXES CLASS is this?" -> axesKind, NEVER id. Asked wherever the
   *      code narrows `this.axes` to call something only that class has
   *      (SpiderAxes.projectOnSpoke, BarAxes.calculateOrientation). `id` names the
   *      GRAPH TYPE, and two types can share one class — Box Plot and Bar are both
   *      axesKind 'bar', which is the case that made this rule (checkpoint 107).
   *      An `id` check there silently excludes the second type on that class.
   * And what a graph type CAN DO belongs in a declared capability like the one
   * above, not inferred from any of the three. */
  /** Two calibration steps that share one physical pixel, so ui/ can offer
   * "Common origin": reaching `to` auto-reuses `from`'s pixel and prefills its
   * values, the usual axes-cross-at-one-corner case (checkpoint 50).
   *
   * A declared capability rather than a `config.id === 'xy'` check, because
   * that check is exactly the graph-type/axes-class conflation checkpoint 66
   * removes: Histogram calibrates identically to XY and wants this too, and
   * asking "is it XY?" would silently answer no.
   *
   * ⚑ v2.1: the STEP KEYS are declared too. They used to be a `next?.key ===
   * 'y1'` literal in Workspace.tsx while only the capability was declared --
   * half a declaration, and the half that was hardcoded is the half that
   * breaks on a type whose steps are named differently. Bar's are `p1`/`p2`
   * and categorical Line's are `v1`/`v2`, so any second user of this would
   * have needed a second literal beside the first. */
  /**
   * This graph type has CATEGORIES the user can mark out (v2.1), and which
   * already-placed calibration step seeds the first edge of the category axis.
   *
   * Presence IS the capability -- Bar, categorical Line and Box Plot, the three
   * types whose other axis is categorical. Histogram bins are numeric intervals
   * and spider spokes are axes, so neither declares it.
   *
   * ⚑ The seed step is DECLARED for the same reason `commonOrigin`'s keys now
   * are: it is `p1` for Bar and Box Plot but `v1` for categorical Line, so a
   * literal would work on two of the three types and quietly do nothing on the
   * third. The value origin sits at the category axis's first edge, so reusing
   * that pixel is what makes marking the axis one click instead of two.
   *
   * ⚑ Ticks are an AID, not a calibration: nothing here is a step in the walk,
   * and no measured value depends on any of it. See core/categoryAxis.ts.
   */
  categoryTicks?: { originStep: string };
  commonOrigin?: {
    /** The already-placed step whose pixel is reused. */
    from: string;
    /** The step that reuses it, on arrival. */
    to: string;
    /** Values prefilled into `to`'s fields, in order — the shared corner's
     * value is known precisely because it is shared. Omit for a step with no
     * value fields. */
    prefill?: readonly string[];
  };
  /** Slots every dataset under this graph type is created with, so
   * tuple capture is the type's *inherent* shape rather than something the
   * user must first discover and switch on. Histogram's bins are the first
   * user (['Bin start','Bin end']); Box Plot's Min/Q1/Median/Q3/Max stays an
   * opt-in button on Bar until its own promotion lands, which is precisely
   * the hidden-mode problem CLAUDE.md flags. Undefined = plain, ungrouped
   * points (every other type today). */
  defaultSlots?: readonly string[];
  /** Slot names DERIVED from the calibrated axes, for a type whose capture
   * shape only exists once the axes are known (v1.4, Spider: one slot per spoke,
   * named after it). Applied on both entrances — a fresh calibration and a loaded
   * project. See CalibrationSession.applyAxesDerivedSlots. */
  slotsFromAxes?(axes: A): readonly string[];
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
  axesKind: 'xy' | 'bar' | 'polar' | 'ternary' | 'map' | 'ccr' | 'spider' | 'pie';
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
  /** For 2x2-pixel-transform types (XY): the two axis directions that must not
   * be parallel, catching distinct-but-collinear points the same-pixel guard
   * misses. See ParallelAxisGuard. */
  parallelAxisGuard?: ParallelAxisGuard;
  /** For radial types (Polar): two points that must be at different distances
   * from the origin, else the radial scale is zero. See RadialDistinctGuard. */
  radialDistinctGuard?: RadialDistinctGuard;
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

/**
 * Copy the keys a donor config ACTUALLY DECLARES, skipping the ones it omits.
 *
 * Histogram borrows XY's calibration and guards, and Box Plot borrows Bar's,
 * so the shared arrays cannot drift apart -- that reuse is deliberate and
 * predates this helper. But every borrowable field is OPTIONAL, so the plain
 * form `logScaleGuards: XY_AXES_CONFIG.logScaleGuards` writes a key **holding
 * undefined** whenever the donor omits it.
 *
 * ⚑ That is not the same as omitting the key, and this object is read as a
 * TABLE (see `engine/__tests__/axesConfigTable.test.ts`, which walks every
 * guard->step and choice->default reference). A guard naming a step that does
 * not exist does not fail -- `findIndex` returns -1, `getPoint(-1)` returns
 * null, and the check silently passes everything. "Absent" and "present but
 * undefined" therefore have to stay distinguishable, which is exactly what
 * `exactOptionalPropertyTypes` enforces at the type level.
 */
function borrowFrom<T extends object, K extends keyof T>(
  donor: T,
  keys: readonly K[]
): Partial<Pick<T, K>> {
  const out: Partial<Pick<T, K>> = {};
  for (const key of keys) {
    if (donor[key] !== undefined) out[key] = donor[key];
  }
  return out;
}

export interface DataPointView {
  px: number;
  py: number;
  data: number[] | null;
}

/** X1 and Y1 are one physical pixel wherever the axes cross at a corner -- the
 * overwhelmingly common case -- and that corner's Y is 0 by construction, hence
 * the prefill. Shared by XY and Histogram the way they already share
 * `fixedSteps`: one object, so the two cannot drift apart, and so neither has to
 * spread `| undefined` through an optional property under
 * `exactOptionalPropertyTypes`. */
const XY_COMMON_ORIGIN = { from: 'x1', to: 'y1', prefill: ['0'] } as const;

export const XY_AXES_CONFIG: AxesTypeConfig<XYAxes> = {
  id: 'xy',
  label: 'XY',
  axesKind: 'xy',
  supportsCurveFit: true,
  dataDim: 2,
  valueLabels: ['X', 'Y'],
  globalFields: [],
  commonOrigin: XY_COMMON_ORIGIN,
  logScaleGuards: [
    { option: 'isLogX', points: [0, 1], field: 'dx', label: 'X' },
    { option: 'isLogY', points: [2, 3], field: 'dy', label: 'Y' },
  ],
  distinctPixelSteps: [['x1', 'x2'], ['y1', 'y2']],
  parallelAxisGuard: { v1: ['x1', 'x2'], v2: ['y1', 'y2'], label: 'X and Y' },
  // WPD's own XY sidebar options (templates/_sidebars.html:258-297). Note the
  // rotation default: WPD's control is "Skip rotation correction" and ships
  // UNCHECKED, i.e. correction ON. We hardcoded the opposite for 68
  // checkpoints -- see CLAUDE.md's parity re-audit and the ckpt-64 correction.
  options: [
    { key: 'isLogX', label: 'Log X', kind: 'checkbox', default: false },
    { key: 'isLogY', label: 'Log Y', kind: 'checkbox', default: false },
    { key: 'skipRotation', label: 'Skip rotation', kind: 'checkbox', default: false },
  ],
  fixedSteps: [
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
export const HISTOGRAM_SLOTS = ['Bin start', 'Bin end'] as const;

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
  exportShape: 'bins',
  // v2.0, 2026-07-30: was 'none' -- a leftover from before Bar's own bounding-box
  // detection existed, never revisited once it landed. A bin is structurally the
  // same shape a colour-detected blob's bbox already gives (see
  // addBarDetectBoxes's isHistogramBinShape branch for the one real
  // difference from Bar: both filed points share the box's TOP edge, not
  // opposite corners -- a bin's height is one measurement, not an extent).
  autoExtractKind: 'bounding-box',
  dataDim: 2,
  valueLabels: ['X', 'Y'],
  globalFields: [],
  // Same steps as XY (it shares the array), so the same shared corner.
  commonOrigin: XY_COMMON_ORIGIN,
  defaultSlots: HISTOGRAM_SLOTS,
  tupleNoun: 'bin',
  // Same axes, same steps, same options -> same guards. Sharing the arrays
  // rather than re-declaring keeps them from drifting apart. See borrowFrom
  // for why this is a spread and not six `key: XY_AXES_CONFIG.key` lines.
  // `fixedSteps` is REQUIRED on the config, so it is always there to copy
  // plainly; borrowFrom carries only the genuinely optional keys.
  fixedSteps: XY_AXES_CONFIG.fixedSteps,
  ...borrowFrom(XY_AXES_CONFIG, [
    'logScaleGuards',
    'distinctPixelSteps',
    'parallelAxisGuard',
    'options',
    'extractOptions',
  ]),
  // v2.0 Phase 6: reuses algorithms/histogram.ts's OWN corner-averaging (not
  // a re-derivation) so the on-screen tuple table and CSV/JSON export (which
  // read `derived`, see engine/csvExport.ts's tupleDataSection) finally
  // agree with getHistogramBins()'s own computed height -- previously that
  // number reached only the dedicated bins-export path, never the table.
  derivedTupleValue: {
    label: 'Height',
    compute(points) {
      const [a, b] = points;
      if (!a?.data || !b?.data) return null;
      const [ax, ay] = a.data;
      const [bx, by] = b.data;
      if (ax == null || ay == null || bx == null || by == null) return null;
      return binFromCorners({ x: ax, y: ay }, { x: bx, y: by }).value;
    },
  },
  buildAxes(cal, ctx) {
    const result = XY_AXES_CONFIG.buildAxes(cal, ctx);
    if ('error' in result) return result;
    result.axes.setMetadata({ ...result.axes.getMetadata(), [GRAPH_TYPE_METADATA_KEY]: 'histogram' });
    return result;
  },
};

/** A bar's two captured opposite corners, in drag order (v2.0). Order carries
 * no meaning for an anchored bar (derivedTupleValue compares each corner's
 * VALUE to the declared baseline, never the slot position) but IS the signal
 * for a floating/offset bar's direction — see derivedTupleValue below. */
export const BAR_INTERVAL_SLOTS = ['Bar start', 'Bar end'] as const;

/**
 * Shared by every config that calibrates a `BarAxes` (Bar, Categorical Line,
 * Box Plot): the file-load-visible mirror of the identical-value /
 * non-positive-log-endpoint refusal `core/axes/bar.ts`'s calibrate() now
 * applies (v2.0 pre-launch audit). See BAR_AXES_CONFIG.checkValues for why
 * this has to be declared, not just performed inside calibrate() -- a loaded
 * file calls calibrate() directly and never inspects its return value, so
 * without this a bad file opened clean while every bar silently read back
 * one constant value.
 */
function barCalibrationValueCheck(
  cal: Calibration,
  options: Readonly<Record<string, string>>
): string | null {
  const p1 = parseFloat(String(cal.getPoint(0)?.dy ?? ''));
  const p2 = parseFloat(String(cal.getPoint(1)?.dy ?? ''));
  if (Number.isFinite(p1) && Number.isFinite(p2)) {
    if (p1 === p2) {
      return 'The two calibration points have the same value — they must be different, or the calibration has no scale.';
    }
    if (optionBool(options, 'isLog') && (!(p1 > 0) || !(p2 > 0))) {
      return 'A log value scale cannot pass through zero or go negative — enter positive values (e.g. 1 and 100).';
    }
  }
  return null;
}

export const BAR_AXES_CONFIG: AxesTypeConfig<BarAxes> = {
  id: 'bar',
  label: 'Bar',
  axesKind: 'bar',
  // v2.0 Phase 7: a bounding box IS a bar's two measured ends, so unlike the
  // curve mechanisms this refused at `59f94a6`, nothing here is averaged or
  // centroided away -- see engine/barDetectRun.ts and this field's own doc.
  autoExtractKind: 'bounding-box',
  dataDim: 1,
  valueLabels: ['value'],
  globalFields: [],
  logScaleGuards: [{ option: 'isLog', points: [0, 1], field: 'dy', label: 'value' }],
  distinctPixelSteps: [['p1', 'p2']],
  // WPD: templates/_sidebars.html bar-axes-scale / bar-axes-rotated.
  options: [
    { key: 'isLog', label: 'Log scale', kind: 'checkbox', default: false },
    { key: 'isRotated', label: 'Horizontal bars', kind: 'checkbox', default: false },
    // v2.0: a declared setting, not a calibration value -- see BarAxes.setBaseline.
    // Defaults ON at '0', the ordinary bar chart, walked past like pie's total/sweep.
    { key: 'hasBaseline', label: 'Bars share a baseline', kind: 'checkbox', default: true },
    { key: 'baselineValue', label: 'Baseline value', kind: 'text', default: '0' },
  ],
  fixedSteps: [
    { key: 'p1', label: 'P1', color: '#e0a458', prompt: 'Click the pixel position of a known bar value (e.g. 0)', valueFields: [{ key: 'p1', label: 'value', field: 'dy' }] },
    { key: 'p2', label: 'P2', color: '#5fb4e0', prompt: 'Click a second pixel position of a known, different bar value', valueFields: [{ key: 'p2', label: 'value', field: 'dy' }] },
  ],
  // v2.0: a bar is a 2-slot OBJECT tuple (its two dragged corners), same
  // shape as pie's sector / histogram's bin -- see BAR_INTERVAL_SLOTS.
  defaultSlots: BAR_INTERVAL_SLOTS,
  categoryTicks: { originStep: 'p1' },
  tupleNoun: 'bar',
  tupleMembers: 'object',
  derivedTupleValue: {
    label: 'Value',
    compute(points, axes, ctx) {
      const [start, end] = points;
      if (!start?.data || !end?.data) return null; // a half-dragged bar has no value yet
      const v1 = start.data[0]!;
      const v2 = end.data[0]!;
      // v2.0 Phase 5: a STACKED segment's near end is never the chart's
      // declared baseline -- not even the bottommost layer, which sits on
      // top of nothing but still isn't "at zero" in the sense the baseline-
      // relative sign convention means. Its value is its own SPAN, and
      // magnitude-not-direction is what's meaningful (a contribution to a
      // stack is never negative) -- so this bypasses both the baseline and
      // the floating-direction rules below entirely.
      if (ctx.stackGroup !== null) return Math.abs(v2 - v1);
      if (axes.hasDeclaredBaseline()) {
        // ⚑ Sign comes from comparing VALUES to the baseline, never raw pixel
        // position -- a pixel-position rule ("smaller y = far end") is exactly
        // backwards for a bar below baseline in a normal vertical orientation,
        // and pixelToData already encodes orientation/direction/log-scale
        // correctly, so comparing values needs no such reversal at all.
        const baseline = axes.getBaselineValue();
        const nearIsStart = Math.abs(v1 - baseline) <= Math.abs(v2 - baseline);
        const far = nearIsStart ? v2 : v1;
        return far - baseline;
      }
      // Floating/offset bar (no declared baseline): there is no reference to
      // sign against, so the value is the bar's own SPAN -- a magnitude, the
      // same answer the stacked branch above reaches for the same reason.
      //
      // ⚑⚑ REVERSED 2026-08-03 (David). This used to return `v2 - v1`, letting
      // the DRAG DIRECTION carry a sign: corner-to-corner up positive, down
      // negative. Three things were wrong with it.
      //
      // 1. **The sign recorded the user's hand, not the figure.** Two people
      //    capturing the identical bar got +12 and -12. That is the defect
      //    shape already written down for the spider off-ray distance: ask
      //    *whose property is this?* before storing a field. A span is a
      //    magnitude -- a bar from -10 to -5 spans 5, not -5; its POSITION is
      //    negative, its EXTENT is not.
      // 2. **The justification was a false analogy.** It read "same principle
      //    as pie preserving its boundary-walk direction". In a pie, direction
      //    changes WHICH SECTOR is meant -- A->B and B->A are different
      //    regions, so direction is a property of the figure. Two opposite
      //    corners define the SAME rectangle either way; there is nothing for
      //    the order to distinguish.
      // 3. **It was invisible, and it fired on the default gesture.** Nothing
      //    on screen said click order meant anything -- it appeared in the
      //    v2.0.0 release notes and nowhere else -- while dragging top-left
      //    downward, which is the natural motion, produced the negative.
      //
      // If a figure ever genuinely needs directional floating bars (a waterfall
      // being the only candidate found), that is a DECLARATION the user makes
      // visibly, the way the baseline is declared -- never a meaning inferred
      // from the order two corners happened to be clicked.
      return Math.abs(v2 - v1);
    },
  },
  // ⚑ Declared, not performed in buildAxes -- so a LOADED file meets the same
  // refusal a click does (same reasoning as pie's checkValues above it).
  checkValues(cal, options) {
    if (optionBool(options, 'hasBaseline')) {
      const baseline = parseFloat(options['baselineValue'] ?? '');
      if (!Number.isFinite(baseline)) {
        return 'The baseline value must be a number (0 for an ordinary zero-based bar chart).';
      }
    }
    return barCalibrationValueCheck(cal, options);
  },
  buildAxes(cal, ctx) {
    const axes = new BarAxes();
    const ok = axes.calibrate(cal, optionBool(ctx.options, 'isLog'), optionBool(ctx.options, 'isRotated'));
    if (!ok) return { error: 'Calibration failed — check the entered data values are valid numbers.' };
    axes.setBaseline(optionBool(ctx.options, 'hasBaseline'), parseFloat(ctx.options.baselineValue ?? '0'));
    return { axes };
  },
  extractOptions(axes) {
    return {
      isLog: String(axes.isLog()),
      isRotated: String(axes.isRotated()),
      hasBaseline: String(axes.hasDeclaredBaseline()),
      baselineValue: String(axes.getBaselineValue()),
    };
  },
};

// "Line" (checkpoint 101; label shortened from "Line (categorical X)" 2026-07-30,
// David: rename it "Line" everywhere -- the picker's own icon, sitting beside
// XY's, now carries the categorical-vs-continuous distinction the parenthetical
// used to spell out in text). For a plot whose X axis is CATEGORICAL (species,
// treatments, sites…) with a numeric Y, e.g. Fig 12 of the snow-line paper this
// tool was validated on. "X is not numeric" (David): you cannot calibrate an X
// value where none was measured, so this reuses BarAxes -- whose calibration is
// TWO points on the VALUE axis only, no X clicks (tenet 10, reuse the
// categorical model bars already have). Points are captured like an XY series
// (dots), not bars; each point's Y is read from the value calibration and its X
// is its ORDINAL position (derived from left-to-right pixel order at
// export/display time, never stored -- tenet 9). A per-point NAME is deliberately
// left as reserved metadata (the same slot Bar's label uses), unwritten today so
// a future OCR pass (or a manual rename) can fill in the real category names with
// no migration -- the "window to the future" kept open on purpose (David).
export const CATEGORICAL_LINE_CONFIG: AxesTypeConfig<BarAxes> = {
  id: 'categorical',
  label: 'Line',
  axesKind: 'bar',
  autoExtractKind: 'none',
  dataDim: 1,
  valueLabels: ['Value'],
  globalFields: [],
  logScaleGuards: [{ option: 'isLog', points: [0, 1], field: 'dy', label: 'value' }],
  distinctPixelSteps: [['v1', 'v2']],
  // ⚑ `v1`, not `p1` -- this type names its own steps, which is exactly why the
  // seed is declared rather than written as a literal at the call site.
  categoryTicks: { originStep: 'v1' },
  options: [{ key: 'isLog', label: 'Log scale (value)', kind: 'checkbox', default: false }],
  fixedSteps: [
    { key: 'v1', label: 'V1', color: '#e0a458', prompt: 'Click a known value on the Y axis (e.g. Y=0)', valueFields: [{ key: 'v1', label: 'value', field: 'dy' }] },
    { key: 'v2', label: 'V2', color: '#5fb4e0', prompt: 'Click a second, different known value on the Y axis', valueFields: [{ key: 'v2', label: 'value', field: 'dy' }] },
  ],
  // Same BarAxes, same v2.0-audit refusal -- see barCalibrationValueCheck.
  checkValues(cal, options) {
    return barCalibrationValueCheck(cal, options);
  },
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
export const BOX_PLOT_SLOTS = ['Min', 'Q1', 'Median', 'Q3', 'Max'] as const;

// "Box Plot" as a first-class graph type (checkpoint 107). BarAxes underneath --
// a box plot is calibrated exactly like a bar chart (two points on the VALUE
// axis; the categories run along the other axis), which is why it was originally
// reached via a hidden "Box Plot Groups" toggle on Bar (checkpoints 21-23). That
// toggle failed CLAUDE.md's keystone test: a mode you can only reach by knowing
// it exists is invisible to someone seeing the tool for the first time. Making it
// a dropdown entry is *correctness*, not polish -- the same promotion Histogram
// got at checkpoint 66, whose graph-type != axes-class generalization
// (`defaultSlots`/`tupleNoun`) is exactly what makes this a config object
// rather than a code path. Datasets are auto-created with the Min/Q1/Median/Q3/Max
// slots, so tuple capture is the type's inherent shape, not something the
// user must first discover and switch on.
export const BOX_PLOT_AXES_CONFIG: AxesTypeConfig<BarAxes> = {
  id: 'boxplot',
  label: 'Box Plot',
  axesKind: 'bar',
  exportShape: 'tuples',
  autoExtractKind: 'none',
  dataDim: 1,
  valueLabels: ['value'],
  globalFields: [],
  defaultSlots: BOX_PLOT_SLOTS,
  // Shares Bar's fixedSteps (below), so the same seed step.
  categoryTicks: { originStep: 'p1' },
  tupleNoun: 'box',
  // Shares Bar's calibration and guards -- reusing the arrays keeps them from
  // drifting apart, as Histogram does with XY. ⚑ Note `options` is NOT in this
  // list; see the comment immediately below for why sharing it was a bug.
  fixedSteps: BAR_AXES_CONFIG.fixedSteps,
  ...borrowFrom(BAR_AXES_CONFIG, ['logScaleGuards', 'distinctPixelSteps']),
  // ⚑ v2.0 Phase 6: `options` is now its OWN array -- log scale + horizontal
  // bars only -- rather than reusing BAR_AXES_CONFIG.options by reference.
  // Bar's own array grew `hasBaseline`/`baselineValue` in Phase 2, and
  // sharing the reference leaked those into every Box Plot session too: the
  // settings panel showed "Bars share a baseline" / "Baseline value"
  // controls that DID NOTHING -- buildAxes below never reads them, and Box
  // Plot has no derivedTupleValue that would use them anyway (it shows the
  // five raw letter values, not a computed extent). A control that changes
  // nothing when changed is exactly the defect class this project treats as
  // a real bug, not cosmetic. Found auditing this file for Phase 6, not by
  // a report -- the "offers every axes type its own options" e2e test never
  // covered Box Plot, so nothing had caught it.
  options: [
    { key: 'isLog', label: 'Log scale', kind: 'checkbox', default: false },
    { key: 'isRotated', label: 'Horizontal bars', kind: 'checkbox', default: false },
  ],
  extractOptions(axes) {
    return { isLog: String(axes.isLog()), isRotated: String(axes.isRotated()) };
  },
  // Same BarAxes, same v2.0-audit refusal -- see barCalibrationValueCheck.
  checkValues(cal, options) {
    return barCalibrationValueCheck(cal, options);
  },
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
  // P1 and P2 equidistant from the origin -> zero radial scale -> non-finite r.
  radialDistinctGuard: { origin: 'origin', p1: 'p1', p2: 'p2', label: 'radial' },
  // WPD: polar-axes-angular-units / -orientation / -scale.
  options: [
    { key: 'isDegrees', label: 'Angle', kind: 'choice', default: 'true',
      choices: [{ value: 'true', label: 'Degrees' }, { value: 'false', label: 'Radians' }] },
    { key: 'isClockwise', label: 'Direction', kind: 'choice', default: 'false',
      choices: [{ value: 'false', label: 'Anticlockwise' }, { value: 'true', label: 'Clockwise' }] },
    { key: 'isLogR', label: 'Log radial', kind: 'checkbox', default: false },
  ],
  fixedSteps: [
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
  // ⚑ Declared, not performed in buildAxes -- so a LOADED file meets the same
  // refusal a click does (v2.0 pre-launch audit; same reasoning as Bar/CCR's
  // own checkValues). theta2 is deliberately NOT checked -- it's optional and
  // core/axes/polar.ts never reads it (see the class's own _theta2r comment).
  checkValues(cal) {
    const ip = new InputParser();
    const r1 = ip.parse(cal.getPoint(1)?.dx ?? null);
    if (!ip.isValid || ip.isDate || typeof r1 !== 'number') {
      return 'P1’s r value must be a number.';
    }
    const theta1 = ip.parse(cal.getPoint(1)?.dy ?? null);
    if (!ip.isValid || ip.isDate || typeof theta1 !== 'number') {
      return 'P1’s θ value must be a number.';
    }
    const r2 = ip.parse(cal.getPoint(2)?.dx ?? null);
    if (!ip.isValid || ip.isDate || typeof r2 !== 'number') {
      return 'P2’s r value must be a number.';
    }
    return null;
  },
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
  fixedSteps: [
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
  fixedSteps: [
    { key: 'p1', label: 'P1', color: '#e0a458', prompt: 'Click one end of a reference line of known real-world length', valueFields: [] },
    {
      key: 'p2',
      label: 'P2',
      color: '#5fb4e0',
      prompt: 'Click the other end of the reference line',
      valueFields: [{ key: 'scaleLength', label: 'length', field: 'dx' }],
    },
  ],
  /**
   * The reference line's real-world length must be a POSITIVE number.
   *
   * ⚑ `core/axes/map.ts` now refuses zero, negative and non-numeric lengths
   * itself, so `buildAxes`'s `if (!ok)` finally fires -- but its words are
   * "check the entered data values are valid numbers", and a user who typed 0
   * or -5 typed a perfectly valid number. Telling them to fix what is not
   * broken is a UX defect (tenet 7), so the requirement is stated here instead.
   *
   * Declared on the config, not performed in buildAxes, for the usual reason:
   * a loaded file never calls buildAxes. See BAR_AXES_CONFIG.checkValues.
   */
  checkValues(cal) {
    const raw = String(cal.getPoint(1)?.dx ?? '').trim();
    if (raw === '') return null; // an unfilled field is the step's own business
    const length = parseFloat(raw);
    if (!Number.isFinite(length)) {
      return 'The reference length must be a number — enter the real-world length of the line you drew.';
    }
    if (length <= 0) {
      return 'The reference length must be greater than zero — a scale of zero makes every measurement read 0.';
    }
    return null;
  },
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
  fixedSteps: [
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
  // ⚑ Declared, not performed in buildAxes -- so a LOADED file meets the same
  // refusal a click does (v2.0 pre-launch audit; same reasoning as Bar's own
  // checkValues). plotData.deserialize calls axes.calibrate() directly and
  // never inspects its return value, so a file with an invalid R0/R2 or a
  // blank/malformed Chart Start Time would otherwise open clean while every
  // reading was silently wrong (or, for the blank start time, epoch-relative).
  checkValues(cal, options, globalValues) {
    const ip = new InputParser();
    const t0 = ip.parse(cal.getPoint(0)?.dx ?? null);
    if (!ip.isValid || typeof t0 !== 'number') {
      return 'The first point’s Time value must be a number or a date.';
    }
    const startTime = ip.parse(globalValues['startTime'] ?? '');
    if (!ip.isValid || typeof startTime !== 'number') {
      return 'Chart Start Time must be a number or a date.';
    }
    const r0 = ip.parse(cal.getPoint(0)?.dy ?? null);
    if (!ip.isValid || ip.isDate || typeof r0 !== 'number') {
      return 'The first point’s Value (R0) must be a number.';
    }
    const r2 = ip.parse(cal.getPoint(2)?.dy ?? null);
    if (!ip.isValid || ip.isDate || typeof r2 !== 'number') {
      return 'The third point’s Value (R2) must be a number.';
    }
    return null;
  },
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

/**
 * Spider / radar charts (v1.4) — the first calibration whose LENGTH the figure
 * decides. See core/axes/spider.ts for the model and why it is not Polar.
 *
 * One origin click, then per spoke one click on a known point (which supplies that
 * ray's direction AND its distance in a single measurement) plus that point's value
 * and the axis's printed name. Nothing infers a spoke from its neighbours, so
 * unequal angles and per-axis ranges work by construction — which is exactly what
 * the only prior art, ChartSense (CHI 2017), assumes away.
 *
 * ⚑ ORDER IS GUIDANCE, NOT A RULE. The prompt asks for the next axis CLOCKWISE so
 * the user doesn't lose their place going round, but nothing in the model depends
 * on the order and nothing enforces it — each spoke carries its own measured
 * direction. Enforcing it would be an invisible precondition; omitting the guidance
 * would leave a user counting spokes in their head.
 */
export const SPIDER_AXES_CONFIG: AxesTypeConfig<SpiderAxes> = {
  id: 'spider',
  label: 'Spider / Radar',
  axesKind: 'spider',
  autoExtractKind: 'along-axes',
  dataDim: 1,
  // One measured number per datum. The axis it belongs to is the point GROUP, and
  // the axis's NAME is a property of the calibration, not of each point -- it was
  // transcribed once, when the spoke was placed.
  valueLabels: ['Value'],
  calibrationDimensions: 3,
  // ⚑ ASKED ONCE, STORED PER SPOKE. Origin + one known point is a single
  // (value, distance) pair and a scale needs two, so the centre's value has to be
  // collected -- with 0 preselected, which is a default the user walks past and can
  // change, not an invention. A common centre is the rule in real spider charts
  // (asking per axis would be a question with the same answer N times), but
  // buildAxes below fans this one answer into every spoke's own calibration point,
  // so the FILE keeps one copy per axis and a later per-axis override is a UI
  // change with no migration. The simplification lives in the workflow, not in the
  // record.
  // ⚑ NO globalFields. The centre's value used to be one — collected in a row of
  // its own that appears only once every point is placed. It is now asked exactly
  // where every other value is asked: inline beside the Centre chip, with the same
  // confirm button, at the moment the centre is clicked (David, 2026-07-27). The
  // value still reaches the record per spoke — buildAxes fans it out below — so
  // this is a workflow change with no consequence for the file.
  globalFields: [],
  // One tuple is one closed shape on the chart — the domain word for it. Declared
  // rather than inherited: the shared tuple status line falls back to Box Plot's
  // "box", which is how Histogram's bins once announced themselves as "new box"
  // (checkpoint 66, caught only by driving the real app).
  tupleNoun: 'profile',
  // ⚑ N x 1D, not 1.5D: six independent readings sharing an origin. An empty slot
  // is a state this app produces deliberately (the axis-aware trace leaves a
  // doubtful ray empty), so removing one reading clears one slot -- it does not
  // delete the profile the way removing a member of a BOX deletes the box.
  tupleMembers: 'independent',
  options: [{ key: 'isLogRadial', label: 'Log axes', kind: 'checkbox', default: false }],
  fixedSteps: [
    {
      key: 'origin',
      label: 'Centre',
      color: '#5fb47a',
      prompt: 'Click the centre of the spider chart, then enter the value every axis starts from',
      // Origin + one known point is a single (value, distance) pair and a scale
      // needs two, so the centre's value has to be collected. 0 is prefilled
      // because a common centre of 0 is the rule in real spider charts; it is a
      // default the user walks past and can change, not an invention.
      valueFields: [{ key: 'centre', label: 'Value', field: 'dy', defaultValue: '0' }],
    },
  ],
  repeatingStep: {
    noun: 'axis',
    nounPlural: 'axes',
    hint: 'add one for every axis the chart draws',
    // Three spokes is the fewest that draws a spider, and it is a floor on
    // CALIBRATING rather than on adding -- the add control is visible from the
    // start, so nothing about the shape is hidden.
    min: 3,
    step: {
      key: 'spoke',
      label: 'Axis #',
      color: '#e0a458',
      prompt: 'Click a point of known value on axis # (going clockwise), then name the axis',
      valueFields: [
        { key: 'value', label: 'Value', field: 'dx' },
        // The one thing here that is transcribed rather than measured, and optional
        // for exactly that reason: an axis whose name is illegible in the figure is
        // still a real axis, and a blank name is honest where an invented one is
        // not. core/axes/spider.ts falls back to the positional "Axis N".
        // ⚑ "(optional)" is IN THE LABEL, following Polar's "θ (optional)": the
        // model has always accepted a blank name, but a field labelled just "Name"
        // beside a required value reads as required, and nothing on screen said
        // otherwise. An axis whose name is illegible in the figure is still a real
        // axis, and a blank name is honest where an invented one is not.
        { key: 'name', label: 'Name (optional)', field: 'dz', optional: true, blankValue: '' },
      ],
    },
  },
  buildAxes(cal, ctx) {
    // Fan the once-asked centre value into every spoke's own point (the `dy` slot)
    // BEFORE calibrating, so it is stored per axis rather than once. Point 0 is the
    // origin and deliberately does NOT get a copy: one home for the fact, no way
    // for two copies to disagree.
    // The value entered on the centre click, fanned into every spoke's own point.
    const centre = String(cal.getPoint(0)?.dy ?? '');
    for (let i = 1; i < cal.getCount(); i++) {
      const point = cal.getPoint(i)!;
      cal.setDataAt(i, point.dx as string, centre, point.dz as string);
    }

    const axes = new SpiderAxes();
    const ok = axes.calibrate(cal, optionBool(ctx.options, 'isLogRadial'));
    if (!ok) {
      return {
        error: optionBool(ctx.options, 'isLogRadial')
          ? 'Calibration failed — on log axes every value, the centre included, must be a positive number, and each axis needs a value different from the centre.'
          : 'Calibration failed — check each axis has a numeric value different from the centre value, and that no axis point sits on the centre.',
      };
    }
    axes.setMetadata({ ...axes.getMetadata(), [GRAPH_TYPE_METADATA_KEY]: 'spider' });
    return { axes };
  },
  // One capture slot per spoke, named after it — so a tuple reads
  // "Strength, Weight, Cost" rather than "1, 2, 3", and the multi-series table's
  // row k really IS axis k for every series. That alignment is REAL here (every
  // series has exactly one value per axis), unlike the same side-by-side layout
  // under error bars, where the pairing was derived at read time and never stored.
  slotsFromAxes(axes) {
    return axes.getSpokes().map((_, i) => axes.getSpokeLabel(i));
  },
  extractOptions(axes) {
    return { isLogRadial: String(axes.isLog()) };
  },
};

/** A sector is an INTERVAL, and the model already has a shape for that: a two-slot
 * tuple, exactly as a histogram bin is `['Bin start', 'Bin end']`. Same machinery,
 * nothing invented -- which is also the shape v2.0's bar model generalises. */
export const PIE_SECTOR_SLOTS = ['Sector start', 'Sector end'] as const;

/**
 * Pie / donut / half-pie / gauge (v1.6). The model and its reasoning live in
 * core/axes/pie.ts; this is the capture side.
 *
 * ⚑ THE CALIBRATION IS TINY, and that is the point: two clicks and two transcribed
 * numbers. A pie has no axis to walk, so what turns its shape into values is the
 * TOTAL -- asked once on the rim step, prefilled 100, following the spider's rule that
 * a default the user walks past is not an invention. Leave it and the sectors read as
 * percent; type the total printed in a donut's hole and they read in the figure's own
 * units.
 *
 * ⚑ THE SWEEP IS TRANSCRIBED TOO, never derived from a slice click. Letting the last
 * boundary double as the end of the circumference would mix calibration with data
 * sampling, and breaks outright on a donut where several rings share one frame but own
 * their boundaries (David, 2026-07-29). Transcribing it also means 360 is never a
 * constant, which collapses IBM's four documented variants -- Standard, Standard Half,
 * Donut, Donut Half -- into this one config.
 */
/**
 * How far off the rim a pie boundary click may be and still be tidied onto it, as a
 * fraction of the fitted radius.
 *
 * ⚑ A fraction, not a pixel count, so it means the same thing on a 90px thumbnail and
 * a 900px figure. 8% of the radius is comfortably wider than a hand's aim at the rim
 * and comfortably narrower than a donut's ring thickness, which is the collision this
 * has to avoid: on a donut, a click on an INNER ring is a legitimate reading (angles
 * are scale-invariant, which is why one calibration reads every ring), and pulling it
 * out to the rim would drag the marker off the ink it measured.
 */
export const PIE_RIM_SNAP_FRACTION = 0.08;

export const PIE_AXES_CONFIG: AxesTypeConfig<PieAxes> = {
  id: 'pie',
  label: 'Pie / Donut',
  axesKind: 'pie',
  // No auto-extract yet. Sampling colour around the fitted circle is the obvious
  // mechanism -- the same 1-D scan the spider runs along a spoke -- and it needs the
  // outline to exist first, which is why it waits for this flow rather than racing it.
  autoExtractKind: 'none',
  // One measured number per datum. WHICH slice it belongs to is the tuple's own
  // category name, not a second coordinate -- a pie is 1.5D, exactly like a bar.
  dataDim: 1,
  valueLabels: ['Value'],
  // ⚑ THE TOTAL AND THE SWEEP ARE GLOBAL, not tied to any click -- CCR's mechanism,
  // and for the same reason its chart start time uses it: they are properties of the
  // WHOLE FIGURE that no single point carries. Both prefilled, and a default the user
  // walks past is not an invention (the spider's rule). Leave the total at 100 and the
  // slices read as percentages, which is what a pie is; type the figure's own total --
  // the number printed in a donut's hole -- and they read in its units. Leave the
  // sweep at 360 for a whole circle, or type 180 for a half pie, which is why 360 is
  // never a constant here.
  globalFields: [
    { key: 'total', label: 'Total', defaultValue: '100' },
    { key: 'sweep', label: 'Sweep (degrees)', defaultValue: '360' },
  ],
  defaultSlots: PIE_SECTOR_SLOTS,
  tupleNoun: 'sector',
  // Slices share their boundaries, so each click after the first closes one sector
  // and opens the next -- one click per boundary, not two per slice.
  chainTuples: true,
  // ⚑ THE SLICE'S VALUE IS THE COLUMN, not its two boundaries. Each boundary is an
  // ANGLE, and neither is the number anyone wants: the value lives in the difference.
  // Left as one-column-per-slot the table showed "270" and "61.2" for a slice worth
  // 42 -- found by driving the real app, because every engine test read the pair
  // directly and never asked what the screen said.
  derivedTupleValue: {
    label: 'Value',
    compute(points, axes, ctx) {
      const [start, end] = points;
      if (!start || !end) return null; // a half-captured sector has no value yet
      const apex = ctx.apex ?? undefined; // an exploded slice measures about its own
      const total = axes.getDefaultTotal();
      const value = axes.sectorValue(
        axes.angleAt(start.px, start.py, apex),
        axes.angleAt(end.px, end.py, apex),
        total
      );
      // ⚑ Shown only to the precision ONE PIXEL at the rim can resolve. A 2500-unit
      // donut at 350px is worth ~1.1 units per pixel, so "611.347" claims a thousand
      // times finer than any click -- the same overstatement as the origin point that
      // once printed as 0.00000000000000222045. Derived from the geometry rather than
      // chosen, so a big figure earns more digits and a small one fewer.
      const perPixel = axes.valuePerPixel(total);
      if (!(perPixel > 0)) return value;
      const decimals = Math.min(6, Math.max(0, Math.ceil(-Math.log10(perPixel))));
      const f = 10 ** decimals;
      return Math.round(value * f) / f;
    },
  },
  // A sector IS one object: lose an edge and there is no sector left, unlike the
  // spider's independent slots where one empty ray is a meaningful state.
  tupleMembers: 'object',
  // ⚑ AN EXPLICIT CHOICE, NEVER INFERRED. A tilted or 3D pie is an affine image of
  // the circle, and fitting an arbitrary ellipse to a genuinely circular pie skews
  // every slice at once with nothing on screen looking wrong -- so the app does not
  // decide this, the user does. Moved INTO v1.6 (David) on the evidence: about 12% of
  // real pie figures are drawn in 3D, and a 3D pie's top face is a complete
  // unoccluded ellipse, so it is recoverable rather than refusable.
  options: [{ key: 'isTilted', label: 'Tilted / 3D pie', kind: 'checkbox', default: false }],
  // ⚑ NO fixedSteps AND NO CENTRE STEP. The outline is the whole calibration, and the
  // centre is FITTED from it (David, 2026-07-29). That ordering is not a preference:
  // a donut has no visible centre to click at all -- its boundaries stop at the inner
  // radius -- and PlotDigitizer, the only competitor with a pie mode, tells the user
  // to "approximate the origin", putting an eyeball guess underneath every value.
  // Fitting the rim makes the centre arithmetic instead. The outline points stay
  // ordinary handles, so correcting the fit is the same drag that corrects any other
  // calibration; nothing special (David).
  repeatingStep: {
    noun: 'outline point',
    nounPlural: 'outline points',
    hint: 'three fit a circle, five an ellipse — more the merrier',
    // ⚑ Three define a circle exactly, which is also why three can never disagree:
    // any three points fit perfectly, so a bad click is undetectable. A fourth is
    // genuine redundancy about the FIGURE and produces a residual that means
    // something. Required three, add more where the figure allows -- some pies leave
    // little clean rim to click (labels crowding it, a cropped figure), which is
    // exactly why more is optional rather than demanded (David).
    min: 3,
    step: {
      key: 'outline',
      label: 'Outline #',
      color: '#e0a458',
      prompt: 'Click a point on the outer edge of the pie — three or more, spread around it',
      valueFields: [],
    },
  },
  // ⚑ Declared, not performed in buildAxes -- so a LOADED file meets the same refusal
  // a click does. Written in buildAxes first, and the load-path test caught it
  // immediately: a total of -50 opened clean, every value silently negative.
  checkValues(cal, options, globalValues) {
    // ⚑ An ellipse has five degrees of freedom, so five points are the minimum that
    // can describe one -- and unlike the circle's three, fewer is not "less accurate"
    // but "no answer at all". Refused here rather than in the fit so the message says
    // what to do, and so a LOADED file meets the same refusal a click does.
    if (optionBool(options, 'isTilted') && cal.getCount() < 5) {
      return 'A tilted pie needs at least five outline points — an ellipse cannot be fixed by fewer.';
    }
    const total = parseFloat(String(globalValues['total'] ?? ''));
    const sweep = parseFloat(String(globalValues['sweep'] ?? ''));
    // A sector is a fraction of a whole, so a pie cannot show a negative quantity --
    // IBM documents the same rule for the type, arrived at here independently.
    if (!Number.isFinite(total) || total <= 0) {
      return 'The total must be a positive number (100 reads the slices as percentages).';
    }
    if (!Number.isFinite(sweep) || sweep <= 0 || sweep > 360) {
      return 'The sweep must be between 0 and 360 degrees (360 for a whole circle, 180 for a half pie).';
    }
    return null;
  },
  fixedSteps: [],
  buildAxes(cal, ctx) {
    const total = parseFloat(String(ctx.globalValues['total'] ?? ''));
    const sweep = parseFloat(String(ctx.globalValues['sweep'] ?? ''));
    // The values were already refused by checkValues on whichever entrance got here;
    // this only has to convert them.
    const tilted = optionBool(ctx.options, 'isTilted');
    const axes = new PieAxes();
    if (!axes.calibrate(cal, total, sweep, tilted)) {
      return {
        error: tilted
          ? 'Calibration failed — the outline points must lie on an ellipse. Trace the TOP FACE of a 3D pie, not its outer silhouette.'
          : 'Calibration failed — the outline points must lie on a circle; three collinear points describe none.',
      };
    }
    // ⚑ The total and the sweep have no pixel to ride on, so the axes METADATA is
    // their one home in the file -- core/plotData.ts reads them straight back out.
    // Stored as the strings that were typed, not as re-formatted numbers: the file
    // should say what the user said.
    axes.setMetadata({
      ...axes.getMetadata(),
      [GRAPH_TYPE_METADATA_KEY]: 'pie',
      pieTotal: String(ctx.globalValues['total'] ?? ''),
      pieSweep: String(ctx.globalValues['sweep'] ?? ''),
      // Round-trips the choice, so a tilted pie reopens tilted rather than being
      // silently re-read as a circle -- which would change every value in the file.
      pieTilted: String(tilted),
    });
    return { axes };
  },
  // ⚑ WITHOUT THIS, OPENING A SAVED PIE LOSES ITS TOTAL AND SWEEP. `loadCalibrated`
  // rebuilds globalValues from the axes and falls back to {} when a config declares
  // no extractor -- so the file path would hand back a pie whose total was blank, and
  // checkGuards would refuse a project that had been perfectly good when saved. The
  // click path was unaffected, which is exactly why it needed a load-path test to
  // find it. Reads back the strings buildAxes wrote, so the round trip is byte-for-
  // byte what the user typed.
  extractOptions(axes) {
    const meta = axes.getMetadata() as Record<string, unknown>;
    return { isTilted: String(meta['pieTilted'] ?? 'false') };
  },
  extractGlobalValues(axes) {
    const meta = axes.getMetadata() as Record<string, unknown>;
    return {
      total: String(meta['pieTotal'] ?? '100'),
      sweep: String(meta['pieSweep'] ?? '360'),
    };
  },
};

