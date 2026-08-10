/**
 * Trace Challenge — the UI-side manifest (v1.2 game). This is where the committed
 * ground-truth JSON is pulled into the bundle (Vite resolves JSON imports), keyed
 * by the SAME `EXAMPLES` id used to load the figure. Kept out of `engine/` so the
 * pure round logic stays asset-free and node-testable.
 *
 * Pool = 13 examples across 7 scoring families: XY curves + scatter (Phase A),
 * bar / histogram / box (Phase B), the three v2.0 bar variants, and the two
 * non-Cartesian records — spider (N×1D) and pie (1.5D intervals).
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
import spiderTruth from '../../samples/spider-material-profile.truth.json';
import pieTruth from '../../samples/pie-filler-composition.truth.json';
import pieExplodedTruth from '../../samples/pie-exploded-market-share.truth.json';

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
 *     spider 6 · pie 6 · pie-exploded 9 (+1 arming toggle)
 *
 * ⚑ boxplot is graded HARD on 25 clicks while scatter is MEDIUM on 26: a box is
 * five NAMED slots per item, which has to be held in mind, where a scatter's
 * every click is the same kind of thing. Clicks are the measure, not the whole
 * of it. The same reasoning splits the two 6-click rounds added in v2.1: a
 * spider is EASY (six clicks, one per labelled ray, each its own thing) and a
 * pie is MEDIUM (six clicks, but each is a BOUNDARY serving two slices, so the
 * value is never the thing clicked). */

/**
 * ⚑ SPIDER AND PIE ARE RESHAPED HERE, not in the truth files.
 *
 * Every other family's truth file already matches `ChallengeTruth`. These two do
 * not, and the mismatch is the MODEL showing through rather than an oversight:
 * a spider's `axes` is an ARRAY (one scale per spoke, the N×1D record) and a pie
 * has no axes block at all (its scale is a `total`). Translating at this
 * boundary is the same thing an import filter does — the files stay faithful to
 * the figures, and `engine/` keeps one type.
 */
const spiderRaw = spiderTruth as unknown as {
  axes: { centre: number; max: number }[];
  calibration: {
    imageWidth: number;
    imageHeight: number;
    anchors: Record<string, { px: number; py: number; value?: number; name?: string }>;
  };
  series: ChallengeTruth['series'];
};
const spiderChallengeTruth: ChallengeTruth = {
  graphType: 'spider',
  spokes: spiderRaw.axes.map((a) => ({ centre: a.centre, max: a.max })),
  calibration: {
    imageWidth: spiderRaw.calibration.imageWidth,
    imageHeight: spiderRaw.calibration.imageHeight,
    // The file names the spokes `spoke1 … spoke6`; they become the ONE array the
    // repeating step is declared with -- see calibrationInputsFromAnchors.
    anchors: {
      origin: spiderRaw.calibration.anchors.origin!,
      spoke: spiderRaw.axes.map((_, i) => spiderRaw.calibration.anchors[`spoke${i + 1}`]!),
    },
  },
  // One profile only, as the multi-curve rounds do -- the figure still draws both.
  series: [spiderRaw.series[0]!],
};

/** Both pie rounds reshape identically; only the file differs. */
interface PieRawTruth {
  total: number;
  calibration: {
    imageWidth: number;
    imageHeight: number;
    anchors: Record<string, unknown>;
    slices: NonNullable<ChallengeTruth['calibration']['slices']>;
  };
  series: ChallengeTruth['series'];
}
function pieChallengeTruthFrom(raw: PieRawTruth): ChallengeTruth {
  return {
    graphType: 'pie',
    total: raw.total,
    calibration: {
      imageWidth: raw.calibration.imageWidth,
      imageHeight: raw.calibration.imageHeight,
      // ⚑ ONLY the outline. `centre` and `rim` are in the file as the FITTED
      // result, and the app fits them from the outline rather than being told --
      // handing them over as placed points would seed the round with two handles
      // no calibration step owns.
      anchors: { outline: raw.calibration.anchors.outline as never },
      // Carried for the reveal, which draws each slice's true edge from ITS OWN
      // apex -- the pulled-out slice's apex is not the pie's centre.
      ...(raw.calibration.slices ? { slices: raw.calibration.slices } : {}),
    },
    series: raw.series,
  };
}
const pieChallengeTruth = pieChallengeTruthFrom(pieTruth as unknown as PieRawTruth);
const pieExplodedChallengeTruth = pieChallengeTruthFrom(pieExplodedTruth as unknown as PieRawTruth);

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
  // ⚑ THE TWO NON-CARTESIAN FAMILIES, added 2026-08-10. Neither scores through
  // an existing family: a spider is N×1D (the spoke is the identity, so a skipped
  // spoke is a miss on THAT spoke, not a shift) and a pie's datum is the
  // DIFFERENCE between two boundaries. See engine/traceChallenge.ts.
  spider: {
    family: 'spider',
    grade: 'easy',
    instruction: 'Place one point on each axis of the Chitosan film profile — the shaded outline.',
    truth: spiderChallengeTruth,
  },
  // ⚑ Graded MEDIUM on 6 clicks, against bar's EASY on 12. What is being asked
  // is not clicks: each click is a BOUNDARY serving two slices (five slices take
  // six clicks, the last closing the ring), so the value is never the thing
  // clicked, and the round only lines up with truth if the player starts where
  // the instruction says. That is held in mind, not aimed.
  pie: {
    family: 'pie',
    grade: 'medium',
    instruction: 'Click each slice boundary on the rim — start at the top (12 o’clock) and work clockwise.',
    truth: pieChallengeTruth,
  },
  // ⚑ THE BOSS LEVEL (v2.1). A pulled-out slice does not share the pie's centre,
  // so it is measured about its OWN apex -- get that wrong and a 90-degree slice
  // reads about 8 degrees off, a wrong number with nothing on screen looking
  // wrong. The chain breaks there too (a pulled-out slice shares no boundary
  // with anyone), so its two edges are a pair of their own: 9 clicks and one
  // arming toggle against the plain pie's 6.
  //
  // ⚑ The instruction stays NEUTRAL, the same call the missing-bar round makes.
  // Naming the pulled-out slice would give away the one thing being asked, and
  // it does not need naming: the figure shows it, and the "Slice is exploded"
  // control sits on the canvas the whole time a pie is being captured. Visible
  // on screen is the bar -- not visible in the instruction.
  'pie-exploded': {
    family: 'pie',
    grade: 'hard',
    instruction: 'Click each slice boundary on the rim — start at the top (12 o’clock) and work clockwise.',
    truth: pieExplodedChallengeTruth,
  },
};

/** The example ids eligible for the challenge (the draw pool). */
export const CHALLENGE_IDS = Object.keys(CHALLENGE_META);
