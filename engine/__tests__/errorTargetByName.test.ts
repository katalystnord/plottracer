import { describe, expect, it } from 'vitest';
import { resolveErrorTarget } from '../errorRelation.js';

/**
 * ⚑⚑ AN INDEX IS NOT AN IDENTITY ACROSS A DELETE (v2.3 re-audit, F39).
 *
 * The Error bars card held the target series as a raw dataset INDEX, and nothing
 * ever revalidated it. Delete the series above the one you had chosen and every
 * later index shifts down - so the dropdown went on reading "Series 3" while the
 * next drag filed its cap under what had been Series 4. A cap on the wrong
 * series is the exact failure `computeWhisker` is drawn per-point to make
 * visible, arriving through the one door that could not see it.
 *
 * ⚑ The fix is not a revalidation: it is holding the thing that survives.
 * `engine/errorRelation.ts` already argues this for the STORED relation - names
 * are unique, a name survives an earlier delete, an index does not - so the live
 * choice uses the same answer rather than a second mechanism.
 */
const INFOS = [
  { index: 0, name: 'Series 1' },
  { index: 1, name: 'Series 2' },
  { index: 2, name: 'Series 3' },
];

describe('the error target survives what an index does not', () => {
  it('names the series the user chose', () => {
    expect(resolveErrorTarget(INFOS, 'Series 3', 0)).toBe(2);
  });

  it('⚑ still names it after an EARLIER series is deleted, though its index moved', () => {
    // "Series 1" is gone; the survivors renumber. An index of 2 would now be out
    // of range, and an index of 1 would silently be a different series.
    const after = [
      { index: 0, name: 'Series 2' },
      { index: 1, name: 'Series 3' },
    ];
    expect(resolveErrorTarget(after, 'Series 3', 0)).toBe(1);
  });

  it('⚑ falls back to the ACTIVE series when the chosen one is deleted', () => {
    const after = [
      { index: 0, name: 'Series 1' },
      { index: 1, name: 'Series 2' },
    ];
    // Not index 0, which would be a silent choice: the active series is the one
    // on screen, and the dropdown shows the fallback happen.
    expect(resolveErrorTarget(after, 'Series 3', 1)).toBe(1);
  });

  it('no choice yet means the series you are working on', () => {
    expect(resolveErrorTarget(INFOS, null, 2)).toBe(2);
  });
});
