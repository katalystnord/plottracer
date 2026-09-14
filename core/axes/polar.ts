/**
 * Originally ported from wpd-core's core/axes/polar.js.
 * Original: WebPlotDigitizer, Copyright (C) 2025 Ankit Rohatgi, AGPL-3.0.
 * See ../mathFunctions.ts for porting-provenance notes.
 *
 * ⚑ `calibrate()` VALIDATES ITS VALUES AND CAN ANSWER FALSE. A radius or angle
 * that is not a number is refused rather than parsed loosely: `"abc"` read
 * permissively becomes `NaN`, which is then baked into every later reading while
 * the calibration reports success and nothing on screen looks wrong. A
 * calibration that cannot fail is not a check.
 */

import { taninverse, sineBetween, MIN_READABLE_SINE } from '../mathFunctions.js';
import { InputParser } from '../inputParser.js';
import type { Calibration } from '../calibration.js';
import type { AxesMetadata } from './types.js';
import { logPositiveEndpointsUsable } from './logScale.js';

/** The affine frame a polar figure is drawn in: `[[a,b],[c,d]]` maps a canonical
 *  (ρ·cosθ, ρ·sinθ) to a screen offset from the origin. `sense` is the angular
 *  convention that was folded in, so the reading can undo it. */
interface PolarFrame {
  a: number;
  b: number;
  c: number;
  d: number;
  det: number;
  rho0: number;
  sense: number;
  /**
   * ⚑⚑ WHICH WAY THE RADIAL AXIS RUNS: +1 outward-increasing, -1 decreasing.
   *
   * Factored out of `M` rather than left inside it, because the reading recovers
   * the radius with `hypot`, which is UNSIGNED. With the sign inside the frame,
   * a figure whose declared radii sit below the centre value read back reflected
   * about the centre with its angle 180 degrees out, and said it had calibrated.
   * A sky chart (elevation 90 at the centre, 0 at the rim) is an ordinary
   * example; so is a mistyped centre.
   */
  radialSign: number;
}

export class PolarAxes {
  calibration: Calibration | null = null;
  name = 'Polar';

  private _isCalibrated = false;
  private isDegrees = false;
  private isClockwise = false;
  private isLog = false;
  private metadata: AxesMetadata = {};

  private x0 = 0;
  private y0 = 0;
  private x1 = 0;
  private y1 = 0;
  private r1 = 0;
  private theta1 = 0;
  private r2 = 0;
  private dist10 = 0;
  private dist12 = 0;
  private alpha0 = 0;
  /** The measured frame, or null when the two clicks cannot describe one and
   *  the circular reading stands. See `buildFrame`. */
  private frame: PolarFrame | null = null;
  /** What the user says the DRAWING is: a true circle, or a distorted one whose
   *  shape has to be measured. Declared, because the circular walk holds no
   *  information about shape at all - see `isCircularPlot`. */
  private isCircular = true;

