/**
 * The dash-coded corpus (algorithms/__tests__/fixtures/findLines/dashes, made by dashes.py): figures whose series
 * share one ink and differ by line style, with each series' pixel polyline and its legend sample's box.
 */
import fs from 'node:fs';
import { readPng } from '../../../engine/__tests__/helpers/readPng.js';
import type { FoundLine } from '../../findLines/lines.js';

export const DASH_DIR = 'algorithms/__tests__/fixtures/findLines/dashes';
export type Style = string | { offset: number; dashes: number[] };
export interface DashSeries { name: string; ink: [number, number, number]; style: Style; px: number[]; py: number[]; sample: [number, number, number, number] }
export interface DashFigure {
  name: string;
  lineWidth: number;
  dpi: number;
  box: { x0: number; y0: number; x1: number; y1: number };
  legend: { x0: number; y0: number; x1: number; y1: number };
  series: DashSeries[];
  img: { data: Uint8Array | Uint8ClampedArray; width: number; height: number };
}

export function dashFigures(): DashFigure[] {
  return fs.readdirSync(DASH_DIR).filter((n) => n.endsWith('.json')).sort().map((f) => {
    const t = JSON.parse(fs.readFileSync(`${DASH_DIR}/${f}`, 'utf8'));
    const [x0, y0, x1, y1] = t.box, L = t.legend;
    return { name: f.replace('.json', ''), lineWidth: t.lineWidth, dpi: t.dpi, box: { x0, y0, x1, y1 }, legend: { x0: L[0], y0: L[1], x1: L[2], y1: L[3] }, series: t.series, img: readPng(`${DASH_DIR}/${f.replace('.json', '.png')}`) };
  });
}

export const styleName = (s: Style): string => (typeof s === 'string' ? s : s.dashes.length ? s.dashes.join('/') : 'solid');
export const isDotted = (s: Style): boolean => s === ':' || (typeof s !== 'string' && s.dashes.length === 2 && s.dashes[0] === 1);

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}
/** How far a point is from a series' drawn polyline, px. */
export function distTo(p: readonly number[], s: DashSeries): number {
  let d = Infinity;
  for (let i = 1; i < s.px.length; i++) d = Math.min(d, segDist(p[0]!, p[1]!, s.px[i - 1]!, s.py[i - 1]!, s.px[i]!, s.py[i]!));
  return d;
}

/** Which series a found line follows (the one most of its points lie within 3 px of), or -1 for none. */
export function seriesOf(line: FoundLine, series: readonly DashSeries[]): number {
  const votes = series.map(() => 0);
  for (const p of line.points) {
    const ds = series.map((s) => distTo(p, s));
    const k = ds.indexOf(Math.min(...ds));
    if (ds[k]! < 3) votes[k]!++;
  }
  const k = votes.indexOf(Math.max(...votes));
  return votes[k]! >= line.points.length * 0.5 ? k : -1;
}

/** Each series: how many found lines follow it, and what share of its visible x span they cover (within 3 px of
 * it). Columns where the series runs under the legend (masked, its ink hidden) are not counted. */
export function coverage(lines: readonly FoundLine[], series: readonly DashSeries[], hidden?: { x0: number; y0: number; x1: number; y1: number }): { pieces: number; cover: number }[] {
  const per = series.map(() => ({ pieces: 0, cols: new Set<number>() }));
  for (const L of lines) {
    const k = seriesOf(L, series);
    if (k < 0) continue;
    per[k]!.pieces++;
    for (const p of L.points) if (distTo(p, series[k]!) < 3) per[k]!.cols.add(Math.round(p[0]!));
  }
  return per.map((q, i) => {
    const s = series[i]!;
    const want = new Set<number>();
    for (let j = 1; j < s.px.length; j++) {
      const n = Math.max(1, Math.ceil(Math.abs(s.px[j]! - s.px[j - 1]!)));
      for (let t = 0; t <= n; t++) {
        const x = s.px[j - 1]! + ((s.px[j]! - s.px[j - 1]!) * t) / n, y = s.py[j - 1]! + ((s.py[j]! - s.py[j - 1]!) * t) / n;
        if (hidden && x >= hidden.x0 && x <= hidden.x1 && y >= hidden.y0 && y <= hidden.y1) continue;
        want.add(Math.round(x));
      }
    }
    let got = 0;
    for (const c of want) if (q.cols.has(c)) got++;
    return { pieces: q.pieces, cover: got / Math.max(1, want.size) };
  });
}
