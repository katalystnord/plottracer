import { it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { readPng } from './helpers/readPng.js';
import { runColorTrace } from '../colorTraceRun.js';
const S = process.env.BENCH_DIR!;
it('rungs', () => {
  const rows: string[] = ['figure | curve | points | from another curve | furthest from truth px | out-of-order steps | longest missed px | covered %'];
  const dense = (pl: number[][]) => { const o: number[][] = []; for (let i = 0; i + 1 < pl.length; i++) { const a = pl[i]!, b = pl[i + 1]!; const n = Math.max(1, Math.ceil(Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!))); for (let k = 0; k < n; k++) o.push([a[0]! + (b[0]! - a[0]!) * k / n, a[1]! + (b[1]! - a[1]!) * k / n]); } return o; };
  const near = (p: {x:number;y:number}, pl: number[][]) => { let d = 1e9, idx = 0; for (let i = 0; i < pl.length; i++) { const q = pl[i]!; const e = Math.hypot(q[0]! - p.x, q[1]! - p.y); if (e < d) { d = e; idx = i; } } return { d, idx }; };
  for (const fig of JSON.parse(readFileSync(S + '/manifest.json', 'utf8')) as string[]) {
    const img = readPng(S + '/' + fig + '.png');
    const truth = JSON.parse(readFileSync(S + '/' + fig + '.truth.json', 'utf8'));
    const names = Object.keys(truth);
    const D: Record<string, number[][]> = {}; for (const n of names) D[n] = dense(truth[n].px);
    for (const n of names) {
      const res = runColorTrace(img.data, img.width, img.height, truth[n].rgb, 60) as any;
      if (res.error) { rows.push([fig, n, 'ERROR: ' + res.error].join(' | ')); continue; }
      const pts = res.points as {x:number;y:number}[]; const own = D[n]!;
      let wrong = 0, maxD = 0, back = 0, prev = -1;
      for (const p of pts) { const a = near(p, own); let od = 1e9; for (const m of names) if (m !== n) od = Math.min(od, near(p, D[m]!).d); if (a.d > 3 && od < 1.5) wrong++; maxD = Math.max(maxD, a.d); if (prev >= 0 && a.idx < prev - 3) back++; prev = a.idx; }
      let gap = 0, run = 0, cov = 0;
      for (const q of own) { let d = 1e9; for (const p of pts) d = Math.min(d, Math.hypot(p.x - q[0]!, p.y - q[1]!)); if (d > 3) { run++; gap = Math.max(gap, run); } else { run = 0; cov++; } }
      rows.push([fig, n, pts.length, wrong, maxD.toFixed(1), back, gap, (100 * cov / own.length).toFixed(1)].join(' | '));
    }
  }
  writeFileSync(S + '/rungs.result.md', rows.join('\n') + '\n');
});
