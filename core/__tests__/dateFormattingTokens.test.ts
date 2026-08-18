import { describe, expect, it } from 'vitest';
import { formatDateNumber, getFormatString, parse } from '../dateConversion.js';

/**
 * The date formatter's TOKEN NORMALISATION and its rounding cascade.
 *
 * ⚑ WHY THIS FILE EXISTS. `dateConversion.ts` still carried 102 surviving
 * mutants after the parsing work, and they sit in two ordered cascades that
 * the existing tests exercise without distinguishing:
 *
 *  - `formatDate` normalises SEVEN uppercase token spellings to lowercase
 *    before substituting. Each is its own mutant, and an unnormalised token
 *    survives into the output verbatim - a user who types `DD/MM/YYYY` gets
 *    the literal letters back instead of a date.
 *  - `formatDateNumber` picks a rounding granularity by scanning the format
 *    for `frac`, then `s`, `i`, `h`, `d`, `m`, `y` - IN THAT ORDER. The order
 *    is load-bearing and not obvious: `yyyy/mm/dd hh:ii:ss` contains every one
 *    of those letters, so which branch wins decides whether the value is
 *    rounded to the second or to the day.
 *
 * A wrong granularity is not a formatting nicety: rounding a timestamp to the
 * nearest DAY can roll it into tomorrow, so an axis tick can be labelled with
 * the wrong date entirely.
 */

/** 2024/03/05 14:37:26.500 UTC as a timestamp. */
const T = Date.UTC(2024, 2, 5, 14, 37, 26, 500);

describe('uppercase tokens are accepted, not echoed', () => {
  const cases: Array<[string, string]> = [
    ['YYYY', '2024'],
    ['YY', '24'],
    ['MM', '03'],
    ['DD', '05'],
    ['HH', '14'],
    ['II', '37'],
    ['SS', '26'],
  ];

  for (const [token, expected] of cases) {
    it(`renders ${token} rather than leaving the letters in place`, () => {
      // Each normalisation is its own mutant; dropping one leaves that token
      // in the output as literal text beside real numbers.
      const out = formatDateNumber(T, token);
      expect(out).toBe(expected);
      expect(out).not.toContain(token);
    });
  }

  it('renders MMMM and MMM as month names, distinct from numeric MM', () => {
    expect(formatDateNumber(T, 'MMMM')).toMatch(/^[A-Za-z]+$/);
    expect(formatDateNumber(T, 'MMM')).toMatch(/^[A-Za-z]+$/);
    expect(formatDateNumber(T, 'MMMM').length).toBeGreaterThanOrEqual(
      formatDateNumber(T, 'MMM').length
    );
    expect(formatDateNumber(T, 'MM')).toBe('03');
  });

  it('renders .FRAC as a fractional second', () => {
    expect(formatDateNumber(T, 'SS.FRAC')).toBe('26.500');
  });

  it('⚑ renders a whole uppercase format, but does NOT round like its lowercase twin', () => {
    // A real asymmetry in the inherited formatter, pinned so it is not
    // discovered again as a surprise: the rounding cascade scans the RAW
    // format string for lowercase letters, and it runs BEFORE `formatDate`
    // normalises the case. So `yyyy/.../ss` rounds to the second (26.5 -> 27)
    // while `YYYY/.../SS` gets no rounding at all and truncates to 26.
    //
    // NOT a live defect, and deliberately not "fixed" here: `getFormatString`
    // is the only producer of a format string in the app and emits lowercase
    // exclusively, so nothing reaches this path. The uppercase branch is
    // defensive - a hand-edited or foreign project file could restore one
    // through `initialFormattingX`. Changing the cascade would change how
    // every axis tick is rounded, which is a rendering decision, not a test fix.
    expect(formatDateNumber(T, 'yyyy/mm/dd hh:ii:ss')).toBe('2024/03/05 14:37:27');
    expect(formatDateNumber(T, 'YYYY/MM/DD HH:II:SS')).toBe('2024/03/05 14:37:26');
  });
});

describe('the two-digit year', () => {
  it('zero-pads a year below 2010, where the remainder is a single digit', () => {
    // `yy` for 2005 is "05", not "5" - the padding branch fires only for
    // years x000..x009, so nothing in an ordinary fixture reaches it.
    expect(formatDateNumber(Date.UTC(2005, 0, 1), 'yy')).toBe('05');
    expect(formatDateNumber(Date.UTC(2000, 0, 1), 'yy')).toBe('00');
  });

  it('leaves a two-digit remainder alone', () => {
    expect(formatDateNumber(Date.UTC(2024, 0, 1), 'yy')).toBe('24');
    expect(formatDateNumber(Date.UTC(1999, 0, 1), 'yy')).toBe('99');
  });
});

