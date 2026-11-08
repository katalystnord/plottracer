// A STUDY, not a test: how well a legend sample's marker picks out its series' markers in the plot. It is the
// instrument behind docs/v2.7-workflow-walk.md, "Measured (algorithms/markerShape.ts ...)". It asserts nothing and
// the real-figure parts read the plottracer-benchmarks checkout, so it runs only when asked:
//   STUDY=1 npx vitest run algorithms/__tests__/markerStudy.measure.test.ts
import fs from 'node:fs';
import { it as vitestIt } from 'vitest';
import { readPng } from '../../engine/__tests__/helpers/readPng.js';
import { inkTest, paperColour } from '../lineStyle.js';
import { label } from '../findLines/raster.js';
import { markerShape, markerDistance, type MarkerShape } from '../markerShape.js';


const it = vitestIt.runIf(!!process.env.STUDY);
const DIR = 'algorithms/__tests__/fixtures/markers';
type Fig = { kind: string; box: number[]; legend: number[]; series: { name: string; ink: [number, number, number]; marker: string; fill: string; markers: [number, number][]; sample: number[] }[] };

it('measure', () => {
  const rows: string[] = [];
  let allRight = 0, allN = 0;
  for (const f of fs.readdirSync(DIR).filter((n) => n.endsWith('.json')).sort()) {
    const t = JSON.parse(fs.readFileSync(`${DIR}/${f}`, 'utf8')) as Fig;
    if (t.kind !== 'scatter') continue;
    const img = readPng(`${DIR}/${f.replace('.json', '.png')}`);
    const { width: w, height: h } = img;
    const ink = inkTest(img.data, w, h, t.series[0]!.ink, paperColour(img.data, w, h));
    const mask = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (ink(x, y)) mask[y * w + x] = 1;
    const { labels, count } = label(mask, w, h, true);
    const pix: number[][] = Array.from({ length: count + 1 }, () => []);
    for (let i = 0; i < w * h; i++) if (labels[i]) pix[labels[i]!]!.push(i);
    const inBox = (i: number, b: number[], pad = 0) => {
      const x = i % w, y = (i - x) / w;
      return x >= b[0]! - pad && x <= b[2]! + pad && y >= b[1]! - pad && y <= b[3]! + pad;
    };
    // each entry's sample marker: the piece of ink nearest the middle of its sample box
    const samples: (MarkerShape | null)[] = t.series.map((s) => {
      const c = [(s.sample[0]! + s.sample[2]!) / 2, (s.sample[1]! + s.sample[3]!) / 2];
      let best: number[] | null = null, bd = Infinity;
      for (let l = 1; l <= count; l++) {
        const p = pix[l]!;
        if (!p.length || !inBox(p[0]!, s.sample, 6)) continue;
        const x = p[0]! % w, y = (p[0]! - x) / w;
        const d = Math.hypot(x - c[0]!, y - c[1]!);
        if (d < bd) { bd = d; best = p; }
      }
      return best ? markerShape(best, w) : null;
    });
    // each blob in the plot that holds exactly one true marker: which sample is it nearest?
    let right = 0, n = 0, merged = 0;
    const conf = t.series.map(() => t.series.map(() => 0));
    for (let l = 1; l <= count; l++) {
      const p = pix[l]!;
      if (p.length < 4 || !inBox(p[0]!, t.box) || inBox(p[0]!, t.legend, 2)) continue;
      let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
      for (const i of p) { const x = i % w, y = (i - x) / w; mnx = Math.min(mnx, x); mxx = Math.max(mxx, x); mny = Math.min(mny, y); mxy = Math.max(mxy, y); }
      const inside = t.series.flatMap((s, si) => s.markers.filter(([x, y]) => x >= mnx - 0.5 && x <= mxx + 1.5 && y >= mny - 0.5 && y <= mxy + 1.5).map(() => si));
      if (inside.length !== 1) { if (inside.length > 1) merged++; continue; }
      const sh = markerShape(p, w)!;
      const d = samples.map((s) => (s ? markerDistance(sh, s) : Infinity));
      const k = d.indexOf(Math.min(...d));
      conf[inside[0]!]![k]!++;
      n++;
      if (k === inside[0]) right++;
    }
    allRight += right; allN += n;
    rows.push(`${f.padEnd(34)} single ${String(n).padStart(3)}  right ${((100 * right) / Math.max(1, n)).toFixed(0).padStart(3)}%  merged blobs ${merged}  ${JSON.stringify(conf)}  samples ${samples.map((s) => s ? `${s.fill.toFixed(2)}/${s.mass.toFixed(2)}/${s.size.toFixed(1)}` : 'null').join(' ')}`);
  }
  rows.push(`ALL single markers right: ${((100 * allRight) / allN).toFixed(1)}% (${allRight}/${allN})`);
  console.log(rows.join('\n'));
});

const BENCH = '/home/david/store/code/katalystnord/plottracer-benchmarks';
const REAL = ['split_4/PMC3507737___g005', 'split_4/PMC6070047___1', 'split_5/PMC2680616___g003', 'split_5/PMC5717673___7', 'split_5/PMC6186129___5_HTML',
  'split_5/PMC6318623___13', 'split_5/PMC6479879___3', 'split_5/PMC6514603___3', 'split_5/PMC6056644___1', 'split_5/PMC6111749___7', 'split_5/PMC3646814___g004'];
