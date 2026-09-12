/**
 * Originally ported from wpd-core's core/axes/ternary.js.
 * Original: WebPlotDigitizer, Copyright (C) 2025 Ankit Rohatgi, AGPL-3.0.
 * See ../mathFunctions.ts for porting-provenance notes.
 *
 * ⚑⚑ ALL THREE CORNERS ARE READ (2026-09-10). Until then the third click was
 * collected from the user, stored, and never used: the reading assumed the
 * triangle was EQUILATERAL however the figure actually drew it.
 *
 * ⚠️ MEASURED, on a RIGHT-ANGLED ternary A(100,300) B(100,100) C(300,300) - a
 * real convention, and the shape three fixtures in this repo already used: the
 * old maths read the CLICKED corner C as `157.7350, 57.7350, -115.4701`. At the
 * very pixel the user clicked to say *"this corner is pure C"*, the tool
 * answered 157% of the first component and minus 115% of the third, with
 * nothing on screen wrong.
 *
 * ⚑⚑ THE FIX IS THE GENERAL MODEL, NOT A CORRECTION TO A SPECIAL ONE. A ternary
 * diagram's data is `a + b + c = constant`; its drawing is an affine image of
 * that simplex, i.e. ANY triangle. So a reading is the pixel's BARYCENTRIC
 * coordinate in the triangle that was clicked - `P = a·A + b·B + c·C` with
 * `a + b + c = 1` - and the equilateral case is one instance of it, not the
 * rule. David, settling it: *"USE all three corners and click in the math... it
 * needs to be done properly, like we have done for all our developed
 * calibrations instead."*
 *
 * ⚑ It is SMALLER than what it replaces: no `taninverse`, no `phi0`, no
 * `root3`, no polar detour. Two cross products and a subtraction (tenet 10).
 *
 * ⚑ AND IT REFUSES MORE. The old guard was `L > 0` - the A-to-B distance - so
 * three COLLINEAR corners calibrated happily and every pixel was read through an
 * equilateral triangle that was not on the figure. The determinant below is zero
 * for exactly the degenerate cases: coincident corners and collinear ones.
 *
 * ⚑ Tenets 5 and 8: we owe this lineage attribution, not its geometry.
 */

import type { Calibration } from '../calibration.js';
import type { AxesMetadata } from './types.js';

export class TernaryAxes {
  calibration: Calibration | null = null;
  name = 'Ternary';

  private _isCalibrated = false;
  private metadata: AxesMetadata = {};
  /** Corner A, the origin of the barycentric frame. */
  private ax = 0;
  private ay = 0;
  /** A→B and A→C, the two edge vectors that span the triangle. */
  private abx = 0;
  private aby = 0;
  private acx = 0;
  private acy = 0;
  /** Twice the signed area. Zero exactly when the triangle has none. */
  private det = 0;
  private isRange0to100 = false;
  /** The figure's own word for each corner, in the order they were clicked.
   *  Blank where the user did not name one. */
  private cornerNames: string[] = [];

  private processCalibration(cal: Calibration, range100: boolean): boolean {
    // ⚑ THREE, not two, and `numCalibrationPointsRequired()` has always said so.
    // The old count guard was `< 2` because two was all the maths dereferenced -
    // a guard measured against the implementation rather than against the type.
    if (cal.getCount() < 3) return false;
    const cp0 = cal.getPoint(0)!;
    const cp1 = cal.getPoint(1)!;
    const cp2 = cal.getPoint(2)!;

    this.ax = cp0.px;
    this.ay = cp0.py;
    this.abx = cp1.px - cp0.px;
    this.aby = cp1.py - cp0.py;
    this.acx = cp2.px - cp0.px;
    this.acy = cp2.py - cp0.py;
    this.det = this.abx * this.acy - this.aby * this.acx;

    // Every reading divides by this. It is zero for coincident corners AND for
    // three collinear ones - a triangle with no interior, where no pixel has a
    // decomposition. `Number.isFinite` catches a corner that arrived as NaN
    // from a hand-edited file; a non-finite determinant would otherwise make
    // every reading NaN while this still returned true.
    if (!Number.isFinite(this.det) || this.det === 0) return false;

    this.isRange0to100 = range100;
    // ⚑ The figure's own words, collected with the clicks exactly as a spider
    // spoke's name is. They are what tells the three components apart; "A" means
    // nothing against a diagram whose corners read Sand, Silt and Clay.
    this.cornerNames = [0, 1, 2].map((i) => String(cal.getPoint(i)?.dz ?? '').trim());

    return true;
  }

  isCalibrated(): boolean {
    return this._isCalibrated;
  }

  calibrate(calib: Calibration, range100: boolean): boolean {
    this.calibration = calib;
    this._isCalibrated = this.processCalibration(calib, range100);
    return this._isCalibrated;
  }

  isRange100(): boolean {
    return this.isRange0to100;
  }

  /** The figure's word for each corner, falling back to A/B/C where the user did
   *  not name one - a blank column header is unreadable output. */
  getCornerNames(): string[] {
    const fallback = ['A', 'B', 'C'];
    return fallback.map((f, i) => (this.cornerNames[i] ?? '') || f);
  }

  pixelToData(pxi: number, pyi: number): number[] {
    const xp = parseFloat(String(pxi));
    const yp = parseFloat(String(pyi));

    // ⚑ BARYCENTRIC, by Cramer's rule on `P - A = b·(B-A) + c·(C-A)`. `a` comes
    // from the closure rather than from a third solve, so the three components
    // sum to exactly 1 for every pixel - the defining property of a ternary
    // plot, held by construction instead of by arithmetic that happens to agree.
    const wx = xp - this.ax;
    const wy = yp - this.ay;
    let bp = (wx * this.acy - wy * this.acx) / this.det;
    let cp = (this.abx * wy - this.aby * wx) / this.det;
    let ap = 1.0 - bp - cp;

    if (this.isRange0to100 === true) {
      ap = ap * 100;
      bp = bp * 100;
      cp = cp * 100;
    }

    return [ap, bp, cp];
  }

  // `_c` is optional to match MapAxes' identical stub (map.ts:78) and upstream's
  // own `function(a, b, c)`, which JS lets you call with two arguments. Our port
  // had made this one required - a TypeScript artefact rather than a fact about
  // upstream, and one that stopped TernaryAxes satisfying the `dataToPixel`
  // requirement CalibratedAxes declares (checkpoint 79). Still the upstream stub:
  // it returns the origin, and callers must probe rather than trust it.
  dataToPixel(_a: number, _b: number, _c?: number): { x: number; y: number } {
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
    return 3;
  }

  getAxesLabels(): string[] {
    return this.getCornerNames();
  }
}
