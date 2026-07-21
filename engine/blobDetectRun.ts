/**
 * Blob-detect orchestration (checkpoint 122) — the scatter-plot sibling of
 * engine/colorTraceRun.ts. Same first stage (colour filter over the image), but
 * the reduction differs: colorTraceRun walks the mask into ONE curve (averaging
 * window → nearest-neighbour order → subsample); this returns ONE point per
 * connected blob (each marker's centroid), which is what a scatter plot needs.
 *
 * Extracted so it is vitest-testable on a synthetic RGBA buffer, no canvas/DOM.
 */

import { colorFilter, type RGB, type ColorFilterMode, type FilterRegion } from '../algorithms/colorFilter.js';
import { detectBlobs, type BlobDetectOptions } from '../algorithms/blobDetect.js';
import type { Point2D } from '../algorithms/segmentFill.js';

export interface BlobDetectSuccess {
  /** One centroid per accepted blob. */
  points: Point2D[];
  /** Matched-pixel count (before blob reduction), for UI feedback. */
  matched: number;
  /** Number of accepted blobs (== points.length), for UI feedback. */
  blobs: number;
}

export type BlobDetectResult = BlobDetectSuccess | { error: string };

const MIN_MATCHED_PIXELS = 3;

/**
 * Detect scatter markers by colour: filter the image to the marker colour, then
 * reduce each connected blob to its centroid. `minDiameter`/`maxDiameter` (px)
 * drop noise specks and a merged grid/axis blob respectively. Fails with a clear
 * message when nothing matches the colour, or when every blob was filtered out —
 * rather than silently adding no points.
 */
export function runBlobDetect(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  target: RGB,
  tolerance: number,
  mode: ColorFilterMode = 'foreground',
  region?: FilterRegion,
  opts?: BlobDetectOptions
): BlobDetectResult {
  const { mask, count } = colorFilter(data, width, height, target, tolerance, mode, region);
  if (count < MIN_MATCHED_PIXELS) {
    return { error: 'No pixels matched that colour. Repick the marker colour, or raise the tolerance.' };
  }
  const blobs = detectBlobs(mask, width, height, opts);
  if (blobs.length === 0) {
    return { error: 'No markers of that size were found. Lower the minimum marker size, or adjust the colour / tolerance.' };
  }
  return { points: blobs.map((b) => b.centroid), matched: count, blobs: blobs.length };
}
