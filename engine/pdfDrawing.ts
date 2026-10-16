/**
 * v2.7 - a PDF page's DRAWING, read from pdf.js's operator list.
 *
 * pdf.js hands over the page as a list of operators and gives no current
 * transformation matrix with them, so this walk keeps its own (save/restore,
 * transform, form XObjects). What comes out is in PDF page space (y up):
 *   - every painted path, as its subpaths of points (curves flattened to 8
 *     segments), with whether it was stroked or filled, its colours, line width,
 *     dash and the clip box in force;
 *   - every picture painted, as the box its unit square lands on.
 *
 * Rebuilt from the v2.7 research reader (plottracer-ref research/v2.7-vector
 * bench/vecread.mjs), which was measured against generated and real figures.
 *
 * ⚑ pdf.js 4.10's constructPath carries [subOps, coords, minMax]; a later
 * pdf.js may change that form, and the tests read real PDFs so they would say.
 */

export interface PdfOperatorList {
  fnArray: readonly number[];
  argsArray: readonly unknown[];
}
/** pdf.js's OPS table (name -> operator number), passed in so engine/ stays free of pdf.js. */
export type PdfOps = Readonly<Record<string, number>>;
export type Pt = [number, number];
type Mat = [number, number, number, number, number, number];

export interface DrawnShape {
  subs: Pt[][];
  stroked: boolean;
  filled: boolean;
  stroke: [number, number, number];
  fill: [number, number, number];
  /** Line width in page units. */
  lineWidth: number;
  dash: number[] | null;
  /** The clip box in force, in page space [x0, y0, x1, y1], or null. */
  clip: [number, number, number, number] | null;
}
export interface PlacedPicture {
  /** The box the picture's unit square lands on, in page space [x0, y0, x1, y1]. */
  box: [number, number, number, number];
}
export interface PageDrawing {
  shapes: DrawnShape[];
  pictures: PlacedPicture[];
}

const mul = (m: Mat, n: readonly number[]): Mat => [
  m[0] * n[0]! + m[2] * n[1]!, m[1] * n[0]! + m[3] * n[1]!,
  m[0] * n[2]! + m[2] * n[3]!, m[1] * n[2]! + m[3] * n[3]!,
  m[0] * n[4]! + m[2] * n[5]! + m[4], m[1] * n[4]! + m[3] * n[5]! + m[5],
];
const ap = (m: Mat, x: number, y: number): Pt => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const rgb = (a: unknown): [number, number, number] => {
  const v = a as ArrayLike<number>;
  return [Number(v[0]), Number(v[1]), Number(v[2])];
};

interface State {
  ctm: Mat;
  stroke: [number, number, number];
  fill: [number, number, number];
  lw: number;
  dash: number[] | null;
  clip: [number, number, number, number] | null;
}