  private processCalibration(cal: Calibration, is_degrees: boolean, is_clockwise: boolean, is_log_r: boolean, is_circular: boolean): boolean {
    // v2.0 pre-launch audit: guard the count before indexing (see
    // map.ts/ternary.ts's identical fix for the full reasoning).
    // ⚑ A re-calibration must not inherit the last one's frame: the same object
    // is calibrated again on every handle drag, and a drag that puts P2 back on
    // P1's ray has to fall back to the circular reading rather than keep a frame
    // the clicks no longer support.
    this.frame = null;
    this.isCircular = is_circular;
    if (cal.getCount() < 3) return false;
    const cp0 = cal.getPoint(0)!;
    const cp1 = cal.getPoint(1)!;
    const cp2 = cal.getPoint(2)!;
    this.x0 = cp0.px;
    this.y0 = cp0.py;
    this.x1 = cp1.px;
    this.y1 = cp1.py;
    const x2 = cp2.px;
    const y2 = cp2.py;

    const ip = new InputParser();
    const r1Parsed = ip.parse(cp1.dx);
    if (!ip.isValid || ip.isDate || typeof r1Parsed !== 'number') return false;
    const theta1Parsed = ip.parse(cp1.dy);
    if (!ip.isValid || ip.isDate || typeof theta1Parsed !== 'number') return false;
    const r2Parsed = ip.parse(cp2.dx);
    if (!ip.isValid || ip.isDate || typeof r2Parsed !== 'number') return false;
    // ⚑ The two declared radii must DIFFER, or the radial scale has no range:
    // the pixel distance between p1 and p2 maps to a value difference of zero,
    // so every point in the figure reads back that one constant radius however
    // far from the origin it sits -- with calibrate() reporting success and
    // nothing on screen wrong. Exactly the defect `core/axes/bar.ts` carries
    // the same guard for; found on 2026-07-31 by asking every axes type the
    // same question at once (engine/__tests__/everyAxesTypeRefuses.test.ts).
    //
    // The config's `radialDistinctGuard` checks the two PIXELS are at distinct
    // radii, which is a different question and does not catch this.
    if (r1Parsed === r2Parsed) return false;
    this.r1 = r1Parsed;
    this.theta1 = theta1Parsed;
    this.r2 = r2Parsed;
    // ⚑⚑ θ2 IS NO LONGER DEAD (2026-09-10). Upstream assigns it and never reads
    // it; it is exactly the information that lets the FRAME be measured instead
    // of a circle being assumed - see `buildFrame` below. Still ungated, and now
    // for a reason rather than by inheritance: BLANK is the ordinary case (every
    // WPD project, and our own prompt until today), and it selects the circular
    // reading rather than refusing anything. A non-empty string is read with
    // `Number()` rather than `InputParser` because an angle here is a plain
    // number, never a date.
    const theta2Raw = String(cp2.dy ?? '').trim();
    const theta2 = theta2Raw === '' ? Number.NaN : Number(theta2Raw);

    this.isDegrees = is_degrees;
    this.isClockwise = is_clockwise;

    let theta1 = this.theta1;
    let theta2r = theta2;
    if (this.isDegrees === true) {
      theta1 = (Math.PI / 180.0) * this.theta1;
      theta2r = (Math.PI / 180.0) * theta2;
    }
    this.theta1 = theta1;

    let r1 = this.r1;
    let r2 = this.r2;
    if (is_log_r) {
      // A radius has no negative branch here, so both known radii must be
      // strictly positive: Math.log(0) is -Infinity and Math.log(negative) is
      // NaN, and either would be baked into dist10/dist12 while this method
      // still returned true. See core/axes/logScale.ts.
      if (!logPositiveEndpointsUsable(r1, r2)) return false;
      this.isLog = true;
      r1 = Math.log(r1) / Math.log(10);
      r2 = Math.log(r2) / Math.log(10);
    }
    this.r1 = r1;
    this.r2 = r2;

    this.dist10 = Math.sqrt((this.x1 - this.x0) * (this.x1 - this.x0) + (this.y1 - this.y0) * (this.y1 - this.y0));
    const dist20 = Math.sqrt((x2 - this.x0) * (x2 - this.x0) + (y2 - this.y0) * (y2 - this.y0));
    this.dist12 = dist20 - this.dist10;

    const phi0 = taninverse(-(this.y1 - this.y0), this.x1 - this.x0);

    this.alpha0 = this.isClockwise ? phi0 + this.theta1 : phi0 - this.theta1;

    // ⚑⚑ EVERYTHING ABOVE IS UNCHANGED, AND STAYS THE ANSWER WHEN THE CLICKS
    // CANNOT DO BETTER. The frame below is an UPGRADE attempted afterwards, so a
    // calibration that cannot support it reads exactly as it always did.
    // ⚑⚑ THE SHAPE IS DECLARED, NOT SNIFFED (2026-09-10, David). An earlier
    // draft built the frame whenever the two angles happened to differ, which
    // made the model in force depend on where the user's second click landed -
    // a hidden mode, and then a line of text to explain it. The toggle IS the
    // explanation, and it changes WHAT WE ASK FOR (`stepsForOptions`) exactly as
    // Log X or Horizontal bars do, so the question is answered before the walk
    // rather than inferred after it.
    if (!is_circular) {
      this.frame = this.buildFrame(cp0, theta1, theta2r, x2, y2);
      // A distorted figure whose clicks cannot describe a frame has no reading
      // to fall back on: the circular maths is the thing the user just said is
      // wrong. Refusing is the honest answer, and the walk asks for exactly what
      // the frame needs, so this is reachable only from a file or a drag.
      if (this.frame === null) return false;
      // ⚑⚑⚑ THE MODEL READS ITS OWN CALIBRATION POINTS BACK, AND REFUSES IF IT
      // CANNOT.
      //
      // Not belt-and-braces: it is the cheapest complete statement of what a
      // calibration IS, and it catches a CLASS rather than an instance. An
      // unsigned `hypot` once reflected every radius about the centre and
      // reported success, and the only thing that would have noticed is this
      // question - which the test file next door already names ("reproduces its
      // own two calibration points, as any calibration must") and had never run
      // on a figure whose radial axis decreases outward.
      //
      // Frame path only. The circular reading is a two-point fit that does not
      // use P2's angle at all, so it cannot be asked to reproduce one.
      if (!this.reproduces(this.x1, this.y1, this.r1, theta1) ||
          !this.reproduces(x2, y2, this.r2, theta2r)) {
        this.frame = null;
        return false;
      }
    }

    return true;
  }

