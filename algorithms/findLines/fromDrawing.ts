/**
 * v2.7 V12 - Find lines reading the figure's DRAWING instead of its pixels.
 *
 * Given the PDF's painted paths, already placed in the picture's pixels
 * (engine/drawingPlacement.ts placeDrawing), return what Find lines returns on
 * pixels - lines with a role per point, the gaps bridged - so the card, the
 * series, Undo and Places to check work unchanged (principle 1, mirror).
 *
 * The rules are the research reader's (plottracer-ref research/v2.7-vector,
 * FINDINGS sections 6, 7 and 7b), carried over in PDF POINTS so they mean the
 * same at any render scale. Each one is a case in docs/v2.7-vector-cases.md:
 *   - a stroked path of the colour, its centre inside the plot box, is a line;
 *     its part outside the box is cut off at the box edge (V16);
 *   - a small closed shape is a marker, not a line (V15);
 *   - a path wholly inside a masked area is left out (V17);
 *   - a path whose every segment runs along a side of the box is the frame (V26);
 *   - a straight 2-point segment is a line when it is long enough to be one
 *     (V27), so ticks and caps are left out;
 *   - a dashed path is ONE path, so it is one line (V23);
 *   - pieces of one style whose ends meet heading the same way are joined
 *     across a gap only where something else is drawn in it - text, or a small
 *     drawn shape such as a label drawn in pen strokes (V24); an empty gap
 *     stays a gap. Pieces of different styles are never joined (V25).
 */
import type { Box, RGB } from './ink.js';
import type { FindLinesResult, FoundLine, Place, PointRole } from './lines.js';
import type { Pt } from './geom.js';

/** One painted path of the drawing, already placed in the picture's pixels. */
export interface PlacedShape {
  subs: Pt[][];
  stroked: boolean;
  filled: boolean;
  /** 0-255 */
  stroke: RGB;
  fill: RGB;
  /** Line width, picture px. */
  lineWidth: number;
  dash: readonly number[] | null;
  /** The clip in force when it was painted, picture px; null for none. What
   * lies outside it is not shown. Optional, so a drawing built by hand needs none. */
  clip?: Box | null;
}

export interface PlacedDrawing {
  shapes: PlacedShape[];
  /** The boxes of the page's text, picture px. */
  text: Box[];
  /** Picture pixels per PDF point, so the rules are the same at any render scale. */
  pxPerPt: number;
}

export interface FromDrawingOptions {
  masks?: readonly Box[];
}

/** The research's thresholds, measured at 100 dpi, as PDF points. */
const PT = 72 / 100;
const RULE = {
  /** A closed shape smaller than this across is a marker. */
  marker: 20 * PT,
  /** A segment within this of a box side runs along it (the frame). */
  edge: 3 * PT,
  /** A 2-point segment shorter than this is a tick or a cap. */
  straight: 15 * (72 / 150),
  /** Pieces further apart than this are never joined. */
  gap: 60 * PT,
  /** The most a join may turn, degrees. */
  turn: 60,
  /** A drawn shape smaller than this across can be what sits in a gap. */
  occluder: 15 * PT,
  /** Slack around a text box or shape when asking if it is in the gap. */
  slack: 3 * PT,
  /** Ends closer than this simply meet. */
  meet: 2 * PT,
  /** Lines closer than this along most of their length lie on top of each other. */
  overlap: 1.5,
};

/** Distance from p to the polyline L. */
function nearestOn(p: Pt, L: readonly Pt[]): number {
  let best = Infinity;
  for (let i = 1; i < L.length; i++) {
    const a = L[i - 1]!, b = L[i]!;
    const vx = b[0] - a[0], vy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / (vx * vx + vy * vy || 1)));
    best = Math.min(best, Math.hypot(p[0] - a[0] - t * vx, p[1] - a[1] - t * vy));
  }
  return best;
}
const isClosed = (p: readonly Pt[]) => p.length > 2 && Math.hypot(p[0]![0] - p[p.length - 1]![0], p[0]![1] - p[p.length - 1]![1]) < 1e-6;
const near = (a: RGB, b: RGB) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 40;
const inBox = (p: Pt, b: Box) => p[0] >= b.x0 && p[0] <= b.x1 && p[1] >= b.y0 && p[1] <= b.y1;

