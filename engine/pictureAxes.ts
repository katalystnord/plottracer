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
import { detectDividers } from '../algorithms/gridDetect.js';

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


/** Where the tick labels of each axis must be: a strip under the X axis and left of the Y axis, placed
 * from the detector's plot area, out as far as its label boxes reach and STOPPING SHORT OF THE TICK MARKS
 * (PaddleOCR reads a tick beside a label into it: "0.15-", "-6-", a dash that turns 6 into -6), enlarged
 * so the labels are read at least ~32 px high. The research's make_bands.py, to the pixel. */
export interface LabelBand {
  axis: 'x' | 'y';
  box: Box;
  /** The enlargement the strip is read at; a word's box divides by it on the way home. */
  factor: number;
}

/** Detections at or above this score place the strips (the research's: labels are many, a strip is cheap). */
export const BAND_AT = 0.3;

export function labelBands(dets: readonly Detection[], size: { width: number; height: number }): LabelBand[] {
  const plots = dets.filter((d) => d.cls === 'plot_area');
  if (plots.length === 0) return [];
  const pa = plots.reduce((a, b) => (b.score > a.score ? b : a)).box;
  const out: LabelBand[] = [];
  for (const axis of ['x', 'y'] as const) {
    const labs = dets.filter((d) => d.cls === `${axis}_tick_label` && d.score >= BAND_AT).map((d) => d.box);
    const hs = labs.map((b) => b.y1 - b.y0).sort((p, q) => p - q);
    const lh = hs.length ? hs[Math.floor(hs.length / 2)]! : 12;
    let b: Box;
    if (axis === 'x') {
      const below = labs.filter((l) => l.y0 >= pa.y1 - 6);
      const near = below.length ? Math.min(...below.map((l) => l.y0)) : pa.y1 + 0.6 * lh;
      const reach = below.length ? Math.max(...below.map((l) => l.y1)) : pa.y1 + 3 * lh;
      b = { x0: pa.x0 - 3 * lh, y0: near - 2, x1: pa.x1 + 3 * lh, y1: reach + 4 };
    } else {
      const left = labs.filter((l) => l.x1 <= pa.x0 + 6);
      const near = left.length ? Math.max(...left.map((l) => l.x1)) : pa.x0 - 0.6 * lh;
      const reach = left.length ? Math.min(...left.map((l) => l.x0)) : pa.x0 - 4 * lh;
      b = { x0: reach - 4, y0: pa.y0 - lh, x1: near + 2, y1: pa.y1 + lh };
    }
    const box = {
      x0: Math.round(Math.max(0, b.x0)), y0: Math.round(Math.max(0, b.y0)),
      x1: Math.round(Math.min(size.width, b.x1)), y1: Math.round(Math.min(size.height, b.y1)),
    };
    if (box.x1 - box.x0 < 4 || box.y1 - box.y0 < 4) continue;
    out.push({ axis, box, factor: Math.max(1, Math.min(6, Math.ceil(32 / Math.max(1, lh)))) });
  }
  return out;
}

/** A word PaddleOCR found in a strip, in the strip's enlarged frame; confidence 0..100. */
export interface BandWord {
  text: string;
  confidence: number;
  bbox: Box;
}

/**
 * The labels' text: each crop's read leads; the strip's read of the same label is a second opinion
 * (agreeing, it raises the confidence; differing, it is an alternative the vetting can try); a word the
 * strip found where the detector boxed no label is a label too (David, 2026-10-19: "let PaddleOCR help
 * us in identifying the region" - measured, all of the strips' gain is these).
 */
export function labelTexts(
  crops: readonly LabelCrop[],
  cropReads: readonly (readonly CropRead[])[],
  bands: readonly LabelBand[],
  bandWords: readonly (readonly BandWord[])[]
): PlacedText[] {
  const fromCrops = cropTexts(crops, cropReads);
  const words: PlacedText[] = [];
  bands.forEach((b, i) => {
    for (const w of bandWords[i] ?? []) {
      const t = w.text.trim();
      if (!t) continue;
      const box = { x0: b.box.x0 + w.bbox.x0 / b.factor, y0: b.box.y0 + w.bbox.y0 / b.factor, x1: b.box.x0 + w.bbox.x1 / b.factor, y1: b.box.y0 + w.bbox.y1 / b.factor };
      words.push({ str: t, box, size: box.y1 - box.y0, confidence: w.confidence, alternatives: [] });
    }
  });
  const used = new Set<PlacedText>();
  const texts = fromCrops.map((c) => {
    const cx = (c.box.x0 + c.box.x1) / 2, cy = (c.box.y0 + c.box.y1) / 2;
    let confidence = c.confidence ?? 0;
    const alternatives = [...(c.alternatives ?? [])];
    for (const w of words) {
      if (cx < w.box.x0 - 2 || cx > w.box.x1 + 2 || cy < w.box.y0 - 2 || cy > w.box.y1 + 2) continue;
      used.add(w);
      if (w.str === c.str) confidence = Math.max(confidence, w.confidence ?? 0);
      else if (!alternatives.includes(w.str)) alternatives.push(w.str);
    }
    return { ...c, confidence, alternatives };
  });
  return [...texts, ...words.filter((w) => !used.has(w))];
}

