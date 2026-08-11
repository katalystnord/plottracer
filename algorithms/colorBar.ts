/**
 * The colour bar — turning a cell's colour back into a POSITION on the key
 * (v2.2, heatmaps, phase 1).
 *
 * ⚑⚑ WHY THIS IS THE FIRST THING BUILT, AND WHY IT GETS THIS MUCH CARE. In a
 * heatmap the colour IS the value, so a colour error is a VALUE error — and it
 * is SILENT. On a bar chart a slightly-off colour still lands inside the
 * tolerance ball and finds the right bar; the number that comes out is still
 * the bar's. Here, a JPEG-shifted cell returns a slightly WRONG NUMBER with no
 * symptom anywhere: no missing point, no refusal, no visibly odd trace. Tenet
 * 1's worst shape.
 *
 * ⚑ SO THIS MODULE RETURNS A MEASUREMENT, NOT AN ANSWER. Every inversion comes
 * back with the evidence for itself:
 *
 *   distance ....... how far the queried colour sits OFF the ramp. Zero on a
 *                    clean PNG; a few counts under JPEG; large for a gridline,
 *                    a printed number or a significance asterisk that was never
 *                    on the key at all.
 *   tLow..tHigh .... the stretch of the key this colour CANNOT be told apart
 *                    from, at that measured colour error. This is the key's own
 *                    resolution, read off the key. It widens exactly where the
 *                    ramp is ill-conditioned — the ends of `jet`, where a large
 *                    value change makes a small colour change — so the figure's
 *                    own weakness shows up as a wider band instead of as a
 *                    confidently wrong number.
 *   rivals ......... OTHER, disjoint stretches equally consistent with this
 *                    colour. A cyclic map (`hsv`) has the same colour at both
 *                    ends, and there the position is not merely imprecise, it is
 *                    AMBIGUOUS. Two candidates is a fact about the figure; we
 *                    report it rather than pick.
 *
 * That is tenets 9 + 10: we record what the pixels support and let the
 * disagreement be visible. It is the same corroboration principle the bar
 * retake settled on, arriving early because here it is cheap.
 *
 * ⚑ THE UNCERTAINTY IS AN INTERVAL IN POSITION, NOT A DERIVATIVE — deliberately.
 * A band converts through ANY monotone scale (including the log colour bars that
 * are ordinary in older papers) by mapping its two ends, with no calculus and no
 * error propagation. It also degrades gracefully where a derivative blows up: on
 * a FLAT stretch of ramp the band simply gets wide, where `dt/dE` would be
 * infinite and would have to be laundered into a null on its way to the record
 * (see the curve-fit overflow: `null * x === 0`).
 *
 * ⚑ POSITION ONLY — this module never produces a value. Position → value is two
 * labelled ticks on the key, i.e. the ordinary axis machinery, log rule
 * included (`core/axes/logScale.ts`). Keeping that out of here is what makes the
 * colour bar just another axis rather than a special mechanism.
 *
 * ⚑ RGB EUCLIDEAN, NOT A PERCEPTUAL SPACE, and that is a considered choice. We
 * are not asking "do these look alike to a human" — we are matching a rendered
 * pixel against the ramp in the SAME rendering. The error we are chasing (8-bit
 * rounding, JPEG chroma quantisation, anti-aliasing) lives in RGB, and the rest
 * of the extraction stack already measures colour there (`colorFilter.ts`).
 *
 * Pure: bytes in, numbers out. No DOM, no engine imports, no `core/` imports.
 */

import type { RGB } from './colorFilter.js';

/** A point in image-pixel space. Local, so this file needs nothing from `core/`. */
export interface Point2D {
  x: number;
  y: number;
}

/**
 * The smallest colour difference we are willing to treat as real, as an RGB
 * Euclidean distance.
 *
 * A FLOOR, not a claim about any particular encoder: it is the width the
 * indistinguishable band gets when a cell matches the ramp EXACTLY (distance 0),
 * which is the common case on a PNG. Without it, a perfect match would report
 * zero uncertainty — which no measurement off an 8-bit image has ever had. Where
 * the measured error is larger, the measured error is used instead.
 */