  /**
   * ⚑⚑ THE FIGURE'S OWN FRAME, MEASURED FROM THE TWO CLICKS - or null when they
   * cannot describe one.
   *
   * A polar drawing is an AFFINE image of the polar plane: the concentric
   * circles are ellipses whenever the figure is tilted, squashed into a column,
   * or photographed, and the raw pixel angle is then not the plotted angle
   * either. An affine map about a known origin has FOUR unknowns, the origin
   * fixes translation, and P1 and P2 supply two equations each - so the frame is
   * EXACTLY determined, with no fitting and no extra clicks, the moment the two
   * angles differ. Measured on a sheared frame: recovery to machine precision,
   * where the circular reading gave r=176.5 for a true 75.
   *
   * ⚑ TWO POINTS ON ONE RAY SEE NOTHING PERPENDICULAR TO IT, so `u1 × u2 == 0`
   * describes clicks that cannot fix a frame, and this returns null.
   *
   * ⚠️ That used to end "and the circular reading takes over", which is not what
   * happens and never was: `buildFrame` is only reached from the `!is_circular`
   * branch, where a null frame makes `calibrate()` answer false. The repo's own
   * test - "a figure DECLARED distorted refuses clicks that cannot describe a
   * frame" - enforces the opposite of what the sentence promised. Falling back
   * would be the wrong behaviour anyway: the circular maths is the thing the
   * user just said is wrong about this figure.
   *
   * ⚑ THE CENTRE'S RADIAL VALUE comes from the origin point's own slot, blank
   * meaning 0. Two clicks can determine the SHAPE or the radial OFFSET, not
   * both - the counting is 5 unknowns against 4 equations - so the offset is
   * transcribed from the number printed at the middle of the figure, like any
   * other axis value. The circular path keeps inferring it from P1 and P2, as it
   * always has.
   */
  private buildFrame(
    cp0: { dx: string | number | null },
    theta1r: number,
    theta2r: number,
    x2: number,
    y2: number
  ): PolarFrame | null {
    if (!Number.isFinite(theta2r)) return null;

    const centreRaw = String(cp0.dx ?? '').trim();
    const centreValue = centreRaw === '' ? 0 : Number(centreRaw);
    if (!Number.isFinite(centreValue)) return null;
    // On a log radial axis the centre carries a radius like any other point, so
    // it has the same no-zero, no-negative rule the endpoints already meet.
    if (this.isLog && !(centreValue > 0)) return null;
    const rho0 = this.isLog ? Math.log(centreValue) / Math.log(10) : centreValue;
    if (!Number.isFinite(rho0)) return null;

    // `this.r1`/`this.r2` are already in the radial COORDINATE (log-scaled when
    // the axis is), which is the space the frame is linear in.
    const rho1 = this.r1 - rho0;
    const rho2 = this.r2 - rho0;
    // A calibration point AT the centre gives the frame no direction.
    if (rho1 === 0 || rho2 === 0) return null;
    // ⚑⚑ THE TWO CLICKS MUST AGREE ON WHICH WAY THE AXIS RUNS. They disagree
    // only when the centre value falls BETWEEN the declared radii, which is
    // contradictory rather than merely awkward: the axis would have to increase
    // towards one click and decrease towards the other. Refusing is the honest
    // answer, and it is the case worth refusing loudest - half such a figure
    // used to read correctly and half reflected, so it looks right wherever you
    // happen to check it.
    if (Math.sign(rho1) !== Math.sign(rho2)) return null;
    // With the direction agreed it comes OUT of the frame and is applied by the
    // reading, which is the only place that knows it lost the sign to `hypot`.
    const radialSign = Math.sign(rho1);
    const mag1 = Math.abs(rho1);
    const mag2 = Math.abs(rho2);

    // ⚑ The clockwise flag is applied HERE, to the canonical vectors, and is
    // then absorbed by the frame - which is the point: with two angles the sense
    // of rotation is in the clicks, so the figure cannot be contradicted by a
    // checkbox. The reading below undoes the same sign, so the flag still
    // round-trips through save and reopen.
    const sense = this.isClockwise ? -1 : 1;
    const u1x = mag1 * Math.cos(sense * theta1r);
    const u1y = mag1 * Math.sin(sense * theta1r);
    const u2x = mag2 * Math.cos(sense * theta2r);
    const u2y = mag2 * Math.sin(sense * theta2r);
    const cross = u1x * u2y - u1y * u2x;
    // ⚑⚑ NEARLY one ray is the same failure as exactly one ray, and `cross === 0`
    // caught only the second. `cross` is `mag1 mag2 sin(theta2 - theta1)`, so
    // testing it against zero (or any fixed epsilon) asks a question that carries
    // the figure's radial units; the angle itself does not. Measured on the walk
    // before this: two declared angles a hundredth of a degree apart calibrated,
    // and a figure whose own radii were 50 and 100 read 143,264 at a mid-figure
    // pixel.
    if (!Number.isFinite(cross) || sineBetween(u1x, u1y, u2x, u2y) < MIN_READABLE_SINE) return null;

    // Screen deltas of the two clicks. `M` maps canonical -> screen, so it
    // absorbs the y-axis flip along with the shear; nothing here needs to know
    // which way the image's y runs.
    const w1x = this.x1 - this.x0;
    const w1y = this.y1 - this.y0;
    const w2x = x2 - this.x0;
    const w2y = y2 - this.y0;

    const a = (w1x * u2y - w2x * u1y) / cross;
    const b = (w2x * u1x - w1x * u2x) / cross;
    const c = (w1y * u2y - w2y * u1y) / cross;
    const d = (w2y * u1x - w1y * u2x) / cross;
    const det = a * d - b * c;
    // A frame with no area maps the whole figure onto a line: every reading
    // would be non-finite while `calibrate()` reported success.
    // ⚑⚑ AND A FRAME WITH ALMOST NO AREA IS THE SAME FIGURE, read one pixel
    // differently. `det` is `|col1| |col2| sin(theta)` between the frame's two
    // screen directions, so a test against zero asks a question in pixels
    // squared: a figure drawn edge-on is refused only when it is EXACTLY
    // edge-on, and everything beside it calibrates and reads amplified nonsense.
    // Dividing by the two column lengths asks for the angle, which is what "no
    // area" always meant, and it is the same question `cross` above asks on the
    // other side of the map.
    if (!Number.isFinite(det) || sineBetween(a, c, b, d) < MIN_READABLE_SINE) return null;

    return { a, b, c, d, det, rho0, sense, radialSign };
  }

