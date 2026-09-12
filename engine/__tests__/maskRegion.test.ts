import { describe, expect, it } from 'vitest';
import { maskRegion, paperColourAround } from '../imageEdit.js';

/**
 * ⚑⚑ MASKING AN AREA - the cases, as what the pixels afterwards must show.
 *
 * David, 2026-09-12: *"the legend on the graph still keeps on causing issues.
 * Can it be masked?"* An inset legend draws the series' own ink at roughly the
 * series' own size inside the plot box, so nothing we can measure separates it
 * from the data. The person looking at the figure can, and this is the gesture.
 */

/** A `w`x`h` image on `paper`, with `blob` painted into `rect`. */
function figure(
  w: number,
  h: number,
  paper: [number, number, number],
  rect: { x: number; y: number; width: number; height: number },
  blob: [number, number, number]
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const inside =
        x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
      const [r, g, b] = inside ? blob : paper;
      const i = (y * w + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return data;
}

const pixel = (d: Uint8ClampedArray, w: number, x: number, y: number) => {
  const i = (y * w + x) * 4;
  return [d[i], d[i + 1], d[i + 2]];
};

describe('masking an area of the figure', () => {
  const legend = { x: 4, y: 4, width: 6, height: 6 };

  it('⚑⚑ the masked pixels are gone - a trace run afterwards cannot see them', () => {
    const src = figure(20, 20, [255, 255, 255], legend, [31, 119, 180]);
    const out = maskRegion(src, 20, 20, legend)!;
    expect(pixel(out.data, 20, 6, 6)).toEqual([255, 255, 255]);
  });

  it('⚑⚑ it takes the paper colour it MEASURES, not white', () => {
    // A tinted panel, the kind a journal prints. Painting white here would leave
    // a bright rectangle that is itself a feature no figure ever drew.
    const src = figure(20, 20, [232, 232, 220], legend, [31, 119, 180]);
    const out = maskRegion(src, 20, 20, legend)!;
    expect(pixel(out.data, 20, 6, 6)).toEqual([232, 232, 220]);
  });

  it('⚑ the modal colour wins, so a frame line next to the legend is not averaged in', () => {
    const src = figure(20, 20, [255, 255, 255], legend, [0, 0, 0]);
    // A black rule running down the column just left of the legend.
    for (let y = 0; y < 20; y += 1) {
      const i = (y * 20 + 3) * 4;
      src[i] = 0;
      src[i + 1] = 0;
      src[i + 2] = 0;
    }
    expect(paperColourAround(src, 20, 20, legend)).toEqual([255, 255, 255]);
  });

  it('⚑ nothing outside the rectangle is touched', () => {
    const src = figure(20, 20, [255, 255, 255], legend, [31, 119, 180]);
    const bar = { x: 14, y: 2, width: 3, height: 16 };
    for (let y = bar.y; y < bar.y + bar.height; y += 1) {
      for (let x = bar.x; x < bar.x + bar.width; x += 1) {
        const i = (y * 20 + x) * 4;
        src[i] = 31;
        src[i + 1] = 119;
        src[i + 2] = 180;
      }
    }
    const out = maskRegion(src, 20, 20, legend)!;
    expect(pixel(out.data, 20, 15, 10), 'the bar the legend described survives').toEqual([
      31, 119, 180,
    ]);
  });

  it('⚑⚑ the image keeps its size and every point stays put - masking removes evidence, not geometry', () => {
    const src = figure(20, 20, [255, 255, 255], legend, [31, 119, 180]);
    const out = maskRegion(src, 20, 20, legend)!;
    expect([out.width, out.height]).toEqual([20, 20]);
    expect(out.mapPoint(13.5, 7.25)).toEqual({ x: 13.5, y: 7.25 });
  });

  it('⚑ a degenerate drag masks nothing rather than painting the whole figure', () => {
    const src = figure(20, 20, [255, 255, 255], legend, [31, 119, 180]);
    expect(maskRegion(src, 20, 20, { x: 5, y: 5, width: 0, height: 0 })).toBeNull();
  });
});