export const COLOR_NOISE_FLOOR = 4;

/**
 * A strip shorter than this cannot be sampled meaningfully — there is nowhere
 * near enough of the ramp to invert against, and at this size the two clicks are
 * far more likely to be a mis-click than a key.
 */
export const MIN_STRIP_LENGTH_PX = 8;

/**
 * How much colour a strip must actually SPAN (the diagonal of the sampled
 * colours' RGB bounding box) before we accept it as a key.
 *
 * ⚑ This exists for one specific, likely user error: clicking the two ends
 * ACROSS the bar's width instead of ALONG its length. That gives a strip of one
 * flat colour, on which every cell in the figure inverts to the same meaningless
 * position — silently. Real published keys span hundreds of units here (viridis
 * runs dark purple to yellow); pure sensor/JPEG noise on a flat fill spans
 * around ten. The gap between those two populations is wide enough that this
 * threshold is not a tuning parameter.
 */
export const MIN_RAMP_SPREAD = 24;

/** One position along the key, and the colour found there. */
export interface ColorBarSample {
  /** Position along the strip, 0 at `from` and 1 at `to`. */
  t: number;
  rgb: RGB;
}

/**
 * A sampled colour key. The ONLY way to obtain one is `sampleColorBar`, which
 * refuses the unusable cases — but the type has a second entrance the moment a
 * project file carries one, so `checkStripSamples` is exported for the load path
 * to run the identical check. (Guards belong in the model, and the model has
 * more than one entrance.)
 */
export interface ColorBarStrip {
  /** Ordered by `t` ascending. Positions where every pixel was transparent are
   * absent rather than guessed, so the spacing is not always uniform. */
  samples: readonly ColorBarSample[];
  from: Point2D;
  to: Point2D;
  /** How many pixels across the strip were combined per sample (1 = the line). */
  thickness: number;
}

/**
 * Why a strip was refused. Codes, not sentences: the sentence belongs where it
 * is shown. Each one must reach the user naming both the REQUIREMENT and its
 * CONSEQUENCE — "the two ends must lie along the bar's length; as clicked, every
 * cell would read the same value" — because a refusal that only says "invalid"
 * sends the user to fix something that is not broken.
 */
export type ColorBarRefusal =
  /** The two ends coincide, are closer than `MIN_STRIP_LENGTH_PX`, or are not
   * finite numbers. */
  | 'not-a-line'
  /** An end lies outside the image. */
  | 'off-image'
  /** Everything along the strip was fully transparent — there is no key here. */
  | 'no-pixels'
  /** The strip carries one flat colour (see `MIN_RAMP_SPREAD`) — most likely
   * clicked across the bar rather than along it. */
  | 'no-ramp';

export interface ColorBarStripResult {
  strip: ColorBarStrip | null;
  reason: ColorBarRefusal | null;
}

export interface SampleColorBarOptions {
  /**
   * Pixels across the strip to combine per sample, centred on the line. 1 reads
   * exactly the line the user pointed at; a wider window trades a little
   * position precision for a lot of noise rejection on a JPEG key. Combined by
   * MEDOID (below), so a border, a tick or a printed label clipping the window
   * is outvoted rather than averaged in.
   */
  thickness?: number;
}

