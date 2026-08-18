/**
 * Axis-aware colour trace for spider / radar charts (v1.4).
 *
 * ⚑ WHY THIS IS WELL-FOUNDED WHERE THE BAR CASE WAS NOT. Auto-extract is refused on
 * bar-family figures because every mechanism it has centres on a filled shape: it
 * returns the MIDDLE of a bar, and a bar's value is its end. The number it produced
 * was never the datum, so it was refused rather than allowed to be confidently
 * wrong (`59f94a6`). A spider is the opposite case. The datum is where the series'
 * shape CROSSES an axis, and a crossing is exactly what a boundary is - so reading
 * the mask along a calibrated ray measures the thing the figure is asserting, not a
 * proxy for it. Locking captured points to the axis is what made this expressible:
 * a value on a spider has one degree of freedom, and so does this search.
 *
 * ⚑ WHICH END OF A RUN IS THE READING DEPENDS ON WHAT THE RUN IS (see
 * SpokeRun.atPx). A filled radar polygon is ink all the way from the hub to its
 * vertex, so the middle of what the ray finds is half the value - the bar-midpoint
 * defect at a new scale, and there the boundary is the number. A vertex MARKER is
 * ink the ray passes through, and there the middle is the number. The two are told
 * apart by measurement, not assumption: where the run starts, and how long it is.
 *
 * Still ASSIST, never sweep. This returns CANDIDATES with their evidence; it does
 * not record anything. Where the evidence is ambiguous it says so instead of
 * choosing - see `runs` and `reason` below.
 *
 * Pure: takes a mask and geometry, returns numbers. No DOM, no engine imports.
 */

/** One contiguous stretch of matching pixels found along a ray. */
export interface SpokeRun {
  /** Distance from the origin, in pixels, where the run starts and ends. */
  fromPx: number;
  toPx: number;
  /**
   * The reading this run offers - and WHICH END that is, is decided from the run
   * itself rather than assumed about the figure.
   *
   *   reaches the centre window ................ a FILL      -> its outer end
   *   long, detached ........................... a WEDGE     -> its outer end
   *   short, detached .......................... a CROSSING  -> its middle
   *
   * ⚑ THE MIDDLE IS THE BAR DEFECT WEARING A NEW HAT, which is why it may not be
   * the default. A radar series is very often drawn FILLED, and a ray leaving the
   * centre is then inside the shape from the hub to the vertex: one run whose
   * midpoint is half the value. That is precisely the error auto-extract is refused
   * on bars for (`59f94a6`) - the middle of a shape whose value is its edge - and it
   * would have arrived here confident and unflagged. The `reaches the centre` test
   * is what keeps that case reading its boundary.
   *
   * ⚑ THE WEDGE is the other trap, and it is not hypothetical: at a SPIKE, a value
   * far above both its neighbours, the polygon's two edges hug the ray and the ink
   * reaches a long way back toward the centre. Detached from the hub, but nothing
   * like a line crossing. Hence the length test - ink crossing a ray is a small
   * fraction of the axis; a region the ray is INSIDE is not.
   *
   * ⚑⚑ WHY THE OUTER END ALONE WAS WRONG, and how it was found. Until v2.1 every
   * run read at its outer end, which over-reads a stroked outline by half its width
   * - and a radar chart draws a MARKER at each vertex, exactly where the crossing is
   * measured, so the real over-read was one MARKER RADIUS. Measured on the bundled
   * example after David auto-extracted it and every reading came back high: **4.77px
   * against a 4.86px marker radius** and a 1.0px half-stroke, so the bound this
   * comment used to state was out by ~5x. The signature is decisive - the error was
   * constant in PIXELS rather than proportional to the reading, clustering inside
   * 0.61 points as a fraction of each axis's radius while scattering over 5.23
   * points as a fraction of the reading, which rules out a calibration error and
   * leaves the geometry.
   *
   * ⚑⚑ AND NO TEST COULD SEE IT for three releases, because the synthetic figure
   * the tests drew had no markers: it exhibited a ~1px stroke bias where the real
   * PNG exhibits ~4.8px, and its tolerance was wide enough to absorb the real error
   * while crediting it to the wrong cause. The fix is verified by TRACING THE
   * SHIPPED PNG against its committed truth (engine/__tests__/spiderTraceRun.test.ts
   * - "the bundled example PNG, traced as it ships"): mean signed error went from
   * +5.18px across 18 readings to under 1.5px, seventeen of them inside 0.7%.
   *
   * ⚠️ The residual is the SPIKE, bounded and now visible instead of hidden inside a
   * uniform bias: one reading of the eighteen (a vertex at 110 of 120 whose
   * neighbours are 9 and 4.3) reads 1.4% low, because even with a marker the wedge
   * behind it drags the middle inward.
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
   * single unambiguous run was found.
   *
   * ⚑ `'clipped'` means the ink was still going when the search stopped. Reporting
   * such a run would record `centre + (known − centre) × overshoot` - a number
   * produced by the search WINDOW rather than by the figure - and flag it as a
   * clean crossing. It happens when a series exceeds the labelled maximum by more
   * than the overshoot, or when the known point was calibrated on an inner ring. */
  reason: 'none-found' | 'ambiguous' | 'clipped' | null;
}

