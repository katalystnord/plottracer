/**
 * Find the TICK MARKS a figure draws on an axis we were already given (v2.4).
 *
 * David, 2026-08-29: *"When you are looking at the OCR of text, it would be
 * really good if we can also look to identify or at least try to identify tick
 * marks on axis."*
 *
 * ⚑⚑ IT IS THE MEASURED HALF OF A CALIBRATION PROPOSAL, and the split is
 * exactly tenet 9's line:
 *   · a tick's POSITION is INK, so finding it is a MEASUREMENT;
 *   · a tick's LABEL is TEXT, so reading it is TRANSCRIPTION (that is OCR's
 *     half, and it belongs to the user's own region gesture).
 * Neither half is inferred from the other and neither is invented, which is what
 * lets the pair be OFFERED to the user as a proposal rather than applied.
 *
 * ⚑⚑ IT NEVER HUNTS FOR AN AXIS. The line is already known - the user clicked
 * both of its ends during the calibration walk - so this looks in a narrow band
 * just outside a line it was HANDED. There is no axis-finding heuristic here to
 * be wrong, and no figure-dependent threshold to tune.
 *
 * ⚠️⚑⚑ IT LOOKS OUTWARD, AND THE CALLER SAYS WHICH WAY THAT IS. Measured over
 * the nine bundled figures with a horizontal axis: outward finds 5 to 9 ticks on
 * every one of them, and the inward band finds 1 or 2 on every one of them -
 * which are not ticks at all, but the plot's own furniture and data ink caught
 * against the spine. So inward is not a fallback to try when outward comes up
 * short: it is a source of false positives, and on a histogram, whose bars STAND
 * on the axis, it would be building a calibration out of the readings that
 * calibration is meant to be independent of.
 *
 * ⚑ EVENNESS IS REPORTED, NOT ENFORCED, and the caller decides. Measured over
 * the same nine: eight come in under 1% deviation from a constant pitch and the
 * ragged one stands out at 100%. That makes it a cheap self-check - but the
 * candidates come back either way, because detection that answers "nothing"
 * rather than proposing what it did find is a defect this project has already
 * paid for once, on the heatmap grid.
 * ⛔⛔ AND IT IS NOT A REFUSAL TEST ON A LOG AXIS. Decade ticks at 1, 10, 100 are
 * evenly spaced in pixels while the minor ticks between them are deliberately
 * not, so "uneven" there means the axis is doing its job. A caller that refuses
 * on evenness alone would refuse exactly the figures where reading the labels
 * matters most.
 */

import type { PixelSource } from './samplePixel.js';

export interface Point2D {
  x: number;
  y: number;
}

export interface DetectTicksOptions {
  /**
   * How far outside the axis to look, in pixels: `[first, last)`.
   *
   * ⚑ It stops at 12 because a printed tick is short - measured at 5px on the
   * bundled figures - and a wider window starts collecting the tick LABELS
   * underneath, whose tops sit about 10px out on a 900px-wide figure.
   */
  band?: [number, number];
  /**
   * How much darker than the local background a pixel must be to count as ink.
   *
   * ⚑ A FLOOR, not a knob, in the sense `gridDetect.minStrength` already means
   * it: below this the difference is within what anti-aliasing and 8-bit
   * rounding produce on their own, so a tick found there is not one we saw.
   */
  minContrast?: number;
  /**
   * How many pixels of UNBROKEN ink, running outward from the axis, make a tick.
   *
   * ⚑⚑ A RUN ATTACHED TO THE SPINE, not a fraction of a fixed window - and the
   * first cut got this wrong in a way worth keeping written down. Requiring ink
   * through 60% of a 2..9px band found NOTHING on a figure whose ticks are
   * plainly there: the axis sits at y=496.6, so half-pixel rounding moved the
   * window one row and a 5px tick filled 4 of the 7 samples instead of 5. A
   * threshold that a half-pixel can flip is measuring the rounding, not the
   * figure. A tick IS a short stroke attached to the axis, so that is what this
   * looks for, and where the stroke ENDS decides its depth.
   */
  minDepth?: number;
  /** Columns closer together than this are one tick - a tick drawn 2px wide has
   *  two anti-aliased edges and one meaning. */
  mergeWithin?: number;
}

/** One tick the figure actually draws. */
export interface TickCandidate {
  /** Where it sits along the axis, 0 at `from` and 1 at `to`. The caller
   *  converts to data through its own axes - this module never sees them. */
  position: number;
  /** Its pixel, on the axis line itself. */
  pixel: Point2D;
  /** How many samples of the band carried ink. Reported so a user can see WHY
   *  something was proposed, the same reason `DividerCandidate` reports its
   *  strength. */
  depth: number;
}

export interface DetectTicksResult {
  candidates: TickCandidate[];
  /**
   * The largest departure from a constant pitch, as a fraction of that pitch,
   * or null with fewer than three ticks - two ticks are evenly spaced by
   * definition and say nothing.
   */
  evenness: number | null;
  /** The mean gap in pixels, or null when evenness is null. */
  pitch: number | null;
}

const DEFAULT_BAND: [number, number] = [1, 12];
const DEFAULT_MIN_CONTRAST = 40;
const DEFAULT_MIN_DEPTH = 3;
const DEFAULT_MERGE_PX = 3;

