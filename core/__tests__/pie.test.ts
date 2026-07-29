import { describe, expect, it } from 'vitest';
import { PieAxes } from '../axes/pie.js';
import { Calibration } from '../calibration.js';

/**
 * PieAxes — the geometry a pie's values are read from.
 *
 * Every test here is a property of the MODEL rather than of this implementation:
 * what a sector is worth, what leaves it unchanged, and what the sweep does. The
 * capture flow can be rebuilt freely (David's rule: simplify the workflow, keep the
 * record general) and these should all still hold.
 */

/**
 * Calibrate a pie centred at (100,100) with radius 50 — from OUTLINE points only.
 *
 * ⚑ Nothing clicks a centre. The outline is the whole calibration and the centre is
 * fitted through it, because a donut has no visible centre to click; these tests
 * therefore never tell the model where the middle is, and every angle below depends
 * on it having worked that out for itself.
 */
function pie(sweepDegrees = 360, total = 100, angles: number[] = [90, 210, 330]): PieAxes {
  const cal = new Calibration(2);
  for (const a of angles) {
    const r = (a * Math.PI) / 180;
    cal.addPoint(100 + 50 * Math.cos(r), 100 + 50 * Math.sin(r), '', '');
  }
  const axes = new PieAxes();
  axes.calibrate(cal, total, sweepDegrees);
  return axes;
}

/** A pixel `r` from (100,100) at `deg` clockwise from the rim direction. In image
 * space y runs DOWN, which is why a positive angle goes clockwise on screen. */
function at(deg: number, r = 50): [number, number] {
  const rad = (deg * Math.PI) / 180;
  return [100 + r * Math.cos(rad), 100 + r * Math.sin(rad)];
}

describe('PieAxes — fitting the circle', () => {
  it('recovers the centre and radius from the outline alone', () => {
    const axes = pie();
    expect(axes.getCentre().x).toBeCloseTo(100, 9);
    expect(axes.getCentre().y).toBeCloseTo(100, 9);
    expect(axes.getRadius()).toBeCloseTo(50, 9);
    expect(axes.getFitResidual()).toBeLessThan(1e-9);
  });

  it('takes more than three points, and says how well they fit', () => {
    // ⚑ Three points ALWAYS fit perfectly, so a bad click among them is undetectable.
    // A fourth is real redundancy about the figure, and the residual it produces is
    // the only thing that can say "this rim is not a circle".
    const eight = [0, 45, 90, 135, 180, 225, 270, 315];
    expect(pie(360, 100, eight).getFitResidual()).toBeLessThan(1e-9);
  });

  it('refuses collinear points, which describe no circle', () => {
    const cal = new Calibration(2);
    for (const x of [100, 150, 200]) cal.addPoint(x, 100, '', '');
    expect(new PieAxes().calibrate(cal, 100, 360)).toBe(false);
  });
});

describe('PieAxes — reading an angle', () => {
  it('measures the angle between two boundaries', () => {
    const axes = pie();
    const a = axes.angleAt(...at(0));
    const b = axes.angleAt(...at(90));
    expect(((b - a) * 180) / Math.PI).toBeCloseTo(90, 6);
  });

  it('reads twelve o\'clock as 0°, not 359.999…°', () => {
    // ⚑ The fitted centre is a few ulps off exact, so a boundary at precisely 0°
    // computes a hair BELOW zero and would wrap to the top of the range. Values never
    // noticed (differences normalise), but the live readout would flicker between
    // 0.0° and 360.0° — at twelve o'clock, which is where a pie's first boundary
    // usually sits.
    expect(pie().angleAt(...at(0))).toBeCloseTo(0, 9);
  });

  it('is SCALE-INVARIANT — the same angle at any radius', () => {
    // ⚑ The donut case, and the reason the record is the ANGLE and not the arc length.
    // A 90° sector is a quarter of its ring whether that ring is 40px or 400px across;
    // arc lengths are not comparable between rings, angles are. So ONE calibration
    // reads every ring of a donut, and the rim click only has to land on one of them.
    const axes = pie();
    for (const r of [5, 50, 500]) {
      expect(axes.angleAt(...at(30, r))).toBeCloseTo(axes.angleAt(...at(30, 50)), 9);
    }
  });

  it('is unchanged when a sector is pulled out or resized', () => {
    // Explosion is a TRANSLATION and a resize is a SCALE — both similarity transforms,
    // both angle-preserving. Measured at the sector's own apex, an exploded slice reads
    // exactly as it did before it was pulled out, which is the whole of the handling
    // explosion needs.
    const axes = pie();
    const plain = axes.angleAt(...at(120));
    const apex = { x: 130, y: 140 }; // the slice, dragged away from the centre
    const moved = axes.angleAt(130 + 50 * Math.cos((120 * Math.PI) / 180), 140 + 50 * Math.sin((120 * Math.PI) / 180), apex);
    expect(moved).toBeCloseTo(plain, 9);
    // ...and at a different radius from that same apex (a bigger exploded slice).
    const bigger = axes.angleAt(130 + 90 * Math.cos((120 * Math.PI) / 180), 140 + 90 * Math.sin((120 * Math.PI) / 180), apex);
    expect(bigger).toBeCloseTo(plain, 9);
  });
});

