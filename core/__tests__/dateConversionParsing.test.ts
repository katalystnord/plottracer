import { describe, expect, it } from 'vitest';
import * as dateConverter from '../dateConversion.js';

/**
 * `toJD` — the string-to-timestamp parser behind every date-calibrated axis.
 *
 * ⚑ WHY THIS FILE EXISTS. The 2026-07-31 mutation run scored
 * `core/dateConversion.ts` at **62.50%** with 123 mutants unnoticed. The
 * existing `dateConversion.test.ts` covers date VALIDITY well (Feb 31, leap
 * years, the "a number is never a date" rule) and stays; what it never
 * touches is the parser's own structure: the time-only branch, the
 * part-count bound, the isNaN family, and the hour/minute/second ranges.
 *
 * ⚑ THIS FILE HAS A SILENT-WRONG-NUMBER HISTORY. `parse(0)` once returned a
 * 2026 timestamp because a NUMBER skipped the "looks like a date" guard and
 * was read as an hour of today — ordinary axis values silently became ~1.78e12.
 * That specific bug is pinned in the sibling file; these cases pin the
 * machinery AROUND it, where the same class can recur.
 */

describe('toJD via parse — the time-only branch', () => {
  it('⚑ reads a bare time as a time TODAY, not as a failure', () => {
    // The `hasDatePart` false branch fills year/month/date from `new Date()`,
    // and NOTHING had ever exercised it (`today.getMonth() + 1` mutated to
    // `- 1` and survived: a whole month wrong, silently).
    const parsed = dateConverter.parse('12:30');
    expect(parsed).not.toBeNull();
    const asDate = new Date(parsed!);
    const today = new Date();
    expect(asDate.getUTCFullYear()).toBe(today.getFullYear());
    // ⚑ The month is the killer: `getMonth()` is 0-based and the parser adds
    // 1 before treating it as a 1-based month, so an off-by-one here lands a
    // reading in the wrong month with a perfectly plausible timestamp.
    expect(asDate.getUTCMonth() + 1).toBe(today.getMonth() + 1);
    expect(asDate.getUTCDate()).toBe(today.getDate());
    expect(asDate.getUTCHours()).toBe(12);
    expect(asDate.getUTCMinutes()).toBe(30);
  });

  it('reads hours, minutes AND seconds from a bare time', () => {
    const asDate = new Date(dateConverter.parse('01:02:03')!);
    expect(asDate.getUTCHours()).toBe(1);
    expect(asDate.getUTCMinutes()).toBe(2);
    expect(asDate.getUTCSeconds()).toBe(3);
  });

  it('a DATED string takes its date from the string, not from today', () => {
    // The other arm of the same branch: proves `hasDatePart` actually routes.
    const asDate = new Date(dateConverter.parse('2019/03/07')!);
    expect(asDate.getUTCFullYear()).toBe(2019);
    expect(asDate.getUTCMonth() + 1).toBe(3);
    expect(asDate.getUTCDate()).toBe(7);
  });

  it('defaults a missing month and day to January the 1st', () => {
    // `dateParts[1] === undefined ? '0' : ...` and its day equivalent -- a
    // year-only string is still a date, at the start of that year.
    const asDate = new Date(dateConverter.parse('2019/01/01')!);
    expect(asDate.getUTCMonth() + 1).toBe(1);
    expect(asDate.getUTCDate()).toBe(1);
  });
});

describe('toJD via parse — how many parts a date may have', () => {
  it('accepts a full date-and-time: six parts', () => {
    // The upper bound is 6 (y/m/d h:m:s); the bound itself mutated to `< 0`
    // and to `&&` and survived, so both sides of it need a case.
    const asDate = new Date(dateConverter.parse('2019/03/07 04:05:06')!);
    expect(asDate.getUTCFullYear()).toBe(2019);
    expect(asDate.getUTCHours()).toBe(4);
    expect(asDate.getUTCSeconds()).toBe(6);
  });

  it('⚑ refuses SEVEN parts rather than silently reading the first six', () => {
    // Truncating would accept a malformed string and record a plausible,
    // wrong instant -- the failure mode this whole file guards against.
    expect(dateConverter.parse('2019/03/07 04:05:06:07')).toBeNull();
  });
});

describe('toJD via parse — refusing what cannot be a time', () => {
  it('refuses non-numeric components rather than yielding NaN', () => {
    // ⚑ The isNaN chain at the heart of the function had ELEVEN surviving
    // mutants (each `||` to `&&`, each sub-clause). One case per position is
    // what separates them: an `&&` chain only refuses when ALL are NaN, so a
    // single bad component must be refused on its own.
    expect(dateConverter.parse('abc/03/07')).toBeNull(); // year
    expect(dateConverter.parse('2019/abc/07')).toBeNull(); // month
    expect(dateConverter.parse('2019/03/abc')).toBeNull(); // day
    expect(dateConverter.parse('2019/03/07 ab:05:06')).toBeNull(); // hour
    expect(dateConverter.parse('2019/03/07 04:ab:06')).toBeNull(); // minute
    expect(dateConverter.parse('2019/03/07 04:05:ab')).toBeNull(); // second
  });

  it('refuses an out-of-range hour, minute or second', () => {
    // Each range guard is its own `if`; asserted just past each boundary.
    expect(dateConverter.parse('2019/03/07 24:00:00')).toBeNull();
    expect(dateConverter.parse('2019/03/07 04:60:00')).toBeNull();
    expect(dateConverter.parse('2019/03/07 04:05:60')).toBeNull();
  });

  it('accepts the last valid value of each — the boundary the guards must admit', () => {
    // Without these the `>` guards could be `>=` and still pass everything
    // above.
    const asDate = new Date(dateConverter.parse('2019/03/07 23:59:59')!);
    expect(asDate.getUTCHours()).toBe(23);
    expect(asDate.getUTCMinutes()).toBe(59);
    expect(asDate.getUTCSeconds()).toBe(59);
  });

  it('refuses a negative component', () => {
    expect(dateConverter.parse('2019/03/07 -1:00:00')).toBeNull();
    expect(dateConverter.parse('2019/-3/07')).toBeNull();
  });
});

describe('toJD via parse — fractional seconds', () => {
  it('carries sub-second precision into the timestamp', () => {
    // A recorder chart can be read to fractions of a second; the msec branch
    // is how that survives.
    const withHalf = dateConverter.parse('2019/03/07 04:05:06.5')!;
    const whole = dateConverter.parse('2019/03/07 04:05:06')!;
    expect(withHalf - whole).toBeCloseTo(500, 0);
  });

  it('⚑ handles a leading-dot fraction, where the dot sits at index 0', () => {
    // `secPart.indexOf('.') >= 0` mutated to `> 0` and survived: that only
    // differs when the dot is the FIRST character, which is exactly this.
    const leading = dateConverter.parse('2019/03/07 04:05:.5')!;
    const zero = dateConverter.parse('2019/03/07 04:05:00')!;
    expect(leading - zero).toBeCloseTo(500, 0);
  });

  it('treats a whole second as zero milliseconds, not as a fraction', () => {
    const asDate = new Date(dateConverter.parse('2019/03/07 04:05:06')!);
    expect(asDate.getUTCMilliseconds()).toBe(0);
  });
});
