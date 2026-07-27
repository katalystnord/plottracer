/**
 * SpiderAxes — spider / radar / Kiviat charts.
 *
 * ⚑ ORIGINAL WORK, not a port. There is no upstream counterpart: WebPlotDigitizer,
 * Engauge and StarryDigitizer have no radar mode at all (grepped, 2026-07-26), and
 * OriginPro's digitizer offers Cartesian, Polar and Ternary only. The one piece of
 * prior art is ChartSense (CHI 2017), a research prototype which assumes every axis
 * shares one scale and every adjacent pair of axes is equally spaced. Neither
 * assumption is made here — see `calibrate` below.
 *
 * ⚑ WHY THIS IS NOT PolarAxes. `core/axes/polar.ts` is a faithful WPD port with ONE
 * radial scale and a *continuously measured* angle: a datum there is (r, θ), and θ is
 * a value the figure is claiming. A spider chart has no continuous angle. Each spoke
 * is a SEPARATE 1-D axis with its own scale, and the angle between spokes is a
 * rendering convention the figure chose, never a number anyone measured. Recording an
 * angle here would be interpretation (tenet 9), so this class does not have one: ray
 * directions exist only as calibration geometry used to project a click.
 *
 * THE MODEL (David's, 2026-07-26)
 *   - one origin click, shared by every spoke;
 *   - per spoke, ONE click on a known point — which supplies that ray's direction AND
 *     its distance from the origin in a single measurement — plus that point's value
 *     and the axis's printed name;
 *   - a click is recorded by projecting it onto a ray, and the PERPENDICULAR distance
 *     from that ray is reported so a click that landed on the wrong spoke can be
 *     warned about rather than silently snapped.
 *
 * ⚑ THE CENTRE VALUE IS STORED PER SPOKE even though the UI asks for it once. Origin
 * + one known point + its value is a single (value, distance) pair, and a scale needs
 * two, so the centre's value must be collected — with 0 preselected, which is a
 * default the user walks past and can change, not an invention. A common centre is
 * the rule in real figures, so ONE question is the right workflow; but storing it once
 * would bake that simplification into the FILE, and a later per-axis override would
 * then need a migration and a reinterpretation of every existing project. Stored per
 * spoke, that stays a UI change. (The counterexample this rule comes from is the
 * error-bar record, where an app-mirrored cap and a measured one are indistinguishable
 * forever.)
 */

import { InputParser } from '../inputParser.js';
import type { Calibration } from '../calibration.js';
import type { AxesMetadata } from './types.js';

/** One calibrated spoke: a 1-D scale running from the shared origin outwards. */
export interface Spoke {
  /** The axis's printed name, transcribed from the figure. */
  name: string;
  /** Unit vector from the origin towards the known point, in pixel space. */
  ux: number;
  uy: number;
  /** Pixel distance from the origin to the known point. Always > 0. */
  lengthPx: number;
  /** The value the figure prints at the known point. */
  knownValue: number;
  /** The value at the shared origin. Per spoke — see the file header. */
  centreValue: number;
}

/** Where a pixel falls relative to one spoke. */
export interface SpokeProjection {
  /** Index of the spoke this was measured against. */
  index: number;
  /** The value read off that spoke's scale. */
  value: number;
  /** Distance along the ray from the origin, in pixels. Negative = behind the
   * origin, i.e. on the opposite spoke. */
  alongPx: number;
  /** PERPENDICULAR distance from the ray, in pixels. This is the number the capture
   * workflow warns on: a click meant for spoke k that landed near spoke k+1 shows up
   * here as a large offset, where a silent nearest-ray snap would have recorded it
   * against the wrong axis with nothing on screen wrong. */
  offRayPx: number;
}

export class SpiderAxes {
  calibration: Calibration | null = null;
  name = 'Spider';

  private _isCalibrated = false;
  private metadata: AxesMetadata = {};
  private isLogScale = false;
  private x0 = 0;
  private y0 = 0;
  private spokes: Spoke[] = [];

  isCalibrated(): boolean {
    return this._isCalibrated;
  }

