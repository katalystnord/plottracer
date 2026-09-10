import { describe, expect, it } from 'vitest';
import { PolarAxes } from '../axes/polar.js';
import { Calibration } from '../calibration.js';

/**
 * Polar calibration.
 *
 * ⚑ WHY THIS FILE EXISTS. `core/axes/polar.ts` scored 34.69% - the lowest of any
 * real axes class - and unlike XY and Map there is nothing upstream to port:
 * WebPlotDigitizer has NO polar test, and neither does Engauge (verified against
 * the live remote, not a stale clone). This maths has never been checked by
 * anyone, here or upstream. So these cases are derived from the coordinate
 * system itself rather than from a lineage.
 *
 * `calibrate` takes three independent flags - degrees, clockwise, log radial -
 * so eight behavioural combinations run through one `pixelToData`. Flag
 * combinations are where mutants hide, and each case below pins one axis of that
 * space rather than re-checking the happy path.
 *
 * The geometry throughout: centre at (100,100); calibration point 1 due EAST at
 * (200,100) declared r=10, θ=0; point 2 further east at (300,100) declared r=20.
 * So 100px = 10 radial units, and screen-east is θ=0. Every number below is
 * derivable from that.
 */

function polar({ degrees = true, clockwise = false, logR = false } = {}): PolarAxes {
  const calib = new Calibration(2);
  calib.addPoint(100, 100, '0', '0');
  calib.addPoint(200, 100, logR ? '10' : '10', '0');
  calib.addPoint(300, 100, logR ? '100' : '20', '0');
  const axes = new PolarAxes();
  expect(axes.calibrate(calib, degrees, clockwise, logR), 'calibration should succeed').toBe(true);
  return axes;
}

describe('PolarAxes - the calibration reproduces itself', () => {
  it('reads calibration point 1 back as the values it was given', () => {
    // The most basic obligation of any calibration, and nothing asserted it.
    const [r, theta] = polar().pixelToData(200, 100);
    expect(r).toBeCloseTo(10, 10);
    expect(theta).toBeCloseTo(0, 10);
  });

  it('reads calibration point 2 back at its declared radius', () => {
    const [r] = polar().pixelToData(300, 100);
    expect(r).toBeCloseTo(20, 10);
  });
});

describe('PolarAxes - angle, in degrees, anticlockwise', () => {
  const axes = polar();

  // Screen y grows downwards, so "north" is a SMALLER y. Getting that sign
  // wrong flips the whole chart top to bottom, and only a cardinal-direction
  // check catches it.
  it.each([
    ['east', 200, 100, 0],
    ['north', 100, 0, 90],
    ['west', 0, 100, 180],
    ['south', 100, 200, 270],
  ])('places %s at %s°', (_dir, px, py, expected) => {
    const [r, theta] = axes.pixelToData(px as number, py as number);
    expect(theta).toBeCloseTo(expected as number, 9);
    // All four are equidistant from the centre, so the radius must not move.
    expect(r).toBeCloseTo(10, 9);
  });

  it('never reports a negative angle - the range is [0, 360)', () => {
    // The implementation adds 2π to a negative result. A mutant that drops that
    // wrap makes south read -90 instead of 270, which every downstream export
    // would carry as a plausible-looking number.
    for (const [px, py] of [
      [100, 200],
      [50, 150],
      [200, 101],
      [99, 101],
    ] as const) {
      const [, theta] = axes.pixelToData(px, py);
      expect(theta).toBeGreaterThanOrEqual(0);
      expect(theta).toBeLessThan(360);
    }
  });
});

