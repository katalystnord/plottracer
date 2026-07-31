/**
 * TypeScript port of wpd-core's core/axes/bar.js.
 * Original: WebPlotDigitizer, Copyright (C) 2025 Ankit Rohatgi, AGPL-3.0.
 * See ../mathFunctions.ts for porting-provenance notes.
 *
 * ⚑ NO LONGER BYTE-FAITHFUL — two deliberate divergences from upstream.
 *
 * checkpoint 81: calibrate() validates its values and can now return false.
 * See the comment at the divergence. Upstream reports success on input
 * XYAxes refuses.
 *
 * v2.0 groundwork: dataToPixel() is now REAL, not upstream's unimplemented
 * stub (`return {x:0,y:0}`) — the exact algebraic inverse of pixelToData's
 * projection onto the calibrated line, restricted to that line (a 1-D axes
 * has nowhere else to invert to). Follows spider.ts's precedent exactly:
 * returns {NaN, NaN}, never {0,0}, wherever no pixel exists (uncalibrated,
 * non-positive value on a log scale, or a degenerate calibration where both
 * points were given the same value) — {0,0} is both a real image coordinate
 * and the stub's old sentinel, so returning it here would be silently
 * indistinguishable from "cannot invert."
 *
 * ⚠ This does NOT newly activate algorithms/errorCapture.ts's
 * `capFreeDirection` probe for Bar error caps: that function reads BOTH
 * elements of `pixelToData`'s return and early-returns null when the second
 * is `undefined` (`dx === undefined || dy === undefined`) — and Bar's
 * `pixelToData` returns a length-1 array, `[value]`, unchanged by this fix.
 * Bar error caps stay "unconstrained" (the documented safe default) until a
 * later v2.0 phase gives Bar a second, category-axis coordinate to return.
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
  // v2.0: a declared baseline, not a calibration value -- see setBaseline.
  private _hasBaseline = true;
  private _baselineValue = 0;

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
    // ⚑ v2.0 pre-launch audit: SpiderAxes.calibrate() has always refused these
    // two degenerate cases (centre === known value; non-positive on a log
    // axis) and BarAxes never got the same guards. Both left calibrate()
    // reporting success: identical values are a ZERO-SCALE calibration, so
    // every subsequent bar reads back as that one constant -- a silently
    // plausible wrong number, not a crash. A non-positive log endpoint sends
    // Math.log() to -Infinity/NaN, baked into p1/p2 with nothing on screen
    // wrong. Refusing here also feeds BAR_AXES_CONFIG.checkValues's mirrored
    // check on the file-load door -- see that config for why the same refusal
    // has to be declared twice.
    if (v1 === v2) return false;
    if (isLog && (!(v1 > 0) || !(v2 > 0))) return false;

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

  /**
   * Pixel position of `value` along the calibrated line — the inverse of
   * pixelToData's projection. `_unused` exists only to satisfy the shared
   * two-argument axes contract (`DataPixelMapping`/`CalibratedAxes`); Bar has
   * one real data value, not two. See the file header for why this returns
   * {NaN, NaN} rather than {0, 0} wherever it cannot invert.
   */
  dataToPixel(value: number, _unused?: number): { x: number; y: number } {
    if (!this._isCalibrated) return { x: NaN, y: NaN };
    let v = value;
    if (this.isLogScale) {
      if (!(v > 0)) return { x: NaN, y: NaN };
      v = Math.log(v) / Math.log(10);
    }
    const denom = this.p2 - this.p1;
    if (denom === 0) return { x: NaN, y: NaN };
    const t = (v - this.p1) / denom;
    return {
      x: this.x1 + t * (this.x2 - this.x1),
      y: this.y1 + t * (this.y2 - this.y1),
    };
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

  /**
   * Declares whether this series' bars share a common baseline, and what
   * value it sits at (v2.0). NOT a calibration value — nothing was clicked
   * for it — a visible, editable setting the user walks past at its default
   * (`true`/`0`, the ordinary zero-based bar chart) exactly the way pie's
   * total/sweep defaults work. Read by `BAR_AXES_CONFIG.derivedTupleValue`
   * to decide a captured bar's sign: with a baseline, sign comes from which
   * side of it the bar's far end lands on; without one (a floating/offset
   * bar — a tornado chart, a temperature range), there is no reference to
   * be signed against, so the recorded click ORDER carries the direction
   * instead.
   *
   * ⚑ Defensive at the MODEL, not just the click path (`BAR_AXES_CONFIG`
   * also has a `checkValues` refusal for the interactive door) — a
   * non-finite `value` is not stored, so a hand-edited project file cannot
   * put this axes into a state where every derived value reads NaN with no
   * visible reason.
   */
  setBaseline(has: boolean, value: number): void {
    this._hasBaseline = has;
    this._baselineValue = Number.isFinite(value) ? value : 0;
  }

  hasDeclaredBaseline(): boolean {
    return this._hasBaseline;
  }

  getBaselineValue(): number {
    return this._baselineValue;
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
    // ⚑ `Label` until v1.3 -- WPD's inherited word (`dataProviders.js` ->
    // ['Label','Value']). Renamed to `Category` on David's call (2026-07-26): the
    // on-screen table, the Box Plot tuple field and the categorical export all say
    // Category, so `Label` was the one surface using a different word for the same
    // thing -- the divergence checkpoint 92 exists to prevent.
    //
    // This IS a breaking header change for anything parsing a v1.0-v1.2 Bar export
    // BY COLUMN NAME (position and contents are unchanged, so index-based readers
    // are unaffected). Called out in the v1.3 release notes. The per-point `Bar<i>`
    // fallback for an unnamed bar is a different contract and is untouched.
    return ['Category', 'Y'];
  }
}
