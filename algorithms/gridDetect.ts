/**
 * Finding a heatmap's cell boundaries in the ink (v2.2, phase 3).
 *
 * ⚑ AN ASSIST. IT PROPOSES; IT NEVER SWEEPS. This returns candidate boundaries
 * WITH the evidence for each one, and the user accepts, moves or ignores them.
 * That is the rule the bar work arrived at the hard way - every unconditional
 * image technique measured on real figures FAILED, and every gated one worked -
 * and a grid is the best possible case for it, because a wrong divider is
 * visible on screen the instant it is drawn. Nothing here decides anything.
 *
 * ⚑ WHAT A BOUNDARY IS, MEASURED RATHER THAN ASSUMED: a position where the
 * colour changes, consistently, all the way ACROSS the figure. That covers both
 * of the ways a figure draws one - a printed white rule and a bare colour
 * discontinuity - without needing to know which it is looking at, and it is why
 * the scan runs the full height of the plot box rather than sniffing for lines:
 * a change that only happens in part of a column is data, not a boundary.
 *
 * ⚑ A DRAWN RULE PRODUCES TWO CHANGES, one at each of its edges, and a naive
 * peak finder reports a 2px-wide border as two boundaries 2px apart. Peaks
 * within a few pixels are merged and the boundary placed at their weighted
 * centre - which is the middle of the rule, where the boundary actually is.
 *
 * ⚑ THE COUNT IS A CHECK, NEVER A TARGET. A caller that knows how many columns
 * the figure has can compare it against what was found and REPORT A MISS. What
 * it must never do is relax the threshold until the count comes out right: that
 * is approach C from the bar work, which won its metric by erasing short bars -
 * a visible failure traded for an invisible one.
 *
 * Pure: bytes in, positions out. No axes, no DOM.
 */

import { colorDistance, type Point2D } from './colorBar.js';
import type { RGB } from './colorFilter.js';

/**
 * The plot box, as four corners in image pixels, in the order
 * `[origin, alongX, alongY, opposite]` - i.e. the projections of
 * (xMin,yMin), (xMax,yMin), (xMin,yMax), (xMax,yMax). Four rather than two
 * because a scanned figure is rotated, and its columns are not the image's.
 */
export type PlotBox = readonly [Point2D, Point2D, Point2D, Point2D];

export interface DetectDividersOptions {
  /** How many lines to sample across the figure at each position. */
  crossSamples?: number;
  /** Peaks closer together than this (in positions along the axis) are one
   * boundary - a drawn rule's two edges. */
  mergeWithin?: number;
  /**
   * How big a colour change counts as a boundary, in RGB units.
   *
   * ⚑ Twice the noise floor, and it is a FLOOR rather than a tuning knob: below
   * it the change is indistinguishable from 8-bit rounding, so a boundary there
   * is not something we found, it is something we would be inventing. Two
   * adjacent cells whose values are nearly equal have a genuinely invisible
   * boundary, and the honest response is to miss it and let the user place it.
   */
  minStrength?: number;
}

const DEFAULT_CROSS_SAMPLES = 24;
const DEFAULT_MIN_STRENGTH = 8;
/**
 * How wide a drawn rule may be before its two edges stop being one boundary,
 * in pixels.
 *
 * ⚑ MEASURED, not guessed, and the first number was too small. A printed rule
 * shows up as a change at EACH of its edges, so the two peaks sit roughly its
 * width plus its anti-aliasing apart: a 2.5pt border at 100 dpi - an ordinary
 * choice, and what the bundled IC50 example uses - put them 4.3px apart on one
 * axis and 5.0px apart on the other. A five-pixel window merged the first and
 * split the second, so the same figure reported the right number of columns and
 * one row too many. Eight covers a rule up to about 7px.
 *
 * ⚑ A REAL TRADE-OFF, stated rather than tuned away: two GENUINE boundaries
 * closer together than this merge into one. At that width the cell between them
 * is eight pixels across and the reader insets a fifth of it, so there is
 * essentially nothing there to read - but a caller working on a very dense
 * matrix can lower it, and the proposal is visible on screen either way.
 */
const DEFAULT_MERGE_PX = 8;

/** One proposed boundary. */
export interface DividerCandidate {
  /** Where it sits along the axis, 0 at the box's origin edge and 1 at the far
   * one. The caller converts to data coordinates through its own axes - this
   * module never sees them. */
  position: number;
  /** The colour change measured there, in RGB units. Bigger is a firmer
   * boundary; it is reported so the user can see WHY something was proposed. */
  strength: number;
}

