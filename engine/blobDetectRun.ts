/**
 * Blob-detect orchestration (checkpoint 122) - the scatter-plot sibling of
 * engine/colorTraceRun.ts. Same first stage (colour filter over the image), but
 * the reduction differs: colorTraceRun walks the mask into ONE curve (averaging
 * window → nearest-neighbour order → subsample); this returns ONE point per
 * connected blob (each marker's centroid), which is what a scatter plot needs.
 *
 * Extracted so it is vitest-testable on a synthetic RGBA buffer, no canvas/DOM.
 */

import { colorFilter, type RGB, type ColorFilterMode, type FilterRegion } from '../algorithms/colorFilter.js';
import { detectBlobs, markerCentres, type BlobDetectOptions } from '../algorithms/blobDetect.js';
import { ONE_MARKER, splitBlob, templateOf, typicalMarker } from '../algorithms/markerFit.js';
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
 * message when nothing matches the colour, or when every blob was filtered out -
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
  const blobs = detectBlobs(mask, width, height, { ...opts, trackMembership: true });
  if (blobs.length === 0) {
    return { error: 'No markers of that size were found. Lower the minimum marker size, or adjust the colour / tolerance.' };
  }
  // ⚑ detectBlobs's own order is a top-to-bottom, left-to-right PIXEL SCAN --
  // an implementation detail of how the flood-fill finds seeds, not a
  // reading order. For a scatter series (ordered data, e.g. a time series
  // or a dose-response curve) that scan order reads as scrambled: a point
  // sitting higher on the page comes back before one to its left. Sorted
  // ascending by (x, then y) instead, so the series lists low-to-high the
  // way the reader -- and the figure's own x-axis -- already does.
  // ⚑ v2.7: each point on the MARKER's own body, without an error bar or line of its colour that touches it
  // (algorithms/blobDetect.ts, markerCentres); a marker with nothing attached reads exactly as before.
  // ⚑ v2.7: markers drawn over each other are taken apart, each its own point (docs/v2.7-workflow-walk.md, "Markers
  // that run together"; David, 2026-11-05). With no legend the template is the plot's own commonest marker, and a blob
  // is taken apart only when its markers explain nearly all of its ink; anything else reads as before.
  const typical = typicalMarker(blobs);
  const template = typical ? templateOf([...typical.members!], width) : null;
  const points = blobs
    .flatMap((b) => {
      const split = template && typical && b.area > ONE_MARKER * typical.area ? splitBlob([...b.members!], width, [template]) : null;
      return split ? split.map((q) => ({ x: q.x, y: q.y })) : markerCentres(b, width, { minDiameter: opts?.minDiameter ?? 0 });
    })
    .sort((a, b) => a.x - b.x || a.y - b.y);
  return { points, matched: count, blobs: points.length };
}
