import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { CalibrationSession } from '../calibrationSession.js';
import { SPIDER_AXES_CONFIG, PIE_AXES_CONFIG, BAR_AXES_CONFIG } from '../axesTypeConfigs.js';
import {
  calibrationInputsFromAnchors,
  truthBarValues,
  derivedTupleItems,
  valueToPy,
  truthSpiderPoints,
  spiderUserPoints,
  spiderAxisRanges,
  spiderPointAt,
  truthPieValues,
  truthValueRange,
  type ChallengeTruth,
} from '../traceChallenge.js';
import { scoreRound, scoreOrderedRound } from '../../algorithms/challengeScore.js';

/**
 * SPIDER AND PIE ROUNDS, DRIVEN THROUGH A REAL SESSION (v2.1, #17).
 *
 * ⚑ WHY THIS FILE EXISTS SEPARATELY FROM traceChallengeTruth.test.ts. That one
 * proves the truth READERS agree with the committed files. It cannot see the
 * half that actually breaks: whether the round's calibration can be adopted at
 * all, and whether a PERFECT trace of the figure scores as perfect. Two of the
 * three defects this file was written against were in that gap —
 *
 *   1. a repeating step left at its minimum silently keeps the first three
 *      placed points and drops the rest, calibrating the round to a figure that
 *      is not the one on screen; and
 *   2. a spoke's two calibration fields (value, name) are POSITIONAL, so
 *      swapping them parses the axis name as the number and every reading is
 *      null — with a card that still says "calibrated".
 *
 * Both produce a playable round that marks a correct trace wrong. Neither is
 * visible to a reader test.
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
  calibration: { imageWidth: number; imageHeight: number; anchors: Record<string, unknown> };
  series: ChallengeTruth['series'];
};
const PIE: ChallengeTruth = {
  graphType: 'pie',
  total: pieRaw.total,
  calibration: {
    imageWidth: pieRaw.calibration.imageWidth,
    imageHeight: pieRaw.calibration.imageHeight,
    anchors: { outline: pieRaw.calibration.anchors.outline as never },
  },
  series: pieRaw.series,
};

/** What `loadRound` does: grow the repeating step, then adopt. */
function adoptRound(session: CalibrationSession<never>, truth: ChallengeTruth): boolean {
  const inputs = calibrationInputsFromAnchors(truth.calibration);
  while (session.getRepeatCount() < (inputs.repeatCount ?? 0)) {
    if (!session.addRepeat()) break;
  }
  return session.adoptCalibration(inputs);
}

describe('a spider round, end to end', () => {
  it('⚑ adopts all SIX spokes, not the three the step minimum starts at', () => {
    const session = new CalibrationSession(SPIDER_AXES_CONFIG);
    expect(session.getRepeatCount()).toBeLessThan(6); // the trap: it starts short
    expect(adoptRound(session as unknown as CalibrationSession<never>, SPIDER)).toBe(true);
    expect(session.getRepeatCount()).toBe(6);
    expect(session.getSpiderTable().axisNames).toHaveLength(6);
  });

  it('⚑ carries each spoke’s NAME through, so the value field was not shifted', () => {
    const session = new CalibrationSession(SPIDER_AXES_CONFIG);
    adoptRound(session as unknown as CalibrationSession<never>, SPIDER);
    expect(session.getSpiderTable().axisRawNames[0]).toBe('Tensile strength (MPa)');
    expect(session.getSpiderTable().axisRawNames[5]).toBe('Cost index');
  });

  it('⚑ a PERFECT trace scores as perfect — no misses, no extras, no error', () => {
    // The end-to-end claim: clicking exactly where the truth says, through the
    // real session, comes back out as the truth. Everything else in the round
    // is a variation on this.
    const session = new CalibrationSession(SPIDER_AXES_CONFIG);
    adoptRound(session as unknown as CalibrationSession<never>, SPIDER);
    const truthPts = SPIDER.series[0]!.points;
    truthPts.forEach((p, i) => {
      const at = spiderPointAt(SPIDER.calibration, SPIDER, i, Number(p.value))!;
      session.addDataPoint(at.x, at.y);
    });
    const values = session.getSpiderTable().columns[0]?.values ?? [];
    expect(values).toHaveLength(6);
    values.forEach((v, i) => expect(v!).toBeCloseTo(Number(truthPts[i]!.value), 3));

    const score = scoreRound(
      'scatter',
      [spiderUserPoints(values, SPIDER)],
      [truthSpiderPoints(SPIDER)],
      spiderAxisRanges(SPIDER),
      0
    );
    expect(score.breakdown.misses).toBe(0);
    expect(score.breakdown.extras).toBe(0);
    expect(score.breakdown.meanErrorFrac).toBeLessThan(0.01);
    expect(score.penaltySeconds).toBeLessThan(1);
  });

  it('⚑ a SKIPPED spoke is a miss on that spoke, not a shift onto the next', () => {
    // The reason spider does not use the ordered scorer. Trace spokes 1,2,4,5,6
    // and leave 3 empty: the ordered scorer would pair spoke 4's reading against
    // spoke 3's truth and mark three good readings wrong.
    const session = new CalibrationSession(SPIDER_AXES_CONFIG);
    adoptRound(session as unknown as CalibrationSession<never>, SPIDER);
    const truthPts = SPIDER.series[0]!.points;
    truthPts.forEach((p, i) => {
      // Skipping a spoke means STEPPING PAST its slot -- the slot is where the
      // point lands, not where the click is. Just omitting the click would fill
      // spoke 3's slot with spoke 4's reading, which is the app's own rule and
      // not the case being tested here.
      if (i === 2) {
        session.nextSlot();
        return;
      }
      const at = spiderPointAt(SPIDER.calibration, SPIDER, i, Number(p.value))!;
      session.addDataPoint(at.x, at.y);
    });
    const values = session.getSpiderTable().columns[0]?.values ?? [];
    const score = scoreRound(
      'scatter',
      [spiderUserPoints(values, SPIDER)],
      [truthSpiderPoints(SPIDER)],
      spiderAxisRanges(SPIDER),
      0
    );
    expect(score.breakdown.misses).toBe(1);
    expect(score.breakdown.matchedCount).toBe(5);
    expect(score.breakdown.extras).toBe(0);
  });
});

