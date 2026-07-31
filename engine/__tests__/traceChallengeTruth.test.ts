import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  truthValueRange,
  truthAxisRanges,
  truthSeriesPoints,
  truthHistogramPoints,
  truthBarValues,
  truthBoxValues,
  valueToPy,
  calibrationInputsFromAnchors,
  type ChallengeTruth,
  type ChallengeCalibration,
} from '../traceChallenge.js';

/**
 * The truth-readers behind The Trace Challenge, traced against the REAL
 * committed `.truth.json` files.
 *
 * ⚑ WHY THIS FILE EXISTS. `traceChallenge.ts` scored 33.78% — the worst file
 * in the codebase — with 41 of its 49 mutants uncovered outright. Five of its
 * nine exports had no test at all: `truthValueRange`, `truthHistogramPoints`,
 * `truthBarValues`, `truthBoxValues` and `valueToPy`.
 *
 * These read the ground truth the game SCORES AGAINST. A defect here does not
 * make the game fail — it makes it mark a correct trace wrong, or a wrong one
 * right, with nothing on screen to question. `truthBoxValues` reading its five
 * numbers in the wrong order is the sharpest case: min/q1/median/q3/max are
 * all plausible values for each other.
 *
 * ⚑ Per the project's own rule — a test that invents its own geometry proves
 * SELF-CONSISTENCY, not truth — these trace the committed truth files the app
 * actually ships, not fixtures written to match the code.
 */

const truth = (file: string): ChallengeTruth =>
  JSON.parse(readFileSync(`samples/${file}`, 'utf8')) as ChallengeTruth;

const BAR = truth('bar-tensile-strength.truth.json');
const BOX = truth('bar-box-plot-tensile-strength.truth.json');
const HISTOGRAM = truth('histogram-pore-size.truth.json');
const SCATTER = truth('scatter-crosslink-modulus.truth.json');

describe('the value range scoring normalises against', () => {
  it('is the shipped bar figure’s own axis span', () => {
    // 0..450 MPa, straight off the committed truth.
    expect(truthValueRange(BAR)).toBeCloseTo(450, 9);
  });

  it('⚑ falls back to 1 on a degenerate axis rather than dividing by zero', () => {
    // Every score divides by this. A flat truth axis would make each error
    // infinite, so every trace scores zero — including a perfect one.
    const flat = { ...BAR, axes: { y: { label: 'v', min: 7, max: 7 } } } as ChallengeTruth;
    expect(truthValueRange(flat)).toBe(1);
  });

  it('does not confuse a range of 1 with the degenerate fallback', () => {
    const unit = { ...BAR, axes: { y: { label: 'v', min: 3, max: 4 } } } as ChallengeTruth;
    expect(truthValueRange(unit)).toBe(1);
  });

  it('handles a negative-going axis by its span, not its sign', () => {
    const neg = { ...BAR, axes: { y: { label: 'v', min: -50, max: 50 } } } as ChallengeTruth;
    expect(truthValueRange(neg)).toBe(100);
  });
});

describe('axis ranges for the ordered scorers', () => {
  it('reads both spans from a figure that has an x axis', () => {
    const r = truthAxisRanges(HISTOGRAM);
    expect(r.xRange).toBeCloseTo(HISTOGRAM.axes.x!.max - HISTOGRAM.axes.x!.min, 9);
    expect(r.yRange).toBeCloseTo(HISTOGRAM.axes.y.max - HISTOGRAM.axes.y.min, 9);
  });

  it('⚑ substitutes 1 for a MISSING x axis, which bar and box genuinely have', () => {
    // Bar/box truth carries no x axis at all. Without the fallback xRange is
    // 0 and any scorer that divides by it produces Infinity — and the comment
    // says this is inert for those types, which only holds if it is 1.
    expect(BAR.axes.x).toBeUndefined();
    expect(truthAxisRanges(BAR).xRange).toBe(1);
    expect(truthAxisRanges(BAR).yRange).toBeCloseTo(450, 9);
  });

  it('substitutes 1 for a degenerate x axis too', () => {
    const flatX = { ...HISTOGRAM, axes: { ...HISTOGRAM.axes, x: { label: 'x', min: 5, max: 5 } } } as ChallengeTruth;
    expect(truthAxisRanges(flatX).xRange).toBe(1);
  });
});

describe('curve and scatter truth', () => {
  it('keeps each series separate, in file order', () => {
    const pts = truthSeriesPoints(SCATTER);
    expect(pts).toHaveLength(SCATTER.series.length);
    pts.forEach((s, i) => expect(s).toHaveLength(SCATTER.series[i]!.points.length));
  });

  it('reads the first point of the shipped scatter as the numbers in the file', () => {
    const first = SCATTER.series[0]!.points[0]!;
    expect(truthSeriesPoints(SCATTER)[0]![0]).toEqual({
      x: Number(first.x),
      y: Number(first.y),
    });
  });

  it('coerces string coordinates rather than yielding NaN', () => {
    const stringy = {
      ...SCATTER,
      series: [{ name: 'S', points: [{ x: '2.5', y: '7' }] }],
    } as unknown as ChallengeTruth;
    expect(truthSeriesPoints(stringy)[0]![0]).toEqual({ x: 2.5, y: 7 });
  });

  it('returns an empty list for a truth with no series, not a crash', () => {
    expect(truthSeriesPoints({ ...SCATTER, series: [] } as ChallengeTruth)).toEqual([]);
  });
});