const VARIANT = process.env.VARIANT ?? 'nearest';
const dist = (a: MarkerShape, b: MarkerShape) => VARIANT.includes('nosize') ? markerDistance(a, { ...b, size: a.size }) : markerDistance(a, b);
/** nearest sample; or, with 'refine', the samples as seeds and the plot's own markers refining each shape */
function assign(xs: MarkerShape[], samples: (MarkerShape | null)[]): number[] {
  let cs = samples.slice();
  const near = () => xs.map((x) => { const d = cs.map((c) => (c ? dist(x, c) : Infinity)); return d.indexOf(Math.min(...d)); });
  let pick = near();
  if (!VARIANT.includes('refine')) return pick;
  for (let it = 0; it < 6; it++) {
    cs = cs.map((c, k) => {
      const mine = xs.filter((_, i) => pick[i] === k);
      if (!c || mine.length < 3) return c;
      const m = mine.length;
      return { size: mine.reduce((a, x) => a + x.size, 0) / m, reach: c.reach.map((_, j) => mine.reduce((a, x) => a + x.reach[j]!, 0) / m), fill: mine.reduce((a, x) => a + x.fill, 0) / m, mass: mine.reduce((a, x) => a + x.mass, 0) / m, area: 0 };
    });
    pick = near();
  }
  return pick;
}
const OWN: number[] = [], ORPH: number[] = [], SAMEK: number[] = [], DIFFK: number[] = [], ROWN: number[] = [], RORPH: number[] = [], MR: number[] = [], MW: number[] = [], SS: string[] = [];
it('measure real', async () => {
  const { readRgba, samplePixel, modalColour } = await import(`${BENCH}/harness/score.mjs`);
  const norm = (s: string) => (s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
  const rows: string[] = [];
  let R = 0, N = 0;
  for (const id of REAL) {
    const [split, name] = id.split('/');
    const g = JSON.parse(fs.readFileSync(`${BENCH}/work/ICPR2022_CHARTINFO_UB_UNITEC_PMC_TEST_v2.1/final_full_GT/${split}/annotations_JSON/${name}.json`, 'utf8'));
    const img = readRgba(`${BENCH}/work/rgba/pmc-test-${split}/${name}.rgba`);
    const { width: w, height: h } = img;
    const pts: { x: number; y: number }[][] = g.task6.output['visual elements']['scatter points'];
    const names: string[] = g.task6.output['data series'].map((s: { name: string }) => s.name);
    const tb = new Map<number, string>(g.task2.output.text_blocks.map((b: { id: number; text: string }) => [b.id, b.text]));
    const pairs = (g.task5?.output?.legend_pairs ?? []).map((p: { id: number; bb: { x0: number; y0: number; width: number; height: number } }) => ({ name: tb.get(p.id) ?? '', box: [p.bb.x0, p.bb.y0, p.bb.x0 + p.bb.width, p.bb.y0 + p.bb.height] }));
    const sampleOf = names.map((n) => pairs.find((p: { name: string }) => norm(p.name) === norm(n))?.box ?? null);
    const inks = pts.map((s) => (s.length ? modalColour(s.map((p) => samplePixel(img, p.x, p.y))) : null));
    const paper = paperColour(img.data, w, h);
    const bb = g.task4.output._plot_bb;
    const plot = [bb.x0, bb.y0, bb.x0 + bb.width, bb.y0 + bb.height];
    let right = 0, n = 0, merged = 0;
    // series in one ink (within 40) are told apart by marker; each group measured on its own ink
    const done = new Set<number>();
    for (let a = 0; a < pts.length; a++) {
      if (done.has(a) || !inks[a]) continue;
      const group = pts.map((_, b) => b).filter((b) => inks[b] && Math.max(...[0, 1, 2].map((k) => Math.abs(inks[b]![k] - inks[a]![k]))) <= 40);
      group.forEach((b) => done.add(b));
      if (group.length < 2 || group.some((b) => !sampleOf[b])) continue;
      const ink = inkTest(img.data, w, h, inks[a]!, paper);
      const mask = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (ink(x, y)) mask[y * w + x] = 1;
      const { labels, count } = label(mask, w, h, true);
      const pix: number[][] = Array.from({ length: count + 1 }, () => []);
      for (let i = 0; i < w * h; i++) if (labels[i]) pix[labels[i]!]!.push(i);
      const inB = (x: number, y: number, b: number[], pad = 0) => x >= b[0]! - pad && x <= b[2]! + pad && y >= b[1]! - pad && y <= b[3]! + pad;
      const samples = group.map((b) => {
        const s = sampleOf[b]!;
        const c = [(s[0]! + s[2]!) / 2, (s[1]! + s[3]!) / 2];
        let best: number[] | null = null, bd = Infinity;
        for (let l = 1; l <= count; l++) {
          const p = pix[l]!;
          let sx = 0, sy = 0;
          for (const i of p) { sx += i % w; sy += Math.floor(i / w); }
          const cx = sx / p.length, cy = sy / p.length;
          if (!inB(cx, cy, s, 2)) continue;
          const d = Math.hypot(cx - c[0]!, cy - c[1]!);
          if (d < bd) { bd = d; best = p; }
        }
        if (!best) return null;
        // only what lies inside the sample's own box: a sample touching its text is one blob with it
        const clip = process.env.CLIP ? best.filter((i) => inB(i % w, Math.floor(i / w), s, 1)) : best;
        return markerShape(clip, w);
      });
      if (process.env.UNMATCHED) for (let i = 0; i < samples.length; i++) for (let j = i + 1; j < samples.length; j++) if (samples[i] && samples[j]) SS.push(`${markerDistance(samples[i]!, samples[j]!).toFixed(2)} ${name} ${i}-${j}`);
      const legendBox = pairs.length ? [Math.min(...pairs.map((p: { box: number[] }) => p.box[0]!)) - 4, Math.min(...pairs.map((p: { box: number[] }) => p.box[1]!)) - 4, Math.max(...pairs.map((p: { box: number[] }) => p.box[2]!)) + 4, Math.max(...pairs.map((p: { box: number[] }) => p.box[3]!)) + 4] : [-1, -1, -1, -1];
      const singles: { sh: MarkerShape; truth: number }[] = [];
      for (let l = 1; l <= count; l++) {
        const p = pix[l]!;
        if (p.length < 4) continue;
        let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
        for (const i of p) { const x = i % w, y = (i - x) / w; mnx = Math.min(mnx, x); mxx = Math.max(mxx, x); mny = Math.min(mny, y); mxy = Math.max(mxy, y); }
        if (!inB((mnx + mxx) / 2, (mny + mxy) / 2, plot) || inB((mnx + mxx) / 2, (mny + mxy) / 2, legendBox)) continue;
        const inside = group.flatMap((b, gi) => pts[b]!.filter((q) => q.x >= mnx - 1 && q.x <= mxx + 2 && q.y >= mny - 1 && q.y <= mxy + 2).map(() => gi));
        if (inside.length !== 1) { if (inside.length > 1) merged++; continue; }
        singles.push({ sh: markerShape(p, w)!, truth: inside[0]! });
      }
      const pickBy = assign(singles.map((x) => x.sh), samples);
      if (process.env.DEBUG && name === process.env.DEBUG) {
        const fmt = (m: MarkerShape | null) => (m ? `size ${m.size.toFixed(1)} fill ${m.fill.toFixed(2)} mass ${m.mass.toFixed(2)} area ${m.area} reach ${m.reach.map((r) => r.toFixed(1)).join(',')}` : 'null');
        samples.forEach((m, k) => console.log(`sample ${k} ${fmt(m)}`));
        const conf = group.map(() => group.map(() => 0));
        singles.forEach((x, i) => conf[x.truth]![pickBy[i]!]!++);
        console.log('confusion (truth rows)', JSON.stringify(conf));
        for (let k = 0; k < group.length; k++) { const e = singles.find((x) => x.truth === k); console.log(`plot ${k} ${fmt(e?.sh ?? null)}`); }
      }
      singles.forEach((x, i) => { n++; if (pickBy[i] === x.truth) right++; });
      if (process.env.UNMATCHED) singles.forEach((x, i) => {
        const d = samples.map((q) => (q ? markerDistance(x.sh, q) : Infinity)).sort((a, b) => a - b);
        (pickBy[i] === x.truth ? MR : MW).push(d[0]! / Math.max(1e-6, d[1]!));
      });
      if (process.env.UNMATCHED) for (let k = 0; k < samples.length; k++) {
        const rest = samples.map((q, j) => (j === k ? null : q));
        const d1 = singles.map((x) => Math.min(...rest.map((q) => (q ? markerDistance(x.sh, q) : Infinity))));
        const ok = d1.filter((_, i) => singles[i]!.truth !== k).sort((a, b) => a - b);
        if (ok.length < 3) continue;
        const m = Math.max(0.3, ok[Math.floor(ok.length / 2)]!);
        singles.forEach((x, i) => (x.truth === k ? RORPH : ROWN).push(d1[i]! / m));
      }
      if (process.env.UNMATCHED) for (let i = 0; i < singles.length; i++) for (let j = i + 1; j < singles.length; j++) (singles[i]!.truth === singles[j]!.truth ? SAMEK : DIFFK).push(markerDistance(singles[i]!.sh, singles[j]!.sh));
      if (process.env.UNMATCHED) singles.forEach((x) => { if (!samples[x.truth]) return; OWN.push(markerDistance(x.sh, samples[x.truth]!)); ORPH.push(Math.min(...samples.map((q, k) => (k === x.truth || !q ? Infinity : markerDistance(x.sh, q))))); });
    }
    R += right; N += n;
    rows.push(`${name!.padEnd(28)} single ${String(n).padStart(3)}  right ${((100 * right) / Math.max(1, n)).toFixed(0).padStart(3)}%  merged ${merged}  legend pairs ${pairs.length}/${names.length}`);
  }
  if (process.env.UNMATCHED) { const q = (a: number[], p: number) => [...a].sort((x, y) => x - y)[Math.floor(p * (a.length - 1))]!.toFixed(2); rows.push(`REAL own p50 ${q(OWN, 0.5)} p90 ${q(OWN, 0.9)} p95 ${q(OWN, 0.95)} max ${q(OWN, 1)}  orphan p01 ${q(ORPH, 0.01)} p05 ${q(ORPH, 0.05)} p10 ${q(ORPH, 0.1)} p50 ${q(ORPH, 0.5)}`); rows.push('SAMPLE PAIRS lowest: ' + SS.sort((a, b) => parseFloat(a) - parseFloat(b)).slice(0, 8).join(' | ')); rows.push(`PLOT-PLOT same kind p50 ${q(SAMEK, 0.5)} p90 ${q(SAMEK, 0.9)} p95 ${q(SAMEK, 0.95)}  different kind p01 ${q(DIFFK, 0.01)} p05 ${q(DIFFK, 0.05)} p10 ${q(DIFFK, 0.1)} p50 ${q(DIFFK, 0.5)}`); for (const th of [0.5, 0.6, 0.7, 0.8, 0.9]) rows.push(`  margin d1/d2 > ${th}: right flagged ${MR.filter((d) => d > th).length}/${MR.length}, wrong flagged ${MW.filter((d) => d > th).length}/${MW.length}`); for (const th of [2, 3, 4, 5]) rows.push(`  relative ${th}: own beyond ${ROWN.filter((d) => d > th).length}/${ROWN.length}, orphan within ${RORPH.filter((d) => d <= th).length}/${RORPH.length}`); for (const th of [1.5, 2, 2.5, 3, 4]) rows.push(`  threshold ${th}: own beyond ${OWN.filter((d) => d > th).length}/${OWN.length}, orphan within ${ORPH.filter((d) => d <= th).length}/${ORPH.length}`); }
  rows.push(`ALL real single markers right: ${((100 * R) / Math.max(1, N)).toFixed(1)}% (${R}/${N})`);
  console.log(rows.join('\n'));
});

// lines with markers: the shape alone, at the true marker positions, with the line's own band taken out of both the
// sample and the plot's markers
it('measure lines', () => {
  const rows: string[] = [];
  let R = 0, N = 0;
  const segD = (px: number, py: number, xs: number[], ys: number[]) => {
    let d = Infinity;
    for (let i = 1; i < xs.length; i++) {
      const ax = xs[i - 1]!, ay = ys[i - 1]!, bx = xs[i]!, by = ys[i]!;
      const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L));
      d = Math.min(d, Math.hypot(px - ax - t * dx, py - ay - t * dy));
    }
    return d;
  };
  for (const f of fs.readdirSync(DIR).filter((n) => n.endsWith('.json')).sort()) {
    const t = JSON.parse(fs.readFileSync(`${DIR}/${f}`, 'utf8'));
    if (t.kind !== 'line') continue;
    const img = readPng(`${DIR}/${f.replace('.json', '.png')}`);
    const { width: w } = img;
    const ink = inkTest(img.data, w, img.height, t.series[0].ink, paperColour(img.data, w, img.height));
    const r = (t.markerSize * t.dpi) / 72 * 0.75 + 1;
    const band = (1.5 * t.dpi) / 72 / 2 + (process.env.BAND ? Number(process.env.BAND) : 0.8);
    const cut = (cx: number, cy: number, onLine: (x: number, y: number) => boolean) => {
      const pix: number[] = [];
      for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        if (Math.hypot(x - cx, y - cy) > r || !ink(x, y) || onLine(x, y)) continue;
        pix.push(y * w + x);
      }
      return markerShape(pix, w);
    };
    const samples = t.series.map((s: { sample: number[] }) => {
      const cy = (s.sample[1]! + s.sample[3]!) / 2, cx = (s.sample[0]! + s.sample[2]!) / 2;
      return cut(cx, cy, (_x, y) => Math.abs(y - cy) <= band);
    });
    let right = 0, n = 0;
    t.series.forEach((s: { markers: number[][]; line: { px: number[]; py: number[] } }, si: number) => {
      for (const [mx, my] of s.markers) {
        if (mx! >= t.legend[0] - 5 && mx! <= t.legend[2] + 5 && my! >= t.legend[1] - 5 && my! <= t.legend[3] + 5) continue;
        const sh = cut(mx!, my!, (x, y) => segD(x, y, s.line.px, s.line.py) <= band);
        if (!sh) continue;
        const d = samples.map((c: MarkerShape | null) => (c ? markerDistance(sh, c) : Infinity));
        n++;
        if (d.indexOf(Math.min(...d)) === si) right++;
      }
    });
    R += right; N += n;
    rows.push(`${f.padEnd(34)} markers ${String(n).padStart(3)} right ${((100 * right) / Math.max(1, n)).toFixed(0)}%`);
  }
  rows.push(`ALL line markers right: ${((100 * R) / N).toFixed(1)}% (${R}/${N})`);
  console.log(rows.join('\n'));
});

