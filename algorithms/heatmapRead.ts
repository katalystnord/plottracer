/**
 * Reading a heatmap — the grid, the image and the key, turned into the record
 * (v2.2, phase 3).
 *
 * ⚑ THE RECORD IS A MATRIX OF VALUES, and each row of it is
 * `x_min, x_max, y_min, y_max, x_centre, y_centre, value`. Both the bounds AND
 * the centre, by the precedent the error bars set: carry the absolutes and the
 * derived figure so neither reader has to do arithmetic on the record. The
 * asymmetry that decided it is that edges → centres is derivable and
 * centres → edges is NOT once cells are unequal, so a centres-only record fails
 * against a real consumer (matplotlib's `shading='flat'` REQUIRES n+1 edges and
 * refuses centres outright); it was tested in reverse before any code, and a
 * centres-only record rebuilt the hardest figure wrong by 0.375 data units.
 *
 * ⚑⚑ EVERY CELL CARRIES ITS OWN EVIDENCE, because in a heatmap the colour IS
 * the value and a wrong one has no other symptom. Three numbers say how much to
 * trust a cell, and all three are MEASURED off the figure rather than assumed:
 *
 *   distance ..... how far the cell's colour sits off the key's ramp.
 *   low..high .... the values it cannot be told apart from, at that error.
 *   uniformity ... what fraction of the cell is actually the colour we read.
 *
 * The third is this file's own contribution and it catches what the other two
 * cannot: a cell with a printed number in it, a significance asterisk, a
 * hatch, a border eating the sample. Its colour may sit exactly on the ramp —
 * distance 0, a tight band, total confidence — while a third of the cell is ink
 * that is not data. Uniformity is the only signal that says so.
 *
 * ⚑ STILL A RECORDING, NOT AN INTERPRETATION. Nothing here decides that a cell
 * is bad, drops it, or repairs it. It measures, reports, and lets the number and
 * its evidence travel together.
 */

import { cellsOf, type HeatmapCell } from '../core/heatmapGrid.js';
import { COLOR_NOISE_FLOOR, colorDistance, medoidColor } from './colorBar.js';
import { readColor, type ColorScale, type ColorValueBand } from './colorScale.js';
import type { RGB } from './colorFilter.js';

/** The one thing this needs from a calibrated axes: where a data coordinate
 * lands on the image. Structural, so it needs no import from `core/axes`. */
export interface PixelProjector {
  dataToPixel(x: number, y: number): { x: number; y: number };
}

export interface ReadHeatmapOptions {
  /**
   * How much of each cell to ignore around its edge, as a fraction of the cell.
   *
   * ⚑ NOT COSMETIC. A cell's border is drawn ON the boundary, and an
   * anti-aliased border blends the two neighbouring colours into something that
   * is on neither — a colour that inverts to a position between two cells and
   * reports itself as a confident reading of a value the figure never printed.
   * Insetting is what keeps the sample inside the thing being measured.
   */
  inset?: number;
  /** At most this many samples per axis inside a cell. A cap, not a target:
   * a 300px cell does not need 90,000 reads to find its own colour. */
  maxSamplesPerAxis?: number;
}

const DEFAULT_INSET = 0.2;
const DEFAULT_MAX_SAMPLES = 7;

/** One cell's reading: where it is, what it is worth, and how much to trust it. */
export interface HeatmapCellReading {
  col: number;
  row: number;
  /** Bounds in data coordinates, straight from the grid. */
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  /**
   * The centre of the DRAWN cell, in data coordinates — the midpoint in PIXELS
   * mapped back, not the average of the bounds.
   *
   * ⚑ On a linear axis the two agree exactly and the distinction is invisible.
   * On a LOG axis they do not: the middle of the block of ink is the geometric
   * centre, and the arithmetic mean of the bounds is a point closer to one edge
   * than the figure ever drew. What is being reported is where the cell is, so
   * it is measured where the cell is.
   */
  xCentre: number;
  yCentre: number;
  /** The colour actually sampled — kept so a caller can show the user what was
   * read, which is the only way to check a colour reading by eye. */
  rgb: RGB;
  /** Null when the cell could not be sampled at all (entirely off-image, or
   * fully transparent) or when the key cannot produce a value. A cell that could
   * not be read is reported as unread, never as zero. */
  reading: ColorValueBand | null;
  /** Other values this cell's colour is equally consistent with (a cyclic key, a
   * key that revisits a colour). Non-empty means AMBIGUOUS, not imprecise. */
  rivals: readonly ColorValueBand[];
  /** The reading sits against an END of the key, so the cell may be CLIPPED —
   * see `ColorValueReading.atKeyLimit`. The one wrong value distance and
   * uniformity cannot see. */
  atKeyLimit: boolean;
  /**
   * The fraction of the cell's sampled pixels that match the colour we read, to
   * within the noise floor. 1 for a flat printed cell; lower for a cell carrying
   * a number, an asterisk, a hatch — or for a smooth field, where it is not a
   * fault at all but the honest statement that the cell is not one colour.
   */
  uniformity: number;
  /** How many pixels were sampled. Zero means the cell is off-image. */
  samples: number;
}

