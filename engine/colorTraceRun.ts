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
 * The bounding box of a set of calibration point pixels, as a FilterRegion. For
 * an XY chart this is the plot rectangle (X1/X2 on the x-axis, Y1/Y2 on the
 * y-axis), which is exactly the region that excludes the title, axis lines and
 * tick labels a colour trace would otherwise grab — they share the curve's
 * colour within tolerance but fall OUTSIDE the box. Returned as the default
 * trace region so a first pass stays inside the plot; the caller keeps it
 * visible and adjustable so data extending beyond the calibration points is one
 * drag/clear away. Null when the points enclose no area.
 */
export function calibrationBoxRegion(
  placed: Readonly<Record<string, { px: number; py: number }>>
): FilterRegion | null {
  const pts = Object.values(placed);
  if (pts.length < 2) return null;
  const xs = pts.map((p) => p.px);
  const ys = pts.map((p) => p.py);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const width = Math.max(...xs) - x;
  const height = Math.max(...ys) - y;
  return width > 0 && height > 0 ? { x, y, width, height } : null;
}

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