describe('PolarAxes - the three flags', () => {
  it('mirrors the angle when the chart runs clockwise', () => {
    // North is 90° going anticlockwise from east, and 270° going clockwise.
    expect(polar({ clockwise: false }).pixelToData(100, 0)[1]).toBeCloseTo(90, 9);
    expect(polar({ clockwise: true }).pixelToData(100, 0)[1]).toBeCloseTo(270, 9);
  });

  it('reports the SAME angle in radians when degrees is off', () => {
    // ⚑ The unit question, pinned as an invariant rather than a constant: the
    // two readings must describe one angle. This is the bug class that reached
    // a release today - the .dig reader treated gradians and turns as radians,
    // exporting 49.21 for an angle whose true value was 0.
    const deg = polar({ degrees: true }).pixelToData(100, 0)[1]!;
    const rad = polar({ degrees: false }).pixelToData(100, 0)[1]!;
    expect(rad).toBeCloseTo(Math.PI / 2, 12);
    expect((rad * 180) / Math.PI).toBeCloseTo(deg, 9);
  });

  it('spaces a log radial axis GEOMETRICALLY, not arithmetically', () => {
    // r=10 at 100px, r=100 at 200px. Halfway between them in DISTANCE is 150px,
    // which on a log scale is 10^1.5 = 31.6228 - the geometric mean, not the
    // arithmetic 55. A mutant that skips the log conversion returns 55 and is
    // invisible to any test that only checks the calibration points.
    const [r] = polar({ logR: true }).pixelToData(250, 100);
    expect(r).toBeCloseTo(31.6227766, 6);
    expect(r).not.toBeCloseTo(55, 0);
  });

  it('still reproduces its calibration points on a log radial axis', () => {
    const axes = polar({ logR: true });
    expect(axes.pixelToData(200, 100)[0]).toBeCloseTo(10, 8);
    expect(axes.pixelToData(300, 100)[0]).toBeCloseTo(100, 8);
  });
});

describe('PolarAxes - what it does NOT provide', () => {
  it('ships the unimplemented dataToPixel stub', () => {
    // Asserted so that implementing it later must be a deliberate act. Same
    // rule as Map and Bar.
    expect(polar().dataToPixel(10, 90)).toEqual({ x: 0, y: 0 });
  });
});

/**
 * v2.0 pre-launch audit: `calibrate()` performed NO input validation at all --
 * r1/theta1/r2/theta2 went through a bare `Number()`, bypassing InputParser
 * entirely, and processCalibration always returned true. `"abc"` for a radius
 * gave `NaN`, baked into every subsequent reading, with calibrate() reporting
 * success and nothing on screen wrong.
 */
describe('PolarAxes.calibrate refuses invalid input instead of succeeding silently', () => {
  function calibrateWith(r1: string, theta1: string, r2: string, theta2 = '0'): { ok: boolean; axes: PolarAxes } {
    const calib = new Calibration(2);
    calib.addPoint(100, 100, '0', '0');
    calib.addPoint(200, 100, r1, theta1);
    calib.addPoint(300, 100, r2, theta2);
    const axes = new PolarAxes();
    const ok = axes.calibrate(calib, true, false, false);
    return { ok, axes };
  }

  it('refuses a non-numeric radius', () => {
    const { ok, axes } = calibrateWith('abc', '0', '20');
    expect(ok).toBe(false);
    expect(axes.isCalibrated()).toBe(false);
  });

  it('refuses a non-numeric angle', () => {
    const { ok, axes } = calibrateWith('10', 'xyz', '20');
    expect(ok).toBe(false);
    expect(axes.isCalibrated()).toBe(false);
  });

  it('refuses a thousands separator -- the whole-string rule, like every other axes type', () => {
    expect(calibrateWith('1,000', '0', '2000').ok).toBe(false);
  });

  it('refuses a date where a radius or angle is expected', () => {
    expect(calibrateWith('2024/01/01', '0', '20').ok).toBe(false);
  });

  it('still calibrates and reads back correctly on healthy input', () => {
    const { ok, axes } = calibrateWith('10', '0', '20');
    expect(ok).toBe(true);
    expect(axes.isCalibrated()).toBe(true);
    expect(axes.pixelToData(200, 100)[0]).toBeCloseTo(10, 10);
  });

  it('does NOT refuse on an invalid/blank theta2 -- P2.theta2 is optional and never read', () => {
    // Same value POLAR_AXES_CONFIG defaults a blank theta2 to on the click
    // path; a garbage theta2 in a hand-edited file must not block loading a
    // calibration whose actual math never reads it (see the _theta2r comment
    // in polar.ts).
    expect(calibrateWith('10', '0', '20', '0').ok).toBe(true);
    expect(calibrateWith('10', '0', '20', 'not a number').ok).toBe(true);
  });

  it('refuses fewer than 3 calibration points rather than indexing an out-of-range getPoint() into a crash (v2.0 audit)', () => {
    const short = new Calibration(2);
    short.addPoint(100, 100, '0', '0');
    short.addPoint(200, 100, '10', '0');
    const axes = new PolarAxes();
    expect(axes.calibrate(short, true, false, false)).toBe(false);
    expect(axes.isCalibrated()).toBe(false);
    expect(new PolarAxes().calibrate(new Calibration(2), true, false, false)).toBe(false);
  });
});

