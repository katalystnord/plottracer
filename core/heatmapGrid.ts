/**
 * The heatmap grid — an adjustable set of DIVIDERS per axis (v2.2, phase 3).
 *
 * ⚑⚑ ONE MECHANISM FOR BOTH KINDS OF FIGURE (David, 2026-08-11): *"Our grid can
 * be a virtual grid (for example continuous fields), it does not need to have a
 * thickness. For heatmaps with grids, we obviously overlay the grids. And the
 * grids need to be user adjustable (unequal cells)."* A divider is a POSITION,
 * never a drawn region — exactly what v2.1's category ticks already are — and
 * what varies between a figure with printed cell borders and a continuous field
 * is only how the position gets PLACED: snapped to measured ink in the first
 * case, laid down as a virtual lattice in the second. Same store either way.
 *
 * ⚑ ADJUSTABILITY IS LOAD-BEARING, AND IT KILLS ANY "rows × columns" COUNT.
 * Published heatmaps have rows of unequal height and columns of unequal width —
 * measured as a real case, not imagined — so every divider is stored on its own.
 * That is precisely why the category-tick work stores each divider rather than a
 * count, and it is the reason a decision made for BAR CHARTS is what makes
 * heatmaps expressible at all.
 *
 * ⚑ DIVIDERS ARE STORED IN DATA COORDINATES, not pixels and not parameters.
 * `core/categoryAxis.ts` stores its ticks as parameters between two clicked
 * edges, because a category axis has no numeric scale of its own to hang them
 * on. A heatmap always has one: its x and y are calibrated before any cell is
 * captured, so a boundary's data coordinate IS its identity. That makes the cell
 * record fall straight out of the grid with no conversion, and it survives an
 * image edit for the stronger reason — a rotation or a crop moves the pixels and
 * recalibrates the axes, and the data coordinate of a boundary does not change.
 *
 * Pure: numbers in, numbers out. No image, no axes, no DOM.
 */

/** The least gap two dividers may have. Below this a cell has no interior to
 * sample and the two boundaries are the same boundary entered twice. */
const DIVIDER_EPS = 1e-9;

/** One cell of the grid, in data coordinates. */
export interface HeatmapCell {
  col: number;
  row: number;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

/**
 * Why a divider list is unusable. Codes, not sentences — the sentence belongs
 * where it is shown.
 */
export type GridRefusal =
  /** Fewer than two dividers: one boundary bounds nothing. */
  | 'too-few'
  /** A value that is not a finite number. */
  | 'not-a-number'
  /** Two dividers at (or within `DIVIDER_EPS` of) the same coordinate, which
   * would make a cell with no interior. */
  | 'coincident';

/**
 * Check a divider list and return it in ascending order, or say why not.
 *
 * ⚑ SORTING IS DONE HERE AND NOWHERE ELSE, which is what lets `moveDivider`
 * REFUSE to drag a divider past its neighbour instead of quietly re-sorting.
 * Re-sorting would keep the geometry valid and renumber every cell beyond the
 * one being dragged — the values would still be right and they would be filed
 * under the wrong column, which is the silent kind of wrong.
 */
export function checkDividers(
  values: readonly number[]
): { dividers: number[]; reason: null } | { dividers: null; reason: GridRefusal } {
  if (values.some((v) => !Number.isFinite(v))) return { dividers: null, reason: 'not-a-number' };
  if (values.length < 2) return { dividers: null, reason: 'too-few' };
  const sorted = [...values].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]! - sorted[i - 1]! < DIVIDER_EPS) return { dividers: null, reason: 'coincident' };
  }
  return { dividers: sorted, reason: null };
}

/**
 * `count` equal cells spanning `from` to `to`, as `count + 1` dividers — the
 * VIRTUAL lattice, for a figure that draws no cell boundaries at all.
 *
 * ⚑ This is the only place a count appears, and it is a STARTING POINT rather
 * than a model: what it produces is an ordinary divider list, individually
 * adjustable from the moment it exists. Nothing downstream can tell an evenly
 * generated grid from a hand-placed one, which is what keeps the unequal case
 * first-class.
 */
export function equalDividers(from: number, to: number, count: number): number[] | null {
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  if (!Number.isInteger(count) || count < 1) return null;
  if (from === to) return null;
  return Array.from({ length: count + 1 }, (_, i) => from + ((to - from) * i) / count);
}

