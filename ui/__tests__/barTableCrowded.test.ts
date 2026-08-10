import { describe, expect, it } from 'vitest';
import { crowdedMessage } from '../src/panels/BarTable.js';

/**
 * ⚑ THE TRACE THAT DID NOT EXIST (v2.1 audit).
 *
 * `getBarCategoryTable` files a second reading for the same category into
 * `crowded` and its own comment says the field exists "so nothing is dropped
 * without a trace". The UI declared `crowded` out of its props interface and
 * never rendered it, so the trace was computed and thrown away: two bars in one
 * band produced a complete-LOOKING table with a real reading missing. Same shape
 * as the splitter that was measured against 882 corpus figures while the product
 * never called it.
 *
 * The message is unit-tested here rather than in the component, because what has
 * to be right is what it SAYS -- an alert that does not name the fix is the
 * "reports a fault, not a remedy" defect this project keeps finding.
 */
describe('the crowded-category message', () => {
  const names = ['Flax', 'Hemp', 'Jute'];

  it('names the category the hidden reading fell in', () => {
    const msg = crowdedMessage([{ categoryIndex: 1 }], names, 'bar');
    expect(msg).toContain('Hemp');
  });

  it('⚑ says the reading is NOT SHOWN — the whole point is that the table lies without it', () => {
    expect(crowdedMessage([{ categoryIndex: 0 }], names, 'bar')).toContain('not shown');
  });

  it('⚑ tells the user what to check, not just that something is wrong', () => {
    const msg = crowdedMessage([{ categoryIndex: 0 }], names, 'bar');
    expect(msg).toContain('category count');
    expect(msg).toContain('outside the marked axis');
  });

  it('agrees with itself on number: one bar reads singular, two read plural', () => {
    expect(crowdedMessage([{ categoryIndex: 0 }], names, 'bar')).toContain('1 more bar falls');
    expect(crowdedMessage([{ categoryIndex: 0 }, { categoryIndex: 2 }], names, 'bar')).toContain(
      '2 more bars fall'
    );
  });

  it('lists each crowded category once, not once per hidden reading', () => {
    const msg = crowdedMessage(
      [{ categoryIndex: 1 }, { categoryIndex: 1 }, { categoryIndex: 2 }],
      names,
      'bar'
    );
    expect(msg.match(/Hemp/g)).toHaveLength(1);
    expect(msg).toContain('Jute');
  });

  it('⚑ stays readable when the categories have no names yet', () => {
    // Unnamed is the NORMAL state right after auto-extract -- a message reading
    // "falls in a category that already has one ()" would be the defect.
    const msg = crowdedMessage([{ categoryIndex: 0 }], ['', '', ''], 'bar');
    expect(msg).not.toContain('()');
    expect(msg).toContain('not shown');
  });

  it('uses the type’s own noun, so a histogram does not talk about bars', () => {
    expect(crowdedMessage([{ categoryIndex: 0 }], names, 'bin')).toContain('1 more bin falls');
  });
});
