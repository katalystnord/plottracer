import { describe, expect, it } from 'vitest';
import { BarAxes } from '../axes/bar.js';
import { Calibration } from '../calibration.js';

/**
 * BarAxes — the geometry, the orientation, and the readout.
 *
 * ⚑ WHY THIS FILE EXISTS. `bar.ts` scored **41.18%** on mutation testing with 37
 * mutants uncovered — the weakest axes class in the project, and the only one the
 * pre-v2.0 audit did NOT move (40% → 41%, while xy went 45→68 and polar 35→63).
 * That matters because **v2.0 rewrites this model**: building the bar record on top
 * of a file where three changes in five go unnoticed is building on green-but-
 * unchecked ground.
 *
 * `barCalibrateGuards.test.ts` already covers what calibrate() REFUSES. This covers
 * what it does when it accepts: the orientation classifier, the projection, log
 * scale, and the two methods whose contents nothing had ever asserted.
 */

/** Calibrate a bar chart from two points, given as pixels and their values. */
function bar(
  p1: [number, number],
  p2: [number, number],
  v1 = '0',
  v2 = '100',
  { isLog = false, isRotated = false } = {}
): BarAxes {
  const cal = new Calibration(2);
  cal.addPoint(p1[0], p1[1], '0', v1);
  cal.addPoint(p2[0], p2[1], '0', v2);
  const axes = new BarAxes();
  expect(axes.calibrate(cal, isLog, isRotated)).toBe(true);
  return axes;
}

describe('which way the bars run — the orientation classifier', () => {
  // ⚑ FOUR BRANCHES, and every one of them had surviving mutants: the 270° test
  // could be replaced by `true`, by `false`, by `<=`, by `>=`, and by `+270` and the
  // suite noticed none of it. The classifier decides whether a figure's bars are read
  // vertically or horizontally, so getting it wrong does not throw — it silently
  // reads the wrong dimension of every bar.
  //
  // Image y runs DOWN, so a baseline BELOW the top means y decreases upward.
  it.each([
    ['vertical, value increasing upward', [100, 300], [100, 100], 'Y', 'increasing'],
    ['vertical, value increasing downward', [100, 100], [100, 300], 'Y', 'decreasing'],
    ['horizontal, value increasing rightward', [100, 200], [300, 200], 'X', 'increasing'],
    ['horizontal, value increasing leftward', [300, 200], [100, 200], 'X', 'decreasing'],
  ] as const)('reads %s', (_label, p1, p2, axis, direction) => {
    const o = bar([...p1] as [number, number], [...p2] as [number, number]).getOrientation();
    expect(o.axes).toBe(axis);
    expect(o.direction).toBe(direction);
  });

  it('classifies by a 30° TOLERANCE, not by exactness', () => {
    // ⚑ The tolerance is the whole point of the classifier: a scanned or
    // hand-drawn figure is never exactly vertical, and a calibration clicked by hand
    // never is either. A 20° lean must still read as vertical.
    const leaning = bar([100, 300], [100 + 70, 300 - 190]); // ~20° off vertical
    expect(leaning.getOrientation().axes).toBe('Y');
    expect(leaning.getOrientation().direction).toBe('increasing');
  });

  it('matches NO branch at 45°, and keeps the constructed default', () => {
    // Outside every tolerance (45° is 15° beyond the nearest), so the classifier
    // falls through and the object keeps what it was constructed with: axes 'Y',
    // direction 'increasing'. Checked with the chart declared ROTATED, which is the
    // only way to see the raw classification — see the next test for why.
    const diagonal = bar([100, 300], [300, 100], '0', '100', { isRotated: true });
    expect(diagonal.getOrientation().angle).toBeCloseTo(45, 6);
    expect(diagonal.getOrientation().axes).toBe('Y');
    expect(diagonal.getOrientation().direction).toBe('increasing');
  });

  it('⚑ SILENTLY SQUARES an unclassifiable calibration to vertical', () => {
    // ⚑ FOUND BY WRITING THIS TEST — I expected the 45° angle to survive and it did
    // not. On an unrotated chart the fall-through default ('Y') feeds straight into
    // the squaring-up step, so `x2 = x1` is applied and the orientation is then
    // RECOMPUTED as exactly 90°. A calibration too diagonal to classify therefore
    // reports itself as a clean vertical axis, with the evidence of the ambiguity
    // erased.
    //
    // Pinned as the behaviour it is, not endorsed: this is the "we RECORD, we do not
    // interpret" line, and v2.0 owns this model. If the bar model keeps the
    // fall-through it should say so on screen rather than resolve it in silence.
    const diagonal = bar([100, 300], [300, 100]); // 45°, unrotated
    expect(diagonal.getOrientation().angle).toBeCloseTo(90, 6);
    expect(diagonal.getOrientation().axes).toBe('Y');
  });

  it('reports the measured ANGLE alongside the classification', () => {
    expect(bar([100, 300], [100, 100]).getOrientation().angle).toBeCloseTo(90, 6);
    expect(bar([100, 200], [300, 200]).getOrientation().angle).toBeCloseTo(0, 6);
  });
});

