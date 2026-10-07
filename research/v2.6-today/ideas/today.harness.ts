/* What TODAY's tools do on each idea's fixture. Scratch bench, 2026-10-07. */
import { it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { readPng } from './helpers/readPng.js';
import { runColorTrace } from '../colorTraceRun.js';
import { runSegmentFill } from '../segmentFillRun.js';
import { interpolateCurveOrdered } from '../../algorithms/interpolate.js';
type P = { x: number; y: number };
const S = process.env.BENCH_DIR!;
const dense = (pl: number[][]) => { const o: number[][] = []; for (let i = 0; i + 1 < pl.length; i++) { const a = pl[i]!, b = pl[i + 1]!; const n = Math.max(1, Math.ceil(Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!))); for (let k = 0; k < n; k++) o.push([a[0]! + (b[0]! - a[0]!) * k / n, a[1]! + (b[1]! - a[1]!) * k / n]); } return o; };
const dPt = (p: P, pl: number[][]) => { let d = 1e9; for (const q of pl) d = Math.min(d, Math.hypot(q[0]! - p.x, q[1]! - p.y)); return d; };
const dPoly = (q: number[], pts: P[]) => { let d = 1e9; for (let i = 0; i + 1 < pts.length; i++) { const a = pts[i]!, b = pts[i + 1]!; const vx = b.x - a.x, vy = b.y - a.y, L2 = vx * vx + vy * vy || 1; let t = ((q[0]! - a.x) * vx + (q[1]! - a.y) * vy) / L2; t = Math.max(0, Math.min(1, t)); d = Math.min(d, Math.hypot(a.x + t * vx - q[0]!, a.y + t * vy - q[1]!)); } if (pts.length === 1) d = Math.hypot(pts[0]!.x - q[0]!, pts[0]!.y - q[1]!); return d; };
it('today', () => {
  const rows: string[] = ['| figure | target | tool | points | on target % | on ANOTHER curve % | target covered % | longest hole px | worst stray px | lines touched |', '|---|---|---|---|---|---|---|---|---|---|'];
  for (const fig of JSON.parse(readFileSync(S + '/manifest.json', 'utf8')) as string[]) {
    const img = readPng(S + '/' + fig + '.png');
    const T = JSON.parse(readFileSync(S + '/' + fig + '.truth.json', 'utf8'));
    const [bx0, by0, bx1, by1] = T.box as number[];
    const inBox = (q: number[]) => q[0]! >= bx0! + 1 && q[0]! <= bx1! - 1 && q[1]! >= by0! + 1 && q[1]! <= by1! - 1;
    const names = Object.keys(T.curves);
    const D: Record<string, number[][]> = {}; for (const n of names) D[n] = dense(T.curves[n].px).filter(inBox);
    const rgbOf = (n: string) => { const c = T.curves[n].rgb as number[]; return c[0] === 33 ? [51, 51, 51] : c; };
    const score = (target: string, tool: string, pts: P[] | string) => {
      if (typeof pts === 'string') { rows.push(`| ${fig} | ${target} | ${tool} | ${pts} | | | | | | |`); return; }
      const own = D[target]!;
      let on = 0, foreign = 0, stray = 0; const touched = new Set<string>();
      for (const p of pts) { const a = dPt(p, own); let best = a, who = target; for (const m of names) if (m !== target) { const e = dPt(p, D[m]!); if (e < best) { best = e; who = m; } }
        if (a <= 3) on++; else if (best <= 3) foreign++; stray = Math.max(stray, a); if (best <= 3) touched.add(who); }
      let cov = 0, hole = 0, run = 0; for (const q of own) { if (dPoly(q, pts) <= 3) { cov++; run = 0; } else { run++; hole = Math.max(hole, run); } }
      rows.push(`| ${fig} | ${target} | ${tool} | ${pts.length} | ${(100 * on / pts.length).toFixed(0)} | ${(100 * foreign / pts.length).toFixed(0)} | ${(100 * cov / own.length).toFixed(0)} | ${hole} | ${stray.toFixed(1)} | ${touched.size} |`);
    };
    const targets = T.kind === 'band' ? ['upper', 'lower', 'centre'] : names;
    // the place a user would click: on the target, 15% along it, at least 12 px from any other curve
    const seedFor = (n: string) => { const own = D[n]!; for (let i = Math.floor(own.length * 0.15); i < own.length; i++) { const q = own[i]!; if (names.every((m) => m === n || dPt({ x: q[0]!, y: q[1]! }, D[m]!) > 12)) { const px = Math.round(q[0]!), py = Math.round(q[1]!); return { x: px, y: py }; } } return null; };
    for (const n of targets) {
      // 1. By colour, default tolerance, the target's own ink colour (for a filled band: the FILL colour, which is what a user picks)
      const rgb = T.kind === 'band' && fig.includes('fill') ? [198, 220, 236] : rgbOf(n);
      const c = runColorTrace(img.data, img.width, img.height, rgb as any, 60, 'foreground', { x: bx0! + 1, y: by0! + 1, width: bx1! - bx0! - 2, height: by1! - by0! - 2 }) as any;
      score(n, T.kind === 'band' && fig.includes('fill') ? 'By colour (fill)' : 'By colour', c.error ? 'ERROR ' + c.error : c.points);
      // 2. Flood-fill from one click on the target (snapped to the darkest pixel within 2 px, as a user lands ON the line)
      const s = seedFor(n);
      if (s) { let bx = s.x, by = s.y, bv = 1e9; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const i = ((s.y + dy) * img.width + (s.x + dx)) * 4; const v = img.data[i]! + img.data[i + 1]! + img.data[i + 2]!; const tgt = rgb.reduce((a: number, b: number) => a + b, 0); if (Math.abs(v - tgt) < bv) { bv = Math.abs(v - tgt); bx = s.x + dx; by = s.y + dy; } }
        const f = runSegmentFill(img.data, img.width, img.height, bx, by, 40) as any; score(n, 'Flood-fill', f.error ? 'ERROR ' + f.error : f.points); }
      // 3. Guide points: a click every G px where the target is clearly visible (12 px from other curves), +-0.8 px hand error
      for (const G of [40, 80]) {
        const own = D[n]!; const anchors: P[] = []; let last = -1e9; let k = 0;
        for (let i = 0; i < own.length; i++) { const q = own[i]!; const end = i === 0 || i === own.length - 1; if (i - last >= G || end) { const p = { x: q[0]!, y: q[1]! }; if (names.every((m) => m === n || dPt(p, D[m]!) > 12)) { k++; anchors.push({ x: p.x + 0.8 * Math.sin(k * 2.1), y: p.y + 0.8 * Math.cos(k * 1.7) }); last = i; } } }
        score(n, `Guide points, ${anchors.length} clicks`, interpolateCurveOrdered(anchors, 4));
      }
    }
  }
  writeFileSync(S + '/TODAY.md', rows.join('\n') + '\n');
});
