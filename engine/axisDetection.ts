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

type LabelBox = { x0: number; y0: number; x1: number; y1: number };
type Frame = { x: number; y: number; width: number; height: number };

/**
 * The categories along a bar chart's category axis, from the boxes of the labels printed beside it (v2.7, the
 * category axis on two tick marks): each category's label is centred on its category (labels lead, as on a
 * picture's value axes), so the centres of the labels in the row nearest the axis are the categories' centres, in
 * order along the axis, and how many there are is the count. Words of one label (`Group A`) are joined first.
 * `side` is where the category axis runs: the frame's bottom on upright bars, its left on horizontal ones.
 */
export function categoryCentresFromLabels(labels: readonly LabelBox[], frame: Frame, side: 'bottom' | 'left'): number[] {
  const found = categoryRow(labels, frame, side);
  if (!found) return [];
  const { row, size } = found;
  const along = side === 'bottom' ? ([0, 2] as const) : ([1, 3] as const);
  const box = (b: LabelBox) => [b.x0, b.y0, b.x1, b.y1] as const;
  // words of one label: a gap smaller than half a label's size
  const runs = row
    .map((b) => [box(b)[along[0]], box(b)[along[1]]] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of runs) {
    const last = merged[merged.length - 1];
    if (last && r[0] - last[1] < size / 2) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  const centres = merged.map(([a, b]) => (a + b) / 2);
  // upright: left to right; horizontal: bottom to top, as the values on a vertical axis run
  return side === 'bottom' ? centres : centres.reverse();
}

/** The labels in the row nearest the category axis, and the labels' size (their median height): the row the
 * categories' labels stand in, without an axis title further out or the value axis's numbers. */
function categoryRow(labels: readonly LabelBox[], frame: Frame, side: 'bottom' | 'left'): { row: LabelBox[]; size: number } | null {
  const along = side === 'bottom' ? ([0, 2] as const) : ([1, 3] as const);
  const lo = side === 'bottom' ? frame.x : frame.y;
  const hi = side === 'bottom' ? frame.x + frame.width : frame.y + frame.height;
  const span = hi - lo;
  const box = (b: LabelBox) => [b.x0, b.y0, b.x1, b.y1] as const;
  // distance out from the axis, and the label's size across it
  const out = (b: LabelBox) => (side === 'bottom' ? b.y0 - (frame.y + frame.height) : frame.x - b.x1);
  // a label's height is its font size whichever side it is on: the measure for a gap between words and for a row
  const height = (b: LabelBox) => b.y1 - b.y0;
  const centre = (b: LabelBox) => (box(b)[along[0]] + box(b)[along[1]]) / 2;
  const beside = labels.filter((b) => {
    const c = centre(b);
    return c >= lo - 0.02 * span && c <= hi + 0.02 * span && out(b) >= -height(b) / 4;
  });
  if (beside.length === 0) return null;
  // the row nearest the axis: an axis title further out is not a category
  const sizes = beside.map(height).sort((a, b) => a - b);
  const size = sizes[Math.floor(sizes.length / 2)]!;
  const nearest = Math.min(...beside.map(out));
  return { row: beside.filter((b) => out(b) <= nearest + 0.75 * size), size };
}

/**
 * The box round the row of category labels (v2.7), with a margin of a quarter of a label's height: where the
 * categories' names are read from after Calibrate, by the same reader as a box dragged round them by hand (the
 * walk notes, "Automatic axis detection reads the category names too"). Null when no label stands beside the axis.
 */
export function categoryLabelRow(labels: readonly LabelBox[], frame: Frame, side: 'bottom' | 'left'): Frame | null {
  const found = categoryRow(labels, frame, side);
  if (!found) return null;
  const m = found.size / 4;
  const x0 = Math.min(...found.row.map((b) => b.x0)) - m;
  const y0 = Math.min(...found.row.map((b) => b.y0)) - m;
  const x1 = Math.max(...found.row.map((b) => b.x1)) + m;
  const y1 = Math.max(...found.row.map((b) => b.y1)) + m;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** What [Automatic axis detection] places on a bar-family figure: the value axis's two points with their numbers,
 * Cat 1 and Cat n on the first and last category's tick marks with the count, as the walk would place them. */
export interface DetectedBarCalibration {
  value: { px: number; py: number; value: number }[];
  /** Cat 1 and Cat n, and how many categories, or null when fewer than two category labels were found. */
  categories: {
    first: { px: number; py: number };
    last: { px: number; py: number };
    count: number;
    /** The box round the row of category labels, for their names to be read after Calibrate (v2.7). */
    labelRow: Frame;
  } | null;
  log: boolean;
  /** The numbers were read along the axis the categories should run on, and none along the value axis: the bars
   * look to run the other way from the Horizontal bars option, so nothing was placed. */
  otherWayRound?: true;
}

/** Null when neither axis could be read: nothing to place, and the caller warns. */
export function barCalibrationFromLabels(
  read: AxesFromLabels,
  categoryLabels: readonly LabelBox[],
  frame: Frame | null,
  horizontal: boolean
): DetectedBarCalibration | null {
  const valueAxis = horizontal ? read.x : read.y;
  const categoryAxis = horizontal ? read.y : read.x;
  // numbers along the category side and none along the value side: the figure runs the other way round
  if (categoryAxis.ok && !valueAxis.ok) return { value: [], categories: null, log: false, otherWayRound: true };
  const v = ends(valueAxis);
  const value = v ? v.map((p) => ({ px: p.tick[0], py: p.tick[1], value: p.value })) : [];
  let categories: DetectedBarCalibration['categories'] = null;
  if (frame) {
    const side = horizontal ? 'left' : 'bottom';
    const centres = categoryCentresFromLabels(categoryLabels, frame, side);
    const labelRow = categoryLabelRow(categoryLabels, frame, side);
    if (centres.length >= 2 && labelRow) {
      const at = (c: number) => (horizontal ? { px: frame.x, py: c } : { px: c, py: frame.y + frame.height });
      categories = { first: at(centres[0]!), last: at(centres[centres.length - 1]!), count: centres.length, labelRow };
    }
  }
  if (value.length === 0 && !categories) return null;
  return { value, categories, log: valueAxis.ok && valueAxis.log };
}
