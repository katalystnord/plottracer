/**
 * ⚑⚑ A BAR'S OWN MARK, DRAWN DOWN TO THE FIGURE'S COMMON ORIGIN (v2.5).
 *
 * Until now a captured bar rendered as two numbered dots and nothing else -
 * the user had to hold the pairing in their head, on the one type whose datum
 * IS a rectangle. A histogram bin got its staple in checkpoint 66 for exactly
 * that reason; the bar never got one.
 *
 * ⚑⚑ AND IT REACHES THE BASELINE, WHICH THE BIN'S DELIBERATELY DOES NOT.
 * `histogramGlyph.ts` says why it stops short: *"The baseline is a derived guess
 * (the bar's foot isn't captured and needn't be at y=0), so drawing one would
 * assert something the data doesn't say."* For a Bar since v2.5 the opposite is
 * true - the origin is DECLARED by the user and the value is measured from it,
 * so drawing down to it is not an assertion, it is the measurement made
 * visible. David chose it: *"they all NEED (for bars) to come to the same common
 * axis."*
 *
 * ▶ WHY IT MATTERS BEYOND LOOKS. The far corner decides the number and the near
 * one does not, so a bar clicked short of the axis reads exactly like one drawn
 * to it - and the mark is the only thing that can show the difference. A bar
 * whose ink stops well above the drawn foot is a figure telling its user, at a
 * glance and without a sentence, that they may want a Span chart.
 *
 * ⚑ NOT FOR A STACK. A stacked segment sits on the one below it, not on the
 * figure's origin, so its value is its own height and a leg dropped to the
 * baseline would be a straight lie about what was measured.
 */

export interface Point2D {
  x: number;
  y: number;
}

export interface GlyphSegment {
  from: Point2D;
  to: Point2D;
}

/**
 * The bar between two captured corners, drawn as a staple standing ON the
 * origin: the span across the far corners, and a leg from each end down to the
 * baseline pixel.
 *
 * ⚑ OPEN AT THE BOTTOM, so the figure's own bar stays readable underneath and
 * the baseline is not drawn twice (the category axis already runs along it).
 * The same three-segment shape as `computeBinGlyph`, with the legs reaching the
 * origin rather than stopping at a fixed tick - one mark vocabulary, two
 * lengths, which is what makes the difference between them mean something.
 *
 * @param a,b the two captured corners, in image pixels.
 * @param baselineAtPixel the origin's pixel along the VALUE direction.
 * @param rotated the categories run down the side, so the value runs across and
 *        the staple lies on its side.
 */
export function computeBarGlyph(
  a: Point2D,
  b: Point2D,
  baselineAtPixel: number,
  rotated: boolean
): GlyphSegment[] {
  if (!Number.isFinite(baselineAtPixel)) return [];
  if (rotated) {
    // ⚑ The far end is the one further from the origin IN PIXELS here, which is
    // safe because both corners are read on the same axis: this is a drawing
    // question, not a reading one, and `compute` answers the reading in DATA
    // space where the sign lives.
    const far = Math.abs(a.x - baselineAtPixel) >= Math.abs(b.x - baselineAtPixel) ? a.x : b.x;
    return [
      { from: { x: far, y: a.y }, to: { x: far, y: b.y } },
      { from: { x: far, y: a.y }, to: { x: baselineAtPixel, y: a.y } },
      { from: { x: far, y: b.y }, to: { x: baselineAtPixel, y: b.y } },
    ];
  }
  const far = Math.abs(a.y - baselineAtPixel) >= Math.abs(b.y - baselineAtPixel) ? a.y : b.y;
  return [
    { from: { x: a.x, y: far }, to: { x: b.x, y: far } },
    { from: { x: a.x, y: far }, to: { x: a.x, y: baselineAtPixel } },
    { from: { x: b.x, y: far }, to: { x: b.x, y: baselineAtPixel } },
  ];
}