/** Euclidean distance between two colours in RGB. */
export function colorDistance(a: RGB, b: RGB): number {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/**
 * The most representative colour of a set: the member with the smallest total
 * distance to the others.
 *
 * ⚑ A MEDOID, NOT A MEAN OR A PER-CHANNEL MEDIAN, and the difference matters
 * here. Both of those can return a colour that is not in the set and not on the
 * ramp — averaging across a cell border invents a blend that sits BETWEEN two
 * positions on the key, which then inverts to a position the figure never
 * asserted. A medoid is always a colour that was actually printed.
 *
 * Returns null for an empty set. O(n²), and n is a strip's thickness.
 */
export function medoidColor(colors: readonly RGB[]): RGB | null {
  if (colors.length === 0) return null;
  let best = colors[0]!;
  let bestTotal = Infinity;
  for (const candidate of colors) {
    let total = 0;
    for (const other of colors) total += colorDistance(candidate, other);
    if (total < bestTotal) {
      bestTotal = total;
      best = candidate;
    }
  }
  return best;
}

/** The diagonal of the sampled colours' RGB bounding box — how much colour the
 * strip spans. Zero for a flat strip. Its only caller has already established
 * that there are at least two samples. */
function rampSpread(samples: readonly ColorBarSample[]): number {
  const lo: [number, number, number] = [255, 255, 255];
  const hi: [number, number, number] = [0, 0, 0];
  for (const s of samples) {
    for (let c = 0; c < 3; c++) {
      const v = s.rgb[c]!;
      if (v < lo[c]!) lo[c] = v;
      if (v > hi[c]!) hi[c] = v;
    }
  }
  return colorDistance(lo, hi);
}

/**
 * The check `sampleColorBar` applies to what it read, exported so the load path
 * can apply the identical one to a strip that arrives from a project file.
 * Returns null when the samples are usable.
 */
export function checkStripSamples(samples: readonly ColorBarSample[]): ColorBarRefusal | null {
  if (samples.length < 2) return 'no-pixels';
  if (rampSpread(samples) < MIN_RAMP_SPREAD) return 'no-ramp';
  return null;
}

/**
 * Read the key: walk the line from `from` to `to` across an RGBA image, one
 * sample per pixel step, and record the colour at each position.
 *
 * `src` is a flat RGBA byte array (`ImageData.data`'s shape). Fully transparent
 * pixels are not part of the figure and are skipped; a position where the whole
 * cross-section is transparent is DROPPED rather than filled in, which is why
 * samples carry their own `t`.
 */
export function sampleColorBar(
  src: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  from: Point2D,
  to: Point2D,
  options: SampleColorBarOptions = {}
): ColorBarStripResult {
  const thickness = Math.max(1, Math.round(options.thickness ?? 1));

  if (
    !Number.isFinite(from.x) ||
    !Number.isFinite(from.y) ||
    !Number.isFinite(to.x) ||
    !Number.isFinite(to.y)
  ) {
    return { strip: null, reason: 'not-a-line' };
  }

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.sqrt(dx * dx + dy * dy);
  if (length < MIN_STRIP_LENGTH_PX) return { strip: null, reason: 'not-a-line' };

  const inside = (p: Point2D): boolean =>
    p.x >= 0 && p.y >= 0 && p.x <= width - 1 && p.y <= height - 1;
  if (!inside(from) || !inside(to)) return { strip: null, reason: 'off-image' };

  // Unit vector across the strip, for the thickness window.
  const px = -dy / length;
  const py = dx / length;
  const half = (thickness - 1) / 2;

  const steps = Math.round(length);
  const samples: ColorBarSample[] = [];
  const window: RGB[] = [];

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const cx = from.x + dx * t;
    const cy = from.y + dy * t;
    window.length = 0;
    for (let k = 0; k < thickness; k++) {
      const off = k - half;
      const x = Math.round(cx + px * off);
      const y = Math.round(cy + py * off);
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const idx = (y * width + x) * 4;
      if (src[idx + 3] === 0) continue; // transparent -> not part of the figure
      window.push([src[idx]!, src[idx + 1]!, src[idx + 2]!]);
    }
    const rgb = medoidColor(window);
    if (rgb !== null) samples.push({ t, rgb });
  }

  const reason = checkStripSamples(samples);
  if (reason !== null) return { strip: null, reason };
  return { strip: { samples, from, to, thickness }, reason: null };
}

