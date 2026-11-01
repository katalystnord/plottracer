/**
 * Automatic graph extraction (beta), the axes card's [Read graph axis] on a PICTURE
 * (docs/v2.7-figure-type.md). A drawn PDF figure gives labelCalibration.ts its text and strokes
 * exactly; a picture gives them through a detector and the text reader:
 *
 *   1. the detector finds tick marks and tick labels as boxes, each with a score (0..1);
 *   2. each label box is cut out with a pixel of margin and read; a crop taller than it is wide is
 *      also read turned a quarter each way, since a Y label may be written sideways;
 *   3. the best read of each crop is its text, the other reads its alternatives (the vetting tries
 *      them when the best does not fit its neighbours), and its confidence goes with it;
 *   4. each tick box becomes a short stroke across its axis at the box's middle, 2 pt each way (the
 *      length the research gave true and detected ticks alike), carrying the detector's score;
 *   5. labelCalibration.ts reads the axes from these, unchanged.
 *
 * This is the research harness's assembly (plottracer-ref research/v2.7-figdet: make_crops.py,
 * calib_score.py --short-det-ticks, labelcal_run.mjs). Built from the raw detections and reads
 * (picture_parity.mjs, parity_score.py) on CHART-Info's held-out PMC splits 4 + 5 with ChartDete's
 * boxes, it gives 874 of 1,141 axes right (76.6%) and 24 wrong (2.1%), against the research
 * assembly's 874 and 23 through the same engine. Pure: the reading is done by the caller.
 */
import type { PlacedDrawing, PlacedShape } from '../algorithms/findLines/fromDrawing.js';
import type { PlacedText } from './drawingPlacement.js';
import { readAxesFromLabels, type AxesFromLabels } from './labelCalibration.js';

type Box = { x0: number; y0: number; x1: number; y1: number };

/** One box a detector found, in the figure's pixels. Classes are the training set's
 * (gen_det.py): x_tick, y_tick, x_tick_label, y_tick_label, plot_area, legend_*, ... */
export interface Detection {
  cls: string;
  box: Box;
  /** 0..1 */
  score: number;
}

/** Detections below this score are not used (the research's threshold). */
export const DETECTION_AT = 0.5;

/** A label to read: the crop's box in the figure's pixels and the quarter turns to read it at
 * (0 = as printed; 90 and 270 counterclockwise). */
export interface LabelCrop {
  box: Box;
  turns: readonly (0 | 90 | 270)[];
}

/** One read of one crop at one turn; confidence 0..100, as the reader gives it. */
export interface CropRead {
  text: string;
  confidence: number;
}

const LABELS = new Set(['x_tick_label', 'y_tick_label']);
/** The crop's margin round the detector's label box, px. */
const MARGIN = 1;
const median = (v: readonly number[]) => {
  const s = [...v].sort((a, b) => a - b), n = s.length;
  return n % 2 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
};
const TICKS = new Set(['x_tick', 'y_tick']);
const NUMERIC = /^[+\-−]?[\d.,]+([eE][+\-−]?\d+)?$/;

/** The label crops to read, in the order `pictureAxes` expects their reads. */
export function labelCrops(dets: readonly Detection[], size: { width: number; height: number }): LabelCrop[] {
  const out: LabelCrop[] = [];
  for (const d of dets) {
    if (d.score < DETECTION_AT || !LABELS.has(d.cls)) continue;
    const box = {
      x0: Math.max(0, Math.round(d.box.x0) - MARGIN),
      y0: Math.max(0, Math.round(d.box.y0) - MARGIN),
      x1: Math.min(size.width, Math.round(d.box.x1) + MARGIN),
      y1: Math.min(size.height, Math.round(d.box.y1) + MARGIN),
    };
    if (box.x1 - box.x0 < 2 || box.y1 - box.y0 < 2) continue;
    const tall = box.y1 - box.y0 > 1.2 * (box.x1 - box.x0);
    out.push({ box, turns: tall ? [0, 90, 270] : [0] });
  }
  return out;
}

/** Each crop's text: its most confident non-empty read, with the other reads as alternatives. */
export function cropTexts(crops: readonly LabelCrop[], reads: readonly (readonly CropRead[])[]): PlacedText[] {
  const out: PlacedText[] = [];
  crops.forEach((c, i) => {
    const rs = (reads[i] ?? []).map((r) => ({ text: r.text.trim(), confidence: r.confidence })).filter((r) => r.text);
    if (rs.length === 0) return;
    const best = rs.reduce((a, b) => (b.confidence > a.confidence ? b : a));
    const alternatives = [...new Set(rs.map((r) => r.text).filter((t) => t !== best.text))];
    out.push({ str: best.text, box: c.box, size: c.box.y1 - c.box.y0, confidence: best.confidence, alternatives });
  });
  return out;
}

/** The detector's tick marks as strokes across their axes, 2 pt each way from the box's middle,
 * with its score. */
export function tickStrokes(dets: readonly Detection[], pxPerPt: number): PlacedShape[] {
  const out: PlacedShape[] = [];
  for (const d of dets) {
    if (d.score < DETECTION_AT || !TICKS.has(d.cls)) continue;
    const { x0, y0, x1, y1 } = d.box;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const h = 2 * pxPerPt;
    const seg: [number, number][] = d.cls === 'x_tick' ? [[cx, cy - h], [cx, cy + h]] : [[cx - h, cy], [cx + h, cy]];
    out.push({ subs: [seg], stroked: true, filled: false, stroke: [0, 0, 0], fill: [0, 0, 0], lineWidth: 1, dash: null, confidence: d.score });
  }
  return out;
}

/** The axes read from a picture: the detector's boxes and the reads of `labelCrops(dets)`. */
export function pictureAxes(
  dets: readonly Detection[],
  reads: readonly (readonly CropRead[])[],
  size: { width: number; height: number }
): AxesFromLabels {
  const text = cropTexts(labelCrops(dets, size), reads);
  // The rules in labelCalibration.ts are in PDF points; a picture has none, so the labels' own
  // height stands in, taken as 9 pt (the research's scale).
  // The crop's height includes its margin; the ticks' length is measured from the label's own
  // height, the detector's box (in the research, from the true text; the same height without the
  // margin), so a stroke does not reach into the label it should end short of.
  const heights = text.filter((t) => NUMERIC.test(t.str)).map((t) => t.size);
  const pxPerPt = heights.length ? median(heights) / 9 : 1.2;
  const tickPxPerPt = heights.length ? median(heights.map((h) => h - 2 * MARGIN)) / 9 : 1.2;
  const drawing: PlacedDrawing = { shapes: tickStrokes(dets, tickPxPerPt), text: text.map((t) => t.box), pxPerPt };
  return readAxesFromLabels(drawing, text, size);
}
