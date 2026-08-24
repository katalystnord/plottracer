/**
 * A CAPTURED BAR, READ AS AN INTERVAL - and the one measurement four findings
 * needed (v2.3).
 *
 * ⚑⚑ THE QUESTION THIS ANSWERS: **does this bar's near end SIT on the baseline,
 * within resolution?** Not "was a baseline declared" - that was the defect.
 * `samples/bar-floating-temperature` is the counterexample that made it visible:
 * a declared baseline of 0 with every bar floating, so the `Value` column
 * reported a MINIMUM on rows below zero and a MAXIMUM on rows above it, under
 * one heading. Someone averaging that column gets a number that means nothing.
 *
 * ⚑ Four findings land on this one question, which is why it is a module and not
 * a branch inside one of them:
 *   · a floating bar's value is an INTERVAL, not a quantity (Min/Max);
 *   · a stacked figure's segments are the ones that legitimately do not touch it;
 *   · a legend SWATCH does not touch it either, which is half its discriminator
 *     (the other half is size - a swatch is small and square, a bar spans its
 *     category);
 *   · and "always use the span" is wrong: a bar drawn DOWN from zero to -20 has
 *     the value -20, while its span is 20 and has lost the sign.
 *
 * ⚑ WITHIN RESOLUTION, not exactly equal. The ends are read off pixels, so the
 * near end of a bar drawn on the axis lands a fraction of a data unit away from
 * the baseline every time. `halfPixelResolution` is what v2.3 already wired into
 * the panels for exactly this - the smallest difference the figure can express -
 * so it is the tolerance here too rather than an epsilon of our own.
 */

/** The two measured ends of one bar, read as an interval rather than as a
 * start and an end. */
export interface BarInterval {
  /** The lower end. A property of the INTERVAL - which corner was dragged first
   * is the operator's hand, and the record deliberately does not keep it. */
  min: number;
  /** The upper end. */
  max: number;
  /** Whichever end lies nearer the baseline IN VALUE (never in pixels: a bar
   * below the baseline in an ordinary vertical figure has its near end at the
   * LARGER y, and `pixelToData` has already encoded orientation and direction). */
  near: number;
  /** The other end - the one a baseline-relative value is read at. */
  far: number;
  /** MEASURED: is `near` on the baseline, to within the figure's own resolution? */
  onBaseline: boolean;
}

/**
 * Read one bar's two measured values as an interval against `baseline`.
 *
 * @param resolution the value axis's half-pixel resolution AT this bar - the
 * tolerance for "sits on". A non-finite or non-positive resolution (a degenerate
 * calibration) makes `onBaseline` false rather than true: an unanswerable
 * measurement must not read as a positive one.
 */
/**
 * Which of the two captured ends lies nearer the baseline in value.
 *
 * ⚑ Exported so a caller can pick the PIXEL to measure resolution at without
 * re-deriving the rule: the tolerance for "sits on the baseline" is read at the
 * near end, and asking that question twice in two places is how the two answers
 * come to disagree.
 */
/**
 * How far from the baseline still counts as SITTING ON IT, in pixels.
 *
 * ⚑⚑ ONE QUESTION, ONE TOLERANCE. This number was already stated once, on the
 * bar DETECTOR, with the reasoning written out: *"It is not the half-pixel
 * resolution a VALUE is read at: a bar's ink stops where it was drawn, and the
 * axis line, its stroke width and any anti-aliasing sit between the two. The
 * question is 'does this shape reach the baseline', not 'is its edge the same
 * pixel'."* The DERIVED VALUE asked the same question at half a pixel, so the
 * two halves of one product answered it differently.
 *
 * ⚠️ MEASURED on David's own figure. Value axis 0..10 over 546px, bottom corners
 * clicked on the axis by hand: the near ends read 0.03 to 0.05, half a pixel is
 * 0.0092, and two pixels is 0.0366. So every ordinary hand-clicked bar came back
 * as FLOATING - no `Value` column at all, and a `Min` column of near-zero noise
 * on a chart where every bar plainly sits on zero. David: *"When we have a bar
 * graph that we know the bar sits on zero, we do not need to report the min I
 * think. It will just be a bit confusing, no?"*
 *
 * ⚑ It applies MORE to a hand click than to detected ink, not less: a person
 * aiming at an axis line is a pixel or two out by nature, and the tool must not
 * read that as a claim about the figure.
 */
export const BASELINE_TOLERANCE_PX = 2;

export function nearEndIsFirst(v1: number, v2: number, baseline: number): boolean {
  return Math.abs(v1 - baseline) <= Math.abs(v2 - baseline);
}

export function barInterval(
  v1: number,
  v2: number,
  baseline: number,
  resolution: number
): BarInterval | null {
  if (!Number.isFinite(v1) || !Number.isFinite(v2) || !Number.isFinite(baseline)) return null;
  const nearIsV1 = nearEndIsFirst(v1, v2, baseline);
  const near = nearIsV1 ? v1 : v2;
  const far = nearIsV1 ? v2 : v1;
  const usable = Number.isFinite(resolution) && resolution > 0;
  return {
    min: Math.min(v1, v2),
    max: Math.max(v1, v2),
    near,
    far,
    onBaseline: usable && Math.abs(near - baseline) <= resolution,
  };
}
