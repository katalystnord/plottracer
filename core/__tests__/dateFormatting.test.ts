import { describe, expect, it } from 'vitest';
import { parse, formatDateNumber, getFormatString } from '../dateConversion.js';

/**
 * Formatting and format-detection for dates.
 *
 * ⚑ WHY THIS FILE EXISTS. `core/dateConversion.ts` is a faithful port of
 * wpd-core's `core/dateConverter.js`, and mutation testing put it at 45.4% with
 * **151 surviving mutants** - the worst survivor count in `core/`. The reason is
 * visible in our own suite: every case in `dateConversion.test.ts` exercises
 * `parse()` (the number-vs-string guard and calendar validity), and NOTHING
 * exercises `formatDateNumber` or `getFormatString`. Those two are token
 * substitution over yyyy/mm/mmm/mmmm/dd/hh/ii/ss/frac - many branches, no
 * assertions. We ported the maths and left its verification upstream.
 *
 * The cases below are ADAPTED FROM WebPlotDigitizer's own `tests/date_tests.js`
 * (Copyright (C) 2025 Ankit Rohatgi, AGPL-3.0 - the same licence as this
 * project, which is what makes porting them legitimate; contrast Engauge, whose
 * GPL-2.0 forces clean-room). Their API and ours match exactly: `parse`,
 * `formatDateNumber(n, fmt)`, `getFormatString(s)`.
 *
 * Deliberately NOT ported: their "Parse array" and metadata round-trip cases,
 * which our inputParserGuards/plotData suites already cover.
 */

describe('getFormatString - inferring a format from what the user typed', () => {
  // The rule is positional, not semantic: it counts separator-delimited parts
  // and switches on whether a '/' is present at all. That makes the boundary
  // between "date-ish" and "time-ish" input the interesting thing to pin.
  it('grows the format one field at a time as more parts are typed', () => {
    expect(getFormatString('2017/10')).toBe('yyyy/mm');
    expect(getFormatString('2017/10/12')).toBe('yyyy/mm/dd');
    expect(getFormatString('2017/10/12 12')).toBe('yyyy/mm/dd hh');
    expect(getFormatString('2017/10/12 12:10')).toBe('yyyy/mm/dd hh:ii');
    expect(getFormatString('2017/10/12 12:10:45')).toBe('yyyy/mm/dd hh:ii:ss');
  });

  it('ignores a fractional second - seconds are the finest field it names', () => {
    // The extra ".66" does not become a sixth part; the format stops at ss.
    expect(getFormatString('2017/10/12 12:10:45.66')).toBe('yyyy/mm/dd hh:ii:ss');
  });
});

describe('formatDateNumber - every token, against one known instant', () => {
  // 2017/10/12 05:11:55.41. One parse, many renderings: if the serial were
  // wrong every assertion would move together, so these pin the FORMATTING.
  const val = parse('2017/10/12 5:11:55.41')!;

  it('renders the date fields, zero-padded', () => {
    expect(val).not.toBeNull();
    expect(formatDateNumber(val, 'yyyy')).toBe('2017');
    expect(formatDateNumber(val, 'yyyy/mm')).toBe('2017/10');
    expect(formatDateNumber(val, 'yyyy/mm/dd')).toBe('2017/10/12');
    expect(formatDateNumber(val, 'yyyy/mm/dd hh')).toBe('2017/10/12 05');
  });

  it('ROUNDS to the finest field the format asks for, rather than truncating', () => {
    // ⚑ The non-obvious one, and the reason this case is worth having: asking
    // for minutes on 05:11:55.41 yields 05:12, not 05:11. `formatDateNumber`
    // picks a coefficient from the coarsest time token present and rounds the
    // instant to it before rendering. A mutant that truncates instead of
    // rounding survives every other assertion in this file.
    expect(formatDateNumber(val, 'yyyy/mm/dd hh:ii')).toBe('2017/10/12 05:12');
    expect(formatDateNumber(val, 'yyyy/mm/dd hh:ii:ss')).toBe('2017/10/12 05:11:55');
  });

  it('substitutes tokens wherever they appear, in any order', () => {
    // Guards against an implementation that assumes a canonical field order.
    expect(formatDateNumber(val, 'ss ii hh yyyy mm dd')).toBe('55 11 05 2017 10 12');
  });

  it('names the month for mmm and mmmm, and keeps the numeric mm distinct', () => {
    expect(formatDateNumber(val, 'yyyy/mmm/dd hh:ii:ss')).toBe('2017/Oct/12 05:11:55');
    expect(formatDateNumber(val, 'yyyy/mmmm/dd hh:ii:ss')).toBe('2017/October/12 05:11:55');
  });

  it('renders the fractional second to milliseconds', () => {
    expect(formatDateNumber(val, 'yyyy/mmmm/dd hh:ii:ss.frac')).toBe('2017/October/12 05:11:55.410');
  });
});

describe('formatDateNumber - partial dates', () => {
  it('formats a day-precision date at every coarser precision', () => {
    const val = parse('2023/1/1')!;
    expect(formatDateNumber(val, 'yyyy')).toBe('2023');
    expect(formatDateNumber(val, 'yyyy/mm')).toBe('2023/01');
    expect(formatDateNumber(val, 'yyyy/mm/dd')).toBe('2023/01/01');
  });

  it('accepts a year/month with no day', () => {
    const val = parse('2024/1')!;
    expect(formatDateNumber(val, 'yyyy/mm')).toBe('2024/01');
  });

  it('formats an hour on its own, dropping the date fields', () => {
    const val = parse('2022/12/31 12:10:5.5')!;
    expect(formatDateNumber(val, 'yyyy/mm/dd hh')).toBe('2022/12/31 12');
    expect(formatDateNumber(val, 'hh')).toBe('12');
  });
});
