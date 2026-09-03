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
 * ⚠️ THE DIRECTION IS MEASURED FROM THE RECORD, never sampled from the figure's
 * colour. The prompt order captures it: the user can SEE which edge is the open
 * and says so by clicking it first. A colour test would have to choose between
 * two live conventions and would be wrong half the time.
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
 * ⚑ The wick is ONE line through the body rather than two stubs. It is what the
 * figure draws, and it means a body that has been mis-placed OUTSIDE its own
 * high/low range shows the wick sticking out of the wrong side, which is exactly
 * the mistake worth seeing.
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

  const segments: BoxPlotGlyphSegment[] = [
    // The wick, low to high, through the body.
    { from: toXY(vc.low.v, cross), to: toXY(vc.high.v, cross) },
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

  return { segments, body, rising };
}
