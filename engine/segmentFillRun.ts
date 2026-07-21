/**
 * Segment Fill orchestration (checkpoint 26, see CLAUDE.md) -- the click
 * policy layered on top of algorithms/segmentFill.ts's pure floodFill/
 * pointsFromColumnRuns/orderByNearestNeighbour/subsample functions, extracted
 * so it's directly vitest-testable (a synthetic in-memory RGBA buffer, no
 * canvas/DOM needed) rather than only reachable through a full
 * Electron+Playwright launch.
 *
 * Faithful port of the policy in ui-patches/engauge-algos.js's
 * SegmentFillTool.onMouseClick (the current, still-running app's own
 * Segment Fill tool, Phase 2.4): clamp the seed to image bounds, flood
 * fill, reject a too-small fill (< MIN_FILLED_PIXELS, same threshold and
 * message) rather than silently adding a near-empty trace, then order and
 * subsample to at most maxPoints (default 500, same as the current app).
 */

import {
  floodFill,
  pointsFromColumnRuns,
  orderByNearestNeighbour,
  subsample,
  type Point2D,
} from '../algorithms/segmentFill.js';

export interface SegmentFillSuccess {
  points: Point2D[];
  /** Raw flood-fill pixel count before ordering/subsampling -- surfaced for
   * UI feedback (e.g. "traced N points from an M-pixel fill"). */
  filled: number;
}

export type SegmentFillResult = SegmentFillSuccess | { error: string };

const MIN_FILLED_PIXELS = 3;
const DEFAULT_MAX_POINTS = 500;

/**
 * Runs a Segment Fill trace from a single seed click. `seedX`/`seedY` are
 * image-pixel coordinates (not necessarily integers or in-bounds -- both are
 * handled here, matching the original tool's own Math.round + clamp before
 * ever touching the pixel buffer).
 */
export function runSegmentFill(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  seedX: number,
  seedY: number,
  threshold: number,
  maxPoints: number = DEFAULT_MAX_POINTS
): SegmentFillResult {
  const sx = Math.max(0, Math.min(width - 1, Math.round(seedX)));
  const sy = Math.max(0, Math.min(height - 1, Math.round(seedY)));

  const result = floodFill(data, width, height, sx, sy, threshold);
  if (result.filled < MIN_FILLED_PIXELS) {
    return { error: 'No curve found at the clicked point. Try clicking closer to the curve, or increase the threshold.' };
  }

  // One point per run per column (both branches of a doubling-back curve
  // survive), then walked into curve order -- column order is not curve order
  // once a curve turns back on itself. Subsample last, so it thins a real
  // curve rather than an arbitrary point cloud. See algorithms/segmentFill.ts.
  const runs = pointsFromColumnRuns(result.mask, width, height);
  const ordered = orderByNearestNeighbour(runs);
  const points = subsample(ordered, maxPoints);
  return { points, filled: result.filled };
}
