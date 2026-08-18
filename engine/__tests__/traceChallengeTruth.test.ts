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
  drawGradedRounds,
  DEFAULT_GRADE_PLAN,
  type ChallengeGrade,
  singleAnchor,
  anchorList,
  truthSpiderPoints,
  spiderUserPoints,
  spiderAxisRanges,
  spiderPointAt,
  truthPieValues,
  pieRevealRays,
} from '../traceChallenge.js';
import { SCATTER_MATCH_THRESHOLD } from '../../algorithms/challengeScore.js';

/**
 * The truth-readers behind The Trace Challenge, traced against the REAL
 * committed `.truth.json` files.
 *
 * ⚑ WHY THIS FILE EXISTS. `traceChallenge.ts` scored 33.78% - the worst file
 * in the codebase - with 41 of its 49 mutants uncovered outright. Five of its
 * nine exports had no test at all: `truthValueRange`, `truthHistogramPoints`,
 * `truthBarValues`, `truthBoxValues` and `valueToPy`.
 *
 * These read the ground truth the game SCORES AGAINST. A defect here does not
 * make the game fail - it makes it mark a correct trace wrong, or a wrong one
 * right, with nothing on screen to question. `truthBoxValues` reading its five
 * numbers in the wrong order is the sharpest case: min/q1/median/q3/max are
 * all plausible values for each other.
 *
 * ⚑ Per the project's own rule - a test that invents its own geometry proves
 * SELF-CONSISTENCY, not truth - these trace the committed truth files the app
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
    // infinite, so every trace scores zero - including a perfect one.
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
    expect(r.xRange).toBeCloseTo(HISTOGRAM.axes!.x!.max - HISTOGRAM.axes!.x!.min, 9);
    expect(r.yRange).toBeCloseTo(HISTOGRAM.axes!.y.max - HISTOGRAM.axes!.y.min, 9);
  });

  it('⚑ substitutes 1 for a MISSING x axis, which bar and box genuinely have', () => {
    // Bar/box truth carries no x axis at all. Without the fallback xRange is
    // 0 and any scorer that divides by it produces Infinity - and the comment
    // says this is inert for those types, which only holds if it is 1.
    expect(BAR.axes!.x).toBeUndefined();
    expect(truthAxisRanges(BAR).xRange).toBe(1);
    expect(truthAxisRanges(BAR).yRange).toBeCloseTo(450, 9);
  });

  it('substitutes 1 for a degenerate x axis too', () => {
    const flatX = { ...HISTOGRAM, axes: { ...HISTOGRAM.axes!, x: { label: 'x', min: 5, max: 5 } } } as ChallengeTruth;
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
    expect(valueToPy(cal, singleAnchor(cal, 'p1')!.value!)).toBeCloseTo(singleAnchor(cal, 'p1')!.py, 6);
    expect(valueToPy(cal, singleAnchor(cal, 'p2')!.value!)).toBeCloseTo(singleAnchor(cal, 'p2')!.py, 6);
  });

  it('interpolates the midpoint to the midpoint row', () => {
    const p1 = singleAnchor(cal, 'p1')!;
    const p2 = singleAnchor(cal, 'p2')!;
    const mid = (p1.value! + p2.value!) / 2;
    expect(valueToPy(cal, mid)).toBeCloseTo((p1.py + p2.py) / 2, 6);
  });

  it('extrapolates beyond the anchors rather than clamping', () => {
    // A truth value above the calibrated top is drawn off the axis, which is
    // honest; clamping would draw it ON the top gridline as if it belonged.
    const p1 = singleAnchor(cal, 'p1')!;
    const p2 = singleAnchor(cal, 'p2')!;
    const beyond = valueToPy(cal, p2.value! + (p2.value! - p1.value!));
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
    const onlyP1 = { ...cal, anchors: { p1: singleAnchor(cal, 'p1')! } } as ChallengeCalibration;
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
      px: singleAnchor(BOX.calibration, 'p1')!.px,
      py: singleAnchor(BOX.calibration, 'p1')!.py,
      values: [String(singleAnchor(BOX.calibration, 'p1')!.value)],
    });
    expect(typeof input.placed.p1!.values[0]).toBe('string');
  });

  it('carries the anchor pixels through unchanged, since they are already image-native', () => {
    const input = calibrationInputsFromAnchors(BOX.calibration);
    expect(input.placed.p2!.px).toBe(singleAnchor(BOX.calibration, 'p2')!.px);
    expect(input.placed.p2!.py).toBe(singleAnchor(BOX.calibration, 'p2')!.py);
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
 * ⚑ THE TWO BAR TRUTH SHAPES - a trap laid for whoever extends the Challenge.
 *
 * The shipped truth files describe bars in TWO different ways:
 *
 *   bar-tensile-strength    points are { category, value }
 *   bar-floating-temperature points are { category, start, end }
 *
 * `truthBarValues` reads `p.value`, so it handles the first and silently
 * yields `NaN` for the second - and a NaN flows straight into the scorer,
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

  it('⚑ CANNOT yet score the interval-shaped truth - this is the guard, not a bug report', () => {
    // A floating bar's datum is its span, and the truth records both ends.
    // If this ever starts passing, `truthBarValues` has learned the second
    // shape and the example may join the pool.
    expect(FLOATING.series[0]!.points[0]).toHaveProperty('start');
    expect(FLOATING.series[0]!.points[0]).not.toHaveProperty('value');
    expect(truthBarValues(FLOATING).every((v) => Number.isFinite(v[0]))).toBe(false);
  });

  it('⚑ every truth file the Challenge pool imports is value-shaped', () => {
    // ⚑ The list is DERIVED from the manifest, not typed here. It used to be a
    // one-element hardcoded array while the pool held four bar files, so the
    // test's own title was false and a fifth would have slipped in unchecked
    // (v2.1 audit). `bar-floating` is deliberately NOT in the pool -- see the
    // test above -- and this is what keeps that true.
    const manifest = readFileSync('ui/src/challengeExamples.ts', 'utf8');
    const files = [...manifest.matchAll(/samples\/([\w-]+\.truth\.json)/g)].map((m) => m[1]!);
    const barFiles = files.filter((f) => f.startsWith('bar-') && !f.includes('box'));
    expect(barFiles.length).toBeGreaterThanOrEqual(4); // the pool really does hold several
    for (const file of barFiles) {
      const t = truth(file);
      expect(
        truthBarValues(t).every((v) => Number.isFinite(v[0])),
        `${file} is not value-shaped`
      ).toBe(true);
    }
  });
});

describe('the WEIGHTED round draw (v2.1)', () => {
  type R = { id: string; grade: ChallengeGrade };
  const pool: R[] = [
    { id: 'e1', grade: 'easy' }, { id: 'e2', grade: 'easy' }, { id: 'e3', grade: 'easy' },
    { id: 'm1', grade: 'medium' }, { id: 'm2', grade: 'medium' },
    { id: 'h1', grade: 'hard' }, { id: 'h2', grade: 'hard' },
  ];
  const gradeOf = (r: R) => r.grade;
  /** A deterministic rng, so a draw is reproducible. */
  const seeded = (seed: number) => () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const counts = (rs: R[]) => ({
    easy: rs.filter((r) => r.grade === 'easy').length,
    medium: rs.filter((r) => r.grade === 'medium').length,
    hard: rs.filter((r) => r.grade === 'hard').length,
  });

  it('⚑ gives every game the same SHAPE: two easy, one medium, one hard', () => {
    // The reason the draw is weighted at all: the pool spans a factor of ten in
    // clicks and the scoring currency is time, so a uniform draw made one
    // playthrough's score incomparable with another's.
    for (let s = 1; s <= 25; s++) {
      const rs = drawGradedRounds(pool, gradeOf, DEFAULT_GRADE_PLAN, seeded(s));
      expect(rs).toHaveLength(4);
      expect(counts(rs), `seed ${s}`).toEqual({ easy: 2, medium: 1, hard: 1 });
    }
  });

  it('never repeats a round inside one game', () => {
    for (let s = 1; s <= 25; s++) {
      const ids = drawGradedRounds(pool, gradeOf, DEFAULT_GRADE_PLAN, seeded(s)).map((r) => r.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('varies which rounds come up across games', () => {
    const seen = new Set<string>();
    for (let s = 1; s <= 30; s++) {
      for (const r of drawGradedRounds(pool, gradeOf, DEFAULT_GRADE_PLAN, seeded(s))) seen.add(r.id);
    }
    expect(seen.size).toBeGreaterThan(4); // not the same four every time
  });

  it('⚑ TOPS UP a lopsided pool rather than handing back a short game', () => {
    // A three-round game would read as a bug to the player. The shortfall is
    // filled from whatever is left.
    const thin: R[] = [
      { id: 'e1', grade: 'easy' }, { id: 'e2', grade: 'easy' },
      { id: 'e3', grade: 'easy' }, { id: 'e4', grade: 'easy' },
    ];
    const rs = drawGradedRounds(thin, gradeOf, DEFAULT_GRADE_PLAN, seeded(7));
    expect(rs).toHaveLength(4);
    expect(new Set(rs.map((r) => r.id)).size).toBe(4);
  });

  it('cannot hand back more rounds than the pool holds', () => {
    const two: R[] = [{ id: 'e1', grade: 'easy' }, { id: 'h1', grade: 'hard' }];
    expect(drawGradedRounds(two, gradeOf, DEFAULT_GRADE_PLAN, seeded(3))).toHaveLength(2);
    expect(drawGradedRounds([], gradeOf, DEFAULT_GRADE_PLAN, seeded(3))).toEqual([]);
  });

  it('is reproducible for a given seed, so a game can be replayed exactly', () => {
    const a = drawGradedRounds(pool, gradeOf, DEFAULT_GRADE_PLAN, seeded(42)).map((r) => r.id);
    const b = drawGradedRounds(pool, gradeOf, DEFAULT_GRADE_PLAN, seeded(42)).map((r) => r.id);
    expect(a).toEqual(b);
  });

  it('honours a different plan', () => {
    const rs = drawGradedRounds(pool, gradeOf, { easy: 1, medium: 2, hard: 0 }, seeded(9));
    expect(counts(rs)).toEqual({ easy: 1, medium: 2, hard: 0 });
  });
});


/**
 * SPIDER AND PIE (v2.1) - the two families whose truth files do NOT match
 * `ChallengeTruth` as shipped, because neither figure has one value axis. The
 * UI reshapes them at import (`ui/src/challengeExamples.ts`); these tests do the
 * same reshape from the same committed files, so a change to either file's
 * layout fails here rather than silently mis-scoring a round.
 */
const spiderRaw = JSON.parse(readFileSync('samples/spider-material-profile.truth.json', 'utf8')) as {
  axes: { centre: number; max: number }[];
  calibration: {
    imageWidth: number;
    imageHeight: number;
    anchors: Record<string, { px: number; py: number; value?: number; name?: string }>;
  };
  series: ChallengeTruth['series'];
};
const SPIDER: ChallengeTruth = {
  graphType: 'spider',
  spokes: spiderRaw.axes.map((a) => ({ centre: a.centre, max: a.max })),
  calibration: {
    imageWidth: spiderRaw.calibration.imageWidth,
    imageHeight: spiderRaw.calibration.imageHeight,
    anchors: {
      origin: spiderRaw.calibration.anchors.origin!,
      spoke: spiderRaw.axes.map((_, i) => spiderRaw.calibration.anchors[`spoke${i + 1}`]!),
    },
  },
  series: [spiderRaw.series[0]!],
};

const pieRaw = JSON.parse(readFileSync('samples/pie-filler-composition.truth.json', 'utf8')) as {
  total: number;
  calibration: {
    imageWidth: number;
    imageHeight: number;
    anchors: Record<string, unknown>;
    slices: NonNullable<ChallengeTruth['calibration']['slices']>;
  };
  series: ChallengeTruth['series'];
};
const PIE: ChallengeTruth = {
  graphType: 'pie',
  total: pieRaw.total,
  calibration: {
    imageWidth: pieRaw.calibration.imageWidth,
    imageHeight: pieRaw.calibration.imageHeight,
    anchors: { outline: pieRaw.calibration.anchors.outline as never },
    ...(pieRaw.calibration.slices ? { slices: pieRaw.calibration.slices } : {}),
  },
  series: pieRaw.series,
};

describe('spider truth - one scale per spoke', () => {
  it('⚑ normalises each spoke by ITS OWN range, not a shared one', () => {
    // The whole point of the N×1D record. Cost index tops out at 5 and tensile
    // strength at 120; scored against a single range, a 0.4 slip on cost would
    // read as nothing while the same fraction on tensile read as 48 MPa.
    const pts = truthSpiderPoints(SPIDER);
    const raw = SPIDER.series[0]!.points;
    expect(SPIDER.spokes![0]!.max).toBe(120);
    expect(SPIDER.spokes![5]!.max).toBe(5);
    expect(pts[0]!.y).toBeCloseTo(Number(raw[0]!.value) / 120, 9);
    expect(pts[5]!.y).toBeCloseTo(Number(raw[5]!.value) / 5, 9);
    // ...and the two fractions are NOT what a shared range would have produced.
    expect(pts[5]!.y).not.toBeCloseTo(Number(raw[5]!.value) / 120, 3);
  });

  it('carries the spoke INDEX as x, which is what makes a gap a miss', () => {
    const pts = truthSpiderPoints(SPIDER);
    expect(pts.map((p) => p.x)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('⚑ a spoke left EMPTY drops out rather than reading as the centre value', () => {
    // A null slot scored as 0 would be a wrong ANSWER on that axis; dropped, it
    // is a miss, which is what it actually is.
    const values = [92, null, 21, 88, 46, 3.4];
    const user = spiderUserPoints(values, SPIDER);
    expect(user).toHaveLength(5);
    expect(user.map((p) => p.x)).toEqual([0, 2, 3, 4, 5]);
  });

  it('a perfect trace lands exactly on the truth points', () => {
    const values = SPIDER.series[0]!.points.map((p) => Number(p.value));
    expect(spiderUserPoints(values, SPIDER)).toEqual(truthSpiderPoints(SPIDER));
    // ⚑ …and against the ARITHMETIC, not just against the other function. The
    // assertion above compares two readers applying identical maths to identical
    // inputs, so it passes unchanged if the shared normalisation is wrong
    // (`max + centre` instead of `max - centre`, say). This pins the numbers
    // (v2.1 audit).
    const user = spiderUserPoints(values, SPIDER);
    expect(user[0]!.y).toBeCloseTo(92 / 120, 9);
    expect(user[5]!.y).toBeCloseTo(3.4 / 5, 9);
  });

  it('⚑⚑ measures from the spoke’s CENTRE, not from zero', () => {
    // ⚑ WHY THIS FIXTURE IS SYNTHETIC, against the project's usual rule. Every
    // spoke of every shipped spider has `centre: 0`, which makes `max - centre`
    // and `max + centre` the SAME NUMBER -- so no committed figure can tell the
    // two apart, and the tests above pass with the subtraction reversed. A
    // non-zero centre is a real thing (a radar chart whose axes start at a
    // baseline rather than at nothing) and this is the arithmetic of a pure
    // reader, not a claim about any figure (v2.1 audit).
    const offset: ChallengeTruth = {
      ...SPIDER,
      spokes: [{ centre: 20, max: 120 }, { centre: -5, max: 5 }],
      series: [{ name: 'x', points: [{ value: 70 }, { value: 0 }] }],
    };
    const pts = truthSpiderPoints(offset);
    // 70 sits halfway between 20 and 120.
    expect(pts[0]!.y).toBeCloseTo(0.5, 9);
    // 0 sits halfway between -5 and 5.
    expect(pts[1]!.y).toBeCloseTo(0.5, 9);
    // The user reader must agree, since a perfect trace has to score perfect.
    expect(spiderUserPoints([70, 0], offset)).toEqual(pts);
  });

  it('⚑ spaces the spokes so a neighbouring one cannot be mistaken for a match', () => {
    // Scoring is a scatter match: one spoke apart must exceed the threshold, or
    // a point on the WRONG axis scores as a good reading. The threshold is
    // IMPORTED, not typed as 0.15 -- a hardcoded copy stays green when the real
    // constant moves, which is the one thing this assertion exists to notice.
    const r = spiderAxisRanges(SPIDER);
    expect(1 / r.xRange).toBeGreaterThan(SCATTER_MATCH_THRESHOLD);
    expect(r.yRange).toBe(1);
  });

  it('⚑⚑ …and keeps that true at ANY spoke count, not just the shipped figure’s six', () => {
    // THE DEFECT (v2.1 audit): xRange was the spoke count minus one, so the more
    // spokes a figure had the CLOSER neighbours became in matching space. Six
    // spokes gives 0.2 and passes; eight gives 0.143 and a reading on the wrong
    // spoke matches -- the exact cascade the scatter scorer was chosen to stop.
    for (const n of [2, 6, 8, 12, 40]) {
      const wide: ChallengeTruth = {
        ...SPIDER,
        spokes: Array.from({ length: n }, () => ({ centre: 0, max: 100 })),
      };
      expect(1 / spiderAxisRanges(wide).xRange).toBeGreaterThan(SCATTER_MATCH_THRESHOLD);
    }
  });

  it('⚑ puts the CENTRE value at the origin pixel and the max at the spoke tip', () => {
    // The reveal is drawn from these. Off by a spoke and the player is shown a
    // "true" profile that is not the one in the figure.
    const cal = SPIDER.calibration;
    const origin = singleAnchor(cal, 'origin')!;
    for (let i = 0; i < SPIDER.spokes!.length; i++) {
      const tip = anchorList(cal, 'spoke')[i]!;
      const atCentre = spiderPointAt(cal, SPIDER, i, SPIDER.spokes![i]!.centre)!;
      const atMax = spiderPointAt(cal, SPIDER, i, SPIDER.spokes![i]!.max)!;
      expect(atCentre.x).toBeCloseTo(origin.px, 6);
      expect(atCentre.y).toBeCloseTo(origin.py, 6);
      expect(atMax.x).toBeCloseTo(tip.px, 6);
      expect(atMax.y).toBeCloseTo(tip.py, 6);
    }
  });

  it('returns null for a spoke the calibration has no anchor for', () => {
    expect(spiderPointAt(SPIDER.calibration, SPIDER, 99, 10)).toBeNull();
  });
});

describe('pie truth - the whole, and the slices read against it', () => {
  it('reads the slice values in the figure’s own order', () => {
    expect(truthPieValues(PIE)).toEqual([[42], [23], [18], [9], [8]]);
  });

  it('⚑ normalises against the TOTAL, since a pie has no value axis', () => {
    expect(PIE.axes).toBeUndefined();
    expect(truthValueRange(PIE)).toBe(100);
  });

  it('⚑ a degenerate total falls back to 1 rather than dividing by zero', () => {
    // Every sibling reader in the file guards with `|| 1`; this one used `??`,
    // which passes 0 straight through. The result was Infinity seconds in the
    // game total AND in the persisted high score.
    expect(truthValueRange({ ...PIE, total: 0 })).toBe(1);
    const noTotal = { ...PIE };
    delete (noTotal as { total?: number }).total;
    expect(truthValueRange(noTotal)).toBe(1);
  });

  it('⚑ the slice values sum to the total - the figure’s own consistency check', () => {
    const sum = truthPieValues(PIE).reduce((a, v) => a + v[0]!, 0);
    expect(sum).toBeCloseTo(PIE.total!, 6);
  });

  it('⚑ ships the true slice edges as recorded pixels, and they DESCRIBE the slices', () => {
    // ⚑ The first version asserted `Number.isFinite` on two of the six
    // coordinates. It passed if every slice shared one startEdge, or if apex and
    // startEdge were swapped -- i.e. it could not have caught the reveal defect
    // it was written to protect (v2.1 audit). These assertions are about the
    // GEOMETRY instead.
    const slices = PIE.calibration.slices!;
    expect(slices).toHaveLength(truthPieValues(PIE).length);

    const centre = slices[0]!.apex;
    const radius = Math.hypot(slices[0]!.startEdge.px - centre.px, slices[0]!.startEdge.py - centre.py);
    expect(radius).toBeGreaterThan(50); // a real pie, not a collapsed one

    const seen = new Set<string>();
    slices.forEach((sl, i) => {
      // Every edge sits on the rim, measured from that slice's own apex...
      for (const edge of [sl.startEdge, sl.endEdge]) {
        expect(Math.hypot(edge.px - sl.apex.px, edge.py - sl.apex.py)).toBeCloseTo(radius, 0);
      }
      // ...the edges are distinct (a zero-width slice would pass finiteness)...
      expect(Math.hypot(sl.startEdge.px - sl.endEdge.px, sl.startEdge.py - sl.endEdge.py)).toBeGreaterThan(1);
      seen.add(`${Math.round(sl.startEdge.px)},${Math.round(sl.startEdge.py)}`);
      // ...and on a PLAIN pie the chain closes: each end is the next start.
      const next = slices[(i + 1) % slices.length]!;
      expect(sl.endEdge.px).toBeCloseTo(next.startEdge.px, 0);
      expect(sl.endEdge.py).toBeCloseTo(next.startEdge.py, 0);
    });
    expect(seen.size).toBe(slices.length); // no two slices share a start
  });
});

describe('adopting a calibration with a REPEATING step', () => {
  it('⚑ unrolls a spider’s spokes to the keys the session actually walks', () => {
    const inputs = calibrationInputsFromAnchors(SPIDER.calibration);
    expect(Object.keys(inputs.placed).sort()).toEqual(
      ['origin', 'spoke1', 'spoke2', 'spoke3', 'spoke4', 'spoke5', 'spoke6'].sort()
    );
    // The count the loader grows the session to. Left at the step minimum, the
    // spokes past it are dropped and the round calibrates to a different figure.
    expect(inputs.repeatCount).toBe(6);
  });

  it('⚑ carries the spoke NAME as the step’s second field, positionally', () => {
    const inputs = calibrationInputsFromAnchors(SPIDER.calibration);
    // valueFields order is [value, name]; swapped, every spoke calibrates to
    // NaN and the whole round reads null.
    expect(inputs.placed.spoke1!.values[0]).toBe('120');
    expect(inputs.placed.spoke1!.values[1]).toBe('Tensile strength (MPa)');
    // The origin has one field only -- no name to append.
    expect(inputs.placed.origin!.values).toEqual(['0']);
  });

  it('⚑ expands a pie’s outline ARRAY into outline1..N', () => {
    const inputs = calibrationInputsFromAnchors(PIE.calibration);
    expect(Object.keys(inputs.placed).sort()).toEqual(['outline1', 'outline2', 'outline3', 'outline4']);
    expect(inputs.repeatCount).toBe(4);
  });

  it('⚑ places an outline point with NO value fields at all', () => {
    // The outline is pure geometry -- the rim carries no reading. `String(undefined)`
    // would have seeded every one of them with the literal text "undefined".
    const inputs = calibrationInputsFromAnchors(PIE.calibration);
    expect(inputs.placed.outline1!.values).toEqual([]);
    expect(inputs.placed.outline1!.px).toBeCloseTo(450, 6);
  });

  it('⚑ leaves a FIXED-shape type at repeatCount 0, digits in its keys and all', () => {
    // A bar's anchors are `p1`/`p2`. An earlier version read a trailing digit as
    // a repeat count and reported 2 for a type with no repeating step -- the
    // loader would then have grown a session that has nothing to grow.
    expect(Object.keys(BAR.calibration.anchors)).toEqual(['p1', 'p2']);
    expect(calibrationInputsFromAnchors(BAR.calibration).repeatCount).toBe(0);
  });
});


describe('⚑ the pie reveal draws every boundary the player had to click (v2.1 audit)', () => {
  const plain = PIE.calibration.slices!;
  const exploded = (
    JSON.parse(readFileSync('samples/pie-exploded-market-share.truth.json', 'utf8')) as {
      calibration: { slices: NonNullable<ChallengeTruth['calibration']['slices']> };
    }
  ).calibration.slices;

  it('a plain pie needs one ray per slice - every boundary is shared', () => {
    expect(pieRevealRays(plain)).toHaveLength(plain.length);
  });

  it('⚑⚑ an EXPLODED pie needs MORE, because the pulled-out slice shares nothing', () => {
    // The defect: drawing only `apex -> startEdge` left the exploded slice's far
    // edge and the boundary above it with nothing drawn, so the wedge whose
    // whole lesson is "this one has edges of its own" read as unenclosed.
    const rays = pieRevealRays(exploded);
    expect(rays.length).toBeGreaterThan(exploded.length);

    const drawn = new Set(rays.map((r) => `${Math.round(r[1]!.x)},${Math.round(r[1]!.y)}`));
    for (const sl of exploded) {
      expect(drawn.has(`${Math.round(sl.startEdge.px)},${Math.round(sl.startEdge.py)}`)).toBe(true);
      expect(drawn.has(`${Math.round(sl.endEdge.px)},${Math.round(sl.endEdge.py)}`)).toBe(true);
    }
  });

  it('⚑ and the pulled-out slice’s rays start at ITS apex, not the pie’s centre', () => {
    const sl = exploded.find((s) => s.apex.px !== exploded[0]!.apex.px)!;
    const rays = pieRevealRays(exploded).filter(
      (r) => Math.abs(r[0]!.x - sl.apex.px) < 0.5 && Math.abs(r[0]!.y - sl.apex.py) < 0.5
    );
    expect(rays).toHaveLength(2); // both of its own edges
  });

  it('draws nothing for a figure with no slices, rather than throwing', () => {
    expect(pieRevealRays([])).toEqual([]);
  });
});
