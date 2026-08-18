import { describe, expect, it } from 'vitest';
import { MapAxes } from '../axes/map.js';
import { Calibration } from '../calibration.js';

/**
 * Map calibration - a scale bar, not a pair of axes.
 *
 * ⚑ WHY THIS FILE EXISTS. `core/axes/map.ts` is a faithful port of wpd-core's
 * `core/axes/map.js`, scored 43.55% by mutation testing with 26 mutants no test
 * reaches, and had no test of its own. WPD's `tests/map_axes_tests.js` covers it
 * with 8 assertions and our `calibrate` signature is identical to theirs, so the
 * cases port directly.
 *
 * ADAPTED FROM WebPlotDigitizer's `tests/map_axes_tests.js` (Copyright (C) 2025
 * Ankit Rohatgi, AGPL-3.0 - the same licence as this project).
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

describe('MapAxes - top-left origin (WPD)', () => {
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

describe('MapAxes - bottom-left origin (WPD)', () => {
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

describe('MapAxes - what it does NOT provide', () => {
  it('has no dataToPixel: the port ships WPD\'s unimplemented stub', () => {
    // Stated rather than left to be discovered. A map calibration is a scale
    // bar, so there is no inverse mapping to a unique pixel - the same reason
    // Bar ships an unimplemented dataToPixel. Asserted so that if someone ever
    // implements it, this test fails and forces the decision to be deliberate.
    const axes = calibrated('100', 'top-left', 500);
    expect(axes.dataToPixel(100, 100)).toEqual({ x: 0, y: 0 });
  });
});

describe('MapAxes.calibrate refuses too few calibration points (v2.0 audit)', () => {
  it('refuses rather than indexing an out-of-range getPoint() into a crash', () => {
    // A hand-edited or corrupted file with fewer than 2 points for a Map
    // axes used to hit `cal.getPoint(1)!` with nothing there, throwing a raw
    // TypeError deep inside core/ (masked in practice only because
    // PlotData.deserialize wraps the call in a blanket try/catch).
    const calib = new Calibration(2);
    calib.addPoint(10, 10, '', '');
    const axes = new MapAxes();
    expect(axes.calibrate(calib, '100', 'm', 'top-left', 500)).toBe(false);
    expect(axes.isCalibrated()).toBe(false);
  });

  it('refuses zero points too', () => {
    const axes = new MapAxes();
    expect(axes.calibrate(new Calibration(2), '100', 'm', 'top-left', 500)).toBe(false);
  });
});

/**
 * ⚑ A SCALE THAT MEASURES NOTHING - refused, rather than reported as success.
 *
 * `processCalibration` divided by `dist` (the pixel length of the reference
 * line) and multiplied by `scaleLength` (its real-world length), and returned
 * true whatever those were. MAP_AXES_CONFIG.buildAxes even carries
 * `if (!ok) return { error: 'Calibration failed - ...' }` - a refusal that
 * could never fire, which is the "a check that did not run looks exactly like
 * a check that passed" shape.
 *
 * The reachable case is not exotic. A user drawing a scale bar and typing 0
 * for its length got a calibration that reported success, showed no error, and
 * made EVERY distance and area read exactly 0 - a silently wrong number on the
 * primary path, with nothing on screen to question. A non-numeric entry read
 * null instead; coincident endpoints likewise.
 */
