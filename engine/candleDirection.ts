/**
 * ⚑⚑ WHICH WAY EACH CANDLE MOVED, MEASURED FROM THE FIGURE'S COLOUR (v2.5).
 *
 * David, 2026-09-08, after marking a candle bottom-up the way the box plot's own
 * walk teaches: *"Is it not dependant on the color?"* It is. A candle's two body
 * edges are geometrically INDISTINGUISHABLE - the same rectangle either way
 * round - so colour is the only signal the figure carries. Confirmed against the
 * trading source he sent: *"The color itself serves as the primary indicator of
 * whether price moved upward or downward."*
 *
 * ⚠️⚑⚑ AN EARLIER DESIGN THREW A COLOUR SAMPLER AWAY, reasoning that classic
 * print uses FILLED vs HOLLOW while modern platforms use green vs red, and that
 * "a colour test would have to choose between two live conventions and would be
 * wrong half the time". That is an argument against ASSUMING a convention, not
 * against MEASURING one - and the way out is not to choose at all:
 *
 *   ⚑ A figure has exactly TWO body appearances, so they CLUSTER. Which cluster
 *     rises is ONE fact per figure, not one per candle, and it is offered with a
 *     measured default that the user can flip if the figure is unusual.
 *
 * ⚑ TENET 9: nothing here decides what a candle MEANS. It reports which of two
 * measured appearances each body has, and the naming follows from one
 * declaration - exactly as a heatmap cell's colour becomes a value only once the
 * key has been declared.
 */
import { colorDistance, medoidColor } from '../algorithms/colorBar.js';
import type { RGB } from '../algorithms/colorFilter.js';

/**
 * Split the bodies into the figure's two appearances.
 *
 * ⚑ SEEDED FROM THE TWO MOST DISTANT SAMPLES rather than iterated: with k=2 and
 * a figure that draws exactly two colours, the extremes ARE the clusters, and a
 * seeded k-means would only add a way to converge somewhere else.
 *
 * ⚑ Returns all-zero when every body looks alike, which is a real figure: a
 * chart whose periods all rose has one appearance and no second cluster to find.
 * Saying "two groups" there would invent a distinction the figure never drew.
 */
export function clusterCandleBodies(bodies: readonly RGB[]): { group: number[]; centres: [RGB, RGB] | null } {
  if (bodies.length === 0) return { group: [], centres: null };
  let seedA = bodies[0]!;
  let seedB = bodies[0]!;
  let widest = 0;
  for (const a of bodies) {
    for (const b of bodies) {
      const d = colorDistance(a, b);
      if (d > widest) {
        widest = d;
        seedA = a;
        seedB = b;
      }
    }
  }
  // ⚑ MEASURED THRESHOLD, not a taste call: `COLOR_NOISE_FLOOR` is what the rest
  // of the app already calls "the same colour", so a spread under it is one
  // appearance drawn with anti-aliasing, not two.
  if (widest < SAME_APPEARANCE) return { group: bodies.map(() => 0), centres: null };
  return {
    group: bodies.map((c) => (colorDistance(c, seedA) <= colorDistance(c, seedB) ? 0 : 1)),
    centres: [seedA, seedB],
  };
}

/** Below this, two bodies are the same appearance drawn twice. */
export const SAME_APPEARANCE = 40;

/**
 * Which of the two appearances is the RISING one - the figure's convention,
 * measured, and offered rather than asserted.
 *
 * ⚑⚑ TWO RULES, AND WHAT EACH IS ACTUALLY FOR:
 *
 *   1. HOLLOW vs FILLED (classic print, Investopedia's own diagram): if exactly
 *      one appearance sits on the BACKGROUND, that one is hollow, and hollow
 *      rises. ⚑ Measured against the figure's own background, not against white,
 *      so a dark-ground chart reads the same way.
 *   2. GREEN vs RED (every modern platform): the greener of the two rises,
 *      measured as g - r so it does not care about brightness.
 *
 * ⚑ Rule 1 exists because rule 2 CANNOT separate an achromatic figure: white and
 * black both have g - r == 0, so hue ties and the tie has to be broken by
 * something else. That is the whole of their relationship.
 *
 * ⚠️ THE ORDER BETWEEN THEM IS NOT LOAD-BEARING, and this comment used to claim
 * it was. Swapping them changed no test, and no real figure was found where the
 * two disagree with a clear right answer - so asserting significance here would
 * be a design claim nothing enforces. Deleting rule 1 DOES break the print
 * convention, which is the property that is pinned.
 *
 * ⛔ It never REFUSES. A figure using two colours we cannot rank still gets an
 * answer, because the user can see the overlay disagree and flip it - which is
 * cheaper than a refusal that leaves them with nothing on screen to correct.
 */
