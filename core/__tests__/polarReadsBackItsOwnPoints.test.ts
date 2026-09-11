import { describe, expect, it } from 'vitest';
import { PolarAxes } from '../axes/polar.js';
import { Calibration } from '../calibration.js';

/**
 * ⚑⚑⚑ A MODEL THAT CANNOT READ BACK ITS OWN CALIBRATION POINTS IS WRONG, AND
 * THAT IS THE WHOLE CHECK.
 *
 * `Math.hypot` is unsigned, so a measured polar frame threw away the SIGN of the
 * radial direction. Where the declared radii sit below the centre value the
 * frame absorbed a global flip that the reading could not undo, and every radius
 * came back reflected about the centre with its angle 180 degrees out. The
 * calibration reported success and nothing on screen disagreed.
 *
 * Two ordinary figures reach it:
 *
 *  - a radial axis that DECREASES outward - elevation on a sky chart, depth,
 *    pressure - where every declared radius is below the centre value;
 *  - a mistyped centre value landing BETWEEN the two declared radii, where half
 *    the figure flips and the other half does not.
 *
 * On a log radial axis the flip is multiplicative: declared 100 and 1 about a
 * centre of 1000 read back as 10,000 and 1,000,000.
 *
 * ⚠️ WHY NOTHING SAW IT. Every polar fixture in the suite is increasing outward
 * with `centre <= r1 < r2`. The cheap instrument was already named in
 * polarAxes.test.ts - "reproduces its own two calibration points, as any
 * calibration must" - and had simply never been run on a decreasing or
 * straddling axis. So the fix is not only the sign: `processCalibration` now
 * performs that check itself, which refuses this whole CLASS rather than this
 * one instance.
 */
describe('a measured polar frame reproduces the points it was built from', () => {
  /** origin (300,300), P1 right at 200px, P2 up at 150px - a squashed figure,
   *  so the measured frame is the right reading rather than the circular one. */
  function calibrationWith(centre: string, r1: string, r2: string): Calibration {
    const cal = new Calibration(3);
    cal.addPoint(300, 300, centre, '');
    cal.addPoint(500, 300, r1, '0');
    cal.addPoint(300, 150, r2, '90');
    return cal;
  }

  const read = (ax: PolarAxes, px: number, py: number) => ax.pixelToData(px, py);

  it('⚑ an ordinary increasing axis still reads its own points (the control)', () => {
    const ax = new PolarAxes();
    expect(ax.calibrate(calibrationWith('2', '10', '20'), true, false, false, false)).toBe(true);
    expect(read(ax, 500, 300)[0]).toBeCloseTo(10, 9);
    expect(read(ax, 500, 300)[1]).toBeCloseTo(0, 9);
    expect(read(ax, 300, 150)[0]).toBeCloseTo(20, 9);
    expect(read(ax, 300, 150)[1]).toBeCloseTo(90, 9);
  });

  it('⚑⚑ a radial axis that DECREASES outward reads its own points, not their mirror', () => {
    // A sky chart: elevation 90 at the centre, 45 and 0 out at the rim.
    const ax = new PolarAxes();
    expect(ax.calibrate(calibrationWith('90', '45', '0'), true, false, false, false)).toBe(true);
    expect(read(ax, 500, 300)[0], 'P1 reads the 45 it was given, not 135').toBeCloseTo(45, 9);
    expect(read(ax, 500, 300)[1], "P1's angle is not 180 degrees out").toBeCloseTo(0, 9);
    expect(read(ax, 300, 150)[0], 'P2 reads the 0 it was given, not 180').toBeCloseTo(0, 9);
    expect(read(ax, 300, 150)[1]).toBeCloseTo(90, 9);
  });

  it('⚑⚑ a decreasing LOG radial axis reads its own points, not four orders out', () => {
    const ax = new PolarAxes();
    expect(ax.calibrate(calibrationWith('1000', '100', '1'), true, false, true, false)).toBe(true);
    expect(read(ax, 500, 300)[0], 'P1 reads 100, not 10,000').toBeCloseTo(100, 6);
    expect(read(ax, 300, 150)[0], 'P2 reads 1, not 1,000,000').toBeCloseTo(1, 6);
  });

  it('⚑⚑ a centre value BETWEEN the two declared radii is refused, not half-flipped', () => {
    // Contradictory rather than merely awkward: the radial axis would have to
    // increase towards one click and decrease towards the other. Half the
    // figure used to read correctly and half reflected, which is the worst
    // possible outcome because it looks right where you check it.
    const ax = new PolarAxes();
    expect(ax.calibrate(calibrationWith('50', '20', '100'), true, false, false, false)).toBe(false);
  });

  it('⚑ the self-check does not refuse the ordinary cases it must let through', () => {
    // Clockwise, radians, and a rotated pair of angles, all measured frames.
    const radians = new Calibration(3);
    radians.addPoint(300, 300, '0', '');
    radians.addPoint(500, 300, '10', '0.5');
    radians.addPoint(300, 150, '20', '2.0');
    for (const clockwise of [false, true]) {
      const ax = new PolarAxes();
      expect(ax.calibrate(radians, false, clockwise, false, false), `clockwise=${clockwise}`).toBe(true);
      expect(ax.pixelToData(500, 300)[0]).toBeCloseTo(10, 9);
      expect(ax.pixelToData(500, 300)[1]).toBeCloseTo(0.5, 9);
      expect(ax.pixelToData(300, 150)[0]).toBeCloseTo(20, 9);
      expect(ax.pixelToData(300, 150)[1]).toBeCloseTo(2.0, 9);
    }
  });
});
