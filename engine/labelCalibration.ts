/**
 * v2.7 V5-V10 - the axes read from a drawn figure's own tick labels
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
  /** Set when the vetting changed the value: the label as it was read, and how its value
   * was found instead (another read, or the value its neighbours give its tick mark). */
  vetted?: { read: string; how: 'reread' | 'reassigned' };
}
/** A label or tick mark that was not used, and why. */
export interface UnusedMark {
  /** The label's text, or null for a tick mark with no label. */
  label: string | null;
  box: Box;
  reason: string;
}
export type AxisFromLabels =
  | {
      axis: 'x' | 'y';
      ok: true;
      log: boolean;
      pairs: LabelPair[];
      unused: UnusedMark[];
      /** Which edge of the plot the labels were read along. */
      side: 'bottom' | 'top' | 'left' | 'right';
      /** A second labelled axis on the far edge, not read (David, 2026-10-16:
       * the reader takes the FIRST X and Y; a second axis, another unit, is a
       * special case for calibrating by hand), or null. */
      second: 'top' | 'right' | null;
    }
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
  exponent: boolean;
  box: Box;
  size: number;
  /** 0 to 100; 100 for a PDF's own text. */
  confidence: number;
  alternatives: readonly string[];
}
/** A mark drawn at a value: a tick mark (a short straight stroke) or a
 * gridline (a long one). `at` is its place along the axis, `from`/`to` its
 * extent across it. */
interface Tick {
  at: number;
  from: number;
  to: number;
  grid: boolean;
  /** 0 to 1; 1 for a PDF's own drawing. */
  confidence: number;
}

const NUMBER = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;
const SCALE_FACTOR = /^(1e[+-]?\d+|×\s*10\^[+-]?\d+)$/i;

/** A comma the figure can only mean as a decimal point: "0,04", "1,5",
 * "0,0001" (a leading 0 group, or not three digits after it). */
const DECIMAL_COMMA = /^[+-\u2212]?(0,\d+|\d+,\d{1,2}|\d+,\d{4,})$/;

/** A printed number, the minus sign (U+2212) understood, and commas as the
 * figure uses them: decimal commas when `decimalComma`, else thousands
 * separators ("1,000"). Undecided, "1,250" would be either, so the figure's
 * other labels decide (labelsOf). */
function parseNumber(s: string, decimalComma = false): { value: number } | null {
  let t = s.trim().replace(/\u2212/g, '-').replace(/[\u2009\u202f\u00a0]/g, '');
  if (decimalComma && /^[+-]?\d+,\d+$/.test(t)) t = t.replace(',', '.');
  else if (/^[+-]?[1-9]\d{0,2}(,\d{3})+(\.\d+)?$/.test(t)) t = t.replace(/,/g, '');
  if (!NUMBER.test(t)) return null;
  return { value: Number(t) };
}

/** Pieces of text that touch on one line, at one size, joined when together
 * they make a number: a minus set apart ("\u2212", "2" in LaTeX's 10^{-2}), a
 * decimal comma set as its own piece ("0", ",", "04"). Pieces further apart
 * than a quarter of their size are separate labels. */
function joinTouching(text: readonly PlacedText[]): PlacedText[] {
  const sameLine = (a: PlacedText, b: PlacedText) => {
    const overlap = Math.min(a.box.y1, b.box.y1) - Math.max(a.box.y0, b.box.y0);
    return Math.abs(b.size - a.size) <= 0.15 * a.size && overlap >= 0.5 * Math.min(a.box.y1 - a.box.y0, b.box.y1 - b.box.y0)
      && b.box.x0 >= a.box.x1 - 0.2 * a.size && b.box.x0 <= a.box.x1 + 0.25 * a.size;
  };
  const piece = /^([-\u2212,.]|\d+)$/;
  const used = new Set<number>();
  const out: PlacedText[] = [];
  text.forEach((a, i) => {
    if (used.has(i)) return;
    if (!piece.test(a.str.trim())) {
      out.push(a);
      return;
    }
    // follow the chain of touching pieces to the right
    const chain = [i];
    for (;;) {
      const last = text[chain[chain.length - 1]!]!;
      const j = text.findIndex((b, k) => !used.has(k) && !chain.includes(k) && piece.test(b.str.trim()) && sameLine(last, b));
      if (j < 0) break;
      chain.push(j);
    }
    const str = chain.map((k) => text[k]!.str.trim()).join('');
    if (chain.length > 1 && parseNumber(str, true)) {
      for (const k of chain) used.add(k);
      const bs = chain.map((k) => text[k]!.box);
      const conf = chain.map((k) => text[k]!.confidence).filter((c): c is number => c !== undefined);
      out.push({
        str, size: a.size, box: { x0: Math.min(...bs.map((b) => b.x0)), y0: Math.min(...bs.map((b) => b.y0)), x1: Math.max(...bs.map((b) => b.x1)), y1: Math.max(...bs.map((b) => b.y1)) },
        ...(conf.length ? { confidence: Math.min(...conf) } : {}),
      });
    } else out.push(a);
  });
  return out;
}

