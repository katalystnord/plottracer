/**
 * Trace Challenge — the UI-side manifest (v1.2 game). This is where the committed
 * ground-truth JSON is pulled into the bundle (Vite resolves JSON imports), keyed
 * by the SAME `EXAMPLES` id used to load the figure. Kept out of `engine/` so the
 * pure round logic stays asset-free and node-testable.
 *
 * Pool = 7 examples across 3 scoring families: XY curves + scatter (Phase A) and
 * bar / histogram / box (Phase B).
 */
import type { ChallengeTruth, ChallengeFamily, ChallengeGrade } from '../../engine/traceChallenge.js';

import xyTruth from '../../samples/xy-stress-strain.truth.json';
import multiTruth from '../../samples/xy-multiseries-modulus.truth.json';
import dashedTruth from '../../samples/xy-dashed-release.truth.json';
import scatterTruth from '../../samples/scatter-crosslink-modulus.truth.json';
import histogramTruth from '../../samples/histogram-pore-size.truth.json';
import barTruth from '../../samples/bar-tensile-strength.truth.json';
import barGroupedTruth from '../../samples/bar-grouped-viability.truth.json';
import barMissingTruth from '../../samples/bar-grouped-missing-assay.truth.json';
import barStackedTruth from '../../samples/bar-stacked-cost.truth.json';
import boxTruth from '../../samples/bar-box-plot-tensile-strength.truth.json';

export interface ChallengeMeta {
  family: ChallengeFamily;
  /** How much work the round is — see ChallengeGrade. Drives the weighted draw
   * (2 easy / 1 medium / 1 hard), so a game is the same shape whichever rounds
   * come up. */
  grade: ChallengeGrade;
  instruction: string;
  truth: ChallengeTruth;
}

/** Clicks a perfect run needs, per round, measured off the truth files. Kept
 * here as the EVIDENCE for the grades above rather than as prose, so a future
 * regrade argues with a number instead of an impression.
 *
 *     xy 61 · dashed 49 · scatter 26 · boxplot 25 · histogram 20
 *     bar 12 · xy-multi 9 · grouped 8 · missing 8 · stacked 8
 *
 * ⚑ boxplot is graded HARD on 25 clicks while scatter is MEDIUM on 26: a box is
 * five NAMED slots per item, which has to be held in mind, where a scatter's
 * every click is the same kind of thing. Clicks are the measure, not the whole
 * of it. */

/** Keyed by the `EXAMPLES` id (see Workspace.tsx); the Workspace fills in the
 * image src + axes config id from that same entry when building a round. */
export const CHALLENGE_META: Record<string, ChallengeMeta> = {
  xy: {
    family: 'curve',
    grade: 'hard',
    instruction: 'Trace the stress–strain curve — place points along it, left to right.',
    truth: xyTruth as unknown as ChallengeTruth,
  },
  // The two multi-curve rounds ask for ONE curve only (David, playtest: four is a
  // slog, one is hard enough). Scoring uses just the first series so the others
  // aren't counted as "missed"; the figure still shows all four.
  'xy-multi': {
    family: 'curve',
    grade: 'easy',
    instruction: 'Trace just the top curve — Blend A (the highest line).',
    truth: {
      ...(multiTruth as unknown as ChallengeTruth),
      series: [(multiTruth as unknown as ChallengeTruth).series[0]!],
    },
  },
  dashed: {
    family: 'curve',
    grade: 'hard',
    instruction: 'Trace just Formulation A — the solid curve (the highest one).',
    truth: {
      ...(dashedTruth as unknown as ChallengeTruth),
      series: [(dashedTruth as unknown as ChallengeTruth).series[0]!],
    },
  },
  scatter: {
    family: 'scatter',
    grade: 'medium',
    instruction: 'Place one point on each marker in the scatter.',
    truth: scatterTruth as unknown as ChallengeTruth,
  },
  histogram: {
    family: 'histogram',
    grade: 'medium',
    instruction: 'Trace the histogram — click the two top corners of each bar (bin start, then bin end).',
    truth: histogramTruth as unknown as ChallengeTruth,
  },
  bar: {
    family: 'bar',
    grade: 'easy',
    instruction: 'Trace the bar chart — click the top of each bar, left to right.',
    truth: barTruth as unknown as ChallengeTruth,
  },
  boxplot: {
    family: 'box',
    grade: 'hard',
    instruction: 'Trace each box — place Min, Q1, Median, Q3, Max per box (the tips bar shows what’s next).',
    truth: boxTruth as unknown as ChallengeTruth,
  },
  // ⚑ THE v2.0 BAR VARIANTS, added 2026-08-10. All three score through the
  // existing 'bar' family unchanged -- one value per bar, left to right -- and
  // each trims to series[0] with the instruction naming it, exactly as the
  // multi-curve rounds do, so the other series are not counted as missed.
  'bar-grouped': {
    family: 'bar',
    grade: 'easy',
    instruction: 'Trace just the Control bars — the dark blue ones, left to right.',
    truth: {
      ...(barGroupedTruth as unknown as ChallengeTruth),
      series: [(barGroupedTruth as unknown as ChallengeTruth).series[0]!],
    },
  },
  // ⚑ The round that tests whether you NOTICE something absent rather than trace
  // accurately: Control has no Lactose bar. The instruction stays neutral on
  // purpose -- saying so would give away the only thing being asked.
  'bar-grouped-missing': {
    family: 'bar',
    grade: 'easy',
    instruction: 'Trace just the Control bars — the dark blue ones, left to right.',
    truth: {
      ...(barMissingTruth as unknown as ChallengeTruth),
      series: [(barMissingTruth as unknown as ChallengeTruth).series[0]!],
    },
  },
  // Segment SPANS, not cumulative tops -- the bottom layer sits on the baseline,
  // which is why Materials is the one asked for.
  'bar-stacked': {
    family: 'bar',
    grade: 'easy',
    instruction: 'Trace just the bottom segment of each bar — Materials.',
    truth: {
      ...(barStackedTruth as unknown as ChallengeTruth),
      series: [(barStackedTruth as unknown as ChallengeTruth).series[0]!],
    },
  },
};

/** The example ids eligible for the challenge (the draw pool). */
export const CHALLENGE_IDS = Object.keys(CHALLENGE_META);
