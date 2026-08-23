import { describe, expect, it } from 'vitest';
import { barInterval } from '../barInterval.js';

/**
 * THE ONE MEASUREMENT FOUR FINDINGS NEEDED (v2.3) - does a captured bar's near
 * end SIT on the baseline, within the figure's own resolution?
 *
 * ⚑ Named for the CASES a reader of a bar chart would recognise, not for the
 * function's branches: the whole point of the fix is that the old discriminator
 * ("was a baseline DECLARED") answered a question nobody was asking.
 */
describe('does this bar sit on the baseline?', () => {
  const RES = 0.05; // half a pixel, in data units, for these figures

  it('an ordinary bar drawn UP from zero sits on it', () => {
    const b = barInterval(0.01, 12, 0, RES)!;
    expect(b.onBaseline).toBe(true);
    expect(b.near).toBe(0.01);
    expect(b.far).toBe(12);
  });

  it('⚑⚑ and one drawn DOWN from zero sits on it too, keeping its sign', () => {
    // The wrinkle that makes "always use the span" wrong: this bar's value is
    // -20, and its span is 20 with the sign thrown away.
    const b = barInterval(-20, -0.02, 0, RES)!;
    expect(b.onBaseline).toBe(true);
    expect(b.far).toBe(-20);
    expect(b.far - 0).toBe(-20);
  });

  it('⚑⚑ a FLOATING bar does not, even though a baseline was declared', () => {
    // `samples/bar-floating-temperature`: baseline 0, January runs -8..2 and
    // April 3..15. The old rule asked whether a baseline existed and reported
    // -7.95 for one and 15 for the other, under one heading.
    expect(barInterval(-8, 2, 0, RES)!.onBaseline).toBe(false);
    expect(barInterval(3, 15, 0, RES)!.onBaseline).toBe(false);
  });

  it('reads the ends as an INTERVAL, whichever corner was dragged first', () => {
    const a = barInterval(15, 3, 0, RES)!;
    const b = barInterval(3, 15, 0, RES)!;
    expect([a.min, a.max]).toEqual([3, 15]);
    expect([b.min, b.max]).toEqual([3, 15]);
  });

  it('⚑ the near end is the nearer IN VALUE, never the smaller pixel', () => {
    // A bar below the baseline has its near end at the LARGER y on an ordinary
    // vertical figure; `pixelToData` has already encoded that, so comparing
    // values needs no reversal and a pixel rule would be exactly backwards.
    const b = barInterval(-12, -1, 0, RES)!;
    expect(b.near).toBe(-1);
    expect(b.far).toBe(-12);
  });

  it('⚑ a baseline that is not zero is measured against just the same', () => {
    expect(barInterval(100.01, 140, 100, RES)!.onBaseline).toBe(true);
    expect(barInterval(110, 140, 100, RES)!.onBaseline).toBe(false);
  });

  it('⚑ WITHIN RESOLUTION, not exactly equal - the ends come off pixels', () => {
    expect(barInterval(0.04, 9, 0, RES)!.onBaseline).toBe(true);
    expect(barInterval(0.06, 9, 0, RES)!.onBaseline).toBe(false);
  });

  it('⚑ an unanswerable measurement is NOT a positive one', () => {
    // A degenerate calibration cannot say whether the bar touches anything, and
    // "we could not tell" must never read as "yes".
    expect(barInterval(0, 9, 0, NaN)!.onBaseline).toBe(false);
    expect(barInterval(0, 9, 0, 0)!.onBaseline).toBe(false);
    expect(barInterval(0, 9, 0, -1)!.onBaseline).toBe(false);
  });

  it('refuses a bar whose ends are not numbers', () => {
    expect(barInterval(NaN, 9, 0, RES)).toBeNull();
    expect(barInterval(0, Infinity, 0, RES)).toBeNull();
    expect(barInterval(0, 9, NaN, RES)).toBeNull();
  });
});
