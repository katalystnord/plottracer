/**
 * Faithful TypeScript port of wpd-core's core/axes/ternary.js.
 * Original: WebPlotDigitizer, Copyright (C) 2025 Ankit Rohatgi, AGPL-3.0.
 * See ../mathFunctions.ts for porting-provenance notes.
 */

import { taninverse } from '../mathFunctions.js';
import type { Calibration } from '../calibration.js';
import type { AxesMetadata } from './types.js';

export class TernaryAxes {
  calibration: Calibration | null = null;
  name = 'Ternary';

  private _isCalibrated = false;
  private metadata: AxesMetadata = {};
  private x0 = 0;
  private y0 = 0;
  private L = 0;
  private phi0 = 0;
  private root3 = 0;
  private isRange0to100 = false;
  private isOrientationNormal = true;

  private processCalibration(cal: Calibration, range100: boolean, is_normal: boolean): boolean {
    const cp0 = cal.getPoint(0)!;
    const cp1 = cal.getPoint(1)!;

    this.x0 = cp0.px;
    this.y0 = cp0.py;
    const x1 = cp1.px;
    const y1 = cp1.py;

    this.L = Math.sqrt((this.x0 - x1) * (this.x0 - x1) + (this.y0 - y1) * (this.y0 - y1));
    this.phi0 = taninverse(-(y1 - this.y0), x1 - this.x0);
    this.root3 = Math.sqrt(3);
    this.isRange0to100 = range100;
    this.isOrientationNormal = is_normal;

    return true;
  }

  isCalibrated(): boolean {
    return this._isCalibrated;
  }

  calibrate(calib: Calibration, range100: boolean, is_normal: boolean): boolean {
    this.calibration = calib;
    this._isCalibrated = this.processCalibration(calib, range100, is_normal);
    return this._isCalibrated;
  }

  isRange100(): boolean {
    return this.isRange0to100;
  }

  isNormalOrientation(): boolean {
    return this.isOrientationNormal;
  }

  pixelToData(pxi: number, pyi: number): number[] {
    const xp = parseFloat(String(pxi));
    const yp = parseFloat(String(pyi));

    const rp = Math.sqrt((xp - this.x0) * (xp - this.x0) + (yp - this.y0) * (yp - this.y0));
    const thetap = taninverse(-(yp - this.y0), xp - this.x0) - this.phi0;

    const xx = (rp * Math.cos(thetap)) / this.L;
    const yy = (rp * Math.sin(thetap)) / this.L;

    let ap = 1.0 - xx - yy / this.root3;
    let bp = xx - yy / this.root3;
    let cp = (2.0 * yy) / this.root3;

    if (this.isOrientationNormal === false) {
      const bpt = bp;
      bp = ap;
      ap = cp;
      cp = bpt;
    }

    if (this.isRange0to100 === true) {
      ap = ap * 100;
      bp = bp * 100;
      cp = cp * 100;
    }

    return [ap, bp, cp];
  }

  // `_c` is optional to match MapAxes' identical stub (map.ts:78) and upstream's
  // own `function(a, b, c)`, which JS lets you call with two arguments. Our port
  // had made this one required — a TypeScript artefact rather than a fact about
  // upstream, and one that stopped TernaryAxes satisfying the `dataToPixel`
  // requirement CalibratedAxes declares (checkpoint 79). Still the upstream stub:
  // it returns the origin, and callers must probe rather than trust it.
  dataToPixel(_a: number, _b: number, _c?: number): { x: number; y: number } {
    return { x: 0, y: 0 };
  }

  pixelToLiveString(pxi: number, pyi: number): string {
    const dataVal = this.pixelToData(pxi, pyi);
    return dataVal[0]!.toExponential(4) + ', ' + dataVal[1]!.toExponential(4) + ', ' + dataVal[2]!.toExponential(4);
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
    return ['a', 'b', 'c'];
  }
}
