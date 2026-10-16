/**
 * v2.7 V5-V11 - the axes read from a drawn figure's own tick labels
 * (docs/v2.7-vector-cases.md, "Calibration read from the labels").
 *
 * In a PDF the tick labels are real text at real positions and the tick marks
 * are real strokes, so the calibration can be READ: each label is paired with
 * the tick mark drawn at it, and the pairs give the four calibration points a
 * user would click and type. The research reader's lessons (plottracer-ref
 * research/v2.7-vector/FINDINGS.md): calibrate from the label text, refuse
 * rather than guess, and pair each label with its own tick mark.
 *
 *   - a tick mark is a short straight stroke across an axis; the marks of one
 *     axis share their extent across it, so they are grouped by it (V7). A
 *     gridline is a mark drawn at the value too, and serves where a figure
 *     draws no tick marks (LibreOffice by default);
 *   - a label is paired with a tick mark when its middle lies on the mark's
 *     line and it sits just beyond the mark's end; a label with no mark at it,
 *     and a mark with no label, are listed as not used, with the reason (V7);
 *   - an axis with fewer than two pairs, or whose pairs fit neither one linear
 *     nor one log scale, is refused with the reason; so is an axis with a scale
 *     factor printed by it ("1e6"), whose labels are not the values (V8);
 *   - "10" with a smaller raised number after it is 10 to that power, and an
 *     axis of them is log (V9);
 *   - the labels' printed digits say how precisely they pin the scale (V11).
 */
import type { PlacedDrawing } from '../algorithms/findLines/fromDrawing.js';
import type { PlacedText } from './drawingPlacement.js';

type Pt = [number, number];
type Box = { x0: number; y0: number; x1: number; y1: number };

/** A label paired with the tick mark drawn at it. */
export interface LabelPair {
  value: number;
  /** The label as read, an exponent written `10^3`. */
  label: string;
  labelBox: Box;
  /** The tick mark's end on the axis line (the end away from the label), picture px. */
  tick: Pt;
}
/** A label or tick mark that was not used, and why. */
export interface UnusedMark {
  /** The label's text, or null for a tick mark with no label. */
  label: string | null;
  box: Box;
  reason: string;
}
export type AxisFromLabels =
  | { axis: 'x' | 'y'; ok: true; log: boolean; pairs: LabelPair[]; unused: UnusedMark[]; precision: number }
  | { axis: 'x' | 'y'; ok: false; reason: string; pairs: LabelPair[]; unused: UnusedMark[] };
export interface AxesFromLabels {
  x: AxisFromLabels;
  y: AxisFromLabels;
  /** The calibration's four points (x1, x2, y1, y2) when both axes were read, else null. */
  points: { px: number; py: number; x: number; y: number }[] | null;
}

/** A label candidate: a number as printed, or 10 to a printed power. */
interface Label {
  str: string;
  value: number;
  /** Digits after the decimal point, as printed. */
  decimals: number;
  exponent: boolean;
  box: Box;
  size: number;
}
/** A mark drawn at a value: a tick mark (a short straight stroke) or a
 * gridline (a long one). `at` is its place along the axis, `from`/`to` its
 * extent across it. */
interface Tick {
  at: number;
  from: number;
  to: number;
  grid: boolean;
}

const NUMBER = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;
const SCALE_FACTOR = /^(1e[+-]?\d+|×\s*10\^[+-]?\d+)$/i;

/** A printed number, the minus sign (U+2212) and thousands commas understood. */
function parseNumber(s: string): { value: number; decimals: number } | null {
  let t = s.trim().replace(/\u2212/g, '-').replace(/[\u2009\u202f\u00a0]/g, '');
  if (/^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) t = t.replace(/,/g, '');
  if (!NUMBER.test(t)) return null;
  const mantissa = t.split(/[eE]/)[0]!;
  const dot = mantissa.indexOf('.');
  return { value: Number(t), decimals: dot < 0 ? 0 : mantissa.length - dot - 1 };
}

/** The page's labels: numbers, with "10" and a smaller raised number after it
 * joined into 10 to that power (V9), and scale factors kept apart (V8). */