// lines with markers, found: Find lines reads the lines; along each, a marker is where the ink across the line is
// clearly wider than the line; the line's markers vote for the sample they are nearest
it('measure lines found', async () => {
  const { findLines } = await import('../findLines/lines.js');
  const rows: string[] = [];
  for (const f of fs.readdirSync(DIR).filter((n) => n.endsWith('.json')).sort()) {
    const t = JSON.parse(fs.readFileSync(`${DIR}/${f}`, 'utf8'));
    if (t.kind !== 'line') continue;
    const img = readPng(`${DIR}/${f.replace('.json', '.png')}`);
    const { width: w, height: h } = img;
    const ink = inkTest(img.data, w, h, t.series[0].ink, paperColour(img.data, w, h));
    const [bx0, by0, bx1, by1] = t.box, L = t.legend;
    const res = findLines(img.data, w, h, t.series[0].ink, { x0: bx0, y0: by0, x1: bx1, y1: by1 }, { contour: false, masks: [{ x0: L[0], y0: L[1], x1: L[2], y1: L[3] }] });
    const lw = res.lineWidth;
    const across = (x: number, y: number, nx: number, ny: number) => {
      let a = 0, b = 0;
      while (a < 30 && ink(x + nx * (a + 1), y + ny * (a + 1))) a++;
      while (b < 30 && ink(x - nx * (b + 1), y - ny * (b + 1))) b++;
      return a + b + 1;
    };
    const sampleCut = (cx: number, cy: number, r: number) => {
      const pix: number[] = [];
      for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) if (Math.hypot(x - cx, y - cy) <= r && ink(x, y)) pix.push(y * w + x);
      return markerShape(pix, w);
    };
    const r = (t.markerSize * t.dpi) / 72 * 0.75 + 1;
    const samples = t.series.map((s: { sample: number[] }) => sampleCut((s.sample[0]! + s.sample[2]!) / 2, (s.sample[1]! + s.sample[3]!) / 2, r));
    const segD = (px: number, py: number, s: { line: { px: number[]; py: number[] } }) => {
      let d = Infinity;
      for (let i = 1; i < s.line.px.length; i++) {
        const ax = s.line.px[i - 1]!, ay = s.line.py[i - 1]!, bx = s.line.px[i]!, by = s.line.py[i]!;
        const dx = bx - ax, dy = by - ay, LL = dx * dx + dy * dy || 1;
        const tt = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / LL));
        d = Math.min(d, Math.hypot(px - ax - tt * dx, py - ay - tt * dy));
      }
      return d;
    };
    const parts: string[] = [];
    let found = 0, truthMarkers = 0, rightLines = 0, judged = 0;
    for (const s of t.series) truthMarkers += s.markers.filter((m: number[]) => !(m[0]! >= L[0] - 5 && m[0]! <= L[2] + 5 && m[1]! >= L[1] - 5 && m[1]! <= L[3] + 5)).length;
    for (const line of res.lines) {
      const P = line.points;
      // which series the line follows
      const votesT = t.series.map((s: { line: { px: number[]; py: number[] } }) => P.filter((p) => segD(p[0], p[1], s) < 3).length);
      const truth = votesT.indexOf(Math.max(...votesT));
      // markers along it: runs of points where the ink across is wider than the line by 3 px or more
      const wide = P.map((p, i) => {
        const q = P[Math.min(P.length - 1, i + 2)]!, o = P[Math.max(0, i - 2)]!;
        const dx = q[0] - o[0], dy = q[1] - o[1], n = Math.hypot(dx, dy) || 1;
        return across(p[0], p[1], -dy / n, dx / n) >= lw + 3;
      });
      const centres: [number, number][] = [];
      // runs of wide points; two runs closer than the legend's marker width are one marker (an open marker is wide
      // only at its sides, the line running through its empty middle)
      const width = 2 * Math.max(...samples.map((m: MarkerShape | null) => (m ? m.size : 0)));
      const runs: [number, number][] = [];
      for (let i = 0; i < P.length; ) {
        if (!wide[i]) { i++; continue; }
        let j = i;
        while (j + 1 < P.length && wide[j + 1]) j++;
        runs.push([i, j]);
        i = j + 1;
      }
      const along = (a: number, b: number) => Math.hypot(P[b]![0] - P[a]![0], P[b]![1] - P[a]![1]);
      const merged: [number, number][] = [];
      for (const rr of runs) {
        const last = merged[merged.length - 1];
        if (last && along(last[0], rr[1]) <= width * (process.env.MERGE ? Number(process.env.MERGE) : 1.1)) last[1] = rr[1];
        else merged.push([...rr]);
      }
      for (const [i, j] of merged) if (along(i, j) >= 1) centres.push([(P[i]![0] + P[j]![0]) / 2, (P[i]![1] + P[j]![1]) / 2]);
      found += centres.length;
      const votes = samples.map(() => 0);
      for (const c of centres) {
        const sh = sampleCut(c[0], c[1], r);
        if (!sh) continue;
        const d = samples.map((m: MarkerShape | null) => (m ? markerDistance(sh, m) : Infinity));
        votes[d.indexOf(Math.min(...d))]!++;
      }
      const top = Math.max(...votes);
      if (top === 0) continue;
      judged++;
      const k = votes.indexOf(top);
      if (k === truth) rightLines++;
      parts.push(`${truth}->${JSON.stringify(votes)}`);
    }
    rows.push(`${f.padEnd(34)} lines ${res.lines.length} (true ${t.series.length})  markers found ${found} of ${truthMarkers}  lines given right ${rightLines}/${judged}  ${parts.join(' ')}`);
  }
  console.log(rows.join('\n'));
});