  /**
   * Calibrate from a variable-length point list: point 0 is the shared origin,
   * points 1..N are one known point per spoke.
   *
   * Per spoke the calibration point carries `dx` = the value printed at that point,
   * `dy` = the value at the centre for that spoke, `dz` = the axis's name. The origin
   * point carries only its pixel — deliberately NOT a copy of the centre value, so
   * there is exactly one home for that fact and no way for two copies to disagree.
   *
   * ⚑ Refuses rather than reporting success on degenerate input. Every axes class we
   * inherited returns true on input it cannot actually use (BarAxes reported success
   * on `"abc"`, PolarAxes on `Math.log(0)`), which makes the caller's own error
   * message dead code. The refusals here are:
   *   - fewer than 2 calibration points (an origin with no spoke is not a scale);
   *   - a spoke point ON the origin (no direction, and zero pixel length);
   *   - a value that is not a plain number, or is a date (there is no date concept
   *     here to honour one with, and a date parses TO a number, so a bare typeof
   *     check would silently record a julian day count);
   *   - centre === known value (zero scale: every pixel would read the same number);
   *   - on a log axis, a centre or known value that is not strictly positive.
   */
  calibrate(calibration: Calibration, isLog: boolean): boolean {
    this.calibration = calibration;
    this._isCalibrated = false;
    this.spokes = [];
    this.isLogScale = isLog;

    const count = calibration.getCount();
    if (count < 2) return false;

    const origin = calibration.getPoint(0)!;
    this.x0 = origin.px;
    this.y0 = origin.py;

    const ip = new InputParser();
    const spokes: Spoke[] = [];
    for (let i = 1; i < count; i++) {
      const cp = calibration.getPoint(i)!;

      const dx = cp.px - this.x0;
      const dy = cp.py - this.y0;
      const lengthPx = Math.sqrt(dx * dx + dy * dy);
      if (!(lengthPx > 0)) return false;

      const knownValue = ip.parse(cp.dx);
      if (!ip.isValid || ip.isDate || typeof knownValue !== 'number') return false;
      const centreValue = ip.parse(cp.dy);
      if (!ip.isValid || ip.isDate || typeof centreValue !== 'number') return false;
      if (knownValue === centreValue) return false;
      if (isLog && (!(knownValue > 0) || !(centreValue > 0))) return false;

      spokes.push({
        // A name is transcription, not measurement, so an unnamed spoke is left
        // unnamed rather than given an invented one; the UI falls back to "Axis N"
        // for display, which is positional and true by construction.
        name: cp.dz == null ? '' : String(cp.dz),
        ux: dx / lengthPx,
        uy: dy / lengthPx,
        lengthPx,
        knownValue,
        centreValue,
      });
    }

    this.spokes = spokes;
    this._isCalibrated = true;
    return true;
  }

  /**
   * Read a pixel against ONE named spoke — the capture path's entry point.
   *
   * The caller knows which axis it is asking about (the capture cursor walks the
   * spokes in order), so the axis identity is never guessed from geometry. The
   * returned `offRayPx` is what makes that safe to get wrong: it says how far the
   * click was from the ray it was recorded against.
   */
  projectOnSpoke(index: number, px: number, py: number): SpokeProjection | null {
    const spoke = this.spokes[index];
    if (!this._isCalibrated || !spoke) return null;

    const dx = px - this.x0;
    const dy = py - this.y0;
    const alongPx = dx * spoke.ux + dy * spoke.uy;
    // Perpendicular component: the rejection of (dx,dy) from the unit ray.
    const perpX = dx - alongPx * spoke.ux;
    const perpY = dy - alongPx * spoke.uy;

    return {
      index,
      value: this.valueAtDistance(spoke, alongPx),
      alongPx,
      offRayPx: Math.sqrt(perpX * perpX + perpY * perpY),
    };
  }

