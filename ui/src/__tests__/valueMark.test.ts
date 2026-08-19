import { describe, expect, it } from 'vitest';
import { valueText, valueTitle, suppliedBySource } from '../panels/ValueMark.js';

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

describe('what a marked value says on hover', () => {
  it('⚑ names the way back, because there is only one', () => {
    // Not "reset to the reading": a point's position is a reading the figure
    // never held, so there is nothing to re-read. Undo is the mechanism, and
    // the tooltip states it rather than offering a control that cannot exist.
    expect(valueTitle('Double-click to edit', true)).toBe(
      'You entered this value - Ctrl+Z takes it back. Double-click to edit'
    );
  });

  it('says nothing extra about a value we read ourselves', () => {
    expect(valueTitle('Double-click to edit', false)).toBe('Double-click to edit');
  });
});
