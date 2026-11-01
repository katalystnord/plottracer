import type { AxesFromLabels, AxisFromLabels, LabelPair } from './labelCalibration.js';

/**
 * [Automatic axis detection] (the calibration card, v2.7; David 2026-10-31 and 2026-11-01, docs/v2.7-workflow-walk.md
 * step 3): which calibration points a read of the figure's labels places, and with which numbers.
 *
 * Every point that can be detected is placed, each on a labelled tick with the number printed there; the user can
 * move any of them, change any number, and place a missing one by its chip. The origin is shared only when the
 * corner where the axes meet is labelled on both axes (option C, "Yes, C."): otherwise X1 and Y1 are two points,
 * each on its own first labelled tick, so no number is ever worked out from a scale. The outermost labelled ticks
 * are used, for the widest span.
 *
 * ⚑ NOT the data area's corners (`atCorners`, 2026-10-19), which carry values worked out from the labels' scale:
 * option C replaced that for this button.
 */

export interface DetectedCalibration {
  /** In walk order; only the points that could be read. */
  points: { key: 'x1' | 'x2' | 'y1' | 'y2'; px: number; py: number; value: number }[];
  /** X1 and Y1 are one point, the labelled corner. */
  sharedOrigin: boolean;
  log: { x: boolean; y: boolean };
}

/** Two points closer than this, in pixels, are the same tick: the corner, labelled on both axes. */
const SAME_POINT_PX = 3;

const ends = (a: AxisFromLabels): [LabelPair, LabelPair] | null => {
  if (!a.ok || a.pairs.length < 2) return null;
  // along X from the left; along Y from the bottom (pixels grow downwards)
  const sorted = [...a.pairs].sort((p, q) => (a.axis === 'x' ? p.tick[0] - q.tick[0] : q.tick[1] - p.tick[1]));
  return [sorted[0]!, sorted[sorted.length - 1]!];
};

/** Null when neither axis could be read: nothing to place, and the caller warns. */
export function calibrationFromLabels(read: AxesFromLabels): DetectedCalibration | null {
  const x = ends(read.x);
  const y = ends(read.y);
  if (!x && !y) return null;
  const sharedOrigin = !!x && !!y && Math.hypot(x[0].tick[0] - y[0].tick[0], x[0].tick[1] - y[0].tick[1]) <= SAME_POINT_PX;
  const points: DetectedCalibration['points'] = [];
  if (x) {
    points.push({ key: 'x1', px: x[0].tick[0], py: x[0].tick[1], value: x[0].value });
    points.push({ key: 'x2', px: x[1].tick[0], py: x[1].tick[1], value: x[1].value });
  }
  if (y) {
    // the shared corner is one pixel: Y1 sits exactly where X1 does
    const y1 = sharedOrigin ? { px: x![0].tick[0], py: x![0].tick[1] } : { px: y[0].tick[0], py: y[0].tick[1] };
    points.push({ key: 'y1', ...y1, value: y[0].value });
    points.push({ key: 'y2', px: y[1].tick[0], py: y[1].tick[1], value: y[1].value });
  }
  return { points, sharedOrigin, log: { x: read.x.ok && read.x.log, y: read.y.ok && read.y.log } };
}
