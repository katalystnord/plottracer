import { describe, expect, it } from 'vitest';
import {
  CalibrationSession,
  BOX_PLOT_AXES_CONFIG,
  CANDLESTICK_AXES_CONFIG,
  type CalibratedAxes,
} from '../calibrationSession.js';
import { walkCategoryAxis } from './helpers/categoryWalk.js';

/**
 * ⚑⚑ A SLOT'S NAME COMES FROM ITS VALUE, NOT FROM WHEN IT WAS CLICKED.
 *
 * The walk asks for marks in one direction, bottom of the figure upward, because
 * a prompt has to name a PLACE - on a falling candle "Open" is the top edge, so
 * the word would point the hand at the wrong mark half the time. That is right
 * and it stays.
 *
 * What was wrong is that the NAMES were then handed out in the same order. On a
 * value axis that increases downward - depth, pressure, astronomical magnitude,
 * all ordinary figures - the first click is the LARGEST value, so a box plot
 * recorded `Min 190, Max 40` and a candlestick put High below Low. The five
 * numbers were right; the labels on them were reversed.
 *
 * ⚑ Span and bar were already correct, because span orders its ends BY VALUE.
 * This is that mechanism applied to the two types that did not have it, not a
 * new one.
 *
 * ⚑ The candlestick keeps its colour read untouched: Low and High are the outer
 * two BY VALUE, and which of the inner two is Open is the DIRECTION, which no
 * ordering can know. Sorting all four would erase the thing the colour is read
 * to find out.
 */
describe('slots are named by value, on an axis that increases downward', () => {
  /** A depth-style axis: `bottom` at the bottom of the figure, `top` at the top. */
  function sessionOn(config: unknown, bottom: string, top: string): CalibrationSession<CalibratedAxes> {
    const s = new CalibrationSession(config as never) as CalibrationSession<CalibratedAxes>;
    const any = s as unknown as {
      handleCalibrationClick(x: number, y: number): unknown;
      confirmCalibrationValues(v: string[]): unknown;
      runCalibration(): boolean;
      getCalibrationError(): string | null;
    };
    any.handleCalibrationClick(300, 500);
    any.confirmCalibrationValues([bottom]);
    any.handleCalibrationClick(300, 100);
    any.confirmCalibrationValues([top]);
    walkCategoryAxis(s as never);
    expect(any.runCalibration(), any.getCalibrationError() ?? 'no error').toBe(true);
    return s;
  }

  /** Click the marks bottom-up, the way the prompts ask. */
  function clickUpward(s: CalibrationSession<CalibratedAxes>, ys: number[]): void {
    const any = s as unknown as { addDataPoint(x: number, y: number): unknown };
    for (const y of ys) any.addDataPoint(150, y);
  }

  function reading(s: CalibrationSession<CalibratedAxes>): Record<string, number | null> {
    const any = s as unknown as {
      getValueColumns(): string[];
      getTupleRows(): { cells: (number | null)[] }[];
    };
    const names = any.getValueColumns();
    const cells = any.getTupleRows()[0]!.cells;
    return Object.fromEntries(names.map((n, i) => [n, cells[i] ?? null]));
  }

  it('⚑ a box plot on an ORDINARY axis is unchanged (the control)', () => {
    const s = sessionOn(BOX_PLOT_AXES_CONFIG, '0', '10');
    clickUpward(s, [460, 380, 300, 220, 140]);
    const r = reading(s);
    expect(r['Min']).toBeCloseTo(1, 6);
    expect(r['Max']).toBeCloseTo(9, 6);
    expect(r['Median']).toBeCloseTo(5, 6);
  });

  it('⚑⚑ a box plot on a DOWNWARD axis puts the smallest value in Min', () => {
    // 200 at the bottom of the figure, 0 at the top: a depth profile.
    const s = sessionOn(BOX_PLOT_AXES_CONFIG, '200', '0');
    clickUpward(s, [460, 380, 300, 220, 140]);
    const r = reading(s);
    expect(r['Min']!, 'Min holds the smallest value').toBeLessThan(r['Max']!);
    expect(r['Min']).toBeCloseTo(20, 6);
    expect(r['Q1']).toBeCloseTo(60, 6);
    expect(r['Median']).toBeCloseTo(100, 6);
    expect(r['Q3']).toBeCloseTo(140, 6);
    expect(r['Max']).toBeCloseTo(180, 6);
  });

  it('⚑⚑ a candlestick on a DOWNWARD axis keeps High above Low', () => {
    const s = sessionOn(CANDLESTICK_AXES_CONFIG, '200', '0');
    clickUpward(s, [460, 380, 220, 140]);
    const r = reading(s);
    expect(r['High']!, 'High is above Low').toBeGreaterThan(r['Low']!);
    expect(r['Low']).toBeCloseTo(20, 6);
    expect(r['High']).toBeCloseTo(180, 6);
    // Open and Close are the inner pair; the colour decides which is which, and
    // with no colour read they keep the walk's provisional rising order.
    expect(Math.min(r['Open']!, r['Close']!)).toBeCloseTo(60, 6);
    expect(Math.max(r['Open']!, r['Close']!)).toBeCloseTo(140, 6);
  });
});