/** The part of segment p -> q inside the box, as [t0, t1] along it, or null (Liang-Barsky). */
function clipSegment(p: Pt, q: Pt, b: Box): [number, number] | null {
  let t0 = 0, t1 = 1;
  const dx = q[0] - p[0], dy = q[1] - p[1];
  for (const [den, num] of [[-dx, p[0] - b.x0], [dx, b.x1 - p[0]], [-dy, p[1] - b.y0], [dy, b.y1 - p[1]]] as const) {
    if (den === 0) {
      if (num < 0) return null; // parallel to this side and outside it
      continue;
    }
    const t = num / den;
    if (den < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return null;
  }
  return [t0, t1];
}

/** Short straight pieces chained into dashed lines: each next piece starts
 * close past the last one's end, heading the same way (within 30 degrees) along
 * the line from one to the next, and a run is kept when it has at least four
 * pieces whose dashes and gaps are regular (each within half of the run's
 * typical), every gap a real one, and an extent of three tick lengths. The
 * run's points are every piece's two ends, in order. */
function dashRuns(shorts: readonly { a: Pt; b: Pt; style: string; width: number }[], k: number): { points: Pt[]; style: string; width: number }[] {
  const used = new Set<number>();
  const dir = (p: Pt, q: Pt) => Math.atan2(q[1] - p[1], q[0] - p[0]);
  const turn = (x: number, y: number) => Math.abs(((x - y + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) * 180 / Math.PI;
  const runs: { points: Pt[]; style: string; width: number }[] = [];
  const nextOf = (end: Pt, heading: number, style: string): { i: number; flip: boolean } | null => {
    let best: { i: number; flip: boolean; d: number } | null = null;
    shorts.forEach((s, i) => {
      if (used.has(i) || s.style !== style) return;
      for (const flip of [false, true]) {
        const [a, b] = flip ? [s.b, s.a] : [s.a, s.b];
        const d = Math.hypot(a[0] - end[0], a[1] - end[1]);
        if (d > RULE.straight * k) continue;
        if (turn(dir(a, b), heading) > 30) continue;
        if (d > 0.05 * k && turn(dir(end, a), heading) > 30) continue;
        if (!best || d < best.d) best = { i, flip, d };
      }
    });
    return best;
  };
  shorts.forEach((s0, i0) => {
    if (used.has(i0)) return;
    // grow the run both ways from this piece
    used.add(i0);
    let segs: [Pt, Pt][] = [[s0.a, s0.b]];
    for (const back of [false, true]) {
      for (;;) {
        const last = back ? segs[0]! : segs[segs.length - 1]!;
        const end = back ? last[0] : last[1];
        const heading = back ? dir(last[1], last[0]) : dir(last[0], last[1]);
        const n = nextOf(end, heading, s0.style);
        if (!n) break;
        used.add(n.i);
        const s = shorts[n.i]!;
        const [a, b] = n.flip ? [s.b, s.a] : [s.a, s.b];
        if (back) segs = [[b, a], ...segs];
        else segs.push([a, b]);
      }
    }
    if (segs.length < 4) return; // too few to be a dashed line: ticks, caps
    const dashes = segs.map(([a, b]) => Math.hypot(b[0] - a[0], b[1] - a[1]));
    const gaps = segs.slice(1).map(([a], i) => Math.hypot(a[0] - segs[i]![1][0], a[1] - segs[i]![1][1]));
    const typical = (v: number[]) => [...v].sort((x, y) => x - y)[v.length >> 1]!;
    const regular = (v: number[]) => { const t = typical(v); return v.every((x) => Math.abs(x - t) <= 0.5 * Math.max(t, 0.5 * k)); };
    if (!regular(dashes) || !regular(gaps)) return;
    // a dash leaves a real gap, and a dashed line runs a distance: the strokes
    // of a label drawn in pen (cairo's contour labels) touch and are a few
    // points across
    if (gaps.some((g) => g < 0.25 * k)) return;
    const first = segs[0]![0], last = segs[segs.length - 1]![1];
    if (Math.hypot(last[0] - first[0], last[1] - first[1]) < 3 * RULE.straight * k) return;
    runs.push({ points: segs.flatMap(([a, b]) => [a, b]), style: s0.style, width: s0.width });
  });
  return runs;
}

/** The runs of a polyline inside the box, each cut at the box edge. A segment
 * is clipped by itself, so one that crosses the box with both corners outside
 * (a straight line drawn edge to edge, a box drawn a hair inside the axes)
 * keeps its part inside. */
function clipToBox(pts: readonly Pt[], b: Box): Pt[][] {
  const runs: Pt[][] = [];
  let cur: Pt[] = [];
  const end = () => {
    if (cur.length) runs.push(cur);
    cur = [];
  };
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1]!, q = pts[i]!;
    const c = clipSegment(p, q, b);
    if (!c) {
      end();
      continue;
    }
    const at = (t: number): Pt => (t === 0 ? p : t === 1 ? q : [p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
    if (c[0] > 0) end(); // it enters here: a new run
    if (!cur.length) cur.push(at(c[0]));
    cur.push(at(c[1]));
    if (c[1] < 1) end(); // it leaves here
  }
  end();
  return runs;
}

interface Piece {
  points: Pt[];
  roles: PointRole[];
  gaps: [Pt, Pt][];
  style: string;
}

export function findLinesFromDrawing(d: PlacedDrawing, colour: RGB, box: Box, opts: FromDrawingOptions = {}): FindLinesResult {
  const k = d.pxPerPt;
  const masks = opts.masks ?? [];
  const pieces: Piece[] = [];
  const widths: number[] = [];
  const seen = new Set<string>();
  // short straight pieces, kept aside: a dash written as its own piece (V23)
  const shorts: { a: Pt; b: Pt; style: string; width: number }[] = [];
  const alongSide = (p: Pt, q: Pt) => {
    const e = 2 * RULE.edge * k;
    return Math.abs(p[0] - box.x0) + Math.abs(q[0] - box.x0) < e || Math.abs(p[0] - box.x1) + Math.abs(q[0] - box.x1) < e
      || Math.abs(p[1] - box.y0) + Math.abs(q[1] - box.y0) < e || Math.abs(p[1] - box.y1) + Math.abs(q[1] - box.y1) < e;
  };
  for (const s of d.shapes) {
    if (!s.stroked || !near(s.stroke, colour)) continue;
    const style = `${s.stroke.join(',')}|${s.lineWidth.toFixed(2)}|${s.dash ? s.dash.join(',') : '-'}`;
    for (const sp of s.subs) {
      if (sp.length < 2) continue;
      const xs = sp.map((p) => p[0]), ys = sp.map((p) => p[1]);
      const cx = xs.reduce((a, v) => a + v, 0) / sp.length, cy = ys.reduce((a, v) => a + v, 0) / sp.length;
      if (!inBox([cx, cy], box)) continue;
      if (masks.some((m) => sp.every((p) => inBox(p, m)))) continue; // V17
      const span = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
      const first = sp[0]!, last = sp[sp.length - 1]!;
      const closed = Math.hypot(first[0] - last[0], first[1] - last[1]) < 0.5 * PT * k;
      if (closed && span < RULE.marker * k) continue; // V15: a marker
      if (sp.slice(1).every((q, i) => alongSide(sp[i]!, q))) continue; // V26: the frame
      if (sp.length === 2 && span < RULE.straight * k) {
        // V27: a tick or a cap - unless it is one dash of a line (below)
        if (span >= 0.5 * k) shorts.push({ a: sp[0]!, b: sp[1]!, style, width: s.lineWidth });
        continue;
      }
      // the same path painted twice is one line (a fill and an outline, a redraw)
      const key = `${style}|${sp.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      for (const run of clipToBox(sp, box)) {
        if (run.length < 2) continue;
        pieces.push({ points: run, roles: run.map(() => 'measured'), gaps: [], style });
        widths.push(s.lineWidth);
      }
    }
  }

  // V23: a dashed line written as separate short pieces with no dash array.
  // Pieces of one style laid END TO END along their own direction, with a
  // regular dash and gap, are one dashed line; the gaps are its style, not
  // bridged. Tick marks stand side by side, across the way they repeat, so they
  // never chain. (Found reading ChartDetective, which leaves this to the user.)
  for (const run of dashRuns(shorts, k)) {
    for (const clipped of clipToBox(run.points, box)) {
      if (clipped.length < 2) continue;
      pieces.push({ points: clipped, roles: clipped.map(() => 'measured'), gaps: [], style: run.style });
      widths.push(run.width);
    }
  }

  // What may sit in a gap: the page's text, and any small drawn shape.
  const occluders: Box[] = [...d.text];
  for (const s of d.shapes) for (const sp of s.subs) {
    if (!sp.length) continue;
    const xs = sp.map((p) => p[0]), ys = sp.map((p) => p[1]);
    const b = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
    if (Math.hypot(b.x1 - b.x0, b.y1 - b.y0) < RULE.occluder * k && b.x0 >= box.x0 && b.x1 <= box.x1 && b.y0 >= box.y0 && b.y1 <= box.y1) occluders.push(b);
  }
  const occupied = (a: Pt, b: Pt) => {
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, sl = RULE.slack * k;
    return occluders.some((o) => mx >= o.x0 - sl && mx <= o.x1 + sl && my >= o.y0 - sl && my <= o.y1 + sl);
  };
  const heading = (p: readonly Pt[], end: boolean) => {
    const n = p.length, a = end ? p[n - 1]! : p[0]!, b = end ? p[Math.max(0, n - 4)]! : p[Math.min(n - 1, 3)]!;
    return Math.atan2(a[1] - b[1], a[0] - b[0]);
  };
  const turn = (x: number, y: number) => Math.abs(((x - y + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) * 180 / Math.PI;

  // V24: join pieces of one style across a gap something is drawn in, nearest first.
  for (;;) {
    let best: { i: number; j: number; ea: boolean; eb: boolean; d: number } | null = null;
    for (let i = 0; i < pieces.length; i++) for (let j = 0; j < pieces.length; j++) {
      if (pieces[i]!.style !== pieces[j]!.style) continue;
      const a = pieces[i]!.points, b = pieces[j]!.points;
      // i === j: a line's own two ends, facing each other across a label (a
      // contour loop opened where its label sits); joining them closes it
      if (i === j && (a.length < 4 || isClosed(a))) continue;
      const ends = i === j ? ([[true, false]] as const) : ([[true, false], [true, true], [false, false], [false, true]] as const);
      for (const [ea, eb] of ends) {
        const pa = ea ? a[a.length - 1]! : a[0]!, pb = eb ? b[b.length - 1]! : b[0]!;
        const dist = Math.hypot(pa[0] - pb[0], pa[1] - pb[1]);
        if (dist > RULE.gap * k) continue;
        const out = heading(a, ea), inB = heading(b, eb) + Math.PI;
        const meets = dist <= RULE.meet * k;
        if (meets) {
          if (turn(out, inB) > RULE.turn) continue;
        } else {
          const toB = Math.atan2(pb[1] - pa[1], pb[0] - pa[0]);
          if (turn(out, toB) > RULE.turn || turn(toB, inB) > RULE.turn) continue;
          if (!occupied(pa, pb)) continue;
        }
        if (!best || dist < best.d) best = { i, j, ea, eb, d: dist };
      }
    }
    if (!best) break;
    if (best.i === best.j) {
      const A = pieces[best.i]!;
      const pa = A.points[A.points.length - 1]!, pb = A.points[0]!;
      const bridge: Pt[] = [];
      const n = Math.max(1, Math.round(best.d / (2 * k)));
      for (let s = 1; s < n; s++) bridge.push([pa[0] + ((pb[0] - pa[0]) * s) / n, pa[1] + ((pb[1] - pa[1]) * s) / n]);
      pieces[best.i] = {
        ...A,
        points: [...A.points, ...bridge, pb],
        roles: [...A.roles, ...bridge.map((): PointRole => 'bridged'), 'bridged'],
        gaps: best.d > RULE.meet * k ? [...A.gaps, [pa, pb]] : A.gaps,
      };
      continue;
    }
    const A = pieces[best.i]!, B = pieces[best.j]!;
    const ap = best.ea ? A.points : [...A.points].reverse(), ar = best.ea ? A.roles : [...A.roles].reverse();
    const bp = best.eb ? [...B.points].reverse() : B.points, br = best.eb ? [...B.roles].reverse() : B.roles;
    const pa = ap[ap.length - 1]!, pb = bp[0]!;
    const bridge: Pt[] = [];
    const gaps = [...A.gaps, ...B.gaps];
    if (best.d > RULE.meet * k) {
      // a fair interpolation across the gap, marked bridged, as Find lines does on pixels
      const n = Math.max(1, Math.round(best.d / (2 * k)));
      for (let s = 1; s < n; s++) bridge.push([pa[0] + ((pb[0] - pa[0]) * s) / n, pa[1] + ((pb[1] - pa[1]) * s) / n]);
      gaps.push([pa, pb]);
    }
    const joined: Piece = {
      points: [...ap, ...bridge, ...bp],
      roles: [...ar, ...bridge.map((): PointRole => 'bridged'), ...br],
      gaps,
      style: A.style,
    };
    pieces[best.i] = joined;
    pieces.splice(best.j, 1);
  }

  const lines: FoundLine[] = pieces.map((p) => {
    const f = p.points[0]!, l = p.points[p.points.length - 1]!;
    return { points: p.points, roles: p.roles, closed: p.points.length > 2 && Math.hypot(f[0] - l[0], f[1] - l[1]) < 0.5 * PT * k, gaps: p.gaps };
  });
  // V28: two drawn lines lying on top of each other (a series drawn twice, a
  // dotted path under a solid one) both come back, as drawn, and the place
  // says so - the drawing cannot say which one the figure means.
  const places: Place[] = [];
  const within = RULE.overlap * k;
  const lies = (a: readonly Pt[], b: readonly Pt[]) => a.filter((p) => nearestOn(p, b) <= within).length / a.length;
  for (let i = 0; i < lines.length; i++) for (let j = i + 1; j < lines.length; j++) {
    const A = lines[i]!.points, B = lines[j]!.points;
    const [short, long] = A.length <= B.length ? [A, B] : [B, A];
    if (lies(short, long) >= 0.8) places.push({ kind: 'overlap', at: short[short.length >> 1]!, lines: [i, j] });
  }
  // V14: a line with markers of its colour on it, fewer than its corners -
  // a smoothed curve through its data points, or a marker every few points.
  // Which are the data the drawing cannot say, so the place says so and names
  // the reader that takes the markers (V15); the line stays as read.
  const markers = markersFromDrawing(d, colour, box, masks);
  // each marker belongs to the ONE line it sits closest to (where two lines
  // cross, the other line's marker is near this one too)
  const owner = markers.map((m) => {
    let best = -1, bd = k;
    lines.forEach((L, i) => {
      const dd = nearestOn(m, L.points);
      if (dd <= bd) { bd = dd; best = i; }
    });
    return best;
  });
  lines.forEach((L, i) => {
    const on = markers.filter((_, j) => owner[j] === i);
    if (on.length >= 2 && on.length < L.points.length) {
      places.push({ kind: 'markers', at: on[0]!, lines: [i], counts: { corners: L.points.length, markers: on.length } });
    }
  });
  widths.sort((a, b) => a - b);
  return { lines, labelInk: [], unresolved: [], places, lineWidth: widths.length ? widths[widths.length >> 1]! : 1 };
}

/**
 * v2.7 V15 - the drawing's MARKERS of a colour: one point at each marker's
 * centre, for Auto-extract ▸ By colour ▸ Scattered points on a drawn figure.
 *
 * A marker is a small CLOSED shape (smaller across than RULE.marker), filled in
 * the colour or outlined in it; its centre is the middle of its box, which is
 * the marker's own position for every symmetric marker. One painted twice -
 * filled then outlined, or the same scatter drawn again - lands on the same
 * centre and counts once. Open marks (+, x) are not closed shapes and stay
 * with the pixel reader for now. Markers in a masked area are left out.
 */
export function markersFromDrawing(d: PlacedDrawing, colour: RGB, region: Box, masks: readonly Box[] = []): Pt[] {
  const k = d.pxPerPt;
  // ⚑ A marker painted twice lands on the SAME centre, to a hundredth of a
  // pixel. Two different markers can be a pixel apart (where two lines cross),
  // so "the same" is kept tight - a 1.3 px allowance merged them.
  const same = 0.05 * k;
  const closedWithin = 0.5 * PT * k;
  // every marker, with how it was painted (filled, outlined) and its size
  const found: { c: Pt; how: string }[] = [];
  for (const s of d.shapes) {
    const inkMatches = (s.filled && near(s.fill, colour)) || (s.stroked && near(s.stroke, colour));
    if (!inkMatches) continue;
    for (const sp of s.subs) {
      if (sp.length < 3) continue;
      const first = sp[0]!, last = sp[sp.length - 1]!;
      if (Math.hypot(first[0] - last[0], first[1] - last[1]) > closedWithin) continue; // not closed
      const xs = sp.map((p) => p[0]), ys = sp.map((p) => p[1]);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      if (Math.hypot(x1 - x0, y1 - y0) >= RULE.marker * k) continue; // too big to be a marker
      const c: Pt = [(x0 + x1) / 2, (y0 + y1) / 2];
      if (!inBox(c, region) || masks.some((m) => inBox(c, m))) continue;
      // V16 for markers: one the figure clips away is not shown, so it is not data
      if (s.clip && !inBox(c, s.clip)) continue;
      found.push({ c, how: `${s.filled ? 'F' : ''}${s.stroked ? 'S' : ''}|${((x1 - x0) / k).toFixed(1)}x${((y1 - y0) / k).toFixed(1)}` });
    }
  }
  // ⚑⚑ TWO MARKERS AT ONE SPOT ARE TWO POINTS (tenet 9: integer data ties, and
  // the drawing shows them where the pixels cannot), UNLESS the drawing painted
  // one marker twice: a fill pass and an outline pass, or the whole series
  // drawn again - every marker of that kind repeated the same number of times.
  // (Found reading figverify, whose matplotlib path keeps every placement.)
  const spots: { c: Pt; hows: string[] }[] = [];
  for (const f of found) {
    const at = spots.find((q) => Math.hypot(q.c[0] - f.c[0], q.c[1] - f.c[1]) < same);
    if (at) at.hows.push(f.how);
    else spots.push({ c: f.c, hows: [f.how] });
  }
  // how many times each kind is painted at every one of its spots, when that
  // is the same everywhere (a series drawn n times), else 1
  const times = new Map<string, number>();
  for (const how of new Set(found.map((f) => f.how))) {
    const n = spots.filter((q) => q.hows.includes(how)).map((q) => q.hows.filter((h) => h === how).length);
    times.set(how, n.every((m) => m === n[0]) ? n[0]! : 1);
  }
  const out: Pt[] = [];
  for (const q of spots) {
    // per kind, the repeats beyond its series-wide count are data points; kinds
    // painted over one another at one spot (fill, then outline) are one marker
    const count = Math.max(...[...new Set(q.hows)].map((h) => Math.max(1, Math.round(q.hows.filter((x) => x === h).length / times.get(h)!))));
    for (let i = 0; i < count; i++) out.push(q.c);
  }
  return out;
}
