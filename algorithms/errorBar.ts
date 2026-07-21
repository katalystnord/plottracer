/**
 * Error-bar geometry — a port of the error-bar capture the OLD app already
 * ships (`ui-patches/overrides.js:755-944`, `ui-patches/api-bridge.js:100-134`),
 * which the `engine/`/`ui/` rebuild dropped.
 *
 * Found by the third-pass parity audit (2026-07-15). Worth stating plainly,
 * because CLAUDE.md long described uncertainty capture as the "frontier — build,
 * unclaimed by the field": **we had already built it.** An "Error Bars" axes
 * type, one-click Value/Upper/Lower groups, a direction-aware glyph and a
 * structured JSON export all run under `npm start` today. This is restore + extend.
 *
 * Why error bars matter here more than anywhere else: for downstream modelling,
 * uncertainty *is* the scientific signal — "12 MPa ± 3" is a different claim from
 * "12 ± 0.1". Digitizing only the centre manufactures false precision, which is
 * the "silently poisoning downstream data" failure the record-first principle
 * exists to prevent. Notably even StarryDigitizer (which feeds Starrydata's
 * 194k+ curves) throws error away.
 *
 * **Schema note — deliberately absolute, not deltas.** `{x, y, yUpper, yLower}`
 * matches what the old app's structured export has always emitted
 * (`api-bridge.js:130-131`). CLAUDE.md's error section sketches
 * `{x, y, xErr?, yErr?}` as an ideal, but a shipped schema beats a sketch: this
 * one is what any already-ingested record looks like, and absolute positions
 * are also what the user actually *clicked*, so they survive an asymmetric bar
 * without the caller having to know which convention a delta follows. Deltas
 * are derived on demand (errorAbove/errorBelow below).
 *
 * Pure and headless per CLAUDE.md's leg (c): no DOM, no engine imports.
 */

/** One captured point of an error bar, in *data* space. */
export interface ErrorBarCorner {
  x: number;
  y: number;
}

/**
 * One error bar: the centre value plus the absolute positions of its whiskers.
 *
 * Every field beyond `x` is optional because a tuple is captured over several
 * clicks and is legitimately half-built in between — and because a real figure
 * may carry only an upper bound. A missing field means "not captured", never
 * "zero".
 */
export interface ErrorBarPoint {
  x: number;
  y?: number;
  yUpper?: number;
  yLower?: number;
  xLeft?: number;
  xRight?: number;
}

/**
 * Which side of its datum an error series records.
 *
 * The taxonomy CLAUDE.md calls "genuinely new work" — symmetric Y, asymmetric
 * Y, X error, a 2D cross — is not four features; it is these four roles in
 * combination (docs/error-bars-design.md). A confidence band is the same model
 * at higher density, so it needs nothing added either.
 */
export type ErrorRole = 'upper' | 'lower' | 'left' | 'right';

export const ERROR_ROLES: readonly ErrorRole[] = ['upper', 'lower', 'left', 'right'];

/** The `ErrorBarPoint` field each role writes. */
const ROLE_FIELD: Record<ErrorRole, 'yUpper' | 'yLower' | 'xLeft' | 'xRight'> = {
  upper: 'yUpper',
  lower: 'yLower',
  left: 'xLeft',
  right: 'xRight',
};

/**
 * A cap resolves to the datum nearest along the axis it does NOT move along.
 *
 * An upper/lower cap sits directly above/below its datum: it shares the datum's
 * x and differs in y, so x is what identifies it. A left/right cap is the
 * transpose — it shares the datum's y and differs in x — so matching it by x
 * would compare the very quantity the cap exists to displace, and would pair a
 * whisker with whichever unrelated datum happened to sit under its tip. Each
 * role therefore matches on its *invariant* axis.
 */
const ROLE_MATCH_AXIS: Record<ErrorRole, 'x' | 'y'> = {
  upper: 'x',
  lower: 'x',
  left: 'y',
  right: 'y',
};

/** One error series resolved against its target: the role it plays, and the
 * cap positions the user placed, in data space. */
export interface ErrorCapSeries {
  role: ErrorRole;
  caps: readonly ErrorBarCorner[];
}

