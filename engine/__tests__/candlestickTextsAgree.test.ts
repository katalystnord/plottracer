/**
 * ⚑⚑ EVERY TEXT ABOUT ONE GESTURE HAS TO NAME THE SAME GESTURE.
 *
 * `c8cebe1` rebuilt the candlestick walk bottom-up and read the direction off
 * the figure's colour instead of the click order. The walk's own prompts were
 * rewritten. Four other texts were not:
 *
 *   - the auto-extract REFUSAL, seventeen lines above those prompts, still said
 *     *"place its Open/High/Low/Close points by hand, in that order"* - and it
 *     is the text a user reads FIRST, because it fires when they try
 *     auto-extract before walking anything;
 *   - the release notes, the README, and the overlay's own comment.
 *
 * ⚠️ NOTHING BOUND THEM, so all four read as satisfied while pointing the hand
 * at the wrong edge. This is the cheap half of that: the on-screen pair, which
 * is the pair a user meets. `captureLabels` is where the order is STATED, so
 * the refusal may not state one of its own.
 */
import { describe, expect, it } from 'vitest';
import { CANDLESTICK_AXES_CONFIG, BOX_PLOT_AXES_CONFIG } from '../axesTypeConfigs.js';

const SLOT_WORDS = ['open', 'high', 'low', 'close'];

describe('a candlestick’s on-screen texts agree about the gesture', () => {
  it('the refusal does not name a click order of its own', () => {
    const refusal = CANDLESTICK_AXES_CONFIG.autoExtractRefusal ?? '';
    expect(refusal, 'the refusal exists').not.toBe('');
    // ⚑ The tell is a SEQUENCE of slot words: "Open/High/Low/Close, in that
    // order" is an instruction, and it is the walk's job to give one.
    const sequence = SLOT_WORDS.filter((w) => refusal.toLowerCase().includes(w));
    expect(
      sequence.length,
      `the refusal instructs an order the walk does not use: ${JSON.stringify(refusal)}`
    ).toBeLessThan(2);
  });

  it('the walk asks for a PLACE, so no prompt is a bare slot name', () => {
    // A slot name points the hand at the wrong edge half the time: on a falling
    // candle the "open" is the TOP body edge. The place is the same either way.
    for (const label of CANDLESTICK_AXES_CONFIG.captureLabels ?? []) {
      expect(
        SLOT_WORDS.includes(label.trim().toLowerCase()),
        `${JSON.stringify(label)} is a slot name, not a place on the figure`
      ).toBe(false);
    }
  });

  it('⚑ and the walk still runs bottom-up, low first', () => {
    // The companion assertion: the rule above is satisfied by any four places,
    // and the ORDER is the thing the stale texts got backwards.
    expect(CANDLESTICK_AXES_CONFIG.captureLabels?.[0]).toContain('low');
    expect(CANDLESTICK_AXES_CONFIG.captureLabels?.[3]).toContain('high');
  });

  it('leaves the box plot’s prompts alone - its slot names already name places', () => {
    expect(BOX_PLOT_AXES_CONFIG.captureLabels ?? []).toEqual([]);
  });
});
