import { describe, expect, it } from 'vitest';

/**
 * ⚑ MUTATION: 95.00% (scoped throwaway config; recipe in
 * `algorithms/__tests__/colorBar.test.ts`). The survivors are all reads of an
 * index one past the end of a divider list, where the value fetched is
 * `undefined` and every comparison against it is false — so the explicit bound
 * and the arithmetic agree, and the bound stays because relying on
 * `undefined < number` is a type lie the compiler cannot see.
 */
import {
  cellIndexAt,
  cellsOf,
  checkDividers,
  equalDividers,
  insertDivider,
  moveDivider,
  removeDivider,
  gridParamsFrom,
  dividersFromParams,
} from '../heatmapGrid.js';

describe('checkDividers', () => {
  it('returns the list in ascending order', () => {
    expect(checkDividers([3, 1, 2]).dividers).toEqual([1, 2, 3]);
  });

  it('leaves the caller’s array alone', () => {
    // A model that sorts its input in place makes the caller's undo snapshot
    // change underneath it — the shape that has bitten this project's session
    // state before.
    const input = [3, 1, 2];
    checkDividers(input);
    expect(input).toEqual([3, 1, 2]);
  });

  it('refuses fewer than two dividers — one boundary bounds nothing', () => {
    expect(checkDividers([]).reason).toBe('too-few');
    expect(checkDividers([1]).reason).toBe('too-few');
    expect(checkDividers([1, 2]).reason).toBeNull();
  });

  it('refuses a value that is not a finite number', () => {
    expect(checkDividers([0, NaN, 1]).reason).toBe('not-a-number');
    expect(checkDividers([0, Infinity]).reason).toBe('not-a-number');
  });

  it('refuses two dividers at the same coordinate — a cell with no interior', () => {
    expect(checkDividers([0, 1, 1, 2]).reason).toBe('coincident');
    // ⚑ And two that are merely indistinguishable, not just equal: a boundary
    // placed a denormal apart is the same boundary entered twice, and the cell
    // between them has no pixels to sample.
    expect(checkDividers([0, 1, 1 + 1e-12, 2]).reason).toBe('coincident');
    expect(checkDividers([0, 1, 1.001, 2]).reason).toBeNull();
    // Exactly the tolerance apart is far enough — the threshold is "closer
    // than", not "no further than".
    expect(checkDividers([0, 1e-9]).reason).toBeNull();
    expect(checkDividers([0, 0.9e-9]).reason).toBe('coincident');
  });
});

describe('equalDividers', () => {
  it('makes n cells from n+1 dividers', () => {
    expect(equalDividers(0, 10, 5)).toEqual([0, 2, 4, 6, 8, 10]);
    expect(equalDividers(0, 1, 1)).toEqual([0, 1]);
  });

  it('runs backwards when the axis does', () => {
    expect(equalDividers(10, 0, 2)).toEqual([10, 5, 0]);
  });

  it('refuses a count that is not a positive whole number, or a zero span', () => {
    expect(equalDividers(0, 10, 0)).toBeNull();
    expect(equalDividers(0, 10, -3)).toBeNull();
    expect(equalDividers(0, 10, 2.5)).toBeNull();
    expect(equalDividers(5, 5, 4)).toBeNull();
    expect(equalDividers(NaN, 10, 4)).toBeNull();
    expect(equalDividers(0, Infinity, 4)).toBeNull();
  });

  it('produces an ordinary adjustable list, indistinguishable from a placed one', () => {
    // ⚑ The count is a STARTING POINT, not a model. What comes out is a plain
    // divider list, and nothing downstream can tell it from one placed by hand —
    // which is what keeps unequal cells first-class rather than a special case.
    const generated = equalDividers(0, 4, 4)!;
    expect(moveDivider(generated, 2, 2.4)).toEqual([0, 1, 2.4, 3, 4]);
  });
});