export interface SpiderTraceOptions {
  /** How far past the calibrated known point to keep looking, as a fraction of the
   * spoke's length. A series may legitimately exceed the axis's labelled maximum;
   * a little overshoot catches that without wandering off the figure. */
  overshoot?: number;
  /** Sampling step along the ray, in pixels. Sub-pixel by default so a 1px line is
   * not stepped over. */
  step?: number;
  /** Runs shorter than this (in pixels) are discarded as speckle - antialiasing
   * fringes and stray matched pixels, not a drawn line. */
  minRunPx?: number;
  /** Ignore anything within this distance of the centre. Every spoke passes
   * through the origin, so a filled centre dot or the hub of the web would
   * otherwise register as a crossing on EVERY axis at once. */
  ignoreCentrePx?: number;
  /** How long a detached run may be, as a fraction of the spoke, and still be
   * read as INK CROSSING the ray rather than a region the ray is inside. A drawn
   * line or a vertex marker is a small fraction of an axis; a filled polygon and
   * a spike's wedge are not. See SpokeRun.atPx. */
  crossingMaxFraction?: number;
}

const DEFAULTS: Required<SpiderTraceOptions> = {
  overshoot: 0.15,
  step: 0.5,
  minRunPx: 1.5,
  ignoreCentrePx: 4,
  // 10% of the axis. The bundled example's vertex markers are 4.6% of their
  // spoke; the sharp-vertex wedge that must NOT be read at its middle is 50%.
  crossingMaxFraction: 0.1,
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
  const { overshoot, step, minRunPx, ignoreCentrePx, crossingMaxFraction } = { ...DEFAULTS, ...options };

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
        pushRun(runs, runStart, t - step, minRunPx, ignoreCentrePx, step, spoke.lengthPx, crossingMaxFraction);
        runStart = null;
      }
    }
    // Still inside the ink when the walk ended: the crossing is beyond the window.
    const clipped = runStart !== null;
    if (runStart !== null) pushRun(runs, runStart, maxPx, minRunPx, ignoreCentrePx, step, spoke.lengthPx, crossingMaxFraction);

    // ⚑ ONE run is a reading; anything else is a question, not an answer. Several
    // runs mean the ray crossed this colour more than once -- a grid ring drawn in
    // a similar hue, another series, or a filled polygon whose far edge also
    // matched. Picking one (the outermost, say) would be a guess wearing the
    // record's clothes, which is the whole reason auto-extract is refused on bars.
    // The runs ride along so the user can be shown what was found and choose.
    if (runs.length === 0) return { index, runs, atPx: null, reason: 'none-found' as const };
    // ⚑ A run that reached the limit has no measured END, so it has no reading -
    // its `toPx` is where we stopped looking, not where the shape stops. Offering
    // it would be the search window's number wearing the figure's clothes.
    if (clipped) return { index, runs, atPx: null, reason: 'clipped' as const };
    if (runs.length === 1) return { index, runs, atPx: runs[0]!.atPx, reason: null };
    return { index, runs, atPx: null, reason: 'ambiguous' as const };
  });
}

function pushRun(
  runs: SpokeRun[],
  fromPx: number,
  toPx: number,
  minRunPx: number,
  ignoreCentrePx: number,
  step: number,
  spokeLengthPx: number,
  crossingMaxFraction: number
): void {
  // A run is measured to the END of its last matching sample, so a single sample
  // has zero length; compare against the drawn width including that sample.
  if (toPx - fromPx < minRunPx - 1e-9) return;
  // ⚑⚑ WHICH END IS THE READING IS A QUESTION THE PIXELS ANSWER - see
  // SpokeRun.atPx. A run is a CROSSING (a stroke, a marker, or both, whose value
  // is its middle) only when it is BOTH detached from the centre AND a small
  // fraction of the axis. Either test alone gets a real figure wrong: a filled
  // polygon's run reaches the hub, and a SPIKE's wedge is detached but long.
  const reachesTheCentre = fromPx <= ignoreCentrePx + step + 1e-9;
  const thinEnoughToBeInk = toPx - fromPx <= crossingMaxFraction * spokeLengthPx;
  const isCrossing = !reachesTheCentre && thinEnoughToBeInk;
  runs.push({ fromPx, toPx, atPx: isCrossing ? (fromPx + toPx) / 2 : toPx });
}
