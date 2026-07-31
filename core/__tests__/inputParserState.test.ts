import { describe, expect, it } from 'vitest';
import { InputParser } from '../inputParser.js';

/**
 * `InputParser` — the gate every typed calibration value passes through, and
 * the STATE it reports about what it just read.
 *
 * ⚑ WHY THIS FILE EXISTS. The 2026-07-31 mutation run scored
 * `core/inputParser.ts` at **58.54%**. `inputParserGuards.test.ts` covers the
 * whole-string RULE well (the checkpoint-81 divergence: "1,000", "5 kg",
 * "1.2.3" are refused where upstream's prefix `parseFloat` accepted them) and
 * stays. What nothing covered is the OTHER half of this class's job: the four
 * public flags — `isValid`, `isDate`, `isArray`, `formatting` — which callers
 * branch on to decide whether a value is a date, a number, or nothing.
 *
 * ⚑ THOSE FLAGS ARE READ BY EVERY AXES CLASS'S VALIDATION. `!ip.isValid ||
 * ip.isDate || typeof v !== 'number'` is the refusal in Bar, Polar, CCR and
 * Spider. If a flag is stale or wrong, a calibration is accepted that should
 * have been refused — the exact silently-wrong-number class tenet 1 exists to
 * prevent — and the mutation run showed every one of the three resets at the
 * top of `parse` could be flipped with the suite green.
 */

describe('InputParser — the flags describe THIS call, not a previous one', () => {
  /**
   * ⚑ THE STATE-LEAK CASES. A single parser is deliberately reused across many
   * values: one `ip` walks every spoke in SpiderAxes.calibrate, and all four
   * fields in CircularChartRecorderAxes.calibrate. So every flag must be reset
   * per call — and each reset mutated to a no-op and survived, because no test
   * had ever parsed twice with the same instance.
   */
  it('clears isDate when a NUMBER follows a date', () => {
    // The dangerous direction: a stale isDate makes the axes classes refuse a
    // perfectly good number ("BarAxes has no date concept to honour one
    // with"), so a valid calibration is rejected with a misleading reason.
    const ip = new InputParser();
    expect(ip.parse('2024/01/01')).not.toBeNull();
    expect(ip.isDate).toBe(true);

    ip.parse('42');
    expect(ip.isDate).toBe(false);
    expect(ip.isValid).toBe(true);
  });

  it('clears formatting when a number follows a date', () => {
    const ip = new InputParser();
    ip.parse('2024/01/01');
    expect(ip.formatting).not.toBeNull();
    ip.parse('42');
    expect(ip.formatting).toBeNull();
  });

  it('clears isValid when garbage follows a good value', () => {
    // The other dangerous direction: a stale isValid would let "abc" through
    // as if it had parsed.
    const ip = new InputParser();
    expect(ip.parse('42')).toBe(42);
    expect(ip.isValid).toBe(true);

    expect(ip.parse('abc')).toBeNull();
    expect(ip.isValid).toBe(false);
  });

  it('⚑ clears isArray when a scalar follows an array', () => {
    // The flag that was genuinely NOT reset until this sweep. Latent rather
    // than live (nothing in the product reads isArray yet), which is precisely
    // why it went unnoticed -- it is observable only from a test.
    const ip = new InputParser();
    expect(ip.parse('[1, 2, 3]')).toEqual([1, 2, 3]);
    expect(ip.isArray).toBe(true);

    ip.parse('42');
    expect(ip.isArray).toBe(false);
  });

  it('reports a fresh parser as having read nothing', () => {
    const ip = new InputParser();
    expect(ip.isValid).toBe(false);
    expect(ip.isDate).toBe(false);
    expect(ip.isArray).toBe(false);
    expect(ip.formatting).toBeNull();
  });
});

