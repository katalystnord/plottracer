/**
 * TypeScript port of wpd-core's core/axes/circularChartRecorder.js.
 * Original: WebPlotDigitizer, Copyright (C) 2025 Ankit Rohatgi, AGPL-3.0.
 * See ../mathFunctions.ts for porting-provenance notes.
 *
 * ⚑ NO LONGER BYTE-FAITHFUL -- one deliberate divergence, found by the v2.0
 * pre-launch code review. Upstream reads R0/R2 with a bare `Number()`, never
 * checks `InputParser.isValid` for the time fields, and ends with an
 * unconditional `return true` -- the same checkpoint-81 defect class already
 * fixed on XY/Bar/Ternary/Map, just never ported to this class. `"abc"` for
 * R0 gave `NaN`, and a blank Chart Start Time silently became the Unix epoch
 * via `new Date(null)`, both with calibrate() reporting success and nothing
 * on screen wrong. `isCalibrated()` was also hardcoded `return false` always,
 * independent of whether calibrate() had even been called.
 */

import { taninverse, dist2d, normalizeAngleDeg, getCircleFrom3Pts } from '../mathFunctions.js';
import { InputParser } from '../inputParser.js';
import * as dateConverter from '../dateConversion.js';
import type { Calibration } from '../calibration.js';
import type { AxesMetadata } from './types.js';

export type RotationDirection = 'anticlockwise' | 'clockwise';
export type RotationTime = 'week' | 'day';

export class CircularChartRecorderAxes {
  calibration: Calibration | null = null;
  name = 'Circular Chart';
  private _metadata: AxesMetadata = {};

  xChart = 0;
  yChart = 0;
  xPen = 0;
  yPen = 0;
  rPen = 0;
  rMax = 0;
  rMin = 0;
  rMinPx = 0;
  rMaxPx = 0;
  chartToPenDist = 0;
  thetac0 = 0;
  thetaStartOffset = 0;
  timeFormat: string | null = null;
  time0 = 0;
  timeMax = 0;
  tStart: number | null = null;
  tEnd: number | null = null;
  rotationDirection: RotationDirection = 'anticlockwise';
  rotationTime: RotationTime = 'week';

  private _isCalibrated = false;

  isCalibrated(): boolean {
    return this._isCalibrated;
  }

  calibrate(calib: Calibration, startTimeInput: string, rotationTime: RotationTime, rotationDirection: RotationDirection): boolean {
    this._isCalibrated = false;
    const cp0 = calib.getPoint(0)!;
    const cp1 = calib.getPoint(1)!;
    const cp2 = calib.getPoint(2)!;
    const cp3 = calib.getPoint(3)!;
    const cp4 = calib.getPoint(4)!;

    const ip = new InputParser();
    const t0 = cp0.dx;
    const time0 = ip.parse(t0);
    if (!ip.isValid || typeof time0 !== 'number') return false;
    this.time0 = time0;
    if (ip.isDate) {
      this.timeFormat = ip.formatting;
    }
    const date0 = new Date(this.time0);
    const tStart = ip.parse(startTimeInput);
    if (!ip.isValid || typeof tStart !== 'number') return false;
    this.tStart = tStart;
    const dateEnd = new Date(this.tStart);

    if (rotationTime === 'week') {
      this.timeMax = parseFloat(String(date0.setDate(date0.getDate() + 7)));
      this.tEnd = parseFloat(String(dateEnd.setDate(dateEnd.getDate() + 7)));
    } else if (rotationTime === 'day') {
      this.timeMax = parseFloat(String(date0.setHours(date0.getHours() + 24)));
      this.tEnd = parseFloat(String(dateEnd.setHours(dateEnd.getHours() + 24)));
    }

    const r0Parsed = ip.parse(cp0.dy);
    if (!ip.isValid || ip.isDate || typeof r0Parsed !== 'number') return false;
    const r2Parsed = ip.parse(cp2.dy);
    if (!ip.isValid || ip.isDate || typeof r2Parsed !== 'number') return false;
    const r0 = r0Parsed;
    const r2 = r2Parsed;

    const penArcPts: [[number, number], [number, number], [number, number]] = [
      [cp0.px, cp0.py],
      [cp1.px, cp1.py],
      [cp2.px, cp2.py],
    ];
    const penCircle = getCircleFrom3Pts(penArcPts);

    const chartArcPts: [[number, number], [number, number], [number, number]] = [
      [cp2.px, cp2.py],
      [cp3.px, cp3.py],
      [cp4.px, cp4.py],
    ];
    const chartCircle = getCircleFrom3Pts(chartArcPts);

    this.thetac0 =
      (taninverse(penCircle.y0 - chartCircle.y0, penCircle.x0 - chartCircle.x0) * 180.0) / Math.PI;

    this.thetaStartOffset = (360.0 * (this.tStart - this.time0)) / (this.timeMax - this.time0);

    this.xChart = chartCircle.x0;
    this.yChart = chartCircle.y0;
    this.xPen = penCircle.x0;
    this.yPen = penCircle.y0;
    this.rPen = penCircle.radius;
    this.rMin = r0;
    this.rMax = r2;
    this.rMinPx = dist2d(cp0.px, cp0.py, chartCircle.x0, chartCircle.y0);
    this.rMaxPx = dist2d(cp2.px, cp2.py, chartCircle.x0, chartCircle.y0);
    this.chartToPenDist = dist2d(chartCircle.x0, chartCircle.y0, penCircle.x0, penCircle.y0);
    this.rotationDirection = rotationDirection;
    this.rotationTime = rotationTime;
    this.calibration = calib;

    this._isCalibrated = true;
    return true;
  }