  /**
   * The spoke this pixel lies closest to.
   *
   * ⚑ Measured to the RAY, not to the infinite line through the origin. A spoke
   * runs one way only, so anything behind the centre is measured from the centre
   * instead of being treated as lying on the spoke's backward extension.
   *
   * That distinction is not academic: on any chart with an EVEN number of equally
   * spaced axes, every spoke has an exact opposite, and the two are collinear. By
   * perpendicular distance alone, a point far out on one of them is zero from
   * both, and the tie broke on floating-point noise. Driving the six-axis sample
   * produced the giveaway on screen — "0 px off the Cost index axis and nearer
   * Water-vapour barrier", a sentence that cannot be true (David, 2026-07-27).
   * Every fixture in the unit tests had three spokes, which has no opposite pairs,
   * so nothing caught it.
   */
  nearestSpoke(px: number, py: number): SpokeProjection | null {
    let best: SpokeProjection | null = null;
    let bestDistance = Infinity;
    for (let i = 0; i < this.spokes.length; i++) {
      const projection = this.projectOnSpoke(i, px, py)!;
      // Distance to the ray: the perpendicular offset once past the origin,
      // otherwise the straight-line distance back to the origin itself.
      const distance =
        projection.alongPx >= 0
          ? projection.offRayPx
          : Math.hypot(projection.alongPx, projection.offRayPx);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = projection;
      }
    }
    return best;
  }

  /**
   * The generic axes contract: one value per pixel, read off the NEAREST spoke.
   *
   * This is the live cursor readout's path, not the capture path — capture goes
   * through projectOnSpoke with the axis it means. Nearest-spoke is the only honest
   * answer available when nobody has said which axis is meant, and for a click that
   * landed on a spoke it agrees with the capture path by construction.
   */
  pixelToData(px: number, py: number): number[] {
    const projection = this.nearestSpoke(px, py);
    return [projection == null ? NaN : projection.value];
  }

  /** Pixel position of `value` along spoke `index` — the inverse of projectOnSpoke.
   *
   * ⚑ Real, not a stub. BarAxes ships WPD's unimplemented `dataToPixel` returning
   * {0,0}, and that stubbed-ness became load-bearing (algorithms/errorCapture.ts
   * probes it). Nothing here needs to degrade: a spoke is an invertible 1-D scale, so
   * export precision (core/exportPrecision.ts measures a half-pixel in DATA units
   * through this) and any drawn overlay get a truthful answer.
   *
   * ⚑ WHERE THERE IS NO PIXEL — an unknown spoke, or a non-positive value on a log
   * axis — this answers {NaN, NaN}, NOT {0,0}. The shared axes contract has no
   * nullable return, and {0,0} is both a real image coordinate and the exact
   * sentinel the stubbed implementations use, so returning it here would be
   * indistinguishable from "this type cannot invert" and would quietly draw a point
   * in the image's top-left corner. NaN is neither a location nor a claim: it
   * propagates visibly through any arithmetic that consumes it.
   */
  dataToPixel(index: number, value: number): { x: number; y: number } {
    const spoke = this.spokes[index];
    if (!this._isCalibrated || !spoke) return { x: NaN, y: NaN };

    let fraction: number;
    if (this.isLogScale) {
      if (!(value > 0)) return { x: NaN, y: NaN };
      fraction =
        (Math.log(value) - Math.log(spoke.centreValue)) /
        (Math.log(spoke.knownValue) - Math.log(spoke.centreValue));
    } else {
      fraction = (value - spoke.centreValue) / (spoke.knownValue - spoke.centreValue);
    }

    const alongPx = fraction * spoke.lengthPx;
    return { x: this.x0 + alongPx * spoke.ux, y: this.y0 + alongPx * spoke.uy };
  }

  pixelToLiveString(px: number, py: number): string {
    const projection = this.nearestSpoke(px, py);
    if (projection == null) return '';
    const spoke = this.spokes[projection.index]!;
    const label = spoke.name !== '' ? spoke.name : `Axis ${projection.index + 1}`;
    return `${label}: ${projection.value.toExponential(4)}`;
  }

  /** The scale along one spoke, evaluated at a pixel distance from the origin. */
  private valueAtDistance(spoke: Spoke, alongPx: number): number {
    const fraction = alongPx / spoke.lengthPx;
    if (this.isLogScale) {
      const logCentre = Math.log(spoke.centreValue);
      return Math.exp(logCentre + (Math.log(spoke.knownValue) - logCentre) * fraction);
    }
    return spoke.centreValue + (spoke.knownValue - spoke.centreValue) * fraction;
  }

  getSpokes(): readonly Spoke[] {
    return this.spokes;
  }

  getSpokeCount(): number {
    return this.spokes.length;
  }

  /** The axis's printed name, or its positional fallback when it was never named. */
  getSpokeLabel(index: number): string {
    const spoke = this.spokes[index];
    if (!spoke) return '';
    return spoke.name !== '' ? spoke.name : `Axis ${index + 1}`;
  }

  getOrigin(): { x: number; y: number } {
    return { x: this.x0, y: this.y0 };
  }

  isLog(): boolean {
    return this.isLogScale;
  }

  getMetadata(): AxesMetadata {
    return JSON.parse(JSON.stringify(this.metadata));
  }

  setMetadata(obj: AxesMetadata): void {
    this.metadata = JSON.parse(JSON.stringify(obj));
  }

  /** Variable by construction — a spider has as many spokes as the figure drew.
   * Every other axes class answers with a constant; this one can only answer for a
   * calibration it has already accepted, and 2 (origin + one spoke) is the floor. */
  numCalibrationPointsRequired(): number {
    return this._isCalibrated ? this.spokes.length + 1 : 2;
  }

  getDimensions(): number {
    return 2;
  }

  /** Value-column headers. One measured number per datum, like Bar — the axis it
   * belongs to is the point GROUP, not part of the value, and the axis's NAME is
   * looked up from the spoke rather than stored per point (it was measured once, at
   * calibration). The export layer joins those into `Axis, Name, Value`, the direct
   * analogue of Bar's `Position, Category, Value`. */
  getAxesLabels(): string[] {
    return ['Axis', 'Value'];
  }
}
