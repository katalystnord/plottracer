/**
 * Bars seen whole by the detector (docs/v2.7-workflow-walk.md, "Bars seen whole by the detector", David 2026-11-06).
 * The detector's bar boxes are given to the colour read; these are its cases.
 */
import { describe, it, expect } from 'vitest';
import { runBarDetect, type DetectedBarProposal } from '../barDetectRun.js';

type RGB = [number, number, number];
const BLUE: RGB = [30, 60, 220];
const RED: RGB = [220, 40, 40];
const BLACK: RGB = [0, 0, 0];

function white(w: number, h: number): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4).fill(255);
  return d;
}
function put(d: Uint8ClampedArray, w: number, x: number, y: number, c: RGB) {
  const i = (y * w + x) * 4;
  d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
}
function block(d: Uint8ClampedArray, w: number, x0: number, y0: number, bw: number, bh: number, c: RGB) {
  for (let y = y0; y < y0 + bh; y++) for (let x = x0; x < x0 + bw; x++) put(d, w, x, y, c);
}
/** A bar cross-hatched as matplotlib's 'x' draws it: black diagonals both ways, 2 px wide, every `pitch` px. */
function hatchedBar(d: Uint8ClampedArray, w: number, x0: number, y0: number, bw: number, bh: number, c: RGB, pitch = 10) {
  block(d, w, x0, y0, bw, bh, c);
  for (let y = y0; y < y0 + bh; y++) {
    for (let x = x0; x < x0 + bw; x++) {
      const a = (x - x0 + y - y0) % pitch, b = (((x - x0 - (y - y0)) % pitch) + pitch) % pitch;
      if (a < 2 || b < 2) put(d, w, x, y, BLACK);
    }
  }
}
const proposal = (x0: number, y0: number, x1: number, y1: number, score = 0.9): DetectedBarProposal => ({ x0, y0, x1, y1, score });
const boxOf = (b: { start: { x: number; y: number }; end: { x: number; y: number } }) => [b.start.x, b.start.y, b.end.x, b.end.y];

const W = 200, H = 160;

