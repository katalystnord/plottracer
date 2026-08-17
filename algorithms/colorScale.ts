/**
 * The colour bar as an AXIS — position on the key → a value (v2.2, phase 2).
 *
 * ⚑ THE WHOLE POINT: a colour bar is not a special mechanism, it is a third
 * axis. `colorBar.ts` answers "where on the key is this colour", in the key's
 * own 0..1 frame and with the evidence for that placement. This file does what
 * every other axis in the project does with a position — two labelled points and
 * the numbers printed beside them give the scale, and the log rule is the same
 * one the value axes use (`core/axes/logScale.ts`), not a second copy of it.
 *
 * ⚑⚑ THE TWO CLICKED TICKS ARE NOT THE TWO ENDS OF THE STRIP, and keeping them
 * apart is the single most important thing here. It is tempting to say "the key
 * runs from vmin to vmax, so its ends are the scale" — and that is wrong by a
 * measurable amount: the coloured ramp starts where the ink starts, while the
 * printed numbers sit wherever the figure's own tick machinery put them. The
 * test fixtures for phase 1 made exactly that assumption and it put a 0.6 °C
 * bias into every cell of a 160 °C figure, which is the same size as the error
 * the whole confidence apparatus exists to expose. So the strip is one
 * measurement (where the ramp is) and the scale is another (what two positions
 * on it are worth), and neither is derived from the other.
 *
 * ⚑ THE CONFIDENCE SURVIVES THE MAPPING, which is why phase 1 reported an
 * interval rather than a derivative: an interval converts through ANY monotone
 * scale by mapping its two ends. On a log key the band comes out asymmetric
 * around the value, exactly as it should — nothing has to propagate an error.
 *
 * Pure: numbers in, numbers out.
 */

import { logPositiveEndpointsUsable } from '../core/axes/logScale.js';
import { invertColor, positionOnStrip, type ColorBarStrip, type Point2D } from './colorBar.js';
import type { RGB } from './colorFilter.js';

/** A labelled tick on the key: a point on (or beside) the strip, and the number
 * the figure prints there. */
export interface ColorScaleTick {
  point: Point2D;
  value: number;
}

/**
 * A calibrated colour key.
 *
 * ⚑ The STRIP carries its samples, but a project file should store this
 * scale's GEOMETRY — the strip's two ends, its thickness, and the two ticks —
 * and re-sample the image on load rather than saving hundreds of RGB triples.
 * The samples are derived from the image, and the image is in the file; storing
 * a derived copy invites the two disagreeing. Re-sampling also sends the load
 * path back through `sampleColorBar`, so its refusals apply at that entrance
 * too rather than being reimplemented there.
 */
export interface ColorScale {
  strip: ColorBarStrip;
  /** In click order, not in magnitude order: a key may run high-to-low, and
   * plenty do. */
  ticks: readonly [ColorScaleTick, ColorScaleTick];
  /** A log colour scale is ordinary in older papers, and it is the SAME log
   * axis the value axes have. */
  log: boolean;
}

/**
 * Why a colour scale cannot be used. Codes, not sentences — the sentence
 * belongs where it is shown, and each must name the requirement AND its
 * consequence.
 */
export type ColorScaleRefusal =
  /** The two ticks land on the same position along the key, so no scale can be
   * derived from them. */
  | 'ticks-coincide'
  /** The two ticks carry the same number, so the key would have no span. */
  | 'ticks-equal-value'
  /** A tick's value is not a finite number. */
  | 'tick-not-a-number'
  /** A log key needs both labelled values strictly positive. */
  | 'log-needs-positive';

/**
 * How far apart, in pixels along the strip, two ticks must be before they are
 * two ticks at all.
 *
 * ⚑ This is a DEGENERACY guard, not a precision one. Below a pixel the two
 * clicks are the same click and the scale is a division by nothing. Above it,
 * how precisely the user places them is their business: two ticks 20px apart on
 * a 500px key give a coarse scale, but a coarse scale is a real answer and
 * refusing it would refuse a real figure (a key with only two printed labels,
 * close together, is a figure we should still read).
 */
export const MIN_TICK_SEPARATION_PX = 1;

/** A value read off the key, with the interval it could not be told apart from. */
export interface ColorValueBand {
  value: number;
  /** The interval's ends, ordered low-to-high in VALUE — a key may run
   * high-to-low, and a reader must never have to check which way round it is. */
  low: number;
  high: number;
  /** How far off the ramp the queried colour sat, in RGB units. Zero means the
   * colour is exactly one the key prints. */
  distance: number;
}

