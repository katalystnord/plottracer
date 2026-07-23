import { describe, expect, it } from 'vitest';
import { parse, formatDateNumber } from '../dateConversion.js';

/**
 * The calibration-value date parser (`parse` -> `toJD`). A date typed as a
 * calibration endpoint sets the axis SCALE, so a silently-wrong parse is a
 * silently-wrong scale for the whole series — exactly the class Tenet 1 exists
 * to prevent.
 */
describe('parse — valid dates round-trip', () => {
  it('parses a real date to a serial that formats back', () => {
    const serial = parse('2021/07/02');
    expect(serial).not.toBeNull();
    expect(formatDateNumber(serial as number, 'yyyy/mm/dd')).toBe('2021/07/02');
  });

  it('returns null for a string with no date/time separator (not a date)', () => {
    expect(parse('2024')).toBeNull();
  });
});

describe('parse — an IMPOSSIBLE calendar date is rejected, not silently rolled over (A2)', () => {
  // The field-range checks (month 1-12, day 1-31) pass 2021/02/31, but
  // setUTCDate then rolls it into March. Without the validity check the parser
  // returned a serial for March 3 — a wrong axis anchor from a typo.
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
