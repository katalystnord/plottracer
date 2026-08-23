/**
 * Bar-box detector by colour (v2.0, Phase 7) - the direct fix for the
 * original tenet-1 defect: every existing auto-extract reduction (Segment
 * Fill's column average, blob detection's centroid) reads the MIDDLE of a
 * filled shape, and a bar's datum is its END - a number that was never the
 * datum (`59f94a6`, which refused auto-extract for Bar entirely rather than
 * ship a wrong one).
 *
 * The fix is not a new reduction so much as a different one: a bar IS its
 * blob's bounding box (see algorithms/blobDetect.ts's Blob.bbox, added
 * alongside this), so no averaging or centroid step throws away the end
 * that matters. Manual and automatic capture become two ways of producing
 * the IDENTICAL record - opposite corners - never a separate "auto-extract
 * shape" concept for Bar (see engine/calibrationSession.ts's
 * addBarDetectBoxes, which files each box through the same two-corner path
 * a manual drag-box does).
 *
 * Structured exactly like engine/blobDetectRun.ts (same colour filter, same
 * failure messages), since the two only differ in what a blob REDUCES TO.
 */

import { colorFilter, type RGB, type ColorFilterMode, type FilterRegion } from '../algorithms/colorFilter.js';
import { detectBlobs, type BlobDetectOptions } from '../algorithms/blobDetect.js';
import {
  reconcileWithExpected,
  runColumnsFromMembers,
  splitRunAtDividers,
  type ExpectationReport,
} from '../algorithms/barSplit.js';
import type { Point2D } from '../algorithms/segmentFill.js';
import { bandIndexIn } from '../core/bandedAxis.js';

export interface DetectedBarBox {
  /** The bbox's top-left corner, in the same continuous-pixel space
   * addDataPoint/handleBoxRect already use - no assumption about which
   * corner is the chart's baseline; the caller measures both. */
  start: Point2D;
  end: Point2D;
}

/**
 * Where the chart's BASELINE runs, in image pixels (v2.3).
 *
 * ⚑⚑ WHY A DETECTOR IS TOLD THIS. A legend's colour SWATCH is a filled rectangle
 * in exactly the series ink, so it matches the colour ball at any tolerance and
 * comes back as a blob - and it is then filed as a bar, putting a phantom
 * reading in the record that would export. David hit it twice in one day.
 * ⚠️ RESTRICTING THE TRACE TO THE PLOT AREA DOES NOT FIX IT, measured off his own
 * screenshot: that legend was INSET, comfortably inside both the calibrated value
 * span and the declared category span, so a plot-box gate would have excluded
 * nothing. Inset legends are the common case in published figures.
 * ▶ THE DISCRIMINATOR IS THE BASELINE ANCHOR: every bar in an unstacked chart is
 * anchored at the value axis's baseline and a swatch floats. That is the chart
 * libraries' own model read in reverse - `matplotlib.bar` takes a `bottom` and a
 * height, so a bar IS anchored - and it is the same question a captured bar's
 * value already asks (`core/barInterval.ts`).
 */
export interface BarDetectBaseline {
  /** The baseline's position along the VALUE axis, in image pixels. */
  atPixel: number;
  /**
   * How far from it still counts as sitting on it.
   *
   * ⚑ NOT half a pixel. A bar's ink stops where it was drawn, and an axis line,
   * its stroke width and any anti-aliasing sit between the two - so the
   * measurement is "does this shape reach the baseline", not "is its edge the
   * same pixel". The caller states what it will accept rather than this file
   * inventing a number.
   */
  tolerancePx: number;
}

export interface BarDetectSuccess {
  /** One opposite-corner box per accepted blob, or per PIECE where a merged run
   * was cut at declared dividers. */
  boxes: DetectedBarBox[];
  /** Matched-pixel count (before blob reduction), for UI feedback. */
  matched: number;
  /** Number of accepted blobs, for UI feedback. With declared categories this
   * can be fewer than `boxes.length`: one merged run yields several bars. */
  blobs: number;
  /** How the answer compared with the declared structure - present only when
   * categories were declared AND a count was given. Reports; never acts. */
  expectation?: ExpectationReport;
  /**
   * Which boxes look like a legend SWATCH rather than a bar - indices into
   * `boxes`. Present only when a baseline was supplied.
   *
   * ⚑⚑ REPORTS; NEVER ACTS, which is this project's standing rule for any bar
   * technique: *a technique may only REFUSE or CORROBORATE, never act alone.*
   * Every box is still returned and still filed. Silently dropping one would
   * delete a measurement without saying so, which is the worse half of the same
   * defect.
   *
   * ⚑ TWO TESTS, BOTH NEEDED. The baseline test alone is not sufficient and this
   * is stated so nobody builds it believing it is: on a STACKED figure only the
   * bottom layer touches the baseline, so every segment above it floats exactly
   * like a swatch. The SIZE test separates them - a swatch is small and roughly
   * square, while a bar spans a real share of its category.
   */
  swatchSuspects?: number[];
}

