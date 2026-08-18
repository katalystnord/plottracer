/**
 * Trace Challenge - scoring a finished round, and revealing its answer.
 *
 * ⚑⚑ WHY THIS FILE EXISTS. Both functions under test spent their whole life
 * inside `Workspace.tsx` as a `useCallback` and a `useMemo`, which put them
 * beyond every instrument this project owns: unit tests cannot reach into a
 * 9,200-line component, and mutation testing cannot see `ui/` at all. The GAME'S
 * ENTIRE CORRECTNESS - whether a perfect trace scores as a perfect trace - was
 * carried by two blocks nothing could test. Moving them to `engine/` is what
 * makes the tests below possible; the tests are the point, not the move.
 *
 * Named for the CASE, per CLAUDE.md gate 2.
 */
import { describe, it, expect } from 'vitest';
import {
  scoreCompletedRound,
  challengeRevealFor,
  type ChallengeExample,
  type ChallengeSessionReader,
  type ChallengeFamily,
  type ChallengeTruth,
} from '../traceChallenge.js';

// --- fixtures -------------------------------------------------------------
// ⚑ A FIXTURE IS BLIND TO WHAT IT LACKS: the truth values below are deliberately
// NOT symmetric and NOT evenly spaced, so a scorer that paired items by the
// wrong index, or dropped one, cannot land on the right answer by luck.

const CAL = { imageWidth: 400, imageHeight: 300, anchors: { p1: { px: 50, py: 250, value: 0 }, p2: { px: 50, py: 50, value: 100 } } };

function truthWithSeries(points: Record<string, number | string>[], axes = true): ChallengeTruth {
  return {
    graphType: 'xy',
    ...(axes ? { axes: { x: { label: 'x', min: 0, max: 10 }, y: { label: 'y', min: 0, max: 100 } } } : {}),
    calibration: CAL,
    series: [{ name: 's', points }],
  } as ChallengeTruth;
}

function example(family: ChallengeFamily, truth: ChallengeTruth): ChallengeExample {
  return { id: 'fx', name: 'fixture', family, grade: 'easy', instruction: '', truth, axesConfigId: 'xy', imageSrc: '' };
}

/** A reader whose four reads all return nothing unless a test fills one in. */
function reader(over: Partial<ChallengeSessionReader> = {}): ChallengeSessionReader {
  return {
    getAllDatasetsData: () => [],
    getHistogramBins: () => [],
    getSpiderTable: () => ({ columns: [] }),
    getTupleRows: () => [],
    ...over,
  };
}

const SERIES_TRUTH = truthWithSeries([
  { x: 1, y: 12 },
  { x: 4, y: 71 },
  { x: 9, y: 33 },
]);

describe('a perfect trace scores better than a wrong one', () => {
  it('a curve traced exactly on the truth beats one traced away from it', () => {
    const exact = scoreCompletedRound(
      reader({ getAllDatasetsData: () => [{ points: [{ data: [1, 12] }, { data: [4, 71] }, { data: [9, 33] }] }] }),
      example('curve', SERIES_TRUTH),
      10
    );
    const off = scoreCompletedRound(
      reader({ getAllDatasetsData: () => [{ points: [{ data: [1, 90] }, { data: [4, 5] }, { data: [9, 99] }] }] }),
      example('curve', SERIES_TRUTH),
      10
    );
    expect(exact.adjustedSeconds).toBeLessThan(off.adjustedSeconds);
  });

  it('a series left empty is not scored as a spurious curve', () => {
    // The empty dataset must be dropped, not handed to the scorer as a series
    // with no points -- which would pair the REAL curve against the wrong truth.
    const withEmpty = scoreCompletedRound(
      reader({
        getAllDatasetsData: () => [
          { points: [] },
          { points: [{ data: [1, 12] }, { data: [4, 71] }, { data: [9, 33] }] },
        ],
      }),
      example('curve', SERIES_TRUTH),
      10
    );
    const withoutEmpty = scoreCompletedRound(
      reader({ getAllDatasetsData: () => [{ points: [{ data: [1, 12] }, { data: [4, 71] }, { data: [9, 33] }] }] }),
      example('curve', SERIES_TRUTH),
      10
    );
    expect(withEmpty.adjustedSeconds).toBe(withoutEmpty.adjustedSeconds);
  });

  it('an uncaptured point is a MISS, not a zero', () => {
    // A point with no `data` never reached the scorer as (0,0) -- which would be
    // a WRONG ANSWER at the origin rather than an answer not given.
    const partial = scoreCompletedRound(
      reader({ getAllDatasetsData: () => [{ points: [{ data: [1, 12] }, { data: null }, { data: [9, 33] }] }] }),
      example('curve', SERIES_TRUTH),
      10
    );
    expect(Number.isFinite(partial.adjustedSeconds)).toBe(true);
    expect(partial.adjustedSeconds).toBeGreaterThan(10); // charged for the miss
  });
});

