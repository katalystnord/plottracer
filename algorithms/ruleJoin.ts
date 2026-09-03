import type { Blob } from './blobDetect.js';

/**
 * Put back together a datum that a RULE THE FIGURE DRAWS cut in two (v2.5).
 *
 * ⚑⚑ IT LIVES BESIDE `hatchJoin` BECAUSE THEY ARE ONE PROBLEM, which that file
 * has said since it was written: *"a bar severed by the zero rule and a bar
 * shredded by a hatch are the same problem - the figure drew something across a
 * bar in a colour we drop - so they are fixed the same way, in the same place in
 * the pipeline, using the same `sameCategoryExtent` test."* It was in
 * `engine/barDetectRun.ts` and its sibling was in `algorithms/`; now they are
 * neighbours.
 *
 * ⚑⚑ AND IT IS A SPAN'S PROBLEM, NOT A BAR'S. David: *"I do not think it should
 * be in bars at all."* A BAR STANDS ON THE ORIGIN - the rule abuts its near end
 * and cannot cut it in half. Only a datum with ends on BOTH sides gets severed,
 * which is a floating bar, which is a Span chart since v2.5. Leaving it on Bar
 * was not merely untidy: two same-coloured bars either side of the origin, which
 * is what a diverging chart draws, would have been joined into one reading that
 * never existed.
 *
 * ⚠️ AND THE MOVE IS ALSO A REPAIR. This morning the bar origin stopped being a
 * typed `0` and became the CATEGORY AXIS, measured. On a span whose category
 * axis sits at -15 - `samples/bar-floating-temperature`, David's own figure -
 * the join was then aimed 198px away from the zero rule that does the severing,
 * and silently stopped firing: twelve months came back as seventeen readings
 * again, exactly as the doc below predicted. The gate has to be the rule the
 * figure DRAWS ACROSS the plot, which is why it is passed in as one.
 */

/**
 * Where a rule runs across the plot, in image pixels along the VALUE axis.
 *
 * ⚑ The tolerance is the rule's own thickness, not a reading resolution: the
 * question is "do these two pieces both reach the line", where the line has
 * anti-aliased shoulders either side of its stroke.
 */
export interface SeveringRule {
  atPixel: number;
  tolerancePx: number;
}

/**
 * How much of the two shapes' CATEGORY extents have to coincide before they can
 * be two halves of one bar.
 *
 * ⚑ A FRACTION, NOT A PIXEL COUNT, so it means the same thing on a 900px figure
 * and a 4000px one. Two halves of a severed rectangle have identical extents;
 * the tenth of slack is for the anti-aliased column or two the filter drops at
 * the cut, and nothing more. It is deliberately tight: the cost of joining two
 * shapes that are not one bar is a reading that never existed.
 */
const SAME_CATEGORY_OVERLAP = 0.9;

/**
 * Put back together the bars that were severed by whatever the figure draws
 * along its baseline - the zero rule, the axis spine, a target line.
 *
 * ⚑⚑ WHY THIS IS NEEDED AT ALL. A bar drawn ACROSS the baseline has the rule
 * painted over its middle in the rule's own colour, so the colour filter drops
 * those rows and the connected component is cut in two. Both halves are then
 * filed as bars: on `samples/bar-floating-temperature.png` twelve months came
 * back as seventeen readings, with January reading `0.11 .. 2` on one row and
 * `-8 .. -0.04` on the next. Every number plausible, five bars that do not
 * exist, and nothing on screen wrong - the failure class this project treats as
 * the worst one.
 *
 * ⚑⚑ THE GATE IS THE USER'S OWN DECLARATION, which is the standing rule for
 * every bar technique here: it must be gated by something the app computes from
 * what the user said, so the population it cannot help is provably untouched.
 * That gate is the DECLARED BASELINE, and the test reuses the tolerance the
 * caller already states for "does this shape sit on the baseline" rather than
 * inventing a thickness of its own:
 *
 *   · the two shapes lie on OPPOSITE sides of the baseline;
 *   · BOTH reach it, within that tolerance - so the gap between them is the
 *     rule, not a gap the figure drew; and
 *   · their CATEGORY extents coincide - they are the same bar's width.
 *
 * ⚑ IT CANNOT FIRE ON A STACKED FIGURE, which is the case worth naming because
 * it is the one that looks similar: only the bottom segment of a stack touches
 * the baseline, so no pair ever satisfies the second clause. Two same-coloured
 * segments straddling the baseline is not a figure anyone draws - a stack is
 * legible only when its segments differ in colour, and same-colour segments that
 * touch have already flooded into one blob long before this.
 */