/** Declared category geometry, when the user has marked it (v2.1). Absent =
 * exactly the pre-v2.1 behaviour, which is the un-ticked path staying untouched. */
export interface BarDetectCategories {
  /** Divider positions along the category axis, ascending, in image pixels. */
  dividers: readonly number[];
  /** Which way the categories run: `x` upright, `y` for horizontal bars. */
  categoryAxis: 'x' | 'y';
  /** How many bars the declared structure implies. Used ONLY to report a short
   * answer -- never to relax anything until the count is satisfied. */
  expected?: number;
}

export type BarDetectResult = BarDetectSuccess | { error: string };

const MIN_MATCHED_PIXELS = 3;

/**
 * Detect bars by colour: filter the image to the bar colour, then reduce
 * each connected blob to its bounding box's two opposite corners.
 * `minDiameter`/`maxDiameter` (px, equivalent-circle) drop noise specks and a
 * merged grid/axis blob respectively, same as runBlobDetect. Fails with a
 * clear message when nothing matches the colour, or when every blob was
 * filtered out, rather than silently adding no bars.
 *
 * ⚑ Bars of the IDENTICAL colour that touch (no gap, no outline between
 * them) flood into one blob and read as one oversized bar, same as any
 * flood-fill-based mechanism - not solved here, tracked for the Phase 9
 * survey pass against real figures rather than papered over with a guess.
 */
/**
 * Which of these boxes look like a legend SWATCH rather than a bar.
 *
 * A shape qualifies only when BOTH readings say so:
 *   · it does not REACH the baseline - the near end of its value extent is
 *     further from the baseline than the stated tolerance; and
 *   · it is SMALL - its extent along the category axis is under half the median
 *     of the boxes that do reach the baseline.
 *
 * ⚑ MEASURED AGAINST THE FIGURE'S OWN BARS, not against a constant. "Small" has
 * no absolute meaning in pixels - it depends on the figure's scale, the number of
 * categories and how many series share a group - so the comparison is with what
 * this same trace found sitting on the baseline. `Min bar Ø` is the same test
 * done by hand: raising it from 3 px to about 30 drops a 14 px swatch and keeps a
 * 285 px segment, which is the workaround that got the v2.3 website shot taken.
 *
 * ⚑ NOTHING IS REPORTED WHEN NO BOX REACHES THE BASELINE. That is a figure whose
 * bars all float - a floating-bar chart, or a stack captured without its bottom
 * layer - and there is no reference to measure "small" against. Saying nothing is
 * the honest answer; guessing would libel every bar on the figure.
 */
function swatchSuspectsIn(
  boxes: readonly DetectedBarBox[],
  categoryAxis: 'x' | 'y',
  baseline: BarDetectBaseline
): number[] {
  const alongCategory = (b: DetectedBarBox) =>
    Math.abs(categoryAxis === 'x' ? b.end.x - b.start.x : b.end.y - b.start.y);
  /** How far this shape's NEAREST end is from the baseline, along the value axis. */
  const gapToBaseline = (b: DetectedBarBox) => {
    const lo = categoryAxis === 'x' ? Math.min(b.start.y, b.end.y) : Math.min(b.start.x, b.end.x);
    const hi = categoryAxis === 'x' ? Math.max(b.start.y, b.end.y) : Math.max(b.start.x, b.end.x);
    // Zero for a shape the baseline passes through, which is what a bar drawn
    // across zero does - it reaches the baseline from both sides.
    if (baseline.atPixel >= lo && baseline.atPixel <= hi) return 0;
    return Math.min(Math.abs(lo - baseline.atPixel), Math.abs(hi - baseline.atPixel));
  };
  const anchored = boxes.filter((b) => gapToBaseline(b) <= baseline.tolerancePx);
  if (anchored.length === 0) return [];
  const widths = anchored.map(alongCategory).sort((a, b) => a - b);
  const median = widths[Math.floor(widths.length / 2)]!;
  if (!(median > 0)) return [];
  return boxes.flatMap((b, i) =>
    gapToBaseline(b) > baseline.tolerancePx && alongCategory(b) < median / 2 ? [i] : []
  );
}

