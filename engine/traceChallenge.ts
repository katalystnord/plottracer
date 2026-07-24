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
import type { Pt, AxisRanges } from '../algorithms/challengeScore.js';

/** How a round is captured + scored. `curve`/`scatter` map to `scoreRound`;
 * `histogram` is scored as a scatter over (bin-centre, value); `bar`/`box` use
 * `scoreOrderedRound`. It also selects the calibration config + capture readout. */
export type ChallengeFamily = 'curve' | 'scatter' | 'histogram' | 'bar' | 'box';

// --- truth-file shape ---
export interface ChallengeAnchor {
  px: number;
  py: number;
  value: number;
}
/** Calibration anchors keyed by the config's step key: XY/histogram carry
 * `x1/x2/y1/y2`; bar/box carry `p1/p2` (value axis only). */
export interface ChallengeCalibration {
  imageWidth: number;
  imageHeight: number;
  anchors: Record<string, ChallengeAnchor>;
}
export interface ChallengeTruthAxis {
  label: string;
  min: number;
  max: number;
}
/** A truth point; fields depend on the family (`{x,y}` for curve/scatter,
 * `{binStart,binEnd,value}` for histogram, `{category,value}` for bar,
 * `{category,min,q1,median,q3,max}` for box). */
export type ChallengeTruthPoint = Record<string, number | string>;
export interface ChallengeTruthSeries {
  name: string;
  points: ChallengeTruthPoint[];
}
export interface ChallengeTruth {
  graphType: string;
  /** `x` is absent for bar/box (value axis only). */
  axes: { x?: ChallengeTruthAxis; y: ChallengeTruthAxis };
  calibration: ChallengeCalibration;
  series: ChallengeTruthSeries[];
}

/** One example the game can draw: the truth + how it's scored + the on-screen
 * instruction. `axesConfigId` / `imageSrc` are filled by the UI layer from the
 * existing `EXAMPLES` entry (same `id`). */
export interface ChallengeExample {
  id: string;
  name: string;
  family: ChallengeFamily;
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
 * pre-calibrated. Generic over the config's step keys (XY/histogram `x1..y2`,
 * bar/box `p1/p2`): each anchor becomes one placed point with its single known
 * value. The anchor pixels are already image-native (the space the session stores
 * calibration in).
 */
export function calibrationInputsFromAnchors(cal: ChallengeCalibration): AdoptCalibrationInput {
  const placed: AdoptCalibrationInput['placed'] = {};
  for (const [key, a] of Object.entries(cal.anchors)) {
    placed[key] = { px: a.px, py: a.py, values: [String(a.value)] };
  }
  return { placed, optionValues: {}, globalValues: {} };
}

/**
 * Value-axis span for normalising scoring error (`y` always exists).
 * `|| 1` guards a degenerate `min===max` truth so scoring can't divide by zero.
 */
export function truthValueRange(truth: ChallengeTruth): number {
  return (truth.axes.y.max - truth.axes.y.min) || 1;
}

/**
 * Axis spans for curve/scatter/histogram scoring (x present for those).
 * `|| 1` guards a degenerate `min===max` axis; for bar/box (no x) `xRange` is
 * unused by the ordered scorer, so the fallback is inert there.
 */
export function truthAxisRanges(truth: ChallengeTruth): AxisRanges {
  return {
    xRange: (truth.axes.x ? truth.axes.x.max - truth.axes.x.min : 0) || 1,
    yRange: (truth.axes.y.max - truth.axes.y.min) || 1,
  };
}

/** Curve/scatter truth points grouped per series (the shape `scoreRound` consumes). */
export function truthSeriesPoints(truth: ChallengeTruth): Pt[][] {
  return truth.series.map((s) => s.points.map((p) => ({ x: Number(p.x), y: Number(p.y) })));
}

/** Histogram truth as (bin-centre, value) points — scored as a scatter. */
export function truthHistogramPoints(truth: ChallengeTruth): Pt[] {
  return (truth.series[0]?.points ?? []).map((p) => ({
    x: (Number(p.binStart) + Number(p.binEnd)) / 2,
    y: Number(p.value),
  }));
}

/** Bar truth as one-value vectors per category, left-to-right. */
export function truthBarValues(truth: ChallengeTruth): number[][] {
  return (truth.series[0]?.points ?? []).map((p) => [Number(p.value)]);
}

/** Box truth as five-number vectors per category, left-to-right. */
export function truthBoxValues(truth: ChallengeTruth): number[][] {
  return (truth.series[0]?.points ?? []).map((p) => [
    Number(p.min),
    Number(p.q1),
    Number(p.median),
    Number(p.q3),
    Number(p.max),
  ]);
}

/** Map a value on the value axis to an image-pixel `py`, from the p1/p2 anchors
 * (bar/box reveal — they have no x calibration, so the true values are drawn as
 * horizontal reference lines). */
export function valueToPy(cal: ChallengeCalibration, value: number): number {
  const p1 = cal.anchors.p1;
  const p2 = cal.anchors.p2;
  if (!p1 || !p2 || p2.value === p1.value) return 0;
  const t = (value - p1.value) / (p2.value - p1.value);
  return p1.py + t * (p2.py - p1.py);
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
