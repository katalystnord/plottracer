/**
 * ⚑⚑ A DETECTED BOUNDARY LANDS ON THE INK IT WAS DETECTED FROM, LOG AXIS OR NOT.
 *
 * ⚠️ FOUND BY AUDIT, 2026-09-10. `detectGrid` turned the detector's answers -
 * FRACTIONS OF THE PLOT BOX - into data coordinates by interpolating in DATA:
 * `lo + f * (hi - lo)`. That is right only on a linear axis, and a heatmap axis
 * may be logarithmic (`HEATMAP_AXES_CONFIG` ships `isLogX`/`isLogY` with log
 * scale guards).
 *
 * `algorithms/gridDetect.ts` states the contract its caller broke: *"Where it
 * sits along the axis, 0 at the box's origin edge and 1 at the far one. The
 * caller converts to data coordinates through its own axes - this module never
 * sees them."*
 *
 * ⚑⚑ AND THE REPORT CLAIMED AGREEMENT. Measured on a log X calibrated 1..1000
 * with three equal-width columns: the boundaries drawn at px 200 and 300 were
 * placed at data 332 and 665, whose pixels are 352 and 382 - a grid drawn 150px
 * from the ink, cells then sampled in the wrong pixels, `x min`/`x max` wrong in
 * the export - while the message said "3 columns, matching the 2 boundaries
 * found". The one signal the user has said it agreed.
 */
import { describe, expect, it } from 'vitest';
import { detectGrid } from '../heatmapRun.js';
import type { PixelProjector } from '../../algorithms/heatmapRead.js';

const BOX_LEFT = 100;
const BOX_RIGHT = 400;
const BOX_TOP = 50;
const BOX_BOTTOM = 250;

/** X logarithmic over 1..1000 across the box; Y linear. Inverts, as the app's
 *  axes do. */
const logX: PixelProjector = {
  dataToPixel: (x, y) => ({
    x: BOX_LEFT + ((Math.log10(x) - 0) / 3) * (BOX_RIGHT - BOX_LEFT),
    y: BOX_BOTTOM - (y / 8) * (BOX_BOTTOM - BOX_TOP),
  }),
  pixelToData: (px, py) => [
    Math.pow(10, ((px - BOX_LEFT) / (BOX_RIGHT - BOX_LEFT)) * 3),
    ((BOX_BOTTOM - py) / (BOX_BOTTOM - BOX_TOP)) * 8,
  ],
};

/** Three flat columns of EQUAL PIXEL WIDTH, split by drawn rules at px 200/300
 *  - which on this axis are data 10 and 100. */
function threeColumns(): { data: Uint8ClampedArray; width: number; height: number } {
  const width = 500;
  const height = 300;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  const fills: [number, number, number][] = [
    [30, 60, 200],
    [40, 180, 80],
    [220, 60, 40],
  ];
  for (let y = BOX_TOP; y <= BOX_BOTTOM; y++) {
    for (let x = BOX_LEFT; x <= BOX_RIGHT; x++) {
      const band = x < 200 ? 0 : x < 300 ? 1 : 2;
      const rgb = fills[band]!;
      const i = (y * width + x) * 4;
      data[i] = rgb[0];
      data[i + 1] = rgb[1];
      data[i + 2] = rgb[2];
      data[i + 3] = 255;
    }
  }
  return { data, width, height };
}

