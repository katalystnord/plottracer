import { describe, expect, it } from 'vitest';
import { ImageAxes } from '../axes/image.js';

/**
 * ImageAxes — raw pixel coordinates, the identity axes.
 *
 * ⚑ THIS FILE SCORED 0.00% ON MUTATION TESTING. Not low — zero. Every mutant
 * survived and fifteen had no coverage at all, because nothing anywhere executed it.
 * It is the smallest axes class in the project and the one place where "the tests are
 * green" meant literally nothing.
 *
 * It is worth testing rather than deleting because its identity behaviour is a
 * CONTRACT, not an absence of one: it is what lets a figure be worked on before any
 * calibration exists, and `isCalibrated()` returning true unconditionally is the
 * assertion that pixel coordinates are always valid — the opposite of every other
 * axes class, and exactly the kind of inversion a future edit could "tidy" away.
 */

describe('ImageAxes is always calibrated, because pixels always mean something', () => {
  it('reports calibrated without anyone calibrating it', () => {
    // ⚑ The inversion. Every other axes class starts false and earns true; this one
    // is true from construction because a pixel coordinate needs no reference points.
    // A "consistency" refactor that made this start false would silently block the
    // one axes type that must never block.
    expect(new ImageAxes().isCalibrated()).toBe(true);
  });

  it('reports success from calibrate() too, and needs no points to do it', () => {
    const axes = new ImageAxes();
    expect(axes.calibrate()).toBe(true);
    expect(axes.numCalibrationPointsRequired()).toBe(0);
    expect(axes.isCalibrated()).toBe(true);
  });
});

describe('the mapping is the identity, in both directions', () => {
  it('reads a pixel back as its own coordinates', () => {
    expect(new ImageAxes().pixelToData(123.5, -7)).toEqual([123.5, -7]);
  });

  it('maps data back to the same pixel', () => {
    // ⚑ Unlike BarAxes, whose dataToPixel is a documented stub returning {0,0}, this
    // one genuinely inverts — and something downstream may probe it the way
    // errorCapture probes Bar's. A mutant replacing this with `{}` survived.
    expect(new ImageAxes().dataToPixel(40, 60)).toEqual({ x: 40, y: 60 });
  });

  it('round-trips any pixel through both directions unchanged', () => {
    const axes = new ImageAxes();
    for (const [px, py] of [[0, 0], [1, 2], [-3.25, 900.5]] as const) {
      const [dx, dy] = axes.pixelToData(px, py);
      expect(axes.dataToPixel(dx!, dy!)).toEqual({ x: px, y: py });
    }
  });
});

describe('the live readout', () => {
  it('shows both coordinates to two decimals, comma-separated', () => {
    // ⚑ A mutant that dropped the ", " separator survived — so "12.30, 45.60" and
    // "12.3045.60" were indistinguishable to the suite. The separator is the whole
    // readability of the readout.
    expect(new ImageAxes().pixelToLiveString(12.3, 45.6)).toBe('12.30, 45.60');
  });

  it('rounds rather than truncates, and keeps trailing zeros', () => {
    expect(new ImageAxes().pixelToLiveString(0.005, 100)).toBe('0.01, 100.00');
  });
});

describe('metadata is COPIED, not aliased', () => {
  it('does not hand out a reference a caller can mutate', () => {
    // Both directions go through JSON round-trips on purpose; a mutant that returned
    // the object itself would let a caller edit the axes' own state by accident.
    const axes = new ImageAxes();
    const stored = { note: 'scan A' };
    axes.setMetadata(stored);
    stored.note = 'changed after storing';
    expect(axes.getMetadata()).toEqual({ note: 'scan A' });

    const read = axes.getMetadata() as { note: string };
    read.note = 'changed after reading';
    expect(axes.getMetadata()).toEqual({ note: 'scan A' });
  });
});

describe('what it declares itself to be', () => {
  it('is two-dimensional and names its axes X and Y', () => {
    const axes = new ImageAxes();
    expect(axes.getDimensions()).toBe(2);
    expect(axes.getAxesLabels()).toEqual(['X', 'Y']);
    expect(axes.name).toBe('Image');
  });
});
