import type { Blob } from './blobDetect.js';

/**
 * ⚑⚑ ONE ANSWER TO "ARE THESE TWO PIECES THE SAME BAR?"
 *
 * `hatchJoin` and `ruleJoin` are one problem seen twice - the figure drew
 * something across a bar in a colour we drop, so a connected component came
 * back in pieces - and both files say so in their own headers. `hatchJoin`:
 * *"they are fixed the same way, in the same place in the pipeline, using the
 * same `sameCategoryExtent` test."* `ruleJoin` quotes that sentence back as its
 * reason for existing and for being moved next door.
 *
 * ⚠️ THEY EACH CARRIED A PRIVATE COPY OF IT. Two `SAME_CATEGORY_OVERLAP = 0.9`
 * constants and two verbatim `sameCategoryExtent` helpers, in one directory,
 * under two comments asserting they were shared. A number that must agree with
 * another number, with nothing making it - and the comment above each one is
 * what stops the next reader from checking. Gate 3.
 */

/**
 * How much of the wider box's category extent two pieces must share before they
 * are called one bar.
 *
 * ⚑ A FRACTION, NOT A PIXEL COUNT, so it means the same thing on a 900px figure
 * and a 4000px one. Two halves of a severed rectangle have identical extents;
 * the tenth of slack is for the anti-aliased column or two the filter drops at
 * the cut, and nothing more. It is deliberately tight: the cost of joining two
 * shapes that are not one bar is a reading that never existed.
 */
export const SAME_CATEGORY_OVERLAP = 0.9;

/** Which way the bars run, from the caller's own category axis. */
export type CategoryAxis = 'x' | 'y';

/** The four box edges, named by what they MEAN rather than by x and y - which
 *  is the whole reason one set of rules serves vertical and horizontal bars. */
export function extentReaders(categoryAxis: CategoryAxis): {
  valueLo: (b: Blob) => number;
  valueHi: (b: Blob) => number;
  catLo: (b: Blob) => number;
  catHi: (b: Blob) => number;
} {
  return {
    valueLo: (b) => (categoryAxis === 'x' ? b.bbox.minY : b.bbox.minX),
    valueHi: (b) => (categoryAxis === 'x' ? b.bbox.maxY : b.bbox.maxX),
    catLo: (b) => (categoryAxis === 'x' ? b.bbox.minX : b.bbox.minY),
    catHi: (b) => (categoryAxis === 'x' ? b.bbox.maxX : b.bbox.maxY),
  };
}

/** Do these two occupy the same slice of the category axis? */
export function sameCategoryExtent(a: Blob, b: Blob, categoryAxis: CategoryAxis): boolean {
  const { catLo, catHi } = extentReaders(categoryAxis);
  const overlap = Math.min(catHi(a), catHi(b)) - Math.max(catLo(a), catLo(b));
  const widest = Math.max(catHi(a) - catLo(a), catHi(b) - catLo(b));
  return widest > 0 && overlap / widest >= SAME_CATEGORY_OVERLAP;
}