/**
 * Read every cell of the grid.
 *
 * Returns null only when the grid itself is unusable — a caller never gets a
 * partial matrix, because a matrix missing its edge cells looks complete.
 */
export function readHeatmap(
  src: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  axes: PixelProjector,
  xDividers: readonly number[],
  yDividers: readonly number[],
  scale: ColorScale,
  options: ReadHeatmapOptions = {}
): HeatmapCellReading[] | null {
  const cells = cellsOf(xDividers, yDividers);
  if (cells === null) return null;
  const inset = clampInset(options.inset ?? DEFAULT_INSET);
  const maxPerAxis = Math.max(1, Math.round(options.maxSamplesPerAxis ?? DEFAULT_MAX_SAMPLES));

  return cells.map((cell) => readCell(src, width, height, axes, cell, scale, inset, maxPerAxis));
}

/** Half the cell at most: an inset of 0.5 or more leaves nothing to sample. */
function clampInset(inset: number): number {
  if (!Number.isFinite(inset) || inset < 0) return 0;
  return Math.min(inset, 0.45);
}

function readCell(
  src: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  axes: PixelProjector,
  cell: HeatmapCell,
  scale: ColorScale,
  inset: number,
  maxPerAxis: number
): HeatmapCellReading {
  // The cell's four corners in pixels. Taken from the axes rather than assumed
  // axis-aligned: a scanned figure is rotated, and its rows are not image rows.
  const corners = [
    axes.dataToPixel(cell.xMin, cell.yMin),
    axes.dataToPixel(cell.xMax, cell.yMin),
    axes.dataToPixel(cell.xMin, cell.yMax),
    axes.dataToPixel(cell.xMax, cell.yMax),
  ];
  const window: RGB[] = [];
  for (let i = 0; i < maxPerAxis; i++) {
    for (let j = 0; j < maxPerAxis; j++) {
      // Sample on a lattice across the cell in DATA space, inset from its edges,
      // then project each point — so a rotated or log-scaled cell is still
      // sampled across its own interior rather than across a screen rectangle.
      //
      // ⚠️⚠️ KNOWN LIMITATION, DELIBERATELY LEFT (v2.2, David's call): THIS
      // LATTICE IS REGULAR, SO A REGULAR OVERLAY CAN ALIAS WITH IT. Measured on
      // 2026-08-12 after David asked whether hatched heatmaps exist — they do,
      // and stippling to mark significance is common in climate and
      // epidemiology figures. A hatch covering up to about a third of a cell is
      // read CORRECTLY and flagged by `uniformity`. At half coverage the two
      // periods lined up: seven samples across a 60px inset interior is a 10px
      // stride, and a 2px checkerboard has constant parity at that stride, so
      // every sample landed on ONE PHASE of the pattern.
      //
      // What that costs: with an off-ramp hatch (black over colour) `distance`
      // shouts — 190 RGB units in the measurement. With a hatch that is ITSELF
      // on the ramp — a grey hatch over a grey key — the reading comes back
      // exact, uniform and wrong, which is the same silent class as a clipped
      // cell and the one this module exists to prevent.
      //
      // ▶ THE FIX WHEN IT IS TIME: make the lattice incommensurate with any
      // periodic pattern — a coprime sample count, or a deterministic sub-pixel
      // jitter per row — so no stride can hold one phase. Do NOT "fix" it by
      // raising `maxPerAxis`: a denser regular lattice aliases just as cleanly
      // against a finer pattern.
      const u = lerpFraction(i, maxPerAxis, inset);
      const v = lerpFraction(j, maxPerAxis, inset);
      const p = bilinear(corners, u, v);
      const x = Math.round(p.x);
      const y = Math.round(p.y);
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const idx = (y * width + x) * 4;
      if (src[idx + 3] === 0) continue;
      window.push([src[idx]!, src[idx + 1]!, src[idx + 2]!]);
    }
  }

  const rgb = medoidColor(window);
  const base = {
    col: cell.col,
    row: cell.row,
    xMin: cell.xMin,
    xMax: cell.xMax,
    yMin: cell.yMin,
    yMax: cell.yMax,
    // Measured where the ink is: the midpoint in PIXELS, read back through the
    // axes. See the field's own comment for why this is not (min + max) / 2.
    ...centreInData(axes, cell),
    samples: window.length,
  };
  if (rgb === null) {
    return { ...base, rgb: [0, 0, 0], reading: null, rivals: [], uniformity: 0, atKeyLimit: false };
  }

  const matching = window.filter((c) => colorDistance(c, rgb) <= COLOR_NOISE_FLOOR).length;
  const value = readColor(scale, rgb);
  return {
    ...base,
    rgb,
    reading:
      value === null
        ? null
        : { value: value.value, low: value.low, high: value.high, distance: value.distance },
    rivals: value?.rivals ?? [],
    atKeyLimit: value?.atKeyLimit ?? false,
    uniformity: matching / window.length,
  };
}

