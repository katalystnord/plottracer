import { describe, expect, it } from 'vitest';
import { MapAxes } from '../axes/map.js';
import { Calibration } from '../calibration.js';

/**
 * Map calibration — a scale bar, not a pair of axes.
 *
 * ⚑ WHY THIS FILE EXISTS. `core/axes/map.ts` is a faithful port of wpd-core's
 * `core/axes/map.js`, scored 43.55% by mutation testing with 26 mutants no test
 * reaches, and had no test of its own. WPD's `tests/map_axes_tests.js` covers it
 * with 8 assertions and our `calibrate` signature is identical to theirs, so the
 * cases port directly.
 *
 * ADAPTED FROM WebPlotDigitizer's `tests/map_axes_tests.js` (Copyright (C) 2025
 * Ankit Rohatgi, AGPL-3.0 — the same licence as this project).
 *
 * The calibration throughout: two points 10px apart vertically, declared to span
 * 100 m. So the scale is 10 m per pixel, and every expected number below is
 * hand-derivable from that.
 */

/** Two calibration points 10px apart, declared as `length` units. */
function calibrated(
  length: string,
  origin: 'top-left' | 'bottom-left',
  imageHeight: number
): MapAxes {
  const calib = new Calibration(2);
  calib.addPoint(10, 10, '', '');
  calib.addPoint(10, 20, '', '');
  const axes = new MapAxes();
  expect(axes.calibrate(calib, length, 'm', origin, imageHeight), 'calibration should succeed').toBe(true);
  return axes;
}

describe('MapAxes — top-left origin (WPD)', () => {
  const axes = calibrated('100', 'top-left', 500);

  it('reads a pixel straight down the scale, y increasing downwards', () => {
    const data = axes.pixelToData(0, 10);
    expect(data[0]).toBe(0);
    expect(data[1]).toBe(100);
  });

  it('converts a distance by the scale', () => {
    // 20px at 10 m/px.
    expect(axes.pixelToDataDistance(20)).toBe(200);
  });

  it('converts an area by the scale SQUARED', () => {
    // ⚑ The one worth having: area scales with the square, so 20px² is 2000 m²,
    // not 200. A mutant that reuses the linear factor survives the distance
    // assertion above and dies here.
    expect(axes.pixelToDataArea(20)).toBe(2000);
  });
});

describe('MapAxes — bottom-left origin (WPD)', () => {
  const axes = calibrated('100', 'bottom-left', 500);

  it('flips y against the image height', () => {
    // ⚑ The non-obvious number, and the reason to keep WPD's exact fixture:
    // (500 - 10 - 1) * 10 = 4890. The `- 1` is the off-by-one that makes the
    // bottom row of pixels y = 0 rather than y = 10, and it is precisely the
    // kind of thing a mutant flips silently.
    const data = axes.pixelToData(0, 10);
    expect(data[0]).toBe(0);
    expect(data[1]).toBe(4890);
  });

  it('leaves distance and area unaffected by the origin choice', () => {
    // Origin decides where zero is; it does not change the scale.
    expect(axes.pixelToDataDistance(20)).toBe(200);
    expect(axes.pixelToDataArea(20)).toBe(2000);
  });
});

describe('MapAxes — what it does NOT provide', () => {
  it('has no dataToPixel: the port ships WPD\'s unimplemented stub', () => {
    // Stated rather than left to be discovered. A map calibration is a scale
    // bar, so there is no inverse mapping to a unique pixel — the same reason
    // Bar ships an unimplemented dataToPixel. Asserted so that if someone ever
    // implements it, this test fails and forces the decision to be deliberate.
    const axes = calibrated('100', 'top-left', 500);
    expect(axes.dataToPixel(100, 100)).toEqual({ x: 0, y: 0 });
  });
});
