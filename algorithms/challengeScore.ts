/**
 * Trace Challenge scoring (v1.2 game). Pure, DOM-free.
 *
 * The game scores a player's extraction against the committed ground truth in
 * ONE currency: TIME. `adjusted = rawSeconds + penalties`, lower is better —
 * errors add seconds. So rushing sloppily only trades placement time for penalty
 * time; the fun is the sweet spot.
 *
 * Scoring is family-specific because the two XY families mean different things:
 *  - `curve`   — the truth is a continuous curve (its points are a dense/vertex
 *                sampling). Score each user point against the curve (interpolated
 *                at its x), plus a COVERAGE penalty for the x-span left untraced.
 *                Point COUNT is not penalised (tracing a curve with more or fewer
 *                points is equally valid). Multi-curve rounds assign user series to
 *                truth series by best fit, so identity/colour/order don't matter.
 *  - `scatter` — the truth is a discrete set of points, so COUNT matters. One-to-
 *                one nearest matching (in normalised axis space); each matched pair
 *                is taxed by its distance, each unmatched truth point is a MISS and
 *                each unmatched user point an EXTRA.
 *
 * All inputs are in DATA space (the calibrated values the CSV export would carry —
 * `session.getAllDatasetsData().points[].data`), matching `truth.series[].points`.
 * `AxisRanges` normalises error so kPa vs mol% don't skew the tax.
 *
 * The time constants below are deliberately tunable (playtest): a careful run must
 * clearly beat a sloppy-fast one.
 */

export interface Pt {
  x: number;
  y: number;
}

/** Axis spans (max − min) used to normalise positional error to a 0..1 fraction. */
export interface AxisRanges {
  xRange: number;
  yRange: number;
}

export type ScoreFamily = 'curve' | 'scatter';

// --- tunable time model (seconds) ---
/** 1.0 (= a full axis-range) of positional error → this many seconds. So a point
 * 5% off adds 0.05 × 60 = 3 s. Curves use the MEAN error (count-independent);
 * scatter SUMS per-point error. */
export const ERROR_SECONDS_PER_UNIT = 60;
/** A curve traced over none of its x-span adds this (scaled by the uncovered fraction). */
export const COVERAGE_PENALTY_S = 30;
/** A truth scatter point the player never placed. */
export const MISS_POINT_S = 15;
/** A player scatter point that matches no truth point. */
export const EXTRA_POINT_S = 10;
/** A whole truth curve the player never traced. */
export const MISS_SERIES_S = 45;
/** A spurious extra curve the player traced. */
export const EXTRA_SERIES_S = 30;
/** Scatter points farther apart than this (normalised) never match — beyond it a
 * "match" is really a miss + an extra, not a sloppy hit. */
export const SCATTER_MATCH_THRESHOLD = 0.15;

export interface RoundBreakdown {
  /** Matched pairs (scatter points, or curve series). */
  matchedCount: number;
  /** Unmatched truth (scatter points, or whole curves). */
  misses: number;
  /** Unmatched user (scatter points, or whole curves). */
  extras: number;
  /** Mean positional error of matched items, 0..1 of axis range — for display. */
  meanErrorFrac: number;
  errorSeconds: number;
  coverageSeconds: number;
  missSeconds: number;
  extraSeconds: number;
}

export interface RoundScore {
  rawSeconds: number;
  penaltySeconds: number;
  adjustedSeconds: number;
  breakdown: RoundBreakdown;
}

/** Piecewise-linear interpolation of a curve's y at x; null when x is outside the
 * curve's x-domain (an out-of-domain user point can't be scored against the curve). */
export function interpY(sortedByX: readonly Pt[], x: number): number | null {
  const n = sortedByX.length;
  if (n === 0) return null;
  if (x < sortedByX[0]!.x || x > sortedByX[n - 1]!.x) return null;
  for (let i = 1; i < n; i++) {
    const b = sortedByX[i]!;
    if (x <= b.x) {
      const a = sortedByX[i - 1]!;
      const t = b.x === a.x ? 0 : (x - a.x) / (b.x - a.x);
      return a.y + t * (b.y - a.y);
    }
  }
  return sortedByX[n - 1]!.y;
}

interface CurveFit {
  /** Mean |Δy|/yRange, measured in BOTH directions (see `fitCurveSeries`).
   * 1 when the two curves have no overlap to compare over. */
  errorFrac: number;
  /** Fraction of the truth x-span the user did NOT cover (0 = fully spanned). */
  coverageFrac: number;
}

/** Mean |Δy|/yRange of `samples` against the polyline `line`, over the samples
 * that fall inside the line's x domain. `null` when none do — the caller decides
 * what an empty comparison means in its direction. */