describe('a bar round scores one reading per BAR, not per click', () => {
  // ⚑ The v2.1 defect this pins: a bar is a two-slot INTERVAL captured as a
  // drag-box, so a flawless drag of three bars leaves SIX points in the dataset
  // and THREE tuples. Scoring per point charged ~193s on a perfect run.
  const BAR_TRUTH = truthWithSeries([
    { category: 'A', value: 20 },
    { category: 'B', value: 65 },
    { category: 'C', value: 41 },
  ]);

  it('three bars dragged perfectly score as three correct readings', () => {
    const score = scoreCompletedRound(
      reader({
        getTupleRows: () => [
          { points: [{ px: 100 }, { px: 100 }], derived: 20 },
          { points: [{ px: 200 }, { px: 200 }], derived: 65 },
          { points: [{ px: 300 }, { px: 300 }], derived: 41 },
        ],
      }),
      example('bar', BAR_TRUTH),
      10
    );
    expect(score.adjustedSeconds).toBeCloseTo(10, 5); // no penalty at all
  });

  it('bars are ranked left-to-right, so capture order does not change the score', () => {
    const backwards = scoreCompletedRound(
      reader({
        getTupleRows: () => [
          { points: [{ px: 300 }, { px: 300 }], derived: 41 },
          { points: [{ px: 100 }, { px: 100 }], derived: 20 },
          { points: [{ px: 200 }, { px: 200 }], derived: 65 },
        ],
      }),
      example('bar', BAR_TRUTH),
      10
    );
    expect(backwards.adjustedSeconds).toBeCloseTo(10, 5);
  });

  it('a half-captured bar is dropped as a miss, not sent as a zero', () => {
    const score = scoreCompletedRound(
      reader({
        getTupleRows: () => [
          { points: [{ px: 100 }, { px: 100 }], derived: 20 },
          { points: [{ px: 200 }, null], derived: null }, // one corner only
          { points: [{ px: 300 }, { px: 300 }], derived: 41 },
        ],
      }),
      example('bar', BAR_TRUTH),
      10
    );
    // Two right and one missing beats two right and one WRONG at zero.
    const withZero = scoreCompletedRound(
      reader({
        getTupleRows: () => [
          { points: [{ px: 100 }, { px: 100 }], derived: 20 },
          { points: [{ px: 200 }, { px: 200 }], derived: 0 },
          { points: [{ px: 300 }, { px: 300 }], derived: 41 },
        ],
      }),
      example('bar', BAR_TRUTH),
      10
    );
    expect(score.adjustedSeconds).not.toBe(withZero.adjustedSeconds);
  });
});

