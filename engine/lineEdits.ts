/**
 * Correcting a line (v2.6, K2-K5): Cut, Join and Move, as pure operations on a
 * series' points, plus the fitting of Find lines' output into series.
 *
 * David, 2026-10-10: Find lines is a FIRST VERSION, so it will sometimes get a
 * line wrong - "we need to have a mechanism or workflow for the user to correct
 * things in an intuitive way". Every mistake it can make is one of four:
 * - two lines in one          -> Cut it where they part
 * - one line in pieces        -> Join the pieces (the gap bridged, drawn as bridged)
 * - points on the wrong line  -> Move them
 * - two curves swapped at a crossing -> Cut both there, Join the right pairs
 *
 * A closed line ends on its first point (S4), which is the only way the record
 * says "closed" - so cutting a closed line OPENS it at the cut instead of making
 * two pieces.
 */
import { hermite, type Pt } from '../algorithms/findLines/geom.js';

export type LinePointRole = 'bridged' | 'shared' | null;

export interface LinePoint {
  x: number;
  y: number;
  role: LinePointRole;
  /** The point's whole per-pixel metadata as the series holds it, carried
   * through every edit so nothing a point says about itself is lost (v2.6
   * audit A1: a rewrite from `role` alone stripped a Guide-points line's
   * anchor / interpolated roles, so spline points exported as measured). */
  meta?: Record<string, unknown>;
}

/** True when the line ends on its first point. */
export function isClosedLine(p: readonly LinePoint[]): boolean {
  if (p.length < 4) return false;
  const a = p[0]!, b = p[p.length - 1]!;
  return a.x === b.x && a.y === b.y;
}

/**
 * Cut a line at point `i`. An open line becomes two: [0..i] and [i..end], both
 * keeping the cut point so neither loses its end. A closed line is opened there
 * instead - one line, starting and ending at the cut.
 */
export function cutLine(p: readonly LinePoint[], i: number): LinePoint[][] {
  if (i < 0 || i >= p.length) return [p.slice()];
  if (isClosedLine(p)) {
    const ring = p.slice(0, -1);
    const k = i % ring.length;
    return [[...ring.slice(k), ...ring.slice(0, k + 1)]];
  }
  if (i === 0 || i === p.length - 1) return [p.slice()];
  return [p.slice(0, i + 1), p.slice(i)];
}

/** Unit direction leaving a line through its last point. */
function tangentOut(p: readonly LinePoint[]): Pt {
  const n = p.length;
  const a = p[Math.max(0, n - 1 - 8)]!, b = p[n - 1]!;
  const dx = b.x - a.x, dy = b.y - a.y;
  const L = Math.hypot(dx, dy);
  return L > 0 ? [dx / L, dy / L] : [0, 0];
}

/**
 * Join two lines into one. Of the four ways their ends can meet, the two
 * nearest ends are joined; the gap between them is filled by the same fair
 * interpolation Find lines uses (a cubic Hermite leaving each end along its own
 * direction) and every filled point is marked bridged.
 */
export function joinLines(a: readonly LinePoint[], b: readonly LinePoint[]): LinePoint[] {
  if (!a.length) return b.slice();
  if (!b.length) return a.slice();
  const rev = (p: readonly LinePoint[]): LinePoint[] => [...p].reverse();
  const options: [LinePoint[], LinePoint[]][] = [
    [a.slice(), b.slice()],
    [a.slice(), rev(b)],
    [rev(a), b.slice()],
    [rev(a), rev(b)],
  ];
  let best = options[0]!, bd = Infinity;
  for (const o of options) {
    const e = o[0][o[0].length - 1]!, s = o[1][0]!;
    const d = Math.hypot(e.x - s.x, e.y - s.y);
    if (d < bd) {
      bd = d;
      best = o;
    }
  }
  const [first, second] = best;
  const e = first[first.length - 1]!, s = second[0]!;
  const t0 = tangentOut(first);
  const t1raw = tangentOut(rev(second));
  const bridge = bd < 1.5 ? [] : hermite([e.x, e.y], t0, [s.x, s.y], [-t1raw[0], -t1raw[1]]);
  // ends that are the SAME point (the two halves of a Cut both keep the cut
  // point) meet once, not twice
  const rest = bd < 1e-9 ? second.slice(1) : second;
  return [...first, ...bridge.map(([x, y]) => ({ x, y, role: 'bridged' as const })), ...rest];
}

/**
 * Where to put a moved point in a line: between the two consecutive points it
 * sits closest to, so the line stays in drawn order.
 */
export function insertionIndex(p: readonly LinePoint[], q: { x: number; y: number }): number {
  if (p.length < 2) return p.length;
  let best = p.length, bd = Infinity;
  for (let i = 0; i < p.length - 1; i++) {
    const a = p[i]!, b = p[i + 1]!;
    const vx = b.x - a.x, vy = b.y - a.y;
    const L2 = vx * vx + vy * vy;
    const t = L2 > 0 ? Math.max(0, Math.min(1, ((q.x - a.x) * vx + (q.y - a.y) * vy) / L2)) : 0;
    const d = Math.hypot(a.x + t * vx - q.x, a.y + t * vy - q.y);
    if (d < bd) {
      bd = d;
      best = i + 1;
    }
  }
  // past either end: extend the line rather than threading the point inside it
  const d0 = Math.hypot(p[0]!.x - q.x, p[0]!.y - q.y);
  const d1 = Math.hypot(p[p.length - 1]!.x - q.x, p[p.length - 1]!.y - q.y);
  if (d0 < bd - 1e-9) return 0;
  if (d1 < bd - 1e-9) return p.length;
  return best;
}

/**
 * A found line as series points: thinned to about one point every `step` px
 * (Find lines works at the pixel), keeping every point where the role changes
 * so a bridged stretch keeps both of its ends, and keeping the closing point.
 */
export function thinFoundLine(points: readonly Pt[], roles: readonly ('measured' | 'bridged' | 'shared')[], step = 2.5): LinePoint[] {
  const toRole = (r: 'measured' | 'bridged' | 'shared'): LinePointRole => (r === 'measured' ? null : r);
  const out: LinePoint[] = [];
  let acc = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const last = i === points.length - 1;
    const change = i > 0 && roles[i] !== roles[i - 1];
    const nextChange = !last && roles[i + 1] !== roles[i];
    if (i > 0) acc += Math.hypot(p[0] - points[i - 1]![0], p[1] - points[i - 1]![1]);
    if (i === 0 || last || change || nextChange || acc >= step) {
      out.push({ x: p[0], y: p[1], role: toRole(roles[i]!) });
      acc = 0;
    }
  }
  return out;
}