describe('moveDivider', () => {
  it('moves one divider and leaves the rest', () => {
    expect(moveDivider([0, 1, 2, 3], 1, 0.5)).toEqual([0, 0.5, 2, 3]);
  });

  it('REFUSES to cross a neighbour rather than re-sorting', () => {
    // ⚑⚑ THE POINT OF THE WHOLE MODULE. Re-sorting would keep the geometry
    // valid and renumber every cell past the one being dragged: the values would
    // all still be right, and filed under the wrong column. That is the silent
    // kind of wrong, so a drag past a neighbour is refused and the user sees the
    // divider stop.
    expect(moveDivider([0, 1, 2, 3], 1, 2.5)).toBeNull();
    expect(moveDivider([0, 1, 2, 3], 1, -1)).toBeNull();
    expect(moveDivider([0, 1, 2, 3], 1, 2)).toBeNull();
  });

  it('refuses a move ONTO a neighbour, not just past it', () => {
    // ⚑ Landing exactly on the neighbour makes a cell with no interior — the
    // same thing `checkDividers` refuses — so the drag has to stop just short of
    // it in both directions, not only on the way up.
    expect(moveDivider([0, 1, 2, 3], 1, 0)).toBeNull();
    expect(moveDivider([0, 1, 2, 3], 1, 2)).toBeNull();
    // …and just clear of it is allowed, in both directions.
    expect(moveDivider([0, 1, 2, 3], 1, 0 + 1e-9)).toEqual([0, 1e-9, 2, 3]);
    expect(moveDivider([0, 1, 2, 3], 1, 2 - 1e-9)).toEqual([0, 2 - 1e-9, 2, 3]);
  });

  it('lets an OUTER divider move outward without limit', () => {
    // The grid's own edge has no neighbour beyond it, and a figure's first
    // column can legitimately extend past where the axis was calibrated.
    expect(moveDivider([0, 1, 2], 0, -50)).toEqual([-50, 1, 2]);
    expect(moveDivider([0, 1, 2], 2, 99)).toEqual([0, 1, 99]);
  });

  it('refuses an index that is not a divider, or a value that is not a number', () => {
    expect(moveDivider([0, 1, 2], 3, 0.5)).toBeNull();
    // ⚑ One PAST the end, moved somewhere the value checks would allow: without
    // the range check this appends a divider the caller never asked for, and the
    // grid silently grows a column.
    expect(moveDivider([0, 1, 2], 3, 5)).toBeNull();
    expect(moveDivider([0, 1, 2], -1, 0.5)).toBeNull();
    expect(moveDivider([0, 1, 2], 1.5, 0.5)).toBeNull();
    expect(moveDivider([0, 1, 2], 1, NaN)).toBeNull();
  });
});

describe('insertDivider and removeDivider', () => {
  it('splits the cell a new boundary lands in', () => {
    expect(insertDivider([0, 2, 4], 1)).toEqual([0, 1, 2, 4]);
    expect(insertDivider([0, 2, 4], 3)).toEqual([0, 2, 3, 4]);
    // Outside the current span too: a figure can have a column the grid has not
    // reached yet.
    expect(insertDivider([0, 2, 4], 6)).toEqual([0, 2, 4, 6]);
  });

  it('refuses a boundary that is already there', () => {
    expect(insertDivider([0, 2, 4], 2)).toBeNull();
    expect(insertDivider([0, 2, 4], 2 + 0.9e-9)).toBeNull();
    // Exactly the tolerance away is far enough, matching `checkDividers`.
    expect(insertDivider([0, 2, 4], 2 + 1e-9)).toEqual([0, 2, 2 + 1e-9, 4]);
    expect(insertDivider([0, 2, 4], 2 + 1e-8)).toEqual([0, 2, 2 + 1e-8, 4]);
    expect(insertDivider([0, 2, 4], NaN)).toBeNull();
  });

  it('merges two cells when a boundary is removed', () => {
    expect(removeDivider([0, 1, 2, 3], 1)).toEqual([0, 2, 3]);
  });

  it('removes the FIRST divider as readily as any other', () => {
    // The grid's own outer edge is a divider like the rest: a figure whose first
    // column turned out not to be a column must be able to lose it.
    expect(removeDivider([0, 1, 2, 3], 0)).toEqual([1, 2, 3]);
    expect(removeDivider([0, 1, 2, 3], 3)).toEqual([0, 1, 2]);
  });

  it('refuses to go below one cell', () => {
    expect(removeDivider([0, 1], 0)).toBeNull();
    expect(removeDivider([0, 1, 2], 5)).toBeNull();
    // One PAST the end: a filter on a missing index removes nothing and hands
    // back a list that looks like a successful edit.
    expect(removeDivider([0, 1, 2], 3)).toBeNull();
    expect(removeDivider([0, 1, 2], -1)).toBeNull();
  });
});