function labelsOf(text: readonly PlacedText[]): { labels: Label[]; factors: PlacedText[] } {
  const used = new Set<number>();
  const labels: Label[] = [];
  const factors: PlacedText[] = [];
  text.forEach((a, i) => {
    const base = a.str.trim().replace(/\u2212/g, '-');
    if (base !== '10' && base !== '-10' && base !== '×10' && base !== '×\u200910') return;
    // the exponent: smaller, starting at the base's right end, raised above its baseline
    const j = text.findIndex((b, k) => {
      if (k === i || used.has(k)) return false;
      const n = parseNumber(b.str);
      return !!n && Number.isInteger(n.value) && b.size < 0.85 * a.size
        && b.box.x0 >= a.box.x1 - 0.3 * a.size && b.box.x0 <= a.box.x1 + 0.5 * a.size
        && b.box.y1 < a.box.y1 - 0.25 * a.size && b.box.y0 >= a.box.y0 - a.size;
    });
    if (j < 0) return;
    used.add(i).add(j);
    const e = parseNumber(text[j]!.str)!.value;
    const b = text[j]!.box;
    const box = { x0: Math.min(a.box.x0, b.x0), y0: Math.min(a.box.y0, b.y0), x1: Math.max(a.box.x1, b.x1), y1: Math.max(a.box.y1, b.y1) };
    if (base.startsWith('×')) {
      factors.push({ str: `×10^${e}`, box, size: a.size });
      return;
    }
    labels.push({ str: `${base}^${e}`, value: (base.startsWith('-') ? -1 : 1) * 10 ** e, decimals: 0, exponent: true, box, size: a.size });
  });
  text.forEach((t, i) => {
    if (used.has(i)) return;
    if (SCALE_FACTOR.test(t.str.trim().replace(/\u2212/g, '-'))) {
      factors.push(t);
      return;
    }
    const n = parseNumber(t.str);
    if (n) labels.push({ str: t.str.trim(), value: n.value, decimals: n.decimals, exponent: false, box: t.box, size: t.size });
  });
  return { labels, factors };
}

/** The straight strokes across each axis: vertical ones for X, horizontal ones for Y. */
function ticksOf(d: PlacedDrawing, size: { width: number; height: number }): { x: Tick[]; y: Tick[] } {
  const k = d.pxPerPt;
  const x: Tick[] = [], y: Tick[] = [];
  const inside = (p: Pt) => p[0] >= 0 && p[0] <= size.width && p[1] >= 0 && p[1] <= size.height;
  for (const s of d.shapes) {
    if (!s.stroked) continue;
    for (const sp of s.subs) {
      if (sp.length !== 2) continue;
      const [p, q] = sp as [Pt, Pt];
      if (!inside(p) || !inside(q)) continue;
      const dx = Math.abs(q[0] - p[0]), dy = Math.abs(q[1] - p[1]);
      const len = Math.hypot(dx, dy);
      if (len < 0.8 * k) continue;
      const grid = len > 12 * k;
      if (dx <= 0.01 * len) x.push({ at: (p[0] + q[0]) / 2, from: Math.min(p[1], q[1]), to: Math.max(p[1], q[1]), grid });
      else if (dy <= 0.01 * len) y.push({ at: (p[1] + q[1]) / 2, from: Math.min(p[0], q[0]), to: Math.max(p[0], q[0]), grid });
    }
  }
  return { x, y };
}

/** Tick marks grouped into rows that share their extent across the axis; the
 * same mark painted twice counts once. */
function rowsOf(ticks: readonly Tick[], k: number): Tick[][] {
  const rows: Tick[][] = [];
  const near = 0.25 * k;
  for (const t of [...ticks].sort((a, b) => a.at - b.at)) {
    const row = rows.find((r) => Math.abs(r[0]!.from - t.from) <= near && Math.abs(r[0]!.to - t.to) <= near);
    if (!row) rows.push([t]);
    else if (!row.some((u) => Math.abs(u.at - t.at) < 0.05 * k)) row.push(t);
  }
  return rows;
}

interface Pairing {
  pairs: { tick: Tick; label: Label }[];
  /** Which side of the marks the labels sit: true for the far side (below X, right of Y). */
  far: boolean;
}