export interface DetectDividersResult {
  /** Every peak found, strongest first. */
  candidates: DividerCandidate[];
  /**
   * The change profile itself, one entry per pixel step along the axis. Kept so
   * a caller can DRAW it under the figure: a user who can see the peaks can tell
   * at a glance whether a missing divider was missed or was never there, which
   * no number in isolation can say.
   */
  profile: number[];
}

/**
 * Scan across the plot box and propose interior cell boundaries along one axis.
 *
 * `axis` is which direction to scan ALONG: `'x'` walks from the origin corner
 * towards `alongX`, sampling lines that run parallel to the y edge.
 *
 * ⚑ INTERIOR ONLY. The box's own two edges are boundaries by construction -
 * the user drew them when they calibrated - so they are not proposed and not
 * hunted for. A caller building a grid adds them itself.
 */
export function detectDividers(
  src: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  box: PlotBox,
  axis: 'x' | 'y',
  options: DetectDividersOptions = {}
): DetectDividersResult {
  const crossSamples = Math.max(2, Math.round(options.crossSamples ?? DEFAULT_CROSS_SAMPLES));
  const minStrength = options.minStrength ?? DEFAULT_MIN_STRENGTH;

  const steps = stepsAlong(box, axis);
  if (steps < 2) return { candidates: [], profile: [] };
  const mergeWithin = options.mergeWithin ?? DEFAULT_MERGE_PX / steps;

  // One representative colour per position, per cross-sample line. The medoid
  // across a short run of the cross direction keeps a single stray pixel - a
  // gridline in the OTHER direction, a label overhanging the box - from
  // registering as a change everywhere it crosses.
  let previous: RGB[] | null = null;
  const profile: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const line: RGB[] = [];
    for (let k = 0; k < crossSamples; k++) {
      const v = (k + 0.5) / crossSamples;
      const p = axis === 'x' ? pointInBox(box, u, v) : pointInBox(box, v, u);
      line.push(pixelAt(src, width, height, p));
    }
    if (previous !== null) profile.push(meanChange(previous, line));
    previous = line;
  }

  return { candidates: peaksOf(profile, steps, minStrength, mergeWithin), profile };
}

/** How many pixel steps the axis spans - the longer of the box's two edges in
 * that direction, so nothing is scanned at less than pixel resolution. */
function stepsAlong(box: PlotBox, axis: 'x' | 'y'): number {
  const [origin, alongX, alongY, opposite] = box;
  const a = axis === 'x' ? distance(origin, alongX) : distance(origin, alongY);
  const b = axis === 'x' ? distance(alongY, opposite) : distance(alongX, opposite);
  return Math.round(Math.max(a, b));
}

function distance(a: Point2D, b: Point2D): number {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
}

/** A point inside the box at fractions (u along x, v along y). */
function pointInBox(box: PlotBox, u: number, v: number): Point2D {
  const [c00, c10, c01, c11] = box;
  const top = { x: c00.x + (c10.x - c00.x) * u, y: c00.y + (c10.y - c00.y) * u };
  const bottom = { x: c01.x + (c11.x - c01.x) * u, y: c01.y + (c11.y - c01.y) * u };
  return { x: top.x + (bottom.x - top.x) * v, y: top.y + (bottom.y - top.y) * v };
}

/** The colour at a point, or an out-of-band marker for a pixel that is not
 * there. Off-image and transparent both read as "nothing", which cannot then
 * masquerade as a colour change. */
const NOTHING: RGB = [-1, -1, -1];

function pixelAt(
  src: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  p: Point2D
): RGB {
  const x = Math.round(p.x);
  const y = Math.round(p.y);
  if (x < 0 || y < 0 || x >= width || y >= height) return NOTHING;
  const idx = (y * width + x) * 4;
  if (src[idx + 3] === 0) return NOTHING;
  return [src[idx]!, src[idx + 1]!, src[idx + 2]!];
}

/**
 * How much two adjacent scan lines differ: the MEDIAN of the per-position colour
 * distances, not the mean.
 *
 * ⚑ The median is what makes a boundary mean "all the way across". One cell's
 * worth of change in a column of twenty - the top row of a heatmap changing
 * where nothing else does, which is DATA - moves a mean enough to look like a
 * boundary and leaves a median alone.
 */
