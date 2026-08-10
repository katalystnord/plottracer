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
export type ChallengeFamily = 'curve' | 'scatter' | 'histogram' | 'bar' | 'box' | 'spider' | 'pie';

// --- truth-file shape ---
export interface ChallengeAnchor {
  px: number;
  py: number;
  /** The number typed at this anchor. Absent for a value-less step (a pie's
   * outline points are pure geometry — the rim carries no reading). */
  value?: number;
  /** A second field the step asks for, positionally after the value — a spider
   * spoke's axis name. Absent where the step has only one field. */
  name?: string;
}
/** Calibration anchors keyed by the config's step key: XY/histogram carry
 * `x1/x2/y1/y2`; bar/box carry `p1/p2` (value axis only). */
export interface ChallengeCalibration {
  imageWidth: number;
  imageHeight: number;
  /**
   * One entry per calibration step key. An ARRAY value is a REPEATING step and
   * expands to `key1 … keyN` — the same unrolling `CalibrationSession.getSteps`
   * does — which is how a spider's spokes and a pie's outline arrive.
   */
  anchors: Record<string, ChallengeAnchor | ChallengeAnchor[]>;
  /** Pie only: the true slice edges, as recorded pixels. The reveal draws these
   * directly rather than reconstructing them from angles. */
  slices?: readonly ChallengePieSlice[];
}

/** A pie slice's own geometry in the truth file (pixels, image-native). */
export interface ChallengePieSlice {
  apex: { px: number; py: number };
  startEdge: { px: number; py: number };
  endEdge: { px: number; py: number };
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
  /**
   * `x` is absent for bar/box (value axis only), and the whole block is absent
   * for spider and pie — NEITHER HAS ONE VALUE AXIS. A spider has one scale per
   * spoke (`spokes` below) and a pie has a whole (`total`), so synthesising a
   * `y` here would have been a fabricated axis standing in for the real model.
   */
  axes?: { x?: ChallengeTruthAxis; y: ChallengeTruthAxis };
  /** Spider only: one scale per spoke, in spoke order. */
  spokes?: readonly { centre: number; max: number }[];
  /** Pie only: the whole the slices are read against. */
  total?: number;
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
  grade: ChallengeGrade;
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
  /**
   * How many copies of a REPEATING step the placed points need (a spider's
   * spokes, a pie's outline). `adoptCalibration` does not read this — the caller
   * grows the session with `addRepeat()` first, because a session left at the
   * step minimum would drop every point past it on the floor.
   */
  repeatCount?: number;
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
  let repeatCount = 0;
  const put = (key: string, a: ChallengeAnchor): void => {
    // Positional, matching the step's `valueFields` order: value first, then the
    // optional second field (a spoke's name). An anchor with no value places a
    // pure-geometry point (a pie outline click), which takes no fields at all.
    const values = a.value === undefined ? [] : [String(a.value)];
    if (a.name !== undefined) values.push(a.name);
    placed[key] = { px: a.px, py: a.py, values };
  };
  for (const [key, a] of Object.entries(cal.anchors)) {
    if (Array.isArray(a)) {
      // A repeating step, unrolled the way the session unrolls it: `key1 … keyN`.
      //
      // ⚑ AN ARRAY IS THE ONLY THING THAT DECLARES A REPEAT. The first version
      // also read a trailing digit as one, so that a truth file could name its
      // spokes `spoke1 … spoke6` directly -- and a BAR's ordinary `p1`/`p2`
      // anchors matched it, reporting a two-repeat calibration for a type with
      // no repeating step at all. Caught by the fixed-shape test below.
      a.forEach((one, i) => put(`${key}${i + 1}`, one));
      repeatCount = Math.max(repeatCount, a.length);
    } else {
      put(key, a);
    }
  }
  return { placed, optionValues: {}, globalValues: {}, repeatCount };
}

/**
 * Value-axis span for normalising scoring error (`y` always exists).
 * `|| 1` guards a degenerate `min===max` truth so scoring can't divide by zero.
 */
export function truthValueRange(truth: ChallengeTruth): number {
  if (!truth.axes) return truth.total ?? 1; // pie: the whole IS the range
  return (truth.axes.y.max - truth.axes.y.min) || 1;
}

/**
 * Axis spans for curve/scatter/histogram scoring (x present for those).
 * `|| 1` guards a degenerate `min===max` axis; for bar/box (no x) `xRange` is
 * unused by the ordered scorer, so the fallback is inert there.
 */