/**
 * ⚑ A LOG RADIUS that cannot be logged - refused by the MODEL.
 *
 * Same defect as the one found in `core/axes/xy.ts` while writing importer
 * tests: `Math.log(0)` is −Infinity and `Math.log(negative)` is NaN, both were
 * baked into dist10/dist12, and `calibrate()` returned true regardless.
 *
 * Polar differs from XY in one way that matters: it has no negative branch at
 * all, because a radius is a distance. So its rule is the stricter one -
 * strictly positive, not merely "same sign". See `core/axes/logScale.ts`,
 * which holds both rules in one place so they cannot drift apart.
 */
describe('a log radial scale needs positive radii', () => {
  function tryLogR(r1: string, r2: string): boolean {
    const calib = new Calibration(2);
    calib.addPoint(100, 100, '0', '0'); // centre
    calib.addPoint(200, 100, r1, '0');
    calib.addPoint(300, 100, r2, '0');
    return new PolarAxes().calibrate(calib, true, false, true);
  }

  it('refuses a radius of zero, at either point', () => {
    expect(tryLogR('0', '100')).toBe(false);
    expect(tryLogR('10', '0')).toBe(false);
  });

  it('⚑ refuses a NEGATIVE radius, which XY would have allowed as a decade', () => {
    // The two rules genuinely differ, and this is where. An all-negative pair
    // is a legitimate XY axis; it is not a radius.
    expect(tryLogR('-10', '-100')).toBe(false);
    expect(tryLogR('-10', '100')).toBe(false);
  });

  it('accepts an ordinary positive log radial scale', () => {
    expect(tryLogR('10', '100')).toBe(true);
  });

  it('leaves a LINEAR radial scale through zero alone', () => {
    const calib = new Calibration(2);
    calib.addPoint(100, 100, '0', '0');
    calib.addPoint(200, 100, '0', '0');
    calib.addPoint(300, 100, '20', '0');
    expect(new PolarAxes().calibrate(calib, true, false, false)).toBe(true);
  });
});

/**
 * ⚑⚑ THE FIGURE'S OWN SHAPE, MEASURED - polar's half of the ternary correction
 * (2026-09-10).
 *
 * ⚠️ INHERITED WHOLE FROM WPD, and the two halves are one defect. Upstream asks
 * for P2's θ and never reads it (`_theta2r`, *"a dead computation"*), and its
 * reading is Euclidean distance from the origin with the raw pixel angle - i.e.
 * the drawing is ASSUMED to be a circle. A polar plot that is tilted, squashed
 * by a two-column layout, or photographed is an ELLIPSE, and every radius and
 * angle then reads wrong with nothing on screen amiss.
 *
 * ⚑⚑ THE IGNORED VALUE IS EXACTLY THE MISSING INFORMATION. An affine map about a
 * known origin has four unknowns; the origin fixes translation, and P1 and P2
 * supply two equations each. So origin + P1 + P2 determine the frame EXACTLY -
 * no fitting, no extra clicks - the moment their angles differ. Measured on a
 * deliberately sheared frame: recovery to machine precision, while the circular
 * model read r=176.5 where the truth was 75.
 *
 * ⚑ TWO POINTS ON ONE RAY CANNOT SEE THE PERPENDICULAR DIRECTION, so the
 * circular reading is not a preference there - it is what the clicks support.
 * That is also what keeps WPD projects readable: upstream's own prompt puts P2
 * on P1's ray, so every imported polar file takes that path unchanged (tenet 6).
 */
