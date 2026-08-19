import { readColor, type ColorScale } from '../algorithms/colorScale.js';
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
  /** The value the calibrated key gives this colour, or null when there is no
   * key, no usable scale, or no single answer. */
  value: number | null;
  /**
   * The key answers this colour in more than one place.
   *
   * ⚑⚑ AND THAT IS NOT A VALUE WITH A WIDER ERROR BAR. `readColor`'s own note:
   * *"an imprecise value is a number with an error bar, an ambiguous one is not
   * a number at all until the user resolves it."* A diverging key revisits its
   * pale colours, so this is the ordinary case rather than a corner one - and a
   * SECOND OPINION that confidently picks one of two answers is worse than no
   * tool, because it is trusted precisely where the first opinion was unsure.
   */
  ambiguous: boolean;
}

export function colourMeasureReading(rgb: RGB, scale: ColorScale | null): ColourMeasureReading {
  if (scale === null) return { rgb, value: null, ambiguous: false };
  const reading = readColor(scale, rgb);
  // ⚑ A scale that cannot be used answers null, and the colour stands alone -
  // the same shape as having no key at all, because from the reader's side it
  // is the same fact: nothing here can turn this colour into a number.
  if (reading === null) return { rgb, value: null, ambiguous: false };
  if (reading.rivals.length > 0) return { rgb, value: null, ambiguous: true };
  return { rgb, value: reading.value, ambiguous: false };
}