describe('PieAxes — what a sector is worth', () => {
  it('is its share of the whole, times the total', () => {
    const axes = pie(360, 100);
    const quarter = axes.sectorValue(axes.angleAt(...at(0)), axes.angleAt(...at(90)), 100);
    expect(quarter).toBeCloseTo(25, 6);
  });

  it('comes out in the units of the total it is given', () => {
    // Leave the total at 100 and a sector reads as percent; type the total printed in
    // a donut's hole and the same sector reads in the figure's own units. One field,
    // no modes.
    const axes = pie(360, 2297201);
    const quarter = axes.sectorValue(axes.angleAt(...at(0)), axes.angleAt(...at(90)), 2297201);
    expect(quarter).toBeCloseTo(2297201 / 4, 3);
  });

  it('takes the total PER SERIES, so a donut\'s rings can differ', () => {
    // ⚑ Each ring is its own whole (and, as David notes, not its own hole). Two rings
    // can be different years or currencies, so the total is passed in rather than read
    // off the shared axes.
    const axes = pie(360, 100);
    const start = axes.angleAt(...at(0));
    const end = axes.angleAt(...at(90));
    expect(axes.sectorValue(start, end, 100)).toBeCloseTo(25, 6);
    expect(axes.sectorValue(start, end, 4000)).toBeCloseTo(1000, 6);
  });

  it('measures against the SWEEP the figure draws, not against 360', () => {
    // ⚑ The half-pie trap, and the reason 360 is never a constant. On a 180° chart a
    // 90° sector is HALF the whole, not a quarter — assume a full turn and every value
    // is silently halved.
    const half = pie(180, 100);
    const ninety = half.sectorValue(half.angleAt(...at(0)), half.angleAt(...at(90)), 100);
    expect(ninety).toBeCloseTo(50, 6);
  });

  it('reads a sector that crosses the start of the turn', () => {
    // 350° -> 10° is a 20° slice, not a 340° one. This is why a sector cannot be
    // normalised by sorting its two boundaries the way a histogram bin's corners are:
    // the sector runs positively from start to end, so click order carries meaning.
    const axes = pie(360, 360);
    const wrapped = axes.sectorValue(axes.angleAt(...at(350)), axes.angleAt(...at(10)), 360);
    expect(wrapped).toBeCloseTo(20, 4);
  });
});

describe('how many digits a reading may honestly show', () => {
  it('says what one pixel at the rim is worth', () => {
    // ⚑ The bound on precision, derived from the geometry rather than chosen. A pixel
    // at radius r subtends 1/r radians, so it is worth (1/r)/sweep x total.
    const axes = pie(360, 2500, [0, 120, 240]); // radius 50 in this fixture
    const perPixel = axes.valuePerPixel(2500);
    expect(perPixel).toBeCloseTo((1 / 50 / (2 * Math.PI)) * 2500, 9);
    // ...so on a coarse figure a whole unit is below the noise floor.
    expect(perPixel).toBeGreaterThan(1);
  });

  it('gives a bigger figure more digits and a smaller one fewer', () => {
    // Same geometry, different totals: the honest precision follows the units.
    const axes = pie(360, 100, [0, 120, 240]);
    expect(axes.valuePerPixel(100)).toBeLessThan(axes.valuePerPixel(2500));
  });

  it('is zero for an uncalibrated pie rather than infinite', () => {
    const bare = new PieAxes();
    expect(bare.valuePerPixel(100)).toBe(0);
  });
});
