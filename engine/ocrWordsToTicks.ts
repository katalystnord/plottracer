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
/**
 * Which band `at` belongs to, reaching HALF A BAND past each end.
 *
 * ⚑⚑ THE OUTERMOST LABELS OVERHANG, and a strict "inside a band or nowhere"
 * test dropped them: the first and last labels of a row routinely sit a little
 * outside the axis span, because a rotated one leans past the end and a wide one
 * is centred on a tick that is itself only half a band in. The outermost
 * category then came back unnamed while every other one read fine.
 *
 * ⚑ The rule is the one this codebase already settled for the same dividers.
 * `bandIndexForParam`'s doc: *"the outermost bands are UNBOUNDED - anything left
 * of the first divider is category 0"*, because a datum just outside the
 * declared span still belongs to the category it is nearest. Two answers to one
 * question about one axis is how they drift apart.
 *
 * ⚠️ BOUNDED, THOUGH, AND DELIBERATELY. A bar is known to belong to the figure;
 * a WORD might be the axis title, a legend entry or a stray number the drawn box
 * happened to catch, and forcing junk into category 0 is worse than dropping it.
 * Half a band is measured against the figure's own geometry rather than guessed
 * in pixels, and it covers an overhanging label and nothing else.
 */
function bandForAnchor(at: number, bands: readonly { from: number; to: number }[]): number | null {
  const inside = bands.findIndex((b) => at >= b.from && at <= b.to);
  if (inside !== -1) return inside;
  const first = bands[0];
  const last = bands[bands.length - 1];
  if (!first || !last) return null;
  if (at < first.from) {
    return first.from - at <= (first.to - first.from) / 2 ? 0 : null;
  }
  return at - last.to <= (last.to - last.from) / 2 ? bands.length - 1 : null;
}

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
    // ⚑⚑ A TICK MARK IS NOT A WORD. A band dragged a few pixels below the axis
    // catches the row of ticks, and the reader returns each one as a `-`; joined
    // in reading order, every category came back named `- 2021-01-01`. Measured
    // on a real figure.
    // ⚑ Dropped here rather than asked of the user: a band has to be allowed to
    // touch the axis, since a rotated label's top corner sits right under it,
    // and "start your box clear of the ticks" is tribal knowledge.
    // ⚑ The test is "no letter and no digit", not a list of characters to
    // strip - a name may legitimately contain punctuation (`pH 7.4`, `t-test`,
    // `n=12`), and only a word made ENTIRELY of it carries nothing.
    if (!/[\p{L}\p{N}]/u.test(clean)) continue;
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
    const index = bandForAnchor(at, bands);
    if (index === null) continue;
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