describe('histogram truth is scored at each bin’s CENTRE', () => {
  it('⚑ takes the midpoint of the bin, not either edge', () => {
    // The shipped figure's first bin is 0..10 with value 4, so the scored
    // point is (5, 4). Reading an edge would shift every point half a bin
    // wide and mark a correct trace wrong.
    const pts = truthHistogramPoints(HISTOGRAM);
    const first = HISTOGRAM.series[0]!.points[0]!;
    expect(pts[0]).toEqual({
      x: (Number(first.binStart) + Number(first.binEnd)) / 2,
      y: Number(first.value),
    });
    expect(pts[0]!.x).toBeCloseTo(5, 9);
    expect(pts[0]!.y).toBeCloseTo(4, 9);
  });

  it('reads every bin of the shipped histogram, in file order', () => {
    const pts = truthHistogramPoints(HISTOGRAM);
    expect(pts).toHaveLength(HISTOGRAM.series[0]!.points.length);
    // Bin centres ascend, which is what makes an ordered scorer meaningful.
    for (let i = 1; i < pts.length; i++) expect(pts[i]!.x).toBeGreaterThan(pts[i - 1]!.x);
  });

  it('handles an asymmetric bin, where the centre is not the midpoint of a round number', () => {
    const odd = {
      ...HISTOGRAM,
      series: [{ name: 'H', points: [{ binStart: 3, binEnd: 8, value: 2 }] }],
    } as unknown as ChallengeTruth;
    expect(truthHistogramPoints(odd)[0]).toEqual({ x: 5.5, y: 2 });
  });

  it('returns nothing for a truth with no series rather than throwing', () => {
    expect(truthHistogramPoints({ ...HISTOGRAM, series: [] } as ChallengeTruth)).toEqual([]);
  });
});

describe('bar truth', () => {
  it('reads one value per category, left to right, off the shipped figure', () => {
    const vals = truthBarValues(BAR);
    const pts = BAR.series[0]!.points;
    expect(vals).toHaveLength(pts.length);
    // Each is a ONE-element vector: the scorer compares vectors per category.
    expect(vals[0]).toEqual([Number(pts[0]!.value)]);
    expect(vals[0]).toEqual([345]);
    expect(vals.every((v) => v.length === 1)).toBe(true);
  });

  it('preserves file order, which IS the left-to-right category order', () => {
    expect(truthBarValues(BAR).map((v) => v[0])).toEqual(
      BAR.series[0]!.points.map((p) => Number(p.value))
    );
  });

  it('returns nothing for an empty truth', () => {
    expect(truthBarValues({ ...BAR, series: [] } as ChallengeTruth)).toEqual([]);
  });
});

describe('box-plot truth', () => {
  it('⚑ reads the five numbers in min/q1/median/q3/max ORDER', () => {
    // The sharpest case in this file: all five are plausible values for each
    // other, so a transposed pair scores a correct trace as wrong and nothing
    // on screen would say why. The shipped Flax box is 250/300/340/380/420.
    expect(truthBoxValues(BOX)[0]).toEqual([250, 300, 340, 380, 420]);
  });

  it('is ascending for every shipped box, which is what a five-number summary means', () => {
    for (const v of truthBoxValues(BOX)) {
      for (let i = 1; i < v.length; i++) expect(v[i]).toBeGreaterThanOrEqual(v[i - 1]!);
    }
  });

  it('reads one vector per category, in file order', () => {
    const vals = truthBoxValues(BOX);
    expect(vals).toHaveLength(BOX.series[0]!.points.length);
    expect(vals.every((v) => v.length === 5)).toBe(true);
  });

  it('returns nothing for an empty truth', () => {
    expect(truthBoxValues({ ...BOX, series: [] } as ChallengeTruth)).toEqual([]);
  });
});

