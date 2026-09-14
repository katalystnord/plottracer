/**
 * ⚑⚑ EVERY LINE OF THE OFFER SAYS SOMETHING.
 *
 * ⚠️ FOUND BY AUDIT, 2026-09-15. `layeredProjectOffer` builds its middle as
 * `"<names>: <slots joined by commas>"`, and a series with NO slot names -
 * which is an ordinary record, not a corrupt one - renders as a line ending in a
 * bare colon:
 *
 *     Series 1:
 *     Series 2: Min, Q1, Median, Q3, Max
 *
 * The door this offer exists for is the one that produces it: the module's own
 * header names *"a WPD import carrying per-dataset point groups"*, and a WPD
 * project where one dataset has point groups and another has none gives exactly
 * a slotted series beside a slotless one. The user is then asked to accept a
 * split on the strength of a line with nothing on it.
 *
 * ⚑ The offer's own rule is that the generated middle carries the specifics
 * *"because a constant cannot say WHICH kinds it found"*. A blank is not a kind,
 * so the empty shape gets said in words rather than in nothing.
 */
import { describe, expect, it } from 'vitest';
import { layeredProjectOffer } from '../layeredSeries.js';
import { BOX_PLOT_SLOTS } from '../axesTypeConfigs.js';

describe('the offer names every kind it found', () => {
  it('⚠️⚑⚑ a series with no named values is described, not left after a bare colon', () => {
    const offer = layeredProjectOffer([
      { name: 'Series 1', slots: [] },
      { name: 'Series 2', slots: BOX_PLOT_SLOTS },
    ]);
    expect(offer).not.toBeNull();
    for (const line of offer!.split('\n')) {
      expect(line.trimEnd(), `"${line}" names a series and then says nothing`).not.toMatch(/:$/);
    }
    // And the slotted half still reads as it did.
    expect(offer).toMatch(/Series 2: Min, Q1, Median, Q3, Max/);
  });

  it('⚑ the named shapes are still printed verbatim', () => {
    // The companion assertion: describing the empty case must not start
    // describing the others.
    const offer = layeredProjectOffer([
      { name: 'A', slots: ['Corner', 'Opposite corner'] },
      { name: 'B', slots: BOX_PLOT_SLOTS },
    ]);
    expect(offer).toMatch(/A: Corner, Opposite corner/);
  });
});