/**
 * Where a clicked point falls along the strip, as a position in the same 0..1
 * frame the samples use. Values outside 0..1 mean the click was past an end.
 *
 * ⚑ THIS IS HOW A LABELLED TICK BECOMES A NUMBER. Position → value needs two
 * points on the key whose values the figure prints; the user clicks them, and
 * this projects each click onto the strip so the pair can be interpolated. It is
 * a projection rather than a distance because the click will never land exactly
 * on the line the strip was sampled along, and the component ACROSS the strip
 * carries no information — a tick clicked 3px above the bar is the same tick.
 *
 * Returns null for a degenerate strip, which `sampleColorBar` cannot produce.
 */
export function positionOnStrip(strip: ColorBarStrip, point: Point2D): number | null {
  const dx = strip.to.x - strip.from.x;
  const dy = strip.to.y - strip.from.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0 || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  return ((point.x - strip.from.x) * dx + (point.y - strip.from.y) * dy) / len2;
}

/**
 * One stretch of the key that a queried colour is consistent with.
 *
 * `t` is the best position within it; `tLow..tHigh` is how far that reading
 * could move without the colour changing by more than the error we already
 * measured on this very pixel. The band is the honest error bar: it is derived
 * from the key's own ramp, not from an assumed tolerance.
 */
export interface ColorBarBand {
  t: number;
  tLow: number;
  tHigh: number;
  /** RGB distance from the queried colour to the ramp, at `t`. */
  distance: number;
}

export interface ColorBarReading extends ColorBarBand {
  /**
   * Other, disjoint stretches equally consistent with the queried colour,
   * nearest-first. Empty for a well-conditioned monotone ramp. Non-empty means
   * the position is AMBIGUOUS, not merely imprecise — the reading must not be
   * recorded as a number without the user resolving it.
   */
  rivals: readonly ColorBarBand[];
}

/**
 * Distance from `rgb` to the segment `a`→`b` in RGB space, and where along it
 * (`u`, clamped to 0..1) the closest point sits.
 *
 * ⚑ `a` and `b` are never the same colour, so there is no degenerate case to
 * guard. The only caller projects onto the segments LEAVING a plateau, and a
 * neighbour holding the plateau's colour would hold its distance too and hence
 * be part of it.
 */
function projectOntoSegment(rgb: RGB, a: RGB, b: RGB): { u: number; distance: number } {
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const vz = b[2] - a[2];
  const len2 = vx * vx + vy * vy + vz * vz;
  const wx = rgb[0] - a[0];
  const wy = rgb[1] - a[1];
  const wz = rgb[2] - a[2];
  const u = Math.min(1, Math.max(0, (wx * vx + wy * vy + wz * vz) / len2));
  const closest: RGB = [a[0] + vx * u, a[1] + vy * u, a[2] + vz * u];
  return { u, distance: colorDistance(rgb, closest) };
}

/**
 * Invert a colour against a sampled key: where on the bar is this colour, how
 * far off the ramp is it, how precisely is it placed, and is that placement
 * unique?
 *
 * Returns null only for a strip with fewer than two samples, which
 * `sampleColorBar` cannot produce — it is the guard for the strip's other
 * entrance.
 */
