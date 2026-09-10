/**
 * ⚑⚑ A RETYPED CALIBRATION VALUE LEAVES THE GRID ON THE INK, LOG AXIS OR NOT.
 *
 * ⚠️ FOUND BY AUDIT, 2026-09-10 (heatmap F3). `core/heatmapGrid.ts`'s header
 * promises exactly this, in as many words: *"retype a calibration VALUE → the
 * parameters do not move, so the grid stays on the ink it was measured from."*
 * The parameter was `(d - v1) / (v2 - v1)` - a fraction of the DATA SPAN - which
 * is a position on the figure only on a LINEAR axis. A heatmap axis may be
 * logarithmic (`HEATMAP_AXES_CONFIG` ships `isLogX`/`isLogY`).
 *
 * ⚑⚑ THIS IS `detectGrid`'S DEFECT AT THE OTHER SEAM. That one turned a
 * detected FRACTION into data by interpolating in data; this one turns a data
 * coordinate into a stored fraction the same way. Fixing the first left the
 * second, because the test that reads as covering it
 * (*"RETYPING A CALIBRATION VALUE DOES NOT MOVE THE STORE"*, `heatmapRun.test`)
 * asserts that the STORE is unchanged - which is true in any frame, since the
 * two converters are inverses of each other whatever metric they use - and it
 * uses no axes at all. Gate 3: a comment asserting what nothing enforces.
 *
 * ⚑ THE ASSERTIONS ARE IN PIXELS, because "on the ink" is a claim about the
 * figure, and every data-space assertion this defect could make was already
 * passing.
 */
import { describe, expect, it } from 'vitest';
import {
  heatmapAxisSpans,
  heatmapGridToParams,
  resolveHeatmapGrid,
  type HeatmapState,
} from '../heatmapRun.js';

const BOX_LEFT = 100;
const BOX_RIGHT = 400;
const BOX_TOP = 50;
const BOX_BOTTOM = 250;

/** X logarithmic over `1 .. 10^decades` across the box; Y linear over 0..8.
 *  Inverts, as the app's axes do. */
function logXAxes(decades: number) {
  return {
    dataToPixel: (x: number, y: number) => ({
      x: BOX_LEFT + (Math.log10(x) / decades) * (BOX_RIGHT - BOX_LEFT),
      y: BOX_BOTTOM - (y / 8) * (BOX_BOTTOM - BOX_TOP),
    }),
    pixelToData: (px: number, py: number) => [
      Math.pow(10, ((px - BOX_LEFT) / (BOX_RIGHT - BOX_LEFT)) * decades),
      ((BOX_BOTTOM - py) / (BOX_BOTTOM - BOX_TOP)) * 8,
    ],
  };
}

/** Where the four calibration reticles SIT. They do not move when the user
 *  corrects what one of them is worth - that is the whole case. */
const PLACED = {
  x1: { px: BOX_LEFT, py: BOX_BOTTOM },
  x2: { px: BOX_RIGHT, py: BOX_BOTTOM },
  y1: { px: BOX_LEFT, py: BOX_BOTTOM },
  y2: { px: BOX_LEFT, py: BOX_TOP },
};

/** Three columns of EQUAL PIXEL WIDTH on a log axis calibrated 1..1000 - so the
 *  boundaries are the decade rules at px 200 and 300, and the cells are wildly
 *  unequal in data. */
const GRID: HeatmapState = { xDividers: [1, 10, 100, 1000], yDividers: [0, 4, 8] };

const pixelsOf = (dividers: readonly number[], decades: number): number[] =>
  dividers.map((d) => logXAxes(decades).dataToPixel(d, 0).x);

describe('the grid stays on the ink when a calibration VALUE is retyped', () => {
  it('⚑⚑ a log axis retyped from 1000 to 10000 leaves every boundary on its own pixel', () => {
    const before = heatmapAxisSpans(PLACED, logXAxes(3))!;
    expect(before, 'the frame must be measurable at all').not.toBeNull();
    const params = heatmapGridToParams(GRID, before)!;

    // The user corrects the far tick: same reticle, same pixel, new number.
    const after = heatmapAxisSpans(PLACED, logXAxes(4))!;
    const moved = resolveHeatmapGrid(params, after)!;
    expect(moved, 'the grid must still resolve').not.toBeNull();

    // ⚑ The DATA coordinates are expected to change - those pixels are worth
    // different numbers now, which is the correct consequence of a retype.
    expect(moved.xDividers[3]).toBeCloseTo(10000, 6);
    // ⚑⚑ But the PIXELS are the claim, and they must not have moved at all.
    pixelsOf(moved.xDividers, 4).forEach((px, i) => {
      expect(px, `boundary ${i} of ${JSON.stringify(moved.xDividers)}`).toBeCloseTo(
        pixelsOf(GRID.xDividers, 3)[i]!,
        6
      );
    });
    // The axis nobody touched is untouched.
    expect(moved.yDividers).toEqual(GRID.yDividers);
  });

  it('round-trips through the store on a log axis, so nothing drifts on a save and load', () => {
    const frame = heatmapAxisSpans(PLACED, logXAxes(3))!;
    const params = heatmapGridToParams(GRID, frame)!;
    const back = resolveHeatmapGrid(params, frame)!;
    back.xDividers.forEach((d, i) => expect(d).toBeCloseTo(GRID.xDividers[i]!, 6));
    // ⚑ The parameters ARE positions: equal pixel widths, equal parameters -
    // which the data fraction (0, 0.009, 0.099, 1) was not.
    params.x.forEach((t, i) => expect(t).toBeCloseTo(i / 3, 6));
  });

  it('⚠️ falls back to the data span for a projector that cannot place a point', () => {
    // ⚑ The synthetic projectors across this suite carry `pixelToData` alone,
    // and a frame with no way onto the figure has nothing better to offer than
    // the straight line between the two calibration values. Both directions
    // fall back TOGETHER or the store stops round-tripping.
    const linearOnly = { pixelToData: (px: number, py: number) => [(px - 100) / 3, (250 - py) / 25] };
    const frame = heatmapAxisSpans(PLACED, linearOnly)!;
    expect(frame.x).toEqual([0, 100]);
    const params = heatmapGridToParams({ xDividers: [0, 25, 100], yDividers: [0, 8] }, frame)!;
    expect(params.x).toEqual([0, 0.25, 1]);
    expect(resolveHeatmapGrid(params, frame)!.xDividers).toEqual([0, 25, 100]);
  });
});