export function truthAxisRanges(truth: ChallengeTruth): AxisRanges {
  return {
    xRange: (truth.axes?.x ? truth.axes.x.max - truth.axes.x.min : 0) || 1,
    yRange: (truth.axes ? truth.axes.y.max - truth.axes.y.min : 0) || 1,
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

/**
 * One anchor by step key, or `null` where the key names a REPEATING step (an
 * array) or nothing at all. The union is the price of one type covering both
 * shapes; these two readers are the single place that pays it.
 */
export function singleAnchor(cal: ChallengeCalibration, key: string): ChallengeAnchor | null {
  const a = cal.anchors[key];
  return a && !Array.isArray(a) ? a : null;
}

/** The anchors of a REPEATING step, in order. Empty for a key that holds one
 * anchor or nothing. */
export function anchorList(cal: ChallengeCalibration, key: string): readonly ChallengeAnchor[] {
  const a = cal.anchors[key];
  return Array.isArray(a) ? a : [];
}

/**
 * Spider truth as (spoke index, value-as-a-fraction-of-that-spoke) points.
 *
 * ⚑ WHY A SCATTER AND NOT THE ORDERED SCORER. A spider is N×1D: the spoke IS the
 * identity, so a skipped spoke must be a MISS on that spoke, not a shift that
 * makes every later reading score against the wrong axis. The ordered scorer
 * pairs by position and cascades on a gap — right for a bar chart, where order
 * is the only identity there is, and wrong here. Handing the index to the
 * scatter scorer as the x coordinate makes the identity part of the match.
 *
 * ⚑ AND WHY THE VALUE IS A FRACTION. Each spoke carries its OWN scale — 120 MPa
 * on one, 5 cost-index units on the next — so a raw error is not comparable
 * between them. Normalising per spoke is the same thing the figure does when it
 * draws them at a common radius.
 */
export function truthSpiderPoints(truth: ChallengeTruth): Pt[] {
  const spokes = truth.spokes ?? [];
  return (truth.series[0]?.points ?? []).map((p, i) => {
    const spoke = spokes[i];
    const span = spoke ? (spoke.max - spoke.centre) || 1 : 1;
    return { x: i, y: (Number(p.value) - (spoke?.centre ?? 0)) / span };
  });
}

/** The x span spider scoring normalises against — spoke 0 to spoke N−1. */
export function spiderAxisRanges(truth: ChallengeTruth): AxisRanges {
  return { xRange: (truth.spokes?.length ?? 1) - 1 || 1, yRange: 1 };
}

/** A user reading turned into the same (spoke index, fraction) space. `null`
 * readings — a spoke left empty — are dropped, which is what makes them count as
 * misses rather than as zeroes. */
export function spiderUserPoints(
  values: readonly (number | null)[],
  truth: ChallengeTruth
): Pt[] {
  const spokes = truth.spokes ?? [];
  const pts: Pt[] = [];
  values.forEach((v, i) => {
    if (v === null || !Number.isFinite(v)) return;
    const spoke = spokes[i];
    const span = spoke ? (spoke.max - spoke.centre) || 1 : 1;
    pts.push({ x: i, y: (v - (spoke?.centre ?? 0)) / span });
  });
  return pts;
}

/**
 * One reading per TUPLE — the shape both bar and pie rounds score.
 *
 * ⚑ WHY THIS IS NOT "one reading per POINT". Since the v2.0 bar model a bar is a
 * two-slot INTERVAL captured as a drag-box, so the dataset holds TWO pixels per
 * bar and the value is `derivedTupleValue`, not either corner. The round scorer
 * read raw dataset points instead — one item per click — so a perfect drag of
 * six bars handed twelve numbers to a scorer expecting six, paired them against
 * the wrong truth entries and charged about 193 seconds on a flawless run. The
 * round only scored "correctly" if the player SINGLE-CLICKED each bar, which
 * leaves every tuple half-filled and exports no value at all (v2.1 audit).
 *
 * `order`:
 * - `'left-to-right'` for bar — there is no x calibration, so pixel order along
 *   the category axis IS the identity, exactly as the export's rank column is.
 * - `'capture'` for pie — a slice's identity is its position in the walk around
 *   the circle, which is the order it was captured in. Sorting a pie by pixel
 *   would scramble it.
 *
 * A tuple with no derived value (half-captured) is DROPPED rather than sent as a
 * zero, so it counts as a miss instead of a wrong answer.
 */
export interface ChallengeTupleRow {
  readonly points: readonly ({ readonly px: number } | null)[];
  readonly derived: number | null;
}
export function derivedTupleItems(
  rows: readonly ChallengeTupleRow[],
  order: 'left-to-right' | 'capture'
): number[][] {
  const kept = rows.flatMap((row) => {
    if (row.derived === null || !Number.isFinite(row.derived)) return [];
    const placed = row.points.filter((p): p is { readonly px: number } => p !== null);
    const px = placed.length > 0 ? placed.reduce((sum, p) => sum + p.px, 0) / placed.length : 0;
    return [{ px, value: row.derived }];
  });
  if (order === 'left-to-right') kept.sort((a, b) => a.px - b.px);
  return kept.map((k) => [k.value]);
}

/** Pie truth as one-value vectors per slice, in the figure's own slice order
 * (the round's instruction names where that order starts). */
export function truthPieValues(truth: ChallengeTruth): number[][] {
  return (truth.series[0]?.points ?? []).map((p) => [Number(p.value)]);
}

/**
 * The true point on spoke `index` for `value`, in image pixels — the spider
 * reveal.
 *
 * Straight-line interpolation between the two anchors the spoke was calibrated
 * from (centre at its centre value, tip at its max), which is the same
 * arithmetic `valueToPy` does for a bar's value axis. Nothing is fitted here:
 * both ends are recorded pixels in the truth file.
 */
export function spiderPointAt(
  cal: ChallengeCalibration,
  truth: ChallengeTruth,
  index: number,
  value: number
): { x: number; y: number } | null {
  const origin = singleAnchor(cal, 'origin');
  const tip = anchorList(cal, 'spoke')[index];
  if (!origin || !tip) return null;
  const spoke = truth.spokes?.[index];
  if (!spoke) return null;
  const span = (spoke.max - spoke.centre) || 1;
  const t = (value - spoke.centre) / span;
  return { x: origin.px + t * (tip.px - origin.px), y: origin.py + t * (tip.py - origin.py) };
}

/** Map a value on the value axis to an image-pixel `py`, from the p1/p2 anchors
 * (bar/box reveal — they have no x calibration, so the true values are drawn as
 * horizontal reference lines). */
export function valueToPy(cal: ChallengeCalibration, value: number): number {
  const p1 = singleAnchor(cal, 'p1');
  const p2 = singleAnchor(cal, 'p2');
  if (!p1 || !p2 || p1.value === undefined || p2.value === undefined || p2.value === p1.value) return 0;
  const t = (value - p1.value) / (p2.value - p1.value);
  return p1.py + t * (p2.py - p1.py);
}

/**
 * Draw the rounds for a game: a shuffled subset of the pool, size
 * `min(target, pool.length)`. `rng` is injectable so tests are deterministic;
 * the app passes `Math.random`.
 */
/**
 * How much WORK a round is, graded (v2.1).
 *
 * ⚑ WHY THE GAME NEEDS THIS. The scoring currency is TIME, and the pool spans a
 * factor of ten in clicks — 61 for the stress–strain curve against 6 for a
 * spider. Drawn uniformly, one playthrough could be three long curves and
 * another three short bar charts, and their scores would not be comparable. The
 * grade is a property of the ROUND, so the draw can hold the shape of a game
 * constant even as the pool grows.
 *
 * Graded by clicks a perfect run needs, adjusted for how much has to be held in
 * mind: a box plot is 25 clicks but five NAMED slots per box, which is harder
 * than a 26-click scatter where every click is the same kind of thing.
 */
export type ChallengeGrade = 'easy' | 'medium' | 'hard';

/** How many rounds of each grade one game is made of. */
export interface GradePlan {
  easy: number;
  medium: number;
  hard: number;
}

/** The shape of a game: two easy, one medium, one hard (David, 2026-08-10). */
export const DEFAULT_GRADE_PLAN: GradePlan = { easy: 2, medium: 1, hard: 1 };

/**
 * Draw one game's rounds, `plan` many of each grade, without repeats.
 *
 * ⚑ A grade with too few members TOPS UP from whatever is left rather than
 * returning a short game — a player is owed four rounds even if the pool is
 * lopsided, and a silently three-round game would read as a bug. The top-up is
 * deterministic in the shuffled order, so a seeded rng still reproduces a game
 * exactly.
 */
export function drawGradedRounds<T>(
  pool: readonly T[],
  gradeOf: (item: T) => ChallengeGrade,
  plan: GradePlan = DEFAULT_GRADE_PLAN,
  rng: () => number = Math.random
): T[] {
  const shuffled = drawRounds(pool, pool.length, rng);
  const picked: T[] = [];
  for (const grade of ['easy', 'medium', 'hard'] as const) {
    let taken = 0;
    for (const item of shuffled) {
      if (taken >= plan[grade]) break;
      if (gradeOf(item) === grade && !picked.includes(item)) {
        picked.push(item);
        taken++;
      }
    }
  }
  const target = plan.easy + plan.medium + plan.hard;
  for (const item of shuffled) {
    if (picked.length >= target) break;
    if (!picked.includes(item)) picked.push(item);
  }
  return picked.slice(0, target);
}

export function drawRounds<T>(pool: readonly T[], target: number, rng: () => number = Math.random): T[] {
  const a = [...pool];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a.slice(0, Math.max(0, Math.min(target, a.length)));
}