export function invertColor(strip: ColorBarStrip, rgb: RGB): ColorBarReading | null {
  const samples = strip.samples;
  const n = samples.length;
  if (n < 2) return null;

  const d = new Float64Array(n);
  let best = 0;
  for (let i = 0; i < n; i++) {
    d[i] = colorDistance(rgb, samples[i]!.rgb);
    if (d[i]! < d[best]!) best = i;
  }

  // ⚑⚑ A COLOUR OCCUPIES A STRETCH OF THE KEY, NOT A POINT, AND THE READING IS
  // ITS MIDDLE. A colormap is a lookup table — matplotlib's are 256 entries —
  // so a key drawn 550px long repeats every colour over about two pixels, and a
  // large figure or a coarse map makes those plateaus much wider. Taking the
  // FIRST tied position (what `argmin` does, and what this did first) biases
  // every single reading to the LOW end of its plateau. Measured on the jet
  // fixture: a systematic 0.6–0.8 °C under-read on a 160 °C range, in the same
  // direction for every cell, from a colour that matched the key EXACTLY. A
  // constant signed bias is the worst kind — averaging cells does not remove it.
  const plateau = tiedRun(d, best);
  let t = (samples[plateau.lo]!.t + samples[plateau.hi]!.t) / 2;
  let distance = d[best]!;

  // Refine BETWEEN samples: the true position generally falls between two pixels
  // of the key. Only the segments leaving the plateau can improve on it — inside
  // the plateau every colour is identical, so there is nothing to interpolate.
  for (const j of [plateau.lo - 1, plateau.hi]) {
    if (j < 0 || j + 1 >= n) continue;
    const lo = samples[j]!;
    const hi = samples[j + 1]!;
    const p = projectOntoSegment(rgb, lo.rgb, hi.rgb);
    if (p.distance < distance) {
      distance = p.distance;
      t = lo.t + (hi.t - lo.t) * p.u;
    }
  }

  // Which OTHER positions is this colour equally consistent with?
  //
  // ⚑ THE MISMATCH HAS TO BE SPLIT INTO TWO COMPONENTS, and only one of them is
  // uncertainty about POSITION. `distance` is the part that points OFF the ramp
  // — contamination, JPEG, a border blended in — and it is common to every
  // position; no amount of sliding along the key removes it. What separates one
  // position from another is the remaining component ALONG the ramp, which by
  // Pythagoras is `sqrt(d² − distance²)`. A position is not excluded when that
  // along-ramp part is no larger than the error we already measured on this very
  // pixel (floored, so an exact match does not claim zero uncertainty).
  //
  // ⚑ Testing `d[i] <= distance` instead — the obvious first form of this, and
  // the one written here first — is DEGENERATE: `distance` is by construction
  // the minimum over the whole key, so nothing but the winner can ever satisfy
  // it and every band collapses to a point. That is the dangerous direction. A
  // contaminated cell would have reported the tightest confidence of all.
  // ⚑⚑ AND THE KEY'S OWN STEP IS A FLOOR TOO. The lookup table that makes a
  // plateau also sets a hard limit on precision: two values inside one entry are
  // printed identically, so no inversion can separate them. Worse, the key and
  // the cells are TWO renderings of that table and their bin boundaries need not
  // line up — measured on the jet fixture, a cell whose colour matched the key
  // exactly still sat up to a full entry away from where the key put it. A band
  // narrower than one step of the key would therefore exclude the right answer
  // while reporting distance 0, which is the confidently-wrong reading this
  // module exists to prevent. This is measured off the key, not assumed: it is
  // the colour distance from the plateau to the next DIFFERENT colour on it.
  const step = localStep(samples, plateau);
  const alongTolerance = Math.max(distance, COLOR_NOISE_FLOOR, step);
  const tolerance = Math.sqrt(distance * distance + alongTolerance * alongTolerance);

  const bands: { band: ColorBarBand; i0: number; i1: number }[] = [];
  let runStart = -1;
  for (let i = 0; i <= n; i++) {
    const within = i < n && d[i]! <= tolerance;
    if (within && runStart < 0) runStart = i;
    if (!within && runStart >= 0) {
      bands.push({ band: bandFromRun(samples, d, runStart, i - 1, tolerance), i0: runStart, i1: i - 1 });
      runStart = -1;
    }
  }

  // ⚑ The winner is the band holding the NEAREST SAMPLE, not the band whose
  // span happens to contain the refined `t`. Those differ where two bands abut
  // after interpolation, and picking by span would silently swap a reading for
  // its rival.
  const winnerIndex = bands.findIndex((b) => best >= b.i0 && best <= b.i1);
  // The refined position can beat every sampled one (the colour sits between two
  // pixels of the key on a steep ramp), leaving no sample under tolerance. The
  // reading is then a point, not a band — reported as such rather than widened
  // to something we did not measure.
  if (winnerIndex < 0) return { t, tLow: t, tHigh: t, distance, rivals: [] };

  const winner = bands[winnerIndex]!.band;
  const rivals = bands
    .filter((_, i) => i !== winnerIndex)
    .map((b) => b.band)
    .sort((a, b) => a.distance - b.distance);
  return { t, tLow: winner.tLow, tHigh: winner.tHigh, distance, rivals };
}