/** Pair each label with the tick mark of `row` drawn at it, on one side. */
function pairRow(row: readonly Tick[], labels: readonly Label[], axis: 'x' | 'y', far: boolean, k: number): Pairing {
  const from = row[0]!.from, to = row[0]!.to;
  const best = new Map<Tick, { label: Label; off: number }>();
  for (const l of labels) {
    const [lo, hi] = axis === 'x' ? [l.box.y0, l.box.y1] : [l.box.x0, l.box.x1];
    const mid = axis === 'x' ? (l.box.x0 + l.box.x1) / 2 : (l.box.y0 + l.box.y1) / 2;
    const gap = far ? lo - to : from - hi;
    if (gap < -0.5 * k || gap > Math.max(2 * l.size, 12 * k)) continue; // not just beyond the marks' end
    const tol = Math.max(0.5 * k, 0.2 * l.size);
    let tick: Tick | null = null, off = Infinity;
    for (const t of row) {
      const o = Math.abs(t.at - mid);
      if (o <= tol && o < off) { tick = t; off = o; }
    }
    if (!tick) continue;
    const had = best.get(tick);
    if (!had || off < had.off) best.set(tick, { label: l, off });
  }
  return { pairs: [...best].map(([tick, { label }]) => ({ tick, label })), far };
}

/** Does one linear or one log scale fit the pairs? Positions in px against
 * values, every pair within half a pixel (or 0.2% of their span) of the fit. */
function fits(pos: readonly number[], val: readonly number[]): boolean {
  const n = pos.length;
  const mv = val.reduce((a, v) => a + v, 0) / n, mp = pos.reduce((a, v) => a + v, 0) / n;
  let sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (val[i]! - mv) ** 2;
    sxy += (val[i]! - mv) * (pos[i]! - mp);
  }
  if (sxx === 0 || sxy === 0) return false;
  const b = sxy / sxx, a = mp - b * mv;
  const span = Math.max(...pos) - Math.min(...pos);
  if (span <= 0) return false;
  const tol = Math.max(0.5, 0.002 * span);
  return pos.every((p, i) => Math.abs(a + b * val[i]! - p) <= tol);
}

const unionBox = (bs: readonly Box[]): Box => ({
  x0: Math.min(...bs.map((b) => b.x0)), y0: Math.min(...bs.map((b) => b.y0)),
  x1: Math.max(...bs.map((b) => b.x1)), y1: Math.max(...bs.map((b) => b.y1)),
});