/** Rec. 601 luma - the same weighting the colour tools here already use. */
function luma(src: PixelSource, x: number, y: number): number | null {
  const cx = Math.round(x);
  const cy = Math.round(y);
  if (cx < 0 || cy < 0 || cx >= src.width || cy >= src.height) return null;
  const o = (cy * src.width + cx) * 4;
  return 0.299 * src.data[o]! + 0.587 * src.data[o + 1]! + 0.114 * src.data[o + 2]!;
}

function median(values: number[]): number {
  if (values.length === 0) return 255;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Scan the band just outside `from`..`to` and report the tick marks drawn there.
 *
 * `outward` is a unit vector pointing AWAY from the plot. The caller supplies it
 * because the caller is the one that knows where the plot is; deriving it here
 * would mean this module carrying a second copy of a convention `engine/`
 * already owns (`categoryTickOverlay`'s own outward normal), and two copies of
 * one rule is how the two start to disagree.
 */
export function detectAxisTicks(
  src: PixelSource,
  from: Point2D,
  to: Point2D,
  outward: Point2D,
  options: DetectTicksOptions = {}
): DetectTicksResult {
  const [bandFrom, bandTo] = options.band ?? DEFAULT_BAND;
  const minContrast = options.minContrast ?? DEFAULT_MIN_CONTRAST;
  const minDepth = options.minDepth ?? DEFAULT_MIN_DEPTH;
  const mergeWithin = options.mergeWithin ?? DEFAULT_MERGE_PX;

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  const bandSize = bandTo - bandFrom;
  if (!Number.isFinite(length) || length < 2 || bandSize < 1) {
    return { candidates: [], evenness: null, pitch: null };
  }
  const ux = dx / length;
  const uy = dy / length;
  // ⚑ CEIL, and the last sample clamped to the far end, so the tick sitting ON
  // `to` is inside the scan. Flooring stopped a pixel short and dropped the
  // final tick of an eight-tick axis - the kind of miss that looks like a
  // detection limit and is really an off-by-one at the boundary.
  const steps = Math.ceil(length);
  const along = (s: number): number => Math.min(s, length);

  // ⚑ ONE PASS TO LEARN THE BACKGROUND, then one to find the ink. A fixed
  // "darker than 128" would call a figure printed on a grey panel solid ink and
  // a faint tick on white nothing at all; the median of the band IS the paper
  // this particular figure is printed on, measured rather than assumed.
  const samples: number[] = [];
  const perStep: number[][] = [];
  for (let s = 0; s <= steps; s++) {
    const bx = from.x + ux * along(s);
    const by = from.y + uy * along(s);
    const column: number[] = [];
    for (let d = bandFrom; d < bandTo; d++) {
      const l = luma(src, bx + outward.x * d, by + outward.y * d);
      if (l !== null) {
        column.push(l);
        samples.push(l);
      }
    }
    perStep.push(column);
  }
  const paper = median(samples);

  /** Unbroken ink running outward from the axis - see `minDepth`. */
  const runDepth = (column: number[]): number => {
    let n = 0;
    for (const l of column) {
      if (l >= paper - minContrast) break;
      n += 1;
    }
    return n;
  };

  const runs: { steps: number[]; depth: number }[] = [];
  let current: number[] = [];
  let deepest = 0;
  for (let s = 0; s <= steps; s++) {
    const depth = runDepth(perStep[s]!);
    if (depth >= minDepth) {
      current.push(s);
      deepest = Math.max(deepest, depth);
    } else if (current.length > 0) {
      runs.push({ steps: current, depth: deepest });
      current = [];
      deepest = 0;
    }
  }
  if (current.length > 0) runs.push({ steps: current, depth: deepest });

  // A tick drawn two pixels wide has two anti-aliased edges and one meaning.
  const merged: { steps: number[]; depth: number }[] = [];
  for (const run of runs) {
    const last = merged[merged.length - 1];
    if (last && run.steps[0]! - last.steps[last.steps.length - 1]! <= mergeWithin) {
      last.steps.push(...run.steps);
      last.depth = Math.max(last.depth, run.depth);
    } else {
      merged.push({ steps: [...run.steps], depth: run.depth });
    }
  }

  const candidates: TickCandidate[] = merged.map((run) => {
    const centre = run.steps.reduce((a, b) => a + along(b), 0) / run.steps.length;
    return {
      position: centre / length,
      pixel: { x: from.x + ux * centre, y: from.y + uy * centre },
      depth: run.depth,
    };
  });

  return { candidates, ...spacingOf(candidates, length) };
}

/**
 * How regular the spacing is - the free self-check.
 *
 * ⚑ Returned rather than acted on. A figure whose ticks are evenly spaced is one
 * a caller can offer with confidence; an uneven answer means something else got
 * into the band, and the caller should say so rather than propose it. Both
 * outcomes still carry the candidates, because a user who can see what was found
 * can tell at a glance whether a miss was a miss or was never there.
 */
function spacingOf(
  candidates: readonly TickCandidate[],
  length: number
): { evenness: number | null; pitch: number | null } {
  if (candidates.length < 3) return { evenness: null, pitch: null };
  const gaps: number[] = [];
  for (let i = 1; i < candidates.length; i++) {
    gaps.push((candidates[i]!.position - candidates[i - 1]!.position) * length);
  }
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  if (!(mean > 0)) return { evenness: null, pitch: null };
  const worst = Math.max(...gaps.map((g) => Math.abs(g - mean)));
  return { evenness: worst / mean, pitch: mean };
}
