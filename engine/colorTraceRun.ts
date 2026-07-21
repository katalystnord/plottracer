/**
 * Colour-trace orchestration (checkpoint 118) -- the click/action policy on top
 * of algorithms/colorFilter.ts + segmentFill.ts's pure functions, the exact
 * sibling of engine/segmentFillRun.ts. Extracted so it is vitest-testable on a
 * synthetic RGBA buffer, no canvas/DOM.
 *
 * Segment Fill seeds from ONE click and follows CONNECTED pixels; this instead
 * selects EVERY pixel of the curve's colour, so a dashed / marker-only / crossed
 * curve traces in one pass (the job connectivity structurally cannot do). Both
 * end in the same recording pipeline: one point per run per column
 * (doubling-back branches survive), walked into curve order, subsampled.
 */

import { colorFilter, type RGB, type ColorFilterMode, type FilterRegion } from '../algorithms/colorFilter.js';
import { pointsFromColumnRuns, orderByNearestNeighbour, subsample, type Point2D } from '../algorithms/segmentFill.js';

export interface ColorTraceSuccess {
  points: Point2D[];
  /** Matched-pixel count (before ordering/subsampling), for UI feedback. */
  matched: number;
}

export type ColorTraceResult = ColorTraceSuccess | { error: string };

const MIN_MATCHED_PIXELS = 3;
const DEFAULT_MAX_POINTS = 500;

/**
 * Trace a curve by colour. `target` is the curve's colour (from the eyedropper),
 * `tolerance` a Euclidean RGB distance, `mode` foreground (near the colour) or
 * background (everything but it), `region` an optional plot-box restriction.
 * Fails with a clear message when too few pixels match (raise tolerance / repick),
 * rather than adding a near-empty trace.
 */
export function runColorTrace(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  target: RGB,
  tolerance: number,
  mode: ColorFilterMode = 'foreground',
  region?: FilterRegion,
  maxPoints: number = DEFAULT_MAX_POINTS
): ColorTraceResult {
  const { mask, count } = colorFilter(data, width, height, target, tolerance, mode, region);
  if (count < MIN_MATCHED_PIXELS) {
    return { error: 'No pixels matched that colour. Repick the curve colour, or raise the tolerance.' };
  }
  const runs = pointsFromColumnRuns(mask, width, height);
  const ordered = orderByNearestNeighbour(runs);
  const points = subsample(ordered, maxPoints);
  return { points, matched: count };
}