// real line charts whose legend entries share an ink: Find lines, markers along each line, the markers' vote
it('measure real lines', async () => {
  const { findLines } = await import('../findLines/lines.js');
  const { readRgba, samplePixel, modalColour } = await import(`${BENCH}/harness/score.mjs`);
  const list: string[] = JSON.parse(fs.readFileSync('/tmp/claude-1000/-home-david-store-code-katalystnord-plottracer/cffb582d-0ad9-4b32-9281-eab8f4651da9/scratchpad/shared_lines.json', 'utf8'));
  const norm = (s: string) => (s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
  const rows: string[] = [];
  let right = 0, judged = 0, lines = 0, wrongFigs = 0, votedFigs = 0;
  for (const id of list) {
    const [split, name] = id.split('/');
    const g = JSON.parse(fs.readFileSync(`${BENCH}/work/ICPR2022_CHARTINFO_UB_UNITEC_PMC_TEST_v2.1/final_full_GT/${split}/annotations_JSON/${name}.json`, 'utf8'));
    const img = readRgba(`${BENCH}/work/rgba/pmc-test-${split}/${name}.rgba`);
    const { width: w, height: h } = img;
    const gl: { x: number; y: number }[][] = g.task6.output['visual elements'].lines;
    const names: string[] = g.task6.output['data series'].map((s: { name: string }) => s.name);
    const tb = new Map<number, string>(g.task2.output.text_blocks.map((b: { id: number; text: string }) => [b.id, b.text]));
    const pairs = (g.task5?.output?.legend_pairs ?? []).map((p: { id: number; bb: { x0: number; y0: number; width: number; height: number } }) => ({ name: tb.get(p.id) ?? '', box: [p.bb.x0, p.bb.y0, p.bb.x0 + p.bb.width, p.bb.y0 + p.bb.height] }));
    const sampleOf = names.map((n) => pairs.find((p: { name: string }) => norm(p.name) === norm(n))?.box ?? null);
    const inks = gl.map((s) => (s.length ? modalColour(s.map((p) => samplePixel(img, p.x, p.y))) : null));
    const paper = paperColour(img.data, w, h);
    const bb = g.task4.output._plot_bb;
    const legendBox = { x0: Math.min(...pairs.map((p: { box: number[] }) => p.box[0]!)) - 4, y0: Math.min(...pairs.map((p: { box: number[] }) => p.box[1]!)) - 4, x1: Math.max(...pairs.map((p: { box: number[] }) => p.box[2]!)) + 60, y1: Math.max(...pairs.map((p: { box: number[] }) => p.box[3]!)) + 4 };
    const segD = (px: number, py: number, s: { x: number; y: number }[]) => {
      let d = Infinity;
      for (let i = 1; i < s.length; i++) {
        const ax = s[i - 1]!.x, ay = s[i - 1]!.y, bx = s[i]!.x, by = s[i]!.y;
        const dx = bx - ax, dy = by - ay, LL = dx * dx + dy * dy || 1;
        const tt = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / LL));
        d = Math.min(d, Math.hypot(px - ax - tt * dx, py - ay - tt * dy));
      }
      return d;
    };
    const done = new Set<number>();
    const parts: string[] = [];
    let figRight = 0, figJudged = 0;
    for (let a = 0; a < gl.length; a++) {
      if (done.has(a) || !inks[a]) continue;
      const group = gl.map((_, b) => b).filter((b) => inks[b] && Math.max(...[0, 1, 2].map((k) => Math.abs(inks[b]![k] - inks[a]![k]))) <= 30);
      group.forEach((b) => done.add(b));
      if (group.length < 2 || group.some((b) => !sampleOf[b])) continue;
      const ink = inkTest(img.data, w, h, inks[a]!, paper);
      let kOpen = 0;
      const cut = (cx: number, cy: number, r: number) => {
        const inDisc = (x: number, y: number) => Math.hypot(x - cx, y - cy) <= r && ink(x, y);
        const pix: number[] = [];
        const k = kOpen;
        for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
          if (!inDisc(x, y)) continue;
          if (k > 0) {
            // opened: kept if some disc of radius k that holds it is all ink (lines and error bars thinner than 2k go)
            let kept = false;
            for (let oy = -k; oy <= k && !kept; oy++) for (let ox = -k; ox <= k && !kept; ox++) {
              if (ox * ox + oy * oy > k * k) continue;
              const qx = x + ox, qy = y + oy;
              let full = true;
              for (let dy = -k; dy <= k && full; dy++) for (let dx = -k; dx <= k && full; dx++) if (dx * dx + dy * dy <= k * k && !ink(qx + dx, qy + dy)) full = false;
              if (full) kept = true;
            }
            if (!kept) continue;
          }
          pix.push(y * w + x);
        }
        return markerShape(pix, w);
      };
      // the sample's marker: a line sample with a marker on it is wider across the line at the marker
      const r = Math.max(3, Math.min(...group.map((b) => sampleOf[b]![3]! - sampleOf[b]![1]!)) / 2 + 1);
      const samples = group.map((b) => { const s = sampleOf[b]!; return cut((s[0]! + s[2]!) / 2, (s[1]! + s[3]!) / 2, r); });
      const res = findLines(img.data, w, h, inks[a]!, { x0: bb.x0, y0: bb.y0, x1: bb.x0 + bb.width, y1: bb.y0 + bb.height }, { contour: false, masks: [legendBox] });
      const lw = res.lineWidth;
      const width = 2 * r;
      if (process.env.OPEN) kOpen = Math.max(1, Math.ceil((lw + 1) / 2));
      // ⚑ only where the legend's samples carry markers: the sample's ink, at its middle, clearly taller than its line
      const tall = group.map((b) => {
        const sb = sampleOf[b]!;
        const cx = Math.round((sb[0]! + sb[2]! ) / 2);
        let best = 0;
        for (let x = cx - 2; x <= cx + 2; x++) {
          let run = 0, top = 0;
          for (let y = Math.floor(sb[1]!) - 2; y <= Math.ceil(sb[3]!) + 2; y++) { run = ink(x, y) ? run + 1 : 0; top = Math.max(top, run); }
          best = Math.max(best, top);
        }
        // and at its ends, the line alone
        let end = 99;
        for (const ex of [Math.round(sb[0]!) + 1, Math.round(sb[2]!) - 1]) {
          let run = 0, top = 0;
          for (let y = Math.floor(sb[1]!) - 2; y <= Math.ceil(sb[3]!) + 2; y++) { run = ink(ex, y) ? run + 1 : 0; top = Math.max(top, run); }
          if (top > 0) end = Math.min(end, top);
        }
        return best >= (end === 99 ? lw : end) + 3;
      });
      if (process.env.GATE !== '0' && !tall.every(Boolean)) { parts.push(`(no markers in samples: ${tall.map((x) => (x ? 1 : 0)).join('')})`); continue; }
      samples.splice(0, samples.length, ...group.map((b) => { const sb = sampleOf[b]!; return cut((sb[0]! + sb[2]!) / 2, (sb[1]! + sb[3]!) / 2, r); }));
      for (const line of res.lines) {
        const P = line.points;
        lines++;
        const votesT = group.map((b) => P.filter((p) => segD(p[0], p[1], gl[b]!) < 3).length);
        const best = Math.max(...votesT);
        if (best < P.length * 0.5) continue;
        const truth = votesT.indexOf(best);
        const wide = P.map((p, i) => {
          const q = P[Math.min(P.length - 1, i + 2)]!, o = P[Math.max(0, i - 2)]!;
          const dx = q[0] - o[0], dy = q[1] - o[1], n = Math.hypot(dx, dy) || 1;
          const nx = -dy / n, ny = dx / n;
          let s1 = 0, s2 = 0;
          while (s1 < 30 && ink(p[0] + nx * (s1 + 1), p[1] + ny * (s1 + 1))) s1++;
          while (s2 < 30 && ink(p[0] - nx * (s2 + 1), p[1] - ny * (s2 + 1))) s2++;
          return s1 + s2 + 1 >= lw + 3;
        });
        const runs: [number, number][] = [];
        for (let i = 0; i < P.length; ) {
          if (!wide[i]) { i++; continue; }
          let j = i;
          while (j + 1 < P.length && wide[j + 1]) j++;
          runs.push([i, j]);
          i = j + 1;
        }
        const along = (x: number, y: number) => Math.hypot(P[y]![0] - P[x]![0], P[y]![1] - P[x]![1]);
        const merged: [number, number][] = [];
        for (const rr of runs) {
          const last = merged[merged.length - 1];
          if (last && along(last[0], rr[1]) <= width * 1.1) last[1] = rr[1];
          else merged.push([...rr]);
        }
        const votes = group.map(() => 0);
        for (const [i, j] of merged) {
          if (along(i, j) < 1 || along(i, j) > width * 1.5) continue;
          const sh = cut((P[i]![0] + P[j]![0]) / 2, (P[i]![1] + P[j]![1]) / 2, r);
          if (!sh) continue;
          const d = samples.map((m) => (m ? markerDistance(sh, m) : Infinity));
          votes[d.indexOf(Math.min(...d))]!++;
        }
        const top = Math.max(...votes);
        if (top < 2) continue;
        figJudged++;
        if (votes.indexOf(top) === truth) figRight++;
        parts.push(`${truth}->${JSON.stringify(votes)}`);
      }
    }
    right += figRight; judged += figJudged;
    if (figJudged) { votedFigs++; if (figRight < figJudged) wrongFigs++; }
    rows.push(`${name!.padEnd(26)} judged ${figJudged} right ${figRight}  ${parts.slice(0, 8).join(' ')}`);
  }
  rows.push(`ALL real lines with 2+ marker votes: ${right}/${judged} right; figures voted ${votedFigs}, with a wrong line ${wrongFigs}; found lines ${lines}`);
  console.log(rows.join('\n'));
});

