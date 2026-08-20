/**
 * ⚑⚑ F23 - WHAT A VALUE EDITOR OPENS WITH.
 *
 * The audit's reuse pass found one job with three implementations, and one of
 * them destroyed data: `value.toFixed(3)` seeded the XY table, the spider table
 * and the canvas context menu, under a comment claiming the heatmap's rule had
 * been adopted. `EditableValue` commits on blur and `commitDataPointEdit`
 * accepts any finite parse, so double-clicking a y of 0.00042 and clicking away
 * moved the point to 0.
 *
 * These assert the RULE. Its companion - that an editor opened and closed
 * commits nothing at all - is asserted where it lives, in the e2e walk.
 */
import { describe, it, expect } from 'vitest';
import { editSeed, fmtValue } from '../format.js';

describe('a value editor opens with the whole number', () => {
  it('⚑⚑ a small value survives being looked at', () => {
    expect(editSeed(0.00042)).toBe('0.00042');
    expect(Number(editSeed(0.00042))).toBe(0.00042);
  });

  it('⚑⚑ so does one the display had to write in scientific notation', () => {
    expect(Number(editSeed(2.5e-7))).toBe(2.5e-7);
  });

  it('⚑ and one with more digits than the display shows', () => {
    expect(fmtValue(98.7654321)).toBe('98.7654'); // what the table shows
    expect(editSeed(98.7654321)).toBe('98.7654321'); // what the editor opens with
  });

  it('⚑ an unread value opens EMPTY, never as a number nobody measured', () => {
    expect(editSeed(null)).toBe('');
    expect(editSeed(undefined)).toBe('');
    expect(editSeed(Number.NaN)).toBe('');
  });

  it('⚑ every seed it produces parses back to the value it was given', () => {
    for (const v of [0, -0.5, 1e-9, 1234.5678, -98.7654321, 1e21, Number.MIN_VALUE]) {
      expect(Number(editSeed(v))).toBe(v);
    }
  });
});
