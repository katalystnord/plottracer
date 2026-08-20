import { readColor, type ColorScale } from '../algorithms/colorScale.js';
import { COLOR_NOISE_FLOOR } from '../algorithms/colorBar.js';
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
  /**
   * This colour is not on the key at all.
   *
   * ⚑⚑ THE SAME RULE AS `ambiguous`, ONE CASE WIDER, and it is the SAMPLER's
   * rule rather than the heatmap's. David, 2026-08-20: *"IF there is a key
   * calibrated. It should report that too. And if it is outside of the key,
   * then just report that."* A key inverts a colour by finding the nearest
   * point on its ramp, so it answers for EVERY colour it is handed - including
   * one that is nowhere near it. Pure red on a black-to-white ramp came back as
   * `33.5`, 208 away from the ramp, with an interval spanning 0 to 80.
   *
   * ⚑ SO THE FACT REPLACES THE NUMBER, rather than qualifying it. Reporting
   * "outside the key" is a measurement; reporting `33.5` with a caveat beside it
   * is a number the reader has to be talked out of, and this tool exists to be
   * the opinion that is checked against, not the one that has to be discounted.
   *
   * ⚑ Only meaningful where a key exists: with no key there is no outside, and
   * the colour simply stands alone.
   */
  offKey: boolean;
}

export function colourMeasureReading(rgb: RGB, scale: ColorScale | null): ColourMeasureReading {
  if (scale === null) return { rgb, value: null, ambiguous: false, offKey: false };
  const reading = readColor(scale, rgb);
  // ⚑ A scale that cannot be used answers null, and the colour stands alone -
  // the same shape as having no key at all, because from the reader's side it
  // is the same fact: nothing here can turn this colour into a number.
  if (reading === null) return { rgb, value: null, ambiguous: false, offKey: false };
  // ⚑ BEFORE the rivals check: a colour that is not on the key is not made a
  // better reading by the key answering it twice, and "outside" is the plainer
  // fact of the two.
  // ⚑ `COLOR_NOISE_FLOOR` REUSED, not a new threshold: it is already this
  // codebase's answer to "are these the same colour" - the test `heatmapRead`
  // applies to every pixel it counts - so an inversion that lands further than
  // that from the ramp did not match the key's ink at all.
  if (reading.distance > COLOR_NOISE_FLOOR) return { rgb, value: null, ambiguous: false, offKey: true };
  if (reading.rivals.length > 0) return { rgb, value: null, ambiguous: true, offKey: false };
  return { rgb, value: reading.value, ambiguous: false, offKey: false };
}
