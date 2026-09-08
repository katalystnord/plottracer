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
import {
  BOX_PLOT_AXES_CONFIG,
  CANDLESTICK_AXES_CONFIG,
  CANDLESTICK_SLOTS,
} from '../axesTypeConfigs.js';
import { calibratedHealthy } from './fixtures/anyType.js';

/** A calibrated candlestick session with ONE complete candle placed, in the
 *  order the card prompts for - BOTTOM-UP by position, as the box plot's walk
 *  is. Pixel y runs DOWN the figure, so ascending value is descending y. */
function oneCandle() {
  const session = calibratedHealthy('candlestick', CANDLESTICK_AXES_CONFIG);
  session.addDataPoint(300, 230); // the low
  session.addDataPoint(300, 200); // the lower body edge
  session.addDataPoint(300, 150); // the upper body edge
  session.addDataPoint(300, 120); // the high
  return session;
}

describe('capturing a candlestick', () => {
  it('takes four marks, named the way every generator names them', () => {
    const session = oneCandle();
    expect(session.getDataset().getSlotNames()).toEqual(['Low', 'Open', 'Close', 'High']);
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

  it('⚑⚑ reads as rising off a bottom-up walk, which is the provisional answer', () => {
    // ⚑ The two body edges are captured by POSITION, so the lower one lands in
    // `Open` and the candle reads as rising whatever the figure actually did.
    // That is not a bug: it is the only answer the GEOMETRY supports.
    expect(oneCandle().getCandlestickGlyphs()[0]!.rising).toBe(true);
  });

  it('⚑⚑ turns into a falling candle when the colour says so, moving no pixel', () => {
    const session = oneCandle();
    const before = session.getCandlestickGlyphs()[0]!;
    session.setCandleRising(0, false);
    const after = session.getCandlestickGlyphs()[0]!;
    expect(after.rising).toBe(false);
    // ⚠️ THE BODY IS IDENTICAL. A rising and a falling candle are the same
    // rectangle - which is exactly why colour has to carry the difference, and
    // why correcting the direction may not disturb a single measured pixel.
    expect(after.body).toEqual(before.body);
    expect(after.coherent).toBe(true);
  });

  it('leaves a candle alone when the colour agrees with the walk', () => {
    const session = oneCandle();
    session.setCandleRising(0, true);
    expect(session.getCandlestickGlyphs()[0]!.rising).toBe(true);
  });

  it('files its four values under the categories its own walk marked', () => {
    const table = oneCandle().getBarCategoryTable();
    expect(table.valueColumns).toEqual(['Low', 'Open', 'Close', 'High']);
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
    const [low, open, closeV, high] = cells as [number, number, number, number];
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

/**
 * ⚑⚑ THE WALK IS BOTTOM-UP, LIKE THE BOX PLOT'S (v2.5, 2026-09-08).
 *
 * David, having marked a candle bottom-up and got High below Low: *"I marked
 * them from the bottom up like we did for the box plot. Was that wrong?"* It was
 * not - `BOX_PLOT_SLOTS` is Min/Q1/Median/Q3/Max, strictly ascending, so the app
 * itself teaches bottom-up one type along. Candlestick's slots were OHLC, which
 * is not positional at all, and nothing on screen marked the difference.
 *
 * ▶ *"What ever happens, we need to be consistent with box plots."* So the slot
 * ORDER is now the capture order, ascending, and the two body edges are
 * provisionally Open-then-Close - correct for a RISING candle, swapped for a
 * falling one once the figure's colour says so.
 */
describe('the candlestick walk runs bottom-up, as the box plot does', () => {
  it('orders its slots by position, ascending, like BOX_PLOT_SLOTS', () => {
    expect(CANDLESTICK_SLOTS).toEqual(['Low', 'Open', 'Close', 'High']);
  });

  it('names each click by what is visible, not by a slot whose meaning depends on direction', () => {
    // ⚑ "Open" cannot tell a user where to click: on a falling candle it is the
    // TOP body edge. The capture label says the position, which is the same for
    // both directions - and it is the only thing on screen at click time.
    expect(CANDLESTICK_AXES_CONFIG.captureLabels).toEqual([
      'the low',
      'the lower body edge',
      'the upper body edge',
      'the high',
    ]);
  });
});

/**
 * ⚑⚑ WHAT THE SCREEN SAYS TO CLICK (gate 4).
 *
 * David's status line read `Open - new candle (0 of 4 filled)` while he was
 * being asked for the LOW. A prompt that names a slot whose meaning depends on
 * a direction nobody has established yet cannot aim a hand.
 */
describe('the candlestick prompt names a place on the figure', () => {
  it('asks for the low first, not for "Open"', () => {
    const session = calibratedHealthy('candlestick', CANDLESTICK_AXES_CONFIG);
    expect(session.getCurrentSlotLabel()).toBe('the low');
  });

  it('walks up the candle as the marks land', () => {
    const session = calibratedHealthy('candlestick', CANDLESTICK_AXES_CONFIG);
    const said: string[] = [];
    for (const y of [230, 200, 150]) {
      said.push(session.getCurrentSlotLabel());
      session.addDataPoint(300, y);
    }
    said.push(session.getCurrentSlotLabel());
    expect(said).toEqual(['the low', 'the lower body edge', 'the upper body edge', 'the high']);
  });

  it('leaves a box plot saying its own slot names, which already name places', () => {
    // ⚑ The guard is the point: `Median` IS an instruction, so a type without
    // capture labels must be untouched by this mechanism.
    const box = calibratedHealthy('boxplot', BOX_PLOT_AXES_CONFIG);
    expect(box.getCurrentSlotLabel()).toBe('Min');
  });
});

/**
 * ⚑⚑ THE WHOLE LOOP: a bottom-up walk, then the figure's own colour naming the
 * two body edges. This is the test that would have caught David's capture -
 * every candle reported High below Low, and no test went near the colour.
 */
describe('reading the candles’ direction off the figure', () => {
  /** Two candles on white paper: the first green (rose), the second red (fell).
   *  Both are drawn with the SAME geometry, which is the whole difficulty. */
  function twoCandles() {
    const width = 400;
    const height = 300;
    const src = new Uint8ClampedArray(width * height * 4).fill(255);
    const paint = (cx: number, rgb: [number, number, number]) => {
      for (let y = 150; y <= 200; y++) {
        for (let x = cx - 12; x <= cx + 12; x++) {
          const i = (y * width + x) * 4;
          src[i] = rgb[0];
          src[i + 1] = rgb[1];
          src[i + 2] = rgb[2];
        }
      }
    };
    paint(300, [0, 128, 0]);
    paint(340, [214, 39, 40]);
    const session = calibratedHealthy('candlestick', CANDLESTICK_AXES_CONFIG);
    for (const cx of [300, 340]) {
      session.addDataPoint(cx, 230); // the low
      session.addDataPoint(cx, 200); // the lower body edge
      session.addDataPoint(cx, 150); // the upper body edge
      session.addDataPoint(cx, 120); // the high
    }
    return { session, src, width, height };
  }

  it('names the green candle rising and the red one falling, from identical geometry', () => {
    const { session, src, width, height } = twoCandles();
    // ⚑ Before reading the figure both are provisionally rising - the only
    // answer the geometry supports, and why colour is not optional here.
    expect(session.getCandlestickGlyphs().map((g) => g.rising)).toEqual([true, true]);
    // ⚑ ONE change: the green candle already read as rising, so only the red one
    // had to be renamed. Counting CHANGES rather than candles is what keeps a
    // settled figure quiet.
    expect(session.readCandleDirections(src, width, height)).toBe(1);
    expect(session.getCandlestickGlyphs().map((g) => g.rising)).toEqual([true, false]);
  });

  it('⚑⚑ settles to nothing-to-do, which is what stops the app re-rendering for ever', () => {
    const { session, src, width, height } = twoCandles();
    expect(session.readCandleDirections(src, width, height)).toBe(1);
    expect(session.readCandleDirections(src, width, height)).toBe(0);
    expect(session.readCandleDirections(src, width, height)).toBe(0);
    expect(session.getCandlestickGlyphs().map((g) => g.rising)).toEqual([true, false]);
  });

  it('⚑ lets the user flip a figure whose convention we ranked backwards', () => {
    const { session, src, width, height } = twoCandles();
    session.readCandleDirections(src, width, height, true);
    expect(session.getCandlestickGlyphs().map((g) => g.rising)).toEqual([false, true]);
  });

  it('moves no measured pixel - only which name each edge answers to', () => {
    const { session, src, width, height } = twoCandles();
    const before = session.getCandlestickGlyphs().map((g) => g.body);
    session.readCandleDirections(src, width, height);
    expect(session.getCandlestickGlyphs().map((g) => g.body)).toEqual(before);
  });

  it('reads nothing on a dataset that is not a candlestick', () => {
    const { src, width, height } = twoCandles();
    const bar = calibratedHealthy('candlestick', CANDLESTICK_AXES_CONFIG);
    bar.setSlotNames(['Corner', 'Opposite corner']);
    bar.addDataPoint(300, 200);
    bar.addDataPoint(300, 120);
    expect(bar.readCandleDirections(src, width, height)).toBe(0);
  });
});
