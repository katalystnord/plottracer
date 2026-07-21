/**
 * TypeScript port of wpd-core's core/axes/bar.js.
 * Original: WebPlotDigitizer, Copyright (C) 2025 Ankit Rohatgi, AGPL-3.0.
 * See ../mathFunctions.ts for porting-provenance notes.
 *
 * NOTE (see CLAUDE.md "Product #1 — rebuild design"): dataToPixel() is
 * an unimplemented stub in the original — preserved as-is here, not
 * "fixed", since faithful-port is the goal for Step 1. This is exactly
 * why Curve Fit/Geometry (built earlier, on the current app) are XY-axes
 * only. **Its stubbed-ness is now load-bearing elsewhere and must not be
 * quietly "fixed" either**: algorithms/errorCapture.ts PROBES it and degrades
 * to "unconstrained" when it doesn't invert (checkpoint 79).
 *
 * ⚑ NO LONGER BYTE-FAITHFUL — one deliberate divergence, checkpoint 81:
 * calibrate() validates its values and can now return false. See the comment
 * at the divergence. Upstream reports success on input XYAxes refuses.
 */

import { taninverse } from '../mathFunctions.js';
import { InputParser } from '../inputParser.js';
import type { Calibration } from '../calibration.js';
import type { AxesMetadata } from './types.js';

export interface Orientation {
  axes: 'X' | 'Y';
  direction: 'increasing' | 'decreasing';
  angle: number;
}

export class BarAxes {
  calibration: Calibration | null = null;
  name = 'Bar';
  dataPointsHaveLabels = true;
  dataPointsLabelPrefix = 'Bar';

  private _isCalibrated = false;
  private isLogScale = false;
  private isRotatedAxes = false;
  private metadata: AxesMetadata = {};
  private x1 = 0;
  private y1 = 0;
  private x2 = 0;
  private y2 = 0;
  private p1 = 0;
  private p2 = 0;
  private orientation: Orientation = { axes: 'Y', direction: 'increasing', angle: 0 };

  isCalibrated(): boolean {
    return this._isCalibrated;
  }

  calibrate(calibration: Calibration, isLog: boolean, isRotated: boolean): boolean {
    this.calibration = calibration;
    this._isCalibrated = false;
    const cp1 = calibration.getPoint(0)!;
    const cp2 = calibration.getPoint(1)!;

    this.x1 = cp1.px;
    this.y1 = cp1.py;
    this.x2 = cp2.px;
    this.y2 = cp2.py;
    // ⚑ DIVERGENCE (checkpoint 81, finding A2). Upstream is
    // `p1 = parseFloat(cp1.dy)` with no validity check and an unconditional
    // `return true` at the end -- so BarAxes reported SUCCESS on input XYAxes
    // refuses. `"abc"` gave `p1 = NaN`, `calibrate()` returned true, and every
    // bar read back NaN with nothing on screen wrong. It also made
    // BAR_AXES_CONFIG.buildAxes's own error message ("Calibration failed --
    // check the entered data values are valid numbers",
    // engine/calibrationSession.ts) **dead code that could never fire**: the
    // message was written, wired, and unreachable.
    //
    // Routed through InputParser like XYAxes, which is where the whole-string
    // rule now lives (core/inputParser.ts's parseWholeNumber) -- so Bar gets
    // "1,000" -> refused for free, rather than needing its own copy of the rule.
    //
    // A DATE is refused explicitly, and the check is not redundant: a date
    // parses TO a number (its serial), so a `typeof === 'number'` test passes
    // it straight through and a bar's magnitude silently becomes a julian day
    // count. BarAxes has no date concept to honour one with, so the honest
    // answer is to refuse rather than to invent a magnitude. (Caught by its own
    // test after the first draft's comment claimed a refusal the code did not
    // make.) An array is refused by the same typeof check.
    const ip = new InputParser();
    const v1 = ip.parse(cp1.dy);
    if (!ip.isValid || ip.isDate || typeof v1 !== 'number') return false;
    const v2 = ip.parse(cp2.dy);
    if (!ip.isValid || ip.isDate || typeof v2 !== 'number') return false;
    this.p1 = v1;
    this.p2 = v2;

    if (isLog) {
      this.isLogScale = true;
      this.p1 = Math.log(this.p1) / Math.log(10);
      this.p2 = Math.log(this.p2) / Math.log(10);
    } else {
      this.isLogScale = false;
    }

    this.orientation = this.calculateOrientation();
    this.isRotatedAxes = isRotated;

    if (!isRotated) {
      if (this.orientation.axes === 'Y') {
        this.x2 = this.x1;
      } else {
        this.y2 = this.y1;
      }
      this.orientation = this.calculateOrientation();
    }

    this._isCalibrated = true;
    return true;
  }

  pixelToData(pxi: number, pyi: number): number[] {
    const c_c2 =
      ((pyi - this.y1) * (this.y2 - this.y1) + (this.x2 - this.x1) * (pxi - this.x1)) /
      ((this.y2 - this.y1) * (this.y2 - this.y1) + (this.x2 - this.x1) * (this.x2 - this.x1));
    let value = (this.p2 - this.p1) * c_c2 + this.p1;
    if (this.isLogScale) {
      value = Math.pow(10, value);
    }
    return [value];
  }

  dataToPixel(_x: number, _y: number): { x: number; y: number } {
    // not implemented yet — matches the original exactly
    return { x: 0, y: 0 };
  }

  pixelToLiveString(pxi: number, pyi: number): string {
    const dataVal = this.pixelToData(pxi, pyi);
    return dataVal[0]!.toExponential(4);
  }

  isLog(): boolean {
    return this.isLogScale;
  }

  isRotated(): boolean {
    return this.isRotatedAxes;
  }

  calculateOrientation(): Orientation {
    const orientationAngle = (taninverse(-(this.y2 - this.y1), this.x2 - this.x1) * 180) / Math.PI;
    const orientation: Orientation = { axes: 'Y', direction: 'increasing', angle: orientationAngle };
    const tol = 30;

    if (Math.abs(orientationAngle - 90) < tol) {
      orientation.axes = 'Y';
      orientation.direction = 'increasing';
    } else if (Math.abs(orientationAngle - 270) < tol) {
      orientation.axes = 'Y';
      orientation.direction = 'decreasing';
    } else if (Math.abs(orientationAngle - 0) < tol || Math.abs(orientationAngle - 360) < tol) {
      orientation.axes = 'X';
      orientation.direction = 'increasing';
    } else if (Math.abs(orientationAngle - 180) < tol) {
      orientation.axes = 'X';
      orientation.direction = 'decreasing';
    }

    return orientation;
  }

  getOrientation(): Orientation {
    return this.orientation;
  }

  getMetadata(): AxesMetadata {
    return JSON.parse(JSON.stringify(this.metadata));
  }

  setMetadata(obj: AxesMetadata): void {
    this.metadata = JSON.parse(JSON.stringify(obj));
  }

  numCalibrationPointsRequired(): number {
    return 2;
  }

  getDimensions(): number {
    return 2;
  }

  getAxesLabels(): string[] {
    return ['Label', 'Y'];
  }
}
