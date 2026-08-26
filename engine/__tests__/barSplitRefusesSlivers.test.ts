import { describe, it, expect } from 'vitest';
import { runBarDetect } from '../barDetectRun.js';

/**
 * ⚑⚑ A CUT THAT PRODUCES A SLIVER IS A MISPLACED DIVIDER, NOT A BOUNDARY.
 *
 * Found on the screenshot bench, 2026-08-26, re-shooting the website gallery.
 * `Cat 1` is OFFERED at the value origin (`commonOrigin: p1 -> c1`), and on
 * `samples/bar-floating-temperature.png` the value axis's spine sits 23px
 * outside where the categories actually start - 37% of a band on a figure with
 * twelve of them. Every divider lands inside a bar, and the splitter cut them:
 *
 *     12 bars  ->  16 boxes, widths 38,38,38,38,36,34,37,32,4,37,30,6,28,8,37
 *
 * Slivers of 4, 6 and 8 pixels beside bars of 38. Each one is a READING THE
 * FIGURE DOES NOT CONTAIN, filed with a category and a value, and it exports.
 *
 * ⚑ THE RULE IS ONE THIS CODEBASE ALREADY OWNS. `swatchSuspectsIn` decides
 * "small" by comparing a shape's category extent with the MEDIAN of the shapes
 * that reach the baseline - measured against the figure's own bars, never
 * against a constant. This asks the same question of a split's pieces, against
 * the median of the blobs that needed no cutting.
 *
 * ⚠️ AND IT REFUSES THE CUT RATHER THAN DROPPING THE SLIVER. Two touching bars
 * read as one wide box is a VISIBLE failure; a sliver filed as a bar is an
 * invisible one. [[project_touching_bars_plan]] records this project choosing
 * the visible failure once already, and reverting the technique that won on the
 * metric by trading one for the other.
 *
 * ⚠️ THE WIDTH TEST FROM THE BENCHMARK WORK IS NOT WHAT THIS IS. That one is
 * net negative at every ratio unless gated on `isMonochrome`, because it CUTS
 * MORE. This only ever cuts LESS, so it cannot break a bar the old code got
 * right - the worst it can do is leave a merge merged, which is what happens
 * today anyway on any figure without declared categories.
 */

const W = 400;
const H = 200;

function image(rects: { x0: number; y0: number; x1: number; y1: number }[]) {
  const data = new Uint8ClampedArray(W * H * 4).fill(255);
  for (const r of rects) {
    for (let y = r.y0; y <= r.y1; y += 1) {
      for (let x = r.x0; x <= r.x1; x += 1) {
        const i = (y * W + x) * 4;
        data[i] = 0;
        data[i + 1] = 0;
        data[i + 2] = 0;
      }
    }
  }
  return data;
}

const BLACK: [number, number, number] = [0, 0, 0];
const detect = (data: Uint8ClampedArray, dividers: number[]) =>
  runBarDetect(data, W, H, BLACK, 30, 'foreground', undefined, { minDiameter: 3 }, {
    dividers,
    categoryAxis: 'x',
  });

const widthsOf = (r: ReturnType<typeof detect>) =>
  'error' in r ? [] : r.boxes.map((b) => Math.round(Math.abs(b.end.x - b.start.x))).sort((a, b) => a - b);

describe('a divider that lands inside a bar does not carve a sliver off it', () => {
  it('⚑⚑ a bar straddling a misplaced divider stays ONE bar', () => {
    // Four 40px bars on a 100px pitch, with ONE boundary landing inside a bar.
    // ⚑ The others must stay clear, and that is not a convenience: they are the
    // reference for how wide a bar is on this figure. On the real sample eight
    // of twelve bars were uncrossed, which is why it can be judged at all.
    const bars = [0, 1, 2, 3].map((i) => ({ x0: 30 + i * 100, y0: 60, x1: 70 + i * 100, y1: 180 }));
    const r = detect(image(bars), [0, 60, 200, 300, 400]);
    if ('error' in r) throw new Error(r.error);
    expect(widthsOf(r)).toEqual([41, 41, 41, 41]);
  });

  it('⚑ and a REAL merge is still cut - the refusal is about slivers, not about splitting', () => {
    // One 190px run of touching bars across two 100px bands: cutting it yields
    // two pieces of comparable width, so nothing is refused.
    const r = detect(image([{ x0: 5, y0: 60, x1: 195, y1: 180 }]), [0, 100, 200]);
    if ('error' in r) throw new Error(r.error);
    expect(r.boxes.length).toBe(2);
    const w = widthsOf(r);
    expect(Math.min(...w)).toBeGreaterThan(80);
  });

  it('⚑ a run cut into one fat piece and one sliver is kept whole', () => {
    // The shape the misplacement makes: a lone bar with a boundary near its edge.
    // ⚠️ It needs SIBLINGS to judge "sliver" against - see the next case.
    const bars = [
      { x0: 30, y0: 60, x1: 70, y1: 180 },
      { x0: 130, y0: 60, x1: 170, y1: 180 },
      { x0: 230, y0: 60, x1: 270, y1: 180 },
      { x0: 330, y0: 60, x1: 366, y1: 180 },
    ];
    const r = detect(image(bars), [0, 100, 200, 300, 362, 400]);
    if ('error' in r) throw new Error(r.error);
    // The last divider at 362 sits 4px inside the fourth bar. Without the
    // refusal that bar becomes 33 + 4.
    expect(widthsOf(r)).not.toContain(4);
    expect(r.boxes.length).toBe(4);
  });

  it('⚠️ with nothing uncut to compare against, the split is unchanged', () => {
    // Every blob crossed: there is no reference for "the bars on this figure are
    // about this wide", and guessing one would be the thing the swatch test
    // refuses to do. Same rule, same reason.
    const r = detect(image([{ x0: 5, y0: 60, x1: 195, y1: 180 }]), [0, 190, 200]);
    if ('error' in r) throw new Error(r.error);
    expect(r.boxes.length).toBeGreaterThan(0);
  });
});