describe('cellsOf', () => {
  it('enumerates the matrix row-major, with unequal cells intact', () => {
    const cells = cellsOf([0, 1, 3.5], [0, 2, 2.5])!;
    expect(cells).toHaveLength(4);
    expect(cells[0]).toEqual({ col: 0, row: 0, xMin: 0, xMax: 1, yMin: 0, yMax: 2 });
    expect(cells[1]).toEqual({ col: 1, row: 0, xMin: 1, xMax: 3.5, yMin: 0, yMax: 2 });
    expect(cells[2]).toEqual({ col: 0, row: 1, xMin: 0, xMax: 1, yMin: 2, yMax: 2.5 });
    expect(cells[3]).toEqual({ col: 1, row: 1, xMin: 1, xMax: 3.5, yMin: 2, yMax: 2.5 });
  });

  it('sorts each axis before pairing them up', () => {
    const cells = cellsOf([3.5, 0, 1], [2.5, 2, 0])!;
    expect(cells[0]).toEqual({ col: 0, row: 0, xMin: 0, xMax: 1, yMin: 0, yMax: 2 });
  });

  it('is null — never a partial matrix — when either axis is unusable', () => {
    // ⚑ Half a lattice would export cells that are silently wrong at the edges,
    // and a matrix missing its edge cells looks complete.
    expect(cellsOf([0], [0, 1])).toBeNull();
    expect(cellsOf([0, 1], [0, NaN])).toBeNull();
    expect(cellsOf([0, 1, 1], [0, 1])).toBeNull();
  });
});

describe('cellIndexAt', () => {
  const xs = [0, 1, 3.5, 4];
  const ys = [0, 2, 2.5];

  it('finds the cell a coordinate falls in', () => {
    expect(cellIndexAt(xs, ys, 0.5, 1)).toEqual({ col: 0, row: 0 });
    expect(cellIndexAt(xs, ys, 3.9, 2.2)).toEqual({ col: 2, row: 1 });
  });

  it('puts a coordinate ON a boundary in the cell above it', () => {
    expect(cellIndexAt(xs, ys, 1, 0)).toEqual({ col: 1, row: 0 });
    // …except at the far edge, which belongs to the last cell rather than to
    // nothing: the grid's outer boundary is not a gap.
    expect(cellIndexAt(xs, ys, 4, 2.5)).toEqual({ col: 2, row: 1 });
  });

  it('returns null OUTSIDE the grid, where a category axis would not', () => {
    // ⚑ The deliberate difference from `categoryAxis.bandIndexForParam`, whose
    // outermost bands are unbounded because a bar just past the last divider
    // still belongs to the category a reader would name. A point outside a
    // heatmap is outside the MATRIX — there is no row for it, and inventing one
    // would put a value in a cell the figure does not have.
    expect(cellIndexAt(xs, ys, -0.1, 1)).toBeNull();
    expect(cellIndexAt(xs, ys, 4.1, 1)).toBeNull();
    expect(cellIndexAt(xs, ys, 1, -0.1)).toBeNull();
    expect(cellIndexAt(xs, ys, 1, 2.6)).toBeNull();
    expect(cellIndexAt(xs, ys, NaN, 1)).toBeNull();
  });

  it('is null when the grid itself is unusable', () => {
    expect(cellIndexAt([0], ys, 0.5, 1)).toBeNull();
    expect(cellIndexAt(xs, [0], 0.5, 1)).toBeNull();
  });
});

