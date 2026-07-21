import type { Calibration } from '../calibration.js';

export type AxesMetadata = Record<string, unknown>;

/**
 * Common shape shared by all 7 axes types. `calibrate`/`dataToPixel`
 * signatures vary per concrete type (see each axes/*.ts file) — this is
 * intentionally loose rather than forcing an exact shared signature,
 * matching how the original wpd-core axes classes were never actually
 * unified under one JS interface either.
 */
export interface Axes {
  calibration: Calibration | null;
  isCalibrated(): boolean;
  pixelToData(px: number, py: number): number[];
  pixelToLiveString(px: number, py: number): string;
  getMetadata(): AxesMetadata;
  setMetadata(obj: AxesMetadata): void;
  name: string;
}

export interface AxesStatic {
  numCalibrationPointsRequired(): number;
  getDimensions(): number;
  getAxesLabels(): string[];
}
