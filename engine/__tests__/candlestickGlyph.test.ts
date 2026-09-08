/**
 * ⚑ The candlestick overlay - the glyph drawn after the four marks, which is
 * what makes the capture checkable by eye.
 */
import { describe, expect, it } from 'vitest';
import { computeCandlestickGlyph } from '../candlestickGlyph.js';

/** A vertical chart: value runs up the figure, so a SMALLER y is a HIGHER
 *  value. Open at y=200, close at y=150 is therefore a RISING period. */
const RISING = {
  open: { x: 100, y: 200 },
  high: { x: 100, y: 120 },
  low: { x: 100, y: 230 },
  close: { x: 100, y: 150 },
};

describe('the candlestick glyph', () => {
  it('spans the wick from low to high and the body from open to close', () => {
    const glyph = computeCandlestickGlyph(RISING, 'vertical');
    // ⚑ The claim is unchanged - the wick still reaches from the low to the
    // high - but it is now drawn as the figure draws it, two stubs with the
    // body between them, so the REACH is the union rather than one segment.
    const wickYs = glyph.segments
      .filter((s) => s.from.x === s.to.x && s.from.x === 100)
      .flatMap((s) => [s.from.y, s.to.y]);
    expect(Math.max(...wickYs)).toBe(230); // the low
    expect(Math.min(...wickYs)).toBe(120); // the high
    // The body's four corners lie between open and close and nowhere else.
    const ys = glyph.body.map((p) => p.y).sort((a, b) => a - b);
    expect(ys).toEqual([150, 150, 200, 200]);
  });

  it('reads direction off the record, so a wrongly ordered capture looks wrong', () => {
    expect(computeCandlestickGlyph(RISING, 'vertical').rising).toBe(true);
    // The same four marks with open and close swapped are the same BODY - which
    // is exactly why the fill has to carry the difference.
    const swapped = { ...RISING, open: RISING.close, close: RISING.open };
    const a = computeCandlestickGlyph(RISING, 'vertical');
    const b = computeCandlestickGlyph(swapped, 'vertical');
    expect(b.rising).toBe(false);
    expect(b.body).toEqual(a.body);
  });

  it('turns with the figure when the bars are horizontal', () => {
    // Rotated: value runs left to right, so a LARGER x is a higher value.
    const glyph = computeCandlestickGlyph(
      {
        open: { x: 200, y: 100 },
        high: { x: 280, y: 100 },
        low: { x: 170, y: 100 },
        close: { x: 250, y: 100 },
      },
      'horizontal'
    );
    const wickXs = glyph.segments
      .filter((s) => s.from.y === s.to.y && s.from.y === 100)
      .flatMap((s) => [s.from.x, s.to.x]);
    expect(Math.min(...wickXs)).toBe(170);
    expect(Math.max(...wickXs)).toBe(280);
    expect(glyph.rising).toBe(true);
    // The body is upright across the CATEGORY axis, which is pixel-y here.
    expect(new Set(glyph.body.map((p) => p.y)).size).toBe(2);
  });

  it('stands the candle on the average cross-position of its own marks', () => {
    // ⚑ A hand that wandered across the category still draws one upright candle.
    const glyph = computeCandlestickGlyph(
      {
        open: { x: 98, y: 200 },
        high: { x: 102, y: 120 },
        low: { x: 100, y: 230 },
        close: { x: 100, y: 150 },
      },
      'vertical'
    );
    expect(glyph.segments[0]!.from.x).toBe(100); // (98+102+100+100)/4
    expect(new Set(glyph.body.map((p) => p.x))).toEqual(new Set([88, 112]));
  });
});

/**
 * ⚑⚑ THE OVERLAY MUST READ AS A CANDLE, NOT AS A BOX (v2.5).
 *
 * David, driving the built app: *"I think we should make the candlestick
 * overlay actually look more like a candlestick graph representation, like we
 * did for the box-plot."* He was looking at a body outline with a line straight
 * through it, which is a box plot's box with a median, not a candle.
 *
 * ▶ The reference is the standard diagram he sent: a solid REAL BODY with a
 * WICK STUB above it and another below. So the wick is drawn as the figure
 * draws it - outside the body, on both sides.
 *
 * ⚠️ THE THROUGH-LINE WAS NOT DECORATION, and the case it caught is kept. Its
 * comment claimed a body mis-placed outside its own high/low range "shows the
 * wick sticking out of the wrong side". Two stubs would hide exactly that, so
 * an INCOHERENT candle keeps the through-line and says so in `coherent`.
 */
describe('the candlestick overlay reads as a candle', () => {
  it('draws the wick as a stub above and a stub below the body', () => {
    const glyph = computeCandlestickGlyph(RISING, 'vertical');
    const wicks = glyph.segments.filter((s) => s.from.x === s.to.x && s.from.x === 100);
    expect(wicks).toHaveLength(2);
    const spans = wicks.map((s) => [s.from.y, s.to.y].sort((a, b) => a - b)).sort((a, b) => a[0]! - b[0]!);
    // Body runs 150..200 in pixel y. Upper stub: high 120 up to the body's 150.
    expect(spans[0]).toEqual([120, 150]);
    // Lower stub: the body's 200 down to the low 230.
    expect(spans[1]).toEqual([200, 230]);
  });

  it('leaves no wick where an end sits on the body edge', () => {
    // A candle that closed at its high has no upper wick at all - the figure
    // draws none, so neither do we.
    const noUpper = { ...RISING, high: { x: 100, y: 150 } };
    const glyph = computeCandlestickGlyph(noUpper, 'vertical');
    const wicks = glyph.segments.filter((s) => s.from.x === s.to.x && s.from.x === 100);
    expect(wicks).toHaveLength(1);
  });

  it('says so, and draws the wick straight through, when the body escapes its own high/low', () => {
    // ⚑ THE CASE DAVID HIT: marked bottom-up, so low/close/open/high landed in
    // the Open/High/Low/Close slots and the record says High 24.15 < Low 25.06.
    // The body then spans the whole range and the wick is a stub inside it -
    // which must look WRONG rather than tidy.
    const impossible = {
      open: { x: 100, y: 230 }, // truly the low
      high: { x: 100, y: 200 },
      low: { x: 100, y: 150 },
      close: { x: 100, y: 120 }, // truly the high
    };
    const glyph = computeCandlestickGlyph(impossible, 'vertical');
    expect(glyph.coherent).toBe(false);
    const wicks = glyph.segments.filter((s) => s.from.x === s.to.x && s.from.x === 100);
    expect(wicks).toHaveLength(1);
    expect([wicks[0]!.from.y, wicks[0]!.to.y].sort((a, b) => a - b)).toEqual([150, 200]);
  });

  it('calls an ordinary candle coherent', () => {
    expect(computeCandlestickGlyph(RISING, 'vertical').coherent).toBe(true);
  });
});
