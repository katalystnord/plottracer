/**
 * Markers drawn over each other taken apart, one point each (v2.7; docs/v2.7-workflow-walk.md, "Series told apart by
 * their markers"), and what is NOT taken apart: one marker drawn larger than the template, and ink far larger than a
 * few markers (the plot's frame, a filled area). Found by the code review of 666ea46..7d5c927 (2026-11-05).
 */
import { describe, expect, it } from 'vitest';
import { splitBlob, templateOf } from '../markerFit.js';

const W = 1200;
/** The pixels of a disc (or a square) of radius r centred at (cx, cy). */
function shape(r: number, cx = 100, cy = 100, square = false): number[] {
  const p: number[] = [];
  const R = Math.ceil(r);
  for (let y = -R; y <= R; y++) {
    for (let x = -R; x <= R; x++) {
      if (square ? Math.max(Math.abs(x), Math.abs(y)) <= r : x * x + y * y <= r * r) p.push((y + cy) * W + x + cx);
    }
  }
  return p;
}
const union = (...ps: number[][]) => [...new Set(ps.flat())];
const disc = templateOf(shape(3.5), W);
const dot = templateOf(shape(1, 100, 100, true), W);

describe('markers drawn over each other, and what is not', () => {
  it('given two discs drawn over each other, each is its own point', () => {
    const got = splitBlob(union(shape(3.5, 100, 100), shape(3.5, 105, 101)), W, [disc, dot], 0.8);
    expect(got?.length).toBe(2);
    expect(got!.every((q) => q.template === 0)).toBe(true);
  });

  it('given a long run of markers drawn over each other along a diagonal, spanning 180 marker boxes, each is its own point', () => {
    // a cap of 40 boxes, the first value, left these whole: Adobe CHART-Synthetic's scatters 60.8% -> 41.8% found
    const run = union(...Array.from({ length: 20 }, (_, k) => shape(3.5, 100 + 6 * k, 100 + 6 * k)));
    expect(splitBlob(run, W, [disc, dot], 0.8)?.length).toBe(20);
  });

  it('given one marker drawn larger than its template, it is one point, not a marker and pieces of others', () => {
    for (const big of [1.2, 1.3, 1.4, 1.5]) {
      expect(splitBlob(shape(3.5 * big), W, [disc, dot], 0.8), `${big}x the radius`).toBeNull();
    }
  });

  it('given ink far larger than a few markers (a filled area, the plot frame), no split is tried, and it costs nothing', () => {
    const area: number[] = [];
    for (let y = 100; y < 400; y++) for (let x = 100; x < 500; x++) area.push(y * W + x);
    const frame: number[] = [];
    for (let x = 50; x < 1150; x++) frame.push(50 * W + x, 750 * W + x);
    for (let y = 50; y <= 750; y++) frame.push(y * W + 50, y * W + 1149);
    const t0 = performance.now();
    expect(splitBlob(area, W, [disc, dot], 0.8)).toBeNull();
    expect(splitBlob(frame, W, [disc, dot], 0.8)).toBeNull();
    // measured before the cap: 566 ms for the area alone
    expect(performance.now() - t0).toBeLessThan(50);
  });
});
