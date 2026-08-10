/**
 * Bar-box detector by colour (v2.0, Phase 7) — the direct fix for the
 * original tenet-1 defect: every existing auto-extract reduction (Segment
 * Fill's column average, blob detection's centroid) reads the MIDDLE of a
 * filled shape, and a bar's datum is its END — a number that was never the
 * datum (`59f94a6`, which refused auto-extract for Bar entirely rather than
 * ship a wrong one).
 *
 * The fix is not a new reduction so much as a different one: a bar IS its
 * blob's bounding box (see algorithms/blobDetect.ts's Blob.bbox, added
 * alongside this), so no averaging or centroid step throws away the end
 * that matters. Manual and automatic capture become two ways of producing
 * the IDENTICAL record — opposite corners — never a separate "auto-extract
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

export interface DetectedBarBox {
  /** The bbox's top-left corner, in the same continuous-pixel space
   * addDataPoint/handleBoxRect already use — no assumption about which
   * corner is the chart's baseline; the caller measures both. */
  start: Point2D;
  end: Point2D;
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
  /** How the answer compared with the declared structure — present only when
   * categories were declared AND a count was given. Reports; never acts. */
  expectation?: ExpectationReport;
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
 * flood-fill-based mechanism — not solved here, tracked for the Phase 9
 * survey pass against real figures rather than papered over with a guess.
 */
export function runBarDetect(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  target: RGB,
  tolerance: number,
  mode: ColorFilterMode = 'foreground',
  region?: FilterRegion,
  opts?: BlobDetectOptions,
  categories?: BarDetectCategories
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
    return { boxes: plainBoxes, matched: count, blobs: blobs.length };
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
  const bandOf = (b: DetectedBarBox): number => {
    const lo = categoryAxis === 'x' ? b.start.x : b.start.y;
    const hi = categoryAxis === 'x' ? b.end.x : b.end.y;
    const mid = (lo + hi) / 2;
    for (let i = 0; i < dividers.length - 1; i++) {
      if (mid < dividers[i + 1]!) return i;
    }
    return dividers.length - 2;
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
  };
}
