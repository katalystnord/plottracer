/**
 * Axis-aware colour trace for spider / radar charts (v1.4).
 *
 * ⚑ WHY THIS IS WELL-FOUNDED WHERE THE BAR CASE WAS NOT. Auto-extract is refused on
 * bar-family figures because every mechanism it has centres on a filled shape: it
 * returns the MIDDLE of a bar, and a bar's value is its end. The number it produced
 * was never the datum, so it was refused rather than allowed to be confidently
 * wrong (`59f94a6`). A spider is the opposite case. The datum is where the series'
 * shape CROSSES an axis, and a crossing is exactly what a boundary is — so reading
 * the mask along a calibrated ray measures the thing the figure is asserting, not a
 * proxy for it. Locking captured points to the axis is what made this expressible:
 * a value on a spider has one degree of freedom, and so does this search.
 *
 * ⚑ THE READING IS THE BOUNDARY, NOT THE MIDDLE (see SpokeRun.atPx). A filled radar
 * polygon is ink all the way from the hub to its vertex, so the middle of what the
 * ray finds is half the value — the bar-midpoint defect, at a new scale. The edge is
 * the number the figure is stating.
 *
 * Still ASSIST, never sweep. This returns CANDIDATES with their evidence; it does
 * not record anything. Where the evidence is ambiguous it says so instead of
 * choosing — see `runs` and `reason` below.
 *
 * Pure: takes a mask and geometry, returns numbers. No DOM, no engine imports.
 */

/** One contiguous stretch of matching pixels found along a ray. */
export interface SpokeRun {
  /** Distance from the origin, in pixels, where the run starts and ends. */
  fromPx: number;
  toPx: number;
  /**
   * The reading this run offers: its OUTER end — the boundary where the shape stops.
   *
   * ⚑ THIS WAS THE RUN'S MIDPOINT, AND THE MIDPOINT IS THE BAR DEFECT WEARING A NEW
   * HAT. A radar series is very often drawn FILLED, and a ray leaving the centre is
   * then inside the shape from the hub to the vertex: one run, whose midpoint is
   * half the value. That is precisely the error auto-extract is refused on bars for
   * (`59f94a6`) — the middle of a shape whose value is its edge — and it would have
   * arrived here confident and unflagged. Caught by tracing the bundled example's
   * own ground truth (engine/__tests__/spiderTraceRun.test.ts).
   *
   * The outer end is right for a filled shape, and for a STROKED outline it over-
   * reads by half the line's width — bounded, identical on every axis, and far
   * smaller than the midpoint's error at a sharp vertex, where the two edges hug the
   * ray and drag the midpoint inward without limit. `fromPx`/`toPx` ride along, so a
   * caller that knows better about a particular figure can still say so.
   */
  atPx: number;
}

export interface SpokeCandidate {
  /** Index of the spoke this was searched along. */
  index: number;
  /** Every matching stretch found, outward from the centre. */
  runs: SpokeRun[];
  /** The crossing to offer, or null when the evidence does not support one. */
  atPx: number | null;
  /** Why there is no candidate, or why the chosen one might be wrong. Null when a
   * single unambiguous run was found. */
  reason: 'none-found' | 'ambiguous' | null;
}

export interface SpiderTraceOptions {
  /** How far past the calibrated known point to keep looking, as a fraction of the
   * spoke's length. A series may legitimately exceed the axis's labelled maximum;
   * a little overshoot catches that without wandering off the figure. */
  overshoot?: number;
  /** Sampling step along the ray, in pixels. Sub-pixel by default so a 1px line is
   * not stepped over. */
  step?: number;
  /** Runs shorter than this (in pixels) are discarded as speckle — antialiasing
   * fringes and stray matched pixels, not a drawn line. */
  minRunPx?: number;
  /** Ignore anything within this distance of the centre. Every spoke passes
   * through the origin, so a filled centre dot or the hub of the web would
   * otherwise register as a crossing on EVERY axis at once. */
  ignoreCentrePx?: number;
}

const DEFAULTS: Required<SpiderTraceOptions> = {
  overshoot: 0.15,
  step: 0.5,
  minRunPx: 1.5,
  ignoreCentrePx: 4,
};

/** One spoke's geometry, in image pixels. */
export interface SpokeRay {
  ux: number;
  uy: number;
  lengthPx: number;
}

/**
 * Walk each ray outward through the colour mask and report where the series
 * crosses it.
 *
 * `mask` is one byte per pixel, non-zero where the pixel matched the series colour
 * (the same shape `algorithms/colorFilter.ts` produces, so the live mask preview
 * the user already confirms is literally what is searched here).
 */
export function traceSpiderAlongSpokes(
  mask: Uint8Array,
  width: number,
  height: number,
  origin: { x: number; y: number },
  spokes: readonly SpokeRay[],
  options: SpiderTraceOptions = {}
): SpokeCandidate[] {
  const { overshoot, step, minRunPx, ignoreCentrePx } = { ...DEFAULTS, ...options };

  return spokes.map((spoke, index) => {
    const maxPx = spoke.lengthPx * (1 + overshoot);
    const runs: SpokeRun[] = [];
    let runStart: number | null = null;

    // Sample outward. `<=` so a crossing sitting exactly at the far end is seen.
    for (let t = 0; t <= maxPx + 1e-9; t += step) {
      const x = Math.round(origin.x + t * spoke.ux);
      const y = Math.round(origin.y + t * spoke.uy);
      const inside = x >= 0 && y >= 0 && x < width && y < height;
      const hit = inside && t >= ignoreCentrePx && mask[y * width + x] !== 0;

      if (hit && runStart === null) runStart = t;
      if (!hit && runStart !== null) {
        pushRun(runs, runStart, t - step, minRunPx);
        runStart = null;
      }
    }
    if (runStart !== null) pushRun(runs, runStart, maxPx, minRunPx);

    // ⚑ ONE run is a reading; anything else is a question, not an answer. Several
    // runs mean the ray crossed this colour more than once -- a grid ring drawn in
    // a similar hue, another series, or a filled polygon whose far edge also
    // matched. Picking one (the outermost, say) would be a guess wearing the
    // record's clothes, which is the whole reason auto-extract is refused on bars.
    // The runs ride along so the user can be shown what was found and choose.
    if (runs.length === 1) return { index, runs, atPx: runs[0]!.atPx, reason: null };
    if (runs.length === 0) return { index, runs, atPx: null, reason: 'none-found' as const };
    return { index, runs, atPx: null, reason: 'ambiguous' as const };
  });
}

function pushRun(runs: SpokeRun[], fromPx: number, toPx: number, minRunPx: number): void {
  // A run is measured to the END of its last matching sample, so a single sample
  // has zero length; compare against the drawn width including that sample.
  if (toPx - fromPx < minRunPx - 1e-9) return;
  // The OUTER end is the reading — see SpokeRun.atPx for why it is not the middle.
  runs.push({ fromPx, toPx, atPx: toPx });
}