/**
 * ⚑⚑ LABELS LEAD (David, 2026-10-19: "think about what you need the tick marks for? ... We get the axes
 * and the axis calibration from the axis identification, not the tick marks"). A printed label is centred
 * on its value, so each numeric label's centre, placed on the plot area's edge, is where its value sits;
 * no tick mark is used. Measured on CHART-Info's held-out PMC figures (1,608 axes): 90.2% within 2% of the
 * span, 2.7% wrong, 7.0% refused, against ChartDete's 76.7% / 1.6% / 21.8%; every use of detected or
 * pixel-found tick marks did worse. Tick marks are for category axes (the number of classes).
 */
export function labelTicks(texts: readonly PlacedText[], dets: readonly Detection[], pxPerPt: number): PlacedShape[] {
  const plots = dets.filter((d) => d.cls === 'plot_area');
  if (plots.length === 0) return [];
  const pa = plots.reduce((a, b) => (b.score > a.score ? b : a)).box;
  const h = 2 * pxPerPt;
  const out: PlacedShape[] = [];
  for (const t of texts) {
    if (!/\d/.test(t.str)) continue;
    const cx = (t.box.x0 + t.box.x1) / 2, cy = (t.box.y0 + t.box.y1) / 2;
    let seg: [number, number][] | null = null;
    if (t.box.y0 >= pa.y1 - 4 && cx >= pa.x0 - 20 && cx <= pa.x1 + 20) seg = [[cx, pa.y1 - h], [cx, pa.y1 + h]];
    else if (t.box.x1 <= pa.x0 + 4 && cy >= pa.y0 - 20 && cy <= pa.y1 + 20) seg = [[pa.x0 - h, cy], [pa.x0 + h, cy]];
    if (seg) out.push({ subs: [seg], stroked: true, filled: false, stroke: [0, 0, 0], fill: [0, 0, 0], lineWidth: 1, dash: null, confidence: 1 });
  }
  return out;
}

/** The axes read from a picture: the detector's plot area and label boxes, the crops' reads and the
 * strips' words, labels leading (see `labelTicks`). */
export function pictureAxes(
  dets: readonly Detection[],
  cropReads: readonly (readonly CropRead[])[],
  bandWords: readonly (readonly BandWord[])[],
  size: { width: number; height: number },
  /** The picture's pixels: given, the points are placed on the drawn axis lines (`onAxisLines`). */
  src?: { data: Uint8ClampedArray | Uint8Array; width: number; height: number }
): AxesFromLabels {
  const text = labelTexts(labelCrops(dets, size), cropReads, labelBands(dets, size), bandWords);
  // The rules in labelCalibration.ts are in PDF points; a picture has none, so the labels' own height
  // stands in, taken as 9 pt (the research's scale).
  const heights = text.filter((t) => NUMERIC.test(t.str)).map((t) => t.size);
  const pxPerPt = heights.length ? median(heights) / 9 : 1.2;
  const drawing: PlacedDrawing = { shapes: labelTicks(text, dets, pxPerPt), text: text.map((t) => t.box), pxPerPt };
  const read = picturesOwnWords(readAxesFromLabels(drawing, text, size));
  const plots = dets.filter((d) => d.cls === 'plot_area');
  if (plots.length === 0) return read;
  const pa = plots.reduce((a, b) => (b.score > a.score ? b : a)).box;
  if (!src) return withSecondAxes(read, dets, pa);
  // A) the corners of the data area: the detector's plot area, on the lines the figure draws; B) each
  // axis's range at them, from its labels (`atCorners`)
  const lines = axisLinesNear(src, dets);
  const corners = { x0: lines.y ?? pa.x0, y0: lines.top ?? pa.y0, x1: lines.right ?? pa.x1, y1: lines.x ?? pa.y1 };
  return withSecondAxes(atCorners(onAxisLines(read, lines), corners), dets, pa);
}

/** On a picture each label's own centre is its tick (labels lead), so an axis with no pairs read no
 * numbers at all; "no label sits at a tick mark", the PDF reader's words, would send the user looking
 * for tick marks that play no part (a real figure whose labels were all "95%"-style, 2026-10-19). */
