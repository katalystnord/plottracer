/**
 * PieAxes — pie, donut, half-pie and gauge figures.
 *
 * ⚑ ORIGINAL WORK, not a port. WebPlotDigitizer, Engauge and StarryDigitizer have no
 * pie mode; PlotDigitizer is the one competitor that does, which is why this is on the
 * roadmap at all.
 *
 * THE MODEL (David, 2026-07-28 / 2026-07-29)
 *
 * A pie inherently shows FRACTIONS OF A WHOLE — that is what "partition of a disc"
 * means, and it holds however the sectors are labelled. So the geometry is the
 * measurement and the printed labels are a claim about some base that may not even be
 * this chart: a figure whose labels sum to 184% is not lying, it is quoting
 * percentages of an outside denominator (multi-response survey data does exactly
 * this). Nothing here compares the two or issues a verdict.
 *
 * ⚑ THE TOTAL TURNS A SHAPE INTO VALUES, and that is the whole trick. Every other axes
 * type transcribes known values at known positions (X1=0, X2=10; the spider's centre
 * value). A pie has no axis to click, but it has exactly one number that does this job
 * — the whole. It is asked once, prefilled 100, and everything follows:
 *
 *     value = (sector angle / sweep) x total
 *
 * Left at 100 the values come out as percent; type the total printed in a donut's hole
 * and they come out in the figure's own units. Same field, same transcription, no
 * modes. This follows the spider's own rule — a default the user walks past and can
 * change, not an invention.
 *
 * ⚑ AND THAT VALUE IS WHAT GETS STORED, because it is what regenerates the figure —
 * both figures. A bar chart plots it directly (David's acceptance test: if the stored
 * value cannot be redrawn as a bar chart, we stored the wrong thing), and the pie
 * comes back via `angle = value / total x sweep`. The two boundary pixels stay in the
 * dataset as every series' pixels do, so the raw geometry is never lost — it is simply
 * not what the value column holds.
 *
 * ⚑ 360° IS NEVER A CONSTANT HERE. The whole is whatever the figure draws. That
 * collapses IBM TBM Studio's four documented variants — Standard, Standard Half,
 * Donut, Donut Half — into one path: a donut is an inner radius the angle does not
 * care about, a half pie is a smaller sweep, and a gauge is one sector plus a
 * remainder. No variant, no detection, nothing to get wrong on a chart type we guessed
 * at.
 *
 * ⚑ EXPLOSION IS NOT A SPECIAL CASE EITHER. A pulled-out sector is TRANSLATED and a
 * differently-sized one is SCALED; both are similarity transforms and both preserve
 * the angle. So a sector is measured at its own apex, which for an ordinary pie simply
 * happens to be the shared centre. `angleAt` therefore takes the apex as an argument
 * rather than assuming the calibrated centre.
 *
 * ⚑ THE FRAME IS AN ELLIPSE, WITH THE CIRCLE AS ITS DEGENERATE CASE (decided
 * 2026-07-28). A tilted or photographed pie is a circle under an AFFINE map, which
 * does not preserve angles but IS exactly invertible — so measuring in the (a, b)
 * basis below and taking the angle there is right for both, with the inverse being
 * the identity for a true circle. One code path, no branch that can be wrong. The
 * v1.6 capture flow only offers the circle (b is derived as a's perpendicular), so
 * the tilt toggle lands later by supplying a third calibration point, with no change
 * to anything stored.
 *
 * ⚑ NO ERROR NUMBER. A pie does not give us one. Boundaries are SHARED between
 * neighbouring sectors, so clicking one twice measures the user's aim rather than the
 * figure — the same reason the spider's off-ray distance is measured and deliberately
 * not recorded. The sum of sectors closing on the sweep is an identity, not a check.
 */

import type { Calibration } from '../calibration.js';
import type { AxesMetadata } from './types.js';

const TWO_PI = Math.PI * 2;

/** Normalise any angle into [0, 2π). */
function normalizeAngle(a: number): number {
  const r = a % TWO_PI;
  return r < 0 ? r + TWO_PI : r;
}

export class PieAxes {
  calibration: Calibration | null = null;
  name = 'Pie';
  /** A slice IS a category, exactly as a bar is — so the capture and the export
   * treat them the same way (the `label` metadata, exported as `Category`). */
  dataPointsHaveLabels = true;
  dataPointsLabelPrefix = 'Slice';

  private _isCalibrated = false;
  private metadata: AxesMetadata = {};

  /** Centre of the pie, in pixels. */
  private cx = 0;
  private cy = 0;
  /** Centre → rim: the first frame axis. Its length is the radius of a true circle. */
  private ax = 0;
  private ay = 0;
  /** The second frame axis. Perpendicular to `a` and of equal length for a circle
   * (the v1.6 case); read from a third calibration point once a tilt can be marked. */
  private bx = 0;
  private by = 0;
  /**
   * How much of a turn the figure draws — a full pie is 2π, a half pie π.
   *
   * ⚑ TRANSCRIBED ON THE RIM STEP, never derived from a slice click. Letting the last
   * boundary double as the end of the circumference would mix calibration with data
   * sampling, and breaks outright on a donut, where several rings share one frame but
   * have their own boundaries (David, 2026-07-29).
   */
  private sweep = TWO_PI;