export function readDrawing(ops: PdfOperatorList, OPS: PdfOps): PageDrawing {
  let st: State = { ctm: [1, 0, 0, 1, 0, 0], stroke: [0, 0, 0], fill: [0, 0, 0], lw: 1, dash: null, clip: null };
  const stack: State[] = [];
  let path: Pt[][] | null = null;
  let clipNext = false;
  const shapes: DrawnShape[] = [];
  const pictures: PlacedPicture[] = [];
  const strokes = new Set([OPS['stroke'], OPS['closeStroke'], OPS['fillStroke'], OPS['eoFillStroke'], OPS['closeFillStroke'], OPS['closeEOFillStroke']]);
  const paints = new Set([...strokes, OPS['fill'], OPS['eoFill']]);
  const pictureOps = new Set([OPS['paintImageXObject'], OPS['paintInlineImageXObject'], OPS['paintImageXObjectRepeat']]);

  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i]!;
    const a = ops.argsArray[i] as unknown[] | null;
    if (fn === OPS['save']) stack.push({ ...st });
    else if (fn === OPS['restore']) st = stack.pop() ?? st;
    else if (fn === OPS['transform']) st = { ...st, ctm: mul(st.ctm, a as number[]) };
    else if (fn === OPS['paintFormXObjectBegin']) {
      stack.push({ ...st });
      const m = a?.[0] as number[] | null | undefined;
      if (m) st = { ...st, ctm: mul(st.ctm, m) };
    } else if (fn === OPS['paintFormXObjectEnd']) st = stack.pop() ?? st;
    else if (fn === OPS['setStrokeRGBColor']) st = { ...st, stroke: rgb(a) };
    else if (fn === OPS['setFillRGBColor']) st = { ...st, fill: rgb(a) };
    else if (fn === OPS['setLineWidth']) st = { ...st, lw: Number(a?.[0]) };
    else if (fn === OPS['setDash']) {
      const d = a?.[0] as number[] | undefined;
      st = { ...st, dash: d && d.length ? [...d] : null };
    } else if (pictureOps.has(fn)) {
      const c = [ap(st.ctm, 0, 0), ap(st.ctm, 1, 0), ap(st.ctm, 0, 1), ap(st.ctm, 1, 1)];
      const xs = c.map((p) => p[0]), ys = c.map((p) => p[1]);
      pictures.push({ box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] });
    } else if (fn === OPS['constructPath']) {
      const sub = a![0] as number[];
      const c = a![1] as number[];
      const subs: Pt[][] = path ?? [];
      let cur: Pt[] | null = subs.length ? subs[subs.length - 1]! : null;
      let last: Pt = [0, 0];
      let k = 0;
      const P = (x: number, y: number) => ap(st.ctm, x, y);
      for (const op of sub) {
        if (op === OPS['moveTo']) {
          cur = [P(c[k]!, c[k + 1]!)];
          subs.push(cur);
          last = [c[k]!, c[k + 1]!];
          k += 2;
        } else if (op === OPS['lineTo']) {
          if (!cur) { cur = []; subs.push(cur); }
          cur.push(P(c[k]!, c[k + 1]!));
          last = [c[k]!, c[k + 1]!];
          k += 2;
        } else if (op === OPS['curveTo'] || op === OPS['curveTo2'] || op === OPS['curveTo3']) {
          let p1: Pt, p2: Pt, p3: Pt;
          if (op === OPS['curveTo']) { p1 = [c[k]!, c[k + 1]!]; p2 = [c[k + 2]!, c[k + 3]!]; p3 = [c[k + 4]!, c[k + 5]!]; k += 6; }
          else if (op === OPS['curveTo2']) { p1 = last; p2 = [c[k]!, c[k + 1]!]; p3 = [c[k + 2]!, c[k + 3]!]; k += 4; }
          else { p1 = [c[k]!, c[k + 1]!]; p2 = p3 = [c[k + 2]!, c[k + 3]!]; k += 4; }
          const p0 = last;
          if (!cur) { cur = [P(p0[0], p0[1])]; subs.push(cur); }
          for (let s = 1; s <= 8; s++) {
            const t = s / 8, u = 1 - t;
            const x = u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0];
            const y = u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1];
            cur.push(P(x, y));
          }
          last = p3;
        } else if (op === OPS['closePath']) {
          if (cur && cur.length) cur.push([...cur[0]!] as Pt);
        } else if (op === OPS['rectangle']) {
          const [x, y, w, h] = [c[k]!, c[k + 1]!, c[k + 2]!, c[k + 3]!];
          k += 4;
          cur = [P(x, y), P(x + w, y), P(x + w, y + h), P(x, y + h), P(x, y)];
          subs.push(cur);
          last = [x, y];
        }
      }
      path = subs;
    } else if (paints.has(fn)) {
      if (path) {
        shapes.push({
          subs: path,
          stroked: strokes.has(fn),
          filled: fn !== OPS['stroke'] && fn !== OPS['closeStroke'],
          stroke: st.stroke,
          fill: st.fill,
          lineWidth: st.lw * Math.hypot(st.ctm[0], st.ctm[1]),
          dash: st.dash,
          clip: st.clip,
        });
      }
      path = null;
    } else if (fn === OPS['clip'] || fn === OPS['eoClip']) clipNext = true;
    else if (fn === OPS['endPath']) {
      // A clip: the box of the path that set it, intersected with the one in force.
      if (clipNext && path) {
        const p = path.flat();
        const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]);
        let box: [number, number, number, number] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
        if (st.clip) box = [Math.max(box[0], st.clip[0]), Math.max(box[1], st.clip[1]), Math.min(box[2], st.clip[2]), Math.min(box[3], st.clip[3])];
        st = { ...st, clip: box };
      }
      clipNext = false;
      path = null;
    }
  }
  return { shapes, pictures };
}

/** What the captured figure is (v2.7 V1-V4, docs/v2.7-vector-cases.md). */
export interface FigureKind {
  kind: 'drawn' | 'picture' | 'partly' | 'none';
  /** Drawn shapes whose centre lies in the figure (a page-sized background left out). */
  shapes: number;
  /** Share of the area the figure's shapes and pictures span that pictures cover, 0..1. */
  pictureCover: number;
}

type Box = [number, number, number, number];
const boxOf = (pts: readonly { x: number; y: number }[]): Box => {
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
};
const clipTo = (b: Box, w: number, h: number): Box | null => {
  const c: Box = [Math.max(0, b[0]), Math.max(0, b[1]), Math.min(w, b[2]), Math.min(h, b[3])];
  return c[2] > c[0] && c[3] > c[1] ? c : null;
};

/**
 * Classify the captured figure, the picture `width` x `height`, whose pixels
 * `place` maps page points onto (pageToImage). ⚑ THE RULE IS THE PREVALENCE
 * STUDY'S, unchanged (plottracer-ref research/v2.7-vector/prevalence/
 * classify.py), because it was checked by eye on about 140 crops and its
 * thresholds are what the 32% / 21% figures mean:
 *   picture if cover >= 0.6 and shapes < 40, or shapes < 15 with a picture;
 *   drawn if cover < 0.1 and shapes >= 15; none if cover < 0.1 and shapes < 15;
 *   partly otherwise. Pictures count from 40 x 40 pt.
 */