  pixelToData(pxi: number, pyi: number): number[] {
    const rPx = dist2d(pxi, pyi, this.xChart, this.yChart);
    const r = ((this.rMax - this.rMin) * (rPx - this.rMinPx)) / (this.rMaxPx - this.rMinPx) + this.rMin;

    const thetap = taninverse(pyi - this.yChart, pxi - this.xChart);
    const alpha = Math.acos(
      (this.chartToPenDist * this.chartToPenDist + rPx * rPx - this.rPen * this.rPen) /
        (2.0 * this.chartToPenDist * rPx)
    );
    let timeVal = 0;
    if (this.rotationDirection === 'anticlockwise') {
      const thetac = thetap + alpha;
      const thetacDeg = normalizeAngleDeg((thetac * 180.0) / Math.PI);
      timeVal =
        ((this.tEnd! - this.tStart!) * normalizeAngleDeg(thetacDeg - this.thetac0 - this.thetaStartOffset)) / 360.0 +
        this.tStart!;
    } else if (this.rotationDirection === 'clockwise') {
      const thetac = thetap - alpha;
      const thetacDeg = normalizeAngleDeg((thetac * 180.0) / Math.PI);
      timeVal =
        ((this.tEnd! - this.tStart!) * normalizeAngleDeg(-(thetacDeg - this.thetac0) - this.thetaStartOffset)) /
          360.0 +
        this.tStart!;
    }

    return [timeVal, r];
  }

  dataToPixel(_t: number, _r: number): { x: number; y: number } {
    return { x: 0, y: 0 };
  }

  pixelToLiveString(pxi: number, pyi: number): string {
    const dataVal = this.pixelToData(pxi, pyi);
    if (this.timeFormat == null) {
      return 'calibration error!';
    }
    const timeStr = dateConverter.formatDateNumber(dataVal[0]!, this.timeFormat);
    return timeStr + ', ' + dataVal[1]!.toExponential(4);
  }

  getStartTime(): string | null {
    if (this.timeFormat == null || this.tStart == null) {
      return null;
    }
    return dateConverter.formatDateNumber(this.tStart, this.timeFormat);
  }

  getRotationTime(): RotationTime {
    return this.rotationTime;
  }

  getRotationDirection(): RotationDirection {
    return this.rotationDirection;
  }

  getTimeFormat(): string | null {
    return this.timeFormat;
  }

  getInitialDateFormat(col: number): string | null {
    return col === 0 ? this.timeFormat : null;
  }

  isDate(col: number): boolean {
    return col === 0;
  }

  getMetadata(): AxesMetadata {
    return JSON.parse(JSON.stringify(this._metadata));
  }

  setMetadata(obj: AxesMetadata): void {
    this._metadata = JSON.parse(JSON.stringify(obj));
  }

  numCalibrationPointsRequired(): number {
    return 5;
  }

  getDimensions(): number {
    return 2;
  }

  getAxesLabels(): string[] {
    return ['Time', 'Magnitude'];
  }
}