describe('bars seen whole by the detector', () => {
  it('given a hatched bar chart, Colour trace places one bar per drawn bar, not its pieces', () => {
    const img = white(W, H);
    hatchedBar(img, W, 20, 40, 40, 100, BLUE);
    hatchedBar(img, W, 100, 70, 40, 70, BLUE);
    const without = runBarDetect(img, W, H, BLUE, 60);
    if ('error' in without) throw new Error(without.error);
    // the colour read alone returns the pieces between the hatch lines
    expect(without.boxes.length).toBeGreaterThan(2);
    const withDet = runBarDetect(img, W, H, BLUE, 60, 'foreground', undefined, undefined, undefined, undefined, undefined, [
      proposal(19.5, 39.6, 60.4, 140.2),
      proposal(100.3, 69.8, 139.6, 140.1),
    ]);
    if ('error' in withDet) throw new Error(withDet.error);
    expect(withDet.boxes).toHaveLength(2);
  });

  it('given a bar the colour read found whole, its box is the colour read’s, not the detector’s', () => {
    const img = white(W, H);
    block(img, W, 30, 50, 40, 90, BLUE);
    const r = runBarDetect(img, W, H, BLUE, 60, 'foreground', undefined, undefined, undefined, undefined, undefined, [
      proposal(27, 47, 73, 141),
    ]);
    if ('error' in r) throw new Error(r.error);
    expect(r.boxes.map(boxOf)).toEqual([[30, 50, 70, 140]]);
  });

  it('given a detector box over pieces of the colour, the pieces mostly inside it are replaced by the box', () => {
    const img = white(W, H);
    hatchedBar(img, W, 20, 40, 40, 100, BLUE);
    block(img, W, 150, 100, 20, 40, BLUE); // a plain bar elsewhere, untouched
    const r = runBarDetect(img, W, H, BLUE, 60, 'foreground', undefined, undefined, undefined, undefined, undefined, [
      proposal(20, 40, 60, 140),
    ]);
    if ('error' in r) throw new Error(r.error);
    const inside = r.boxes.map(boxOf).filter((b) => b[0]! >= 15 && b[2]! <= 65);
    expect(inside).toEqual([[20, 40, 60, 140]]);
    expect(r.boxes.map(boxOf)).toContainEqual([150, 100, 170, 140]);
  });

  it('given a detector box mostly of another colour, it is not filed under this colour', () => {
    const img = white(W, H);
    block(img, W, 30, 50, 40, 90, BLUE);
    block(img, W, 110, 60, 40, 80, RED);
    const r = runBarDetect(img, W, H, BLUE, 60, 'foreground', undefined, undefined, undefined, undefined, undefined, [
      proposal(30, 50, 70, 140),
      proposal(110, 60, 150, 140),
    ]);
    if ('error' in r) throw new Error(r.error);
    expect(r.boxes.map(boxOf)).toEqual([[30, 50, 70, 140]]);
  });

  it('given a detector box whose centre is outside the data area, it is not placed', () => {
    const img = white(W, H);
    hatchedBar(img, W, 20, 40, 40, 100, BLUE);
    hatchedBar(img, W, 150, 10, 30, 20, BLUE); // above the data area, as a legend swatch sits
    const region = { x: 10, y: 35, width: 180, height: 115 };
    const r = runBarDetect(img, W, H, BLUE, 60, 'foreground', region, undefined, undefined, undefined, undefined, [
      proposal(20, 40, 60, 140),
      proposal(150, 10, 180, 30),
    ]);
    if ('error' in r) throw new Error(r.error);
    expect(r.boxes.map(boxOf)).not.toContainEqual([150, 10, 180, 30]);
    expect(r.boxes.map(boxOf)).toContainEqual([20, 40, 60, 140]);
  });

  it('given no detector boxes (the detector unavailable), the bars are read exactly as before', () => {
    const img = white(W, H);
    hatchedBar(img, W, 20, 40, 40, 100, BLUE);
    const before = runBarDetect(img, W, H, BLUE, 60);
    const none = runBarDetect(img, W, H, BLUE, 60, 'foreground', undefined, undefined, undefined, undefined, undefined, []);
    const absent = runBarDetect(img, W, H, BLUE, 60, 'foreground', undefined, undefined, undefined, undefined, undefined, undefined);
    expect(none).toEqual(before);
    expect(absent).toEqual(before);
  });

  // the code review of 2026-11-06
  it('given the detector boxing one hatched bar twice, it is one bar', () => {
    const img = white(W, H);
    hatchedBar(img, W, 20, 40, 40, 100, BLUE);
    const r = runBarDetect(img, W, H, BLUE, 60, 'foreground', undefined, undefined, undefined, undefined, undefined, [
      proposal(20, 40, 60, 140, 0.9),
      proposal(21, 42, 61, 139, 0.8),
    ]);
    if ('error' in r) throw new Error(r.error);
    expect(r.boxes.map(boxOf).filter((b) => b[0]! >= 15 && b[2]! <= 65)).toEqual([[20, 40, 60, 140]]);
  });

  it('given one detector box over two whole bars of the colour, both bars stay as the colour read found them', () => {
    const img = white(W, H);
    block(img, W, 30, 50, 30, 90, BLUE);
    block(img, W, 62, 60, 30, 80, BLUE);
    const r = runBarDetect(img, W, H, BLUE, 60, 'foreground', undefined, undefined, undefined, undefined, undefined, [
      proposal(30, 50, 92, 140),
    ]);
    if ('error' in r) throw new Error(r.error);
    expect(r.boxes.map(boxOf)).toEqual([[30, 50, 60, 140], [62, 60, 92, 140]]);
  });

  it('given a hatch so dense that every piece is below the size kept, the detector’s bars are placed, not refused', () => {
    const img = white(W, H);
    hatchedBar(img, W, 20, 40, 40, 100, BLUE, 6); // 2 px lines every 6 px: 44% of the bar its own colour
    const r = runBarDetect(img, W, H, BLUE, 60, 'foreground', undefined, { minDiameter: 12 }, undefined, undefined, undefined, [
      proposal(20, 40, 60, 140),
    ]);
    expect('error' in r).toBe(false);
    if ('error' in r) return;
    expect(r.boxes.map(boxOf)).toEqual([[20, 40, 60, 140]]);
  });

  // the code review of 2026-11-06 (02248a6..d4deb83)
  it('given the detector’s bars alone (every piece too small), a floating swatch is held back and an empty category named, as on every path', () => {
    const img = white(W, H);
    hatchedBar(img, W, 20, 40, 40, 100, BLUE, 6); // category 0, standing on the baseline at y 140
    hatchedBar(img, W, 150, 20, 14, 10, BLUE, 6); // a legend swatch, floating and narrow, in category 2
    const r = runBarDetect(img, W, H, BLUE, 60, 'foreground', undefined, { minDiameter: 12 },
      { dividers: [0, 70, 140, 200], categoryAxis: 'x', expected: 3 }, { atPixel: 140, tolerancePx: 2 }, undefined, [
        proposal(20, 40, 60, 140),
        proposal(150, 20, 164, 30),
      ]);
    if ('error' in r) throw new Error(r.error);
    expect((r.swatchSuspects ?? []).map((k) => boxOf(r.boxes[k]!))).toEqual([[150, 20, 164, 30]]);
    expect(r.expectation?.emptyBands).toContain(1);
  });

  it('given one bar cut by a value label into big pieces, one above the other, the detector’s box is placed whole', () => {
    const img = white(W, H);
    block(img, W, 30, 40, 40, 100, BLUE);
    block(img, W, 30, 78, 40, 24, [255, 255, 255]); // a white label band across the bar: 38 / (24) / 38 px
    const r = runBarDetect(img, W, H, BLUE, 60, 'foreground', undefined, undefined,
      { dividers: [0, 100, 200], categoryAxis: 'x' }, undefined, undefined, [proposal(30, 40, 70, 140)]);
    if ('error' in r) throw new Error(r.error);
    expect(r.boxes.map(boxOf)).toEqual([[30, 40, 70, 140]]);
  });
});
