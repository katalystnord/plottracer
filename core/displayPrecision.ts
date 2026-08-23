/**
 * What a number LOOKS LIKE on screen, rounded to the figure's own resolution.
 *
 * ⚑⚑ WHY THIS EXISTS. `core/exportPrecision.ts` has rounded every exported value
 * to about half a pixel in data units since B6 - *"reporting finer than that is
 * precision the figure never carried"*. The DATA PANEL never did. Measured
 * 2026-08-23: `makeRounder` was called from exactly one place in the whole
 * non-test tree, `engine/exportAssembly.ts`. So the screen showed `-7.95455`
 * where the file said about `-8`, and an XY panel showed `0.000491559`.
 *
 * David, seeing it in a screenshot of the built app: *"I do not think it is right
 * that we are reporting numbers with so many decimal places. We should stop at
 * half a pixel resolution."* Which is what `halfPixelResolution` has computed all
 * along - the mechanism existed and was wired to one surface out of two.
 *
 * ⚑ THE POINT IS NOT FEWER DIGITS, IT IS THE TWO SURFACES AGREEING. A panel and
 * a file reporting the same reading differently is the defect; either alone would
 * merely be a choice. So each table rounds by the SAME route its own export
 * section does, and `panelAgreesWithFile.test.ts` asserts that they land on the
 * same number for the same figure.
 *
 * ⚑ IN `core/` RATHER THAN `ui/`, and not by preference: `engine/spreadsheetModel.ts`
 * needs it to build the rows the panel renders, and the dependency runs one way -
 * engine may not import ui. The arithmetic is pure and axes-only, so it belongs
 * beside `exportPrecision.ts`, which it composes rather than copies.
 *
 * ⚠️⚑⚑ AND IT MUST NEVER REACH AN EDITOR. `editSeed` (ui/src/format.ts)
 * deliberately seeds a value editor from the WHOLE number, because the commit is
 * what moves the datum - F23 measured the alternative: a `toFixed(3)` display
 * feeding the editor turned `0.00042` into `0` on a log axis, silently, on
 * double-click-and-blur. So the model keeps raw values and only the RENDER
 * rounds. Nothing here may be stored, seeded or compared against.
 *
 * ⚑ TWO ROUTES, because the exports have two. A flat row knows the PIXEL it was
 * read at (`core/exportValues.ts` rounds with `halfPixelResolution(axes, px,
 * py)`), which is exact on every axes class. A tuple or bin holds only VALUES,
 * so it goes through `makeRounder`, which maps data back to a pixel first - the
 * route `engine/exportAssembly.ts` already uses for those shapes.
 * ⚠️ Prefer `atPixel` wherever the pixel is in hand: `dataToPixel` is real only
 * on XY and Image and a stub returning `{0,0}` on the other five, so the data
 * route is sound for the LINEAR bar family (constant resolution, which is why
 * the export can use it) and would be wrong for a spider, whose spokes each
 * carry their own scale.
 */

import { halfPixelResolution, makeRounder, roundToResolution, type DataMappableAxes } from './exportPrecision.js';

/** How a panel turns a measured number into the number it shows. */
export interface DisplayRounder {
  /** Round `coords[dim]` to the resolution AT the pixel it was read from. */
  atPixel(px: number, py: number, coords: readonly number[], dim: number): number;
  /** Round an arbitrary scalar (a cap position, a delta) at that same pixel. */
  scalarAtPixel(value: number, px: number, py: number, dim: number): number;
  /** Round `coords[dim]` with only the values in hand - see the two-routes note. */
  atData(coords: readonly number[], dim: number): number;
  /** Round an arbitrary scalar with only the values in hand. */
  scalarAtData(value: number, coords: readonly number[], dim: number): number;
}

/**
 * A rounder bound to the calibrated axes, or a pass-through when there are none.
 *
 * ⚑ UNCALIBRATED IS NOT AN ERROR HERE. Before calibration a panel has nothing to
 * take a resolution FROM, and the honest answer is the number unchanged rather
 * than a rounding computed from a degenerate transform - the same choice
 * `roundToResolution` makes for a non-finite step.
 */
export function makeDisplayRounder(axes: DataMappableAxes | null): DisplayRounder {
  if (axes === null) {
    return {
      atPixel: (_px, _py, coords, dim) => coords[dim] as number,
      scalarAtPixel: (value) => value,
      atData: (coords, dim) => coords[dim] as number,
      scalarAtData: (value) => value,
    };
  }
  const data = makeRounder(axes, 'auto');
  const scalarAtPixel = (value: number, px: number, py: number, dim: number): number =>
    roundToResolution(value, halfPixelResolution(axes, px, py)[dim] ?? NaN);
  return {
    scalarAtPixel,
    atPixel: (px, py, coords, dim) => scalarAtPixel(coords[dim] as number, px, py, dim),
    atData: (coords, dim) => data.at([...coords], dim),
    scalarAtData: (value, coords, dim) => data.scalarAt(value, [...coords], dim),
  };
}
