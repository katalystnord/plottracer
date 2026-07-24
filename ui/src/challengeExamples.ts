/**
 * Trace Challenge — the UI-side manifest (v1.2 game). This is where the committed
 * ground-truth JSON is pulled into the bundle (Vite resolves JSON imports), keyed
 * by the SAME `EXAMPLES` id used to load the figure. Kept out of `engine/` so the
 * pure round logic stays asset-free and node-testable.
 *
 * Pool = 7 examples across 3 scoring families: XY curves + scatter (Phase A) and
 * bar / histogram / box (Phase B).
 */
import type { ChallengeTruth, ChallengeFamily } from '../../engine/traceChallenge.js';

import xyTruth from '../../samples/xy-stress-strain.truth.json';
import multiTruth from '../../samples/xy-multiseries-modulus.truth.json';
import dashedTruth from '../../samples/xy-dashed-release.truth.json';
import scatterTruth from '../../samples/scatter-crosslink-modulus.truth.json';
import histogramTruth from '../../samples/histogram-pore-size.truth.json';
import barTruth from '../../samples/bar-tensile-strength.truth.json';
import boxTruth from '../../samples/bar-box-plot-tensile-strength.truth.json';

export interface ChallengeMeta {
  family: ChallengeFamily;
  instruction: string;
  truth: ChallengeTruth;
}

/** Keyed by the `EXAMPLES` id (see Workspace.tsx); the Workspace fills in the
 * image src + axes config id from that same entry when building a round. */
export const CHALLENGE_META: Record<string, ChallengeMeta> = {
  xy: {
    family: 'curve',
    instruction: 'Trace the stress–strain curve — place points along it, left to right.',
    truth: xyTruth as unknown as ChallengeTruth,
  },
  'xy-multi': {
    family: 'curve',
    instruction: 'Trace all four modulus curves — add a new series (＋ Add) for each curve.',
    truth: multiTruth as unknown as ChallengeTruth,
  },
  dashed: {
    family: 'curve',
    instruction: 'Trace all four release curves — one series each (they differ only by dash style).',
    truth: dashedTruth as unknown as ChallengeTruth,
  },
  scatter: {
    family: 'scatter',
    instruction: 'Place one point on each marker in the scatter.',
    truth: scatterTruth as unknown as ChallengeTruth,
  },
  histogram: {
    family: 'histogram',
    instruction: 'Trace the histogram — click the two top corners of each bar (bin start, then bin end).',
    truth: histogramTruth as unknown as ChallengeTruth,
  },
  bar: {
    family: 'bar',
    instruction: 'Trace the bar chart — click the top of each bar, left to right.',
    truth: barTruth as unknown as ChallengeTruth,
  },
  boxplot: {
    family: 'box',
    instruction: 'Trace each box — place Min, Q1, Median, Q3, Max per box (the tips bar shows what’s next).',
    truth: boxTruth as unknown as ChallengeTruth,
  },
};

/** The example ids eligible for the challenge (the draw pool). */
export const CHALLENGE_IDS = Object.keys(CHALLENGE_META);
