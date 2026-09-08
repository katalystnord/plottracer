/**
 * ⚑⚑ PURE GEOMETRY FOR THE CANDLESTICK GLYPH (v2.5) - the overlay drawn AFTER
 * the four marks, exactly as the box plot's is.
 *
 * David, 2026-09-03: *"We need to break out candlestick charts, and make them
 * their own group, and we make the workflow exactly patterned on box-plots. You
 * make 4 marks per candlestick, and then get an overlay drawn to show the end
 * result... a candlestick always has 4 points. Like a box plot always has 5."*
 *
 * ⚑ THE SAME (value, cross) TRICK `boxPlotGlyph.ts` USES, and for the same
 * reason: one implementation covers both Bar orientations. A rotated candlestick
 * chart is unusual but the axes option exists, and a glyph that ignored it would
 * draw across the figure rather than along it.
 *
 * ⚑⚑ DIRECTION IS DRAWN, NOT JUST RECORDED, and that is what makes the overlay a
 * CHECK rather than a decoration. Open and close are both body edges, so a user
 * who clicked them in the wrong order gets an IDENTICAL body - the mistake would
 * be invisible in a segments-only glyph. Filling a falling candle is the
 * figure's own convention (Investopedia's diagram uses filled/hollow; modern
 * platforms use red/green, and both are live), so a wrong order now looks wrong.
 *
 * ⚠️⚑⚑ THE "NEVER SAMPLE THE COLOUR" RULE HERE WAS OVERTURNED, 2026-09-08, and
 * the paragraph it replaces is why this note exists. It said direction was
 * measured from the RECORD via the prompt order, and that a colour test "would
 * have to choose between two live conventions and would be wrong half the
 * time."
 *
 * ▶ David, driving the built app: *"Is it not dependant on the color?"* It is.
 * The two body edges are geometrically INDISTINGUISHABLE, so colour is the only
 * signal the figure carries - confirmed against the trading source he sent:
 * *"The color itself serves as the primary indicator of whether price moved
 * upward or downward."*
 *
 * ⚑ The old objection was against ASSUMING a convention, not against MEASURING
 * one - and it does not even need resolving: a figure has exactly TWO body
 * appearances, so they CLUSTER, and one declaration per figure says which
 * cluster rises. What the prompt order really did was make the USER be the
 * colour-reader, at the cost of the bottom-up consistency the box plot teaches
 * one type along. See `project_candlestick_and_span_error_taxonomy`.
 *
 * ⛔ `rising` below is still read off the record; the capture change that feeds
 * it from the figure is the next step, not this one.
 */
import type { BoxPlotGlyphSegment, BoxPlotOrientation, Point2D } from './boxPlotGlyph.js';

/** Pixel positions of a completed candlestick tuple's 4 points, one per
 *  Open/High/Low/Close slot in that order. */
export interface CandlestickPoints {
  open: Point2D;
  high: Point2D;
  low: Point2D;
  close: Point2D;
}

export interface CandlestickGlyph {
  /** The wick and the body's outline - drawn as plain lines, like every other
   *  glyph in the app. */
  segments: BoxPlotGlyphSegment[];
  /** The body's four corners in draw order, so a falling candle can be filled.
   *  Always present; whether it is painted is `rising`'s business. */
  body: Point2D[];
  /**
   * Does the body lie INSIDE the low..high range, as a real candle's must?
   *
   * ⚑⚑ FALSE IS A RECORD THAT CANNOT BE A CANDLE - High below Low, or a body
   * edge outside both. We REPORT it and draw it loudly; we never refuse it or
   * repair it. The generator sweep found nobody validates ordering either.
   */
  coherent: boolean;
  /**
   * Did the period CLOSE ABOVE where it OPENED?
   *
   * ⚑ Measured off the two recorded values, in the axes' own value direction -
   * not off pixel Y, which is upside down, and not off the figure's colours.
   */
  rising: boolean;
}

/** Half-width of the candle's body, in image pixels. ⚑ Narrower than the box
 *  plot's 20: a candlestick chart packs many more periods across the same
 *  figure, and a body as wide as a box would overlap its neighbours. */
const BODY_HALF = 12;

