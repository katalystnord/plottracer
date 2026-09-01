import { describe, it, expect } from 'vitest';

import { extendAcrossOutline, MAX_OUTLINE_PX } from '../barOutline.js';

/**
 * ⚑⚑ A BAR'S OWN OUTLINE IS PART OF THE BAR, and leaving it out reads every
 * outlined bar LOW.
 *
 * Measured on `samples/bar-hatched-extraction-yield.png`, whose bars carry a 1px
 * black stroke: the colour trace matches the FILL, which stops just inside that
 * stroke, so all six bars read low by about a pixel - a mean of **-0.99px**,
 * every one of them negative. Reading the same figure to the outer edge of the
 * stroke gives **+0.01px**, scattered either side. That is not a tuning
 * improvement, it is the difference between a systematic bias and none.
 *
 * ⚑ WHY THE OUTER EDGE AND NOT THE STROKE'S CENTRE. Both were measured; the
 * centre still reads -0.49px. The luminance profile above a bar top is
 * `255, 255, 205, 0, 55, 69, 69` - paper, antialias, the black stroke, a blend,
 * then the fill - and the row the mask starts on is already the blend BELOW the
 * stroke. Stepping out by the stroke's width lands on the boundary the figure
 * drew.
 *
 * ⛔⛔ AND IT IS SELF-LIMITING, which is what makes it safe to apply to every
 * bar. An outline is drawn DARKER than the fill; an antialiased edge against
 * paper is LIGHTER. Measured on two unoutlined figures, the band comes back 0px
 * on every bar and the reading is untouched (-0.04px and -0.23px, both
 * unchanged). A figure that does not outline its bars cannot be affected.
 */

/** An image of `paper`, with a `fill` block, optionally edged by `outline`. */
function figure(opts: {
  width?: number;
  height?: number;
  top: number;
  bottom: number;
  left?: number;
  right?: number;
  fill: number;
  paper?: number;
  outline?: number;
  outlineWidth?: number;
}): { data: Uint8ClampedArray; width: number; height: number } {
  const width = opts.width ?? 40;
  const height = opts.height ?? 60;
  const paper = opts.paper ?? 255;
  const left = opts.left ?? 10;
  const right = opts.right ?? 30;
  const data = new Uint8ClampedArray(width * height * 4);
  const put = (x: number, y: number, v: number) => {
    const i = (y * width + x) * 4;
    data[i] = v;
    data[i + 1] = v;
    data[i + 2] = v;
    data[i + 3] = 255;
  };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) put(x, y, paper);
  const ow = opts.outline === undefined ? 0 : opts.outlineWidth ?? 1;
  for (let y = opts.top - ow; y < opts.bottom + ow; y++) {
    for (let x = left; x < right; x++) {
      if (y < 0 || y >= height) continue;
      put(x, y, y < opts.top || y >= opts.bottom ? opts.outline! : opts.fill);
    }
  }
  return { data, width, height };
}

const box = (top: number, bottom: number) => ({ minX: 10, minY: top, maxX: 30, maxY: bottom });

describe('a bar is measured to the outside of its own outline', () => {
  it('⚑⚑ steps out across a 1px stroke at both value edges', () => {
    const img = figure({ top: 20, bottom: 50, fill: 69, outline: 0 });
    const out = extendAcrossOutline(img.data, img.width, img.height, box(20, 50), 'x', 69);
    expect(out).toEqual({ minX: 10, minY: 19, maxX: 30, maxY: 51 });
  });

  it('⛔ leaves a bar with no outline exactly where it was', () => {
    // ⚑ THE SELF-LIMITING HALF. Paper is LIGHTER than the fill, so there is no
    // darker band to step across and nothing happens - which is why this can run
    // on every bar without a declaration gating it.
    const img = figure({ top: 20, bottom: 50, fill: 69 });
    expect(extendAcrossOutline(img.data, img.width, img.height, box(20, 50), 'x', 69)).toEqual(
      box(20, 50)
    );
  });

  it('⛔ refuses a dark band too thick to be a stroke', () => {
    // Another object touching the bar - a dark neighbour, an axis rule, a second
    // series - is not an outline, and absorbing it would invent extent.
    const img = figure({ top: 20, bottom: 50, fill: 69, outline: 0, outlineWidth: MAX_OUTLINE_PX + 2 });
    expect(extendAcrossOutline(img.data, img.width, img.height, box(20, 50), 'x', 69)).toEqual(
      box(20, 50)
    );
  });

  it('does not widen the bar along the CATEGORY axis', () => {
    // ⚑ A bar's WIDTH is not its datum, and stepping sideways would walk toward
    // its neighbours. Only the value edges move.
    const img = figure({ top: 20, bottom: 50, fill: 69, outline: 0 });
    const out = extendAcrossOutline(img.data, img.width, img.height, box(20, 50), 'x', 69);
    expect([out.minX, out.maxX]).toEqual([10, 30]);
  });

  it('steps along the OTHER axis on a horizontal chart', () => {
    const img = figure({ top: 20, bottom: 50, fill: 69, outline: 0 });
    const out = extendAcrossOutline(img.data, img.width, img.height, box(20, 50), 'y', 69);
    // categoryAxis 'y' means the values run along x, so the y edges stay put.
    expect([out.minY, out.maxY]).toEqual([20, 50]);
  });

  it('ignores a stroke lighter than the fill', () => {
    // A white keyline between stacked segments is not this bar's edge.
    const img = figure({ top: 20, bottom: 50, fill: 69, outline: 200 });
    expect(extendAcrossOutline(img.data, img.width, img.height, box(20, 50), 'x', 69)).toEqual(
      box(20, 50)
    );
  });
});