function meanChange(a: readonly RGB[], b: readonly RGB[]): number {
  const diffs: number[] = [];
  for (let i = 0; i < a.length; i++) {
    const pa = a[i]!;
    const pb = b[i]!;
    if (pa === NOTHING || pb === NOTHING) continue;
    diffs.push(colorDistance(pa, pb));
  }
  if (diffs.length === 0) return 0;
  diffs.sort((x, y) => x - y);
  const mid = diffs.length >> 1;
  return diffs.length % 2 === 1 ? diffs[mid]! : (diffs[mid - 1]! + diffs[mid]!) / 2;
}

/**
 * Local maxima of the change profile, above the strength floor, with peaks that
 * belong to one drawn rule merged into a single boundary at their weighted
 * centre.
 */
function peaksOf(
  profile: readonly number[],
  steps: number,
  minStrength: number,
  mergeWithin: number
): DividerCandidate[] {
  const raw: DividerCandidate[] = [];
  for (let i = 0; i < profile.length; i++) {
    const v = profile[i]!;
    if (v < minStrength) continue;
    // ⚑ THE BOX'S OWN EDGES ARE NOT DISCOVERIES. A figure's axis spine, or
    // simply the step from the paper to the first cell, is the largest change in
    // the whole profile - measured at 222 RGB units on the viridis fixture,
    // three times any real boundary - and proposing it would hand the user two
    // dividers on top of the edges they already placed. Anything within a
    // merge-width of either end is that edge.
    const position = (i + 0.5) / steps;
    if (position < mergeWithin || position > 1 - mergeWithin) continue;
    // A plateau counts once: `>=` on the left and `>` on the right means a run
    // of equal values reports its first index rather than every index in it.
    if (i > 0 && profile[i - 1]! > v) continue;
    if (i < profile.length - 1 && profile[i + 1]! >= v) continue;
    // The profile's entry i is the change BETWEEN samples i and i+1, so the
    // boundary sits half a step along from sample i.
    raw.push({ position, strength: v });
  }

  const merged: DividerCandidate[] = [];
  for (const peak of raw) {
    const last = merged[merged.length - 1];
    if (last !== undefined && peak.position - last.position <= mergeWithin) {
      // ⚑ A drawn rule shows up as a change at each of its edges. Merging them
      // at the strength-weighted centre puts the boundary in the middle of the
      // rule, which is where the figure says it is; reporting both would give
      // the user two dividers 2px apart and a cell with no interior between.
      const total = last.strength + peak.strength;
      last.position = (last.position * last.strength + peak.position * peak.strength) / total;
      last.strength = Math.max(last.strength, peak.strength);
      continue;
    }
    merged.push({ ...peak });
  }

  return merged.sort((a, b) => b.strength - a.strength);
}

/**
 * Compare what was found against how many cells the figure is supposed to have.
 *
 * ⚑ THE COUNT CHECKS THE ANSWER; IT DOES NOT PRODUCE IT. This reports agreement
 * or a miss and stops there. Nothing in this module widens a threshold until the
 * count is satisfied - the discipline the bar work paid for, where the approach
 * that relaxed until the number came out right won the metric by erasing the
 * evidence.
 */
export function reconcileWithCount(
  candidates: readonly DividerCandidate[],
  expectedCells: number
): { agrees: boolean; found: number; expected: number; missing: number } {
  const expected = Number.isInteger(expectedCells) && expectedCells > 0 ? expectedCells - 1 : 0;
  const found = candidates.length;
  return { agrees: found === expected, found, expected, missing: expected - found };
}

/**
 * The dividers a caller ends up with: the box's own two edges, plus the
 * strongest `expectedCells - 1` candidates, in order.
 *
 * ⚑ Returns null rather than a short grid when there are not enough candidates.
 * A grid with a boundary missing looks exactly like a grid, and its cells are
 * silently twice as wide as the figure's - so the user is told, and places the
 * rest by hand.
 */
export function proposeDividers(
  candidates: readonly DividerCandidate[],
  expectedCells: number
): number[] | null {
  const { agrees, expected } = reconcileWithCount(candidates, expectedCells);
  if (expected < 1 && expectedCells !== 1) return null;
  if (!agrees && candidates.length < expected) return null;
  const chosen = [...candidates]
    .sort((a, b) => b.strength - a.strength)
    .slice(0, expected)
    .map((c) => c.position)
    .sort((a, b) => a - b);
  return [0, ...chosen, 1];
}

/** Every candidate above the floor, as a grid - for the caller that has no count
 * to declare. The same list, with the box's edges added. */
export function proposeAllDividers(candidates: readonly DividerCandidate[]): number[] {
  return [0, ...[...candidates].map((c) => c.position).sort((a, b) => a - b), 1];
}
