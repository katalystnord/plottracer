import { describe, expect, it } from 'vitest';
import {
  scoreRound,
  scoreOrderedRound,
  interpY,
  ERROR_SECONDS_PER_UNIT,
  MISS_POINT_S,
  EXTRA_POINT_S,
  SCATTER_MATCH_THRESHOLD,
} from '../challengeScore.js';

/**
 * The scorer's MATCHING and its degenerate cases.
 *
 * ⚑ WHY THIS FILE EXISTS. `challengeScore.ts` carries 58 surviving mutants,
 * and they sit in the parts the existing suite exercises only through
 * well-behaved rounds: the scatter matcher's greedy one-to-one assignment
 * (which decides what counts as a match at all), and both scorers' "nothing
 * matched" fallbacks.
 *
 * A scoring defect is quiet by construction — the game shows a number, and no
 * number is obviously wrong. The one that matters most is the fallback: with
 * nothing matched, `meanErrorFrac` is 1 rather than 0/0, because a mean of no
 * errors is not zero error. Mutated to 0 it would report a PERFECT trace for a
 * player who placed nothing anywhere near the truth.
 */

const pt = (x: number, y: number) => ({ x, y });
const R = { xRange: 10, yRange: 10 };

describe('the scatter matcher pairs each point at most once', () => {
  it('⚑ takes the CLOSEST pairing first, so a near point cannot be stolen', () => {
    // Two user points sit near one truth point. The greedy pass is sorted by
    // distance, so the nearer one claims the match and the other is an extra
    // — never both matching the same truth.
    const truth = [pt(5, 5)];
    const user = [pt(5.9, 5), pt(5.05, 5)];
    const s = scoreRound('scatter', [user], [truth], R, 0);
    expect(s.breakdown.matchedCount).toBe(1);
    expect(s.breakdown.extras).toBe(1);
    expect(s.breakdown.misses).toBe(0);
    // The error taxed is the NEARER one's, 0.05/10 = 0.005.
    expect(s.breakdown.meanErrorFrac).toBeCloseTo(0.005, 6);
  });

  it('⚑ refuses a pairing beyond the match threshold rather than taking the best available', () => {
    // A point far from everything is an extra AND leaves a miss — not a poor
    // match. Removing the threshold would let one wild click "cover" a truth
    // point and quietly halve the penalty.
    const truth = [pt(5, 5)];
    const user = [pt(9, 9)];
    const s = scoreRound('scatter', [user], [truth], R, 0);
    expect(s.breakdown.matchedCount).toBe(0);
    expect(s.breakdown.misses).toBe(1);
    expect(s.breakdown.extras).toBe(1);
  });

  it('matches exactly at the threshold, which the comparison must admit', () => {
    // The distance is normalised by the axis ranges, so 0.15 of the range is
    // 1.5 units on a 10-unit axis.
    const truth = [pt(5, 5)];
    const atLimit = [pt(5 + SCATTER_MATCH_THRESHOLD * R.xRange, 5)];
    expect(scoreRound('scatter', [atLimit], [truth], R, 0).breakdown.matchedCount).toBe(1);

    const justOver = [pt(5 + SCATTER_MATCH_THRESHOLD * R.xRange + 0.01, 5)];
    expect(scoreRound('scatter', [justOver], [truth], R, 0).breakdown.matchedCount).toBe(0);
  });

  it('normalises by EACH axis separately, so a wide x axis is not over-taxed', () => {
    // Same absolute offset on axes of different span must not score the same;
    // a single shared range would make one of them wrong.
    const truth = [pt(5, 5)];
    const user = [pt(6, 5)];
    const wide = scoreRound('scatter', [user], [truth], { xRange: 100, yRange: 10 }, 0);
    const narrow = scoreRound('scatter', [user], [truth], { xRange: 10, yRange: 10 }, 0);
    expect(wide.breakdown.meanErrorFrac).toBeLessThan(narrow.breakdown.meanErrorFrac);
  });

  it('⚑ reports a FULL error fraction when nothing matched, not zero', () => {
    // A mean over no matches is not zero error. Mutated to 0 this would call
    // a trace with nothing near the truth perfect.
    const s = scoreRound('scatter', [[pt(0, 0)]], [[pt(9, 9)]], R, 0);
    expect(s.breakdown.matchedCount).toBe(0);
    expect(s.breakdown.meanErrorFrac).toBe(1);
  });

  it('counts a whole missing series as misses, and a whole spurious one as extras', () => {
    const truth = [pt(1, 1), pt(2, 2)];
    const none = scoreRound('scatter', [[]], [truth], R, 0);
    expect(none.breakdown.misses).toBe(2);
    expect(none.breakdown.extras).toBe(0);

    const spurious = scoreRound('scatter', [truth], [[]], R, 0);
    expect(spurious.breakdown.extras).toBe(2);
    expect(spurious.breakdown.misses).toBe(0);
  });

  it('prices a miss above an extra, because a missing datum is the worse error', () => {
    expect(MISS_POINT_S).toBeGreaterThan(EXTRA_POINT_S);
    const missed = scoreRound('scatter', [[]], [[pt(1, 1)]], R, 0);
    const extra = scoreRound('scatter', [[pt(1, 1)]], [[]], R, 0);
    expect(missed.penaltySeconds).toBeGreaterThan(extra.penaltySeconds);
  });
});

