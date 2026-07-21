/**
 * Faithful TypeScript port of wpd-core's core/axes/map.js.
 * Original: WebPlotDigitizer, Copyright (C) 2025 Ankit Rohatgi, AGPL-3.0.
 * See ../mathFunctions.ts for porting-provenance notes.
 */

import type { Calibration } from '../calibration.js';
import type { AxesMetadata } from './types.js';

export type OriginLocation = 'top-left' | 'bottom-left';

export class MapAxes {
  calibration: Calibration | null = null;
  name = 'Map';

  private _isCalibrated = false;
  private metadata: AxesMetadata = {};
  private scaleLength = 0;
  private scaleUnits: string | undefined;
  private dist = 0;
  private originLocation: OriginLocation = 'top-left';
  private imageHeight = 0;

  private processCalibration(
    cal: Calibration,
    scale_length: number | string,
    scale_units: string | undefined,
    origin_location: OriginLocation | null | undefined,
    image_height: number | string
  ): boolean {
    const cp0 = cal.getPoint(0)!;
    const cp1 = cal.getPoint(1)!;
    this.dist = Math.sqrt(
      (cp0.px - cp1.px) * (cp0.px - cp1.px) + (cp0.py - cp1.py) * (cp0.py - cp1.py)
    );
    this.scaleLength = parseFloat(String(scale_length));
    this.scaleUnits = scale_units;
    this.originLocation = origin_location != null ? origin_location : 'top-left';
    this.imageHeight = parseFloat(String(image_height));
    return true;
  }

  isCalibrated(): boolean {
    return this._isCalibrated;
  }

  calibrate(
    calib: Calibration,
    scale_length: number | string,
    scale_units: string | undefined,
    origin_location: OriginLocation | null | undefined,
    image_height: number | string
  ): boolean {
    this.calibration = calib;
    this._isCalibrated = this.processCalibration(calib, scale_length, scale_units, origin_location, image_height);
    return this._isCalibrated;
  }

  pixelToData(pxi: number, pyi: number): number[] {
    const data: number[] = [];
    data[0] = (pxi * this.scaleLength) / this.dist;
    if (this.originLocation === 'top-left') {
      data[1] = (pyi * this.scaleLength) / this.dist;
    } else if (this.originLocation === 'bottom-left') {
      data[1] = ((this.imageHeight - pyi - 1) * this.scaleLength) / this.dist;
    }
    return data;
  }

  pixelToDataDistance(distancePx: number): number {
    return (distancePx * this.scaleLength) / this.dist;
  }

  pixelToDataArea(areaPx: number): number {
    return (areaPx * this.scaleLength * this.scaleLength) / (this.dist * this.dist);
  }

  dataToPixel(_a: number, _b: number, _c?: number): { x: number; y: number } {
    return { x: 0, y: 0 };
  }

  pixelToLiveString(pxi: number, pyi: number): string {
    const dataVal = this.pixelToData(pxi, pyi);
    return dataVal[0]!.toExponential(4) + ', ' + dataVal[1]!.toExponential(4);
  }

  getScaleLength(): number {
    return this.scaleLength;
  }

  getUnits(): string | undefined {
    return this.scaleUnits;
  }

  getOriginLocation(): OriginLocation {
    return this.originLocation;
  }

  getImageHeight(): number {
    return this.imageHeight;
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
    return ['X', 'Y'];
  }
}