describe('a pie round, end to end', () => {
  /** Place the outline, then the boundary clicks the figure's own truth records. */
  function tracePie(session: CalibrationSession<never>, boundaries: { px: number; py: number }[]): void {
    for (const b of boundaries) session.addDataPoint(b.px, b.py);
  }

  it('⚑ adopts the outline ARRAY as four placed points and calibrates', () => {
    const session = new CalibrationSession(PIE_AXES_CONFIG);
    expect(adoptRound(session as unknown as CalibrationSession<never>, PIE)).toBe(true);
    expect(session.getRepeatCount()).toBe(4);
    expect(session.isCalibrated()).toBe(true);
  });

  it('⚑ fits the centre back onto the centre the truth file records', () => {
    // The pie's centre is FITTED from the outline, never clicked. If the outline
    // did not survive adoption, the fit lands somewhere else and every slice is
    // measured about the wrong point -- with nothing on screen looking wrong.
    const session = new CalibrationSession(PIE_AXES_CONFIG);
    adoptRound(session as unknown as CalibrationSession<never>, PIE);
    const truthCentre = pieRaw.calibration.anchors.centre as { px: number; py: number };
    const axes = session.getAxes() as unknown as { getCentre(): { x: number; y: number } };
    expect(axes.getCentre().x).toBeCloseTo(truthCentre.px, 1);
    expect(axes.getCentre().y).toBeCloseTo(truthCentre.py, 1);
  });

  it('⚑ a PERFECT trace of the boundaries returns the figure’s own slice values', () => {
    const session = new CalibrationSession(PIE_AXES_CONFIG);
    adoptRound(session as unknown as CalibrationSession<never>, PIE);
    const slices = (
      JSON.parse(readFileSync('samples/pie-filler-composition.truth.json', 'utf8')) as {
        calibration: { slices: { startEdge: { px: number; py: number } }[] };
      }
    ).calibration.slices;
    // Chained tuples: each click closes one slice and opens the next, so tracing
    // N slices takes N+1 clicks -- the last one back on the first boundary.
    tracePie(
      session as unknown as CalibrationSession<never>,
      [...slices.map((s) => ({ px: s.startEdge.px, py: s.startEdge.py })), {
        px: slices[0]!.startEdge.px,
        py: slices[0]!.startEdge.py,
      }]
    );
    const items = session.getTupleRows().flatMap((row) => (row.derived === null ? [] : [[row.derived]]));
    const truthItems = truthPieValues(PIE);
    expect(items).toHaveLength(truthItems.length);
    items.forEach((v, i) => expect(v[0]!).toBeCloseTo(truthItems[i]![0]!, 1));

    const score = scoreOrderedRound(items, truthItems, truthValueRange(PIE), 0);
    expect(score.breakdown.misses).toBe(0);
    expect(score.breakdown.extras).toBe(0);
    expect(score.penaltySeconds).toBeLessThan(1);
  });
});


