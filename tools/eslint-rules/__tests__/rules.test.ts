import { describe, expect, it } from 'vitest';
import { Linter } from 'eslint';
import { plottracer } from '../index.mjs';

/**
 * The custom rules, tested against code that SHOULD trip them and code that
 * should not.
 *
 * ⚑⚑ WHY THIS MATTERS MORE THAN USUAL. These rules currently report ZERO
 * findings on the repository, which is the desired state and also
 * indistinguishable from a rule that silently does nothing. Every one of them
 * was written, run, and found to be WRONG on first attempt:
 *
 *   - calibrate-must-refuse flagged XYAxes, whose calibrate DELEGATES to
 *     processCalibration where the refusals live.
 *   - no-raw-number-parse flagged `parseFloat(String(pxi))`, which parses a
 *     pixel, not a declared value.
 *   - no-fabricated-label produced 15 hits, all false, and was deleted.
 *
 * A green board after that history proves nothing on its own. These tests are
 * what say the survivors still bite.
 */

/**
 * ⚑ `files` IS LOAD-BEARING, and leaving it out made these tests VACUOUS.
 * Flat config matches by filename, so a config with no `files` matches nothing
 * once a path is supplied: ESLint then returns a single severity-1 warning,
 * "No matching configuration found", and runs no rules at all. The first draft
 * asserted `toHaveLength(1)` and passed on THAT warning rather than on any
 * finding - a green test proving the rule was never invoked.
 *
 * Every assertion below therefore checks the ruleId too, so a message that is
 * not ours can never satisfy it.
 */
function lint(code: string, rule: string, filename = 'core/axes/thing.ts'): Linter.LintMessage[] {
  const linter = new Linter();
  const messages = linter.verify(
    code,
    {
      files: ['**/*.ts'],
      plugins: { plottracer },
      rules: { [`plottracer/${rule}`]: 'error' },
      languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
    },
    filename
  );
  // Nothing but our own rule may ever appear here.
  for (const m of messages) {
    expect(m.ruleId, `unexpected non-rule message: ${m.message}`).toBe(`plottracer/${rule}`);
  }
  return messages;
}

describe('calibrate-must-refuse', () => {
  it('catches a calibrate that can only ever succeed', () => {
    // The shape that shipped five times: xy, polar, map, ternary, pie.
    const out = lint(
      `class A { calibrate(cal, total) { this.total = total; return true; } }`,
      'calibrate-must-refuse'
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.message).toMatch(/cannot refuse/);
  });

  it('accepts one that refuses in its own body', () => {
    expect(
      lint(`class A { calibrate(cal, t) { if (!isFinite(t)) return false; return true; } }`, 'calibrate-must-refuse')
    ).toHaveLength(0);
  });

  it('accepts one that DELEGATES its refusals - the false positive that bit first', () => {
    // XYAxes' real shape. Reading only the method body called this dead.
    expect(
      lint(
        `class A {
           calibrate(cal, a, b) { this._ok = this.process(cal, a, b); return this._ok; }
           process(cal, a, b) { if (a === b) return false; return true; }
         }`,
        'calibrate-must-refuse'
      )
    ).toHaveLength(0);
  });

  it('accepts a calibrate that takes NO input - there is nothing to refuse', () => {
    // ImageAxes: pixelToData returns the pixel unchanged.
    expect(lint(`class A { calibrate() { return true; } }`, 'calibrate-must-refuse')).toHaveLength(0);
  });

  it('ignores a class with no calibrate at all', () => {
    expect(lint(`class A { draw() { return true; } }`, 'calibrate-must-refuse')).toHaveLength(0);
  });
});

describe('no-dynamic-regexp', () => {
  it('catches a RegExp built by interpolation - the wpdImport crash', () => {
    // A folder called "Fig 3 (rev 2)" threw on open.
    const out = lint('const re = new RegExp(`^${folder}/`);', 'no-dynamic-regexp');
    expect(out).toHaveLength(1);
  });

  it('catches one built by concatenation', () => {
    expect(lint('const re = new RegExp("^" + name);', 'no-dynamic-regexp')).toHaveLength(1);
  });

  it('accepts a literal pattern', () => {
    expect(lint('const re = new RegExp("^abc$");', 'no-dynamic-regexp')).toHaveLength(0);
    expect(lint('const re = /^abc$/;', 'no-dynamic-regexp')).toHaveLength(0);
  });

  it('accepts a template literal with nothing interpolated', () => {
    expect(lint('const re = new RegExp(`^abc$`);', 'no-dynamic-regexp')).toHaveLength(0);
  });
});

describe('no-raw-number-parse', () => {
  // The rule is scoped to core/axes/, so the filename is part of the input.
  const lintAxes = (code: string) => lint(code, 'no-raw-number-parse');

  it('catches a declared value parsed without InputParser - the MapAxes bug', () => {
    // "1,000" becomes 1 and every distance is 1000x wrong, silently.
    expect(lintAxes('const len = parseFloat(cp.dx);')).toHaveLength(1);
    expect(lintAxes("const t = parseFloat(String(meta['pieTotal']));")).toHaveLength(1);
    expect(lintAxes("const s = parseFloat(globalValues['scale']);")).toHaveLength(1);
  });

  it('accepts parsing a PIXEL - the false positive that bit first', () => {
    expect(lintAxes('const xp = parseFloat(String(pxi));')).toHaveLength(0);
  });

  it('does not fire outside core/axes/', () => {
    expect(lint('const len = parseFloat(cp.dx);', 'no-raw-number-parse', 'engine/whatever.ts')).toHaveLength(0);
  });
});
