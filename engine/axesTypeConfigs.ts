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
import { checkStripGeometry } from '../algorithms/colorBar.js';
import { checkColorScaleValues } from '../algorithms/colorScale.js';

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
  /**
   * The axes' own metadata bag — declared here on exactly the grounds
   * `getAxesLabels` above was: all ten classes have always implemented it
   * (`core/axes/types.ts:17`), it was simply never named as a requirement.
   *
   * ⚑ Naming it matters because part of the RECORD lives here for types whose
   * data has no pixel to ride on — a heatmap's grid, its axis names, and the
   * cells a person read themselves — and `runCalibration` has to carry that
   * across when `buildAxes` hands back a new axes object. Reaching it through a
   * cast would have hidden the requirement in the one place that must not lose
   * it.
   */
  getMetadata(): Record<string, unknown>;
  setMetadata(obj: Record<string, unknown>): void;
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
  /**
   * Hang this handle's label BELOW the reticle instead of above it.
   *
   * ⚑ Declared per step because only the config knows its own crowding. A
   * heatmap's four colour-key clicks all land along one horizontal strip, so
   * four labels at the same fixed up-and-right offset print on top of each
   * other — "Key value 2=120" and "Key end" overlapped into an unreadable smear
   * on the shipped build, found on a screenshot because no test can see a label
   * collide. Staggering the two KINDS of key click also draws the distinction
   * the walk depends on: two clicks say what the ramp is WORTH (above, where the
   * longer labels have room), two say where it IS (below).
   */
  labelBelow?: boolean;
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
/**
 * An option may declare that it only APPLIES while another option is on.
 *
 * ⚑ An option that cannot change anything should not be on screen: the
 * heatmap's tick convention means nothing until the axis is declared
 * categorical, and offering it anyway is both clutter and an invitation to set
 * something with no effect. Same rule as disabling Grid Removal without an
 * image — do not present a control whose outcome is already decided.
 */
export interface AxesOptionVisibility {
  /** Shown only while this other option's checkbox is on. */
  onlyWhen?: string;
  /**
   * Which row this option belongs on, as a heading the user reads.
   *
   * ⚑⚑ DECLARED BY THE TYPE, because which options belong together is a fact
   * about the FIGURE, not about the card. A heatmap has three axes and each has
   * the same kind of properties, so one row per axis says so on screen — and
   * `Log X` stops being a loose flag in a row of unrelated checkboxes and
   * becomes a property of the X axis, where it belongs.
   *
   * Ungrouped options keep the single flowing row every other type has today.
   */
  group?: string;
  /**
   * Start this option on a NEW LINE within its group.
   *
   * ⚑ Declared rather than inferred from width, because it is a statement about
   * MEANING: the tick convention belongs to its axis but answers a different
   * question, so it reads as a continuation line under it rather than as more
   * things on the same row. It is also what keeps the row inside the card —
   * David: *"we need to get this to fit on the calibration card width."*
   */
  newRow?: boolean;
}

export type AxesOption =
  | ({ key: string; label: string; kind: 'checkbox'; default: boolean } & AxesOptionVisibility)
  | ({
      key: string;
      label: string;
      kind: 'choice';
      choices: readonly { value: string; label: string }[];
      default: string;
    } & AxesOptionVisibility)
  | ({ key: string; label: string; kind: 'text'; default: string; placeholder?: string } & AxesOptionVisibility);

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
  /**
   * An option that DISABLES this guard when set — the axis is not a scale at
   * all under it.
   *
   * ⚑ Added for the heatmap's category axes, and a test is what demanded it: a
   * category axis types no coordinates, so the guard read two blank endpoints
   * and refused the whole calibration the moment "Log X" happened to be ticked.
   * The refusal was correct about the values and wrong about the question —
   * there is no log to take of a counted position, so the guard has nothing to
   * check rather than something to complain about. `buildAxes` drops the log
   * flag for the same reason.
   */
  unless?: string;
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
    if (g.unless !== undefined && optionBool(options, g.unless)) continue;
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
export interface CommonOriginPair {
  /** The already-placed step whose pixel is reused. */
  from: string;
  /** The step that reuses it, on arrival. */
  to: string;
  /** Values prefilled into `to`'s fields, in order — the shared corner's value
   * is known precisely because it is shared. Omit for a step with no value
   * fields, and see `commonOriginReuse`: it is trimmed to the fields the step
   * actually has, because the walk can reshape them. */
  prefill?: readonly string[];
}

/** Every pairing a type declares, however it declared them. */
export function commonOriginPairs(
  config: Pick<AxesTypeConfig<CalibratedAxes>, 'commonOrigin'>
): readonly CommonOriginPair[] {
  const shared = config.commonOrigin;
  if (!shared) return [];
  return Array.isArray(shared) ? shared : [shared as CommonOriginPair];
}