  /**
   * The whole, as asked once on the rim step and prefilled 100.
   *
   * ⚑ THIS IS ONLY THE DEFAULT. The total is stored PER SERIES, because a donut's
   * rings are separate series and each ring is its own whole — two rings can be
   * different years, currencies or bases. Asked once, written to every series, so a
   * per-ring override later is a UI change with no migration. Same shape, and same
   * reasoning, as the spider asking for the centre value once and storing it per spoke;
   * the counterexample is the error-bar record, where the simplification was baked into
   * the file and can never be undone.
   */
  private defaultTotal = 100;

  isCalibrated(): boolean {
    return this._isCalibrated;
  }

  /**
   * Calibrate from the two placed points — centre (0) and rim (1) — plus the total
   * transcribed on the rim step.
   *
   * ⚑ Reports success on degenerate input, like every other axes class in this
   * directory. The refusals live in the session's guards (`distinctPixelSteps` catches
   * a rim placed on the centre) and in the config's `buildAxes` (a total that is not a
   * positive number), so that BOTH entrances — the click path and a loaded file — run
   * them. See engine/calibrationSession.ts's checkGuards.
   */
  calibrate(calibration: Calibration, defaultTotal: number, sweepDegrees: number): boolean {
    this.calibration = calibration;
    this._isCalibrated = false;

    const centre = calibration.getPoint(0);
    const rim = calibration.getPoint(1);
    if (!centre || !rim) return false;

    this.cx = centre.px;
    this.cy = centre.py;
    this.ax = rim.px - centre.px;
    this.ay = rim.py - centre.py;

    // The circle case: b is a rotated a quarter-turn. In image space y runs DOWN, so
    // this fixes the handedness of every angle below — consistently, which is all that
    // matters, since a sector's extent is a difference of two of them.
    this.bx = -this.ay;
    this.by = this.ax;

    this.defaultTotal = defaultTotal;
    this.sweep = (sweepDegrees * Math.PI) / 180;
    this._isCalibrated = true;
    return true;
  }

  /** The drawn extent of the whole, in radians. */
  getSweep(): number {
    return this.sweep;
  }

  /** The total asked once on the rim step — the value each new series starts from.
   * The series' own stored total is what a reading actually uses. */
  getDefaultTotal(): number {
    return this.defaultTotal;
  }

  /** Centre of the pie in pixels — the default apex for every unexploded sector. */
  getCentre(): { x: number; y: number } {
    return { x: this.cx, y: this.cy };
  }

  /**
   * The angle of a pixel about `apex`, in the pie's own frame, radians in [0, 2π).
   *
   * `apex` defaults to the calibrated centre; an exploded sector passes its own, which
   * is the entire handling explosion needs (translation preserves angles). Measuring
   * in the (a, b) basis rather than with a bare atan2 is what makes a tilted pie work
   * unchanged once the frame stops being a circle — for a circle the two agree.
   */
  angleAt(px: number, py: number, apex?: { x: number; y: number }): number {
    const ox = apex ? apex.x : this.cx;
    const oy = apex ? apex.y : this.cy;
    const dx = px - ox;
    const dy = py - oy;
    const det = this.ax * this.by - this.ay * this.bx;
    if (det === 0) return 0; // degenerate frame; the guards refuse this before it ships a number
    const u = (dx * this.by - dy * this.bx) / det;
    const v = (this.ax * dy - this.ay * dx) / det;
    return normalizeAngle(Math.atan2(v, u));
  }

  /**
   * The value of the sector running from `startAngle` to `endAngle` (radians, in the
   * pie's own frame, travelling positively). This is the one place the model's
   * arithmetic lives:  value = (angle / sweep) x total.
   *
   * `total` is the SERIES' total, passed in rather than read off the axes — see
   * `defaultTotal` for why each ring owns its own whole.
   */
  sectorValue(startAngle: number, endAngle: number, total: number): number {
    const extent = normalizeAngle(endAngle - startAngle);
    return (extent / this.sweep) * total;
  }

  /**
   * One pixel carries no value on a pie — a sector needs two boundaries — so this
   * reports the pixel's ANGLE in degrees, which is what the live readout can honestly
   * show while a boundary is being placed. The sector's value is derived from the pair
   * once the tuple is complete, exactly as a histogram bin's is from its two corners.
   */
  pixelToData(px: number, py: number): number[] {
    return [(this.angleAt(px, py) * 180) / Math.PI];
  }

  pixelToLiveString(px: number, py: number): string {
    return `${this.pixelToData(px, py)[0]!.toFixed(1)}°`;
  }

  getMetadata(): AxesMetadata {
    return this.metadata;
  }

  setMetadata(obj: AxesMetadata): void {
    this.metadata = obj;
  }

  numCalibrationPointsRequired(): number {
    return 2;
  }

  getDimensions(): number {
    return 1;
  }

  getAxesLabels(): string[] {
    return ['Value'];
  }
}