// markers that run together: each series' template is one of its markers standing alone (given here by the truth);
// the merged blobs are fitted, and each fitted marker is matched to the nearest true one
it('measure overlaps', async () => {
  const { fitMarkers, templateOf } = await import('../markerFit.js');
  const rows: string[] = [];
  let tot = 0, found = 0, rightSeries = 0, extra = 0;
  for (const f of fs.readdirSync(DIR).filter((n) => n.endsWith('.json')).sort()) {
    const t = JSON.parse(fs.readFileSync(`${DIR}/${f}`, 'utf8')) as Fig;
    if (t.kind !== 'scatter') continue;
    const img = readPng(`${DIR}/${f.replace('.json', '.png')}`);
    const { width: w, height: h } = img;
    const ink = inkTest(img.data, w, h, t.series[0]!.ink, paperColour(img.data, w, h));
    const mask = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (ink(x, y)) mask[y * w + x] = 1;
    const { labels, count } = label(mask, w, h, true);
    const pix: number[][] = Array.from({ length: count + 1 }, () => []);
    for (let i = 0; i < w * h; i++) if (labels[i]) pix[labels[i]!]!.push(i);
    const boxOf = (p: number[]) => { let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity; for (const i of p) { const x = i % w, y = (i - x) / w; a = Math.min(a, x); c = Math.max(c, x); b = Math.min(b, y); d = Math.max(d, y); } return [a, b, c, d]; };
    const truthIn = (bx: number[]) => t.series.flatMap((s, si) => s.markers.filter(([x, y]) => x >= bx[0]! - 0.5 && x <= bx[2]! + 1.5 && y >= bx[1]! - 0.5 && y <= bx[3]! + 1.5).map((m) => ({ m, si })));
    const inLegend = (bx: number[]) => bx[0]! >= t.legend[0]! - 2 && bx[2]! <= t.legend[2]! + 2 && bx[1]! >= t.legend[1]! - 2 && bx[3]! <= t.legend[3]! + 2;
    // templates: per series, its first marker standing alone
    const templates = t.series.map((_, si) => {
      for (let l = 1; l <= count; l++) {
        const bx = boxOf(pix[l]!);
        if (pix[l]!.length < 4 || inLegend(bx)) continue;
        const ti = truthIn(bx);
        if (ti.length === 1 && ti[0]!.si === si) return templateOf(pix[l]!, w);
      }
      return null;
    });
    if (templates.some((q) => !q)) { rows.push(`${f}: a series has no lone marker`); continue; }
    let ft = 0, ff = 0, fr = 0, fe = 0;
    for (let l = 1; l <= count; l++) {
      const bx = boxOf(pix[l]!);
      if (inLegend(bx) || bx[0]! < t.box[0]! || bx[2]! > t.box[2]!) continue;
      const ti = truthIn(bx);
      if (ti.length < 2) continue;
      const fit = fitMarkers(pix[l]!, w, templates as { offsets: [number, number][] }[]);
      ft += ti.length;
      const used = new Set<number>();
      for (const q of fit) {
        let bi = -1, bd = Infinity;
        ti.forEach((tr, k) => { if (used.has(k)) return; const d = Math.hypot(tr.m[0] - q.x, tr.m[1] - q.y); if (d < bd) { bd = d; bi = k; } });
        if (bi < 0 || bd > 3) { fe++; continue; }
        used.add(bi);
        ff++;
        if (ti[bi]!.si === q.template) fr++;
      }
    }
    tot += ft; found += ff; rightSeries += fr; extra += fe;
    rows.push(`${f.padEnd(34)} markers in merged blobs ${String(ft).padStart(3)}  found within 3 px ${ff}  right series ${fr}  extra ${fe}`);
  }
  rows.push(`ALL merged: ${tot} true, found ${found} (${((100 * found) / tot).toFixed(1)}%), right series ${rightSeries} (${((100 * rightSeries) / tot).toFixed(1)}%), extra ${extra}`);
  console.log(rows.join('\n'));
});