export function risingAppearance(centres: [RGB, RGB], background: RGB): 0 | 1 {
  const [a, b] = centres;
  const aOnPaper = colorDistance(a, background) < SAME_APPEARANCE;
  const bOnPaper = colorDistance(b, background) < SAME_APPEARANCE;
  if (aOnPaper !== bOnPaper) return aOnPaper ? 0 : 1;
  const greenness = (c: RGB) => c[1] - c[0];
  return greenness(a) >= greenness(b) ? 0 : 1;
}

/**
 * The whole answer: is each candle rising?
 *
 * `flipped` is the one declaration a figure may need - the user saying the
 * measured default has it backwards. ⚑ A single-appearance figure reports every
 * candle the same way, which is what a chart that only ever rose looks like.
 */
export function candleDirections(
  bodies: readonly RGB[],
  background: RGB,
  flipped = false
): boolean[] {
  const { group, centres } = clusterCandleBodies(bodies);
  if (centres === null) return bodies.map(() => !flipped);
  const rising = risingAppearance(centres, background);
  return group.map((g) => (g === rising) !== flipped);
}

/** A pixel position on the image, as every other geometry module states it. */
export interface Point2D {
  x: number;
  y: number;
}

function pixelAt(src: Uint8ClampedArray, width: number, x: number, y: number): RGB {
  const i = (y * width + x) * 4;
  return [src[i] ?? 0, src[i + 1] ?? 0, src[i + 2] ?? 0];
}

/**
 * The colour of one candle's real body.
 *
 * ⚑ INSET FROM ITS OWN EDGES, and the heatmap paid to learn why: a border is
 * drawn ON the boundary, and an anti-aliased one blends the body with the paper
 * into a colour that is neither. Sampling the middle is what keeps the reading
 * inside the thing being measured.
 *
 * ⚑ MEDOID, not mean - the same primitive the colour key uses. A mean of red and
 * white is pink, which is a colour the figure never drew; a medoid is always an
 * actual sampled pixel.
 *
 * ⚑ A DOJI (open equal to close) still reads. Its body has no height, but the
 * figure draws a line there in the candle's own colour, so the sample is a real
 * reading - and its DIRECTION is immaterial by definition, because the period
 * opened and closed at the same value.
 *
 * Null only when the box has no pixels at all: off the image, or zero width.
 */
export function sampleCandleBody(
  src: Uint8ClampedArray,
  width: number,
  height: number,
  bodyLow: Point2D,
  bodyHigh: Point2D,
  halfWidth: number
): RGB | null {
  const cross = (bodyLow.x + bodyHigh.x) / 2;
  const vMin = Math.min(bodyLow.y, bodyHigh.y);
  const vMax = Math.max(bodyLow.y, bodyHigh.y);
  const inset = Math.min(3, (vMax - vMin) / 4);
  const top = Math.ceil(vMin + inset);
  const bottom = Math.floor(vMax - inset);
  const left = Math.ceil(cross - halfWidth / 2);
  const right = Math.floor(cross + halfWidth / 2);
  if (bottom < top || right < left) return null;
  const samples: RGB[] = [];
  for (let y = top; y <= bottom; y++) {
    if (y < 0 || y >= height) continue;
    for (let x = left; x <= right; x++) {
      if (x < 0 || x >= width) continue;
      samples.push(pixelAt(src, width, x, y));
    }
  }
  return medoidColor(samples);
}

/**
 * The figure's paper colour, measured off its border ring.
 *
 * ⚑ NOT ASSUMED WHITE. A dark-themed chart is a real figure, and the hollow test
 * above compares against THIS - so hardcoding white would read a dark chart's
 * hollow bodies as filled and rank them by hue instead.
 */
export function sampleBackground(
  src: Uint8ClampedArray,
  width: number,
  height: number
): RGB {
  const samples: RGB[] = [];
  const step = Math.max(1, Math.floor(Math.min(width, height) / 32));
  for (let x = 0; x < width; x += step) {
    samples.push(pixelAt(src, width, x, 0));
    samples.push(pixelAt(src, width, x, height - 1));
  }
  for (let y = 0; y < height; y += step) {
    samples.push(pixelAt(src, width, 0, y));
    samples.push(pixelAt(src, width, width - 1, y));
  }
  return medoidColor(samples) ?? [255, 255, 255];
}