export function joinAcrossRule(
  blobs: readonly Blob[],
  categoryAxis: 'x' | 'y',
  rule: SeveringRule
): { blobs: Blob[]; joined: number } {
  const valueLo = (b: Blob) => (categoryAxis === 'x' ? b.bbox.minY : b.bbox.minX);
  const valueHi = (b: Blob) => (categoryAxis === 'x' ? b.bbox.maxY : b.bbox.maxX);
  const catLo = (b: Blob) => (categoryAxis === 'x' ? b.bbox.minX : b.bbox.minY);
  const catHi = (b: Blob) => (categoryAxis === 'x' ? b.bbox.maxX : b.bbox.maxY);
  /** Do these two occupy the same slice of the category axis? */
  const sameCategoryExtent = (a: Blob, b: Blob): boolean => {
    const overlap = Math.min(catHi(a), catHi(b)) - Math.max(catLo(a), catLo(b));
    const widest = Math.max(catHi(a) - catLo(a), catHi(b) - catLo(b));
    return widest > 0 && overlap / widest >= SAME_CATEGORY_OVERLAP;
  };
  const at = rule.atPixel;
  const tol = rule.tolerancePx;
  /** Wholly above the baseline and touching it - the piece drawn upwards. */
  const above = (b: Blob) => valueHi(b) <= at && at - valueHi(b) <= tol;
  /** Wholly below it and touching it - the piece drawn downwards. */
  const below = (b: Blob) => valueLo(b) >= at && valueLo(b) - at <= tol;

  const taken = new Set<number>();
  const out: Blob[] = [];
  let joined = 0;
  blobs.forEach((a, i) => {
    if (taken.has(i)) return;
    if (!above(a)) return;
    // ⚑ The FIRST match wins and both are then spent. A bar has one piece on
    // each side of the baseline, so a second candidate below the same width
    // would be a different shape entirely and joining it would invent an extent
    // spanning both.
    const j = blobs.findIndex((b, k) => k !== i && !taken.has(k) && below(b) && sameCategoryExtent(a, b));
    if (j < 0) return;
    const b = blobs[j]!;
    taken.add(i);
    taken.add(j);
    joined += 1;
    const area = a.area + b.area;
    const members =
      a.members && b.members
        ? (() => {
            const m = new Int32Array(a.members.length + b.members.length);
            m.set(a.members, 0);
            m.set(b.members, a.members.length);
            return m;
          })()
        : undefined;
    out.push({
      // ⚑ Recomputed, not inherited from the larger half: an area-weighted mean
      // of the two centroids IS the centroid of the union, and a diameter that
      // still described one half would misreport the joined shape to the size
      // filters and to anything reading it later.
      centroid: {
        x: (a.centroid.x * a.area + b.centroid.x * b.area) / area,
        y: (a.centroid.y * a.area + b.centroid.y * b.area) / area,
      },
      area,
      diameter: 2 * Math.sqrt(area / Math.PI),
      bbox: {
        minX: Math.min(a.bbox.minX, b.bbox.minX),
        minY: Math.min(a.bbox.minY, b.bbox.minY),
        maxX: Math.max(a.bbox.maxX, b.bbox.maxX),
        maxY: Math.max(a.bbox.maxY, b.bbox.maxY),
      },
      ...(members ? { members } : {}),
    });
  });
  // Everything untouched keeps its place; the joined pairs follow.
  return { blobs: [...blobs.filter((_, i) => !taken.has(i)), ...out], joined };
}
