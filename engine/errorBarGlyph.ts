/**
 * Error-bar glyph geometry (checkpoint 70) — a port of the old app's
 * `drawErrorBarGlyph` (`ui-patches/overrides.js:901-918`), which the
 * engine/ui rebuild dropped along with the rest of the error-bar stack.
 *
 * Same rationale as engine/boxPlotGlyph.ts and engine/histogramGlyph.ts:
 * without it a completed Value/Upper/Lower tuple is three unconnected dots,
 * and you cannot see whether the bar actually lines up with the one drawn on
 * the image — which is the whole reason to draw it.
 *
 * Reuses histogramGlyph's GlyphSegment rather than declaring a third identical
 * {from,to} type (boxPlotGlyph has its own). Consolidating those three is a
 * tidy-up worth doing, but not while restoring a dropped capability.
 */

import type { GlyphSegment, Point2D } from './histogramGlyph.js';

/** Half-length of the whisker end caps, in image pixels. The old app's own
 * constant (`overrides.js:902`). */
const CAP_HALF = 8;

/**
 * The bar between two whisker ends, plus a cap at each end.
 *
 * **The caps are perpendicular to the bar's own direction, not assumed
 * vertical** — the detail worth preserving from the original. An error bar is
 * vertical in *data* space, but the calibration can be rotated or skewed, so
 * on the image the bar may lean; caps drawn straight across would visibly
 * detach from it. Deriving the normal from the segment keeps the glyph correct
 * under any calibration, which matters more now than it did in the old app:
 * checkpoint 68 exposed the rotation-correction option that WPD has always
 * applied by default.
 *
 * Takes the two whisker ends in *image-pixel* space. A degenerate bar (both
 * ends on one pixel) falls back to a horizontal normal, drawing a small cross
 * rather than vanishing — see the inline note; this is a deliberate, tested
 * divergence from the original, which renders nothing in that case.
 */
/**
 * One whisker: the bar from a datum out to its cap, plus a tick across the cap
 * — the rendering of a *recorded relation* (checkpoint 79).
 *
 * **Required, not decorative** (docs/error-bars-design.md). The link we store is
 * series->series; which datum a given cap belongs to is resolved, not stored. A
 * cap that silently attached to the neighbouring point looks exactly like one
 * that attached correctly, so drawing the resolution per-point is what turns an
 * invisible mistake into a visible one. It is the same argument as Check
 * Calibration and the CCR arc preview.
 *
 * Only the cap end gets a tick, unlike computeErrorBarGlyph's two-ended bar: the
 * datum end already draws its own data dot, and a tick there would read as a
 * second cap. The tick is normal to the bar's own direction for the reason
 * given below — a rotated calibration leans the bar, and caps drawn straight
 * across would visibly detach from it.
 */
export function computeWhiskerGlyph(datum: Point2D, cap: Point2D): GlyphSegment[] {
  const dx = cap.x - datum.x;
  const dy = cap.y - datum.y;
  const length = Math.sqrt(dx * dx + dy * dy);
  if (length < 1e-9) {
    // A cap on top of its datum is zero error -- a claim of perfect certainty,
    // and the one thing more dangerous here than a wrong number (checkpoint
    // 77's self-relation bug). Draw the tick anyway so it is visible rather
    // than rendering nothing at all.
    return [{ from: { x: datum.x - CAP_HALF, y: datum.y }, to: { x: datum.x + CAP_HALF, y: datum.y } }];
  }
  const nx = -dy / length;
  const ny = dx / length;
  return [
    { from: { ...datum }, to: { ...cap } },
    {
      from: { x: cap.x - nx * CAP_HALF, y: cap.y - ny * CAP_HALF },
      to: { x: cap.x + nx * CAP_HALF, y: cap.y + ny * CAP_HALF },
    },
  ];
}

export function computeErrorBarGlyph(upper: Point2D, lower: Point2D): GlyphSegment[] {
  const dx = lower.x - upper.x;
  const dy = lower.y - upper.y;
  const length = Math.sqrt(dx * dx + dy * dy);
  // A degenerate bar (both whiskers on one pixel) has no direction to take a
  // normal from. The original divides by `|| 1`, which yields the ZERO vector,
  // not a horizontal one -- so all three segments collapse and the bar renders
  // as nothing at all. Falling back to a horizontal normal draws a small cross
  // instead: the honest rendering of "both ends captured in the same place",
  // and visible enough to notice and fix. (Adversarial review of checkpoint 70
  // caught the original prose claiming this behaviour while the code lacked it.)
  const nx = length > 1e-9 ? -dy / length : 1;
  const ny = length > 1e-9 ? dx / length : 0;

  const cap = (centre: Point2D): GlyphSegment => ({
    from: { x: centre.x - nx * CAP_HALF, y: centre.y - ny * CAP_HALF },
    to: { x: centre.x + nx * CAP_HALF, y: centre.y + ny * CAP_HALF },
  });

  return [{ from: { ...upper }, to: { ...lower } }, cap(upper), cap(lower)];
}
