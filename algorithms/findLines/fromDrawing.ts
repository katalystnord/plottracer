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
import type { FindLinesResult, FoundLine, PointRole } from './lines.js';
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
};

const isClosed = (p: readonly Pt[]) => p.length > 2 && Math.hypot(p[0]![0] - p[p.length - 1]![0], p[0]![1] - p[p.length - 1]![1]) < 1e-6;
const near = (a: RGB, b: RGB) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 40;
const inBox = (p: Pt, b: Box) => p[0] >= b.x0 && p[0] <= b.x1 && p[1] >= b.y0 && p[1] <= b.y1;

/** The runs of a polyline inside the box, each cut at the box edge. */
function clipToBox(pts: readonly Pt[], b: Box): Pt[][] {
  const runs: Pt[][] = [];
  let cur: Pt[] = [];
  const cut = (p: Pt, q: Pt): Pt => {
    // the point where p (inside) -> q (outside) leaves the box
    let t = 1;
    const dx = q[0] - p[0], dy = q[1] - p[1];
    if (q[0] < b.x0) t = Math.min(t, (b.x0 - p[0]) / dx);
    if (q[0] > b.x1) t = Math.min(t, (b.x1 - p[0]) / dx);
    if (q[1] < b.y0) t = Math.min(t, (b.y0 - p[1]) / dy);
    if (q[1] > b.y1) t = Math.min(t, (b.y1 - p[1]) / dy);
    return [p[0] + t * dx, p[1] + t * dy];
  };
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const was = i > 0 ? pts[i - 1]! : null;
    if (inBox(p, b)) {
      if (!cur.length && was) cur.push(cut(p, was));
      cur.push(p);
    } else if (cur.length) {
      cur.push(cut(cur[cur.length - 1]!, p));
      runs.push(cur);
      cur = [];
    }
  }
  if (cur.length) runs.push(cur);
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
      if (sp.length === 2 && span < RULE.straight * k) continue; // V27: a tick or a cap
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
  widths.sort((a, b) => a - b);
  return { lines, labelInk: [], unresolved: [], places: [], lineWidth: widths.length ? widths[widths.length >> 1]! : 1 };
}