/**
 * Which datum a cap belongs to — the model's one derived relationship, in ONE
 * place (checkpoint 85, finding A6).
 *
 * Exported because the *rendering* must ask the same question the *record* does.
 * Checkpoint 79 shipped two implementations of this: `resolveErrorBars` matched
 * here in DATA space, while `engine/calibrationSession.ts`'s `getErrorWhiskers`
 * matched in PIXEL space to avoid needing an axes. Since checkpoint 68 turned
 * rotation correction on by default, data-x is a linear combination of pixel-x
 * *and* pixel-y — so on a rotated calibration the two disagreed and **the glyph
 * could pair a cap to a different datum than the record did.**
 *
 * That is worse than a wrong drawing. The design's whole safety argument is
 * *"the rendering is the check on what the storage leaves implicit"*
 * (docs/error-bars-design.md) — a check computed differently from the thing it
 * checks is not a check. One function, both callers.
 *
 * Returns -1 when there is nothing to match against.
 */
export function matchCapToDatum(
  data: readonly ErrorBarCorner[],
  cap: ErrorBarCorner,
  role: ErrorRole
): number {
  return nearestIndex(data, cap, ROLE_MATCH_AXIS[role]);
}

function nearestIndex(data: readonly ErrorBarCorner[], cap: ErrorBarCorner, axis: 'x' | 'y'): number {
  let best = -1;
  let bestDistance = Infinity;
  for (let i = 0; i < data.length; i++) {
    const distance = Math.abs(data[i]![axis] - cap[axis]);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  return best;
}

/**
 * Resolve related error series down to per-datum error bars.
 *
 * **This is where the model's one deliberate omission is paid for.** The link
 * we store is series→series, not point→point (David, 2026-07-16: *"per series,
 * not points… But we at least visually have to resolve it down to individual
 * points"*), so the point correspondence is not in the file — it is derived
 * here, at render and export time, exactly as docs/error-bars-design.md
 * specifies.
 *
 * Direction matters: each **cap** claims its nearest datum, not the reverse. A
 * datum-first rule would give all 200 points of a dense curve a whisker from
 * whatever cap lay nearest, inventing error the figure never drew. Cap-first
 * means an error series with four caps produces four whiskers and the rest of
 * the curve carries none — which is the common case, not an edge case (authors
 * routinely draw error on every Nth point), and it costs nothing to support.
 *
 * There is no distance threshold. A cap that lands nowhere near a datum still
 * resolves to the nearest one and draws a visibly wrong whisker — which is the
 * point: the rendering is the check on what the storage leaves implicit, the
 * same argument as Check Calibration and the CCR arc preview. A threshold would
 * silently drop the cap instead, hiding the mistake it exists to reveal.
 *
 * Returns one entry per datum, in the target series' own order. `y` is always
 * the datum's own; the role fields appear only where a cap resolved, never
 * nulled or zeroed — "not measured" must not read downstream as a value.
 *
 * **This is PROCESSING, not the record — which is why one field per role costs
 * nothing.** A figure showing *both* SD and 95% CI whiskers relates two series
 * as `upper`, and this shape has a single `yUpper`, so a paired view of it can
 * show only one. That is not data loss: **the record is the series and their
 * relations**, and both survive intact in the file and in the relational export
 * (verified — they emit as `SD upper Y` and `95% CI upper Y`, distinct columns
 * the user named). Any processing happens *after* recording and cannot reach
 * back. A caller wanting both simply resolves each error series on its own,
 * which is what rendering does anyway — one whisker set per series.
 *
 * Arbitration is by *distance* rather than argument order, so a paired view at
 * least does not change with series order.
 */
export function resolveErrorBars(
  data: readonly ErrorBarCorner[],
  series: readonly ErrorCapSeries[]
): ErrorBarPoint[] {
  const bars: ErrorBarPoint[] = data.map((d) => ({ x: d.x, y: d.y }));
  if (data.length === 0) return bars;

  // Nearest cap wins when two caps of one role claim a datum -- whether they
  // come from the same series (a mis-click, where the closer is the likelier
  // intent) or from two same-role series (the limitation above). Keyed by
  // FIELD, not per series, so the arbitration spans every series writing that
  // field; keeping it per-series made the winner depend on argument order. The
  // loser is dropped rather than averaged -- averaging would fabricate a
  // position no one clicked.
  const claimed: Partial<Record<string, number[]>> = {};
  for (const { role, caps } of series) {
    const axis = ROLE_MATCH_AXIS[role];
    const field = ROLE_FIELD[role];
    const claimedDistance = (claimed[field] ??= new Array(data.length).fill(Infinity));
    for (const cap of caps) {
      const index = nearestIndex(data, cap, axis);
      if (index < 0) continue;
      const distance = Math.abs(data[index]![axis] - cap[axis]);
      if (distance >= claimedDistance[index]!) continue;
      claimedDistance[index] = distance;
      bars[index]![field] = axis === 'x' ? cap.y : cap.x;
    }
  }
  return bars;
}

/**
 * Build an error bar from its Value/Upper/Lower corners, any of which may be
 * absent while the tuple is still being placed.
 *
 * `x` comes from whichever corner is present, preferring Value: the three
 * clicks share roughly a pixel column but not an identical x, and the centre is
 * the one the user aimed at the datum. Ported from `api-bridge.js:126`'s own
 * `anchor = valuePt || upperPt || lowerPt`.
 *
 * Returns null only when nothing at all is captured — an all-empty tuple has no
 * x to report, and inventing 0 would be a lie.
 */
export function errorBarFromCorners(
  value: ErrorBarCorner | null,
  upper: ErrorBarCorner | null,
  lower: ErrorBarCorner | null
): ErrorBarPoint | null {
  const anchor = value ?? upper ?? lower;
  if (!anchor) return null;
  const point: ErrorBarPoint = { x: anchor.x };
  if (value) point.y = value.y;
  if (upper) point.yUpper = upper.y;
  if (lower) point.yLower = lower.y;
  return point;
}

/** Map captured Value/Upper/Lower triples to error bars, preserving index and
 * capture order (`null` for a tuple with nothing placed yet) — the same
 * contract algorithms/histogram.ts's binsFromCorners uses, so a half-captured
 * bar still occupies its own table row. */
export function errorBarsFromCorners(
  tuples: readonly (readonly (ErrorBarCorner | null)[])[]
): (ErrorBarPoint | null)[] {
  return tuples.map((t) => errorBarFromCorners(t[0] ?? null, t[1] ?? null, t[2] ?? null));
}

/**
 * The +δ of an asymmetric bar (`yUpper - y`), or undefined when either end
 * isn't captured.
 *
 * Derived rather than stored: the absolute positions are the measurement, and a
 * delta is one subtraction away — but a *stored* delta would silently go stale
 * if the centre were later corrected, and would force a convention (signed?
 * absolute?) on every consumer. Handles a bar drawn on a descending axis by
 * taking the magnitude, so "above" means away from the centre rather than
 * numerically greater.
 */
export function errorAbove(p: ErrorBarPoint): number | undefined {
  if (p.y === undefined || p.yUpper === undefined) return undefined;
  return Math.abs(p.yUpper - p.y);
}

/** The −δ of an asymmetric bar (`y - yLower`). See errorAbove. */
export function errorBelow(p: ErrorBarPoint): number | undefined {
  if (p.y === undefined || p.yLower === undefined) return undefined;
  return Math.abs(p.y - p.yLower);
}

/** The +δ of an X error bar (`xRight - x`). The x-axis twin of errorAbove,
 * and derived for the same reasons. */
export function errorRight(p: ErrorBarPoint): number | undefined {
  if (p.xRight === undefined) return undefined;
  return Math.abs(p.xRight - p.x);
}

/** The −δ of an X error bar (`x - xLeft`). See errorRight. */
export function errorLeft(p: ErrorBarPoint): number | undefined {
  if (p.xLeft === undefined) return undefined;
  return Math.abs(p.x - p.xLeft);
}

/** True when both whiskers are captured and agree to within `tolerance`
 * (relative to the bar's own size) — i.e. the common "± one value" case, which
 * can be reported as a single number instead of two. */
export function isSymmetric(p: ErrorBarPoint, tolerance = 1e-9): boolean {
  const above = errorAbove(p);
  const below = errorBelow(p);
  if (above === undefined || below === undefined) return false;
  const scale = Math.max(Math.abs(above), Math.abs(below), 1);
  return Math.abs(above - below) <= tolerance * scale;
}