describe('InputParser — what each kind of input reports', () => {
  it('a plain number: valid, not a date, no formatting', () => {
    const ip = new InputParser();
    expect(ip.parse('42')).toBe(42);
    expect(ip.isValid).toBe(true);
    expect(ip.isDate).toBe(false);
    expect(ip.isArray).toBe(false);
    expect(ip.formatting).toBeNull();
  });

  it('a date: valid AND flagged as a date, carrying the format it was written in', () => {
    // `formatting` is what lets the app render the value back the way the user
    // typed it; a null here silently turns a date column into raw milliseconds.
    const ip = new InputParser();
    expect(ip.parse('2024/01/01')).not.toBeNull();
    expect(ip.isValid).toBe(true);
    expect(ip.isDate).toBe(true);
    expect(ip.formatting).toBeTruthy();
  });

  it('refuses null and undefined without claiming validity', () => {
    const ip = new InputParser();
    expect(ip.parse(null)).toBeNull();
    expect(ip.isValid).toBe(false);
    expect(ip.parse(undefined)).toBeNull();
    expect(ip.isValid).toBe(false);
  });

  it('refuses an empty or whitespace-only string, rather than reading it as zero', () => {
    // ⚑ `Number('')` is 0, so the explicit empty check is the ONLY thing
    // between a blank field and a silent zero -- the documented reason
    // parseWholeNumber tests for '' before calling Number at all.
    const ip = new InputParser();
    expect(ip.parse('')).toBeNull();
    expect(ip.isValid).toBe(false);
    expect(ip.parse('   ')).toBeNull();
    expect(ip.isValid).toBe(false);
  });

  it('TRIMS surrounding whitespace rather than refusing a padded number', () => {
    // The trim mutated to a no-op and survived; without it " 42 " fails and a
    // user who pasted a value gets an unexplained refusal.
    const ip = new InputParser();
    expect(ip.parse('  42  ')).toBe(42);
    expect(ip.isValid).toBe(true);
  });

  it('refuses a caret, which is neither a number nor an equation this app evaluates', () => {
    // The `^` guard exists because upstream advertised equation support that
    // does not actually work; refusing is honest where prefix-parsing "2^3" to
    // 2 is not.
    const ip = new InputParser();
    expect(ip.parse('2^3')).toBeNull();
    expect(ip.isValid).toBe(false);
    expect(ip.parse('  ^  ')).toBeNull();
  });

  it('handles a non-string input without trimming it', () => {
    // The `typeof input === 'string'` branch guards the trim; a raw number
    // must still parse (importers hand these in directly).
    const ip = new InputParser();
    expect(ip.parse(42)).toBe(42);
    expect(ip.isValid).toBe(true);
  });
});

describe('InputParser — arrays', () => {
  it('reads a bracketed numeric list, flagging it as an array and not a date', () => {
    const ip = new InputParser();
    expect(ip.parse('[1, 2, 3]')).toEqual([1, 2, 3]);
    expect(ip.isValid).toBe(true);
    expect(ip.isArray).toBe(true);
    expect(ip.isDate).toBe(false);
  });

  it('⚑ flags an array OF DATES as a date array, on either separator alone', () => {
    // `_hasDates` is `indexOf('/') > 0 || indexOf(':') > 0`; the `||` mutated
    // to `&&` and survived, which only shows on input carrying ONE of the two.
    // A date list has slashes and no colons; a time list the reverse.
    const dates = new InputParser();
    expect(dates.parse('[2024/01/01, 2024/01/02]')).not.toBeNull();
    expect(dates.isArray).toBe(true);
    expect(dates.isDate).toBe(true);

    const times = new InputParser();
    expect(times.parse('[12:30, 13:45]')).not.toBeNull();
    expect(times.isDate).toBe(true);
  });

  it('needs BOTH brackets — a half-bracketed string is not an array', () => {
    const ip = new InputParser();
    expect(ip.parse('[1, 2')).toBeNull();
    expect(ip.isArray).toBe(false);
    expect(ip.parse('1, 2]')).toBeNull();
    expect(ip.isArray).toBe(false);
  });

  it('drops a malformed element rather than prefix-parsing it', () => {
    // The whole-string rule applies inside a list too (checkpoint 81): upstream
    // turned "[1 kg, 2]" into [1, 2], which is correct only by accident.
    const ip = new InputParser();
    expect(ip.parse('[1 kg, 2]')).toEqual([2]);
  });

  it('refuses a list with nothing usable in it at all', () => {
    const ip = new InputParser();
    expect(ip.parse('[abc, def]')).toBeNull();
    expect(ip.isValid).toBe(false);
  });
});