describe('the ordered scorer (bar and box)', () => {
  it('compares item by item, in order — position IS the identity', () => {
    // Bars are matched left to right, not by nearness: a bar in the wrong
    // slot is a wrong reading, not a near miss.
    const s = scoreOrderedRound([[10], [20]], [[20], [10]], 100, 0);
    expect(s.breakdown.matchedCount).toBe(2);
    expect(s.breakdown.meanErrorFrac).toBeCloseTo(0.1, 6);
  });

  it('⚑ averages the components of a five-number box, not their sum', () => {
    // Otherwise a box plot would be taxed five times as hard as a bar for the
    // same proportional error.
    const s = scoreOrderedRound([[1, 2, 3, 4, 5]], [[2, 3, 4, 5, 6]], 100, 0);
    expect(s.breakdown.meanErrorFrac).toBeCloseTo(0.01, 6);
  });

  it('scores a perfect ordered set at zero penalty', () => {
    const s = scoreOrderedRound([[10], [20]], [[10], [20]], 100, 0);
    expect(s.breakdown.meanErrorFrac).toBeCloseTo(0, 9);
    expect(s.penaltySeconds).toBeCloseTo(0, 9);
  });

  it('counts the shortfall as misses and the surplus as extras', () => {
    const short = scoreOrderedRound([[10]], [[10], [20], [30]], 100, 0);
    expect(short.breakdown.misses).toBe(2);
    expect(short.breakdown.extras).toBe(0);

    const over = scoreOrderedRound([[10], [20], [30]], [[10]], 100, 0);
    expect(over.breakdown.extras).toBe(2);
    expect(over.breakdown.misses).toBe(0);
  });

  it('⚑ never reports a NEGATIVE miss or extra count', () => {
    // Both are clamped at zero; without the clamp one of the two is negative
    // whenever the counts differ, and it would subtract seconds from the
    // penalty — rewarding the player for getting it wrong.
    const s = scoreOrderedRound([[1], [2], [3]], [[1]], 100, 0);
    expect(s.breakdown.misses).toBeGreaterThanOrEqual(0);
    expect(s.breakdown.extras).toBeGreaterThanOrEqual(0);
    expect(s.penaltySeconds).toBeGreaterThanOrEqual(0);
  });

  it('⚑ reports a FULL error fraction for an empty attempt, not zero', () => {
    const s = scoreOrderedRound([], [[10], [20]], 100, 0);
    expect(s.breakdown.matchedCount).toBe(0);
    expect(s.breakdown.meanErrorFrac).toBe(1);
    expect(s.breakdown.misses).toBe(2);
  });

  it('treats an item with no components as fully wrong rather than as perfect', () => {
    // An empty vector shares no component with the truth, so there is nothing
    // to have got right.
    const s = scoreOrderedRound([[]], [[10]], 100, 0);
    expect(s.breakdown.meanErrorFrac).toBe(1);
  });

  it('compares only the components BOTH carry, rather than reading past the end', () => {
    const s = scoreOrderedRound([[10, 20, 30]], [[10, 20]], 100, 0);
    expect(s.breakdown.meanErrorFrac).toBeCloseTo(0, 9);
  });

  it('adds the penalty to the raw time, which is what the player is ranked on', () => {
    const s = scoreOrderedRound([[10]], [[20]], 100, 12.5);
    expect(s.rawSeconds).toBe(12.5);
    expect(s.adjustedSeconds).toBeCloseTo(12.5 + s.penaltySeconds, 9);
    expect(s.penaltySeconds).toBeCloseTo(0.1 * ERROR_SECONDS_PER_UNIT, 6);
  });
});

describe('interpolating the user’s curve at a truth x', () => {
  it('returns null outside the traced domain, which is what a coverage gap IS', () => {
    const curve = [pt(0, 0), pt(10, 10)];
    expect(interpY(curve, -1)).toBeNull();
    expect(interpY(curve, 11)).toBeNull();
  });

  it('includes both endpoints of the domain', () => {
    const curve = [pt(0, 0), pt(10, 10)];
    expect(interpY(curve, 0)).toBeCloseTo(0, 9);
    expect(interpY(curve, 10)).toBeCloseTo(10, 9);
  });

  it('interpolates linearly between the bracketing points', () => {
    expect(interpY([pt(0, 0), pt(10, 100)], 2.5)).toBeCloseTo(25, 9);
  });

  it('handles a vertical pair without dividing by zero', () => {
    const v = interpY([pt(5, 1), pt(5, 9)], 5);
    expect(v === null || Number.isFinite(v)).toBe(true);
  });

  it('returns null for an empty curve rather than throwing', () => {
    expect(interpY([], 1)).toBeNull();
  });

  it('returns the single point’s y only at its own x', () => {
    expect(interpY([pt(3, 7)], 4)).toBeNull();
  });
});
