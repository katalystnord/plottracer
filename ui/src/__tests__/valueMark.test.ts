import { describe, expect, it } from 'vitest';
import { valueText, suppliedBySource } from '../panels/ValueMark.js';

/**
 * The mark itself: what wears brackets, and what does not.
 *
 * ⚑⚑ THE THIRD INSTRUMENT IS SETTLED HERE, BEFORE IT ARRIVES. OCR reads a
 * printed number off the figure - by a different machine, but off the PIXELS -
 * and the mark says exactly one thing: *this number did not come off the
 * pixels*. So an OCR'd value wears NO brackets, and the fact that a machine
 * other than the colour sampler read it rides in the export's source column,
 * which distinguishes all three. Deciding it while the rule is small beats
 * discovering it mid-build (v2.3 worklist).
 */
describe('the [ ] mark', () => {
  it('brackets a value the user supplied', () => {
    expect(valueText('59', true)).toBe('[59]');
  });

  it('leaves a value read off the pixels bare', () => {
    expect(valueText('59', false)).toBe('59');
  });

  it('⚑ says nothing about an OCR reading - that number DID come off the pixels', () => {
    expect(suppliedBySource('ocr')).toBe(false);
    expect(suppliedBySource('colour')).toBe(false);
    expect(suppliedBySource(undefined)).toBe(false);
    expect(suppliedBySource('user')).toBe(true);
  });
});