/**
 * THE EXPLODED PIE — the pool's fourth HARD round (v2.1).
 *
 * ⚑ WHY IT IS A BOSS LEVEL RATHER THAN A LONGER ONE. A pulled-out slice does not
 * share the pie's centre, so it is measured about its OWN apex. Measured about
 * the shared centre instead, the config's own comment puts a 90-degree slice
 * about 8 degrees out — a wrong number with nothing on screen looking wrong. The
 * chain breaks there too (a pulled-out slice shares no boundary with anyone), so
 * its two edges are a pair of their own.
 *
 * The second test is the one that earns the grade: it traces the same figure
 * WITHOUT arming the explosion and shows the reading go wrong.
 */
interface RawSlice {
  exploded: boolean;
  apex: { px: number; py: number };
  startEdge: { px: number; py: number };
  endEdge: { px: number; py: number };
}
const explodedRaw = JSON.parse(readFileSync('samples/pie-exploded-market-share.truth.json', 'utf8')) as {
  total: number;
  calibration: { imageWidth: number; imageHeight: number; anchors: Record<string, unknown>; slices: RawSlice[] };
  series: ChallengeTruth['series'];
};
const EXPLODED: ChallengeTruth = {
  graphType: 'pie',
  total: explodedRaw.total,
  calibration: {
    imageWidth: explodedRaw.calibration.imageWidth,
    imageHeight: explodedRaw.calibration.imageHeight,
    anchors: { outline: explodedRaw.calibration.anchors.outline as never },
  },
  series: explodedRaw.series,
};

/**
 * Trace every slice the way the figure demands. `armExplosion: false` is the
 * player who never noticed the pulled-out slice.
 *
 * A non-exploded slice following another non-exploded one needs only its END
 * edge — the chain already pre-opened it holding the shared boundary. After an
 * exploded slice there is no chain to inherit, so both edges are clicked.
 */
function traceExplodedPie(
  session: CalibrationSession<never>,
  slices: readonly RawSlice[],
  armExplosion: boolean
): void {
  let chainHoldsStart = false;
  for (const sl of slices) {
    if (sl.exploded && armExplosion) {
      session.setNextSectorExploded(true);
      session.addDataPoint(sl.apex.px, sl.apex.py);
      session.addDataPoint(sl.startEdge.px, sl.startEdge.py);
      session.addDataPoint(sl.endEdge.px, sl.endEdge.py);
      chainHoldsStart = false;
      continue;
    }
    if (!chainHoldsStart) session.addDataPoint(sl.startEdge.px, sl.startEdge.py);
    session.addDataPoint(sl.endEdge.px, sl.endEdge.py);
    chainHoldsStart = true;
  }
}

describe('the exploded-pie round', () => {
  const slices = explodedRaw.calibration.slices;

  it('⚑ a trace that ARMS the explosion returns the figure’s own values', () => {
    const session = new CalibrationSession(PIE_AXES_CONFIG);
    adoptRound(session as unknown as CalibrationSession<never>, EXPLODED);
    traceExplodedPie(session as unknown as CalibrationSession<never>, slices, true);

    const items = session.getTupleRows().flatMap((row) => (row.derived === null ? [] : [[row.derived]]));
    const truthItems = truthPieValues(EXPLODED);
    expect(items).toHaveLength(truthItems.length);
    items.forEach((v, i) => expect(v[0]!).toBeCloseTo(truthItems[i]![0]!, 1));

    const score = scoreOrderedRound(items, truthItems, truthValueRange(EXPLODED), 0);
    expect(score.breakdown.misses).toBe(0);
    expect(score.breakdown.extras).toBe(0);
    expect(score.penaltySeconds).toBeLessThan(1);
  });

  it('⚑ MISSING the explosion reads the pulled-out slice wrong — the round’s whole point', () => {
    // Without this the round is just a longer pie and the HARD grade is a
    // decoration. The player who never armed it gets a plausible number that is
    // not the figure's.
    const session = new CalibrationSession(PIE_AXES_CONFIG);
    adoptRound(session as unknown as CalibrationSession<never>, EXPLODED);
    traceExplodedPie(session as unknown as CalibrationSession<never>, slices, false);

    const items = session.getTupleRows().flatMap((row) => (row.derived === null ? [] : [[row.derived]]));
    const truthItems = truthPieValues(EXPLODED);
    const explodedIndex = slices.findIndex((sl) => sl.exploded);
    expect(explodedIndex).toBeGreaterThanOrEqual(0);
    const got = items[explodedIndex]?.[0];
    expect(got).toBeDefined();
    // Wrong, and wrong by an amount a player would not spot: measured about the
    // shared centre the slice reads 25.09 where the figure says 27.
    expect(Math.abs(got! - truthItems[explodedIndex]![0]!)).toBeGreaterThan(1);

    // ⚑ AND THE ERROR DOES NOT STAY LOCAL. The next slice's boundary is measured
    // about the same wrong apex, so it reads 22.91 against a true 21 -- one
    // missed observation moves TWO readings, and both land on plausible numbers.
    const neighbour = items[explodedIndex + 1]?.[0];
    expect(neighbour).toBeDefined();
    expect(Math.abs(neighbour! - truthItems[explodedIndex + 1]![0]!)).toBeGreaterThan(1);

    const score = scoreOrderedRound(items, truthItems, truthValueRange(EXPLODED), 0);
    expect(score.penaltySeconds).toBeGreaterThan(0);
  });
});