  /**
   * Does reading `(px, py)` give back the radial coordinate and angle that were
   * DECLARED there? Compared in the model's own working units - the radial
   * COORDINATE (log-scaled when the axis is) and radians - so the check does not
   * depend on the display units, and with a tolerance loose enough that ordinary
   * floating-point drift never refuses a good calibration.
   */
  private reproduces(px: number, py: number, rhoDeclared: number, thetaDeclared: number): boolean {
    const reading = this.pixelToData(px, py);
    const rRead = reading[0];
    const thRead = reading[1];
    if (rRead === undefined || thRead === undefined) return false;
    if (!Number.isFinite(rRead) || !Number.isFinite(thRead)) return false;
    const rhoRead = this.isLog ? Math.log(rRead) / Math.log(10) : rRead;
    if (!Number.isFinite(rhoRead)) return false;
    // Scale the radial tolerance to the figure's own span, so a figure measured
    // in millions is not held to a tolerance meant for one measured in tens.
    const span = Math.max(Math.abs(this.r1 - this.r2), Math.abs(rhoDeclared), 1);
    if (Math.abs(rhoRead - rhoDeclared) > 1e-6 * span) return false;
    // Angles compare modulo a full turn: the reading normalises into [0, 2pi)
    // and a declared angle need not be.
    const thReadR = this.isDegrees ? (thRead * Math.PI) / 180 : thRead;
    const TWO_PI = 2 * Math.PI;
    const diff = Math.abs(((thReadR - thetaDeclared) % TWO_PI + TWO_PI + Math.PI) % TWO_PI - Math.PI);
    return diff <= 1e-6;
  }

