import { checkColorScale, valueAtPosition, type ColorScale } from '../algorithms/colorScale.js';
import { lookupColor } from '../algorithms/colorBar.js';
import type { RGB } from '../algorithms/colorFilter.js';

/**
 * WHAT A COLOUR MEASUREMENT REPORTS - an instrument, not a heatmap feature.
 *
 * ⚑⚑ DAVID CORRECTED THE SCOPE, 2026-08-16: *"I do not think that we should tie
 * a general measurement tool to a specific graph. This should be something that
 * is independent, a reliable second opinion on pure colour measurements, that is
 * useful in ALL types of graphs."* I had filed the eyedropper under heatmaps
 * because that is the type that made colour-reading urgent - which would have
 * shipped it bound to a colour key, available on one type and invisible on the
 * other eleven.
 *
 * ⚑ SO THE READING SPLITS, and the split is the ruler's own rule one dimension
 * over: a distance reads in PIXELS until a scale exists and in units after, so a
 * colour reads as a COLOUR always and as a VALUE wherever a key is calibrated.
 * That is what makes the tool available on every graph type from day one.
 *
 * ⚑ Formatting stays in `ui/` (`core/measurementValues.ts`'s standing rule), so
 * this returns the numbers and the verdict, never a string.
 */
export interface ColourMeasureReading {
  /** What was measured. Never in doubt, and never absent. */
  rgb: RGB;
  /**
   * What the calibrated colour axis says this colour is worth.
   *
   * Null in both cases where there is no value to give: no axis is calibrated on
   * this figure, or one is and this colour is not on it. `calibrated` separates
   * them, because they must not read the same on screen.
   */
  value: number | null;
  /**
   * A colour axis is calibrated on this figure.
   *
   * ⚑ WITHOUT THIS THE TWO SILENCES LOOK IDENTICAL. "There is nothing to read
   * against" and "there is, and your colour is not on it" are different facts,
   * and only the second is a statement about the pixel the user clicked.
   */
  calibrated: boolean;
}

/**
 * ⚑⚑ THE SAME LOOKUP THE HEATMAP USES, and that is the entire point of the tool.
 * It is an INDEPENDENT second opinion, so it answers against the same calibrated
 * range, by the same rule, with the same tolerance measured off the same key. A
 * second instrument using a different method would not be a check, it would be a
 * second guess.
 *
 * ⚠️ WHERE THE TWO CAN STILL DIFFER, stated plainly because this comment
 * previously claimed they could not (v2.3 re-audit). The KEY-side tolerance is
 * shared; the SAMPLE-side is not. A heatmap cell is a medoid over a lattice and
 * passes its own measured spread to `lookupColor`; this tool reports the ONE
 * pixel the user clicked, and a single pixel has no spread to measure - so it
 * offers none and is held to the key's noise alone.
 *
 * ▶ That makes it STRICTER on a degraded figure, and strict is the honest
 * direction for a single pixel: on a q35 JPEG it will answer `[not in range]`
 * for a cell whose medoid the Cells table places without trouble. The two are
 * not contradicting each other - they measured different things, one pixel
 * against a lattice - but a reader comparing them deserves to know which.
 *
 * ⚑ Nothing more than that. It takes what it can and gives that to the user:
 * the colour always, the value where the axis is calibrated and the colour is on
 * it, and otherwise the plain fact that it is not.
 */
export function colourMeasureReading(rgb: RGB, scale: ColorScale | null): ColourMeasureReading {
  // ⚑ A key that cannot be read is not a calibrated axis. From the reader's side
  // that is the same fact as having none: there is nothing to be in range OF.
  if (scale === null || checkColorScale(scale) !== null) {
    return { rgb, value: null, calibrated: false };
  }
  const t = lookupColor(scale.strip, rgb);
  return { rgb, value: t === null ? null : valueAtPosition(scale, t), calibrated: true };
}
