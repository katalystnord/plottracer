import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ALL_AXES_TYPE_CONFIGS } from '../axesTypeConfigs';

/**
 * MANUAL.md names the types that offer "Mark category ticks?". This asserts the
 * list is the one the registry actually declares.
 *
 * ⚑⚑ WHY THIS FILE EXISTS. The manual said *"a Bar, Span chart, Box Plot or
 * Candlestick figure"* - four types - while FIVE configs declare
 * `categoryTicks`: Line (categorical X) has offered it since v2.3 and was never
 * written down. An enumeration kept in step with code by hand is exactly the
 * thing that goes stale, and nothing executes prose, so a reader of the manual
 * cannot find a capability the app has. The precedent is
 * `ui/src/__tests__/helpOverlayKeys.test.ts`, which catches the same failure for
 * the F1 card's hotkeys.
 *
 * ⚑ It asserts the SENTENCE, not the whole bullet: the rest of the bullet talks
 * about bars at length, so "Bar" would pass there for the wrong reason.
 *
 * ⚑ A type that gains `categoryTicks` turns this red until the manual says so.
 * That is the point - the twelfth type joined a dropdown and joined nothing
 * else once already.
 */

/**
 * ⚑ Read with the line wrapping FLATTENED. The enumeration is prose in a
 * hard-wrapped file, so any phrase used to bound it straddles a newline the
 * moment someone reflows the paragraph - which silently widened this window to
 * half the manual on the first run and made the test pass on the wrong text.
 */
const MANUAL = readFileSync(path.join(import.meta.dirname, '..', '..', 'MANUAL.md'), 'utf8')
  .replace(/\s+/g, ' ');

/**
 * Does `text` name `label` as a whole word, ignoring case?
 *
 * ⚑ Hand-rolled rather than a `RegExp` built from the label: `plottracer/no-dynamic-regexp`
 * refuses that, and it is right to - "Pie / Donut" and "Spider / Radar" carry
 * metacharacters straight out of the registry.
 * ⚑ Whole words matter: "Bar" offers ticks and "Stacked bar" is a different type,
 * so a substring test would read the one as the other.
 */
function names(text: string, label: string): boolean {
  const haystack = text.toLowerCase();
  const needle = label.toLowerCase();
  const isWord = (ch: string | undefined): boolean => ch !== undefined && /[a-z0-9]/.test(ch);
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) {
    if (!isWord(haystack[at - 1]) && !isWord(haystack[at + needle.length])) return true;
  }
  return false;
}

/** The first sentence of the "Mark category ticks" bullet - the enumeration. */
function offerSentence(): string {
  const start = MANUAL.indexOf('- **Mark category ticks');
  expect(start, 'the "Mark category ticks" bullet is missing from MANUAL.md').toBeGreaterThan(-1);
  const end = MANUAL.indexOf('figure is calibrated', start);
  expect(end, 'the bullet no longer says which figures the offer appears on').toBeGreaterThan(start);
  return MANUAL.slice(start, end);
}

describe('MANUAL.md lists every type that offers category ticks', () => {
  const offering = ALL_AXES_TYPE_CONFIGS.filter((c) => c.categoryTicks !== undefined);

  it('is not vacuous - some type offers category ticks', () => {
    expect(offering.length).toBeGreaterThan(1);
  });

  it('names Line (categorical X), which was missing for a release', () => {
    expect(offering.map((c) => c.id)).toContain('categorical');
    expect(offerSentence()).toMatch(/Line \(categorical X\)/);
  });

  it('names every offering type and no other type', () => {
    const sentence = offerSentence();
    for (const config of offering) {
      expect(
        names(sentence, config.label),
        `MANUAL.md's "Mark category ticks" sentence does not name ${config.label}, which declares categoryTicks`,
      ).toBe(true);
    }
    for (const config of ALL_AXES_TYPE_CONFIGS) {
      if (config.categoryTicks !== undefined) continue;
      expect(
        names(sentence, config.label),
        `MANUAL.md offers category ticks for ${config.label}, which does not declare them`,
      ).toBe(false);
    }
  });
});