function meanDeviation(samples: readonly Pt[], line: readonly Pt[], yRange: number): number | null {
  let sum = 0;
  let n = 0;
  for (const p of samples) {
    const y = interpY(line, p.x);
    if (y !== null) {
      sum += Math.abs(p.y - y) / yRange;
      n++;
    }
  }
  return n > 0 ? sum / n : null;
}

/**
 * Score one user series against one truth curve.
 *
 * ⚑⚑ THE DEVIATION IS MEASURED IN BOTH DIRECTIONS, AND THAT IS THE WHOLE POINT.
 *
 * This function used to sample only one way — the TRUTH interpolated at each
 * USER x — so the error was computed exclusively where the player CHOSE TO
 * CLICK. Every point they placed was on the curve, therefore the error was zero,
 * therefore the score was perfect. `coverageFrac` did not catch it either: it
 * measures the x-SPAN (min to max) and says nothing about what happens between
 * the ends.
 *
 * ⇒ **Two clicks, one at each end of the curve, scored EXACTLY the same as a
 * flawless 61-click trace** — while taking a fraction of the time, and the game
 * ranks on time. The optimal strategy was to trace as little as possible. A
 * round whose truth peaks at y=71 between the endpoints was won by drawing the
 * straight line that misses the peak entirely, with a penalty of 0.000.
 *
 * The two directions catch different lies and neither is redundant:
 *   - **user → truth** — is each point the player placed actually ON the curve?
 *     Catches a click in the wrong place.
 *   - **truth → user** — does the player's polyline reproduce the curve's SHAPE?
 *     Catches structure skipped between clicks. This is the missing half.
 *
 * Averaging them keeps a perfect trace at exactly 0 (both directions are 0) and
 * leaves a uniformly-wrong trace unchanged (both directions agree), so only the
 * under-sampling case moves — which is the case that was wrong.
 *
 * ⚑ Truth samples outside the user's x span are SKIPPED rather than charged:
 * that gap is what `coverageFrac` already prices, and charging it here as well
 * would tax the same omission twice.
 */
function fitCurveSeries(user: readonly Pt[], truth: readonly Pt[], r: AxisRanges): CurveFit {
  const sortedT = [...truth].sort((a, b) => a.x - b.x);
  const sortedU = [...user].sort((a, b) => a.x - b.x);
  const tXmin = sortedT[0]!.x;
  const tXmax = sortedT[sortedT.length - 1]!.x;
  const tSpan = tXmax - tXmin || 1;

  let uXmin = Infinity;
  let uXmax = -Infinity;
  for (const p of user) {
    if (p.x < uXmin) uXmin = p.x;
    if (p.x > uXmax) uXmax = p.x;
  }

  const userToTruth = meanDeviation(sortedU, sortedT, r.yRange);
  const truthToUser = meanDeviation(sortedT, sortedU, r.yRange);
  const both = [userToTruth, truthToUser].filter((d): d is number => d !== null);
  const errorFrac = both.length > 0 ? both.reduce((s, d) => s + d, 0) / both.length : 1;

  const covered = user.length > 0 ? (Math.min(uXmax, tXmax) - Math.max(uXmin, tXmin)) / tSpan : 0;
  const coverageFrac = 1 - Math.min(1, Math.max(0, covered));
  return { errorFrac, coverageFrac };
}

/** Multi-curve round: assign user series → truth series one-to-one by best fit
 * (greedy global-minimum), so which user series is "Blend A" doesn't matter. */
function scoreCurveRound(userSeries: readonly Pt[][], truthSeries: readonly Pt[][], r: AxisRanges): RoundBreakdown {
  const pairs: { u: number; t: number; fit: CurveFit; cost: number }[] = [];
  for (let u = 0; u < userSeries.length; u++) {
    for (let t = 0; t < truthSeries.length; t++) {
      const fit = fitCurveSeries(userSeries[u]!, truthSeries[t]!, r);
      pairs.push({ u, t, fit, cost: fit.errorFrac + 0.5 * fit.coverageFrac });
    }
  }
  pairs.sort((a, b) => a.cost - b.cost);
  const usedU = new Set<number>();
  const usedT = new Set<number>();
  const matches: { fit: CurveFit }[] = [];
  for (const p of pairs) {
    if (usedU.has(p.u) || usedT.has(p.t)) continue;
    usedU.add(p.u);
    usedT.add(p.t);
    matches.push(p);
  }
  let errorSeconds = 0;
  let coverageSeconds = 0;
  let errSum = 0;
  for (const m of matches) {
    errorSeconds += m.fit.errorFrac * ERROR_SECONDS_PER_UNIT;
    coverageSeconds += m.fit.coverageFrac * COVERAGE_PENALTY_S;
    errSum += m.fit.errorFrac;
  }
  const misses = truthSeries.length - matches.length; // truth curves never traced
  const extras = userSeries.length - matches.length; // spurious curves
  return {
    matchedCount: matches.length,
    misses,
    extras,
    meanErrorFrac: matches.length > 0 ? errSum / matches.length : 1,
    errorSeconds,
    coverageSeconds,
    missSeconds: misses * MISS_SERIES_S,
    extraSeconds: extras * EXTRA_SERIES_S,
  };
}

