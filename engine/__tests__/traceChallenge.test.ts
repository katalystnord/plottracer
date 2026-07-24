import { describe, it, expect } from 'vitest';
import {
  drawRounds,
  calibrationInputsFromAnchors,
  truthAxisRanges,
  truthSeriesPoints,
  type ChallengeCalibration,
  type ChallengeTruth,
} from '../traceChallenge.js';

/** Tiny deterministic RNG (mulberry32) so draws are reproducible in tests. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('drawRounds', () => {
  const pool = ['a', 'b', 'c', 'd'];

  it('clamps the size to the pool and returns only pool members', () => {
    const got = drawRounds(pool, 5, seeded(1));
    expect(got.length).toBe(4); // asked for 5, only 4 available
    expect(new Set(got)).toEqual(new Set(pool)); // a permutation, no dupes/strangers
  });

  it('is deterministic for a given seed and picks the requested count', () => {
    const a = drawRounds(pool, 3, seeded(42));
    const b = drawRounds(pool, 3, seeded(42));
    expect(a).toEqual(b);
    expect(a.length).toBe(3);
    a.forEach((x) => expect(pool).toContain(x));
  });
});

describe('calibrationInputsFromAnchors', () => {
  const cal: ChallengeCalibration = {
    imageWidth: 900,
    imageHeight: 700,
    anchors: {
      x1: { px: 77.5, py: 636.7, value: 0 },
      x2: { px: 875.2, py: 636.7, value: 10 },
      y1: { px: 77.5, py: 636.7, value: 0 },
      y2: { px: 77.5, py: 39.3, value: 120 },
    },
  };

  it('maps the 4 anchors to adoptCalibration placed input with string values', () => {
    const inp = calibrationInputsFromAnchors(cal);
    expect(Object.keys(inp.placed).sort()).toEqual(['x1', 'x2', 'y1', 'y2']);
    expect(inp.placed.x2).toEqual({ px: 875.2, py: 636.7, values: ['10'] });
    expect(inp.placed.y2).toEqual({ px: 77.5, py: 39.3, values: ['120'] });
    expect(inp.optionValues).toEqual({});
    expect(inp.globalValues).toEqual({});
  });
});

describe('truth adapters', () => {
  const truth: ChallengeTruth = {
    graphType: 'xy',
    axes: { x: { label: 'X', min: 0, max: 10 }, y: { label: 'Y', min: 0, max: 120 } },
    calibration: {} as ChallengeCalibration,
    series: [{ name: 's', points: [{ x: 1, y: 2 }, { x: 3, y: 4 }] }],
  };

  it('derives axis ranges and per-series points', () => {
    expect(truthAxisRanges(truth)).toEqual({ xRange: 10, yRange: 120 });
    expect(truthSeriesPoints(truth)).toEqual([[{ x: 1, y: 2 }, { x: 3, y: 4 }]]);
  });
});
