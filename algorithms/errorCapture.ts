/**
 * Error capture — the pure half of the drag gesture (checkpoint 79).
 *
 * The capture UI's model is `docs/error-bars-design.md`: **the drag IS the
 * link.** You press on a datum, drag out to where the figure draws the cap, and
 * release. Two caps are placed, one on each side; the one you dragged to is
 * where you released, and its opposite is mirrored across the datum.
 *
 * **The mirrored cap is a starting position, not a claim** (David,
 * 2026-07-16: *"we will introduce two mirrored error points on either side for
 * the user, but they should be able to set them freely, and we should not have
 * any constraints on the error bar points beyond recording to which main data
 * point they relate to"*). It is an ordinary point in an ordinary series --
 * drag it, edit it, delete it. Nothing enforces that the pair stays symmetric
 * and nothing downstream assumes it did. So there is no symmetric mode, no
 * asymmetric mode, and no modifier: an asymmetric bar is just a bar whose cap
 * you moved.
 *
 * **This file works in pixel space, and that is the point.** *"There is
 * absolutely nothing magical about error points from a numerical perspective"*
 * (David) — an error point is a pixel, read back through `pixelToData` like
 * every other point. An earlier draft mirrored in *data* space via
 * `dataToPixel` so that "±" would come out exact on a log axis; that bought
 * nothing (we do not claim symmetry, and CLAUDE.md's own decision is that the
 * kind of error is not ours to record) and cost a great deal: it needed a
 * capability probe, and it would have **disabled the tool on bar charts**,
 * because `BarAxes.dataToPixel` is a stub returning `{x: 0, y: 0}`
 * (`core/axes/bar.ts:93`) — as are Polar's, Ternary's, Map's and CCR's.
 * Reflecting the pixel needs none of them, so capture works on every graph
 * type, including the asymmetric-error-on-a-bar-plot case that has had zero
 * coverage.
 *
 * Pure and headless per CLAUDE.md's leg (c): no DOM, no engine imports, no
 * `core/` imports — this file needs nothing from an axes at all.
 */

import type { ErrorRole } from './errorBar.js';

/** A point in image-pixel space. */
export interface Point2D {
  x: number;
  y: number;
}

/**
 * Which role a drag from `datum` to `cap` records, read off the drag's dominant
 * component **on screen**.
 *
 * The gesture alone says it, so the card needs no four-way role selector: drag
 * up and you get an upper cap, drag right and you get a right one. The user is
 * pointing at a cap the figure already drew, so the direction is not a guess
 * about intent — it is where they pointed.
 *
 * Screen space, hence the inverted y test: image-pixel y grows *downward*, so
 * a drag "up" is toward a smaller y. This reads the role the way the user sees
 * it rather than the way the axes numbers it, which is deliberate — it needs
 * nothing from the axes and therefore behaves the same on all 7 types. A chart
 * calibrated with an inverted or rotated y axis can put the numerically-larger
 * cap below on screen; the whisker still draws where the caps are, and the
 * series' name is the user's own, so nothing silently misreports.
 *
 * A diagonal drag resolves to its larger component rather than being refused.
 * The whisker then draws in that direction and is visibly wrong if it was not
 * meant, which is this design's standing answer (docs/error-bars-design.md:
 * "the rendering is the check on what the storage leaves implicit") and better
 * than an error message for a gesture the user can simply redo.
 */
export function roleFromDrag(datumPixel: Point2D, capPixel: Point2D): ErrorRole | null {
  const dx = capPixel.x - datumPixel.x;
  const dy = capPixel.y - datumPixel.y;
  if (dx === 0 && dy === 0) return null;
  if (Math.abs(dy) >= Math.abs(dx)) return dy < 0 ? 'upper' : 'lower';
  return dx > 0 ? 'right' : 'left';
}

/** The opposite of a role — the one the mirrored cap plays. */
export function oppositeRole(role: ErrorRole): ErrorRole {
  switch (role) {
    case 'upper':
      return 'lower';
    case 'lower':
      return 'upper';
    case 'left':
      return 'right';
    case 'right':
      return 'left';
  }
}

