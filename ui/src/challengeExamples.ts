/**
 * Trace Challenge — the UI-side manifest (v1.2 game). This is where the committed
 * ground-truth JSON is pulled into the bundle (Vite resolves JSON imports), keyed
 * by the SAME `EXAMPLES` id used to load the figure. Kept out of `engine/` so the
 * pure round logic stays asset-free and node-testable.
 *
 * Phase A pool = the 4 XY examples (2 scoring families). Phase B will add
 * histogram/bar/box here (+ their calibration blocks + family scoring).
 */
import type { ChallengeTruth, ScoreFamily } from '../../engine/traceChallenge.js';

import xyTruth from '../../samples/xy-stress-strain.truth.json';
import multiTruth from '../../samples/xy-multiseries-modulus.truth.json';
import dashedTruth from '../../samples/xy-dashed-release.truth.json';
import scatterTruth from '../../samples/scatter-crosslink-modulus.truth.json';

export interface ChallengeMeta {
  family: ScoreFamily;
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
};

/** The example ids eligible for the challenge (the draw pool). */
export const CHALLENGE_IDS = Object.keys(CHALLENGE_META);