export function figureKind(
  drawing: PageDrawing,
  place: (p: Pt) => { x: number; y: number } | null,
  width: number,
  height: number,
  pageArea: number,
): FigureKind {
  const corners = (b: Box): Pt[] => [[b[0], b[1]], [b[2], b[1]], [b[0], b[3]], [b[2], b[3]]];
  const placeBox = (b: Box): Box | null => {
    const q = corners(b).map(place);
    if (q.some((p) => !p)) return null;
    return boxOf(q as { x: number; y: number }[]);
  };
  const inside: Box[] = [];
  for (const s of drawing.shapes) {
    const pts = s.subs.flat();
    if (!pts.length) continue;
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const pb: Box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    if ((pb[2] - pb[0]) * (pb[3] - pb[1]) >= 0.9 * pageArea) continue; // a page-sized background
    const c = place([(pb[0] + pb[2]) / 2, (pb[1] + pb[3]) / 2]);
    if (!c || c.x < 0 || c.x > width || c.y < 0 || c.y > height) continue;
    const b = placeBox(pb);
    if (b) inside.push(b);
  }
  const pics: Box[] = [];
  for (const p of drawing.pictures) {
    if (p.box[2] - p.box[0] < 40 || p.box[3] - p.box[1] < 40) continue;
    const b = placeBox(p.box);
    const c = b && clipTo(b, width, height);
    if (c) pics.push(c);
  }
  // Cover is measured against the box the figure's GRAPHICS span, so empty
  // margins in the capture do not dilute it (classify.py does the same).
  let cover = 0;
  const all = [...inside.map((b) => clipTo(b, width, height)).filter((b): b is Box => !!b), ...pics];
  if (pics.length && all.length) {
    const gb: Box = [Math.min(...all.map((b) => b[0])), Math.min(...all.map((b) => b[1])), Math.max(...all.map((b) => b[2])), Math.max(...all.map((b) => b[3]))];
    const N = 100;
    let hit = 0;
    for (let j = 0; j < N; j++) {
      const y = gb[1] + ((j + 0.5) / N) * (gb[3] - gb[1]);
      for (let i = 0; i < N; i++) {
        const x = gb[0] + ((i + 0.5) / N) * (gb[2] - gb[0]);
        if (pics.some((b) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3])) hit++;
      }
    }
    cover = hit / (N * N);
  }
  const n = inside.length;
  const kind: FigureKind['kind'] =
    (cover >= 0.6 && n < 40) || (n < 15 && pics.length >= 1) ? 'picture'
      : cover < 0.1 && n >= 15 ? 'drawn'
        : cover < 0.1 ? 'none'
          : 'partly';
  return { kind, shapes: n, pictureCover: cover };
}

/** The line the calibration card shows for a figure's kind, or null for none
 * (a PNG, JPEG or TIFF has no kind: null). */
export function figureKindLine(k: FigureKind | null): string | null {
  if (!k) return null;
  switch (k.kind) {
    case 'drawn':
      return 'Drawn as vectors in the PDF: Find lines reads its lines from the drawing.';
    case 'picture':
      return 'A picture inside the PDF: read from its pixels, as any image.';
    case 'partly':
      return k.pictureCover >= 0.6
        ? 'Partly a picture: lines and labels are drawn over a picture.'
        : `Partly a picture: a picture covers about ${Math.max(10, Math.round(k.pictureCover * 10) * 10)}% of the figure; the rest is drawn.`;
    case 'none':
      return null;
  }
}

/** pdf.js getTextContent items, the fields used. */
export interface PdfTextItem {
  str: string;
  transform: readonly number[];
  width: number;
}

/** A piece of the page's text: its string, its box in page space [x0, y0, x1,
 * y1] (a rotated label gets the box of its run), and its font size, points. */
export interface PageText {
  str: string;
  box: [number, number, number, number];
  size: number;
}

/** The page's text pieces, the empty ones left out. */
export function readTextItems(items: readonly PdfTextItem[]): PageText[] {
  const out: PageText[] = [];
  for (const t of items) {
    if (!t.str || !t.str.trim()) continue;
    const [a, b, c, d, e, f] = t.transform as [number, number, number, number, number, number];
    const h = Math.hypot(c, d);
    const n = Math.hypot(a, b) || 1;
    const ux = a / n, uy = b / n;
    const q: Pt[] = [[e, f], [e + ux * t.width, f + uy * t.width], [e - uy * h, f + ux * h], [e + ux * t.width - uy * h, f + uy * t.width + ux * h]];
    const xs = q.map((p) => p[0]), ys = q.map((p) => p[1]);
    out.push({ str: t.str, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], size: h });
  }
  return out;
}

/** The box of each piece of the page's text, in page space [x0, y0, x1, y1]
 * (a rotated label gets the box of its run). */
export function readTextBoxes(items: readonly PdfTextItem[]): [number, number, number, number][] {
  return readTextItems(items).map((t) => t.box);
}