describe('grid detection on a log axis', () => {
  it('⚑⚑ places each detected boundary on the pixel it was found at', () => {
    const image = threeColumns();
    const result = detectGrid(image, logX, {
      xDividers: [1, 1000],
      yDividers: [0, 8],
    }, { columns: 3 });
    expect(result.grid, result.message).not.toBeNull();
    const xs = result.grid!.xDividers;
    expect(xs.length, `detected ${JSON.stringify(xs)}`).toBe(4);

    // ⚑ THE ASSERTION IS IN PIXELS, because that is where the ink is and the
    // whole defect was a data-space shortcut.
    // ⚑ A BOUNDARY SITS BETWEEN PIXELS, not on one: the colour changes between
    // px 199 and px 200, so 199.5 IS the rule and an expectation of exactly 200
    // is half a pixel too generous in one direction and impossible in the other.
    const px = xs.map((d) => logX.dataToPixel(d, 0).x);
    expect(px[1], `interior boundaries landed at ${JSON.stringify(px)}`).toBeCloseTo(199.5, 1);
    expect(px[2], `interior boundaries landed at ${JSON.stringify(px)}`).toBeCloseTo(299.5, 1);

    // ...and in data those are ~10 and ~99, which is the log axis being
    // honoured. The linear shortcut put them at 332 and 665.
    // ⚑ NOT ASSERTED TO THE DECIMAL, and the reason is the finding itself: the
    // rule sits at px 299.5, and half a pixel near 100 on a log axis is worth
    // 1.15 data units. Demanding exactly 100 would be asking the figure for
    // precision it does not carry - which is the mistake in the other
    // direction. Within a percent or two is the honest claim; 665 is not.
    expect(xs[1]).toBeGreaterThan(9.5);
    expect(xs[1]).toBeLessThan(10.5);
    expect(xs[2]).toBeGreaterThan(97);
    expect(xs[2]).toBeLessThan(103);
  });

  it('⚑ a LINEAR axis is unchanged - the companion assertion', () => {
    // The conversion must not become a way to move a grid that was already
    // right. On a linear projector the two routes agree exactly.
    const linear: PixelProjector = {
      dataToPixel: (x, y) => ({
        x: BOX_LEFT + (x / 9) * (BOX_RIGHT - BOX_LEFT),
        y: BOX_BOTTOM - (y / 8) * (BOX_BOTTOM - BOX_TOP),
      }),
      pixelToData: (px, py) => [
        ((px - BOX_LEFT) / (BOX_RIGHT - BOX_LEFT)) * 9,
        ((BOX_BOTTOM - py) / (BOX_BOTTOM - BOX_TOP)) * 8,
      ],
    };
    const result = detectGrid(threeColumns(), linear, { xDividers: [0, 9], yDividers: [0, 8] }, {
      columns: 3,
    });
    expect(result.grid, result.message).not.toBeNull();
    const px = result.grid!.xDividers.map((d) => linear.dataToPixel(d, 0).x);
    expect(px[1]).toBeCloseTo(199.5, 1);
    expect(px[2]).toBeCloseTo(299.5, 1);
  });

  it('⚑⚑ a projector that cannot invert is taken as LINEAR, and says so by behaving so', () => {
    // ⚠️ Mutation testing found this path untested: `axes.pixelToData?.bind` and
    // the `if (!invert)` fallback could both be mutated with the suite green,
    // because every projector in the tests could invert. `readHeatmap` needs
    // only `dataToPixel`, so a projector without the inverse is a real caller -
    // and what it gets is the straight-line reading, which is exactly right for
    // a linear axis and is the documented limit of what it can be given.
    // ⚠️ NOT STARTING AT ZERO, and that is my second degenerate anchor tonight:
    // with `lo = 0`, `lo + f * (hi - lo)` and `lo + f * (hi + lo)` are the same
    // expression, so the arithmetic mutant survived. Spanning 2..11 makes them
    // differ. (The first was a log axis anchored at 1, where `log(1) = 0`.)
    const linearNoInverse: PixelProjector = {
      dataToPixel: (x, y) => ({
        x: BOX_LEFT + ((x - 2) / 9) * (BOX_RIGHT - BOX_LEFT),
        y: BOX_BOTTOM - (y / 8) * (BOX_BOTTOM - BOX_TOP),
      }),
    };
    const result = detectGrid(threeColumns(), linearNoInverse, {
      xDividers: [2, 11],
      yDividers: [0, 8],
    }, { columns: 3 });
    expect(result.grid, result.message).not.toBeNull();
    const px = result.grid!.xDividers.map((d) => linearNoInverse.dataToPixel(d, 0).x);
    expect(px[1]).toBeCloseTo(199.5, 1);
    expect(px[2]).toBeCloseTo(299.5, 1);
  });
});
