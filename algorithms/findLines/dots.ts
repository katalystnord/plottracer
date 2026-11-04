/**
 * DOTTED LINES (v2.7; docs/v2.7-workflow-walk.md, "Series told apart by their line style").
 *
 * A dotted line is a row of dots, each about one line width across, at a regular spacing: matplotlib's ':' puts them
 * 2.65 line widths apart, ggplot2's "dotted" and R's lty "13" 4. A dot is too small for a centreline with a direction,
 * so the dash-gap pairing, which joins ends that point at each other, never reaches it, and every dot used to be filed
 * as label ink (measured on the dash-coded corpus: dotted series 0-51% read).
 *
 * So dots are chained by their own evidence: blobs no bigger than a dot, each linked to the next at the same spacing
 * and in the same direction, a row of at least six of them. Text does not make such a row; a marker is bigger than a
 * dot. The chain is one line: the dots are its measured points, the spaces between them are bridged, exactly as a
 * dash gap is.
 */
import { label } from './raster.js';
import { norm, sub, type Pt } from './geom.js';
import type { FoundLine, PointRole } from './lines.js';

export interface Dot {
  c: Pt;
  /** Its pixels, as indices into the plane. */
  pix: number[];
}

const MIN_DOTS = 6;
/** How much the spacing may vary along a chain (its coefficient of variation). */
const MAX_SPACING_CV = 0.35;
/** The sharpest turn from one link to the next, radians: a curve bends gently from dot to dot. */
const MAX_TURN = (40 * Math.PI) / 180;

/** The blobs of the ink no bigger than a dot of a line `lw` wide, standing on paper, whose centre `inBox` accepts. */
export function findDots(mask: Uint8Array, w: number, h: number, lw: number, inBox: (p: Pt) => boolean, onPaper: (pix: readonly number[]) => boolean = () => true): Dot[] {
  const { labels, count } = label(mask, w, h, true);
  const minX = new Float64Array(count + 1).fill(Infinity), maxX = new Float64Array(count + 1).fill(-Infinity);
  const minY = new Float64Array(count + 1).fill(Infinity), maxY = new Float64Array(count + 1).fill(-Infinity);
  const pix: number[][] = Array.from({ length: count + 1 }, () => []);
  for (let i = 0; i < w * h; i++) {
    const l = labels[i]!;
    if (!l) continue;
    const x = i % w, y = (i - x) / w;
    if (x < minX[l]!) minX[l] = x;
    if (x > maxX[l]!) maxX[l] = x;
    if (y < minY[l]!) minY[l] = y;
    if (y > maxY[l]!) maxY[l] = y;
    if (pix[l]!.length < 64) pix[l]!.push(i);
  }
  const most = 1.6 * lw + 3;
  const out: Dot[] = [];
  for (let l = 1; l <= count; l++) {
    const wd = maxX[l]! - minX[l]! + 1, ht = maxY[l]! - minY[l]! + 1;
    if (wd > most || ht > most) continue;
    let sx = 0, sy = 0;
    for (const i of pix[l]!) {
      const x = i % w;
      sx += x;
      sy += (i - x) / w;
    }
    const c: Pt = [sx / pix[l]!.length, sy / pix[l]!.length];
    if (inBox(c) && onPaper(pix[l]!)) out.push({ c, pix: pix[l]! });
  }
  return out;
}

function median(v: number[]): number {
  const s = [...v].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
}

/** The rows of dots: each a list of dot indices in order along it. */
export function chainDots(dots: readonly Dot[], lw: number): number[][] {
  const n = dots.length;
  const near = 1.2 * lw, far = 7 * lw + 4;
  // candidate links, shortest first, found through a grid so a page of dots stays fast
  const cell = far;
  const grid = new Map<string, number[]>();
  dots.forEach((d, i) => {
    const k = `${Math.floor(d.c[0] / cell)},${Math.floor(d.c[1] / cell)}`;
    (grid.get(k) ?? grid.set(k, []).get(k)!).push(i);
  });
  const cand: { a: number; b: number; d: number }[] = [];
  dots.forEach((d, i) => {
    const gx = Math.floor(d.c[0] / cell), gy = Math.floor(d.c[1] / cell);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const j of grid.get(`${gx + dx},${gy + dy}`) ?? []) {
          if (j <= i) continue;
          const dd = norm(sub(dots[j]!.c, d.c));
          if (dd >= near && dd <= far) cand.push({ a: i, b: j, d: dd });
        }
      }
    }
  });
  cand.sort((x, y) => x.d - y.d);
  const links: number[][] = Array.from({ length: n }, () => []);
  const root = [...Array(n).keys()];
  const find = (i: number): number => (root[i] === i ? i : (root[i] = find(root[i]!)));
  // a link continues the one already at a dot only if it carries on in about the same direction, at about the same
  // spacing: that is what tells a row of dots from dots that merely lie near each other
  const fits = (at: number, to: number, d: number): boolean => {
    for (const o of links[at]!) {
      const u = sub(dots[o]!.c, dots[at]!.c), v = sub(dots[to]!.c, dots[at]!.c);
      const cos = (u[0] * v[0] + u[1] * v[1]) / (norm(u) * norm(v));
      if (cos > -Math.cos(MAX_TURN)) return false;
      const r = d / norm(u);
      if (r < 0.6 || r > 1.67) return false;
    }
    return true;
  };
  for (const { a, b, d } of cand) {
    if (links[a]!.length >= 2 || links[b]!.length >= 2) continue;
    if (find(a) === find(b)) continue;
    if (!fits(a, b, d) || !fits(b, a, d)) continue;
    links[a]!.push(b);
    links[b]!.push(a);
    root[find(a)] = find(b);
  }
  const seen = new Uint8Array(n);
  const chains: number[][] = [];
  for (let s = 0; s < n; s++) {
    if (seen[s] || links[s]!.length !== 1) continue;
    const chain = [s];
    seen[s] = 1;
    let prev = -1, cur = s;
    for (;;) {
      const next = links[cur]!.find((o) => o !== prev);
      if (next === undefined || seen[next]) break;
      chain.push(next);
      seen[next] = 1;
      prev = cur;
      cur = next;
    }
    if (chain.length < MIN_DOTS) continue;
    const gaps = chain.slice(1).map((k, i) => norm(sub(dots[k]!.c, dots[chain[i]!]!.c)));
    const m = gaps.reduce((s2, g) => s2 + g, 0) / gaps.length;
    const sd = Math.sqrt(gaps.reduce((s2, g) => s2 + (g - m) ** 2, 0) / gaps.length);
    if (sd / m > MAX_SPACING_CV) continue;
    chains.push(chain);
  }
  return joinChains(chains, dots);
}