/**
 * The contiguous stretch around `index` whose samples are all EXACTLY as good a
 * match as `index` itself — the colormap's lookup-table plateau.
 *
 * Exact equality is the right test and not a floating-point hazard: two samples
 * that hold the same RGB triple produce the same distance from the same query
 * by the same arithmetic. Colours that merely differ by a count are not ties and
 * must not be swallowed — they are what the band is for.
 */
function tiedRun(d: Float64Array, firstIndex: number): { lo: number; hi: number } {
  // ⚑ FORWARD ONLY, and that is a contract rather than an oversight. Both
  // callers find their minimum with a strict `<`, so `firstIndex` is the FIRST
  // position attaining it and nothing before it can tie. A backward walk was
  // written here at first and could never take a single step.
  const target = d[firstIndex]!;
  let hi = firstIndex;
  while (hi < d.length - 1 && d[hi + 1] === target) hi++;
  return { lo: firstIndex, hi };
}

/**
 * How big one step of the key is here: the colour distance from a plateau to the
 * nearest DIFFERENT colour beside it. The key's own resolution, in the key's own
 * units, measured at the position being read rather than assumed for the whole
 * ramp — a colormap's step varies enormously along its length.
 *
 * Zero when the strip carries no other colour at all, which `checkStripSamples`
 * has already refused.
 */
function localStep(
  samples: readonly ColorBarSample[],
  plateau: { lo: number; hi: number }
): number {
  const here = samples[plateau.lo]!.rgb;
  let step = Infinity;
  if (plateau.lo > 0) step = Math.min(step, colorDistance(here, samples[plateau.lo - 1]!.rgb));
  if (plateau.hi < samples.length - 1)
    step = Math.min(step, colorDistance(here, samples[plateau.hi + 1]!.rgb));
  return Number.isFinite(step) ? step : 0;
}

/**
 * Turn a contiguous run of under-tolerance samples into a band, with its edges
 * interpolated to where the distance actually crosses the tolerance. A run that
 * reaches the end of the strip stops there: the key does not continue, so
 * neither does the band.
 */
function bandFromRun(
  samples: readonly ColorBarSample[],
  d: Float64Array,
  i0: number,
  i1: number,
  tolerance: number
): ColorBarBand {
  let bestIndex = i0;
  for (let i = i0; i <= i1; i++) if (d[i]! < d[bestIndex]!) bestIndex = i;
  // The same plateau rule as the main reading: a rival's position is the middle
  // of the colours that tie, not the first of them.
  const tied = tiedRun(d, bestIndex);

  const edge = (inner: number, outer: number): number => {
    const dInner = d[inner]!;
    const dOuter = d[outer]!;
    // `dOuter > tolerance >= dInner` by construction — the run is maximal, so
    // the sample just outside it is strictly above the tolerance the run was cut
    // at. The difference is therefore never zero and needs no guard.
    const f = (tolerance - dInner) / (dOuter - dInner);
    return samples[inner]!.t + (samples[outer]!.t - samples[inner]!.t) * f;
  };

  return {
    // `tied` cannot reach outside `i0..i1`: everything beyond the run is
    // strictly above the tolerance, hence strictly above `d[bestIndex]`, hence
    // not tied with it. No clamp is needed.
    t: (samples[tied.lo]!.t + samples[tied.hi]!.t) / 2,
    tLow: i0 > 0 ? edge(i0, i0 - 1) : samples[i0]!.t,
    tHigh: i1 < samples.length - 1 ? edge(i1, i1 + 1) : samples[i1]!.t,
    distance: d[bestIndex]!,
  };
}
