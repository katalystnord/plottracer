/**
 * ⚑⚑ EVERY REGISTERED GRAPH TYPE SHIPS A FIGURE TO OPEN.
 *
 * Sibling of `everyTypeHasAnIcon`, and it exists for the same reason one type
 * along: **the picker offers a card, and behind the card there was nothing.**
 * Candlestick was registered, drew an icon, walked, captured and exported - and
 * Open Example had no figure for it, so the one route a first-time user has into
 * a new type dead-ended.
 *
 * ⚠️ THE FIGURE WAS DRAWN TO CLOSE THIS AND THE REGISTRATION LINE WAS NEVER
 * ADDED. `samples/generators/gen_samples.py` says in as many words that
 * candlestick *"was the ONE registered graph type with no bundled example"* and
 * that *"nothing asserted that a registered type ships a sample, the same way
 * nothing asserted it ships an icon"* - a docstring describing a fix that was
 * not there, above a `.png` and a `.truth.json` that were committed and read by
 * nobody. Gate 3, in the samples tree.
 *
 * ⚑ Both sides are DERIVED - the registry on one, the example list on the other
 * - so neither can be edited into agreement with the other.
 */
import { describe, expect, it } from 'vitest';
import { ALL_AXES_TYPE_CONFIGS } from '../../../engine/axesTypeConfigs.js';
import { EXAMPLES } from '../examples.js';

describe('every graph type has an example to open', () => {
  it('a card the picker offers has a figure behind it', () => {
    const offered = new Set(EXAMPLES.map((e) => e.axes));
    const missing = ALL_AXES_TYPE_CONFIGS.filter((c) => !offered.has(c.id)).map((c) => c.id);
    expect(missing, 'these types offer a card with nothing to open').toEqual([]);
  });

  it('is not vacuous - the registry is populated and every example names a real type', () => {
    expect(ALL_AXES_TYPE_CONFIGS.length).toBeGreaterThan(5);
    const ids = new Set(ALL_AXES_TYPE_CONFIGS.map((c) => c.id));
    const orphans = EXAMPLES.filter((e) => !ids.has(e.axes)).map((e) => e.id);
    expect(orphans, 'these examples open as a type that is not registered').toEqual([]);
  });
});