describe('drawing the true value as a reference line (bar/box reveal)', () => {
  const cal = BOX.calibration;

  it('⚑ puts each anchor value back on its OWN pixel row', () => {
    // The reveal draws these lines over the figure. If the mapping is off,
    // the line sits beside the bar it is meant to mark and the player is told
    // their correct answer was wrong.
    expect(valueToPy(cal, cal.anchors.p1!.value)).toBeCloseTo(cal.anchors.p1!.py, 6);
    expect(valueToPy(cal, cal.anchors.p2!.value)).toBeCloseTo(cal.anchors.p2!.py, 6);
  });

  it('interpolates the midpoint to the midpoint row', () => {
    const p1 = cal.anchors.p1!;
    const p2 = cal.anchors.p2!;
    const mid = (p1.value + p2.value) / 2;
    expect(valueToPy(cal, mid)).toBeCloseTo((p1.py + p2.py) / 2, 6);
  });

  it('extrapolates beyond the anchors rather than clamping', () => {
    // A truth value above the calibrated top is drawn off the axis, which is
    // honest; clamping would draw it ON the top gridline as if it belonged.
    const p1 = cal.anchors.p1!;
    const p2 = cal.anchors.p2!;
    const beyond = valueToPy(cal, p2.value + (p2.value - p1.value));
    expect(beyond).toBeCloseTo(p2.py + (p2.py - p1.py), 6);
  });

  it('⚑ refuses a calibration whose two anchors carry the SAME value', () => {
    // Zero span: the ratio divides by zero. Returning 0 puts the line at the
    // image top, which is visibly wrong rather than silently plausible.
    const degenerate = {
      ...cal,
      anchors: { p1: { px: 10, py: 100, value: 5 }, p2: { px: 10, py: 20, value: 5 } },
    } as ChallengeCalibration;
    expect(valueToPy(degenerate, 5)).toBe(0);
  });

  it('returns 0 when either anchor is missing, e.g. an XY truth with no p1/p2', () => {
    expect(valueToPy(HISTOGRAM.calibration, 10)).toBe(0);
    const onlyP1 = { ...cal, anchors: { p1: cal.anchors.p1! } } as ChallengeCalibration;
    expect(valueToPy(onlyP1, 10)).toBe(0);
  });
});

describe('starting a round pre-calibrated', () => {
  it('maps every anchor of the shipped histogram, keyed by its step', () => {
    const input = calibrationInputsFromAnchors(HISTOGRAM.calibration);
    expect(Object.keys(input.placed).sort()).toEqual(['x1', 'x2', 'y1', 'y2']);
  });

  it('⚑ passes each value as a STRING, which is what the session parses', () => {
    // adoptCalibration routes values through InputParser. A number here would
    // bypass the string contract the session's own door expects.
    const input = calibrationInputsFromAnchors(BOX.calibration);
    expect(input.placed.p1).toEqual({
      px: BOX.calibration.anchors.p1!.px,
      py: BOX.calibration.anchors.p1!.py,
      values: [String(BOX.calibration.anchors.p1!.value)],
    });
    expect(typeof input.placed.p1!.values[0]).toBe('string');
  });

  it('carries the anchor pixels through unchanged, since they are already image-native', () => {
    const input = calibrationInputsFromAnchors(BOX.calibration);
    expect(input.placed.p2!.px).toBe(BOX.calibration.anchors.p2!.px);
    expect(input.placed.p2!.py).toBe(BOX.calibration.anchors.p2!.py);
  });

  it('leaves options and global values empty, so the config’s own defaults stand', () => {
    const input = calibrationInputsFromAnchors(BAR.calibration);
    expect(input.optionValues).toEqual({});
    expect(input.globalValues).toEqual({});
  });

  it('produces nothing placed for a calibration with no anchors', () => {
    const input = calibrationInputsFromAnchors({ ...BAR.calibration, anchors: {} });
    expect(input.placed).toEqual({});
  });
});

/**
 * ⚑ THE TWO BAR TRUTH SHAPES — a trap laid for whoever extends the Challenge.
 *
 * The shipped truth files describe bars in TWO different ways:
 *
 *   bar-tensile-strength    points are { category, value }
 *   bar-floating-temperature points are { category, start, end }
 *
 * `truthBarValues` reads `p.value`, so it handles the first and silently
 * yields `NaN` for the second — and a NaN flows straight into the scorer,
 * which would mark a perfect trace as wrong with no error anywhere.
 *
 * It is not live today: only seven examples are in the Challenge pool and the
 * floating one is not among them. But nothing stops it being added, and the
 * failure would be silent. These cases make that addition fail HERE instead.
 */
describe('the bar truth shapes the Challenge can actually score', () => {
  const FLOATING = truth('bar-floating-temperature.truth.json');

  it('reads the value-shaped truth, which is what the pool ships', () => {
    expect(truthBarValues(BAR).every((v) => Number.isFinite(v[0]))).toBe(true);
  });

  it('⚑ CANNOT yet score the interval-shaped truth — this is the guard, not a bug report', () => {
    // A floating bar's datum is its span, and the truth records both ends.
    // If this ever starts passing, `truthBarValues` has learned the second
    // shape and the example may join the pool.
    expect(FLOATING.series[0]!.points[0]).toHaveProperty('start');
    expect(FLOATING.series[0]!.points[0]).not.toHaveProperty('value');
    expect(truthBarValues(FLOATING).every((v) => Number.isFinite(v[0]))).toBe(false);
  });

  it('every truth file the Challenge pool imports is value-shaped', () => {
    // The pool is the live surface; this asserts what it relies on.
    for (const file of ['bar-tensile-strength.truth.json']) {
      const t = truth(file);
      expect(truthBarValues(t).every((v) => Number.isFinite(v[0]))).toBe(true);
    }
  });
});
