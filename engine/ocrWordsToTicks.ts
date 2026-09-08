/**
 * ⚑⚑ RELATING WHAT WAS READ TO WHERE THE TICKS ARE (v2.5).
 *
 * David: *"we just need to relate this with the positions on the tick marks, for
 * the odd chance that there might be multiple line category descriptions."*
 *
 * ⚑ THE ENGINE ALREADY HANDS US THE GEOMETRY, measured 2026-09-08 rather than
 * assumed: `blocks -> paragraphs -> lines -> words`, each word carrying
 * `{ text, bbox: {x0,y0,x1,y1}, confidence }`. So the association is a geometry
 * job on data that arrives for free, and no per-label crop is needed at all.
 *
 * ⚑⚑ WHY THE ANCHOR END AND NOT THE CENTRE. A rotated label extends AWAY from
 * its own tick - `2021-01-08` at 45 degrees reaches tens of pixels down and
 * left - so its centre drifts steadily off the tick it belongs to, and the drift
 * grows with the label's length. The end NEAREST the axis is the part that
 * actually sits at the tick. Taking centres mis-files the long labels only,
 * which is the worst kind of wrong: it looks fine on the short ones.
 */

export interface OcrWord {
  text: string;
  confidence: number;
  /** In the STRAIGHTENED image's frame - what the reader returned. */
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

export interface WordsToTicksInput {
  words: readonly OcrWord[];
  /** Straightened frame back to the figure's own pixels. */
  toSource: (x: number, y: number) => { x: number; y: number };
  /** The category axis's N+1 dividers, in figure pixels. */
  dividers: readonly { x: number; y: number }[];
  /** Which dimension the categories run in. */
  along: 'x' | 'y';
  /**
   * Where the axis LINE sits in the other dimension, in figure pixels - the
   * labels hang off it. ⚑ This is what makes "the anchor end" meaningful: it is
   * the end of the word nearest THIS.
   */
  axisAt: number;
}

export interface TickReading {
  categoryIndex: number;
  text: string;
  confidence: number;
}

/**
 * One reading per category, from a single read of the whole band.
 *
 * ⚑ MULTI-LINE FALLS OUT. Words are grouped by the category their anchor lands
 * in, not by which crop they were cut from, so a two-line label contributes both
 * its lines to the same category with nothing special written for the case.
 * Lines are joined in reading order, top to bottom then left to right.
 *
 * ⚑ A category no word reaches gets NO entry, rather than an empty string: an
 * empty reading and an unread category look identical downstream, and the review
 * card already treats "no reading" as "leave the name alone".
 */
export function wordsToTicks(input: WordsToTicksInput): TickReading[] {
  const { words, toSource, dividers, along, axisAt } = input;
  if (dividers.length < 2) return [];
  const bands: { from: number; to: number }[] = [];
  for (let i = 0; i + 1 < dividers.length; i++) {
    const a = along === 'x' ? dividers[i]!.x : dividers[i]!.y;
    const b = along === 'x' ? dividers[i + 1]!.x : dividers[i + 1]!.y;
    bands.push({ from: Math.min(a, b), to: Math.max(a, b) });
  }

  const perCategory = new Map<number, { text: string; conf: number; order: number }[]>();
  for (const word of words) {
    const clean = word.text.trim();
    if (clean === '') continue;
    // ⚑ The word's four corners in FIGURE pixels: the rotation means an
    // axis-aligned box in the straightened frame is a tilted one out here.
    const corners = [
      toSource(word.bbox.x0, word.bbox.y0),
      toSource(word.bbox.x1, word.bbox.y0),
      toSource(word.bbox.x0, word.bbox.y1),
      toSource(word.bbox.x1, word.bbox.y1),
    ];
    // The anchor: the corner nearest the axis line.
    let anchor = corners[0]!;
    let best = Infinity;
    for (const c of corners) {
      const d = Math.abs((along === 'x' ? c.y : c.x) - axisAt);
      if (d < best) {
        best = d;
        anchor = c;
      }
    }
    const at = along === 'x' ? anchor.x : anchor.y;
    const index = bands.findIndex((b) => at >= b.from && at <= b.to);
    if (index === -1) continue;
    const list = perCategory.get(index) ?? [];
    // ⚑ Reading order within a category: down the lines first, then across.
    list.push({ text: clean, conf: word.confidence, order: anchor.y * 100000 + anchor.x });
    perCategory.set(index, list);
  }

  const out: TickReading[] = [];
  for (const [categoryIndex, list] of [...perCategory.entries()].sort((a, b) => a[0] - b[0])) {
    const sorted = [...list].sort((a, b) => a.order - b.order);
    out.push({
      categoryIndex,
      text: sorted.map((w) => w.text).join(' '),
      // ⚑ The WEAKEST word's confidence, not the mean: a label is only as
      // trustworthy as its worst part, and a mean lets one crisp word carry a
      // garbled one into looking read.
      confidence: Math.min(...sorted.map((w) => w.conf)),
    });
  }
  return out;
}
