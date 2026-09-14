/**
 * ⚑⚑ A SPLIT FIGURE DECLARES THE TYPE ITS SERIES ACTUALLY IS.
 *
 * ⚠️ David, driving the built app on 2026-09-14, split a layered project and
 * found figure 2 holding `Min, Q1, Median, Q3, Max` under a toolbar reading
 * "Bar", with a BAR's advisory about bars that do not reach the baseline. The
 * split moved the data and not the declaration.
 *
 * ⚑ Written as the case the e2e should have carried: given a group of series
 * whose slots are a box plot's, the figure says Box Plot.
 */
import { describe, expect, it } from 'vitest';
import { typeForSlots } from '../layeredSeries.js';
import {
  BOX_PLOT_SLOTS,
  CANDLESTICK_SLOTS,
  OPPOSITE_CORNER_SLOTS,
  PIE_SECTOR_SLOTS,
  ALL_AXES_TYPE_CONFIGS,
} from '../axesTypeConfigs.js';

const TYPES = ALL_AXES_TYPE_CONFIGS.map((c) => ({
  id: c.id,
  axesKind: c.axesKind,
  ...(c.defaultSlots ? { defaultSlots: c.defaultSlots } : {}),
}));
const BAR = TYPES.find((t) => t.id === 'bar')!;

describe('the type a split figure declares', () => {
  it('⚑⚑ a box plot’s slots make it a Box Plot, not the document’s Bar', () => {
    expect(typeForSlots(BOX_PLOT_SLOTS, TYPES, BAR)).toBe('boxplot');
  });

  it('a candlestick’s four make it a Candlestick', () => {
    expect(typeForSlots(CANDLESTICK_SLOTS, TYPES, BAR)).toBe('candlestick');
  });

  it('⚠️ two corners name Bar AND Span, so it changes nothing', () => {
    // The same boundary the offer has: those slots identify neither type, and
    // guessing between them would be a judgement the record does not support.
    expect(typeForSlots(OPPOSITE_CORNER_SLOTS, TYPES, BAR)).toBe('bar');
  });

  it('⚠️ a type of another axes kind cannot take the figure over', () => {
    // A pie's slots against a bar-calibrated figure: the axes would not fit.
    expect(typeForSlots(PIE_SECTOR_SLOTS, TYPES, BAR)).toBe('bar');
  });

  it('slots nothing declares leave the document’s type alone', () => {
    expect(typeForSlots(['Wat', 'Ever'], TYPES, BAR)).toBe('bar');
  });
});