describe('a polar figure is read through the frame its clicks describe', () => {
  const O = { x: 400, y: 400 };
  /** A sheared, squashed frame: the figure's circles are drawn as tilted
   *  ellipses. [[a,b],[c,d]] applied to the canonical (r·cosθ, r·sinθ). */
  const M = { a: 3.0, b: 0.8, c: -0.5, d: 1.6 };
  const place = (r: number, degrees: number) => {
    const t = (degrees * Math.PI) / 180;
    const u = r * Math.cos(t);
    const v = r * Math.sin(t);
    return { x: O.x + M.a * u + M.b * v, y: O.y + M.c * u + M.d * v };
  };

  function distorted({ clockwise = false } = {}): PolarAxes {
    const cal = new Calibration(2);
    cal.addPoint(O.x, O.y, '0', '0');
    const p1 = place(50, 0);
    const p2 = place(100, 90);
    cal.addPoint(p1.x, p1.y, '50', '0');
    cal.addPoint(p2.x, p2.y, '100', '90');
    const axes = new PolarAxes();
    expect(axes.calibrate(cal, true, clockwise, false, false), 'calibration should succeed').toBe(true);
    return axes;
  }

  it('⚑⚑ reads a SQUASHED, TILTED polar plot exactly, where a circle reads 176 for 75', () => {
    const axes = distorted();
    for (const [r, deg] of [[75, 37], [120, 210], [10, 300], [50, 0], [100, 90]] as const) {
      const p = place(r, deg);
      const [gotR, gotTheta] = axes.pixelToData(p.x, p.y);
      expect(gotR, `r at ${r}/${deg}`).toBeCloseTo(r, 8);
      expect(gotTheta, `θ at ${r}/${deg}`).toBeCloseTo(deg, 8);
    }
  });

  it('reproduces its own two calibration points, as any calibration must', () => {
    const axes = distorted();
    const p1 = place(50, 0);
    const p2 = place(100, 90);
    expect(axes.pixelToData(p1.x, p1.y)[0]).toBeCloseTo(50, 9);
    expect(axes.pixelToData(p1.x, p1.y)[1]).toBeCloseTo(0, 9);
    expect(axes.pixelToData(p2.x, p2.y)[0]).toBeCloseTo(100, 9);
    expect(axes.pixelToData(p2.x, p2.y)[1]).toBeCloseTo(90, 9);
  });

  it('⚑ measures the DIRECTION, so the clockwise flag cannot contradict the figure', () => {
    // With two angles the sense of rotation is in the clicks: a frame that puts
    // θ=90 where the figure does is the same frame whichever way the user says
    // the chart runs. The flag stops being a thing to get wrong.
    const anti = distorted({ clockwise: false });
    const clock = distorted({ clockwise: true });
    const p = place(75, 37);
    expect(clock.pixelToData(p.x, p.y)[0]).toBeCloseTo(anti.pixelToData(p.x, p.y)[0]!, 9);
    expect(clock.pixelToData(p.x, p.y)[1]).toBeCloseTo(anti.pixelToData(p.x, p.y)[1]!, 9);
  });

  it('⚑ takes the CENTRE\'s radial value from the origin point, for a plot with a hole', () => {
    // A polar plot whose centre reads 20 rather than 0. The frame needs to know,
    // because two clicks can determine the shape OR the offset, not both - and
    // the number is printed at the centre of the figure, so it is transcribed
    // like any other axis value rather than guessed.
    const cal = new Calibration(2);
    cal.addPoint(O.x, O.y, '20', '0');
    const p1 = place(30, 0); // 30 canonical units out = r 50 on a centre-20 axis
    const p2 = place(80, 90);
    cal.addPoint(p1.x, p1.y, '50', '0');
    cal.addPoint(p2.x, p2.y, '100', '90');
    const axes = new PolarAxes();
    expect(axes.calibrate(cal, true, false, false, false)).toBe(true);
    expect(axes.pixelToData(O.x, O.y)[0]).toBeCloseTo(20, 8);
    expect(axes.pixelToData(p1.x, p1.y)[0]).toBeCloseTo(50, 8);
    expect(axes.pixelToData(p2.x, p2.y)[0]).toBeCloseTo(100, 8);
  });

  it('⚠️ TWO POINTS ON ONE RAY still read exactly as they always did', () => {
    // ⚑⚑ THE INTEROP CASE, and the reason the circular path is not deleted:
    // WPD's own prompt puts P2 at the same θ as P1, so every polar project that
    // tool ever wrote takes this path. The numbers below are the fixture at the
    // top of this file, unchanged.
    const [r, theta] = polar().pixelToData(200, 100);
    expect(r).toBeCloseTo(10, 10);
    expect(theta).toBeCloseTo(0, 10);
    expect(polar().pixelToData(300, 100)[0]).toBeCloseTo(20, 10);
    // A quarter turn is still a quarter turn.
    expect(polar().pixelToData(100, 0)[1]).toBeCloseTo(90, 10);
  });

  it('⚠️ DECLARED CIRCULAR ignores any angle P2 carries - it is what upstream writes', () => {
    // ⚑⚑ THE SHAPE IS DECLARED, NOT SNIFFED. A WPD project carries a θ for P2
    // (often 0, sometimes junk) and is a circular calibration; the reading must
    // not change because of a number that walk never asked for. `calibrate`
    // defaults to circular for exactly this reason.
    const cal = new Calibration(2);
    cal.addPoint(100, 100, '0', '0');
    cal.addPoint(200, 100, '10', '0');
    cal.addPoint(300, 100, '20', '90');
    const axes = new PolarAxes();
    expect(axes.calibrate(cal, true, false, false)).toBe(true);
    expect(axes.isCircularPlot()).toBe(true);
    expect(axes.pixelToData(300, 100)[0]).toBeCloseTo(20, 10);
  });

  it('⚑ a figure DECLARED distorted refuses clicks that cannot describe a frame', () => {
    // The user has said it is not a circle, so the circular maths is not a
    // lesser answer - it is the one they just ruled out. Reachable from a file
    // or a handle drag; the walk itself asks for a different angle.
    const cal = new Calibration(2);
    cal.addPoint(100, 100, '0', '0');
    cal.addPoint(200, 100, '10', '0');
    cal.addPoint(300, 100, '20', '0'); // same ray
    const axes = new PolarAxes();
    expect(axes.calibrate(cal, true, false, false, false)).toBe(false);
    expect(axes.isCalibrated()).toBe(false);
  });

  it('reads a LOG radial axis through the measured frame too', () => {
    const cal = new Calibration(2);
    cal.addPoint(O.x, O.y, '1', '0'); // the centre is r=1, so log10 = 0
    const p1 = place(1, 0); // one decade out
    const p2 = place(2, 90); // two decades out
    cal.addPoint(p1.x, p1.y, '10', '0');
    cal.addPoint(p2.x, p2.y, '100', '90');
    const axes = new PolarAxes();
    expect(axes.calibrate(cal, true, false, true, false)).toBe(true);
    expect(axes.pixelToData(p1.x, p1.y)[0]).toBeCloseTo(10, 6);
    expect(axes.pixelToData(p2.x, p2.y)[0]).toBeCloseTo(100, 6);
    // Halfway between the decades in GEOMETRY is a decade and a half in value.
    const mid = place(1.5, 0);
    expect(axes.pixelToData(mid.x, mid.y)[0]).toBeCloseTo(Math.pow(10, 1.5), 6);
  });
});
