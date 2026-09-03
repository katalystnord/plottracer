import { describe, expect, it } from 'vitest';
import { offBaselineMessage } from '../src/panels/BarTable.js';

/**
 * ⚑⚑ A BAR THAT DOES NOT REACH THE COMMON ORIGIN IS REPORTED, NOT REFUSED.
 *
 * For one day this sentence explained why such a bar had NO value. It has one:
 * a bar is measured from the origin the figure declares, whatever its near end
 * did (David: *"They all NEED (for bars) to come to the same common axis."*).
 * So the message says one thing - this bar does not reach the axis it is
 * measured from - and names the remedy, because that observation is how a user
 * discovers their figure is a Span chart.
 *
 * The message is unit-tested here rather than in the component, for the reason
 * `barTableCrowded.test.ts` gives: what has to be right is what it SAYS.
 */
describe('the off-baseline message', () => {
  const names = ['Jan', 'Feb', 'Mar'];
  const at = (categoryIndex: number) => ({ categoryIndex });

  it('names the categories whose bars do not reach the baseline', () => {
    const msg = offBaselineMessage([at(1)], names, 'bar');
    expect(msg).toContain('Feb');
    expect(msg).toContain('does not reach the baseline');
  });

  it('⚑⚑ says the value STANDS - it is a report about the figure, not a refusal', () => {
    const msg = offBaselineMessage([at(0)], names, 'bar');
    expect(msg).toMatch(/value is still measured from it/);
    // ⚠️ The wording it replaced said the opposite in as many words, and a user
    // reading "no value to report" over a filled-in cell would be right to
    // distrust the whole table.
    expect(msg).not.toMatch(/no value/);
  });

  it('⚑⚑ offers BOTH causes and decides neither - a missed click, or a figure that really floats', () => {
    const msg = offBaselineMessage([at(0)], names, 'bar');
    expect(msg).toContain('clicked short of the baseline');
    expect(msg).toContain('Span chart');
  });

  it('agrees with itself on number, and never leaks its own placeholders', () => {
    const one = offBaselineMessage([at(0)], names, 'bar');
    const two = offBaselineMessage([at(0), at(2)], names, 'bar');
    expect(one).toContain('1 bar (Jan) does not reach');
    expect(two).toContain('2 bars (Jan, Mar) do not reach');
    // ⚠️ A nested single-quoted string inside a template literal printed
    // `${tupleNoun}` to the user verbatim. Caught by typecheck, fenced here.
    for (const m of [one, two]) expect(m).not.toContain('${');
  });

  it('says nothing at all when every bar reaches it', () => {
    expect(offBaselineMessage([], names, 'bar')).toBe('');
  });
});