/** The page's labels: numbers, with "10" and a smaller raised number after it
 * joined into 10 to that power (V9), and scale factors kept apart (V8). */
function labelsOf(pieces: readonly PlacedText[]): { labels: Label[]; factors: PlacedText[] } {
  const text = joinTouching(pieces);
  const decimalComma = text.some((t) => DECIMAL_COMMA.test(t.str.trim()));
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
    labels.push({ str: `${base}^${e}`, value: (base.startsWith('-') ? -1 : 1) * 10 ** e, exponent: true, box, size: a.size,
      confidence: Math.min(a.confidence ?? 100, text[j]!.confidence ?? 100), alternatives: [] });
  });
  text.forEach((t, i) => {
    if (used.has(i)) return;
    if (SCALE_FACTOR.test(t.str.trim().replace(/\u2212/g, '-'))) {
      factors.push(t);
      return;
    }
    const n = parseNumber(t.str, decimalComma);
    if (n) labels.push({ str: t.str.trim(), value: n.value, exponent: false, box: t.box, size: t.size,
      confidence: t.confidence ?? 100, alternatives: t.alternatives ?? [] });
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
      const confidence = s.confidence ?? 1;
      if (dx <= 0.01 * len) x.push({ at: (p[0] + q[0]) / 2, from: Math.min(p[1], q[1]), to: Math.max(p[1], q[1]), grid, confidence });
      else if (dy <= 0.01 * len) y.push({ at: (p[1] + q[1]) / 2, from: Math.min(p[0], q[0]), to: Math.max(p[0], q[0]), grid, confidence });
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

/** Pairs split where their values turn back or repeat AND the spacing breaks
 * there (over 1.5 times the usual tick spacing, or under 0.6 of it). Stacked or
 * side-by-side panels share an axis line's extent ("... 250, 0 | 1000, 750 ...",
 * the panels touching or apart), and each is an axis of its own. Neither alone
 * is enough: a log axis's spacing is uneven by nature, and an axis printed
 * 0, 2, 4, 9, 8, 10 turns back at an ordinary spacing - one axis, misprinted,
 * which V8 refuses rather than reading half of it. */
function panelRuns<T extends { tick: Tick; label: Label }>(pairs: readonly T[]): T[][] {
  const sorted = [...pairs].sort((a, b) => a.tick.at - b.tick.at);
  if (sorted.length < 3) return [sorted];
  const gaps = sorted.slice(1).map((q, i) => q.tick.at - sorted[i]!.tick.at);
  const usual = [...gaps].sort((a, b) => a - b)[gaps.length >> 1]!;
  const runs: T[][] = [[sorted[0]!]];
  let dir = 0;
  for (let i = 1; i < sorted.length; i++) {
    const run = runs[runs.length - 1]!;
    const d = Math.sign(sorted[i]!.label.value - sorted[i - 1]!.label.value);
    const turns = d === 0 || (dir !== 0 && d !== dir);
    const breaks = gaps[i - 1]! > 1.5 * usual || gaps[i - 1]! < 0.6 * usual;
    if (turns && breaks) {
      runs.push([sorted[i]!]);
      dir = 0;
      continue;
    }
    if (run.length) dir = d;
    run.push(sorted[i]!);
  }
  return runs;
}

/** Whether the pairs fit one scale, and which. Exponent labels fit only a log one. */
function scaleOf(pairs: readonly { tick: Tick; label: Label }[]): 'linear' | 'log' | null {
  if (pairs.length < 2) return null;
  const sorted = [...pairs].sort((a, b) => a.tick.at - b.tick.at);
  const pos = sorted.map((q) => q.tick.at), val = sorted.map((q) => q.label.value);
  if (!sorted.some((q) => q.label.exponent) && fits(pos, val)) return 'linear';
  if (val.every((v) => v > 0) && fits(pos, val.map(Math.log10))) return 'log';
  return null;
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
    // a level label's middle is its digits' middle, about a third of its size
    // above the baseline (its box runs a whole size up, past the digits); a
    // label turned along the axis (R's Y labels) has its run's middle
    const level = l.box.y1 - l.box.y0 <= 1.3 * l.size;
    const mid = axis === 'x' ? (l.box.x0 + l.box.x1) / 2 : level ? l.box.y1 - 0.35 * l.size : (l.box.y0 + l.box.y1) / 2;
    const gap = far ? lo - to : from - hi;
    // just beyond the marks' end; a label's box (its ascenders) may reach a
    // little into an inward tick's line
    if (gap < -Math.max(0.5 * k, 0.15 * l.size) || gap > Math.max(2 * l.size, 12 * k)) continue;
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

/**
 * ⚑⚑ VETTING THE PAIRS BEFORE REFUSING AN AXIS (David, 2026-10-17). Two tick mark /
 * label pairs per axis are enough to calibrate, so one pair that does not fit must not
 * cost the whole axis. If at least two other pairs have HIGH confidence, a pair that
 * disagrees with them is judged incorrect, and then, in his order: check the tick
 * mark's placement; reread the value; if the value is wrong but the mark is in the
 * right place, reassign the value; if none of these is possible, set the pair aside.
 * Measured (plottracer-ref research/v2.7-figdet/FINDINGS.md, vet.py): on 1,141 held-out
 * CHART-Info axes with right tick marks, right offers 87.4% -> 93.4%, wrong 0.9% -> 0.9%.
 *
 * Two guards, proposed after measuring and agreed by David ("yes, try it"): (a) corrections only when
 * the pairs that agree outnumber those that do not (two confident pairs once "corrected" three
 * others); (b) a pair FITS by the engine's own strict tolerance, and a pair a pixel or two off whose
 * mark is on the spacing and whose value is already its neighbours' agrees rather than disagrees.
 *
 * ⚠️ NOT YET AGREED WITH DAVID, each a proposal from that prototype: the HIGH lines below;
 * anchors as the largest agreeing group of at least two; linear or log by which lets more
 * pairs agree; "the right place" as the anchors' own spacing; a reassigned value snapped
 * to the label step. A PDF's text and drawing carry no confidence and count as exact.
 */
const HIGH_LABEL = 80; // OCR confidence, 0..100
const HIGH_MARK = 0.5; // detector confidence, 0..1

interface Vetted {
  pairs: { tick: Tick; label: Label; value: number; vetted?: LabelPair['vetted'] }[];
  aside: { label: Label; reason: string }[];
  scale: 'linear' | 'log';
}

function vetPairs(pairs: readonly { tick: Tick; label: Label }[], row: readonly Tick[], axis: 'x' | 'y', k: number): Vetted | null {
  const strong = pairs.filter((q) => q.label.confidence >= HIGH_LABEL && q.tick.confidence >= HIGH_MARK);
  const span = Math.max(...pairs.map((q) => q.tick.at)) - Math.min(...pairs.map((q) => q.tick.at));
  // finding the anchors allows a picture's pixel noise; whether a pair FITS uses the engine's own
  // strict tolerance (fits()), guard (b), David 2026-10-17
  const tol = Math.max(0.5 * k, 0.005 * span);
  const strict = Math.max(0.5, 0.002 * span);
  type Fit = { a: number; b: number }; // pos = a + b * f(value)
  const lsq = (ps: readonly [number, number][]): Fit | null => {
    const n = ps.length, mv = ps.reduce((s, [, v]) => s + v, 0) / n, mp = ps.reduce((s, [p]) => s + p, 0) / n;
    const svv = ps.reduce((s, [, v]) => s + (v - mv) ** 2, 0);
    if (!(svv > 0)) return null;
    const b = ps.reduce((s, [p, v]) => s + (v - mv) * (p - mp), 0) / svv;
    return b === 0 ? null : { a: mp - b * mv, b };
  };
  let best: { scale: 'linear' | 'log'; f: (v: number) => number; fit: Fit; anchors: typeof pairs[number][]; support: number } | null = null;
  for (const scale of ['linear', 'log'] as const) {
    if (scale === 'linear' && pairs.some((q) => q.label.exponent)) continue;
    if (scale === 'log' && strong.some((q) => q.label.value <= 0)) continue;
    const f = scale === 'log' ? Math.log10 : (v: number) => v;
    let group: typeof pairs[number][] = [];
    for (let i = 0; i < strong.length; i++) {
      for (let j = i + 1; j < strong.length; j++) {
        const fit = lsq([[strong[i]!.tick.at, f(strong[i]!.label.value)], [strong[j]!.tick.at, f(strong[j]!.label.value)]]);
        if (!fit) continue;
        const g = strong.filter((q) => Math.abs(fit.a + fit.b * f(q.label.value) - q.tick.at) <= tol);
        if (g.length > group.length) group = g;
      }
    }
    if (group.length < 2) continue;
    const fit = lsq(group.map((q) => [q.tick.at, f(q.label.value)]));
    if (!fit || group.some((q) => Math.abs(fit.a + fit.b * f(q.label.value) - q.tick.at) > tol)) continue;
    const support = pairs.filter((q) => (scale === 'linear' || q.label.value > 0) && Math.abs(fit.a + fit.b * f(q.label.value) - q.tick.at) <= tol).length;
    if (!best || support > best.support || (support === best.support && group.length > best.anchors.length)) best = { scale, f, fit, anchors: group, support };
  }
  if (!best) return null;
  const { scale, f, fit, anchors } = best;
  const at = (v: number) => fit.a + fit.b * f(v);
  const valueAt = (pos: number) => (pos - fit.a) / fit.b;
  const sorted = [...anchors].sort((p, q) => f(p.label.value) - f(q.label.value));
  const gaps = sorted.slice(1).map((q, i) => f(q.label.value) - f(sorted[i]!.label.value)).filter((g) => g > 1e-12);
  const step = gaps.length ? Math.min(...gaps) : null;
  const base = f(sorted[0]!.label.value);
  // "the right place": where the anchors' spacing puts a mark, within the picture-noise tolerance in
  // pixels (a fraction of a label step can be many pixels and let a broken axis through, measured)
  const onSpacing = (pos: number) => step !== null && Math.abs(at(base + Math.round((valueAt(pos) - base) / step) * step) - pos) <= tol;
  const digits = Math.max(0, ...anchors.map((q) => (String(q.label.value).split('.')[1] ?? '').length));
  const tidy = (v: number) => Number(v.toFixed(Math.min(12, digits + 2)));
  const out: Vetted = { pairs: anchors.map((q) => ({ tick: q.tick, label: q.label, value: q.label.value })), aside: [], scale };
  const taken = new Set(pairs.map((q) => q.tick));
  const mid = (l: Label) => (axis === 'x' ? (l.box.x0 + l.box.x1) / 2 : (l.box.y0 + l.box.y1) / 2);
  const fitsAt = (v: number, pos: number) => (scale === 'linear' || v > 0) && Math.abs(at(v) - pos) <= strict;
  const snapAt = (pos: number) => (step === null ? null : base + Math.round((valueAt(pos) - base) / step) * step);
  // a pair agrees when it fits strictly, or misses only by a picture's pixel noise (guard (b))
  const agrees = (q: typeof pairs[number]) => fitsAt(q.label.value, q.tick.at)
    || ((scale === 'linear' || q.label.value > 0) && Math.abs(at(q.label.value) - q.tick.at) <= tol);
  const others = pairs.filter((q) => !anchors.includes(q));
  const disagree = others.filter((q) => !agrees(q));
  // guard (a), David 2026-10-17: corrections only when the pairs that agree outnumber those that do not
  if (disagree.length >= anchors.length + (others.length - disagree.length)) return null;
  for (const q of others) {
    if (agrees(q)) { out.pairs.push({ tick: q.tick, label: q.label, value: q.label.value }); continue; }
    // 1. the tick mark's placement: off the spacing -> a free mark on it at the label, else aside
    if (!onSpacing(q.tick.at)) {
      const free = row.find((t) => !taken.has(t) && onSpacing(t.at) && Math.abs(t.at - mid(q.label)) <= Math.max(tol, 0.25 * q.label.size)
        && Math.abs(at(q.label.value) - t.at) <= tol);
      if (free) { taken.add(free); out.pairs.push({ tick: free, label: q.label, value: q.label.value }); continue; }
      out.aside.push({ label: q.label, reason: 'it does not fit the other labels, and its tick mark is off their spacing' });
      continue;
    }
    // 2. reread the value
    const alt = q.label.alternatives.map((s) => ({ s, n: parseNumber(s) })).find((r) => r.n && fitsAt(r.n.value, q.tick.at));
    if (alt) { out.pairs.push({ tick: q.tick, label: q.label, value: alt.n!.value, vetted: { read: q.label.str, how: 'reread' } }); continue; }
    // 3. the mark is in the right place, the value is wrong: the value its neighbours give it
    if (step !== null) {
      const v = snapAt(q.tick.at)!;
      if (Math.abs(tidy(scale === 'log' ? 10 ** v : v) - q.label.value) <= 1e-9 * Math.max(1, Math.abs(q.label.value))) {
        out.aside.push({ label: q.label, reason: 'it does not fit the other labels, and its tick mark is off their spacing' });
        continue;
      }
      out.pairs.push({ tick: q.tick, label: q.label, value: tidy(scale === 'log' ? 10 ** v : v), vetted: { read: q.label.str, how: 'reassigned' } });
      continue;
    }
    // 4. none of these
    out.aside.push({ label: q.label, reason: 'it does not fit the other labels, and no other read or value from its neighbours fits it' });
  }
  return out.pairs.length >= 2 ? out : null;
}

function readAxis(axis: 'x' | 'y', ticks: readonly Tick[], labels: readonly Label[], factors: readonly PlacedText[], k: number): AxisFromLabels {
  const tickBox = (t: Tick): Box => (axis === 'x' ? { x0: t.at, y0: t.from, x1: t.at, y1: t.to } : { x0: t.from, y0: t.at, x1: t.to, y1: t.at });
  // every run of every row, labels on either side, is a candidate axis
  const candidates: { row: Tick[]; p: Pairing; scale: 'linear' | 'log' | null }[] = [];
  for (const row of rowsOf(ticks, k)) {
    for (const far of [true, false]) {
      for (const pairs of panelRuns(pairRow(row, labels, axis, far, k).pairs)) {
        if (pairs.length) candidates.push({ row, p: { pairs, far }, scale: scaleOf(pairs) });
      }
    }
  }
  // ⚑ THE FIRST AXIS: X along the bottom, Y along the left, when it reads
  // (David, 2026-10-16); the far edge only when it is the figure's only one.
  // Then the most pairs wins, a candidate that fits one scale before one that
  // does not (four small panels' "-8 0 8" outnumber the main axis but are not
  // one axis), so long as it holds at least half the most pairs; on a tie,
  // tick marks before gridlines
  const first = (c: (typeof candidates)[number]) => (axis === 'x' ? c.p.far : !c.p.far);
  const reads = (c: (typeof candidates)[number]) => !!c.scale && c.p.pairs.length >= 2;
  const most = Math.max(0, ...candidates.map((c) => c.p.pairs.length));
  const mostFirst = Math.max(0, ...candidates.filter(first).map((c) => c.p.pairs.length));
  const rank = (c: (typeof candidates)[number]) => (first(c) && reads(c) && c.p.pairs.length * 2 >= mostFirst ? 2e6 : 0) + (c.scale && c.p.pairs.length * 2 >= most ? 1e6 : 0) + c.p.pairs.length * 2 + (c.row[0]!.grid ? 0 : 1);
  const pick = candidates.reduce<(typeof candidates)[number] | null>((b, c) => (!b || rank(c) > rank(b) ? c : b), null);
  if (!pick) {
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
  let scale = pick.scale;
  if (!scale) {
    const v = vetPairs(p.pairs, row, axis, k);
    if (!v) return no('the labels do not fit one linear or one log scale');
    scale = v.scale;
    pairs.length = 0;
    for (const q of v.pairs) {
      pairs.push({ value: q.value, label: q.label.str, labelBox: q.label.box, tick: (axis === 'x' ? [q.tick.at, end(q.tick)] : [end(q.tick), q.tick.at]) as Pt, ...(q.vetted ? { vetted: q.vetted } : {}) });
    }
    pairs.sort((a, b) => a.value - b.value);
    for (const a of v.aside) unused.push({ label: a.label.str, box: a.label.box, reason: a.reason });
  }
  const log = scale === 'log';
  const side = axis === 'x' ? (p.far ? 'bottom' : 'top') : p.far ? 'right' : 'left';
  const second = first(pick) && candidates.some((c) => !first(c) && reads(c)) ? (axis === 'x' ? 'top' : 'right') : null;
  return { axis, ok: true, log, pairs, unused, side, second };
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
