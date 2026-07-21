import { describe, expect, it } from 'vitest';
import { InputParser } from '../inputParser.js';

/**
 * Checkpoint 81 — the whole-string rule.
 *
 * Upstream's `parseFloat` is a PREFIX parser and `InputParser` only rejected
 * `NaN`, so trailing garbage was silently discarded on **all 7 axes types**.
 * Found by execution while investigating what was logged as a Bar-only defect.
 *
 * Each "silently became" case below was verified against the OLD code before
 * the fix — these are recordings of real behaviour, not hypotheticals.
 */
describe('InputParser refuses input it used to silently truncate', () => {
  const parse = (s: unknown) => {
    const ip = new InputParser();
    const v = ip.parse(s);
    return { v, isValid: ip.isValid, isDate: ip.isDate };
  };

  it('refuses a thousands separator — it silently became 1', () => {
    // The worst of the set: an ordinary thing to type on a scientific axis,
    // and it made every value on the chart 1000x wrong with nothing on screen
    // wrong. Refusing is the only honest answer: we cannot know whether
    // "1,000" means 1000 (en) or 1.0 (de).
    expect(parse('1,000')).toEqual({ v: null, isValid: false, isDate: false });
  });

  it('refuses a value with units — it silently became 5', () => {
    expect(parse('5 kg')).toEqual({ v: null, isValid: false, isDate: false });
    expect(parse('5%')).toEqual({ v: null, isValid: false, isDate: false });
  });

  it('refuses a malformed number — it silently became 1.2', () => {
    expect(parse('1.2.3')).toEqual({ v: null, isValid: false, isDate: false });
  });

  it('refuses an ISO date rather than reading it as the year — parity gap 8b', () => {
    // "2024-01-01" has no "/" or ":", so the date path declines it (WPD's own
    // rule), and it used to fall through to parseFloat -> 2024, isValid=true.
    // Calibrating 2024-01-01..2024-12-31 gave xmin === xmax -> singular matrix
    // -> every X null. ISO 8601 is THE science date format.
    expect(parse('2024-01-01')).toEqual({ v: null, isValid: false, isDate: false });
  });

  it('refuses an equation — because equations NEVER worked', () => {
    // Gap 8b's defence was that fixing the ISO date is "not cheap" because WPD
    // "accepts equations, so 2024-01-01 is ambiguous between a date and a
    // subtraction". Verified by execution: "2+3" yielded 2, not 5. There is no
    // equation evaluation in this file, ours or upstream. Nothing was ever
    // ambiguous with the minus sign.
    expect(parse('2+3')).toEqual({ v: null, isValid: false, isDate: false });
    expect(parse('2*3')).toEqual({ v: null, isValid: false, isDate: false });
  });

  it('refuses empty and blank — Number("") is 0, which parseFloat was not', () => {
    // The one place a naive parseFloat->Number swap makes things WORSE: it
    // would turn a blank field into a silent zero.
    expect(parse('')).toEqual({ v: null, isValid: false, isDate: false });
    expect(parse('   ')).toEqual({ v: null, isValid: false, isDate: false });
  });

  it('still accepts every legitimate number', () => {
    expect(parse('10').v).toBe(10);
    expect(parse('-5').v).toBe(-5);
    expect(parse('1e3').v).toBe(1000);
    expect(parse('0.5').v).toBe(0.5);
    expect(parse(' 42 ').v).toBe(42); // trimmed, as before
    expect(parse('10').isValid).toBe(true);
  });

  it('still accepts real dates — the date path runs first and is untouched', () => {
    const slash = parse('2024/01/01');
    expect(slash.isValid).toBe(true);
    expect(slash.isDate).toBe(true);
    const time = parse('12:30');
    expect(time.isValid).toBe(true);
    expect(time.isDate).toBe(true);
  });

  it('KNOWN, DELIBERATE: "10/2" is still a date, not a fraction', () => {
    // The date path claims anything containing "/" before the number path runs
    // -- WPD's documented rule. With equations proven non-functional, nobody
    // could have meant division here. Pinned so a future reader knows it was
    // decided, not missed.
    const r = parse('10/2');
    expect(r.isValid).toBe(true);
    expect(r.isDate).toBe(true);
  });

  it('applies the same rule inside arrays', () => {
    const ip = new InputParser();
    // "[1 kg, 2]" used to yield [1, 2] -- a prefix-parsed 1 presented as data.
    expect(ip.parse('[1 kg, 2]')).toEqual([2]);
    expect(ip.parse('[1, 2, 3]')).toEqual([1, 2, 3]);
    // Wholly malformed still declines rather than returning an empty list.
    const ip2 = new InputParser();
    expect(ip2.parse('[a, b]')).toBeNull();
  });
});