/**
 * The slice of a calibrated axes the *constraint* needs — and only the
 * constraint. Structural, so `algorithms/` keeps its zero-dependency contract.
 */
export interface DataPixelMapping {
  pixelToData(x: number, y: number): number[];
  dataToPixel(x: number, y: number): { x: number; y: number };
}

/**
 * A unit vector in **pixel** space along which a cap of `role` may move — or
 * **null when this axes cannot say**, which means no constraint at all.
 *
 * **The model's one constraint, and it is not available everywhere** (David,
 * 2026-07-17: *"For some graphs it only makes sense to look in the datum axis
 * ... But that is not true for all graphs! So some graphs cannot even have that
 * constraint."*).
 *
 * **Why it is a constraint we are allowed at all:** a figure draws an error bar
 * *aligned with* its data point — the whisker is a line **through** the datum,
 * not merely near it. Pinning the cap to that line records what the figure
 * shows, exactly as recording a bin's edges does. It is not a claim about what
 * the error *means* (±, SD vs CI, symmetry all stay out). It also protects the
 * resolution: `algorithms/errorBar.ts`'s ROLE_MATCH_AXIS matches an upper cap to
 * its datum **by x**, so a cap that drifted sideways could silently resolve onto
 * a *neighbouring* datum.
 *
 * **Why it cannot be "lock x" — the obvious version, which is wrong.** That
 * assumes the datum's value axis runs straight up the screen. It does not:
 * checkpoint 68 turned WPD's rotation correction on by default, so a plain XY
 * chart's y-direction can be tilted; a polar chart's error runs *radially*; a
 * ternary's runs along a composition axis. This is the same fact
 * `engine/errorBarGlyph.ts` already encodes by taking its caps normal to the
 * bar's own direction so the glyph survives a rotated calibration.
 *
 * So the direction is measured off the axes itself, by stepping the datum's
 * value along the role's own axis and seeing which way the pixel moved. Where
 * `dataToPixel` is the upstream stub (Bar, Polar, Ternary, Map, CCR all return
 * `{x: 0, y: 0}` — `core/axes/bar.ts:93`) the step goes nowhere and this
 * returns null.
 *
 * **Null degrades to "unconstrained", never to "disabled"** — which is what
 * makes probing safe here, and is the difference from an earlier draft that
 * probed in order to *gate the whole feature* and would have refused error bars
 * on bar charts. A free cap is exactly the documented default; the constraint
 * is a nicety layered on where the geometry is knowable.
 */
export function capFreeDirection(
  axes: DataPixelMapping,
  datumPixel: Point2D,
  role: ErrorRole
): Point2D | null {
  const datum = axes.pixelToData(datumPixel.x, datumPixel.y);
  const dx = datum[0];
  const dy = datum[1];
  // A 1-D axes (Bar's pixelToData returns `[value]`) has no second value to
  // step, so it cannot describe the direction either.
  if (dx === undefined || dy === undefined || !Number.isFinite(dx) || !Number.isFinite(dy)) {
    return null;
  }

  const along = freeAxisFor(role);
  // Stepped relative to the datum's own magnitude so the probe stays in range
  // on a log axis, where an absolute +1 near a small value is an enormous move.
  const base = along === 'y' ? dy : dx;
  const step = Math.max(Math.abs(base) * 0.01, 1e-6);
  const stepped =
    along === 'y'
      ? axes.dataToPixel(dx, dy + step)
      : axes.dataToPixel(dx + step, dy);
  const here = axes.dataToPixel(dx, dy);
  if (![stepped.x, stepped.y, here.x, here.y].every(Number.isFinite)) return null;

  const vx = stepped.x - here.x;
  const vy = stepped.y - here.y;
  const length = Math.hypot(vx, vy);
  // A stub maps every value to the same pixel, so the step moves nowhere.
  if (length < 1e-9) return null;
  return { x: vx / length, y: vy / length };
}

