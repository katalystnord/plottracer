/**
 * ⚑⚑ THE CANDLESTICK, DRIVEN THROUGH THE SESSION - four marks per candle, an
 * overlay drawn after, and the readings filed under the categories the same
 * walk marked.
 *
 * David, 2026-09-03: *"You make 4 marks per candlestick, and then get an overlay
 * drawn to show the end result... a candlestick always has 4 points. Like a box
 * plot always has 5."*
 */
import { describe, expect, it } from 'vitest';
import { CANDLESTICK_AXES_CONFIG } from '../axesTypeConfigs.js';
import { calibratedHealthy } from './fixtures/anyType.js';

/** A calibrated candlestick session with ONE complete candle placed, in the
 *  order the card prompts for: open, high, low, close. */
function oneCandle(close = 150) {
  const session = calibratedHealthy('candlestick', CANDLESTICK_AXES_CONFIG);
  session.addDataPoint(300, 200); // Open
  session.addDataPoint(300, 120); // High
  session.addDataPoint(300, 230); // Low
  session.addDataPoint(300, close); // Close
  return session;
}

describe('capturing a candlestick', () => {
  it('takes four marks, named the way every generator names them', () => {
    const session = oneCandle();
    expect(session.getDataset().getSlotNames()).toEqual(['Open', 'High', 'Low', 'Close']);
  });

  it('draws its overlay only once all four marks are placed', () => {
    const session = calibratedHealthy('candlestick', CANDLESTICK_AXES_CONFIG);
    session.addDataPoint(300, 200);
    session.addDataPoint(300, 120);
    session.addDataPoint(300, 230);
    // ⚑ Three of four: a body between two marks and a wick to nowhere would be
    // a picture of a reading nobody took.
    expect(session.getCandlestickGlyphs()).toHaveLength(0);
    session.addDataPoint(300, 150);
    expect(session.getCandlestickGlyphs()).toHaveLength(1);
  });

  it('⚑⚑ shows which way the period moved, so a wrong click order looks wrong', () => {
    // Closing at y=150 is ABOVE opening at y=200 on a vertical chart: rising.
    expect(oneCandle(150).getCandlestickGlyphs()[0]!.rising).toBe(true);
    // Closing at y=225 is below it: falling, and the overlay fills the body.
    expect(oneCandle(225).getCandlestickGlyphs()[0]!.rising).toBe(false);
  });

  it('files its four values under the categories its own walk marked', () => {
    const table = oneCandle().getBarCategoryTable();
    expect(table.valueColumns).toEqual(['Open', 'High', 'Low', 'Close']);
    // ⚑ Nothing is DERIVED - all four were measured off the pixels.
    expect(table.derivedColumnIndex).toBeNull();
    // ⚑ The candle sits in whichever band its pixels fall in, so the row is
    // found rather than assumed - the fixture's axis carries many categories.
    const cells = table.columns[0]?.cells.find((row) => row.some((v) => v !== null));
    expect(cells, 'the candle recorded no readings').toBeDefined();
    expect(cells).toHaveLength(4);
    // High is the largest reading and Low the smallest, which is what the
    // figure drew - and a check that the four are not filed in click order
    // regardless of what they mean.
    const [open, high, low, closeV] = cells as [number, number, number, number];
    expect(high).toBeGreaterThan(open);
    expect(high).toBeGreaterThan(closeV);
    expect(low).toBeLessThan(open);
    expect(low).toBeLessThan(closeV);
  });

  it('refuses error bars, because its wicks are data rather than doubt', () => {
    expect(CANDLESTICK_AXES_CONFIG.errorBarsRefusal).toMatch(/four measured values/);
  });

  it('draws no candles on a dataset that is not one', () => {
    // ⚑ Gated on the SLOT NAMES, never on `config.id` - the same inverse the box
    // plot's glyph uses, so a plain Bar series cannot draw candles.
    const bar = calibratedHealthy('candlestick', CANDLESTICK_AXES_CONFIG);
    bar.setSlotNames(['Corner', 'Opposite corner']);
    bar.addDataPoint(300, 200);
    bar.addDataPoint(300, 120);
    expect(bar.getCandlestickGlyphs()).toEqual([]);
  });
});
