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
    const [wick] = glyph.segments;
    expect(wick!.from.y).toBe(230); // the low
    expect(wick!.to.y).toBe(120); // the high
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
    const [wick] = glyph.segments;
    expect(wick!.from.x).toBe(170);
    expect(wick!.to.x).toBe(280);
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