/** The value axis a cap of this role moves along. */
export function freeAxisFor(role: ErrorRole): 'x' | 'y' {
  return role === 'upper' || role === 'lower' ? 'y' : 'x';
}

/**
 * `cap` projected onto the line through `datum` along `direction`.
 *
 * With `direction` null the cap is returned untouched — the honest behaviour on
 * an axes that cannot say which way its value axis runs (see capFreeDirection).
 */
export function constrainCap(
  datumPixel: Point2D,
  capPixel: Point2D,
  direction: Point2D | null
): Point2D {
  if (!direction) return capPixel;
  const vx = capPixel.x - datumPixel.x;
  const vy = capPixel.y - datumPixel.y;
  const t = vx * direction.x + vy * direction.y;
  return { x: datumPixel.x + direction.x * t, y: datumPixel.y + direction.y * t };
}

/**
 * The cap opposite `cap`, reflected through `datum` in pixel space.
 *
 * A plain point reflection, which needs no axes: reflecting through a point
 * maps the line through the datum onto itself, so a constrained cap's mirror is
 * automatically constrained too, whatever direction that line runs.
 */
export function mirrorCap(datumPixel: Point2D, capPixel: Point2D): Point2D {
  return { x: 2 * datumPixel.x - capPixel.x, y: 2 * datumPixel.y - capPixel.y };
}

/**
 * The nearest point of `candidates` to `pixel`, or null past `maxDistance`.
 *
 * Used to snap a drag's *start* onto a real datum. **The snap is what keeps the
 * datum end of the whisker honest**: the bar is anchored on a point the user
 * already placed from the figure, not on wherever the press landed. The cap end
 * is never snapped — it is the measurement.
 *
 * A distance limit here is the opposite of the one `resolveErrorBars`
 * deliberately refuses. That one would hide a mis-resolution the rendering is
 * meant to reveal; this one only governs whether a gesture *starts at all*, and
 * pressing on empty canvas should do nothing rather than yank a whisker off
 * some far-away point.
 */
export function nearestPixel(
  candidates: readonly Point2D[],
  pixel: Point2D,
  maxDistance: number
): { index: number; point: Point2D } | null {
  let bestIndex = -1;
  let bestDistance = Infinity;
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]!;
    const distance = Math.hypot(c.x - pixel.x, c.y - pixel.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
    }
  }
  if (bestIndex < 0 || bestDistance > maxDistance) return null;
  return { index: bestIndex, point: candidates[bestIndex]! };
}

/**
 * The two series names a mirrored pair uses, derived from one base name.
 *
 * **The user names the concept once ("SD"); the file needs two names**, because
 * upper and lower are two series (the model relates one series to another with
 * one role) and checkpoint 75 made names unique. Deriving "SD upper"/"SD lower"
 * keeps the series list readable, which "SD"/"SD (2)" — what uniqueDatasetName
 * would produce — does not.
 *
 * The name is the only place meaning lives, which is why it is the one thing we
 * ask for: no error *kind* is recorded (David: *"We do not even need to know
 * what type of error it represents. All we need is a unique name."*).
 *
 * Pairs with seriesColumnPrefix in engine/csvExport.ts, which then must not
 * restate the role, or the column stutters as "SD upper upper Y".
 */
export function errorSeriesName(base: string, role: ErrorRole): string {
  return `${base.trim()} ${role}`;
}

/**
 * The inverse of errorSeriesName: recover the user's base name from an error
 * series, given the role it plays. "SD upper" + 'upper' -> "SD".
 *
 * Used to tell one error BAR from another on the same parent (an "SD" bar vs a
 * "95% CI" bar): the base is the only thing that distinguishes them, since the
 * model records no error *kind*. A name that does not end in the role suffix (a
 * user who renamed the series off the convention) yields the whole name, so it
 * simply pairs with nothing rather than mis-pairing across error-bar types.
 */
export function errorSeriesBase(name: string, role: ErrorRole): string {
  const trimmed = name.trim();
  const suffix = ` ${role}`;
  return trimmed.endsWith(suffix) ? trimmed.slice(0, -suffix.length).trim() : trimmed;
}
