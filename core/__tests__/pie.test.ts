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

/** Calibrate a pie centred at (100,100) with its rim 50px to the right. */
function pie(sweepDegrees = 360, total = 100): PieAxes {
  const cal = new Calibration(2);
  cal.addPoint(100, 100, '', '');
  cal.addPoint(150, 100, String(total), String(sweepDegrees));
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

describe('PieAxes — reading an angle', () => {
  it('measures the angle between two boundaries', () => {
    const axes = pie();
    const a = axes.angleAt(...at(0));
    const b = axes.angleAt(...at(90));
    expect(((b - a) * 180) / Math.PI).toBeCloseTo(90, 6);
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
