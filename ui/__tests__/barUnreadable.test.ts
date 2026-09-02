import { describe, expect, it } from 'vitest';
import { unreadableMessage } from '../src/panels/BarTable.js';

/**
 * ⚑⚑ THE DASH THAT MEANT TWO THINGS (v2.5).
 *
 * With floating removed from Bar, a bar whose near end misses the baseline
 * computes to null - and a null prints as the same dash a category with NO BAR
 * prints. Both corners are measured, in the record and in every export; only
 * the report was missing, which is `crowded`'s defect one row over: a
 * complete-LOOKING table with a real reading not shown.
 *
 * The message is unit-tested here rather than in the component, for the reason
 * `barTableCrowded.test.ts` gives: what has to be right is what it SAYS.
 */
describe('the unreadable-bar message', () => {
  const names = ['Jan', 'Feb', 'Mar'];
  const off = (categoryIndex: number) => ({ categoryIndex, reason: 'off-baseline' as const });

  it('names the categories whose bars do not reach the baseline', () => {
    const msg = unreadableMessage([off(1)], names, 'bar');
    expect(msg).toContain('Feb');
    expect(msg).toContain('does not reach the baseline');
  });

  it('⚑⚑ offers BOTH causes and decides neither - a missed click, or a figure that really floats', () => {
    const msg = unreadableMessage([off(0)], names, 'bar');
    // The likelier one first: a bar's near end is a real clicked pixel, and the
    // tolerance is two IMAGE pixels, so a hand can miss it on a fitted figure.
    expect(msg).toContain('clicked short of the baseline');
    // And the other one, named with its remedy rather than merely diagnosed.
    expect(msg).toContain('Span chart');
  });

  it('⚑⚑ says the ends are KEPT, because they are - the reading is not reportable, not lost', () => {
    const msg = unreadableMessage([off(0)], names, 'bar');
    expect(msg).toContain('in the record');
    expect(msg).toContain('export');
  });

  it('agrees with itself on number: one bar reads singular, two read plural', () => {
    expect(unreadableMessage([off(0)], names, 'bar')).toContain('1 bar (Jan) does not reach');
    expect(unreadableMessage([off(0), off(2)], names, 'bar')).toContain('2 bars (Jan, Mar) do not reach');
  });

  it('⚑ an undeclared baseline is ONE fact about the figure, and does not name any category', () => {
    const msg = unreadableMessage(
      [
        { categoryIndex: 0, reason: 'no-baseline' },
        { categoryIndex: 1, reason: 'no-baseline' },
      ],
      names,
      'bar'
    );
    expect(msg).toContain('No baseline is declared');
    expect(msg).not.toContain('Jan');
    // The remedy is the tick box, quoted as the calibration card spells it.
    expect(msg).toContain('Bars share a baseline');
  });

  it('says nothing at all when every bar reports', () => {
    expect(unreadableMessage([], names, 'bar')).toBe('');
  });
});
