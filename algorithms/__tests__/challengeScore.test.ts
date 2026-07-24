import { describe, it, expect } from 'vitest';
import {
  interpY,
  scoreRound,
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

describe('scoreRound — curve family', () => {
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

describe('scoreRound — scatter family', () => {
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