/**
 * Move one divider to a new coordinate, refusing to take it past either
 * neighbour. Returns a new list, or null if the move is refused.
 */
export function moveDivider(
  dividers: readonly number[],
  index: number,
  value: number
): number[] | null {
  if (!Number.isFinite(value)) return null;
  if (!Number.isInteger(index) || index < 0 || index >= dividers.length) return null;
  const lower = index > 0 ? dividers[index - 1]! + DIVIDER_EPS : -Infinity;
  const upper = index < dividers.length - 1 ? dividers[index + 1]! - DIVIDER_EPS : Infinity;
  if (value < lower || value > upper) return null;
  const next = [...dividers];
  next[index] = value;
  return next;
}

/**
 * Add a boundary at `value`, splitting the cell it lands in. Returns a new list,
 * or null if it is not a finite number or would coincide with a divider already
 * there.
 *
 * ⚑ A heatmap CAN take an added divider, where a category axis deliberately
 * cannot: on a category axis the declared count is what gives each mark a
 * meaning, so a stray extra one has no referent. Here a divider is a boundary
 * the figure itself drew, and a figure is free to have one more of them than a
 * count suggested.
 */
export function insertDivider(dividers: readonly number[], value: number): number[] | null {
  if (!Number.isFinite(value)) return null;
  if (dividers.some((d) => Math.abs(d - value) < DIVIDER_EPS)) return null;
  return [...dividers, value].sort((a, b) => a - b);
}

/**
 * Remove the divider at `index`, merging the two cells it separated. Refuses to
 * go below two dividers, which is one cell — the smallest grid that is a grid.
 */
export function removeDivider(dividers: readonly number[], index: number): number[] | null {
  if (!Number.isInteger(index) || index < 0 || index >= dividers.length) return null;
  if (dividers.length <= 2) return null;
  return dividers.filter((_, i) => i !== index);
}

/**
 * Every cell of the grid, row-major, with its bounds in data coordinates.
 *
 * Null when either axis's dividers are unusable, so a caller cannot get half a
 * grid: an incomplete lattice would export cells that are silently wrong at the
 * edges rather than visibly absent.
 */
export function cellsOf(
  xDividers: readonly number[],
  yDividers: readonly number[]
): HeatmapCell[] | null {
  const xs = checkDividers(xDividers);
  const ys = checkDividers(yDividers);
  if (xs.dividers === null || ys.dividers === null) return null;
  const cells: HeatmapCell[] = [];
  for (let row = 0; row < ys.dividers.length - 1; row++) {
    for (let col = 0; col < xs.dividers.length - 1; col++) {
      cells.push({
        col,
        row,
        xMin: xs.dividers[col]!,
        xMax: xs.dividers[col + 1]!,
        yMin: ys.dividers[row]!,
        yMax: ys.dividers[row + 1]!,
      });
    }
  }
  return cells;
}

/**
 * Which cell a data coordinate falls in, or null if it is outside the grid.
 *
 * ⚑ OUTSIDE IS NULL HERE, where `categoryAxis.bandIndexForParam` treats its
 * outermost bands as unbounded. The two are answering different questions: there,
 * a bar sitting just past the last divider still belongs to the category a
 * reader would say it belongs to. Here, a point outside the grid is outside the
 * MATRIX — there is no row for it, and inventing one would put a value in a cell
 * the figure does not have.
 */
export function cellIndexAt(
  xDividers: readonly number[],
  yDividers: readonly number[],
  x: number,
  y: number
): { col: number; row: number } | null {
  const xs = checkDividers(xDividers);
  const ys = checkDividers(yDividers);
  if (xs.dividers === null || ys.dividers === null) return null;
  const col = bandOf(xs.dividers, x);
  const row = bandOf(ys.dividers, y);
  if (col === null || row === null) return null;
  return { col, row };
}

/** Which band of a sorted divider list holds `v`, or null if it is outside. The
 * last band includes its upper bound, so the grid's far edge is not a gap. */
function bandOf(dividers: readonly number[], v: number): number | null {
  if (!Number.isFinite(v)) return null;
  if (v < dividers[0]! || v > dividers[dividers.length - 1]!) return null;
  for (let i = 0; i < dividers.length - 1; i++) {
    if (v < dividers[i + 1]!) return i;
  }
  return dividers.length - 2;
}