function picturesOwnWords(read: AxesFromLabels): AxesFromLabels {
  const say = (a: AxesFromLabels['x']): AxesFromLabels['x'] =>
    !a.ok && a.reason === 'no label sits at a tick mark' ? { ...a, reason: 'no numbers were read along it' } : a;
  return { ...read, x: say(read.x), y: say(read.y) };
}

/** At least this many of the detector's tick labels beyond the plot's far edge make a second axis there. */
const SECOND_AXIS_LABELS = 2;

/** A second axis on a picture is said, as on a PDF ("A second Y axis along the right is not read"): tick
 * labels the detector found beyond the plot's right edge (or above its top) belong to an axis the read does
 * not take. Measured, not guessed: the labels are there. Found on a real figure with a pH axis on the right. */
function withSecondAxes(read: AxesFromLabels, dets: readonly Detection[], pa: Box): AxesFromLabels {
  const beyond = (cls: string, side: (b: Box) => boolean) => dets.filter((d) => d.cls === cls && d.score >= DETECTION_AT && side(d.box)).length >= SECOND_AXIS_LABELS;
  const right = beyond('y_tick_label', (b) => b.x0 >= pa.x1 - 4);
  const top = beyond('x_tick_label', (b) => b.y1 <= pa.y0 + 4);
  return {
    ...read,
    x: read.x.ok && top && read.x.second === null ? { ...read.x, second: 'top' } : read.x,
    y: read.y.ok && right && read.y.second === null ? { ...read.y, second: 'right' } : read.y,
  };
}

/** How far either side of the detector's edge the strip runs, in pixels. ⚑ `detectDividers` proposes
 * INTERIOR rules only, nothing within its 8 px merge window of the strip's own edges (it was built for a
 * heatmap, whose box edges the user drew), so a strip 20 px each side accepts a line within 12 px of the
 * detector's edge (the run 1 detector's edges: 84-90% within that; ChartDete's 98%). */
const AXIS_REACH = 20;

/**
 * The drawn X and Y axis lines near the detector's plot edges (bottom and left), or null where none is
 * found. ⚑ REUSE: the heatmap grid's own rule finder (algorithms/gridDetect.ts `detectDividers`), on a
 * strip across the plot's width (or height) centred on the edge: a rule is a change running ALL THE WAY
 * across, both edges of a thick rule merged into one at its centre - which is exactly an axis line, and
 * which a tick, a label or a data line, crossing only part of the strip, is not. The strongest rule wins.
 */
export function axisLinesNear(
  src: { data: Uint8ClampedArray | Uint8Array; width: number; height: number },
  dets: readonly Detection[]
): AxisLines {
  const plots = dets.filter((d) => d.cls === 'plot_area');
  if (plots.length === 0) return { x: null, y: null, right: null, top: null };
  const pa = plots.reduce((a, b) => (b.score > a.score ? b : a)).box;
  const r = AXIS_REACH;
  // X axis: a horizontal rule; scan upward across the strip (the box's corners: origin, alongX, alongY, opposite)
  const xs = detectDividers(src.data, src.width, src.height,
    [{ x: pa.x0, y: pa.y1 + r }, { x: pa.x1, y: pa.y1 + r }, { x: pa.x0, y: pa.y1 - r }, { x: pa.x1, y: pa.y1 - r }], 'y');
  // Y axis: a vertical rule; scan rightward across the strip
  const ys = detectDividers(src.data, src.width, src.height,
    [{ x: pa.x0 - r, y: pa.y1 }, { x: pa.x0 + r, y: pa.y1 }, { x: pa.x0 - r, y: pa.y0 }, { x: pa.x0 + r, y: pa.y0 }], 'x');
  // the data area's other two edges: the frame's right and top lines, where the figure draws them
  const rs = detectDividers(src.data, src.width, src.height,
    [{ x: pa.x1 - r, y: pa.y1 }, { x: pa.x1 + r, y: pa.y1 }, { x: pa.x1 - r, y: pa.y0 }, { x: pa.x1 + r, y: pa.y0 }], 'x');
  const ts = detectDividers(src.data, src.width, src.height,
    [{ x: pa.x0, y: pa.y0 + r }, { x: pa.x1, y: pa.y0 + r }, { x: pa.x0, y: pa.y0 - r }, { x: pa.x1, y: pa.y0 - r }], 'y');
  return {
    x: xs.candidates.length ? pa.y1 + r - xs.candidates[0]!.position * 2 * r : null,
    y: ys.candidates.length ? pa.x0 - r + ys.candidates[0]!.position * 2 * r : null,
    right: rs.candidates.length ? pa.x1 - r + rs.candidates[0]!.position * 2 * r : null,
    top: ts.candidates.length ? pa.y0 + r - ts.candidates[0]!.position * 2 * r : null,
  };
}