// the dense Adobe scatters: no legend, so the template is the plot's own typical lone marker; blobs clearly bigger
// than it are fitted. Scored with the benchmark's own metric, before and after.
it('measure adobe dense', async () => {
  const { colorFilter } = await import('../colorFilter.js');
  const { detectBlobs } = await import('../blobDetect.js');
  const { fitMarkers, templateOf } = await import('../markerFit.js');
  const { readRgba, samplePixel, dedupeColours } = await import(`${BENCH}/harness/score.mjs`);
  const { pointScore, toleranceFor } = await import(`${BENCH}/harness/lib/metric.mjs`);
  const PMC = process.env.PMC_SPLIT;
  const GT = PMC ? `${BENCH}/work/ICPR2022_CHARTINFO_UB_UNITEC_PMC_TEST_v2.1/final_full_GT/${PMC}/annotations_JSON` : `${BENCH}/work/adobe/test_release/task6/gt_json`;
  const rows: string[] = [];
  const tot = { before: 0, after: 0, gt: 0, predB: 0, predA: 0 };
  const totSmall = { before: 0, after: 0, gt: 0 };
  const allPred = { b: 0, a: 0, sb: 0, sa: 0 };
  for (const f of fs.readdirSync(GT).filter((n) => n.endsWith('.json')).sort()) {
    const g = JSON.parse(fs.readFileSync(`${GT}/${f}`, 'utf8'));
    if ((g.task1?.output?.chart_type ?? '').toLowerCase() !== 'scatter') continue;
    const series: { x: number; y: number }[][] = g.task6?.output?.['visual elements']?.['scatter points'] ?? [];
    const gtPts = series.flat();
    if (!gtPts.length) continue;
    let img;
    try { img = readRgba(`${BENCH}/work/rgba/${PMC ? `pmc-test-${PMC}` : 'adobe-test'}/${f.replace('.json', '.rgba')}`); } catch { continue; }
    const bb = g.task4?.output?._plot_bb;
    const region = bb ? { x: bb.x0, y: bb.y0, width: bb.width, height: bb.height } : undefined;
    const T = toleranceFor(img.width, img.height);
    const picks = dedupeColours(gtPts.map((p) => samplePixel(img, p.x, p.y)));
    const before: { x: number; y: number }[] = [], after: { x: number; y: number }[] = [];
    for (const target of picks) {
      const { mask, count } = colorFilter(img.data, img.width, img.height, target, 60, 'foreground', region);
      if (count < 4) continue;
      const blobs = detectBlobs(mask, img.width, img.height, { minDiameter: 3, trackMembership: true });
      if (!blobs.length) continue;
      for (const b of blobs) before.push(b.centroid);
      // the typical lone marker: compact blobs (not a line, not a speck), and of those the commonest area
      const compact = blobs.filter((b) => {
        const bw = b.bbox.maxX - b.bbox.minX, bh = b.bbox.maxY - b.bbox.minY;
        return b.area >= 9 && Math.max(bw, bh) <= 2.2 * Math.min(bw, bh) && b.area >= 0.35 * bw * bh;
      });
      if (compact.length < 3) { for (const b of blobs) after.push(b.centroid); continue; }
      const byArea = new Map<number, number>();
      for (const b of compact) { const k = Math.round(Math.log(b.area) / Math.log(1.15)); byArea.set(k, (byArea.get(k) ?? 0) + 1); }
      let mk = 0, mn = -1;
      for (const [k, n] of byArea) if (n > mn) { mn = n; mk = k; }
      const tb = compact.filter((b) => Math.round(Math.log(b.area) / Math.log(1.15)) === mk).sort((a, b) => a.area - b.area)[0]!;
      const lone = tb.area;
      const template = templateOf([...tb.members!], img.width);
      for (const b of blobs) {
        if (b.area <= 1.6 * lone) { after.push(b.centroid); continue; }
        const fit = fitMarkers([...b.members!], img.width, [template]);
        // split only when the markers explain nearly all of the blob's ink
        const covered = new Set<number>();
        for (const q of fit) for (const [dx, dy] of template.offsets) covered.add((Math.floor(q.y) + dy) * img.width + Math.floor(q.x) + dx);
        let explained = 0;
        for (const i of b.members!) if (covered.has(i)) explained++;
        if (fit.length >= 2 && explained >= 0.9 * b.area) after.push(...fit.map((q) => ({ x: q.x, y: q.y })));
        else after.push(b.centroid);
      }
    }
    const mb = pointScore(gtPts, before, T), ma = pointScore(gtPts, after, T);
    const dense = gtPts.length >= 200;
    const into = dense ? tot : totSmall;
    allPred.b += before.length; allPred.a += after.length;
    allPred.sb += mb.score * gtPts.length; allPred.sa += ma.score * gtPts.length;
    into.before += mb.within; into.after += ma.within; into.gt += gtPts.length;
    if (dense) { tot.predB += before.length; tot.predA += after.length; rows.push(`${f.padEnd(12)} gt ${String(gtPts.length).padStart(4)}  before ${mb.within} (pred ${before.length})  after ${ma.within} (pred ${after.length})`); }
  }
  rows.push(`DENSE (>=200 pts): before ${((100 * tot.before) / tot.gt).toFixed(1)}%  after ${((100 * tot.after) / tot.gt).toFixed(1)}%  (pred/gt ${(tot.predB / tot.gt).toFixed(2)} -> ${(tot.predA / tot.gt).toFixed(2)})`);
  rows.push(`THE REST: before ${((100 * totSmall.before) / totSmall.gt).toFixed(1)}%  after ${((100 * totSmall.after) / totSmall.gt).toFixed(1)}%`);
  rows.push(`PRED/GT all: ${(allPred.b / (tot.gt + totSmall.gt)).toFixed(2)} -> ${(allPred.a / (tot.gt + totSmall.gt)).toFixed(2)}; competition score (penalises extras): ${(allPred.sb / (tot.gt + totSmall.gt)).toFixed(3)} -> ${(allPred.sa / (tot.gt + totSmall.gt)).toFixed(3)}`);
  rows.push(`ALL: before ${((100 * (tot.before + totSmall.before)) / (tot.gt + totSmall.gt)).toFixed(1)}%  after ${((100 * (tot.after + totSmall.after)) / (tot.gt + totSmall.gt)).toFixed(1)}%`);
  console.log(rows.join('\n'));
}, 1200000);