/**
 * The centre as a data coordinate. The projector only goes data → pixel, so the
 * pixel midpoint is turned back into data by interpolating the cell's own
 * corners — which is exact for the affine case and is what "the middle of this
 * block of ink" means on any monotone axis.
 */
function centreInData(axes: PixelProjector, cell: HeatmapCell): {
  xCentre: number;
  yCentre: number;
} {
  return {
    xCentre: midpointOnAxis((v) => axes.dataToPixel(v, cell.yMin), cell.xMin, cell.xMax),
    yCentre: midpointOnAxis((v) => axes.dataToPixel(cell.xMin, v), cell.yMin, cell.yMax),
  };
}

/**
 * The data value whose PIXEL is halfway between the two bounds' pixels, found by
 * bisection on the axis's own projection.
 *
 * ⚑ Bisection rather than algebra because the projector is a black box: linear,
 * logarithmic or rotated, and "where is the halfway pixel" works for all three.
 * 40 halvings take any real axis below single precision.
 *
 * ⚑ THE FIRST VERSION WAS CIRCULAR and its test caught it: it projected the
 * ARITHMETIC mean of the bounds and then searched for the data value that lands
 * there, which is the arithmetic mean by construction. It returned 50.5 for a
 * log cell running 1 to 100 — the answer the whole function exists to avoid —
 * and would have agreed with the naive midpoint on every axis, forever.
 *
 * Falls back to the arithmetic midpoint when the projection cannot be used at
 * all (a non-finite pixel, or two bounds landing on the same one), which is a
 * degenerate axis rather than a shape worth a separate answer.
 */
function midpointOnAxis(
  project: (v: number) => { x: number; y: number },
  lo: number,
  hi: number
): number {
  const pLo = project(lo);
  const pHi = project(hi);
  if (!isFinitePoint(pLo) || !isFinitePoint(pHi)) return (lo + hi) / 2;
  const dx = pHi.x - pLo.x;
  const dy = pHi.y - pLo.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return (lo + hi) / 2;
  let a = lo;
  let b = hi;
  for (let i = 0; i < 40; i++) {
    const mid = (a + b) / 2;
    const p = project(mid);
    if (!isFinitePoint(p)) return (lo + hi) / 2;
    // How far along the edge this candidate's pixel sits. Halfway is the target.
    const f = ((p.x - pLo.x) * dx + (p.y - pLo.y) * dy) / lenSq;
    if (f < 0.5) a = mid;
    else b = mid;
  }
  return (a + b) / 2;
}

function isFinitePoint(p: { x: number; y: number }): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y);
}

/** The i-th of `n` sample positions across a cell, inset from both edges. A
 * single sample sits at the centre rather than at an edge. */
function lerpFraction(i: number, n: number, inset: number): number {
  if (n === 1) return 0.5;
  return inset + ((1 - 2 * inset) * i) / (n - 1);
}

/** A point inside the cell, from its four projected corners. */
function bilinear(
  corners: readonly { x: number; y: number }[],
  u: number,
  v: number
): { x: number; y: number } {
  const [c00, c10, c01, c11] = corners as [
    { x: number; y: number },
    { x: number; y: number },
    { x: number; y: number },
    { x: number; y: number },
  ];
  const top = { x: c00.x + (c10.x - c00.x) * u, y: c00.y + (c10.y - c00.y) * u };
  const bottom = { x: c01.x + (c11.x - c01.x) * u, y: c01.y + (c11.y - c01.y) * u };
  return { x: top.x + (bottom.x - top.x) * v, y: top.y + (bottom.y - top.y) * v };
}