describe('the rounding granularity is chosen by the FIRST field the format names', () => {
  // 23:59:59.500 - half a second before midnight, so rounding to any field
  // coarser than a second rolls the value into the NEXT DAY. That is what
  // makes each branch visible.
  const almostMidnight = Date.UTC(2024, 2, 5, 23, 59, 59, 500);

  it('⚑ rounds to the second for a format naming seconds, keeping the date', () => {
    // "yyyy/mm/dd hh:ii:ss" contains d, m, y and h as well. If a coarser
    // branch won, this would read 2024/03/06.
    expect(formatDateNumber(almostMidnight, 'yyyy/mm/dd hh:ii:ss')).toBe('2024/03/06 00:00:00');
  });

  it('does not round at all when the format asks for a fraction', () => {
    expect(formatDateNumber(almostMidnight, 'ss.frac')).toBe('59.500');
  });

  it('rounds to the minute for a minutes format', () => {
    expect(formatDateNumber(almostMidnight, 'hh:ii')).toBe('00:00');
    expect(formatDateNumber(Date.UTC(2024, 2, 5, 10, 20, 29), 'hh:ii')).toBe('10:20');
    expect(formatDateNumber(Date.UTC(2024, 2, 5, 10, 20, 31), 'hh:ii')).toBe('10:21');
  });

  it('rounds to the hour for an hours-only format', () => {
    expect(formatDateNumber(Date.UTC(2024, 2, 5, 10, 29), 'hh')).toBe('10');
    expect(formatDateNumber(Date.UTC(2024, 2, 5, 10, 31), 'hh')).toBe('11');
  });

  it('⚑ rounds to the DAY for a date-only format, which can advance the date', () => {
    // The consequence worth naming: a value late in the day, labelled with a
    // day-precision format, names TOMORROW. That is the inherited behaviour;
    // it is pinned so a change to it is deliberate rather than accidental.
    expect(formatDateNumber(almostMidnight, 'yyyy/mm/dd')).toBe('2024/03/06');
    expect(formatDateNumber(Date.UTC(2024, 2, 5, 11), 'yyyy/mm/dd')).toBe('2024/03/05');
  });

  it('does not round for a year-or-month format, which has no coefficient', () => {
    expect(formatDateNumber(almostMidnight, 'yyyy/mm')).toBe('2024/03');
    expect(formatDateNumber(almostMidnight, 'yyyy')).toBe('2024');
  });
});

describe('inferring a format from what the user typed', () => {
  it('grows the date format one field per part', () => {
    // ⚑ A bare "2024" has no separator, so it is NOT a date at all - it reads
    // as an hour. That is the same rule `parse` enforces, and the two must
    // agree or a figure's axis would be formatted as something it did not
    // parse as.
    expect(getFormatString('2024')).toBe('hh');
    expect(getFormatString('2024/03')).toBe('yyyy/mm');
    expect(getFormatString('2024/03/05')).toBe('yyyy/mm/dd');
    expect(getFormatString('2024/03/05 14')).toBe('yyyy/mm/dd hh');
    expect(getFormatString('2024/03/05 14:37')).toBe('yyyy/mm/dd hh:ii');
    expect(getFormatString('2024/03/05 14:37:26')).toBe('yyyy/mm/dd hh:ii:ss');
  });

  it('⚑ switches to a TIME format when there is no slash', () => {
    // The `hasDatePart` branch. Read the wrong way, a bare "14:37" would be
    // formatted as a year and a month.
    expect(getFormatString('14')).toBe('hh');
    expect(getFormatString('14:37')).toBe('hh:ii');
    expect(getFormatString('14:37:26')).toBe('hh:ii:ss');
  });

  it('stops growing past six parts rather than adding a seventh field', () => {
    // The last step is `=== 6`, not `>= 6`; a seventh part is refused by the
    // parser, so the format must not pretend to name it.
    expect(getFormatString('2024/03/05 14:37:26')).toBe('yyyy/mm/dd hh:ii:ss');
  });

  it('round-trips a typed date: infer the format, parse, format back', () => {
    // The three functions are used together - the axis stores the format the
    // user's own first value implied, and every tick is rendered through it.
    for (const typed of ['2024/03/05', '2024/03/05 14:37', '2024/03/05 14:37:26']) {
      const fmt = getFormatString(typed);
      const serial = parse(typed);
      expect(serial).not.toBeNull();
      expect(formatDateNumber(serial!, fmt)).toBe(typed);
    }
  });

  it('round-trips a bare time the same way', () => {
    const fmt = getFormatString('14:37');
    const serial = parse('14:37')!;
    expect(formatDateNumber(serial, fmt)).toBe('14:37');
  });
});