// case 3's threshold: a lone marker's distance to its own sample, against a marker whose entry is left out (its
// distance to the nearest remaining sample)
it('measure unmatched', () => {
  const own: number[] = [], orphan: number[] = [];
  for (const f of fs.readdirSync(DIR).filter((n) => n.endsWith('.json')).sort()) {
    const t = JSON.parse(fs.readFileSync(`${DIR}/${f}`, 'utf8')) as Fig;
    if (t.kind !== 'scatter') continue;
    const img = readPng(`${DIR}/${f.replace('.json', '.png')}`);
    const { width: w, height: h } = img;
    const ink = inkTest(img.data, w, h, t.series[0]!.ink, paperColour(img.data, w, h));
    const mask = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (ink(x, y)) mask[y * w + x] = 1;
    const { labels, count } = label(mask, w, h, true);
    const pix: number[][] = Array.from({ length: count + 1 }, () => []);
    for (let i = 0; i < w * h; i++) if (labels[i]) pix[labels[i]!]!.push(i);
    const inBox = (i: number, b: number[], pad = 0) => { const x = i % w, y = (i - x) / w; return x >= b[0]! - pad && x <= b[2]! + pad && y >= b[1]! - pad && y <= b[3]! + pad; };
    const samples = t.series.map((s) => {
      const c = [(s.sample[0]! + s.sample[2]!) / 2, (s.sample[1]! + s.sample[3]!) / 2];
      let best: number[] | null = null, bd = Infinity;
      for (let l = 1; l <= count; l++) { const p = pix[l]!; if (!p.length || !inBox(p[0]!, s.sample, 6)) continue; const x = p[0]! % w, y = (p[0]! - x) / w; const d = Math.hypot(x - c[0]!, y - c[1]!); if (d < bd) { bd = d; best = p; } }
      return best ? markerShape(best, w) : null;
    });
    const fo: number[] = [], fr: number[] = [];
    for (let l = 1; l <= count; l++) {
      const p = pix[l]!;
      if (p.length < 4 || !inBox(p[0]!, t.box) || inBox(p[0]!, t.legend, 2)) continue;
      let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
      for (const i of p) { const x = i % w, y = (i - x) / w; mnx = Math.min(mnx, x); mxx = Math.max(mxx, x); mny = Math.min(mny, y); mxy = Math.max(mxy, y); }
      const inside = t.series.flatMap((s, si) => s.markers.filter(([x, y]) => x >= mnx - 0.5 && x <= mxx + 1.5 && y >= mny - 0.5 && y <= mxy + 1.5).map(() => si));
      if (inside.length !== 1) continue;
      const sh = markerShape(p, w)!;
      const si = inside[0]!;
      fo.push(markerDistance(sh, samples[si]!));
      fr.push(Math.min(...samples.map((s, k) => (k === si || !s ? Infinity : markerDistance(sh, s)))));
    }
    own.push(...fo); orphan.push(...fr);
    const q = (a: number[], p: number) => [...a].sort((x, y) => x - y)[Math.floor(p * (a.length - 1))]!.toFixed(2);
    console.log(`${f.padEnd(34)} own p50 ${q(fo, 0.5)} p95 ${q(fo, 0.95)} max ${q(fo, 1)}   orphan min ${q(fr, 0)} p05 ${q(fr, 0.05)} p50 ${q(fr, 0.5)}`);
  }
  const q = (a: number[], p: number) => [...a].sort((x, y) => x - y)[Math.floor(p * (a.length - 1))]!.toFixed(2);
  console.log(`ALL own p50 ${q(own, 0.5)} p95 ${q(own, 0.95)} p99 ${q(own, 0.99)} max ${q(own, 1)}   orphan min ${q(orphan, 0)} p01 ${q(orphan, 0.01)} p05 ${q(orphan, 0.05)}`);
});

