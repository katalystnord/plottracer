/**
 * Error-bar glyph geometry (checkpoint 70) - a port of the old app's
 * `drawErrorBarGlyph` (`ui-patches/overrides.js:901-918`), which the
 * engine/ui rebuild dropped along with the rest of the error-bar stack.
 *
 * Same rationale as engine/boxPlotGlyph.ts and engine/histogramGlyph.ts:
 * without it a completed Value/Upper/Lower tuple is three unconnected dots,
 * and you cannot see whether the bar actually lines up with the one drawn on
 * the image - which is the whole reason to draw it.
 *
 * Reuses histogramGlyph's GlyphSegment rather than declaring a third identical
 * {from,to} type (boxPlotGlyph has its own). Consolidating those three is a
 * tidy-up worth doing, but not while restoring a dropped capability.
 */

import type { GlyphSegment, Point2D } from './histogramGlyph.js';

/** Half-length of the whisker end caps, in image pixels.
 *
 * ⚑ WAS 8 - the old app's own constant (`overrides.js:902`), inherited without
 * being looked at on our own canvas. At 8 the tick spans 16px, while the datum
 * it sits beside draws as a ring of radius 7 (14px across) plus crosshair arms:
 * the cap and the marker were nearly the same width, so the end of the whisker
 * disappeared into the data point rather than reading as a cap (David,
 * 2026-08-03, driving the app). A cap has to be legible AGAINST the marker,
 * which is the one thing the inherited number was never chosen for.
 *
 * Exported so the test can pin that relationship rather than the digit. */
export const CAP_HALF = 13;

/**
 * The bar between two whisker ends, plus a cap at each end.
 *
 * **The caps are perpendicular to the bar's own direction, not assumed
 * vertical** - the detail worth preserving from the original. An error bar is
 * vertical in *data* space, but the calibration can be rotated or skewed, so
 * on the image the bar may lean; caps drawn straight across would visibly
 * detach from it. Deriving the normal from the segment keeps the glyph correct
 * under any calibration, which matters more now than it did in the old app:
 * checkpoint 68 exposed the rotation-correction option that WPD has always
 * applied by default.
 *
 * Takes the two whisker ends in *image-pixel* space. A degenerate bar (both
 * ends on one pixel) falls back to a horizontal normal, drawing a small cross
 * rather than vanishing - see the inline note; this is a deliberate, tested
 * divergence from the original, which renders nothing in that case.
 */
/**
 * One whisker: the bar from a datum out to its cap, plus a tick across the cap
 * - the rendering of a *recorded relation* (checkpoint 79).
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
 * given below - a rotated calibration leans the bar, and caps drawn straight
 * across would visibly detach from it.
 */
/**
 * One whisker, with its two parts NAMED.
 *
 * ⚑⚑ It used to be a `GlyphSegment[]` - `[bar, tick]`, and `[tick]` alone in the
 * degenerate case - and the caller indexed in. B2 gives the two parts DIFFERENT
 * colours (the bar takes the series' colour, the cap is black), so "element 1 is
 * the tick" stopped being an implementation detail and became a contract that a
 * one-element array quietly broke.
 */
export interface WhiskerShape {
  /** The bar from the datum out to the cap. Zero-length when the cap sits on its
   * datum, which draws nothing - the cap itself still says where it is. */
  bar: GlyphSegment;
  /** ⚑⚑ THE TICK ACROSS THE CAP *IS* THE CAP. There is no second object to
   * drift away from it - which is the whole of B1. See `capIsOneObject.test.ts`
   * for why a separate ball could not be fixed, only removed. */
  cap: GlyphSegment;
}

export function computeWhiskerGlyph(datum: Point2D, cap: Point2D): WhiskerShape {
  const dx = cap.x - datum.x;
  const dy = cap.y - datum.y;
  const length = Math.sqrt(dx * dx + dy * dy);
  if (length < 1e-9) {
    // A cap on top of its datum is zero error -- a claim of perfect certainty,
    // and the one thing more dangerous here than a wrong number (checkpoint
    // 77's self-relation bug). Draw the tick anyway so it is visible rather
    // than rendering nothing at all, with an empty bar beside it: a bar from a
    // point to itself is the honest drawing of no extent.
    return {
      bar: { from: { ...datum }, to: { ...datum } },
      cap: { from: { x: datum.x - CAP_HALF, y: datum.y }, to: { x: datum.x + CAP_HALF, y: datum.y } },
    };
  }
  const nx = -dy / length;
  const ny = dx / length;
  return {
    bar: { from: { ...datum }, to: { ...cap } },
    cap: {
      from: { x: cap.x - nx * CAP_HALF, y: cap.y - ny * CAP_HALF },
      to: { x: cap.x + nx * CAP_HALF, y: cap.y + ny * CAP_HALF },
    },
  };
}
