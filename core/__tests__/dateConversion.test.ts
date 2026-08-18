import { describe, expect, it } from 'vitest';
import { parse, formatDateNumber } from '../dateConversion.js';

/**
 * The calibration-value date parser (`parse` -> `toJD`). A date typed as a
 * calibration endpoint sets the axis SCALE, so a silently-wrong parse is a
 * silently-wrong scale for the whole series - exactly the class Tenet 1 exists
 * to prevent.
 */
describe('parse - valid dates round-trip', () => {
  it('parses a real date to a serial that formats back', () => {
    const serial = parse('2021/07/02');
    expect(serial).not.toBeNull();
    expect(formatDateNumber(serial as number, 'yyyy/mm/dd')).toBe('2021/07/02');
  });

  it('returns null for a string with no date/time separator (not a date)', () => {
    expect(parse('2024')).toBeNull();
  });
});

/**
 * ⚑ A NUMBER IS NEVER A DATE (2026-07-28).
 *
 * The "must contain / or :" guard was applied only when the input was a STRING,
 * so a number went straight to toJD - which stringifies it, finds no date part,
 * and reads the value as an HOUR OF TODAY. `parse(0)` returned a timestamp for
 * midnight today while `parse('0')` correctly returned null, and only values
 * 0..23 were affected because toJD rejects hour > 23. That is why 100 behaved
 * and 10 did not.
 *
 * It reached real data: WPD's BarAxes stores its calibration values as INTEGERS
 * (engine/__tests__/fixtures/wpd/wpd4.json) and core/plotData.ts passes them
 * straight through, and the .dig/StarryDigitizer importers hit it too until they
 * were made to pass text. A number carries no separator and so can never look
 * like a date; the guard simply has to apply whatever the type.
 */
describe('parse - a bare number is a number, not an hour of today', () => {
  it('returns null for every whole number, including the 0..23 hour range', () => {
    for (const n of [0, 1, 5, 10, 12, 23, 24, 100, -5]) {
      expect(parse(n)).toBeNull();
    }
  });

  it('treats a number and its string form identically', () => {
    for (const n of [0, 1, 10, 23]) {
      expect(parse(n)).toBe(parse(String(n)));
    }
  });

  it('returns null for a non-integer too', () => {
    expect(parse(0.5)).toBeNull();
    expect(parse(1.25)).toBeNull();
  });

  it('still parses genuine dates and times, which always carry a separator', () => {
    expect(parse('2021/07/02')).not.toBeNull();
    expect(parse('10:30')).not.toBeNull();
  });
});

describe('parse - an IMPOSSIBLE calendar date is rejected, not silently rolled over (A2)', () => {
  // The field-range checks (month 1-12, day 1-31) pass 2021/02/31, but
  // setUTCDate then rolls it into March. Without the validity check the parser
  // returned a serial for March 3 - a wrong axis anchor from a typo.
  it('rejects Feb 31 rather than returning March 3', () => {
    expect(parse('2021/02/31')).toBeNull();
  });

  it('rejects other impossible days (Apr 31, Feb 30)', () => {
    expect(parse('2021/04/31')).toBeNull();
    expect(parse('2021/02/30')).toBeNull();
  });

  it('still accepts the valid boundary days (Feb 28, Jan 31, a leap Feb 29)', () => {
    expect(parse('2021/02/28')).not.toBeNull();
    expect(parse('2021/01/31')).not.toBeNull();
    expect(parse('2020/02/29')).not.toBeNull(); // 2020 is a leap year
  });

  it('rejects a non-leap Feb 29', () => {
    expect(parse('2021/02/29')).toBeNull(); // 2021 is not a leap year -> would roll to Mar 1
  });
});
