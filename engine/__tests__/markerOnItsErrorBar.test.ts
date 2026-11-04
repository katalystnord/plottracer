import { describe, expect, it } from 'vitest';
import { runBlobDetect } from '../blobDetectRun.js';
import { readPng } from './helpers/readPng.js';
import { readFileSync } from 'node:fs';

/**
 * Colour trace puts a point on the MARKER, not on the marker and its error bar together (v2.7; David, 2026-11-04,
 * on errorbar-failure-time-asymmetric: "we will have some work to do with detecting error bars on series"). A marker
 * and an error bar of the same colour touch, so they were one blob, and the blob's centroid was pulled along the
 * longer arm: measured 2026-11-04, every point too high, by up to 67 of 820 h.
 */

const BLUE: [number, number, number] = [0x1f, 0x4e, 0x79];

function white(w: number, h: number): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4).fill(255);
  return d;
}
function paint(d: Uint8ClampedArray, w: number, inside: (x: number, y: number) => boolean, h: number) {
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (inside(x + 0.5, y + 0.5)) d.set([...BLUE, 255], (y * w + x) * 4);
}
const read = (d: Uint8ClampedArray, w: number, h: number) => {
  const r = runBlobDetect(d, w, h, BLUE, 60, 'foreground', undefined, { minDiameter: 3 });
  if ('error' in r) throw new Error(r.error);
  return r.points;
};

describe('a marker with an error bar of its own colour is read at the marker', () => {
  it('given a round marker at (50, 100) with a 1.5 px bar 80 px up and 20 px down, capped, the point is on the marker', () => {
    const w = 100, h = 200;
    const d = white(w, h);
    paint(d, w, (x, y) => Math.hypot(x - 50, y - 100) <= 5, h); // the marker, 10 px across
    paint(d, w, (x, y) => Math.abs(x - 50) <= 0.75 && y >= 20 && y <= 120, h); // the bar
    paint(d, w, (x, y) => Math.abs(x - 50) <= 6 && (Math.abs(y - 20) <= 0.75 || Math.abs(y - 120) <= 0.75), h); // its caps
    const [p, ...rest] = read(d, w, h);
    expect(rest).toEqual([]);
    expect(Math.abs(p!.x - 50)).toBeLessThan(0.5);
    expect(Math.abs(p!.y - 100)).toBeLessThan(0.5);
  });

  it('given errorbar-failure-time-asymmetric and its colour, all seven points are within 2 px of the true markers', () => {
    const t = JSON.parse(readFileSync('samples/errorbar-failure-time-asymmetric.truth.json', 'utf8'));
    const img = readPng('samples/errorbar-failure-time-asymmetric.png');
    const a = t.calibration.anchors;
    const px = (x: number) => a.x1.px + ((x - a.x1.value) / (a.x2.value - a.x1.value)) * (a.x2.px - a.x1.px);
    const py = (y: number) => a.y1.py + ((y - a.y1.value) / (a.y2.value - a.y1.value)) * (a.y2.py - a.y1.py);
    const r = runBlobDetect(img.data, img.width, img.height, BLUE, 60, 'foreground', { x: 90, y: 40, width: 776, height: 594 }, { minDiameter: 3 });
    if ('error' in r) throw new Error(r.error);
    const truth = (t.series[0].points as { x: number; y: number }[]).map((q) => ({ x: px(q.x), y: py(q.y) }));
    expect(r.points).toHaveLength(7);
    r.points.forEach((p, i) => {
      expect(Math.hypot(p.x - truth[i]!.x, p.y - truth[i]!.y), `point ${i + 1}`).toBeLessThan(2);
    });
  });
});

describe('a marker with nothing attached reads exactly as before', () => {
  for (const [name, inside] of [
    ['round', (x: number, y: number) => Math.hypot(x - 40.3, y - 30.7) <= 6],
    ['square', (x: number, y: number) => Math.abs(x - 40) <= 5 && Math.abs(y - 30) <= 5],
    ['triangle', (x: number, y: number) => y <= 37 && y >= 23 + Math.abs(x - 40) * 1.6],
  ] as const) {
    it(`given a lone ${name} marker, the point is the centroid of its ink, as it always was`, () => {
      const w = 80, h = 60;
      const d = white(w, h);
      paint(d, w, inside, h);
      let sx = 0, sy = 0, n = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4] !== 255) { sx += x + 0.5; sy += y + 0.5; n++; }
      const [p] = read(d, w, h);
      expect(p!.x).toBeCloseTo(sx / n, 6);
      expect(p!.y).toBeCloseTo(sy / n, 6);
    });
  }
});