  isCalibrated(): boolean {
    return this._isCalibrated;
  }

  calibrate(
    calib: Calibration,
    is_degrees: boolean,
    is_clockwise: boolean,
    is_log_r: boolean,
    /** ⚑ Defaults to TRUE so every existing caller - and every project file
     *  written before the option existed - keeps the circular reading it had. */
    is_circular = true
  ): boolean {
    this.calibration = calib;
    this._isCalibrated = this.processCalibration(calib, is_degrees, is_clockwise, is_log_r, is_circular);
    return this._isCalibrated;
  }

  /** What the user declared the drawing to be. Round-trips through the project
   *  file like the other three flags. */
  isCircularPlot(): boolean {
    return this.isCircular;
  }

  isThetaDegrees(): boolean {
    return this.isDegrees;
  }

  isThetaClockwise(): boolean {
    return this.isClockwise;
  }

  isRadialLog(): boolean {
    return this.isLog;
  }

  pixelToData(pxi: number, pyi: number): number[] {
    const xp = parseFloat(String(pxi));
    const yp = parseFloat(String(pyi));

    const frame = this.frame;
    if (frame) {
      // ⚑ Undo the frame, then read r and θ in the undistorted plane. `hypot`
      // and `atan2` are the polar coordinates the figure was drawn FROM, which
      // is exactly what the circular reading assumes the screen already shows.
      const wx = xp - this.x0;
      const wy = yp - this.y0;
      const u = (frame.d * wx - frame.b * wy) / frame.det;
      const v = (-frame.c * wx + frame.a * wy) / frame.det;
      // `hypot` is unsigned; `radialSign` is the direction the calibration
      // agreed on, taken back out of the frame so it can be applied here.
      let rho = frame.radialSign * Math.hypot(u, v) + frame.rho0;
      if (this.isLog) rho = Math.pow(10, rho);
      let th = frame.sense * Math.atan2(v, u);
      if (th < 0) th = th + 2 * Math.PI;
      if (this.isDegrees === true) th = (180.0 * th) / Math.PI;
      return [rho, th];
    }

    let rp =
      ((this.r2 - this.r1) / this.dist12) *
        (Math.sqrt((xp - this.x0) * (xp - this.x0) + (yp - this.y0) * (yp - this.y0)) - this.dist10) +
      this.r1;

    let thetap = this.isClockwise
      ? this.alpha0 - taninverse(-(yp - this.y0), xp - this.x0)
      : taninverse(-(yp - this.y0), xp - this.x0) - this.alpha0;

    if (thetap < 0) {
      thetap = thetap + 2 * Math.PI;
    }

    if (this.isDegrees === true) {
      thetap = (180.0 * thetap) / Math.PI;
    }

    if (this.isLog) {
      rp = Math.pow(10, rp);
    }

    return [rp, thetap];
  }

  dataToPixel(_r: number, _theta: number): { x: number; y: number } {
    return { x: 0, y: 0 };
  }

  getMetadata(): AxesMetadata {
    return JSON.parse(JSON.stringify(this.metadata));
  }

  setMetadata(obj: AxesMetadata): void {
    this.metadata = JSON.parse(JSON.stringify(obj));
  }

  numCalibrationPointsRequired(): number {
    return 3;
  }

  getDimensions(): number {
    return 2;
  }

  getAxesLabels(): string[] {
    return ['r', 'θ'];
  }
}
