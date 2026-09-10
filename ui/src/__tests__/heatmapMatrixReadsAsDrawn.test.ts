/**
 * ⚑⚑ THE MATRIX READS THE WAY THE FIGURE IS DRAWN, MEASURED.
 *
 * ⚠️ FOUND BY AUDIT, 2026-09-10. `MatrixView` sorted its rows descending under a
 * header asserting *"Cell row 0 is `yMin` - the BOTTOM of the plot"*. That is
 * not a fact, it is one of two cases, and the engine already refused to
 * hard-code it: `labelOrderReversed`'s own words are *"MEASURED FROM THE AXES,
 * NEVER ASSUMED - which is the whole reason this is a function and not the
 * constant `{ x: false, y: true }`"*. The panel hard-coded that very constant,
 * and the function had NO caller in `ui/` at all. Gate 3, with the refusal and
 * the violation in the same repository sentence.
 *
 * ▶ And the flipped case is the ORDINARY CATEGORICAL WALK: the steps ask for
 * "FIRST column x FIRST row" then "FIRST column x LAST row", and on a
 * gene x sample heatmap the first row is the TOP one - so row 0 sits at the top
 * and the matrix printed upside down against its own figure.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { labelOrderReversed } from '../../../engine/heatmapRun.js';
import type { PixelProjector } from '../../../algorithms/heatmapRead.js';

const panel = readFileSync(
  path.join(import.meta.dirname, '..', 'panels', 'HeatmapCellsTable.tsx'),
  'utf8'
);
const workspace = readFileSync(path.join(import.meta.dirname, '..', 'Workspace.tsx'), 'utf8');

describe('the matrix takes its direction from the axes', () => {
  it('⚑⚑ the panel no longer hard-codes which way a row runs', () => {
    // The tell is a bare descending sort with nothing measured behind it.
    expect(panel, 'the matrix still sorts rows by a constant').toContain('order.y ? descending');
    expect(panel, 'and columns too - the same defect turned ninety degrees').toContain(
      'order.x ? descending'
    );
  });

  it('⚑ and the app measures it rather than passing a guess', () => {
    expect(workspace).toContain('labelOrderReversed(grid, axesNow)');
    expect(workspace).toContain('orderReversed={heatmapMatrixOrder}');
  });

  it('⚑⚑ an ORDINARY value figure has yMin at the bottom, so rows run high-index first', () => {
    // y grows upward on the page: data 0 is at pixel y 400, data 8 at pixel 100.
    const valueAxes: PixelProjector = {
      dataToPixel: (x, y) => ({ x: 100 + x * 30, y: 400 - y * 37.5 }),
    };
    const order = labelOrderReversed({ xDividers: [0, 4, 9], yDividers: [0, 4, 8] }, valueAxes);
    expect(order.y, 'the ordinary figure is the reversed case').toBe(true);
    expect(order.x).toBe(false);
  });

  it('⚑⚑ a CATEGORICAL walk has row 0 at the TOP, so rows run in index order', () => {
    // The walk clicks the FIRST row first, and on a gene x sample heatmap that
    // is the top one: row 0 sits at a SMALLER pixel y than the last row.
    const categoricalAxes: PixelProjector = {
      dataToPixel: (x, y) => ({ x: 100 + x * 30, y: 100 + y * 37.5 }),
    };
    const order = labelOrderReversed({ xDividers: [0, 1, 2], yDividers: [0, 1, 2, 3] }, categoricalAxes);
    expect(order.y, 'this is the case the panel printed upside down').toBe(false);
  });

  it('⚑ and a figure whose columns run right-to-left is caught too', () => {
    const mirrored: PixelProjector = {
      dataToPixel: (x, y) => ({ x: 400 - x * 30, y: 400 - y * 37.5 }),
    };
    const order = labelOrderReversed({ xDividers: [0, 4, 9], yDividers: [0, 4, 8] }, mirrored);
    expect(order.x).toBe(true);
  });
});
