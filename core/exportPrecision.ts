/**
 * Principled export precision — round each value to the figure's OWN resolution,
 * ~half a pixel in data units, instead of a fixed number of decimals.
 *
 * **Why this replaces the fixed 2-decimal round (B6).** `Math.round(v*100)/100`
 * assumed every axis lives around O(1–100). On a small-magnitude, log, or
 * sub-unit-binned axis it silently ZEROED real data — `0.0012` exported as `0`,
 * a log-Y series collapsed to `[0, 0.01, 0.03]` — reaching every format including
 * the JSON a downstream pipeline ingests (v1.0-gate audit, BLOCKER). The record
 * (project file, pixel coords) always kept full precision; only export was lossy.
 *
 * **The rule.** A value read off the figure is known to within about one pixel.
 * So round it to the data-space size of a pixel THERE — computed numerically from
 * the axis's own `pixelToData` gradient. Exact for linear axes; correctly LOCAL
 * for log/nonlinear ones (the resolution near a small log value is tiny, so the
 * small value survives). Reporting finer than that is precision the figure never
 * carried; reporting coarser (the old gate) throws away precision it did.
 *
 * **Full-precision opt-in.** `mode: 'full'` skips rounding entirely and emits the
 * raw computed value — for a user who wants every digit and will judge precision
 * themselves. Surfaced as a checkbox on the export dialog.
 *
 * Pure: no DOM, no engine imports.
 */

export type PrecisionMode = 'auto' | 'full';

/** What resolution needs of an axes: read data from a pixel. */
export interface PixelReadableAxes {
  pixelToData(px: number, py: number): number[];
}

/** What the data-space rounder needs additionally: project a value back to a
 * pixel. Real on XY/Image; a stub returning `{0,0}` on the other five — which is
 * harmless here, because the only type-specific exporters that use this are
 * histogram / error bars (XY, real) and box plots (Bar, LINEAR so its resolution
 * is constant and the origin pixel gives the right answer regardless). */
export interface DataMappableAxes extends PixelReadableAxes {
  dataToPixel(x: number, y: number): { x: number; y: number };
}

/**
 * Half-pixel resolution, in data units, for each dimension of `pixelToData` at
 * pixel `(px, py)`: half the magnitude of the per-pixel data gradient (forward
 * difference in px and py). The smallest data increment the figure can resolve
 * there — one pixel.
 */
export function halfPixelResolution(axes: PixelReadableAxes, px: number, py: number): number[] {
  const v0 = axes.pixelToData(px, py);
  const vx = axes.pixelToData(px + 1, py);
  const vy = axes.pixelToData(px, py + 1);
  return v0.map((_, i) => {
    const dpx = (vx[i] ?? NaN) - (v0[i] ?? NaN);
    const dpy = (vy[i] ?? NaN) - (v0[i] ?? NaN);
    return 0.5 * Math.hypot(dpx, dpy);
  });
}

/**
 * Round `v` so its last kept digit sits at the resolution `halfStep`. If the
 * resolution can't be determined (non-finite, or `<= 0` from a degenerate
 * calibration), `v` is returned UNCHANGED — full precision, NEVER coerced toward
 * zero (that coercion was the whole bug). `ceil` on the decimal count is
 * deliberate: err toward keeping a digit, not dropping a small value.
 */
export function roundToResolution(v: number, halfStep: number): number {
  if (!Number.isFinite(v)) return v;
  if (!Number.isFinite(halfStep) || halfStep <= 0) return v;
  const decimals = Math.min(12, Math.max(0, Math.ceil(-Math.log10(halfStep))));
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}

/** Resolution per dimension AT a data point (maps data → pixel first). For the
 * type-specific exports, which hold values, not pixels. */
export function resolutionAtData(axes: DataMappableAxes, coords: number[]): number[] {
  const p = axes.dataToPixel(coords[0] ?? 0, coords[1] ?? 0);
  return halfPixelResolution(axes, p.x, p.y);
}

/** A rounding helper bound to an axes + mode, for the type-specific exports
 * (histogram / box plot / error bars) that don't flow through `valueAtPixel`. */
export interface ValueRounder {
  /** Round `coords[dim]` to that dimension's resolution at this data point. */
  at(coords: number[], dim: number): number;
  /** Round an arbitrary scalar (e.g. a derived +/- delta) using dimension
   * `dim`'s resolution at data point `coords`. */
  scalarAt(value: number, coords: number[], dim: number): number;
}

/** The identity rounder: emits every value unchanged (full precision). What
 * `makeRounder(_, 'full')` returns, and a convenient axes-free rounder for tests
 * that assert exact values. */
export const FULL_PRECISION_ROUNDER: ValueRounder = { at: (c, d) => c[d] as number, scalarAt: (v) => v };

export function makeRounder(axes: DataMappableAxes, mode: PrecisionMode): ValueRounder {
  if (mode === 'full') return FULL_PRECISION_ROUNDER;
  const scalarAt = (value: number, coords: number[], dim: number): number =>
    roundToResolution(value, resolutionAtData(axes, coords)[dim] ?? NaN);
  return { scalarAt, at: (coords, dim) => scalarAt(coords[dim] as number, coords, dim) };
}