export interface ColorValueReading extends ColorValueBand {
  /**
   * The reading sits against one END of the key.
   *
   * ⚑⚑ WHERE A CLIPPED CELL HIDES. A figure whose data runs past its own colour
   * key draws every such cell in the key's extreme colour — so the cell's colour
   * matches the ramp EXACTLY (distance 0), fills the cell uniformly, and reads
   * back as the key's limit with total confidence. It is the one wrong value the
   * other two measures cannot see, because nothing about the pixels is wrong:
   * the figure genuinely does not contain the number any more.
   *
   * Measured, not guessed: the band the colour is consistent with reaches the
   * first or last position on the strip. A cell legitimately AT the limit reads
   * the same way — which is the point. Neither the tool nor the reader can tell
   * them apart, and saying so is the only honest option.
   */
  atKeyLimit: boolean;
  /**
   * Other values the same colour is equally consistent with — a cyclic key, a
   * diverging one that revisits a pale colour, or a degraded figure where the
   * colour error is as large as the difference between two stretches of key.
   *
   * ⚑ NON-EMPTY MEANS THE READING IS AMBIGUOUS, NOT IMPRECISE, and the two
   * cannot be shown the same way: an imprecise value is a number with an error
   * bar, an ambiguous one is not a number at all until the user resolves it.
   */
  rivals: readonly ColorValueBand[];
}