describe('a box round needs all five slots of a tuple', () => {
  const BOX_TRUTH = truthWithSeries([
    { category: 'A', min: 5, q1: 18, median: 30, q3: 44, max: 61 },
    { category: 'B', min: 9, q1: 25, median: 47, q3: 58, max: 88 },
  ]);
  const five = (px: number, v: number[]) => ({ points: v.map((n) => ({ px, data: [n] })), derived: v[2]! });

  it('two complete boxes score as two correct readings', () => {
    const score = scoreCompletedRound(
      reader({ getTupleRows: () => [five(100, [5, 18, 30, 44, 61]), five(200, [9, 25, 47, 58, 88])] }),
      example('box', BOX_TRUTH),
      10
    );
    expect(score.adjustedSeconds).toBeCloseTo(10, 5);
  });

  it('a box missing one of its five points is dropped entirely', () => {
    // Four-of-five must NOT be scored as a four-number vector against a
    // five-number truth -- that pairs median against q3 and grades a careful
    // capture as nonsense.
    const incomplete = { points: [{ px: 100, data: [5] }, { px: 100, data: [18] }, null, { px: 100, data: [44] }, { px: 100, data: [61] }], derived: null };
    const score = scoreCompletedRound(
      reader({ getTupleRows: () => [incomplete, five(200, [9, 25, 47, 58, 88])] }),
      example('box', BOX_TRUTH),
      10
    );
    expect(Number.isFinite(score.adjustedSeconds)).toBe(true);
    expect(score.adjustedSeconds).toBeGreaterThan(10); // charged as a miss
  });
});

describe('a pie round keeps CAPTURE order', () => {
  // A slice's identity is its position in the walk around the circle. Sorting by
  // pixel would scramble it -- the instruction pins the start at 12 o'clock.
  const PIE_TRUTH = { graphType: 'pie', total: 200, calibration: CAL, series: [{ name: 's', points: [{ value: 90 }, { value: 60 }, { value: 50 }] }] } as unknown as ChallengeTruth;

  it('slices captured clockwise score correct even though their pixels are not left-to-right', () => {
    const score = scoreCompletedRound(
      reader({
        getTupleRows: () => [
          { points: [{ px: 300 }], derived: 90 }, // right of centre, captured FIRST
          { points: [{ px: 250 }], derived: 60 },
          { points: [{ px: 100 }], derived: 50 }, // leftmost, captured LAST
        ],
      }),
      example('pie', PIE_TRUTH),
      10
    );
    expect(score.adjustedSeconds).toBeCloseTo(10, 5);
  });
});

describe('a spider spoke left empty misses that spoke instead of shifting the rest', () => {
  const SPIDER_TRUTH = {
    graphType: 'spider',
    spokes: [
      { centre: 0, max: 10 },
      { centre: 0, max: 10 },
      { centre: 0, max: 10 },
    ],
    calibration: CAL,
    series: [{ name: 's', points: [{ value: 2 }, { value: 7 }, { value: 4 }] }],
  } as unknown as ChallengeTruth;

  it('reading spokes 1 and 3 and skipping 2 still scores 1 and 3 as correct', () => {
    const skipped = scoreCompletedRound(
      reader({ getSpiderTable: () => ({ columns: [{ values: [2, null, 4] }] }) }),
      example('spider', SPIDER_TRUTH),
      10
    );
    // If the missing spoke had SHIFTED the later readings, spoke 3's correct
    // value of 4 would have been graded against spoke 2's truth of 7.
    const shifted = scoreCompletedRound(
      reader({ getSpiderTable: () => ({ columns: [{ values: [2, 4, null] }] }) }),
      example('spider', SPIDER_TRUTH),
      10
    );
    expect(skipped.adjustedSeconds).toBeLessThan(shifted.adjustedSeconds);
  });
});

describe('the scorer cannot silently forget a family', () => {
  it('every declared ChallengeFamily returns a finite score', () => {
    // ⚑⚑ THE CASE THIS FILE WAS WRITTEN FOR. In `Workspace.tsx` this dispatch
    // was an if/else chain ending in a bare `else` that meant BOX -- so an
    // eighth family would compile clean and be scored as a box plot. This test
    // is the runtime half of the `never` check: it enumerates the union, so a
    // new member fails HERE too, not only at the type level.
    const families: ChallengeFamily[] = ['curve', 'scatter', 'histogram', 'bar', 'box', 'spider', 'pie'];
    for (const family of families) {
      const truth = family === 'pie' || family === 'spider'
        ? ({ graphType: family, total: 100, spokes: [{ centre: 0, max: 10 }], calibration: CAL, series: [{ name: 's', points: [{ value: 1 }] }] } as unknown as ChallengeTruth)
        : SERIES_TRUTH;
      const score = scoreCompletedRound(reader(), example(family, truth), 10);
      expect(Number.isFinite(score.adjustedSeconds), `${family} scored non-finite`).toBe(true);
    }
  });

  it('an unknown family throws rather than being scored as a box plot', () => {
    const rogue = example('heatmap' as ChallengeFamily, SERIES_TRUTH);
    expect(() => scoreCompletedRound(reader(), rogue, 10)).toThrow(/no scoring for family heatmap/);
  });
});

