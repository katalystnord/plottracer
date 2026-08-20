import { describe, expect, it } from 'vitest';
import { readHeatmap, type PixelProjector } from '../heatmapRead.js';
import { sampleColorBar } from '../colorBar.js';
import type { ColorScale } from '../colorScale.js';
import type { RGB } from '../colorFilter.js';

/**
 * The heatmap reader's own logic, on figures built to order.
 *
 * ⚑ MUTATION: 91.46% for `heatmapRead.ts` (scoped throwaway config; see
 * `colorBar.test.ts` for the recipe). The survivors are two known classes, each
 * read and left deliberately: the sampling window's out-of-bounds guards, whose
 * off-by-ones let a single stray pixel into a 49-pixel medoid that is BUILT to
 * outvote one - the guard that matters, the one stopping a read from wrapping
 * onto the next row, is killed by the off-canvas test - and the layered
 * fallbacks in `midpointOnAxis`, where disabling any one of three leaves the
 * next one catching the same degenerate projector. Defence in depth reads as
 * surviving mutants; the alternative is a single guard and a NaN centre.
 *
 * ⚑ THE REAL RENDERS ARE THE OTHER INSTRUMENT (`engine/__tests__/
 * heatmapReadRealPng.test.ts`), and they answer the accuracy question. What they
 * cannot do is produce a LOG axis, a rotated scan, a cell with a printed number
 * in it or a cell half off the canvas on demand - so those are drawn here, where
 * the geometry is known exactly and the expected answer is arithmetic rather
 * than a measurement.
 */

const W = 400;
const H = 300;

/** A key running left to right along the bottom of the canvas. */
function greyKeyImage(): Uint8ClampedArray {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  for (let x = 0; x < 256; x++)
    for (let y = 280; y < 290; y++) {
      const i = (y * W + x) * 4;
      data[i] = x;
      data[i + 1] = x;
      data[i + 2] = x;
    }
  return data;
}

/** Paint an axis-aligned block of the image. */
function fill(
  data: Uint8ClampedArray,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  rgb: RGB
): void {
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const i = (y * W + x) * 4;
      data[i] = rgb[0];
      data[i + 1] = rgb[1];
      data[i + 2] = rgb[2];
      data[i + 3] = 255;
    }
}

function greyScale(data: Uint8ClampedArray): ColorScale {
  const strip = sampleColorBar(data, W, H, { x: 0, y: 285 }, { x: 255, y: 285 }).strip!;
  return {
    strip,
    // 0 grey is value 0, 255 grey is value 255 - so a cell's value IS its grey
    // level, and every expectation below can be read off the fill colour.
    ticks: [
      { point: { x: 0, y: 285 }, value: 0 },
      { point: { x: 255, y: 285 }, value: 255 },
    ],
    log: false,
  };
}

/** An axis-aligned linear frame: data x 0..4 across pixels 20..220, data y 0..2
 * down pixels 220..20 (image y grows downward, as a figure's does). */
const linearAxes: PixelProjector = {
  dataToPixel: (x, y) => ({ x: 20 + x * 50, y: 220 - y * 100 }),
};

