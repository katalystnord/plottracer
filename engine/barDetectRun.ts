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
import type { Point2D } from '../algorithms/segmentFill.js';

export interface DetectedBarBox {
  /** The bbox's top-left corner, in the same continuous-pixel space
   * addDataPoint/handleBoxRect already use — no assumption about which
   * corner is the chart's baseline; the caller measures both. */
  start: Point2D;
  end: Point2D;
}

export interface BarDetectSuccess {
  /** One opposite-corner box per accepted blob. */
  boxes: DetectedBarBox[];
  /** Matched-pixel count (before blob reduction), for UI feedback. */
  matched: number;
  /** Number of accepted blobs (== boxes.length), for UI feedback. */
  blobs: number;
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
  opts?: BlobDetectOptions
): BarDetectResult {
  const { mask, count } = colorFilter(data, width, height, target, tolerance, mode, region);
  if (count < MIN_MATCHED_PIXELS) {
    return { error: 'No pixels matched that colour. Repick the bar colour, or raise the tolerance.' };
  }
  const blobs = detectBlobs(mask, width, height, opts);
  if (blobs.length === 0) {
    return { error: 'No bars of that size were found. Lower the minimum blob size, or adjust the colour / tolerance.' };
  }
  return {
    boxes: blobs.map((b) => ({
      start: { x: b.bbox.minX, y: b.bbox.minY },
      end: { x: b.bbox.maxX, y: b.bbox.maxY },
    })),
    matched: count,
    blobs: blobs.length,
  };
}
