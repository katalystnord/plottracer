/**
 * C3 for lines captured BY HAND (agreed 2026-10-10): a contour line is closed
 * by the same ink check as a found one - never by how close its ends are.
 * Measured on the bundled contour example's own lines.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { readPng } from '../../engine/__tests__/helpers/readPng.js';
import { inkClosesLoop } from '../findLines/closure.js';
import type { Pt } from '../findLines/geom.js';

const base = join(__dirname, '..', '..', 'samples', 'contour-potential-energy');
const t = JSON.parse(readFileSync(base + '.truth.json', 'utf8'));
const a = t.calibration.anchors;
const toPx = (p: { x: number; y: number }): Pt => [
  a.x1.px + (p.x - a.x1.value) * ((a.x2.px - a.x1.px) / (a.x2.value - a.x1.value)),
  a.y1.py + (p.y - a.y1.value) * ((a.y2.py - a.y1.py) / (a.y2.value - a.y1.value)),
];
const img = readPng(base + '.png');
const INK = [0x22, 0x22, 0x22] as const;
/** Clicks a person would make round a line: every `step`-th vertex, stopping `short` before its end. */
function clicks(series: { points: { x: number; y: number }[] }, step: number, short: number): Pt[] {
  const p = series.points.map(toPx);
  const out: Pt[] = [];
  for (let i = 0; i < p.length - short; i += step) out.push(p[i]!);
  return out;
}
const loops = t.series.filter((s: { closed: boolean }) => s.closed);
const opens = t.series.filter((s: { closed: boolean }) => !s.closed);

describe('C3 closing a hand-captured contour line by its ink', () => {
  it('C3 clicked all the way round a loop, it closes - the gap to the first click is the loop\'s own ink', () => {
    for (const L of loops) expect(inkClosesLoop(img.data, img.width, img.height, clicks(L, 12, 6), INK)).toBe(true);
  });

  it('C3 clicked only part of the way round, it stays open', () => {
    for (const L of loops) {
      const half = clicks({ points: L.points.slice(0, Math.floor(L.points.length * 0.6)) }, 10, 0);
      expect(inkClosesLoop(img.data, img.width, img.height, half, INK)).toBe(false);
    }
  });

  it('C3 an open line never closes, however its clicks run', () => {
    for (const L of opens) expect(inkClosesLoop(img.data, img.width, img.height, clicks(L, 12, 0), INK)).toBe(false);
  });

  it('C3 two clicks close together are not a loop: closeness of the ends decides nothing', () => {
    const L = loops[0]!;
    const p = clicks(L, 12, 6);
    // the same clicks shifted 30 px off the ink: ends as close as before, no ink between them
    const off = p.map(([x, y]) => [x + 30, y + 30] as Pt);
    expect(inkClosesLoop(img.data, img.width, img.height, off, INK)).toBe(false);
  });
});
