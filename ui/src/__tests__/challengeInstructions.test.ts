import { describe, expect, it } from 'vitest';
import { CHALLENGE_META } from '../challengeExamples.js';

/**
 * ⚑⚑ THE ROUND'S INSTRUCTION IS THE ONLY PROMPT THE PLAYER GETS (v2.5).
 *
 * A Trace Challenge round is pre-calibrated and the player is handed one
 * sentence. So that sentence carries the whole of gate 4: if it does not name
 * the gesture, the only way to know it is to have built the app.
 *
 * ⚠️ THE BAR ROUNDS SAID *"click the top of each bar"* - one click - and had
 * done since before v2.0 made a bar TWO measured corners. A player following it
 * recorded bars spanning two categories, and from v2.5 (floating moved to the
 * Span chart) those bars report no value at all. The instruction guaranteed the
 * outcome the panel then has to explain.
 */
describe('a challenge round names the gesture, not only the target', () => {
  const bars = Object.entries(CHALLENGE_META).filter(([, m]) => m.family === 'bar');

  it('there are bar rounds to check - the guard is not vacuous', () => {
    expect(bars.length).toBeGreaterThan(0);
  });

  it('⚑ every BAR round says to drag, and says where the near end goes', () => {
    for (const [id, meta] of bars) {
      expect(meta.instruction, id).toMatch(/[Dd]rag/);
      expect(meta.instruction, id).toContain('baseline');
    }
  });

  it('⚑ a HISTOGRAM round already named its two corners, and still does', () => {
    for (const [id, meta] of Object.entries(CHALLENGE_META)) {
      if (meta.family !== 'histogram') continue;
      expect(meta.instruction, id).toMatch(/two top corners/);
    }
  });
});