/** The strip's length in pixels — how much figure one unit of position is worth. */
function stripLengthPx(strip: ColorBarStrip): number {
  const dx = strip.to.x - strip.from.x;
  const dy = strip.to.y - strip.from.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * The model's own guard, applied at every entrance: the interactive path when
 * the second tick is entered, and the load path when a project file supplies
 * one. Returns null when the scale is usable.
 */
export function checkColorScale(scale: ColorScale): ColorScaleRefusal | null {
  const [a, b] = scale.ticks;
  const values = checkColorScaleValues(a.value, b.value, scale.log);
  if (values !== null) return values;

  const ta = positionOnStrip(scale.strip, a.point);
  const tb = positionOnStrip(scale.strip, b.point);
  if (ta === null || tb === null) return 'ticks-coincide';
  if (Math.abs(tb - ta) * stripLengthPx(scale.strip) < MIN_TICK_SEPARATION_PX) {
    return 'ticks-coincide';
  }
  return null;
}

/**
 * The half of the check that needs only the two TYPED NUMBERS, split out
 * because it has to run somewhere there is no strip yet.
 *
 * ⚑ The calibration walk collects the key's two labelled values before any
 * colour has been read through them, and a refusal is worth far more at that
 * moment than later. This is the same rule either way, called from both places,
 * rather than the calibration card growing its own copy — which is precisely
 * how a guard comes to disagree with the model it guards.
 */
export function checkColorScaleValues(
  a: number,
  b: number,
  log: boolean
): ColorScaleRefusal | null {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 'tick-not-a-number';
  if (a === b) return 'ticks-equal-value';
  // The rule the bar, spider and polar value axes already carry: a magnitude
  // scale has no negative branch, and `Math.log(0)` is −Infinity, which
  // calibrates "successfully" and then reads back as nothing at all.
  if (log && !logPositiveEndpointsUsable(a, b)) return 'log-needs-positive';
  return null;
}

/**
 * What a position along the key is worth. Null for a scale that
 * `checkColorScale` refuses, and for a position that is not a finite number.
 *
 * Positions outside the two ticks EXTRAPOLATE rather than clamp, and that is
 * deliberate: the printed labels are almost never at the very ends of the ramp,
 * so the top and bottom of most keys lie outside them. Clamping would quietly
 * flatten every extreme cell in the figure onto the last labelled value — the
 * worst place to lose data, since the extremes are usually the point of the
 * figure.
 */
/**
 * Where a VALUE sits along the key — the inverse of `valueAtPosition`.
 *
 * ⚑⚑ THE THIRD AXIS IS AN AXIS, so it inverts like the other two. David, when I
 * proposed treating a corrected cell value as an OVERRIDE with a
 * declared-vs-measured flag: *"NO. And seriously NO. Heatmaps are a 2.5D graph
 * type. The values are STORED ON THE THIRD AXIS. Changing a value in a cell
 * MOVES THE VALUE on the third axis that records the value, and nothing else!"*
 * Right — editing a cell is the same gesture as editing a data point's y, which
 * repositions the point through the axes' inverse transform. The point just
 * moves along the COLOUR KEY instead of inside the plot box, so there is nothing
 * to declare and no provenance to record.
 *
 * Null when the scale cannot answer — an unusable key, a non-finite value, or a
 * value a LOG key cannot represent (zero or negative).
 */
export function positionAtValue(scale: ColorScale, value: number): number | null {
  if (!Number.isFinite(value)) return null;
  if (checkColorScale(scale) !== null) return null;
  const [a, b] = scale.ticks;
  const ta = positionOnStrip(scale.strip, a.point)!;
  const tb = positionOnStrip(scale.strip, b.point)!;
  if (scale.log) {
    if (value <= 0) return null;
    const la = Math.log(a.value);
    const lb = Math.log(b.value);
    if (lb === la) return null;
    return ta + ((Math.log(value) - la) / (lb - la)) * (tb - ta);
  }
  if (b.value === a.value) return null;
  return ta + ((value - a.value) / (b.value - a.value)) * (tb - ta);
}

/**
 * THE KEY'S SCALE, and the only expression of it: what a position `t` along the
 * strip is worth, given two labelled ticks at `ta`/`tb` worth `va`/`vb`.
 *
 * ⚑⚑ EXTRACTED so a second caller cannot write the formula out again. The
 * colour key's calibrated EXTENT is wanted on screen the moment the key is
 * calibrated — before any cell is read, and therefore before any strip has been
 * sampled — and computing it needs exactly this and no image. Restating
 * `exp(la + u*(lb-la))` in `ui/` would have been the v2.2 audit's own finding
 * A2 all over again: one idea, several copies, and nothing to keep their
 * policies in step.
 *
 * ⚑ It EXTRAPOLATES on purpose, outside `ta`…`tb`. The printed labels are
 * almost never at the very ends of the ramp, so the top and bottom of most keys
 * lie beyond them — and there is real sampled ink out there. The bound that
 * matters is the STRIP the user marked, which is enforced where readings are
 * taken, not here.
 */
export function valueAtParam(
  t: number,
  ta: number,
  tb: number,
  va: number,
  vb: number,
  log: boolean
): number | null {
  if (!Number.isFinite(t) || !Number.isFinite(ta) || !Number.isFinite(tb)) return null;
  if (tb === ta) return null;
  const u = (t - ta) / (tb - ta);
  if (log) {
    // A log scale has no negative branch and log(0) is -Infinity; a key whose
    // labels straddle or touch zero cannot be logarithmic at all.
    if (!(va > 0) || !(vb > 0)) return null;
    const la = Math.log(va);
    const lb = Math.log(vb);
    return Math.exp(la + u * (lb - la));
  }
  return va + u * (vb - va);
}

export function valueAtPosition(scale: ColorScale, t: number): number | null {
  if (!Number.isFinite(t)) return null;
  if (checkColorScale(scale) !== null) return null;
  const [a, b] = scale.ticks;
  const ta = positionOnStrip(scale.strip, a.point)!;
  const tb = positionOnStrip(scale.strip, b.point)!;
  return valueAtParam(t, ta, tb, a.value, b.value, scale.log);
}

/**
 * Read a colour as a value on this key: what it is worth, the interval it
 * cannot be told apart from, how far off the ramp it sat, and any rival value
 * it is equally consistent with.
 *
 * Null when the scale is unusable or the strip has too few samples to invert
 * against — the two model entrances, refused in one place.
 */
export function readColor(scale: ColorScale, rgb: RGB): ColorValueReading | null {
  if (checkColorScale(scale) !== null) return null;
  const reading = invertColor(scale.strip, rgb);
  if (reading === null) return null;

  const band = (t: number, tLow: number, tHigh: number, distance: number): ColorValueBand => {
    const value = valueAtPosition(scale, t)!;
    const ends = [valueAtPosition(scale, tLow)!, valueAtPosition(scale, tHigh)!];
    return {
      value,
      // Ordered by VALUE, not by position: a key that runs high-to-low maps a
      // band's low end to the larger number, and a caller comparing `low` and
      // `high` should never have to know which way the figure drew its key.
      low: Math.min(ends[0]!, ends[1]!),
      high: Math.max(ends[0]!, ends[1]!),
      distance,
    };
  };

  const first = scale.strip.samples[0]!.t;
  const last = scale.strip.samples[scale.strip.samples.length - 1]!.t;
  return {
    ...band(reading.t, reading.tLow, reading.tHigh, reading.distance),
    atKeyLimit: reading.tLow <= first || reading.tHigh >= last,
    rivals: reading.rivals.map((r) => band(r.t, r.tLow, r.tHigh, r.distance)),
  };
}
