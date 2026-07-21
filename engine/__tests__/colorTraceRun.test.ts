import { describe, it, expect } from 'vitest';
import { runColorTrace } from '../colorTraceRun.js';

function makeImage(width: number, height: number, bg: [number, number, number]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = bg[0];
    data[i + 1] = bg[1];
    data[i + 2] = bg[2];
    data[i + 3] = 255;
  }
  return data;
}
function setPixel(data: Uint8ClampedArray, width: number, x: number, y: number, rgb: [number, number, number]) {
  const i = (y * width + x) * 4;
  data[i] = rgb[0];
  data[i + 1] = rgb[1];
  data[i + 2] = rgb[2];
  data[i + 3] = 255;
}

const WHITE: [number, number, number] = [255, 255, 255];
const RED: [number, number, number] = [220, 30, 30];

describe('runColorTrace', () => {
  it('traces a DASHED, sloping red curve by colour — one point per column, in x order', () => {
    const w = 10, h = 10;
    const img = makeImage(w, h, WHITE);
    // A rising dashed line: y decreases as x increases, with gaps (only even x drawn).
    for (let x = 0; x < w; x += 2) setPixel(img, w, x, 9 - x, RED);

    const result = runColorTrace(img, w, h, RED, 40, 'foreground');
    if ('error' in result) throw new Error(result.error);
    expect(result.matched).toBe(5); // 5 dashes
    // One point per matched column, x strictly increasing (curve order), each on the line.
    expect(result.points).toHaveLength(5);
    result.points.forEach((p) => expect(p.y).toBe(9 - p.x));
    const xs = result.points.map((p) => p.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
  });

  it('errors clearly when the colour matches (almost) nothing', () => {
    const w = 5, h = 5;
    const img = makeImage(w, h, WHITE);
    setPixel(img, w, 2, 2, RED); // a single stray red pixel (< MIN_MATCHED_PIXELS)
    const result = runColorTrace(img, w, h, RED, 40, 'foreground');
    expect('error' in result && result.error).toMatch(/No pixels matched|tolerance/);
  });

  it('honours a region, so a same-colour legend swatch outside the plot box is ignored', () => {
    const w = 12, h = 4;
    const img = makeImage(w, h, WHITE);
    setPixel(img, w, 0, 0, RED); // legend swatch (outside)
    setPixel(img, w, 1, 0, RED);
    setPixel(img, w, 1, 0, RED);
    for (let x = 6; x < 10; x++) setPixel(img, w, x, 2, RED); // the curve (inside)
    const result = runColorTrace(img, w, h, RED, 40, 'foreground', { x: 5, y: 0, width: 7, height: 4 });
    if ('error' in result) throw new Error(result.error);
    expect(result.points.every((p) => p.x >= 6 && p.x <= 9)).toBe(true);
  });
});