/**
 * The wick, the body outline, and which way the period moved.
 *
 * ⚑ THE BODY SPANS OPEN TO CLOSE AND THE WICK SPANS LOW TO HIGH - the whole
 * definition, and it needs no ordering assumption: the body is drawn between
 * whichever of open/close is further along the value axis, so a rising and a
 * falling candle are the same geometry with `rising` flipped.
 *
 * ⚑⚑ THE WICK IS TWO STUBS, one above the body and one below - the standard
 * diagram's shape, and what makes this read as a candle. ⚠️ It used to be ONE
 * line drawn straight THROUGH the body, justified as showing a body mis-placed
 * outside its own high/low range. That case is real and is kept: an INCOHERENT
 * candle reverts to the through-line and reports `coherent: false`. What the
 * through-line cost was every CORRECT candle, which looked like a box plot.
 */
export function computeCandlestickGlyph(
  points: CandlestickPoints,
  orientation: BoxPlotOrientation
): CandlestickGlyph {
  const isVertical = orientation === 'vertical';
  const toVC = (p: Point2D) => (isVertical ? { v: p.y, c: p.x } : { v: p.x, c: p.y });
  const toXY = (v: number, c: number): Point2D => (isVertical ? { x: c, y: v } : { x: v, y: c });

  const vc = {
    open: toVC(points.open),
    high: toVC(points.high),
    low: toVC(points.low),
    close: toVC(points.close),
  };

  // ⚑ The candle sits on the cross-position of its own marks, averaged, so a
  // hand that wandered a pixel or two across the category still draws one
  // upright candle rather than a leaning one.
  const cross = (vc.open.c + vc.high.c + vc.low.c + vc.close.c) / 4;
  const left = cross - BODY_HALF;
  const right = cross + BODY_HALF;

  const bodyNear = Math.min(vc.open.v, vc.close.v);
  const bodyFar = Math.max(vc.open.v, vc.close.v);

  const body: Point2D[] = [
    toXY(bodyNear, left),
    toXY(bodyNear, right),
    toXY(bodyFar, right),
    toXY(bodyFar, left),
  ];

  // ⚑⚑ THE WICK IS TWO STUBS, ABOVE AND BELOW THE BODY - what the figure
  // draws, and what makes the overlay read as a candle rather than as a box
  // with a median line through it. Measured in v-space with min/max so it needs
  // no assumption about which of low/high sits at the smaller pixel value; a
  // rotated chart falls out of the same arithmetic.
  const wickNear = Math.min(vc.low.v, vc.high.v);
  const wickFar = Math.max(vc.low.v, vc.high.v);

  // ⚠️ A BODY OUTSIDE ITS OWN WICK IS AN IMPOSSIBLE CANDLE, and it is exactly
  // what a bottom-up capture produces when the slots are filled in OHLC order.
  // Two stubs would draw that tidily - the offending wick hidden INSIDE the
  // body - so the incoherent case keeps the single line straight through, which
  // is the one drawing that cannot be mistaken for a correct candle.
  const coherent = wickNear <= bodyNear && bodyFar <= wickFar;

  const wick: BoxPlotGlyphSegment[] = coherent
    ? [
        { from: toXY(wickNear, cross), to: toXY(bodyNear, cross) },
        { from: toXY(bodyFar, cross), to: toXY(wickFar, cross) },
      ]
        // ⚑ A candle that opened at its low or closed at its high draws no wick
        // on that side. The figure draws none, so neither do we.
        .filter((s) => s.from.x !== s.to.x || s.from.y !== s.to.y)
    : [{ from: toXY(wickNear, cross), to: toXY(wickFar, cross) }];

  const segments: BoxPlotGlyphSegment[] = [
    ...wick,
    // The body's four sides.
    { from: body[0]!, to: body[1]! },
    { from: body[1]!, to: body[2]! },
    { from: body[2]!, to: body[3]! },
    { from: body[3]!, to: body[0]! },
  ];

  // ⚑ On a VERTICAL chart the value axis runs UP the figure while pixel-y runs
  // DOWN it, so a rising candle is the one whose close sits at a SMALLER y. On a
  // rotated chart the value runs left to right and the comparison flips.
  const rising = isVertical ? vc.close.v < vc.open.v : vc.close.v > vc.open.v;

  return { segments, body, rising, coherent };
}