/** Scatter round: one-to-one nearest matching in normalised space, thresholded. */
function scoreScatterRound(user: readonly Pt[], truth: readonly Pt[], r: AxisRanges): RoundBreakdown {
  const nd = (a: Pt, b: Pt) => Math.hypot((a.x - b.x) / r.xRange, (a.y - b.y) / r.yRange);
  const pairs: { u: number; t: number; d: number }[] = [];
  for (let u = 0; u < user.length; u++) {
    for (let t = 0; t < truth.length; t++) {
      const d = nd(user[u]!, truth[t]!);
      if (d <= SCATTER_MATCH_THRESHOLD) pairs.push({ u, t, d });
    }
  }
  pairs.sort((a, b) => a.d - b.d);
  const usedU = new Set<number>();
  const usedT = new Set<number>();
  let errSum = 0;
  let matched = 0;
  for (const p of pairs) {
    if (usedU.has(p.u) || usedT.has(p.t)) continue;
    usedU.add(p.u);
    usedT.add(p.t);
    errSum += p.d;
    matched++;
  }
  const misses = truth.length - matched; // truth points never placed
  const extras = user.length - matched; // user points matching nothing
  return {
    matchedCount: matched,
    misses,
    extras,
    meanErrorFrac: matched > 0 ? errSum / matched : 1,
    errorSeconds: errSum * ERROR_SECONDS_PER_UNIT,
    coverageSeconds: 0,
    missSeconds: misses * MISS_POINT_S,
    extraSeconds: extras * EXTRA_POINT_S,
  };
}

/**
 * Score one round. `userSeries` / `truthSeries` are arrays of point arrays (one per
 * series) in DATA space; `rawSeconds` is the elapsed placement time.
 */
export function scoreRound(
  family: ScoreFamily,
  userSeries: readonly Pt[][],
  truthSeries: readonly Pt[][],
  ranges: AxisRanges,
  rawSeconds: number
): RoundScore {
  const breakdown =
    family === 'scatter'
      ? scoreScatterRound(userSeries.flat(), truthSeries.flat(), ranges)
      : scoreCurveRound(userSeries, truthSeries, ranges);
  const penaltySeconds =
    breakdown.errorSeconds + breakdown.coverageSeconds + breakdown.missSeconds + breakdown.extraSeconds;
  return {
    rawSeconds,
    penaltySeconds,
    adjustedSeconds: rawSeconds + penaltySeconds,
    breakdown,
  };
}

/**
 * Score an ORDERED categorical round (bar / box-plot). Each item is a value
 * vector — bar: `[value]`; box: `[min,q1,median,q3,max]` — and items are paired
 * LEFT-TO-RIGHT (both sides pre-sorted by pixel position), because bar/box have
 * no x calibration so order IS the category identity. Per matched pair the mean
 * component error (normalised by the value-axis range) is taxed; a category with
 * no user item is a MISS, a surplus user item an EXTRA. (Histogram is scored as a
 * scatter over (bin-centre, value) via `scoreRound('scatter', …)` instead — it
 * DOES have an x axis, so it matches spatially and needn't cascade on a skip.)
 */
export function scoreOrderedRound(
  userItems: readonly number[][],
  truthItems: readonly number[][],
  valueRange: number,
  rawSeconds: number
): RoundScore {
  const n = Math.min(userItems.length, truthItems.length);
  let errSum = 0;
  for (let i = 0; i < n; i++) {
    const u = userItems[i]!;
    const t = truthItems[i]!;
    const m = Math.min(u.length, t.length);
    let e = 0;
    for (let k = 0; k < m; k++) e += Math.abs(u[k]! - t[k]!) / valueRange;
    errSum += m > 0 ? e / m : 1;
  }
  const misses = Math.max(0, truthItems.length - userItems.length);
  const extras = Math.max(0, userItems.length - truthItems.length);
  const breakdown: RoundBreakdown = {
    matchedCount: n,
    misses,
    extras,
    meanErrorFrac: n > 0 ? errSum / n : 1,
    errorSeconds: errSum * ERROR_SECONDS_PER_UNIT,
    coverageSeconds: 0,
    missSeconds: misses * MISS_POINT_S,
    extraSeconds: extras * EXTRA_POINT_S,
  };
  const penaltySeconds = breakdown.errorSeconds + breakdown.missSeconds + breakdown.extraSeconds;
  return { rawSeconds, penaltySeconds, adjustedSeconds: rawSeconds + penaltySeconds, breakdown };
}