export function runBarDetect(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  target: RGB,
  tolerance: number,
  mode: ColorFilterMode = 'foreground',
  region?: FilterRegion,
  opts?: BlobDetectOptions,
  categories?: BarDetectCategories,
  /** Where the chart's baseline runs - see `BarDetectBaseline`. Absent = exactly
   * the pre-v2.3 behaviour, and no swatch report. */
  baseline?: BarDetectBaseline
): BarDetectResult {
  const { mask, count } = colorFilter(data, width, height, target, tolerance, mode, region);
  if (count < MIN_MATCHED_PIXELS) {
    return { error: 'No pixels matched that colour. Repick the bar colour, or raise the tolerance.' };
  }
  // Membership is only worth its memory when a run might actually be cut.
  const blobs = detectBlobs(mask, width, height, {
    ...opts,
    ...(categories && categories.dividers.length >= 2 ? { trackMembership: true } : {}),
  });
  if (blobs.length === 0) {
    return { error: 'No bars of that size were found. Lower the minimum blob size, or adjust the colour / tolerance.' };
  }
  const plainBoxes = blobs.map((b) => ({
    start: { x: b.bbox.minX, y: b.bbox.minY },
    end: { x: b.bbox.maxX, y: b.bbox.maxY },
  }));
  if (!categories || categories.dividers.length < 2) {
    // ⚑ Without declared categories the value axis is still known - it is the
    // one the baseline was given along - so the swatch reading is available
    // here too. `categories.categoryAxis` only names WHICH axis; an unmarked
    // figure defaults to the upright chart the caller drew the baseline for.
    const suspects = baseline ? swatchSuspectsIn(plainBoxes, 'x', baseline) : [];
    return {
      boxes: plainBoxes,
      matched: count,
      blobs: blobs.length,
      ...(baseline ? { swatchSuspects: suspects } : {}),
    };
  }

  // ⚑ v2.1: with the categories declared, a blob spanning more than one band is
  // a MERGED RUN of touching bars -- the #1 fixable limit against real figures --
  // and is cut at the dividers the user placed. Each piece is re-measured from
  // the mask by the MEDIAN of its own columns (see algorithms/barSplit.ts), so a
  // divider a few pixels into the taller neighbour cannot drag the shorter bar's
  // reading up. Nothing is invented for an empty band.
  const { dividers, categoryAxis, expected } = categories;
  const along = (b: { minX: number; minY: number; maxX: number; maxY: number }) =>
    categoryAxis === 'x' ? { lo: b.minX, hi: b.maxX } : { lo: b.minY, hi: b.maxY };
  const boxes: DetectedBarBox[] = [];
  for (const blob of blobs) {
    const span = along(blob.bbox);
    // ⚑ INTERIOR dividers only. The first and last entries are the axis EDGES,
    // and the model says the outermost bands are UNBOUNDED -- everything left of
    // the first divider is category 0. Cutting at an edge sliced a run that
    // extended past where the user clicked "categories end", producing a sliver
    // piece beyond the last band which then band-clamped onto the last category
    // and evicted the real bar's row (code review, 2026-08-10).
    const interior = dividers.slice(1, -1);
    const crossed = interior.filter((d) => d > span.lo && d < span.hi);
    if (crossed.length === 0) {
      // Wholly inside one band: nothing to cut, and re-measuring it would only
      // risk moving a reading that was already right.
      boxes.push({
        start: { x: blob.bbox.minX, y: blob.bbox.minY },
        end: { x: blob.bbox.maxX, y: blob.bbox.maxY },
      });
      continue;
    }
    const columns = runColumnsFromMembers(blob.members ?? [], width, categoryAxis);
    const cuts = [span.lo, ...crossed, span.hi];
    const report = splitRunAtDividers(columns, cuts);
    for (const piece of report.pieces) {
      // ⚑ The INK's extent, not the band's. A bar is narrower than its band --
      // the gaps between bars are exactly that difference -- so boxing a piece
      // at the band edges describes something much wider than the bar and misses
      // the bar outright. Caught by the corpus run; every unit fixture happened
      // to have bars that filled their bands completely, so nothing local saw it.
      boxes.push(
        categoryAxis === 'x'
          ? { start: { x: piece.atFrom, y: piece.min }, end: { x: piece.atTo, y: piece.max } }
          : { start: { x: piece.min, y: piece.atFrom }, end: { x: piece.max, y: piece.atTo } }
      );
    }
  }
  // ⚑ Which DECLARED bands ended up with no bar, across the whole figure -- not
  // merely the ones a split found empty. A category missing because its blob was
  // never detected at all is exactly as absent as one missing from inside a
  // merged run, and the user needs it named either way. Computed from the boxes
  // finally produced, so it cannot disagree with what was returned.
  // ⚠️ `clamp` IS THE BEHAVIOUR THIS ALWAYS HAD, and it is now a word rather than
  // an inline loop nobody had to think about. It is also the reason a legend's
  // colour swatch lands in a real category instead of being reported as
  // unplaceable: a shape past the last divider is assigned the nearest band.
  // Deliberately UNCHANGED here - the phantom-bar defect is parked to v2.4 - but
  // the fix is now a one-word decision instead of an archaeology exercise.
  const bandOf = (b: DetectedBarBox): number => {
    const lo = categoryAxis === 'x' ? b.start.x : b.start.y;
    const hi = categoryAxis === 'x' ? b.end.x : b.end.y;
    return bandIndexIn(dividers, (lo + hi) / 2, 'clamp') ?? dividers.length - 2;
  };
  const filled = new Set(boxes.map(bandOf));
  const emptyBands = Array.from({ length: dividers.length - 1 }, (_, i) => i).filter(
    (i) => !filled.has(i)
  );
  return {
    boxes,
    matched: count,
    blobs: blobs.length,
    ...(expected !== undefined
      ? { expectation: reconcileWithExpected({ pieces: boxes, emptyBands }, expected) }
      : {}),
    ...(baseline ? { swatchSuspects: swatchSuspectsIn(boxes, categoryAxis, baseline) } : {}),
  };
}
