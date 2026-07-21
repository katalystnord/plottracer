/**
 * Check Calibration (v0.8) — the old app's calibration verifier, restored
 * (ui-patches/engauge-algos.js's CalibrationCheckerRepainter; a v0.8 "Also"
 * item). Map the four corners of the CALIBRATED data range back to pixels
 * through the axes' own transform and draw the rectangle: if the calibration is
 * correct, that box hugs the plot's real axis frame. If a handle slipped or a
 * value was mistyped, the box visibly shears or misses the frame.
 *
 * This is a pure check OF the transform (tenet 9): it records nothing and
 * interprets nothing — it only shows, in pixels, where the current calibration
 * says the axis box is. XY only: it needs a numeric x/y range (`getBounds`) and
 * a working `dataToPixel`, which the other axes classes don't provide (Bar's
 * dataToPixel is a stub; polar/ternary/map/CCR have no rectangular extent).
 */

export interface Pt {
  x: number;
  y: number;
}

interface XyBoundsAxes {
  /** The calibrated data range (log-aware): x1..x2 on X, y3..y4 on Y. */
  getBounds(): { x1: number; x2: number; y3: number; y4: number };
  dataToPixel(x: number, y: number): Pt;
}

function hasXyBounds(axes: unknown): axes is XyBoundsAxes {
  const a = axes as Partial<XyBoundsAxes> | null;
  return !!a && typeof a.getBounds === 'function' && typeof a.dataToPixel === 'function';
}

/**
 * The four pixel corners of the calibrated axis box, in order (a closed
 * quadrilateral), or `null` when these axes can't produce one (not XY, or a
 * degenerate calibration that maps a corner to a non-finite pixel).
 */
export function calibrationCheckBox(axes: unknown): Pt[] | null {
  if (!hasXyBounds(axes)) return null;
  const b = axes.getBounds();
  if (![b.x1, b.x2, b.y3, b.y4].every((v) => Number.isFinite(v))) return null;
  const corners: [number, number][] = [
    [b.x1, b.y3],
    [b.x1, b.y4],
    [b.x2, b.y4],
    [b.x2, b.y3],
  ];
  const px = corners.map(([x, y]) => axes.dataToPixel(x, y));
  if (px.some((p) => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y))) return null;
  return px;
}