/**
 * ⚑⚑ P2 — THE GRID SITS ON THE CALIBRATION, NOT IN IT.
 *
 * David, 2026-08-16: *"Anything detected on the graph sits on TOP of the
 * calibration… It has to sit on top of it and respect it, but not be a part of
 * it. We should and need to be able to adjust the axis calibrations
 * independently of changing the grid. The grid… is not dependent on the
 * calibrated area's numerical values. The grid is not absolute, but in relation
 * to the calibrated axis position."*
 *
 * ⚠️ THE RULE WAS ALREADY WRITTEN and this store ignored it. `core/bandedAxis.ts`
 * says it outright — *"PARAMETER SPACE IS THE WHOLE TRICK… A store of ABSOLUTE
 * coordinates — which is what the first heatmap grid used — cannot express it at
 * all: a bare number cannot say whether it should follow the axis or stay where
 * it was put."* It named this violator by name, in the same release.
 */
describe('a divider is a PARAMETER against the axis position, never an absolute', () => {
  it('turns a data coordinate into a parameter, and back again', () => {
    // 0 at the axis's first calibration point, 1 at its second — the same frame
    // `core/bandedAxis.ts` uses for category ticks.
    expect(gridParamsFrom([0, 25, 50, 100], 0, 100)).toEqual([0, 0.25, 0.5, 1]);
    expect(dividersFromParams([0, 0.25, 0.5, 1], 0, 100)).toEqual([0, 25, 50, 100]);
  });

  it('round-trips through any calibration, including one that runs backwards', () => {
    // A colour key may run high-to-low and so may an axis; nothing here may
    // assume v1 < v2.
    for (const [v1, v2] of [[0, 100], [100, 0], [-40, 60], [2, 3]] as const) {
      const dividers = [v1, v1 + (v2 - v1) * 0.3, v1 + (v2 - v1) * 0.75, v2];
      const params = gridParamsFrom(dividers, v1, v2)!;
      const back = dividersFromParams(params, v1, v2)!;
      back.forEach((d, i) => expect(d).toBeCloseTo(dividers[i]!, 9));
    }
  });

  it('⚑⚑ IS UNCHANGED WHEN A CALIBRATION VALUE IS RETYPED — the grid does not depend on the numbers', () => {
    // David's rule 3, stated as an outcome. The user placed the grid on ink and
    // then corrected what the axis is worth. The PARAMETERS must not move, so
    // the grid stays on the ink it was measured from.
    const params = gridParamsFrom([0, 30, 100], 0, 100)!;
    // Same pixels, different numbers: the axis now reads 10..200.
    const redrawn = dividersFromParams(params, 10, 200)!;
    // The DATA coordinates change, which is right — those pixels are now worth
    // different numbers. The parameters, which are what is stored, did not.
    expect(redrawn).toEqual([10, 67, 200]);
    expect(gridParamsFrom(redrawn, 10, 200)).toEqual(params);
  });

  it('keeps a divider OUTSIDE the calibrated span outside it, rather than clamping', () => {
    // The `centred` tick convention puts the calibration points on band CENTRES,
    // so the outermost dividers sit half a band BEYOND them — a negative
    // parameter and one past 1 are ordinary, not errors. Clamping would eat half
    // a column at each end.
    const params = gridParamsFrom([-12.5, 12.5, 112.5], 0, 100)!;
    expect(params[0]!).toBeLessThan(0);
    expect(params[2]!).toBeGreaterThan(1);
    expect(dividersFromParams(params, 0, 100)).toEqual([-12.5, 12.5, 112.5]);
  });

  it('refuses a degenerate axis rather than dividing by nothing', () => {
    // Two calibration points of equal value have no span, so no parameter
    // exists. `bandedAxis` refuses the same case at the door for the same reason.
    expect(gridParamsFrom([0, 50], 7, 7)).toBeNull();
    expect(gridParamsFrom([0, 50], 0, NaN)).toBeNull();
    expect(dividersFromParams([0, 1], 5, 5)).toBeNull();
  });

  it('refuses a divider list that is not one, at both doors', () => {
    // The same rule `checkDividers` applies interactively — a store is another
    // entrance to the model, and it gets the same guard.
    expect(gridParamsFrom([Number.NaN, 1], 0, 100)).toBeNull();
    expect(dividersFromParams([0, Number.POSITIVE_INFINITY], 0, 100)).toBeNull();
  });
});