export function commonOriginReuse(
  config: Pick<AxesTypeConfig<CalibratedAxes>, 'commonOrigin' | 'commonOriginAlways'>,
  /** The checkbox. Ignored entirely by a type that declares
   * `commonOriginAlways` — there is no checkbox on those, so there is no state
   * for a caller to have got wrong. */
  enabled: boolean,
  nextStepKey: string | undefined,
  placed: Readonly<Record<string, unknown>>,
  /**
   * The step the pixel is being reused FOR, as the walk currently shapes it.
   *
   * ⚑⚑ THE PREFILL HAS TO FIT THE STEP IT LANDS ON. `commonOrigin` declares
   * "and while you are there, this corner's value is 0" — true for an XY origin,
   * meaningless on a heatmap's CATEGORY edge, which takes no typed value at all.
   * David: *"the common origin does not work when you have a categorial axis."*
   * It was feeding a value to a step with nowhere to put it. Trimmed to the
   * fields the step actually has, so a no-value step shares the pixel and asks
   * for nothing.
   */
  toStep?: Pick<CalibStepInfo, 'valueFields'>
): { from: string; prefill: string[] } | null {
  if (!enabled && config.commonOriginAlways !== true) return null;
  const shared = commonOriginPairs(config).find((pair) => pair.to === nextStepKey);
  if (!shared) return null;
  if (nextStepKey !== shared.to) return null;
  if (!placed[shared.from] || placed[shared.to]) return null;
  const prefill = [...(shared.prefill ?? [])];
  return {
    from: shared.from,
    prefill: toStep === undefined ? prefill : prefill.slice(0, toStep.valueFields.length),
  };
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
   *   (`59f94a6`). Box Plot, categorical Line, Heatmap and Pie.
   *   ⚠️ This list said "Histogram, Box Plot, categorical Line" until v2.3, and
   *   all three parts were wrong: Histogram moved to `'bounding-box'` at v2.0
   *   Phase 7, and Heatmap and Pie were added afterwards without touching the
   *   sentence. A comment enumerating members is a second registry that nothing
   *   checks — hence `autoExtractRefusal` below, which the type declares itself.
   */
  autoExtractKind?: 'curve' | 'along-axes' | 'bounding-box' | 'none';
  /**
   * WHY auto-extract is refused on this type, in the user's words — required
   * whenever `autoExtractKind` is `'none'`, and meaningless otherwise.
   *
   * ⚑⚑ REFUSE WITH THE REQUIREMENT (v2.3). Box Plot and categorical Line each
   * had a sentence explaining themselves; Heatmap and Pie fell through to
   * *"Not available for this graph type"*, which tells the reader nothing they
   * could act on — it names the refusal and withholds the reason, on the two
   * types where the reason is the most interesting thing about them. That
   * cascade lived in `Workspace.tsx` as `config.id === 'boxplot' ? … :
   * config.id === 'categorical' ? … : <generic>`, so a new type joined the
   * generic branch by DEFAULT and nothing anywhere said it had been forgotten.
   *
   * ⚑ Declared beside the refusal it explains, so the two cannot drift, and
   * enforced by a registry test: a type that refuses auto-extract must say why.
   * The v2.2 lesson in one field — the missing half is never the half that
   * throws.
   */
  autoExtractRefusal?: string;
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
   * - `'heatmap'` (v2.2) — a MATRIX: one row per cell carrying its bounds, its
   *   centre and its value, plus the same cells pivoted as a convenience view.
   *   Unlike every shape above it, the rows do not come from the datasets — a
   *   heatmap's cells are read from the image through the grid, so the caller
   *   supplies them (see `ExportAssemblyInput.heatmapCells`).
   *
   * ⚑ Resolve it through `session.getExportShape()`, never by reading this field
   * directly: Box Plot is ALSO reachable as a toggle on a Bar session, so the
   * shape depends on the series as well as the type. That method is the one place
   * that knows.
   */
  exportShape?: 'flat' | 'tuples' | 'bins' | 'heatmap';

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
  /**
   * ⚑⚑ THE SECOND STAGE — what this type reads once its axes are calibrated.
   *
   * David, 2026-08-17: *"It is a two step process. First calibrate the axis,
   * then read the categorical marks based on these axis. The first one should
   * end with a Calibrate button, the second should end with a Read categories
   * or Read cells."*
   *
   * ⚑⚑ IT IS A SHAPE THE CODE ALREADY HAD AND NEVER NAMED, which is exactly why
   * its three instances diverged. `categoryTicks` was a declared capability read
   * in ONE place (`calibrationSession.ts`) and could not drift. The heatmap's
   * grid was `axesTypeId === HEATMAP_AXES_CONFIG.id` followed by **21**
   * `heatmapActive` branches through `Workspace.tsx` — so the newest type became
   * the least declared one, and grew its own fold-out, its own ending and its own
   * folded line. That is the v2.2 audit's own finding (*"a graph type joined a
   * dropdown and joined nothing else"*) recurring one layer up: the registry was
   * fixed, the UI was not.
   *
   * ⚑ So a type DECLARES its second stage or has none, and the card renders from
   * the declaration. A thirteenth type gets the shape by declaring one field
   * instead of by being remembered.
   *
   * ⚑ `ending` is the button's own words because they are not interchangeable:
   * a heatmap reads CELLS through a colour key, a bar chart reads CATEGORIES off
   * an axis. Same shape, different measurement, and the button should say which.
   *
   * Absent = the calibration IS the whole card: XY, polar, ternary, map, CCR,
   * spider, pie, histogram all finish at Calibrate.
   */
  secondStage?: {
    /** What the stage is called on the folded line — "Grid", "Categories". */
    label: string;
    /** The button that ENDS it — "Read cells", "Read categories". */
    ending: string;
  };
  /**
   * Rewrite the walk when an OPTION changes what a step is asking for.
   *
   * ⚑⚑ A heatmap's axes are each independently a CATEGORY or a VALUE, and the
   * two need different questions — not different wording for the same question.
   * A value axis asks "what number is this pixel worth?"; a category axis has no
   * number to give, so asking for one makes the tool demand a coordinate the
   * figure never printed. That is the tool inviting fabricated data, which is
   * tenet 9 broken by the prompt itself.
   *
   * Applied in `CalibrationSession.getSteps()`, the single choke point every
   * read of the step list already goes through, so nothing else has to know.
   */
  stepsForOptions?: (
    steps: readonly CalibStepInfo[],
    options: Readonly<Record<string, string>>
  ) => CalibStepInfo[];
  /**
   * Steps that stand on the SAME PIXEL, so the user places it once.
   *
   * ⚑ One pairing or several. An XY origin shares a single corner (X1 & Y1);
   * a heatmap shares BOTH corners of the plot box, because its two axes span
   * exactly that box — David: *"it should allow both common X or Y"* — which
   * turns four calibration clicks into two on the commonest case there is.
   */
  commonOrigin?: CommonOriginPair | readonly CommonOriginPair[];
  /**
   * The origin is ALWAYS shared for this type, so no checkbox offers it (B12).
   *
   * ⚑⚑ THREE POINTS ARE THE AFFINE MINIMUM. On a heatmap the two axes span
   * exactly one rectangle, so its three corners carry the whole transform —
   * two points can never define one, and four can be placed INCONSISTENTLY,
   * which is what the parallel-axes guard exists for. The checkbox existed to
   * turn four clicks into three; when three is the only sensible walk, the
   * control becomes a way to ask for a WORSE one, and an option nobody should
   * choose is an option that should not be offered.
   *
   * ⚑ NOT for XY: that type genuinely has figures whose axes do not meet, so
   * there the checkbox is a real question and stays.
   */
  commonOriginAlways?: boolean;
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
  /**
   * True when the Geometry panel's readings — arc length, area, curvature —
   * mean anything for this type's points (v2.3).
   *
   * ⚑⚑ THE TWIN OF `supportsCurveFit`, AND IT WAS THE ONE LEFT BEHIND. Curve Fit
   * and Geometry are the same pair of inline panels, introduced together at
   * checkpoint 27 and described in one sentence in `Workspace.tsx` as *"both
   * XY-axes-only"*. Checkpoint 73 turned Curve Fit's gate into the capability
   * above, for the reason spelled out on `axesKind`: an IDENTITY question
   * ("is this the xy config?") silently excludes the next type on the same
   * class. Geometry kept `config.id === 'xy'` at both its sites. So the
   * mechanism existed, one of the two siblings used it, and the other did not —
   * the REUSE rule's exact shape, with the two halves of one feature sitting
   * four lines apart in the same file.
   *
   * ⚑ Declared on XY ONLY, which preserves today's behaviour exactly. Whether
   * Histogram should also qualify is a REAL question — it is a true `XYAxes`
   * with a working `dataToPixel`, so the overlay would draw — but its group 0
   * is "Bin start", so arc length along bin corners is as meaningless as the
   * fit through them that `supportsCurveFit` refuses. That is David's call, not
   * a silent side-effect of a refactor. The point of the capability is that the
   * question can now be ASKED in one place instead of being buried in an `id`
   * check at each call site.
   */
  supportsGeometry?: boolean;
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
  supportsGeometry: true,
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
    // ⚑⚑ B12 — THE PROMPTS NAME THE FIGURE'S OWN STRUCTURE, not "the corner of
    // the plot box" and never "where the axes meet". Two reasons, and both are
    // figures we have in hand:
    //   · under the CENTRED tick convention an axis's clicks land on band
    //     CENTRES, inset from the box — so the first point is at the first
    //     COLUMN's centre, not at any corner. Naming the two BANDS a point
    //     belongs to is true under either convention, and each axis's own
    //     clause (added by `stepsForOptions`) says whether that means an edge
    //     or a centre.
    //   · on `gplots::heatmap.2` the dendrograms occupy the top and left and
    //     the labels sit right and bottom, so the axes do NOT meet where a
    //     reader expects (B14).
    { key: 'x1', label: 'X1', color: '#e0a458', prompt: 'Click the pixel position of a known X value (e.g. X=0)', valueFields: [{ key: 'x1', label: 'X', field: 'dx' }] },
    { key: 'x2', label: 'X2', color: '#e0a458', prompt: 'Click a second pixel position of a known, different X value', valueFields: [{ key: 'x2', label: 'X', field: 'dx' }] },
    // ⚑ THE SAME CORNER AGAIN, AND IT SAYS SO. The point is already placed —
    // three-point calibration shares it — so this step asks only for the Y value
    // that belongs to it. A step that arrived with no click and no explanation
    // would read as the walk having skipped something.
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
/**
 * Which calibration points a heatmap's colour key occupies, after the four x/y
 * points. Named rather than written as literals because four of the eight
 * indices in this config mean nothing to `XYAxes` and everything to the key —
 * an off-by-one here reads the wrong click as a labelled tick, and every value
 * in the figure would be wrong by a constant nobody could see.
 */
export const HEATMAP_KEY_POINTS = { stripFrom: 4, stripTo: 5, tickA: 6, tickB: 7 } as const;

/**
 * Heatmap (v2.2) — x and y on ordinary axes, and the VALUE on a colour key.
 *
 * ⚑⚑ THE COLOUR BAR IS AN AXIS, WHICH IS WHY THIS TYPE IS MOSTLY DECLARATION.
 * A heatmap's x and y are read from pixel positions exactly as XY's are, so it
 * calibrates `XYAxes` and adds nothing to it — the same call Histogram makes,
 * for the same reason (`axesKind` is the class, `id` is the graph type). What is
 * genuinely new is the third axis: four more clicks that say where the coloured
 * strip runs and what two labelled positions on it are worth. See
 * `algorithms/colorBar.ts` for the inversion and `algorithms/colorScale.ts` for
 * the scale.
 *
 * ⚑ THE STRIP AND THE SCALE ARE TWO SEPARATE MEASUREMENTS, and collapsing them
 * is the mistake this walk exists to prevent. "The key runs from its first pixel
 * to its last, so its ends are the range" is wrong by a measurable amount: the
 * ramp starts where the ink starts, while the printed numbers sit wherever the
 * figure's tick machinery put them. Phase 1's own fixtures made that assumption
 * and it biased every cell of a 160 °C figure by 0.6 °C. So two clicks say where
 * the ramp IS, and two more say what it is WORTH.
 *
 * ⚑ WHY THE VALUE STEPS CARRY NO VALUE FIELDS ON THE STRIP ENDS. A click with
 * nothing to type is not a wasted step — it is the difference between recording
 * where the ink is and inferring it. Polar's origin is the same shape.
 *
 * ⚑ IT IS IN THE GRAPH-TYPE LIST NOW, and the order it was done in is the point.
 * This config shipped one release UNLISTED on purpose, because a type that can
 * calibrate and then do nothing is the failure this project's keystone persona
 * exists to catch. It was listed only once capture existed behind it — a grid of
 * adjustable dividers, the 2D generalisation of v2.1's category ticks. A test
 * asserts the picker's contents, so the gate is a decision rather than a memory.
 */
/**
 * The calibration `XYAxes` is actually given, with a category axis's ORDINAL
 * frame filled in.
 *
 * ⚑⚑ THE USER TYPES A COUNT AND THE TOOL DERIVES THE FRAME. On a category axis
 * the two clicks say where the categories start and end, and the count says how
 * many there are; 0…N then follows. Nobody typed a coordinate, because the
 * figure printed none — which is the whole point. On a value axis nothing is
 * substituted and the calibration passes through untouched.
 *
 * ⚑ A SUBSTITUTED COPY, not a mutated original: the axes carries whatever
 * calibration it is handed into the project file, so the derived frame is what
 * gets saved and a reopened heatmap rebuilds the identical index space. Mutating
 * the session's own calibration would put numbers back in front of the user at
 * steps that deliberately ask for none.
 */
function heatmapIndexFrame(
  cal: Calibration,
  xCategory: boolean,
  yCategory: boolean,
  xCentred = false,
  yCentred = false
): Calibration | string {
  if (!xCategory && !yCategory) return cal;
  const count = (index: number, axis: 'dx' | 'dy' | 'dz'): number => {
    const raw = cal.getPoint(index)?.[axis] ?? '';
    return parseFloat(String(raw));
  };
  const columns = xCategory ? count(1, 'dz') : NaN;
  const rows = yCategory ? count(3, 'dz') : NaN;
  if (xCategory && !(Number.isInteger(columns) && columns >= 1)) {
    return 'Enter how many COLUMNS the figure has — a whole number, counted off the figure (the categories themselves are named later).';
  }
  if (yCategory && !(Number.isInteger(rows) && rows >= 1)) {
    return 'Enter how many ROWS the figure has — a whole number, counted off the figure (the categories themselves are named later).';
  }
  // ⚑⚑ A CENTRED TICK IS HALF A BAND INSIDE THE EDGE, and that is the entire
  // difference between the two conventions. Clicking the first and last band
  // CENTRES of an N-band axis marks 0.5 and N-0.5 in ordinal space; clicking the
  // outer edges marks 0 and N. The axes is scaled from whichever pair was
  // actually clicked, so the figure's own edges still land on 0 and N either
  // way — the user is never asked to point at something the figure does not
  // print. Same relationship `core/categoryAxis.ts` encodes between a centred
  // tick and its band's dividers.
  const span = (count: number, centred: boolean): [string, string] =>
    centred ? [String(0.5), String(count - 0.5)] : ['0', String(count)];
  const [xLo, xHi] = span(columns, xCentred);
  const [yLo, yHi] = span(rows, yCentred);
  const next = new Calibration(cal.getDimensions());
  for (let i = 0; i < cal.getCount(); i++) {
    const p = cal.getPoint(i)!;
    let dx = p.dx ?? '';
    let dy = p.dy ?? '';
    if (xCategory && i === 0) dx = xLo;
    if (xCategory && i === 1) dx = xHi;
    if (yCategory && i === 2) dy = yLo;
    if (yCategory && i === 3) dy = yHi;
    // ⚑⚑ THE THIRD SLOT RIDES ALONG. This rebuild used to copy dx and dy only,
    // which silently dropped every axis's declared BAND COUNT on the way to the
    // axes — bounds arrived intact and the grid came back as one cell, the same
    // symptom as having no count at all. A copy that omits a slot is a copy that
    // will be wrong the moment the model grows one.
    next.addPoint(p.px, p.py, dx, dy, (p as { dz?: number | string }).dz ?? '');
  }
  return next;
}

export const HEATMAP_AXES_CONFIG: AxesTypeConfig<XYAxes> = {
  id: 'heatmap',
  label: 'Heatmap',
  axesKind: 'xy',
  // ⚑ Stage 2: the grid, read through the colour key. Was 21 hardcoded
  // `heatmapActive` branches in Workspace.tsx before it was declared.
  secondStage: { label: 'Grid', ending: 'Read cells' },
  exportShape: 'heatmap',
  dataDim: 2,
  // ⚑ THREE SLOTS, so each axis's second point can carry BOTH its coordinate
  // and its band count. `dz` is a slot, not a Z axis (Spider stores an axis
  // NAME in it) — here it holds how many columns / rows the figure has, which
  // is the one number a person reads straight off a heatmap whichever way its
  // axes are indexed.
  calibrationDimensions: 3,
  valueLabels: ['X', 'Y'],
  globalFields: [],
  autoExtractKind: 'none',
  // ⚑ A cell's value is its COLOUR, and reading colour is what the Read
  // cells walk already does across the whole grid -- so this is not a
  // missing feature but a different button (v2.3).
  autoExtractRefusal:
    'Auto-extract looks for a curve or a blob; a heatmap cell’s value is its colour. Detect or place the grid, then Read cells.',
  options: [
    // ⚑⚑ THE QUESTION THE WHOLE TYPE TURNS ON, and it is asked FIRST because it
    // changes the walk. A heatmap's x and y are each independently a CATEGORY
    // or a VALUE — gene × sample, treatment × time, field × field — and all
    // four combinations are published. Without this the type could only be
    // calibrated as value × value, so a categorical figure forced the user to
    // invent numeric coordinates it never printed: the tool demanding
    // fabricated data, which is tenet 9 broken by the prompt itself.
    // ⚑⚑ RADIOS, VIA THE EXISTING `choice` KIND — not a new option type, and not
    // a checkbox. A checkbox names ONE of two states: unchecked "X is
    // categories" never says the axis IS a value axis, you infer it from
    // absence. For a choice that changes what the walk ASKS YOU TO CLICK, the
    // current state has to be readable rather than inferable — and the default
    // becomes SHOWN and overrulable, which is the distinction tenet 9 already
    // draws between a default and an invention. David: *"radio buttons... so
    // that you can clearly see them, and select only one."*
    //
    // ⚑ The two are INDEPENDENT, one group each. An axis is Values or
    // Categories; but BOTH axes may be Categories — gene × sample, confusion
    // matrices, correlation grids. A single group choosing WHICH axis is
    // categorical would look tidier and would silently delete half the type.
    { key: 'xIsCategory', label: '', group: 'X axis', kind: 'choice', default: 'false',
      choices: [{ value: 'false', label: 'Values' }, { value: 'true', label: 'Categories' }] },
    { key: 'isLogX', label: 'Log', group: 'X axis', kind: 'checkbox', default: false },
    { key: 'yIsCategory', label: '', group: 'Y axis', kind: 'choice', default: 'false',
      choices: [{ value: 'false', label: 'Values' }, { value: 'true', label: 'Categories' }] },
    { key: 'isLogY', label: 'Log', group: 'Y axis', kind: 'checkbox', default: false },
    // ⚑⚑ WHERE THE FIGURE PRINTS ITS TICKS, which decides what the two clicks
    // MEAN. David: *"for some of them, the tick markers actually sit centred in
    // category mode, and the edge of boundaries are in between, right?"* Right,
    // and it is the same `TickConvention` v2.1's category ticks already carry:
    // matplotlib and ggplot print a tick under each category, Excel prints one
    // between them. Asking for the outer EDGE of the first band on a figure that
    // marks only centres is asking the user to eyeball something unprinted —
    // when the thing they can actually see is the tick itself.
    // ⚑⚑ ASKED OF BOTH AXIS KINDS. This was declared `onlyWhen: 'xIsCategory'`,
    // which is the SAME wrong branch that gave a measured axis no grid: a value
    // axis has bands too (case A1), so it has the same question — were the two
    // clicks band CENTRES or band BOUNDARIES? David: *"we want to make it
    // VISUALLY coherent for the user, when they are setting value tick markers
    // also?"*
    // ⚑ IT IS A WRONG READING, NOT A PREFERENCE. Clicking x=0 and x=12 on a
    // seven-column figure puts the boundaries at 0…12 under one convention and
    // at −1…13 under the other; every cell's recorded bounds move and nothing on
    // screen looks wrong. Neither is rare — matplotlib's `imshow` labels cell
    // centres, `pcolormesh` labels boundaries.
    // ⚑ ORDER IS THE LAYOUT inside a group: everything before the first
    // `newRow` shares the axis's own line, so each axis reads "kind, then log"
    // with its tick convention hanging underneath.
    // ⚑ The same shape, so the same control — and it is the question v2.1's
    // category ticks already render as two radios, with the reason written on
    // that control: *"both readings have to be visible without a click, because
    // the user is being asked which one their figure prints."*
    { key: 'xTicksCentred', label: 'ticks at', group: 'X axis', newRow: true, kind: 'choice', default: 'false',
      choices: [{ value: 'false', label: 'Boundaries' }, { value: 'true', label: 'Centres' }] },
    { key: 'yTicksCentred', label: 'ticks at', group: 'Y axis', newRow: true, kind: 'choice', default: 'false',
      choices: [{ value: 'false', label: 'Boundaries' }, { value: 'true', label: 'Centres' }] },
    // ⚑⚑ THE THIRD AXIS GETS ITS OWN ROW, with the word COLOUR on it — David:
    // *"that also captures the word colour on that row, which was what I was
    // after."* A log colour scale is the ordinary log axis, so it reads exactly
    // as the other two do. The row is short today; it is where the key's own
    // Values/Categories goes when a discrete key stops being refused.
    // ⚑⚑ THE THIRD AXIS IS AN AXIS, so it is asked the same question as the
    // other two. A discrete key — significance bands, cluster IDs, land cover,
    // oncoprint mutation types — maps a colour to a LABEL rather than a number,
    // and those figures exist in quantity. v2.2 REFUSES them, but the refusal
    // now comes from a declared axis kind the user can see and choose, not from
    // a branch buried in the sampler. Nothing here is unreachable: picking
    // Categories is a real state that produces a real refusal, naming what it
    // would cost.
    { key: 'keyIsCategory', label: '', group: 'Colour key', kind: 'choice', default: 'false',
      choices: [{ value: 'false', label: 'Values' }, { value: 'true', label: 'Categories' }] },
    { key: 'isLogValue', label: 'Log', group: 'Colour key', kind: 'checkbox', default: false },
    { key: 'skipRotation', label: 'Skip rotation', kind: 'checkbox', default: false },
  ],
  /**
   * A category axis asks for its EDGES and a COUNT, never for coordinates.
   *
   * ⚑ The first edge takes NO typed value at all — the same shape as the colour
   * key's strip ends, and for the same reason: a click with nothing to type is
   * the difference between recording where the ink is and inferring it. The
   * second edge carries the one number a person can actually read off the
   * figure, which is HOW MANY categories there are. Everything else about the
   * axis follows from those two clicks, exactly as v2.1's category ticks do.
   *
   * ⚑ The count is a DECLARATION, not a measurement — the user counts what the
   * figure prints. The index positions it implies (0…N) are ordinals, not
   * lengths, and the export says which axes are categorical so nobody reads
   * them as millimetres.
   */
  stepsForOptions(steps, options) {
    /**
     * What ONE axis makes visible at one end of itself.
     *
     * ⚑⚑ ONE CLAUSE PER AXIS, and the prompts are built by joining two of them.
     * The four frame steps are the three corners of the rectangle the two axes
     * describe, so EVERY one of them is located by BOTH axes at once — and
     * three-point calibration shares the first pixel, which makes the vertical
     * position of the "x" click part of the Y calibration. A prompt that named
     * one axis only ("Click the outer edge of the FIRST column") left the other
     * half of the click to be guessed.
     *
     * ⚑ It also removes the kind/convention branching that used to rewrite a
     * whole step: an axis is CATEGORY or VALUE and marks BOUNDARIES or CENTRES,
     * independently of the other axis, and all four combinations are published.
     * Only a clause built per axis can say the mixed ones.
     */
    const clause = (axis: 'x' | 'y', end: 'first' | 'last'): string => {
      const noun = axis === 'x' ? 'column' : 'row';
      const which = end === 'first' ? 'FIRST' : 'LAST';
      const centred = optionBool(options, axis === 'x' ? 'xTicksCentred' : 'yTicksCentred');
      // ⚑ Asked of BOTH axis kinds. A value axis has bands too (case A1), so it
      // has the same question — were the two clicks band CENTRES or band
      // BOUNDARIES? Clicking x=0 and x=12 on a seven-column figure puts the
      // boundaries at 0…12 under one reading and −1…13 under the other; every
      // cell's bounds move and nothing on screen looks wrong.
      // ⚑ BOTH halves are emphasised, because both are reading-critical and they
      // are different questions: WHICH band (which corner am I at) and WHERE on
      // it (edge or centre — a wrong answer moves every recorded boundary by
      // half a band, with nothing on screen looking wrong afterwards).
      return centred
        ? `the CENTRE of the ${which} ${noun}`
        : `the outer EDGE of the ${which} ${noun}`;
    };
    /** The value half of a prompt: what, if anything, is typed at this corner. */
    const asks = (axis: 'x' | 'y', end: 'first' | 'last'): string => {
      const categorical = optionBool(options, axis === 'x' ? 'xIsCategory' : 'yIsCategory');
      const countNoun = axis === 'x' ? 'COLUMNS' : 'ROWS';
      const coord = axis.toUpperCase();
      if (end === 'first') {
        // ⚑ A category edge takes NO typed value at all — the same shape as the
        // colour key's strip ends, and for the same reason: a click with nothing
        // to type is the difference between recording where the ink is and
        // inferring it.
        return categorical ? '' : `, and enter the ${coord} value there`;
      }
      return categorical
        ? `, then enter how many ${countNoun} the figure has`
        : `, then enter its ${coord} value and how many ${countNoun} the figure has`;
    };
    const corner = (step: CalibStepInfo, x: 'first' | 'last', y: 'first' | 'last'): CalibStepInfo => {
      const axis: 'x' | 'y' = step.key.startsWith('x') ? 'x' : 'y';
      const end: 'first' | 'last' = step.key.endsWith('2') ? 'last' : 'first';
      const label = `${x === 'first' ? 'First' : 'Last'} column × ${y === 'first' ? 'first' : 'last'} row`;
      const categorical = optionBool(options, axis === 'x' ? 'xIsCategory' : 'yIsCategory');
      return {
        ...step,
        // ⚑ The shared corner keeps its own label so the walk does not appear to
        // ask for the same place twice without saying why.
        label: step.key === 'y1' ? `${label} (Y)` : label,
        prompt:
          step.key === 'y1'
            ? `The same corner again — enter the Y value where ${clause('x', 'first')} meets ${clause('y', 'first')}`
            : `Click where ${clause('x', x)} meets ${clause('y', y)}${asks(axis, end)}`,
        valueFields: categorical
          ? end === 'first'
            ? []
            : [{ key: `${step.key}n`, label: axis === 'x' ? 'Columns' : 'Rows', field: 'dz' as const }]
          : step.valueFields,
      };
    };
    // ⚑⚑ A LOG KEY IS CALIBRATED FROM PRINTED TICKS, NOT FROM THE STRIP'S ENDS,
    // and the prompt has to say so before the click rather than after it. The
    // ends of a colour ramp usually carry no printed number — on the weld
    // sample the strip runs 60…780 while the ticks read 100…700 — so clicking
    // an end and typing what looks like the start of the scale is the natural
    // move. On a LINEAR key beginning at 0 it is often even right. On a log key
    // it can never be: the scale never reaches zero. David hit exactly that.
    const logKey = (step: CalibStepInfo): CalibStepInfo => ({
      ...step,
      prompt:
        step.key === 'kv1'
          ? 'Click a LABELLED tick on the colour key — e.g. 10¹ — and enter the number printed there. A log key never reaches zero, so the strip’s ends usually carry no usable number.'
          : 'Click a SECOND labelled tick on the colour key and enter its number. Both must be positive: a log scale cannot pass through zero.',
    });
    // ⚑⚑ THE THREE CORNERS, NAMED ONCE. x1 and y1 are the SAME pixel (B12's
    // shared origin), which is why both read "first column × first row".
    const CORNERS: Record<string, ['first' | 'last', 'first' | 'last']> = {
      x1: ['first', 'first'],
      x2: ['last', 'first'],
      y1: ['first', 'first'],
      y2: ['first', 'last'],
    };
    return steps.map((step) => {
      const at = CORNERS[step.key];
      if (at) return corner(step, at[0], at[1]);
      if (optionBool(options, 'isLogValue') && (step.key === 'kv1' || step.key === 'kv2')) {
        return logKey(step);
      }
      return step;
    });
  },
  // ⚑⚑ ONE SHARED CORNER, NOT TWO — AND THE SECOND ONE WAS GEOMETRICALLY
  // IMPOSSIBLE. v2.2 declared `[XY_COMMON_ORIGIN, { from: 'x2', to: 'y2' }]` on
  // the reasoning that a heatmap's axes span exactly the plot box, so its two
  // opposite corners carry all four x/y points. They cannot. Sharing BOTH pairs
  // leaves the calibration with TWO distinct pixels, and two points cannot
  // define a 2-D transform: the Y axis vector becomes identical to the X axis
  // vector, so the axes are parallel by construction and `checkValues` refuses
  // the whole calibration — at whatever corners the user clicks.
  //
  // ⚑ David saw it from the other side on day one: *"the text for shared origin
  // is misleading or incorrect"* and *"we are missing a data point out."* A data
  // point IS missing. The diagnosis that the prompts merely failed to say
  // "click the opposite corner" was wrong — the opposite corner fails too.
  //
  // ⚑⚑ AND BOTH TESTS THAT "VERIFIED" IT STOPPED AT 4/8 AND ASSERTED THE WALK
  // HAD MOVED ON. Neither ever called `runCalibration`, so they proved the walk
  // advanced and nothing about whether the result could be used. A walk that
  // reaches the end of a calibration nobody can complete is not a feature.
  //
  // The ORIGIN pairing stays: x1 = y1 leaves three distinct pixels, which is the
  // long-standing shared-origin case every XY chart has had.
  commonOrigin: XY_COMMON_ORIGIN,
  // ⚑⚑ B12 — AND IT IS NO LONGER A CHECKBOX. Three points are the affine
  // minimum, so on a heatmap they are simply THE WALK: the checkbox could only
  // ever be used to ask for a fourth click that adds nothing and can disagree
  // with the other three. David: *"Why not?"* to doing this in v2.2 — and it is
  // cheapest now, because after release every stored heatmap carries a walk that
  // no longer exists.
  // ⚠️ THE PARALLEL-AXES GUARD BELOW STAYS. Three points cannot be
  // INCONSISTENT, but they CAN BE COLLINEAR — click the three "corners" along
  // one line and the x vector and the y vector point the same way, so there is
  // no 2-D transform. That is the last degeneracy three points still allow, and
  // the plan's claim that this trigger could be removed was wrong.
  commonOriginAlways: true,
  logScaleGuards: [
    { option: 'isLogX', points: [0, 1], field: 'dx', label: 'X', unless: 'xIsCategory' },
    { option: 'isLogY', points: [2, 3], field: 'dy', label: 'Y', unless: 'yIsCategory' },
  ],
  distinctPixelSteps: [
    ['x1', 'x2'],
    ['y1', 'y2'],
    // The key's two ends are a line, so they may not be the same pixel either —
    // and `checkValues` below adds the stronger requirement that they be far
    // enough apart to sample at all.
    ['k1', 'k2'],
  ],
  parallelAxisGuard: { v1: ['x1', 'x2'], v2: ['y1', 'y2'], label: 'X and Y' },
  // ⚑⚑ SHORT LABELS, LONG PROMPTS — and they are two different jobs at two
  // different sites. The LABEL is drawn on the canvas beside its marker; the
  // PROMPT is a line of text on the calibration card. B12 replaced `X1`/`Y1`
  // with `First column × first row`, and David's screenshot of the built app
  // shows the result: the label runs across the plot and collides with the
  // figure, the top-left one is clipped behind the calibration card, and the
  // bottom-right reads `Last column × fi…`.
  // ⚑ THE LESSON: the PROMPT had to name both bands, because a click on a
  // matrix is located by BOTH axes and the old category prompt named only one.
  // The LABEL did not, and both were changed together.
  // ⚑ `C1`/`R1` rather than back to `X1`/`Y1`: they are just as short and they
  // MIRROR the results matrix, whose column and row headers are literally `C1`
  // and `R1`. The mark on the figure and the header in the table now say the
  // same word for the same band.
  fixedSteps: [
    { key: 'x1', label: 'C1 × R1', color: '#e0a458', prompt: 'Click where the FIRST column meets the FIRST row, and enter the X value there', valueFields: [{ key: 'x1', label: 'X', field: 'dx' }] },
    // ⚑⚑ THE COORDINATE AND THE BAND COUNT, on the same click. A heatmap is a
    // MATRIX however its axes are indexed, so a MEASURED axis has columns
    // exactly as a named one does — David: *"we need to have column and row
    // number markers even if they are not categories."* The count went in `dz`
    // for BOTH kinds rather than `dx` for one and nowhere for the other: `dx`
    // now always means the coordinate or nothing, and the two kinds answer
    // "how many bands" into one slot instead of two.
    { key: 'x2', label: 'Cn × R1', color: '#e0a458', prompt: 'Click where the LAST column meets the FIRST row, then enter its X value and how many COLUMNS the figure has', valueFields: [{ key: 'x2', label: 'X', field: 'dx' }, { key: 'x2n', label: 'Columns', field: 'dz' }] },
    // ⚑ THE SAME CORNER AGAIN, AND IT SAYS SO. The point is already placed —
    // three-point calibration shares it — so this step asks only for the Y value
    // that belongs to it. A step arriving with no click and no explanation would
    // read as the walk having skipped something.
    { key: 'y1', label: 'C1 × R1 (Y)', color: '#5fb4e0', prompt: 'The same corner again — enter the Y value where the FIRST column meets the FIRST row', valueFields: [{ key: 'y1', label: 'Y', field: 'dy' }] },
    { key: 'y2', label: 'C1 × Rn', color: '#5fb4e0', prompt: 'Click where the FIRST column meets the LAST row, then enter its Y value and how many ROWS the figure has', valueFields: [{ key: 'y2', label: 'Y', field: 'dy' }, { key: 'y2n', label: 'Rows', field: 'dz' }] },
    { key: 'k1', label: 'Key corner', color: '#a87fd4', prompt: 'Drag across the colour key from one corner to the opposite one — or click one corner now and the other next', valueFields: [], labelBelow: true },
    { key: 'k2', label: 'Opposite corner', color: '#a87fd4', prompt: 'Click the OPPOSITE corner of the colour key', valueFields: [], labelBelow: true },
    { key: 'kv1', label: 'Key value 1', color: '#d47fa8', prompt: 'Click a labelled tick on the colour key and enter the number printed there', valueFields: [{ key: 'kv1', label: 'Value', field: 'dy' }] },
    { key: 'kv2', label: 'Key value 2', color: '#d47fa8', prompt: 'Click a second labelled tick on the colour key and enter its number', valueFields: [{ key: 'kv2', label: 'Value', field: 'dy' }] },
  ],
  /**
   * ⚑ The half of the colour key that can be checked WITHOUT the image, checked
   * here so it fires on both entrances — the click path and a loaded file. The
   * other half (is there actually a ramp along that line?) needs pixels and is
   * refused by `sampleColorBar` when the strip is read, which the load path
   * reaches too because a project file stores the key's GEOMETRY and re-samples
   * rather than storing a copy of the colours.
   */
  checkValues(cal, options) {
    // ⚑ The category COUNT, checked on the interactive path as well as in
    // `buildAxes` — the same rule at both entrances. A count of 0, 2.5 or "many"
    // would otherwise reach the axes as a frame width and produce a grid with a
    // fractional number of bands.
    const countProblem = (index: number, noun: string): string | null => {
      const raw = String((cal.getPoint(index) as { dz?: unknown } | null)?.dz ?? '');
      if (raw.trim() === '') return null; // still typing; the walk says what is missing
      const n = parseFloat(raw);
      return Number.isInteger(n) && n >= 1
        ? null
        : `The number of ${noun} must be a whole number, 1 or more — count them off the figure. Their names are typed later, in the Heatmap card.`;
    };
    // ⚑⚑ CHECKED FOR BOTH AXIS KINDS, from one slot. A measured axis declares
    // how many columns the figure has exactly as a named one does — a heatmap
    // is a matrix either way — so the rule cannot be gated on `xIsCategory`.
    // Gating it there is the same mistake that left a value axis with no grid.
    for (const [index, noun] of [[1, 'columns'], [3, 'rows']] as const) {
      const problem = countProblem(index, noun);
      if (problem) return problem;
    }
    // ⚑ A CENTRED CLICK NEEDS A BAND TO BE THE CENTRE OF, and two of them need
    // two bands. With one band the two clicks are the same centre, so the half-
    // band the grid extends by is (hi - lo) / 0 — an infinite plot box reported
    // as a successful calibration.
    for (const [index, noun, option] of [
      [1, 'columns', 'xTicksCentred'],
      [3, 'rows', 'yTicksCentred'],
    ] as const) {
      if (!optionBool(options, option)) continue;
      const raw = String((cal.getPoint(index) as { dz?: unknown } | null)?.dz ?? '');
      if (raw.trim() === '') continue;
      const n = parseFloat(raw);
      if (Number.isInteger(n) && n < 2) {
        return `Ticks at band centres need at least two ${noun} — with one, both clicks would be the same centre. Click the outer edges instead, or say how many ${noun} the figure really has.`;
      }
    }
    if (optionBool(options, 'keyIsCategory')) {
      return 'A colour key drawn as discrete bands identifies a BAND — a range — not a value, and PlotTracer will not report a number the figure does not contain. v2.2 reads continuous ramps only: read these cells against the key by eye, or set the colour key back to Values if its ramp is continuous.';
    }
    const from = cal.getPoint(HEATMAP_KEY_POINTS.stripFrom);
    const to = cal.getPoint(HEATMAP_KEY_POINTS.stripTo);
    if (
      from !== null &&
      to !== null &&
      checkStripGeometry({ x: from.px, y: from.py }, { x: to.px, y: to.py }) !== null
    ) {
      return 'The colour key’s two ends are too close together to read a ramp between them — click where the coloured strip begins and where it ends, along its length, not across its width.';
    }
    // Only once BOTH numbers are in, matching every other config's value check:
    // a half-filled step is an unfinished calibration, and the walk already says
    // so far better than a refusal would.
    const a = parseFloat(String(cal.getPoint(HEATMAP_KEY_POINTS.tickA)?.dy ?? ''));
    const b = parseFloat(String(cal.getPoint(HEATMAP_KEY_POINTS.tickB)?.dy ?? ''));
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    switch (checkColorScaleValues(a, b, optionBool(options, 'isLogValue'))) {
      case 'ticks-equal-value':
        return 'The colour key’s two labelled ticks have the same value — they must differ, or the key has no scale and every cell in the figure reads the same number.';
      case 'log-needs-positive':
        return 'A log colour scale cannot pass through zero or go negative — enter positive values (e.g. 1 and 100).';
      default:
        return null;
    }
  },
  buildAxes(cal, ctx) {
    // The x/y frame is the FIRST FOUR points and only those — `XYAxes`'s own
    // maths reads them by index and never looks further.
    for (let i = 0; i < 4; i++) {
      if (cal.getPoint(i) === null) {
        return { error: 'Calibration is incomplete — place all four X and Y points.' };
      }
    }
    const xCategory = optionBool(ctx.options, 'xIsCategory');
    const yCategory = optionBool(ctx.options, 'yIsCategory');
    const xCentred = optionBool(ctx.options, 'xTicksCentred');
    const yCentred = optionBool(ctx.options, 'yTicksCentred');
    const frame = heatmapIndexFrame(cal, xCategory, yCategory, xCentred, yCentred);
    if (typeof frame === 'string') return { error: frame };
    const axes = new XYAxes();
    // ⚑⚑ THE WHOLE EIGHT-POINT CALIBRATION GOES IN, not a four-point copy of
    // its frame, and that is what makes the colour key SURVIVE A SAVE. An axes
    // instance carries its own `calibration` into the project file, and
    // `loadCalibrated` rebuilds the placed points from it BY STEP INDEX — so
    // handing the axes only the frame means the key's four clicks are written
    // nowhere, and a reopened heatmap has a calibration it cannot read a single
    // cell through. The first version here did exactly that.
    const ok = axes.calibrate(
      frame,
      // ⚑ A category axis is never logarithmic: index space has no decades in
      // it, and honouring the option here would take the log of an ordinal.
      !xCategory && optionBool(ctx.options, 'isLogX'),
      !yCategory && optionBool(ctx.options, 'isLogY'),
      optionBool(ctx.options, 'skipRotation')
    );
    if (!ok) return { error: 'Calibration failed — check the entered data values are valid numbers.' };
    // ⚑⚑ WITHOUT THE GRAPH-TYPE STAMP A SAVED HEATMAP REOPENS AS AN XY CHART —
    // its cells gone, its key clicks read as stray axis points. Every type that
    // shares an axes class with another must say which one it is (Histogram,
    // categorical Line, Box Plot and Spider all do); this one shares `XYAxes`
    // and did not.
    //
    // ⚑ And `isLogValue` rides with it, for the reason pie's total and sweep do:
    // the colour key is not part of `XYAxes`, so it has no pixel to ride on and
    // the axes METADATA is its one home in the file. Without it a reopened
    // project reads every cell off a linear key it was never calibrated with.
    axes.setMetadata({
      ...axes.getMetadata(),
      [GRAPH_TYPE_METADATA_KEY]: 'heatmap',
      heatmapLogValue: String(optionBool(ctx.options, 'isLogValue')),
      // ⚑⚑ WHICH AXES ARE ORDINALS. Without this a reopened project cannot tell
      // a category axis from a value axis — its coordinates are 0,1,2… either
      // way — so the export would present counted positions as measured ones
      // and the walk would come back asking for coordinates again.
      heatmapXKind: xCategory ? 'category' : 'value',
      heatmapYKind: yCategory ? 'category' : 'value',
      // ⚑ The convention rides with the kind, because the grid's EXTENT cannot be
      // read back from the calibration without it: 0.5…4.5 is five bands under
      // one convention and four under the other.
      heatmapXTicks: xCentred ? 'centred' : 'edge',
      heatmapYTicks: yCentred ? 'centred' : 'edge',
    });
    return { axes };
  },
  /**
   * ⚑ `isLogValue` comes back out of the axes METADATA, where `buildAxes` put
   * it — the same round trip pie's tilt makes, and for the same reason. Without
   * it a reopened project would silently revert to a linear colour key and
   * change every value in the figure.
   */
  extractOptions(axes) {
    const meta = axes.getMetadata() as Record<string, unknown>;
    return {
      isLogX: String(axes.isLogX()),
      isLogY: String(axes.isLogY()),
      skipRotation: String(axes.noRotation()),
      isLogValue: String(meta['heatmapLogValue'] ?? 'false'),
      xIsCategory: String(meta['heatmapXKind'] === 'category'),
      yIsCategory: String(meta['heatmapYKind'] === 'category'),
      xTicksCentred: String(meta['heatmapXTicks'] === 'centred'),
      yTicksCentred: String(meta['heatmapYTicks'] === 'centred'),
    };
  },
};

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
  // ⚑ Stage 2: the category ticks this type marks after its value axis
  // is calibrated — the same shape the heatmap's grid has.
  secondStage: { label: 'Categories', ending: 'Read categories' },
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
  autoExtractRefusal:
    'Auto-extract has nothing to trace here — each category is one click, not a curve or a blob. Place points by hand.',
  dataDim: 1,
  valueLabels: ['Value'],
  globalFields: [],
  logScaleGuards: [{ option: 'isLog', points: [0, 1], field: 'dy', label: 'value' }],
  distinctPixelSteps: [['v1', 'v2']],
  // ⚑ NO `categoryTicks` yet, deliberately. This type's X genuinely is
  // categorical, so it wants them -- but its points are captured ungrouped and
  // carry a per-point NAME (`metadata.label`), not a `categoryIndex`, so a
  // declared band has nothing to write to and nothing to read from. Declaring
  // the capability now would put a control on screen that does nothing, which
  // is worse than not having it. When the per-point path moves to a category
  // index, the seed step here is `v1`, not `p1` -- which is exactly why
  // `categoryTicks.originStep` is declared rather than written as a literal.
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
  autoExtractRefusal:
    'Auto-extract can’t find a box’s five values from its colour — place its Min/Q1/Median/Q3/Max points by hand.',
  dataDim: 1,
  valueLabels: ['value'],
  globalFields: [],
  defaultSlots: BOX_PLOT_SLOTS,
  // Shares Bar's fixedSteps (below), so the same seed step.
  categoryTicks: { originStep: 'p1' },
  // ⚑ Stage 2: the category ticks this type marks after its value axis
  // is calibrated — the same shape the heatmap's grid has.
  secondStage: { label: 'Categories', ending: 'Read categories' },
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
  // ⚑ The slice's reading is its two BOUNDARIES, not its fill: a filled
  // wedge's centroid is not a datum, which is the same correctness gate
  // the bar model made (v2.3).
  autoExtractRefusal:
    'Auto-extract finds a filled shape’s middle; a slice is measured by its two edges. Click each boundary in turn.',
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

/**
 * ⚑⚑ EVERY GRAPH TYPE THERE IS — the one place a new type joins the app.
 *
 * ⚠️⚠️ IT USED TO LIVE IN `ui/src/Workspace.tsx`, PRIVATE, as the Graph-type
 * dropdown's ordering. That is the reason the same defect kept arriving on every
 * new type: **a type joined a UI picker list and joined NOTHING ELSE.** No test
 * could iterate it, so every cross-type check hand-listed its types — and a
 * hand-maintained list does not grow when you add a type. Even the Tenet-11
 * generation audit "across all twelve types" was a manual sweep; it would not
 * have noticed a thirteenth.
 *
 * David, 2026-08-16, after I re-derived "a heatmap always has a numeric scale"
 * in the very file whose header condemns it: *"I do NOT want to come back to
 * this problem for the next chart type, i.e. bubble graphs."* The way not to is
 * to make membership AUTOMATIC — so this is exported, and the invariants that
 * must hold for every type iterate it.
 *
 * ▶ THE ACCEPTANCE TEST FOR THAT CLAIM: adding a new config here should turn the
 * board RED until its axis kinds and its export are handled. If a type can be
 * added and everything stays green, the class is still open.
 *
 * ⚑ The ORDER is the picker's, and the comments below are about that — what a
 * reader scanning for "mine looks like this" expects to find next to what.
 * ⚑ `everyGraphType.test.ts` asserts this list against the module's OWN exports,
 * so a config that exists but is not registered is a failure rather than an
 * invisible omission — the same move `ADDS_POINT_ON_CLICK` makes for the click
 * router, one level up.
 */
// ⚑ Typed explicitly as AxesTypeConfig<CalibratedAxes>[] (not inferred via
// `as const`) so `.find()` returns a single covariant type instead of a union of
// each config's own axes type -- see CalibratedAxes's doc comment in
// engine/calibrationSession.ts for why that covariance holds.
export const ALL_AXES_TYPE_CONFIGS: readonly AxesTypeConfig<CalibratedAxes>[] = [
  XY_AXES_CONFIG,
  // Sits next to XY because it *is* XY underneath (checkpoint 66) -- and
  // directly above Bar because that adjacency is the point: a histogram looks
  // like bars, so Bar is the tempting pick, but BarAxes yields a typed label
  // plus one magnitude and no numeric x, silently losing the axis that makes a
  // histogram a histogram. Offering the right entry by name is what stops that
  // choice being a trap.
  HISTOGRAM_AXES_CONFIG,
  // Error bars are rail tool 6, not a graph type (checkpoint 79): you trace a
  // curve and THEN add error to it. As a graph type the choice came *before* you
  // started -- trace an XY curve, then want error, and you started over -- the
  // first of the four problems docs/error-bars-design.md lists against the tuple
  // model. The retired config was deleted outright in v1.5; see that commit.
  BAR_AXES_CONFIG,
  // Categorical-X line/scatter (checkpoint 101): BarAxes underneath (value-only
  // calibration = "X is not numeric"), captured as points. Sits by Bar because
  // it shares Bar's calibration; differs in that it plots points, not bars.
  CATEGORICAL_LINE_CONFIG,
  // Box Plot as a first-class type (checkpoint 107). BarAxes underneath, like
  // the two above, and grouped with them for that reason. Was a hidden "Box Plot
  // Groups" toggle on Bar (checkpoints 21-23) -- invisible to a first-time user,
  // which CLAUDE.md flags as a keystone failure; promoting it to a named entry is
  // correctness, not polish. Datasets auto-carry the Min/Q1/Median/Q3/Max groups.
  BOX_PLOT_AXES_CONFIG,
  // Heatmap (v2.2), closing the rectangular group rather than joining the bar
  // family. The picker answers "what does my figure look like?", and a heatmap
  // looks like neither a bar chart nor a scatter -- it is a grid of coloured
  // cells. What it shares with everything above it is the FRAME: two ordinary
  // axes at right angles, which is what it calibrates. So it sits last among
  // the rectangular charts and first before the radial ones, which is exactly
  // where a reader scanning for "mine has a colour key" stops looking.
  HEATMAP_AXES_CONFIG,
  POLAR_AXES_CONFIG,
  // Spider/radar (v1.4). Sits beside Polar because both are read outwards from a
  // shared centre, and differs in the way that matters: Polar has ONE radial scale
  // and a continuously measured angle, while a spider has N independent 1-D axes
  // and no angle at all. Grouping them makes that the visible question at the
  // moment of choosing -- the same job the Histogram/Bar adjacency does above.
  SPIDER_AXES_CONFIG,
  // Pie / donut (v1.6). Completes the radial group, and belongs here rather than
  // beside Bar even though its RECORD is bar-shaped -- a category plus one
  // magnitude. Someone arriving with a pie is looking for a circle, not thinking
  // about what the record turns out to be; the dropdown answers "what does my
  // figure look like?", which is why Histogram sits by Bar and Spider by Polar.
  PIE_AXES_CONFIG,
  TERNARY_AXES_CONFIG,
  MAP_AXES_CONFIG,
  CIRCULAR_CHART_RECORDER_AXES_CONFIG,
];