describe('readHeatmap', () => {
  it('reads each cell’s own colour, cell by cell', () => {
    const data = greyKeyImage();
    // Four cells across data x 0..4, one row: greys 40, 80, 120, 160.
    fill(data, 20, 20, 70, 220, [40, 40, 40]);
    fill(data, 70, 20, 120, 220, [80, 80, 80]);
    fill(data, 120, 20, 170, 220, [120, 120, 120]);
    fill(data, 170, 20, 220, 220, [160, 160, 160]);
    const cells = readHeatmap(data, W, H, linearAxes, [0, 1, 2, 3, 4], [0, 2], greyScale(data))!;
    expect(cells.map((c) => Math.round(c.value!))).toEqual([40, 80, 120, 160]);
    expect(cells.every((c) => c.uniformity === 1)).toBe(true);
  });

  it('is null for a grid that is not a grid, never a partial matrix', () => {
    const data = greyKeyImage();
    expect(readHeatmap(data, W, H, linearAxes, [0], [0, 2], greyScale(data))).toBeNull();
    expect(readHeatmap(data, W, H, linearAxes, [0, 1], [0, NaN], greyScale(data))).toBeNull();
  });

  it('INSETS the sample, so an anti-aliased border is not read as data', () => {
    // ⚑ A border drawn ON the boundary blends the two neighbouring colours into
    // one that is on NEITHER - a colour that inverts to a position between two
    // cells and reports itself as a confident reading of a value the figure
    // never printed. Here the border is 3px of white, the worst case.
    const data = greyKeyImage();
    fill(data, 20, 20, 120, 220, [60, 60, 60]);
    fill(data, 120, 20, 220, 220, [200, 200, 200]);
    for (const x of [20, 21, 22, 119, 120, 121, 218, 219]) fill(data, x, 20, x + 1, 220, [255, 255, 255]);
    const cells = readHeatmap(data, W, H, linearAxes, [0, 2, 4], [0, 2], greyScale(data))!;
    expect(cells.map((c) => Math.round(c.value!))).toEqual([60, 200]);

    // …and with the inset turned off the border gets in, which is what makes the
    // default load-bearing rather than decorative.
    const flush = readHeatmap(data, W, H, linearAxes, [0, 2, 4], [0, 2], greyScale(data), {
      inset: 0,
    })!;
    expect(flush.some((c) => c.uniformity < 1)).toBe(true);
  });

  it('reports HOW MUCH of a cell is the colour it read', () => {
    // ⚑ The evidence channel the colour itself cannot provide: a cell carrying a
    // printed number or a significance asterisk can have a colour that sits
    // exactly on the ramp - distance 0, a tight band, total confidence - while a
    // chunk of it is ink that is not data. Uniformity is the only signal that
    // says so, and on a real quality-35 JPEG it caught the one cell the other
    // two measures could not.
    const data = greyKeyImage();
    fill(data, 20, 20, 220, 220, [90, 90, 90]);
    const clean = readHeatmap(data, W, H, linearAxes, [0, 4], [0, 2], greyScale(data))!;
    expect(clean[0]!.uniformity).toBe(1);

    // A printed "42" across the middle of the same cell.
    fill(data, 90, 100, 150, 140, [0, 0, 0]);
    const marked = readHeatmap(data, W, H, linearAxes, [0, 4], [0, 2], greyScale(data))!;
    expect(marked[0]!.uniformity).toBeLessThan(1);
    // The VALUE is still the cell's own colour - the ink is outvoted, not
    // averaged in - so the reading survives and the warning travels with it.
    expect(Math.round(marked[0]!.value!)).toBe(90);
  });

  it('samples across a ROTATED cell, not across a screen rectangle', () => {
    // A scanned figure's rows are not the image's rows. The cell is sampled
    // through the axes' own projection, so a rotated frame is read on its own
    // terms rather than through a bounding box that overlaps its neighbours.
    const angle = 0.3;
    const rotated: PixelProjector = {
      dataToPixel: (x, y) => {
        const px = 20 + x * 50;
        const py = 220 - y * 100;
        const cx = 120;
        const cy = 120;
        return {
          x: cx + (px - cx) * Math.cos(angle) - (py - cy) * Math.sin(angle),
          y: cy + (px - cx) * Math.sin(angle) + (py - cy) * Math.cos(angle),
        };
      },
    };
    const data = greyKeyImage();
    // Paint the two rotated cells by walking their own coordinates.
    for (let u = 0; u < 400; u++)
      for (let v = 0; v < 200; v++) {
        const p = rotated.dataToPixel((u / 400) * 4, (v / 200) * 2);
        const x = Math.round(p.x);
        const y = Math.round(p.y);
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const i = (y * W + x) * 4;
        const grey = u < 200 ? 70 : 180;
        data[i] = grey;
        data[i + 1] = grey;
        data[i + 2] = grey;
        data[i + 3] = 255;
      }
    const cells = readHeatmap(data, W, H, rotated, [0, 2, 4], [0, 2], greyScale(data))!;
    expect(cells.map((c) => Math.round(c.value!))).toEqual([70, 180]);
    // ⚑ And every sample landed INSIDE its own rotated cell: a lattice built the
    // wrong way round would stray onto the neighbour or off the figure entirely,
    // which shows up as a colour off the ramp or a cell that is not one colour.
    expect(cells.every((c) => c.value !== null)).toBe(true);
    expect(cells.every((c) => c.uniformity === 1)).toBe(true);
  });

  it('puts a LOG cell’s centre in the middle of the INK, not between its bounds', () => {
    // ⚑ On a linear axis the two agree and the distinction is invisible. On a log
    // axis the middle of the block of ink is the GEOMETRIC centre: a cell from 1
    // to 100 is centred at 10, not at 50.5. What is being reported is where the
    // cell is, so it is measured where the cell is.
    const logAxes: PixelProjector = {
      dataToPixel: (x, y) => ({ x: 20 + Math.log10(x) * 100, y: 220 - y * 100 }),
    };
    const data = greyKeyImage();
    fill(data, 20, 20, 220, 220, [90, 90, 90]);
    const cells = readHeatmap(data, W, H, logAxes, [1, 100], [0, 2], greyScale(data))!;
    expect(cells[0]!.xCentre).toBeCloseTo(10, 4);
    expect(cells[0]!.xCentre).not.toBeCloseTo(50.5, 0);
    // The linear axis is unaffected by the same code path.
    expect(cells[0]!.yCentre).toBeCloseTo(1, 6);
  });

  it('reports a cell it could not sample as UNREAD, never as zero', () => {
    // ⚑ A cell off the edge of the canvas has no colour, and `0` is a value the
    // figure might really contain - the difference between "no data" and "zero"
    // is the whole of tenet 9 in one field.
    const data = greyKeyImage();
    fill(data, 20, 20, 220, 220, [90, 90, 90]);
    const offImage: PixelProjector = {
      dataToPixel: (x, y) => ({ x: 5000 + x, y: 5000 + y }),
    };
    const cells = readHeatmap(data, W, H, offImage, [0, 4], [0, 2], greyScale(data))!;
    expect(cells[0]!.value).toBeNull();
    expect(cells[0]!.samples).toBe(0);
    expect(cells[0]!.uniformity).toBe(0);
    expect(cells[0]!.rgb).toEqual([0, 0, 0]);
  });

  it('skips fully transparent pixels rather than reading them as black', () => {
    const data = greyKeyImage();
    fill(data, 20, 20, 220, 220, [90, 90, 90]);
    // Knock a hole in the left half of the cell.
    for (let y = 20; y < 220; y++)
      for (let x = 20; x < 120; x++) data[(y * W + x) * 4 + 3] = 0;
    const cells = readHeatmap(data, W, H, linearAxes, [0, 4], [0, 2], greyScale(data))!;
    expect(Math.round(cells[0]!.value!)).toBe(90);
    expect(cells[0]!.samples).toBeGreaterThan(0);
    expect(cells[0]!.samples).toBeLessThan(49);
  });

  it('a colour the range holds in TWO places is not measurable', () => {
    // ⚑ A key that returns to the same grey, so this colour has no single
    // position on the range. It used to record one of the two answers and list
    // the other as a "rival" beside it; a lookup that finds the colour twice has
    // not found it, so there is no value.
    // ⚠️ A published colormap is injective, so this cannot happen on a clean
    // read - it means the scan, the compression or the sampling degraded the
    // colour until it stopped identifying one value.
    const data = greyKeyImage();
    for (let x = 0; x < 256; x++)
      for (let y = 280; y < 290; y++) {
        const grey = Math.round((1 - Math.abs((x / 255) * 2 - 1)) * 255);
        const i = (y * W + x) * 4;
        data[i] = grey;
        data[i + 1] = grey;
        data[i + 2] = grey;
      }
    fill(data, 20, 20, 220, 220, [128, 128, 128]);
    const cells = readHeatmap(data, W, H, linearAxes, [0, 4], [0, 2], greyScale(data))!;
    expect(cells[0]!.value).toBeNull();
    // The COLOUR is never in doubt - only its position on the range.
    expect(cells[0]!.rgb).toEqual([128, 128, 128]);
  });

  it('reads the pixels that EXIST when a cell hangs off the canvas', () => {
    // ⚑ A cropped figure, or a grid dragged past the image edge. Every side, and
    // separately: a guard that checks three of the four still looks like it
    // works, and reads whatever the buffer holds next on the fourth.
    const data = greyKeyImage();
    fill(data, 0, 0, W, 260, [90, 90, 90]);
    const shifted = (dx: number, dy: number): PixelProjector => ({
      dataToPixel: (x, y) => ({ x: 20 + x * 50 + dx, y: 220 - y * 100 + dy }),
    });
    // Each shift takes part of the SAMPLED region - not merely part of the cell
    // - past one edge, which is the only arrangement that exercises the guard.
    for (const [dx, dy] of [
      [-140, 0],
      [260, 0],
      [0, -100],
      [0, 140],
    ] as Array<[number, number]>) {
      const cells = readHeatmap(data, W, H, shifted(dx, dy), [0, 4], [0, 2], greyScale(data))!;
      expect(cells[0]!.samples).toBeGreaterThan(0);
      expect(cells[0]!.samples).toBeLessThan(49);
      expect(Math.round(cells[0]!.value!)).toBe(90);
    }
  });

  it('keeps a cell’s three channels apart', () => {
    // A grey figure cannot tell red from blue: every channel holds the same
    // number, so an index slipped by one is invisible. The sampled colour is
    // reported, so it can be checked on a cell that is NOT grey.
    const data = greyKeyImage();
    fill(data, 20, 20, 220, 220, [10, 120, 200]);
    // ⚑ And every ODD column a different blue, so that reading a NEIGHBOURING
    // pixel's channel - an index slipped by one within the buffer - returns a
    // different colour rather than the same one. A uniform fill cannot tell the
    // two apart, because the pixel beside it holds identical bytes.
    for (let x = 21; x < 220; x += 2) fill(data, x, 20, x + 1, 220, [10, 120, 60]);
    const cells = readHeatmap(data, W, H, linearAxes, [0, 4], [0, 2], greyScale(data))!;
    expect(cells[0]!.rgb).toEqual([10, 120, 200]);
    // …and being nowhere near this grey key, it is not on the range at all, so
    // there is no value. It used to come back with a number and a `distance`
    // caveat attached.
    expect(cells[0]!.value).toBeNull();
  });

  it('counts a pixel EXACTLY at the noise floor as matching', () => {
    // The uniformity threshold is "within", not "inside": a pixel 4 RGB units
    // from the cell's colour is the encoder's rounding, not a second colour.
    const data = greyKeyImage();
    fill(data, 20, 20, 220, 220, [90, 90, 90]);
    fill(data, 100, 100, 140, 140, [94, 90, 90]); // distance exactly 4
    const cells = readHeatmap(data, W, H, linearAxes, [0, 4], [0, 2], greyScale(data))!;
    expect(cells[0]!.uniformity).toBe(1);
    fill(data, 100, 100, 140, 140, [95, 90, 90]); // distance 5
    const beyond = readHeatmap(data, W, H, linearAxes, [0, 4], [0, 2], greyScale(data))!;
    expect(beyond[0]!.uniformity).toBeLessThan(1);
  });

  it('samples the cell’s far corner too, not just the middle of the lattice', () => {
    // The inset lattice has to SPAN the cell's interior. A lattice quietly
    // compressed toward one corner would still return the right answer on a flat
    // cell and would miss whatever sits in the other half.
    const data = greyKeyImage();
    fill(data, 20, 20, 220, 220, [90, 90, 90]);
    fill(data, 175, 175, 186, 186, [10, 10, 10]); // the lattice's far corner, u = 0.8
    const cells = readHeatmap(data, W, H, linearAxes, [0, 4], [0, 2], greyScale(data))!;
    expect(cells[0]!.uniformity).toBeLessThan(1);
  });

  it('reports a cell as unread when the KEY is unusable, not just the pixels', () => {
    // The other way a value can be unavailable. The cell samples perfectly well;
    // it is the scale that cannot say what the colour means, and the record must
    // show that as unread rather than as a number.
    const data = greyKeyImage();
    fill(data, 20, 20, 220, 220, [90, 90, 90]);
    const scale = greyScale(data);
    const broken: ColorScale = { ...scale, ticks: [scale.ticks[0], scale.ticks[0]] };
    const cells = readHeatmap(data, W, H, linearAxes, [0, 4], [0, 2], broken)!;
    expect(cells[0]!.value).toBeNull();
    expect(cells[0]!.samples).toBeGreaterThan(0);
    expect(cells[0]!.rgb).toEqual([90, 90, 90]);
  });

  it('falls back to the midpoint of the bounds when the axis cannot project', () => {
    // A degenerate projector - non-finite pixels, or two bounds landing on the
    // same one. There is no ink to find a centre in, so the arithmetic midpoint
    // is the only honest answer left, and it must not come back as NaN.
    const data = greyKeyImage();
    const nonFinite: PixelProjector = { dataToPixel: () => ({ x: NaN, y: NaN }) };
    const collapsed: PixelProjector = { dataToPixel: () => ({ x: 100, y: 100 }) };
    for (const axes of [nonFinite, collapsed]) {
      const cells = readHeatmap(data, W, H, axes, [0, 4], [0, 2], greyScale(data))!;
      expect(cells[0]!.xCentre).toBe(2);
      expect(cells[0]!.yCentre).toBe(1);
    }
  });

  // ⚠️⚠️ REMOVED WITH THE ESTIMATOR, AND IT IS THE ONE REMOVAL WITH AN ARGUMENT
  // AGAINST IT. `atKeyLimit` flagged a cell drawn in the key's extreme colour,
  // where a figure whose data runs past its own key draws cells that are exact,
  // uniform and silently wrong - found by building an example, five cells up to
  // 62% out. It was computed from the old band (does the interval touch an end),
  // which is gone. The FACT is still measurable without a band - the cell's
  // colour is the key's first or last entry - so this is a decision about scope,
  // not a capability we lost. Raised with David; restore this test if it comes
  // back.

  it('clamps an absurd inset instead of sampling nothing', () => {
    const data = greyKeyImage();
    fill(data, 20, 20, 220, 220, [90, 90, 90]);
    for (const inset of [0.9, -1, NaN]) {
      const cells = readHeatmap(data, W, H, linearAxes, [0, 4], [0, 2], greyScale(data), {
        inset,
      })!;
      expect(cells[0]!.samples).toBeGreaterThan(0);
      expect(Math.round(cells[0]!.value!)).toBe(90);
    }
  });

  it('takes a single sample from the cell’s CENTRE when asked for one', () => {
    // The cheap mode, and the one the sampling rule calls honest under a virtual
    // lattice: a smooth field has no "cell colour" to find, so the centre is the
    // reading. It must be the centre and not a corner.
    const data = greyKeyImage();
    fill(data, 20, 20, 220, 220, [90, 90, 90]);
    fill(data, 20, 20, 60, 60, [10, 10, 10]);
    const cells = readHeatmap(data, W, H, linearAxes, [0, 4], [0, 2], greyScale(data), {
      maxSamplesPerAxis: 1,
    })!;
    expect(cells[0]!.samples).toBe(1);
    expect(Math.round(cells[0]!.value!)).toBe(90);
  });
});