// the shipped Colour trace (engine/blobDetectRun.ts) on the benchmark scatters, as the published path calls it
it('measure shipped scatter', async () => {
  const { runBlobDetect } = await import('../../engine/blobDetectRun.js');
  const { readRgba, samplePixel, dedupeColours } = await import(`${BENCH}/harness/score.mjs`);
  const { pointScore, toleranceFor } = await import(`${BENCH}/harness/lib/metric.mjs`);
  const PMC = process.env.PMC_SPLIT;
  const GT = PMC ? `${BENCH}/work/ICPR2022_CHARTINFO_UB_UNITEC_PMC_TEST_v2.1/final_full_GT/${PMC}/annotations_JSON` : `${BENCH}/work/adobe/test_release/task6/gt_json`;
  let within = 0, gt = 0, pred = 0, sc = 0;
  for (const f of fs.readdirSync(GT).filter((n) => n.endsWith('.json')).sort()) {
    const g = JSON.parse(fs.readFileSync(`${GT}/${f}`, 'utf8'));
    if ((g.task1?.output?.chart_type ?? '').toLowerCase() !== 'scatter') continue;
    const gtPts = (g.task6?.output?.['visual elements']?.['scatter points'] ?? []).flat();
    if (!gtPts.length) continue;
    let img;
    try { img = readRgba(`${BENCH}/work/rgba/${PMC ? `pmc-test-${PMC}` : 'adobe-test'}/${f.replace('.json', '.rgba')}`); } catch { continue; }
    const bb = g.task4?.output?._plot_bb;
    const region = bb ? { x: bb.x0, y: bb.y0, width: bb.width, height: bb.height } : undefined;
    const T = toleranceFor(img.width, img.height);
    const out: { x: number; y: number }[] = [];
    for (const target of dedupeColours(gtPts.map((p: { x: number; y: number }) => samplePixel(img, p.x, p.y)))) {
      const r = runBlobDetect(img.data, img.width, img.height, target, 60, 'foreground', region, { minDiameter: 3 });
      if (!('error' in r)) out.push(...r.points);
    }
    const m = pointScore(gtPts, out, T);
    within += m.within; gt += gtPts.length; pred += out.length; sc += m.score * gtPts.length;
  }
  console.log(`SHIPPED ${PMC ?? 'adobe'}: found ${((100 * within) / gt).toFixed(1)}%  pred/gt ${(pred / gt).toFixed(2)}  competition score ${(sc / gt).toFixed(3)}`);
}, 1200000);
