/**
 * Trace Challenge — pure round logic (v1.2 game). No DOM, no React.
 *
 * Holds the truth-file types, the round draw, the pre-calibration builder (turns a
 * truth `calibration` block into `session.adoptCalibration(...)` input so a round
 * starts already calibrated), and the small adapters that feed the scoring engine
 * (`algorithms/challengeScore.ts`). The actual truth JSON is imported in the UI
 * layer (`ui/src/challengeExamples.ts`) where Vite resolves assets — this module
 * stays asset-free so it unit-tests in plain node.
 */
import type { Pt, AxisRanges, ScoreFamily } from '../algorithms/challengeScore.js';

export type { ScoreFamily } from '../algorithms/challengeScore.js';

// --- truth-file shape (the XY subset the game uses) ---
export interface ChallengeAnchor {
  px: number;
  py: number;
  value: number;
}
export interface ChallengeCalibration {
  imageWidth: number;
  imageHeight: number;
  anchors: { x1: ChallengeAnchor; x2: ChallengeAnchor; y1: ChallengeAnchor; y2: ChallengeAnchor };
}
export interface ChallengeTruthAxis {
  label: string;
  min: number;
  max: number;
}
export interface ChallengeTruthSeries {
  name: string;
  points: { x: number; y: number }[];
}
export interface ChallengeTruth {
  graphType: string;
  axes: { x: ChallengeTruthAxis; y: ChallengeTruthAxis };
  calibration: ChallengeCalibration;
  series: ChallengeTruthSeries[];
}

/** One example the game can draw: the truth + how it should be scored + the
 * on-screen instruction. `axesConfigId` / `imageSrc` are filled by the UI layer
 * from the existing `EXAMPLES` entry (same `id`). */
export interface ChallengeExample {
  id: string;
  name: string;
  family: ScoreFamily;
  instruction: string;
  truth: ChallengeTruth;
  axesConfigId: string;
  imageSrc: string;
}

/** Input shape `CalibrationSession.adoptCalibration(...)` expects. */
export interface AdoptCalibrationInput {
  placed: Record<string, { px: number; py: number; values: string[] }>;
  optionValues: Record<string, string>;
  globalValues: Record<string, string>;
}

/**
 * Turn a truth `calibration` block into `adoptCalibration` input so a round starts
 * pre-calibrated (the player never clicks the axes). The anchor pixels are already
 * in image-native space (the space the session stores calibration in); each XY step
 * carries exactly one value (X for x1/x2, Y for y1/y2 — see XY_AXES_CONFIG.steps).
 */
export function calibrationInputsFromAnchors(cal: ChallengeCalibration): AdoptCalibrationInput {
  const step = (a: ChallengeAnchor) => ({ px: a.px, py: a.py, values: [String(a.value)] });
  return {
    placed: {
      x1: step(cal.anchors.x1),
      x2: step(cal.anchors.x2),
      y1: step(cal.anchors.y1),
      y2: step(cal.anchors.y2),
    },
    optionValues: {}, // linear defaults (isLogX/isLogY/skipRotation) fill in via adoptCalibration
    globalValues: {},
  };
}

/** Axis spans for normalising scoring error. */
export function truthAxisRanges(truth: ChallengeTruth): AxisRanges {
  return {
    xRange: truth.axes.x.max - truth.axes.x.min,
    yRange: truth.axes.y.max - truth.axes.y.min,
  };
}

/** Truth points grouped per series (the shape `scoreRound` consumes). */
export function truthSeriesPoints(truth: ChallengeTruth): Pt[][] {
  return truth.series.map((s) => s.points.map((p) => ({ x: p.x, y: p.y })));
}

/**
 * Draw the rounds for a game: a shuffled subset of the pool, size
 * `min(target, pool.length)`. `rng` is injectable so tests are deterministic;
 * the app passes `Math.random`.
 */
export function drawRounds<T>(pool: readonly T[], target: number, rng: () => number = Math.random): T[] {
  const a = [...pool];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a.slice(0, Math.max(0, Math.min(target, a.length)));
}