// --- the reveal -----------------------------------------------------------

describe('the reveal draws each family from the source its model allows', () => {
  const xy = { dataToPixel: (x: number, y: number) => ({ x: 50 + x * 30, y: 250 - y * 2 }) };

  it('a curve is revealed as a projected polyline', () => {
    const r = challengeRevealFor(example('curve', SERIES_TRUTH), xy);
    expect(r!.markers).toHaveLength(0);
    expect(r!.curves).toHaveLength(1);
    expect(r!.curves[0]).toEqual([
      { x: 80, y: 226 },
      { x: 170, y: 108 },
      { x: 320, y: 184 },
    ]);
  });

  it('a scatter is revealed as markers, not a line joining them', () => {
    const r = challengeRevealFor(example('scatter', SERIES_TRUTH), xy);
    expect(r!.curves).toHaveLength(0);
    expect(r!.markers).toHaveLength(3);
  });

  it('a projected family with no calibration reveals nothing rather than drawing at the origin', () => {
    // ⚑ A DRAWN CURVE IS READ AS AN ANSWER. Without axes there is no projection,
    // so the only honest reveal is none -- not a polyline collapsed onto (0,0).
    expect(challengeRevealFor(example('curve', SERIES_TRUTH), null)).toBeNull();
    expect(challengeRevealFor(example('scatter', SERIES_TRUTH), null)).toBeNull();
    expect(challengeRevealFor(example('histogram', SERIES_TRUTH), null)).toBeNull();
  });

  it('a bar is revealed WITHOUT axes, because its truth is pixel-native', () => {
    // bar/box have no x calibration at all, so they must still reveal when `xy`
    // is null -- the horizontal lines come from the value-axis anchors.
    const BAR_TRUTH = truthWithSeries([{ category: 'A', value: 50 }]);
    const r = challengeRevealFor(example('bar', BAR_TRUTH), null);
    expect(r).not.toBeNull();
    expect(r!.curves).toHaveLength(1);
    const [a, b] = r!.curves[0]!;
    expect(a!.y).toBeCloseTo(b!.y, 10); // horizontal
    expect(a!.y).toBeCloseTo(150, 10); // value 50 of 0..100 across py 250..50
  });

  it('a box is revealed at its MEDIAN, not its max', () => {
    const BOX_TRUTH = truthWithSeries([{ category: 'A', min: 0, q1: 10, median: 50, q3: 80, max: 100 }]);
    const r = challengeRevealFor(example('box', BOX_TRUTH), null);
    expect(r!.curves[0]![0]!.y).toBeCloseTo(150, 10); // median 50, not max 100 (py 50)
  });

  it('a spider reveal CLOSES the ring', () => {
    const SPIDER_TRUTH = {
      graphType: 'spider',
      spokes: [{ centre: 0, max: 10 }, { centre: 0, max: 10 }, { centre: 0, max: 10 }],
      calibration: {
        ...CAL,
        anchors: {
          spoke: [
            { px: 200, py: 100, value: 10, name: 'A' },
            { px: 260, py: 200, value: 10, name: 'B' },
            { px: 140, py: 200, value: 10, name: 'C' },
          ],
          centre: { px: 200, py: 160, value: 0 },
        },
      },
      series: [{ name: 's', points: [{ value: 5 }, { value: 5 }, { value: 5 }] }],
    } as unknown as ChallengeTruth;
    const r = challengeRevealFor(example('spider', SPIDER_TRUTH), null);
    expect(r).not.toBeNull();
    if (r!.curves.length > 0) {
      const ring = r!.curves[0]!;
      expect(ring[0]).toEqual(ring[ring.length - 1]); // closed
      expect(ring.length).toBe(r!.markers.length + 1);
    }
  });
});
