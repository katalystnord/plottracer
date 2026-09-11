import { describe, expect, it } from 'vitest';
import {
  CalibrationSession,
  CANDLESTICK_AXES_CONFIG,
  type CalibratedAxes,
} from '../calibrationSession.js';

/**
 * ⚑⚑ THE SAMPLING WINDOW IS MEASURED OFF THE FIGURE, NOT TAKEN FROM THE GLYPH.
 *
 * The window's width used to be the OVERLAY's drawing constant, so the sampler
 * always read a 25px strip whatever the figure looked like. On any chart whose
 * candles are narrower than that, the strip's medoid is the PAPER: every candle
 * returns the same colour, the clusterer finds one appearance, and every candle
 * is filed rising.
 *
 * ⚠️ That is not a label. `setCandleRising` SWAPS TWO SLOTS in the record, so
 * exported Open and Close are exchanged on every falling candle, silently. And
 * the misread does not look like one: "every period rose" is a legitimate
 * reading of a legitimate figure, and the only correction on screen is a
 * one-per-figure checkbox that would make all of them falling, equally wrong.
 *
 * ⚠️ WHY THE EXISTING TESTS PASS. The painted-block fixture is a uniform
 * rectangle, so the window cannot be wrong inside it; the shipped figure has
 * ~50px bodies over 817px, far above the threshold. The 2026-09-09 mutation run
 * found the window untested and a real figure was added - but that fixture is
 * blind to DENSITY, not to colour. A dense chart is the ordinary case this
 * misses: a year of daily candles is hundreds across one plot box.
 */

/** Alternating green and red bodies at `pitch` px, each `bodyW` px wide, with a
 *  wick of its own colour, on white paper. Drawn the way a chart library draws
 *  one, so the sampler meets real neighbours rather than one lone block. */
function denseChart(pitch: number, bodyW: number, count = 8, firstRising = true) {
  const width = pitch * (count + 2);
  const height = 200;
  const src = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    src[i * 4] = 255;
    src[i * 4 + 1] = 255;
    src[i * 4 + 2] = 255;
    src[i * 4 + 3] = 255;
  }
  const paint = (x: number, y: number, rgb: [number, number, number]) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const i = (y * width + x) * 4;
    src[i] = rgb[0];
    src[i + 1] = rgb[1];
    src[i + 2] = rgb[2];
  };
  const centres: number[] = [];
  for (let c = 0; c < count; c++) {
    const cx = Math.round(pitch * (c + 1.5));
    centres.push(cx);
    const rising = firstRising ? c % 2 === 0 : c % 2 !== 0;
    const rgb: [number, number, number] = rising ? [0, 160, 0] : [200, 0, 0];
    // The wick, one pixel wide, in the candle's own colour.
    for (let y = 40; y <= 160; y++) paint(cx, y, rgb);
    // The body.
    const half = Math.floor(bodyW / 2);
    for (let y = 70; y <= 130; y++) {
      for (let x = cx - half; x <= cx + half; x++) paint(x, y, rgb);
    }
  }
  return { src, width, height, centres };
}

/** Walk a candlestick session over that chart, bottom-up per candle. */
function walk(chart: ReturnType<typeof denseChart>): CalibrationSession<CalibratedAxes> {
  const s = new CalibrationSession<CalibratedAxes>(CANDLESTICK_AXES_CONFIG as never);
  s.handleCalibrationClick(20, 180);
  s.confirmCalibrationValues(['0']);
  s.handleCalibrationClick(20, 20);
  s.confirmCalibrationValues(['100']);
  s.handleCalibrationClick(chart.centres[0]! - 10, 180);
  s.handleCalibrationClick(chart.centres[chart.centres.length - 1]! + 10, 180);
  s.confirmCalibrationValues([String(chart.centres.length)]);
  expect(s.runCalibration(), s.getCalibrationError() ?? 'no error').toBe(true);
  for (const cx of chart.centres) {
    s.addDataPoint(cx, 160); // low
    s.addDataPoint(cx, 130); // lower body edge
    s.addDataPoint(cx, 70); // upper body edge
    s.addDataPoint(cx, 40); // high
  }
  return s;
}

describe("a candle's direction on a figure whose candles are narrow", () => {
  it('⚑ the control: wide candles are read correctly, and both appearances are found', () => {
    const chart = denseChart(60, 40);
    const s = walk(chart);
    s.readCandleDirections(chart.src, chart.width, chart.height);
    const got = s.getCandlestickGlyphs().map((g) => g.rising);
    expect(new Set(got).size, 'both appearances found').toBe(2);
    expect(got).toEqual(chart.centres.map((_, i) => i % 2 === 0));
  });

  it('⚑⚑ a 14px pitch is read off the BODIES, not off the paper between them', () => {
    // Eight alternating candles, 9px bodies on a 14px pitch. The old 25px window
    // reached two neighbours either side and returned white for every one of
    // them, so all eight were filed rising and four had Open and Close swapped.
    const chart = denseChart(14, 9);
    const s = walk(chart);
    s.readCandleDirections(chart.src, chart.width, chart.height);
    const got = s.getCandlestickGlyphs().map((g) => g.rising);
    expect(new Set(got).size, 'the figure draws both appearances and so must the reading').toBe(2);
    expect(got).toEqual(chart.centres.map((_, i) => i % 2 === 0));
  });

  it('⚑ TWO candles at a wide pitch keep the glyph half-width, so nothing narrows needlessly', () => {
    // The window is measured from the figure's own spacing, and the glyph's
    // constant remains the CEILING: a roomy figure must sample exactly as much
    // as it always did, or this fix would trade one silent misread for another.
    // A falling first candle, because the walk's provisional answer is rising -
    // only a real reading off the body produces it.
    const chart = denseChart(120, 60, 2, false);
    const s = walk(chart);
    s.readCandleDirections(chart.src, chart.width, chart.height);
    expect(s.getCandlestickGlyphs().map((g) => g.rising)).toEqual([false, true]);
  });
});