function readAxis(axis: 'x' | 'y', ticks: readonly Tick[], labels: readonly Label[], factors: readonly PlacedText[], k: number): AxisFromLabels {
  const tickBox = (t: Tick): Box => (axis === 'x' ? { x0: t.at, y0: t.from, x1: t.at, y1: t.to } : { x0: t.from, y0: t.at, x1: t.to, y1: t.at });
  const rows = rowsOf(ticks, k);
  let pick: { row: Tick[]; p: Pairing } | null = null;
  for (const row of rows) {
    for (const far of [true, false]) {
      const p = pairRow(row, labels, axis, far, k);
      // the most pairs wins; on a tie, tick marks before gridlines
      if (!pick || p.pairs.length > pick.p.pairs.length || (p.pairs.length === pick.p.pairs.length && pick.row[0]!.grid && !row[0]!.grid)) pick = { row, p };
    }
  }
  if (!pick || !pick.p.pairs.length) {
    return { axis, ok: false, reason: 'no label sits at a tick mark', pairs: [], unused: [] };
  }
  const { row, p } = pick;
  // the end on the axis line: a tick mark's end away from its label (a tick
  // drawn outward starts at the axis), a gridline's end nearest it
  const end = (t: Tick) => (p.far !== t.grid ? t.from : t.to);
  const pairs: LabelPair[] = p.pairs
    .map(({ tick, label }) => ({
      value: label.value,
      label: label.str,
      labelBox: label.box,
      tick: (axis === 'x' ? [tick.at, end(tick)] : [end(tick), tick.at]) as Pt,
    }))
    .sort((a, b) => a.value - b.value); // as a reader lists them, lowest first
  // what lies along this axis but was not used: marks on the same axis line
  // with no label (minor ticks), and numbers in the label band with no mark
  const axisLine = end(row[0]!);
  const unused: UnusedMark[] = [];
  const paired = new Set(p.pairs.map((q) => q.tick));
  for (const t of ticks) {
    if (paired.has(t) || paired.has(row.find((u) => Math.abs(u.at - t.at) < 0.05 * k)!)) continue;
    const onLine = Math.abs(end(t) - axisLine) <= 0.25 * k;
    if (onLine && !unused.some((u) => u.label === null && Math.abs((axis === 'x' ? u.box.x0 : u.box.y0) - t.at) < 0.05 * k)) {
      unused.push({ label: null, box: tickBox(t), reason: 'no label at it' });
    }
  }
  const band = unionBox(p.pairs.map((q) => q.label.box));
  const usedLabels = new Set(p.pairs.map((q) => q.label));
  for (const l of labels) {
    if (usedLabels.has(l)) continue;
    const across = axis === 'x' ? l.box.y0 <= band.y1 && l.box.y1 >= band.y0 : l.box.x0 <= band.x1 && l.box.x1 >= band.x0;
    if (across) unused.push({ label: l.str, box: l.box, reason: 'no tick mark at it' });
  }
  const no = (reason: string): AxisFromLabels => ({ axis, ok: false, reason, pairs, unused });
  // a scale factor by the axis means its labels are not the values (V8)
  const reach = 3 * Math.max(...p.pairs.map((q) => q.label.size));
  const around = unionBox([band, ...p.pairs.map((q) => tickBox(q.tick))]);
  const factor = factors.find((f) => f.box.x1 >= around.x0 - reach && f.box.x0 <= around.x1 + reach && f.box.y1 >= around.y0 - reach && f.box.y0 <= around.y1 + reach);
  if (factor) return no(`a scale factor (${factor.str.trim()}) is printed by the axis, so the labels are not the values`);
  if (pairs.length < 2) return no('only one label sits at a tick mark; two are needed');
  const pos = pairs.map((q) => (axis === 'x' ? q.tick[0] : q.tick[1]));
  const val = pairs.map((q) => q.value);
  const exponent = p.pairs.some((q) => q.label.exponent);
  const linear = !exponent && fits(pos, val);
  const log = !linear && val.every((v) => v > 0) && fits(pos, val.map(Math.log10));
  if (!linear && !log) return no('the labels do not fit one linear or one log scale');
  const decimals = Math.max(...p.pairs.map((q) => q.label.decimals));
  return { axis, ok: true, log, pairs, unused, precision: 5 / 10 ** (decimals + 1) };
}

/** The two pairs furthest apart, for the calibration's two points on an axis. */
function outermost(a: AxisFromLabels & { ok: true }): [LabelPair, LabelPair] {
  return [a.pairs[0]!, a.pairs[a.pairs.length - 1]!];
}

/**
 * Read the axes of a drawn figure from its tick labels and tick marks. `d` and
 * `text` are the page's drawing and text placed in the picture
 * (placeDrawing, placeTextItems); only what lies in the picture is read.
 */
export function readAxesFromLabels(d: PlacedDrawing, text: readonly PlacedText[], size: { width: number; height: number }): AxesFromLabels {
  const k = d.pxPerPt;
  // a label's middle in the picture: a label may run a little past the page's edge
  const inPicture = (b: Box) => (b.x0 + b.x1) / 2 >= 0 && (b.y0 + b.y1) / 2 >= 0 && (b.x0 + b.x1) / 2 <= size.width && (b.y0 + b.y1) / 2 <= size.height;
  const { labels, factors } = labelsOf(text.filter((t) => inPicture(t.box)));
  const ticks = ticksOf(d, size);
  const x = readAxis('x', ticks.x, labels, factors, k);
  const y = readAxis('y', ticks.y, labels, factors, k);
  let points: AxesFromLabels['points'] = null;
  if (x.ok && y.ok) {
    const [x1, x2] = outermost(x), [y1, y2] = outermost(y);
    points = [
      { px: x1.tick[0], py: x1.tick[1], x: x1.value, y: 0 },
      { px: x2.tick[0], py: x2.tick[1], x: x2.value, y: 0 },
      { px: y1.tick[0], py: y1.tick[1], x: 0, y: y1.value },
      { px: y2.tick[0], py: y2.tick[1], x: 0, y: y2.value },
    ];
  }
  return { x, y, points };
}