/**
 * A BAR ROUND, PLAYED THE WAY THE APP ACTUALLY RECORDS A BAR (v2.1 audit).
 *
 * ⚑ THE GAP THIS FILE WAS MISSING. Spider, pie, histogram and box all had an
 * end-to-end round test; bar did not — and bar is the family with SIX of the
 * pool's rounds. Since the v2.0 bar model a bar is a two-slot INTERVAL captured
 * as a drag-box, and `handleBoxRect` records TWO pixels per bar. The round
 * scorer was still reading raw dataset pixels, one per click, so a perfect trace
 * of six bars handed twelve numbers to a scorer expecting six and paired them
 * against the wrong truth entries — about 193 seconds of penalty on a flawless
 * run, and the round was only "correct" if the player single-clicked, which
 * leaves every bar half-captured and exports no value at all.
 */
const barRaw = JSON.parse(readFileSync('samples/bar-tensile-strength.truth.json', 'utf8')) as ChallengeTruth;

/** What `handleBoxRect` does for one dragged bar: two points, both corners. */
function dragBar(session: CalibrationSession<never>, x: number, yTop: number, yBase: number): void {
  session.addDataPoint(x, yTop);
  session.addDataPoint(x, yBase);
}

describe('a bar round, end to end', () => {
  it('⚑ a bar DRAGGED corner to corner scores as a perfect trace', () => {
    const session = new CalibrationSession(BAR_AXES_CONFIG);
    expect(adoptRound(session as unknown as CalibrationSession<never>, barRaw)).toBe(true);

    // The baseline pixel row is p1's own (the truth calibrates value 0 there on
    // this figure); each bar is dragged from its top down to it.
    const truthVals = truthBarValues(barRaw).map((v) => v[0]!);
    truthVals.forEach((v, i) => {
      const top = valueToPy(barRaw.calibration, v);
      const base = valueToPy(barRaw.calibration, 0);
      dragBar(session as unknown as CalibrationSession<never>, 100 + i * 50, top, base);
    });

    const items = derivedTupleItems(session.getTupleRows(), 'left-to-right');
    expect(items).toHaveLength(truthVals.length);
    items.forEach((v, i) => expect(v[0]!).toBeCloseTo(truthVals[i]!, 1));

    const score = scoreOrderedRound(items, truthBarValues(barRaw), truthValueRange(barRaw), 0);
    expect(score.breakdown.extras).toBe(0);
    expect(score.breakdown.misses).toBe(0);
    expect(score.penaltySeconds).toBeLessThan(1);
  });

  it('⚑ and the OLD per-pixel reading scored that same perfect trace as a disaster', () => {
    // The defect kept as evidence rather than as a sentence in a commit message.
    // Reading one item per PIXEL yields two per bar; `scoreOrderedRound` pairs by
    // position, so every truth value after the first meets a bar corner instead
    // of a bar, and the surplus corners are charged as extras on top.
    const session = new CalibrationSession(BAR_AXES_CONFIG);
    adoptRound(session as unknown as CalibrationSession<never>, barRaw);
    const truthVals = truthBarValues(barRaw).map((v) => v[0]!);
    truthVals.forEach((v, i) => {
      dragBar(
        session as unknown as CalibrationSession<never>,
        100 + i * 50,
        valueToPy(barRaw.calibration, v),
        valueToPy(barRaw.calibration, 0)
      );
    });

    const perPixel = session
      .getAllDatasetsData()[0]!
      .points.filter((p) => p.data)
      .slice()
      .sort((a, b) => a.px - b.px)
      .map((p) => [p.data![0]!]);
    expect(perPixel).toHaveLength(truthVals.length * 2); // two corners per bar

    const bad = scoreOrderedRound(perPixel, truthBarValues(barRaw), truthValueRange(barRaw), 0);
    expect(bad.breakdown.extras).toBe(truthVals.length);
    expect(bad.penaltySeconds).toBeGreaterThan(100); // ~193s on a flawless run

    // ...and the fix is not merely "different": it is the figure's own numbers.
    const good = scoreOrderedRound(
      derivedTupleItems(session.getTupleRows(), 'left-to-right'),
      truthBarValues(barRaw),
      truthValueRange(barRaw),
      0
    );
    expect(good.penaltySeconds).toBeLessThan(1);
  });
});
