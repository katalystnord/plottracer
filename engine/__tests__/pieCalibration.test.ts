import { describe, expect, it } from 'vitest';
import { CalibrationSession, PIE_AXES_CONFIG } from '../calibrationSession.js';
import { PieAxes } from '../../core/axes/pie.js';
import { Calibration } from '../../core/calibration.js';
import { Dataset } from '../../core/dataset.js';

/**
 * The pie's calibration — two clicks and two transcribed numbers.
 *
 * ⚑ Every refusal here is checked on BOTH entrances, the click path and a loaded
 * file, because `PieAxes.calibrate` reports success on degenerate input exactly like
 * every other class in core/axes/. That is the "guards belong in the model, and the
 * model has more than one entrance" rule this project has now learnt four times
 * (checkpoints 69/72/77/80, plus the reorder and insert fixes earlier today).
 */

function newPie(): CalibrationSession<PieAxes> {
  return new CalibrationSession(PIE_AXES_CONFIG);
}

/** Walk the click path: centre at (100,100), rim 50px right, then the two values. */
function calibrate(session: CalibrationSession<PieAxes>, total = '100', sweep = '360'): boolean {
  // ⚑ The centre carries NO value — a pie's centre sits on no scale — so the click
  // completes the step outright rather than opening a value box.
  expect(session.handleCalibrationClick(100, 100)).toBe('point-placed');
  expect(session.handleCalibrationClick(150, 100)).toBe('awaiting-value');
  expect(session.confirmCalibrationValues([total, sweep])).toBe(true);
  return session.runCalibration();
}

/** Build the axes the way a FILE does — calibrate() directly, no session walk. */
function loadedPie(total: string, sweep: string): PieAxes {
  const cal = new Calibration(2);
  cal.addPoint(100, 100, '', '');
  cal.addPoint(150, 100, total, sweep);
  const axes = new PieAxes();
  // The premise: the axes is perfectly happy with input the click path refuses.
  expect(axes.calibrate(cal, parseFloat(total), parseFloat(sweep))).toBe(true);
  return axes;
}

describe('calibrating a pie through the click path', () => {
  it('takes a centre, a rim and the total the whole circle represents', () => {
    const session = newPie();
    expect(calibrate(session)).toBe(true);
    const axes = session.getAxes()!;
    expect(axes).toBeInstanceOf(PieAxes);
    expect(axes.getDefaultTotal()).toBe(100);
    expect(axes.getSweep()).toBeCloseTo(Math.PI * 2, 9);
  });

  it('prefills the total with 100 and the sweep with 360', () => {
    // ⚑ Defaults the user WALKS PAST, not inventions — the spider's centre-value rule.
    // Left alone they read the slices as percentages of a whole circle, which is what
    // a pie is; changed, they read in the figure's own units.
    const steps = newPie().getSteps();
    const rim = steps.find((s) => s.key === 'rim')!;
    expect(rim.valueFields.map((f) => f.defaultValue)).toEqual(['100', '360']);
  });

  it('reads sectors in the units of the total that was typed', () => {
    const session = newPie();
    expect(calibrate(session, '2297201')).toBe(true);
    const axes = session.getAxes()!;
    const quarter = axes.sectorValue(axes.angleAt(150, 100), axes.angleAt(100, 150), 2297201);
    expect(quarter).toBeCloseTo(2297201 / 4, 3);
  });

  it('measures against the SWEEP that was typed, not against 360', () => {
    // The half-pie trap: on a 180° chart a 90° sector is HALF the whole, and assuming
    // a full turn would silently halve every value in the figure.
    const session = newPie();
    expect(calibrate(session, '100', '180')).toBe(true);
    const axes = session.getAxes()!;
    expect(axes.sectorValue(axes.angleAt(150, 100), axes.angleAt(100, 150), 100)).toBeCloseTo(50, 6);
  });
});

describe('the pie refuses the same things on both entrances', () => {
  it('refuses a rim placed on the centre', () => {
    // A zero-length frame vector: every angle then reads 0 while calibrate() still
    // returns true. Caught by distinctPixelSteps, which runs on the file path too.
    const session = newPie();
    expect(session.handleCalibrationClick(100, 100)).toBe('point-placed');
    expect(session.handleCalibrationClick(100, 100)).toBe('awaiting-value');
    expect(session.confirmCalibrationValues(['100', '360'])).toBe(true);
    expect(session.runCalibration()).toBe(false);
    expect(session.getCalibrationError()).toMatch(/same pixel/i);
  });

  for (const [label, total] of [
    ['zero', '0'],
    ['negative', '-50'],
    ['not a number', 'abc'],
  ] as const) {
    it(`refuses a ${label} total, by click and by file`, () => {
      // ⚑ A sector is a fraction of a whole, so a pie cannot show a negative quantity
      // — IBM's own documented rule for the type, arrived at here independently.
      const session = newPie();
      expect(calibrate(session, total)).toBe(false);
      expect(session.getCalibrationError()).toMatch(/total must be a positive number/i);

      const loaded = new CalibrationSession(PIE_AXES_CONFIG);
      loaded.loadCalibrated(loadedPie(total, '360'), [new Dataset(1)]);
      expect(loaded.getCalibrationError()).toMatch(/total must be a positive number/i);
    });
  }

  for (const [label, sweep] of [
    ['zero', '0'],
    ['negative', '-90'],
    ['more than a full turn', '540'],
  ] as const) {
    it(`refuses a sweep that is ${label}, by click and by file`, () => {
      const session = newPie();
      expect(calibrate(session, '100', sweep)).toBe(false);
      expect(session.getCalibrationError()).toMatch(/sweep must be between/i);

      const loaded = new CalibrationSession(PIE_AXES_CONFIG);
      loaded.loadCalibrated(loadedPie('100', sweep), [new Dataset(1)]);
      expect(loaded.getCalibrationError()).toMatch(/sweep must be between/i);
    });
  }

  it('accepts a healthy pie on both entrances — the guards add no false positive', () => {
    const session = newPie();
    expect(calibrate(session)).toBe(true);
    expect(session.getCalibrationError()).toBeNull();

    const loaded = new CalibrationSession(PIE_AXES_CONFIG);
    loaded.loadCalibrated(loadedPie('100', '360'), [new Dataset(1)]);
    expect(loaded.getCalibrationError()).toBeNull();
    expect(loaded.isCalibrated()).toBe(true);
  });
});

describe('the pie captures sectors as intervals', () => {
  it('declares the two-slot tuple a sector is', () => {
    // ⚑ Not a new shape: a histogram bin is ['Bin start','Bin end'] and uses the same
    // tuple machinery. A sector is the same interval, which is also what v2.0's bar
    // model generalises — so pie reaches the record we already have.
    expect(PIE_AXES_CONFIG.defaultSlots).toEqual(['Sector start', 'Sector end']);
    expect(PIE_AXES_CONFIG.tupleNoun).toBe('sector');
    // Losing an edge leaves no sector at all, unlike a spider's independent rays.
    expect(PIE_AXES_CONFIG.tupleMembers).toBe('object');
  });

  it('is 1.5D — one magnitude, and a name that is not a coordinate', () => {
    expect(PIE_AXES_CONFIG.dataDim).toBe(1);
    expect(PIE_AXES_CONFIG.valueLabels).toEqual(['Value']);
  });
});