describe('squaring up an unrotated chart', () => {
  it('forces a vertical axis to be exactly vertical', () => {
    // ⚑ `this.x2 = this.x1` — and its sibling `this.y2 = this.y1`, whose mutant
    // survived. On a chart declared NOT rotated, the value axis is taken to be truly
    // vertical (or truly horizontal) and the clicked lean is treated as aim error.
    // The observable consequence is that the reading stops depending on the
    // perpendicular coordinate at all.
    const leaning = bar([100, 300], [130, 100]); // clicked 30px off vertical
    // Two pixels at the same height but far apart horizontally must read the SAME
    // value once the axis has been squared up.
    expect(leaning.pixelToData(100, 200)[0]).toBeCloseTo(leaning.pixelToData(900, 200)[0]!, 9);
  });

  it('forces a horizontal axis to be exactly horizontal', () => {
    const leaning = bar([100, 200], [300, 230]); // clicked 30px off horizontal
    expect(leaning.pixelToData(200, 100)[0]).toBeCloseTo(leaning.pixelToData(200, 900)[0]!, 9);
  });

  it('KEEPS the lean when the chart is declared rotated', () => {
    // The other side of the same branch: a genuinely rotated figure must not be
    // squared up, or the rotation it declares is thrown away.
    const rotated = bar([100, 300], [130, 100], '0', '100', { isRotated: true });
    expect(rotated.isRotated()).toBe(true);
    expect(rotated.pixelToData(100, 200)[0]).not.toBeCloseTo(rotated.pixelToData(900, 200)[0]!, 6);
  });
});

describe('reading a bar back', () => {
  it('projects onto the value axis and interpolates between the two references', () => {
    const axes = bar([100, 300], [100, 100]); // 0 at y=300, 100 at y=100
    expect(axes.pixelToData(100, 300)[0]).toBeCloseTo(0, 9);
    expect(axes.pixelToData(100, 100)[0]).toBeCloseTo(100, 9);
    expect(axes.pixelToData(100, 200)[0]).toBeCloseTo(50, 9);
  });

  it('EXTRAPOLATES past the references rather than clamping', () => {
    // A bar can legitimately exceed the tick the user calibrated against, so the
    // mapping must keep going. Clamping would quietly cap the tallest bar.
    const axes = bar([100, 300], [100, 100]);
    expect(axes.pixelToData(100, 400)[0]).toBeCloseTo(-50, 9);
    expect(axes.pixelToData(100, 0)[0]).toBeCloseTo(150, 9);
  });

  it('honours a non-zero baseline value', () => {
    const axes = bar([100, 300], [100, 100], '20', '120');
    expect(axes.pixelToData(100, 200)[0]).toBeCloseTo(70, 9);
  });

  it('reads a LOG axis in decades, not linearly', () => {
    // ⚑ The log branch converts both references to log10 at calibration and raises
    // the result back at read time. Halfway between 1 and 100 is 10, not 50.
    const axes = bar([100, 300], [100, 100], '1', '100', { isLog: true });
    expect(axes.isLog()).toBe(true);
    expect(axes.pixelToData(100, 200)[0]).toBeCloseTo(10, 6);
    expect(axes.pixelToData(100, 300)[0]).toBeCloseTo(1, 6);
    expect(axes.pixelToData(100, 100)[0]).toBeCloseTo(100, 6);
  });

  it('reports NOT log for a linear chart', () => {
    expect(bar([100, 300], [100, 100]).isLog()).toBe(false);
    expect(bar([100, 300], [100, 100]).isRotated()).toBe(false);
  });
});

describe('the two methods nothing had ever asserted', () => {
  it('dataToPixel is a STUB returning the origin — deliberately, and load-bearing', () => {
    // ⚑ Do not "fix" this. `algorithms/errorCapture.ts` PROBES dataToPixel and
    // degrades to "unconstrained" precisely because Bar's does not invert
    // (checkpoint 79), so making it work would silently change error-bar behaviour.
    // A mutant replacing the return with `{}` survived, which means nothing checked
    // even the shape. Pinned here so the stub is a decision on the record rather than
    // an oversight the next reader quietly repairs.
    expect(bar([100, 300], [100, 100]).dataToPixel(50, 50)).toEqual({ x: 0, y: 0 });
  });

  it('the live readout is exponential to four places', () => {
    // A mutant altered the format and nothing noticed. This is the string under the
    // cursor while a user places bars.
    expect(bar([100, 300], [100, 100]).pixelToLiveString(100, 200)).toBe('5.0000e+1');
  });
});

describe('what it declares itself to be', () => {
  it('needs two calibration points and is two-dimensional', () => {
    const axes = new BarAxes();
    expect(axes.numCalibrationPointsRequired()).toBe(2);
    expect(axes.getDimensions()).toBe(2);
    expect(axes.isCalibrated()).toBe(false);
  });

  it('labels its columns Category and Y', () => {
    // ⚑ `Category`, not WPD's inherited `Label` — renamed on David's call so the
    // table, the Box Plot tuple field and the categorical export all use one word.
    // It is a breaking header change for anything parsing a v1.0-v1.2 Bar export by
    // column NAME, which is why it is pinned rather than left to drift back.
    expect(new BarAxes().getAxesLabels()).toEqual(['Category', 'Y']);
  });

  it('names its per-point fallback prefix', () => {
    const axes = new BarAxes();
    expect(axes.dataPointsHaveLabels).toBe(true);
    expect(axes.dataPointsLabelPrefix).toBe('Bar');
    expect(axes.name).toBe('Bar');
  });
});

describe('metadata is COPIED, not aliased', () => {
  it('survives the caller mutating what it passed in or got back', () => {
    const axes = new BarAxes();
    const stored = { orientation: 'vertical' };
    axes.setMetadata(stored);
    stored.orientation = 'changed';
    expect(axes.getMetadata()).toEqual({ orientation: 'vertical' });

    const read = axes.getMetadata() as { orientation: string };
    read.orientation = 'changed too';
    expect(axes.getMetadata()).toEqual({ orientation: 'vertical' });
  });
});