describe('a reference line that cannot set a scale is refused', () => {
  function tryScale(p1: [number, number], p2: [number, number], length: number | string) {
    const cal = new Calibration(2);
    cal.addPoint(p1[0], p1[1], '0', '0');
    cal.addPoint(p2[0], p2[1], '0', '0');
    const axes = new MapAxes();
    return { ok: axes.calibrate(cal, length, 'mm', 'top-left', 500), axes };
  }

  it('⚑ refuses a reference length of ZERO, which made every measurement read 0', () => {
    expect(tryScale([100, 100], [300, 100], 0).ok).toBe(false);
    expect(tryScale([100, 100], [300, 100], '0').ok).toBe(false);
  });

  it('refuses a negative reference length, which has no meaning as a distance', () => {
    expect(tryScale([100, 100], [300, 100], -5).ok).toBe(false);
  });

  it('refuses a reference length that is not a number at all', () => {
    expect(tryScale([100, 100], [300, 100], 'abc').ok).toBe(false);
    expect(tryScale([100, 100], [300, 100], '').ok).toBe(false);
  });

  it('⚑ refuses COINCIDENT endpoints, which divide by a zero pixel distance', () => {
    // The click path keeps the two apart (distinctPixelSteps), but a loaded
    // project calls calibrate() directly.
    expect(tryScale([100, 100], [100, 100], 10).ok).toBe(false);
  });

  it('accepts an ordinary scale and reads through it', () => {
    const { ok, axes } = tryScale([100, 100], [300, 100], 10);
    expect(ok).toBe(true);
    // 200px is 10mm, so 400px along x is 20mm.
    expect(axes.pixelToData(400, 0)[0]).toBeCloseTo(20, 9);
  });

  it('accepts a fractional length, which a scale bar often has', () => {
    expect(tryScale([100, 100], [300, 100], '2.5').ok).toBe(true);
  });

  it('a refused calibration reports itself uncalibrated', () => {
    const { axes } = tryScale([100, 100], [300, 100], 0);
    expect(axes.isCalibrated()).toBe(false);
  });
});

/**
 * ⚑ THE SCALE LENGTH GOES THROUGH InputParser - round-2 audit.
 *
 * It was the last calibration value in the app still using `parseFloat` - a
 * PREFIX parser. `core/inputParser.ts`'s own doc-table records what that
 * costs: `"1,000"` became `1`, i.e. *"Every value 1000x wrong"*, and `"5 kg"`
 * became `5`. The app-wide fix was to parse the WHOLE string with `Number()`
 * and refuse anything that is not entirely a number; map's scale length never
 * got it, so it kept the prefix behaviour on the primary map path, reachable
 * by typing.
 *
 * Refusing is the right answer, not silently interpreting: a length the user
 * wrote with a separator is a length the app should ask them to re-enter, not
 * one it should guess at.
 */
describe('the reference length is parsed the way every other value is', () => {
  function readX(length: string): number | null {
    const cal = new Calibration(2);
    cal.addPoint(100, 100, '0', '0');
    cal.addPoint(300, 100, '0', '0'); // 200 px
    const axes = new MapAxes();
    if (!axes.calibrate(cal, length, 'm', 'top-left', 500)) return null;
    return axes.pixelToData(400, 0)[0]!; // 400 px = 2x the reference
  }

  it('⚑ REFUSES a thousands separator rather than reading its first group', () => {
    // The defect: `parseFloat("1,000")` is 1, so a scale bar labelled 1,000 m
    // calibrated at 1 m and every distance came out 1000x too small, silently.
    // Now refused, exactly as the same input is refused on every other axis.
    expect(readX('1,000')).toBeNull();
  });

  it('⚑ REFUSES a unit suffix, which parseFloat would have swallowed', () => {
    expect(readX('5 km')).toBeNull();
    expect(readX('5%')).toBeNull();
  });

  it('accepts scientific notation, which IS entirely a number', () => {
    expect(readX('1e3')).toBeCloseTo(2000, 6);
  });

  it('reads a plain number unchanged', () => {
    expect(readX('10')).toBeCloseTo(20, 6);
  });

  it('reads a decimal unchanged', () => {
    expect(readX('2.5')).toBeCloseTo(5, 6);
  });

  it('still refuses what it refused before - zero, negative, empty, non-numeric', () => {
    expect(readX('0')).toBeNull();
    expect(readX('-5')).toBeNull();
    expect(readX('')).toBeNull();
    expect(readX('abc')).toBeNull();
  });

  it('⚑ refuses a DATE, which is not a length however well it parses', () => {
    expect(readX('2024/01/01')).toBeNull();
  });
});
