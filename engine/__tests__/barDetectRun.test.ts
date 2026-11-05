import { describe, it, expect } from 'vitest';
import { runBarDetect } from '../barDetectRun.js';

/** A width×height RGBA image, solid white and opaque. */
function whiteImage(width: number, height: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255;
    data[i + 1] = 255;
    data[i + 2] = 255;
    data[i + 3] = 255;
  }
  return data;
}

function fillBlock(data: Uint8ClampedArray, width: number, x0: number, y0: number, w: number, h: number, rgb: [number, number, number]) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const i = (y * width + x) * 4;
      data[i] = rgb[0];
      data[i + 1] = rgb[1];
      data[i + 2] = rgb[2];
      data[i + 3] = 255;
    }
  }
}

const BLUE: [number, number, number] = [30, 60, 220];

describe('runBarDetect', () => {
  it('returns one opposite-corner box per bar of the target colour, at its TRUE extent (not a centroid)', () => {
    const w = 40, h = 40;
    const img = whiteImage(w, h);
    // Two bars: a tall one at x=[4,8), y=[10,30), and a short one at x=[20,26), y=[24,30).
    fillBlock(img, w, 4, 10, 4, 20, BLUE);
    fillBlock(img, w, 20, 24, 6, 6, BLUE);

    const result = runBarDetect(img, w, h, BLUE, 40);
    if ('error' in result) throw new Error(result.error);
    expect(result.blobs).toBe(2);
    expect(result.boxes).toHaveLength(2);
    expect(result.matched).toBe(4 * 20 + 6 * 6);
    // Scan order top-to-bottom -> the tall bar (rows starting at y=10) comes first.
    expect(result.boxes[0]).toEqual({ start: { x: 4, y: 10 }, end: { x: 8, y: 30 } });
    expect(result.boxes[1]).toEqual({ start: { x: 20, y: 24 }, end: { x: 26, y: 30 } });
  });

  it('errors clearly when the colour matches too little', () => {
    const result = runBarDetect(whiteImage(10, 10), 10, 10, BLUE, 40);
    expect('error' in result && result.error).toMatch(/No pixels matched/);
  });

  it('errors clearly when every blob is filtered out by minDiameter', () => {
    const w = 20, h = 20;
    const img = whiteImage(w, h);
    fillBlock(img, w, 5, 5, 2, 2, BLUE); // a small noise speck, not a real bar
    const result = runBarDetect(img, w, h, BLUE, 40, 'foreground', undefined, { minDiameter: 100 });
    expect('error' in result && result.error).toMatch(/No bars of that size/);
  });

  it('two bars touching with no gap between them read as ONE merged box -- a known limit, not silently hidden', () => {
    // Documents the flood-fill limitation the module's own header comment
    // flags: same colour, zero gap, so they are one connected blob.
    const w = 20, h = 20;
    const img = whiteImage(w, h);
    fillBlock(img, w, 2, 5, 4, 10, BLUE);
    fillBlock(img, w, 6, 8, 4, 7, BLUE); // touches the first bar's right edge, no gap
    const result = runBarDetect(img, w, h, BLUE, 40);
    if ('error' in result) throw new Error(result.error);
    expect(result.blobs).toBe(1);
    expect(result.boxes[0]).toEqual({ start: { x: 2, y: 5 }, end: { x: 10, y: 15 } });
  });
});

describe('the bar reader searches the data area (v2.7, David 2026-11-02)', () => {
  it('a bar counts when its centre is inside the data area: one crossing its edge is read whole, one outside is not read', () => {
    const w = 60, h = 60;
    const img = whiteImage(w, h);
    fillBlock(img, w, 4, 20, 6, 30, BLUE); // inside
    fillBlock(img, w, 20, 5, 6, 45, BLUE); // runs out past the top edge, centre inside
    fillBlock(img, w, 50, 20, 6, 30, BLUE); // right of the data area
    const result = runBarDetect(img, w, h, BLUE, 40, 'foreground', { x: 0, y: 15, width: 45, height: 45 });
    if ('error' in result) throw new Error(result.error);
    const xs = result.boxes.map((b) => Math.min(b.start.x, b.end.x)).sort((a, b) => a - b);
    expect(xs).toEqual([4, 20]);
    const crossing = result.boxes.find((b) => Math.min(b.start.x, b.end.x) === 20)!;
    expect(Math.min(crossing.start.y, crossing.end.y)).toBe(5);
  });

  it('a same-colour swatch wholly outside the data area is not counted as matched ink', () => {
    const w = 60, h = 60;
    const img = whiteImage(w, h);
    fillBlock(img, w, 4, 20, 6, 30, BLUE); // the bar, 180 px
    fillBlock(img, w, 50, 2, 8, 8, BLUE); // a legend swatch beside the plot, 64 px
    const result = runBarDetect(img, w, h, BLUE, 40, 'foreground', { x: 0, y: 15, width: 45, height: 45 });
    if ('error' in result) throw new Error(result.error);
    expect(result.matched).toBe(180);
  });
});

// ⚑ Measured on the benchmark (docs/v2.7-workflow-walk.md, "The benchmarks at 2.7"): matched over the whole figure,
// grey bars joined the axis line and frame they stand on, drawn in the same grey, into one blob, and PMC bar recall
// fell from 76.4% to 74.5% (greyscale 70.4% to 66.5%). With the 2.6.0 clamp put back it was 76.6% and 76.3% again.
describe('bars in the same ink as the axis line and the frame along the data area', () => {
  const GREY: [number, number, number] = [60, 60, 60];
  function framed(): Uint8ClampedArray {
    const w = 80, h = 60;
    const img = whiteImage(w, h);
    // the frame round the data area x 10..70, y 5..50: one pixel lines, the bottom one is the axis the bars stand on
    fillBlock(img, w, 10, 5, 61, 1, GREY);
    fillBlock(img, w, 10, 50, 61, 1, GREY);
    fillBlock(img, w, 10, 5, 1, 46, GREY);
    fillBlock(img, w, 70, 5, 1, 46, GREY);
    // three bars standing on the axis line
    fillBlock(img, w, 15, 20, 8, 30, GREY);
    fillBlock(img, w, 35, 30, 8, 20, GREY);
    fillBlock(img, w, 55, 12, 8, 38, GREY);
    return img;
  }
  it('given grey bars standing on a grey axis line with a grey frame on the data area, each bar is read on its own', () => {
    const result = runBarDetect(framed(), 80, 60, GREY, 40, 'foreground', { x: 10, y: 5, width: 61, height: 46 });
    if ('error' in result) throw new Error(result.error);
    const boxes = result.boxes.map((b) => [Math.min(b.start.x, b.end.x), Math.min(b.start.y, b.end.y), Math.max(b.start.x, b.end.x)]).sort((a, b) => a[0]! - b[0]!);
    expect(boxes).toEqual([[15, 20, 23], [35, 30, 43], [55, 12, 63]]);
  });
  it('given touching bars (a histogram) covering the bottom edge, they keep their full height: they are bars, not a line along it', () => {
    const w = 80, h = 60;
    const img = whiteImage(w, h);
    fillBlock(img, w, 10, 30, 20, 20, GREY);
    fillBlock(img, w, 30, 20, 20, 30, GREY);
    fillBlock(img, w, 50, 35, 21, 15, GREY);
    const result = runBarDetect(img, w, h, GREY, 40, 'foreground', { x: 10, y: 5, width: 61, height: 46 });
    if ('error' in result) throw new Error(result.error);
    expect(result.boxes.map((b) => Math.max(b.start.y, b.end.y))).toEqual(result.boxes.map(() => 50));
  });
});
