import { describe, it, expect } from 'vitest';
import {
  interpY,
  scoreRound,
  scoreOrderedRound,
  ERROR_SECONDS_PER_UNIT,
  COVERAGE_PENALTY_S,
  MISS_POINT_S,
  EXTRA_POINT_S,
  MISS_SERIES_S,
  type Pt,
  type AxisRanges,
} from '../challengeScore.js';

const R: AxisRanges = { xRange: 10, yRange: 10 };
const LINE: Pt[] = [
  { x: 0, y: 0 },
  { x: 10, y: 10 },
]; // y = x

describe('interpY', () => {
  it('interpolates within the domain and returns null outside it', () => {
    expect(interpY(LINE, 5)).toBeCloseTo(5, 6);
    expect(interpY(LINE, 0)).toBeCloseTo(0, 6);
    expect(interpY(LINE, -1)).toBeNull();
    expect(interpY(LINE, 11)).toBeNull();
  });
});

describe('scoreRound - curve family', () => {
  it('a perfect trace adds ~0 penalty', () => {
    const s = scoreRound('curve', [LINE], [LINE], R, 20);
    expect(s.penaltySeconds).toBeCloseTo(0, 6);
    expect(s.adjustedSeconds).toBeCloseTo(20, 6);
    expect(s.breakdown.misses).toBe(0);
    expect(s.breakdown.extras).toBe(0);
  });

  it('a uniform 10%-of-range y offset taxes the mean error, not the count', () => {
    const off = [
      { x: 0, y: 1 },
      { x: 5, y: 6 },
      { x: 10, y: 11 },
    ]; // +1 in y everywhere, yRange 10 -> 0.1
    const s = scoreRound('curve', [off], [LINE], R, 0);
    expect(s.breakdown.meanErrorFrac).toBeCloseTo(0.1, 6);
    expect(s.breakdown.errorSeconds).toBeCloseTo(0.1 * ERROR_SECONDS_PER_UNIT, 6);
    expect(s.breakdown.coverageSeconds).toBeCloseTo(0, 6);
  });

  it('tracing only half the x-span incurs a coverage penalty', () => {
    const half: Pt[] = [
      { x: 0, y: 0 },
      { x: 5, y: 5 },
    ]; // left half, on the curve
    const s = scoreRound('curve', [half], [LINE], R, 0);
    expect(s.breakdown.errorSeconds).toBeCloseTo(0, 6);
    expect(s.breakdown.coverageSeconds).toBeCloseTo(0.5 * COVERAGE_PENALTY_S, 6);
  });

  it('a missed whole curve in a multi-curve round costs one series miss', () => {
    const truth: Pt[][] = [
      [{ x: 0, y: 0 }, { x: 10, y: 0 }],
      [{ x: 0, y: 10 }, { x: 10, y: 10 }],
      [{ x: 0, y: 20 }, { x: 10, y: 20 }],
      [{ x: 0, y: 30 }, { x: 10, y: 30 }],
    ];
    const user = truth.slice(0, 3).map((s) => s.map((p) => ({ ...p }))); // traced 3 of 4, perfectly
    const s = scoreRound('curve', user, truth, { xRange: 10, yRange: 30 }, 0);
    expect(s.breakdown.matchedCount).toBe(3);
    expect(s.breakdown.misses).toBe(1);
    expect(s.breakdown.missSeconds).toBe(MISS_SERIES_S);
    expect(s.breakdown.errorSeconds).toBeCloseTo(0, 6);
  });
});

describe('scoreRound - scatter family', () => {
  const truth: Pt[] = [
    { x: 1, y: 1 },
    { x: 2, y: 2 },
    { x: 3, y: 3 },
  ];

  it('a perfect set adds ~0 penalty', () => {
    const s = scoreRound('scatter', [truth], [truth], R, 10);
    expect(s.penaltySeconds).toBeCloseTo(0, 6);
    expect(s.breakdown.misses).toBe(0);
    expect(s.breakdown.extras).toBe(0);
  });

  it('a missing point is exactly one miss (not everything wrong)', () => {
    const user = [truth[0]!, truth[1]!]; // omit (3,3)
    const s = scoreRound('scatter', [user], [truth], R, 0);
    expect(s.breakdown.matchedCount).toBe(2);
    expect(s.breakdown.misses).toBe(1);
    expect(s.breakdown.missSeconds).toBe(MISS_POINT_S);
    expect(s.breakdown.extras).toBe(0);
  });

  it('a spurious far point is one extra, and does not steal a match', () => {
    const user = [truth[0]!, truth[1]!, truth[2]!, { x: 8, y: 8 }];
    const s = scoreRound('scatter', [user], [truth], R, 0);
    expect(s.breakdown.matchedCount).toBe(3);
    expect(s.breakdown.extras).toBe(1);
    expect(s.breakdown.extraSeconds).toBe(EXTRA_POINT_S);
    expect(s.breakdown.misses).toBe(0);
  });

  it('a small positional error is taxed proportionally (summed over points)', () => {
    const user = [
      { x: 1, y: 2 }, // 0.1 off in y
      { x: 2, y: 2 },
      { x: 3, y: 3 },
    ];
    const s = scoreRound('scatter', [user], [truth], R, 0);
    // one point 0.1 off, two dead-on -> errorSeconds ~= 0.1 * K
    expect(s.breakdown.errorSeconds).toBeCloseTo(0.1 * ERROR_SECONDS_PER_UNIT, 5);
    expect(s.breakdown.matchedCount).toBe(3);
  });
});

