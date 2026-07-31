/**
 * TypeScript port of wpd-core's core/axes/polar.js.
 * Original: WebPlotDigitizer, Copyright (C) 2025 Ankit Rohatgi, AGPL-3.0.
 * See ../mathFunctions.ts for porting-provenance notes.
 *
 * ⚑ NO LONGER BYTE-FAITHFUL -- one deliberate divergence, found by the v2.0
 * pre-launch code review. Upstream reads r1/theta1/r2/theta2 with a bare
 * `Number()` and processCalibration always returns true -- the checkpoint-81
 * defect class, never ported here. `"abc"` for a radius gave `NaN`, baked
 * into every subsequent reading, with calibrate() reporting success and
 * nothing on screen wrong.
 */

import { taninverse } from '../mathFunctions.js';
import { InputParser } from '../inputParser.js';
import type { Calibration } from '../calibration.js';
import type { AxesMetadata } from './types.js';

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

  private processCalibration(cal: Calibration, is_degrees: boolean, is_clockwise: boolean, is_log_r: boolean): boolean {
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
    this.r1 = r1Parsed;
    this.theta1 = theta1Parsed;
    this.r2 = r2Parsed;
    // theta2 is NOT gated like the three values above: POLAR_AXES_CONFIG's own
    // config declares it optional and defaults a blank one to '0', because it
    // is a dead computation (see _theta2r below) that no reading ever uses --
    // refusing calibration over an invalid-but-inert value would be
    // interpretation this field was never meant to carry. `Number()` (not
    // InputParser) matches upstream faithfully for exactly this one field.
    const theta2 = Number(cp2.dy);

    this.isDegrees = is_degrees;
    this.isClockwise = is_clockwise;

    let theta1 = this.theta1;
    // _theta2r mirrors the original's dead computation faithfully (point 2
    // only ever contributes r2 to calibration, never its angle) -- see this
    // file's header comment on faithful-port scope.
    let _theta2r = theta2;
    if (this.isDegrees === true) {
      theta1 = (Math.PI / 180.0) * this.theta1;
      _theta2r = (Math.PI / 180.0) * theta2;
    }
    this.theta1 = theta1;

    let r1 = this.r1;
    let r2 = this.r2;
    if (is_log_r) {
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

    return true;
  }

  isCalibrated(): boolean {
    return this._isCalibrated;
  }

  calibrate(calib: Calibration, is_degrees: boolean, is_clockwise: boolean, is_log_r: boolean): boolean {
    this.calibration = calib;
    this._isCalibrated = this.processCalibration(calib, is_degrees, is_clockwise, is_log_r);
    return this._isCalibrated;
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

  pixelToLiveString(pxi: number, pyi: number): string {
    const dataVal = this.pixelToData(pxi, pyi);
    return dataVal[0]!.toExponential(4) + ', ' + dataVal[1]!.toExponential(4);
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
