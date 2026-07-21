/**
 * Faithful TypeScript port of wpd-core's core/axes/image.js.
 * Original: WebPlotDigitizer, Copyright (C) 2025 Ankit Rohatgi, AGPL-3.0.
 * See ../mathFunctions.ts for porting-provenance notes.
 */

import type { Calibration } from '../calibration.js';
import type { AxesMetadata } from './types.js';

export class ImageAxes {
  calibration: Calibration | null = null;
  name = 'Image';
  private metadata: AxesMetadata = {};

  isCalibrated(): boolean {
    return true;
  }

  calibrate(): boolean {
    return true;
  }

  pixelToData(pxi: number, pyi: number): number[] {
    return [pxi, pyi];
  }

  dataToPixel(x: number, y: number): { x: number; y: number } {
    return { x, y };
  }

  pixelToLiveString(pxi: number, pyi: number): string {
    const dataVal = this.pixelToData(pxi, pyi);
    return dataVal[0]!.toFixed(2) + ', ' + dataVal[1]!.toFixed(2);
  }

  getMetadata(): AxesMetadata {
    return JSON.parse(JSON.stringify(this.metadata));
  }

  setMetadata(obj: AxesMetadata): void {
    this.metadata = JSON.parse(JSON.stringify(obj));
  }

  numCalibrationPointsRequired(): number {
    return 0;
  }

  getDimensions(): number {
    return 2;
  }

  getAxesLabels(): string[] {
    return ['X', 'Y'];
  }
}