describe('scoreOrderedRound - bar / box families', () => {
  const RANGE = 450;

  it('a perfect bar set adds ~0 penalty', () => {
    const truth = [[345], [285], [210]];
    const s = scoreOrderedRound(truth, truth, RANGE, 12);
    expect(s.penaltySeconds).toBeCloseTo(0, 6);
    expect(s.adjustedSeconds).toBeCloseTo(12, 6);
  });

  it('a bar value off by 10% of the range is taxed proportionally', () => {
    const s = scoreOrderedRound([[345 + 45]], [[345]], RANGE, 0); // 45/450 = 0.1
    expect(s.breakdown.errorSeconds).toBeCloseTo(0.1 * ERROR_SECONDS_PER_UNIT, 5);
  });

  it('a missing bar is one miss; a surplus bar is one extra', () => {
    const truth = [[345], [285]];
    expect(scoreOrderedRound([[345]], truth, RANGE, 0).breakdown.missSeconds).toBe(MISS_POINT_S);
    expect(scoreOrderedRound([[345], [285], [1]], truth, RANGE, 0).breakdown.extraSeconds).toBe(EXTRA_POINT_S);
  });

  it('box five-number vectors average the component error', () => {
    const truth = [[250, 300, 340, 380, 420]];
    const user = [[250, 300, 340 + 45, 380, 420]]; // only the median is 45 off (0.1)
    const s = scoreOrderedRound(user, truth, RANGE, 0);
    // mean over 5 components = 0.1/5 = 0.02
    expect(s.breakdown.errorSeconds).toBeCloseTo(0.02 * ERROR_SECONDS_PER_UNIT, 5);
    expect(s.breakdown.matchedCount).toBe(1);
  });
});

describe('a curve must be traced, not merely spanned', () => {
  /**
   * ⚑⚑ THE UNDER-SAMPLING EXPLOIT. `fitCurveSeries` measured deviation in ONE
   * direction - the truth interpolated at each USER x - so the error was only
   * ever sampled where the player chose to click. Two clicks, one at each end,
   * put both of them exactly on the curve (error 0) and spanned the full x range
   * (coverage 0), scoring a flat zero penalty. The game ranks on TIME, so the
   * winning strategy was to trace as little as possible.
   *
   * These cases are named for what a PLAYER does, not for the function.
   */
  const R: AxisRanges = { xRange: 10, yRange: 100 };
  // A peak at x=4 that a straight endpoint-to-endpoint line cannot pass through.
  const PEAKED: Pt[][] = [[{ x: 1, y: 12 }, { x: 4, y: 71 }, { x: 9, y: 33 }]];

  it('clicking only the two endpoints does NOT score as a perfect trace', () => {
    const endpointsOnly = scoreRound('curve', [[{ x: 1, y: 12 }, { x: 9, y: 33 }]], PEAKED, R, 10);
    const perfect = scoreRound('curve', PEAKED, PEAKED, R, 10);
    expect(perfect.penaltySeconds).toBeCloseTo(0, 6);
    expect(endpointsOnly.penaltySeconds).toBeGreaterThan(0);
    expect(endpointsOnly.adjustedSeconds).toBeGreaterThan(perfect.adjustedSeconds);
  });

  it('the penalty is proportional to the shape actually missed', () => {
    // The straight line reads 19.875 at x=4 where the truth is 71 -> 0.51125 of
    // the y range, averaged over three truth samples and then over the two
    // directions (the user's own two points sit exactly on the curve, so that
    // direction contributes 0).
    const s = scoreRound('curve', [[{ x: 1, y: 12 }, { x: 9, y: 33 }]], PEAKED, R, 10);
    expect(s.breakdown.meanErrorFrac).toBeCloseTo(0.51125 / 3 / 2, 6);
  });

  it('a trace that follows the shape beats one that cuts the corner', () => {
    const follows = scoreRound('curve', [[{ x: 1, y: 12 }, { x: 4, y: 68 }, { x: 9, y: 33 }]], PEAKED, R, 10);
    const cuts = scoreRound('curve', [[{ x: 1, y: 12 }, { x: 9, y: 33 }]], PEAKED, R, 10);
    expect(follows.adjustedSeconds).toBeLessThan(cuts.adjustedSeconds);
  });

  it('a perfect trace still scores exactly zero penalty', () => {
    // The fix must not tax an honest trace: both directions are 0, so the mean is 0.
    const s = scoreRound('curve', PEAKED, PEAKED, R, 10);
    expect(s.penaltySeconds).toBeCloseTo(0, 6);
    expect(s.adjustedSeconds).toBeCloseTo(10, 6);
  });

  it('a uniformly wrong trace is charged the same as before the fix', () => {
    // Both directions agree when the user's points share the truth's x values,
    // so this case is untouched -- the change is confined to under-sampling.
    const s = scoreRound('curve', [[{ x: 1, y: 90 }, { x: 4, y: 5 }, { x: 9, y: 99 }]], PEAKED, R, 10);
    expect(s.breakdown.meanErrorFrac).toBeCloseTo(0.7, 6);
  });

  it('extra clicks BETWEEN the truth points are not punished for being extra', () => {
    // Denser sampling along the same shape must not cost anything -- otherwise
    // the fix would just invert the exploit and reward under-tracing's opposite.
    const dense: Pt[] = [];
    for (let x = 1; x <= 9; x += 0.5) {
      const y = x <= 4 ? 12 + ((x - 1) / 3) * 59 : 71 - ((x - 4) / 5) * 38;
      dense.push({ x, y });
    }
    const s = scoreRound('curve', [dense], PEAKED, R, 10);
    expect(s.penaltySeconds).toBeCloseTo(0, 6);
  });
});