/** Rows broken where another line crosses and swallows a dot or two: ends that point at each other, at the rows'
 * own spacing, are one row. */
function joinChains(chains: number[][], dots: readonly Dot[]): number[][] {
  const pitch = (ch: number[]): number => median(ch.slice(1).map((k, i) => norm(sub(dots[k]!.c, dots[ch[i]!]!.c))));
  const dir = (ch: number[], end: 0 | 1): Pt => {
    const p = end === 1 ? ch : [...ch].reverse();
    const a = dots[p[Math.max(0, p.length - 4)]!]!.c, b = dots[p[p.length - 1]!]!.c;
    const v = sub(b, a), L = norm(v) || 1;
    return [v[0] / L, v[1] / L];
  };
  const endPt = (ch: number[], end: 0 | 1): Pt => dots[end === 1 ? ch[ch.length - 1]! : ch[0]!]!.c;
  let list = chains.map((c) => [...c]);
  for (let changed = true; changed; ) {
    changed = false;
    let best: { i: number; ei: 0 | 1; j: number; ej: 0 | 1; cost: number } | null = null;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const pi = pitch(list[i]!), pj = pitch(list[j]!);
        if (Math.max(pi, pj) / Math.min(pi, pj) > 1.3) continue;
        for (const ei of [0, 1] as const) {
          for (const ej of [0, 1] as const) {
            const a = endPt(list[i]!, ei), b = endPt(list[j]!, ej);
            const g = sub(b, a), L = norm(g);
            if (L > 6 * Math.max(pi, pj) || L < 1e-6) continue;
            const gh: Pt = [g[0] / L, g[1] / L];
            const ta = dir(list[i]!, ei), tb = dir(list[j]!, ej);
            const ca = ta[0] * gh[0] + ta[1] * gh[1], cb = -(tb[0] * gh[0] + tb[1] * gh[1]);
            if (ca < 0.9 || cb < 0.9) continue;
            const cost = 2 - ca - cb + L / (6 * Math.max(pi, pj));
            if (!best || cost < best.cost) best = { i, ei, j, ej, cost };
          }
        }
      }
    }
    if (best) {
      const a = best.ei === 1 ? list[best.i]! : [...list[best.i]!].reverse();
      const b = best.ej === 0 ? list[best.j]! : [...list[best.j]!].reverse();
      list = list.filter((_, k) => k !== best!.i && k !== best!.j);
      list.push([...a, ...b]);
      changed = true;
    }
  }
  return list;
}

/** A row of dots as a found line: the dots measured, the spaces between them bridged, one pixel apart. */
export function chainToLine(chain: readonly number[], dots: readonly Dot[]): FoundLine {
  const points: Pt[] = [];
  const roles: PointRole[] = [];
  const gaps: [Pt, Pt][] = [];
  chain.forEach((k, i) => {
    const c = dots[k]!.c;
    points.push([c[0], c[1]]);
    roles.push('measured');
    const next = chain[i + 1];
    if (next === undefined) return;
    const d = dots[next]!.c;
    const L = norm(sub(d, c));
    for (let s = 1; s < L; s++) {
      points.push([c[0] + ((d[0] - c[0]) * s) / L, c[1] + ((d[1] - c[1]) * s) / L]);
      roles.push('bridged');
    }
    gaps.push([[c[0], c[1]], [d[0], d[1]]]);
  });
  return { points, roles, closed: false, gaps };
}