/** The drawn lines found near the detector's plot edges, in pixels, or null where none was found: `x` the X
 * axis (a row), `y` the Y axis (a column), `right` and `top` the frame's other two sides. */
export interface AxisLines {
  x: number | null;
  y: number | null;
  right: number | null;
  top: number | null;
}

/** The read with its points and ticks moved ACROSS each axis onto the drawn line; along the axis, where
 * the labels put them, nothing changes (that is the calibration). A line not found leaves its axis alone. */
export function onAxisLines(read: AxesFromLabels, lines: AxisLines): AxesFromLabels {
  const mv = (a: AxesFromLabels['x']): AxesFromLabels['x'] => {
    if (!a.ok) return a;
    const line = a.axis === 'x' ? lines.x : lines.y;
    if (line === null) return a;
    return { ...a, pairs: a.pairs.map((p) => ({ ...p, tick: (a.axis === 'x' ? [p.tick[0], line] : [line, p.tick[1]]) as [number, number] })) };
  };
  const points = read.points
    ? read.points.map((p, i) => (i < 2 ? (lines.x === null ? p : { ...p, py: lines.x }) : lines.y === null ? p : { ...p, px: lines.y }))
    : null;
  return { x: mv(read.x), y: mv(read.y), points };
}

/** An axis's scale from its label pairs: value (log10 value on a log axis) against position along it, by
 * least squares over every pair, so one label read a pixel off does not set the range alone. */
function scaleOf(a: AxesFromLabels['x'] & { ok: true }): ((at: number) => number) | null {
  const k = a.axis === 'x' ? 0 : 1;
  const pts = a.pairs.filter((p) => !a.log || p.value > 0).map((p) => [p.tick[k], a.log ? Math.log10(p.value) : p.value] as const);
  if (pts.length < 2) return null;
  const n = pts.length;
  const mx = pts.reduce((s, p) => s + p[0], 0) / n, my = pts.reduce((s, p) => s + p[1], 0) / n;
  const sxx = pts.reduce((s, p) => s + (p[0] - mx) ** 2, 0);
  if (sxx === 0) return null;
  const slope = pts.reduce((s, p) => s + (p[0] - mx) * (p[1] - my), 0) / sxx;
  return (at: number) => {
    const v = my + slope * (at - mx);
    return a.log ? 10 ** v : v;
  };
}

/** A value at a corner, rounded: on a linear axis to a tenth of the label step, on a log axis to three
 * significant figures. It is a translation of a position onto the scale, not a printed number. */
function rounded(a: AxesFromLabels['x'] & { ok: true }, v: number): number {
  if (a.log) return Number(v.toPrecision(3));
  const vals = [...new Set(a.pairs.map((p) => p.value))].sort((p, q) => p - q);
  const steps = vals.slice(1).map((v2, i) => v2 - vals[i]!).sort((p, q) => p - q);
  const step = steps.length ? steps[Math.floor(steps.length / 2)]! : 0;
  if (!(step > 0)) return v;
  const unit = step / 10;
  const decimals = Math.max(0, -Math.floor(Math.log10(unit) + 1e-9));
  return Number((Math.round(v / unit) * unit).toFixed(decimals));
}

/**
 * ⚑⚑ A) THE CORNERS OF THE DATA AREA, B) EACH AXIS'S VALUE RANGE AT THEM (David, 2026-10-19: "Marking the
 * corners of the data area, 3 points is all that is normally required. Then ascribing each axis a value range
 * or category range ... ascribing an axis values is not physically connected to being alongside the markers
 * for the data area"). The labels give each axis its scale; the calibration points go on the corners - X1 =
 * Y1 at the origin, X2 at the X axis's end, Y2 at the Y axis's top - each carrying the value its scale gives
 * there, exactly as the heatmap's shared corners do. `corners` is the data area in pixels: x0 the Y axis, y1
 * the X axis, x1 the X axis's end, y0 the Y axis's top.
 */
export function atCorners(read: AxesFromLabels, corners: Box): AxesFromLabels {
  if (!read.x.ok || !read.y.ok) return { ...read, points: null };
  const sx = scaleOf(read.x), sy = scaleOf(read.y);
  if (!sx || !sy) return { ...read, points: null };
  const xv = (px: number) => rounded(read.x as AxesFromLabels['x'] & { ok: true }, sx(px));
  const yv = (py: number) => rounded(read.y as AxesFromLabels['y'] & { ok: true }, sy(py));
  const { x0, y0, x1, y1 } = corners;
  const origin = { px: x0, py: y1, x: xv(x0), y: yv(y1) };
  return {
    ...read,
    points: [origin, { px: x1, py: y1, x: xv(x1), y: yv(y1) }, { ...origin }, { px: x0, py: y0, x: xv(x0), y: yv(y0) }],
  };
}
