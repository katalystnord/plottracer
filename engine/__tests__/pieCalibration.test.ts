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

/** Walk the click path: points around a circle of radius 50 centred at (100,100),
 * then the two global values.
 *
 * ⚑ NOTHING CLICKS A CENTRE. The outline is the entire calibration and the centre is
 * fitted through it — which is the only way a donut works at all, since its centre is
 * not drawn. Each outline click completes outright ('point-placed'): the points carry
 * no per-click value, because the total and the sweep belong to the whole figure. */
function outlineAt(deg: number): [number, number] {
  const r = (deg * Math.PI) / 180;
  return [100 + 50 * Math.cos(r), 100 + 50 * Math.sin(r)];
}

function calibrate(
  session: CalibrationSession<PieAxes>,
  total = '100',
  sweep = '360',
  angles: number[] = [90, 0, -90]
): boolean {
  for (const a of angles) {
    expect(session.handleCalibrationClick(...outlineAt(a))).toBe('point-placed');
  }
  session.setGlobalFieldValue('total', total);
  session.setGlobalFieldValue('sweep', sweep);
  return session.runCalibration();
}

/** Build the axes the way a FILE does — calibrate() directly, no session walk. */
function loadedPie(total: string, sweep: string): PieAxes {
  const cal = new Calibration(2);
  for (const a of [90, 0, -90]) {
    const [x, y] = outlineAt(a);
    cal.addPoint(x, y, '', '');
  }
  const axes = new PieAxes();
  // ⚑ THIS HELPER'S PREMISE USED TO BE THE DEFECT. It asserted `.toBe(true)`
  // with the note "the axes is perfectly happy with input the click path
  // refuses" -- i.e. it pinned the class's permissiveness as a fact, and it was
  // the reason a corrupt project file could reopen "calibrated" with every
  // sector reading NaN. PieAxes now applies the SAME rule as the session
  // (2026-08-01), so the class's own verdict is no longer asserted here; what
  // these tests exist to check is that the SESSION reports the refusal on the
  // file entrance, which it still must whether or not the class caught it first.
  axes.calibrate(cal, parseFloat(total), parseFloat(sweep));
  return axes;
}

/** A loaded session carries its globals in the axes metadata, which is where
 * core/plotData.ts puts them — so the load path must be given them the same way. */
function loadSession(total: string, sweep: string): CalibrationSession<PieAxes> {
  const session = new CalibrationSession(PIE_AXES_CONFIG);
  const axes = loadedPie(total, sweep);
  axes.setMetadata({ ...axes.getMetadata(), pieTotal: total, pieSweep: sweep });
  session.setGlobalFieldValue('total', total);
  session.setGlobalFieldValue('sweep', sweep);
  session.loadCalibrated(axes, [new Dataset(1)]);
  return session;
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
    // a pie is; changed, they read in the figure's own units. They are GLOBAL rather
    // than tied to a click, because neither belongs to any one point.
    const session = newPie();
    expect(session.getGlobalFieldValues()).toMatchObject({ total: '100', sweep: '360' });
    expect(PIE_AXES_CONFIG.globalFields.map((f) => f.key)).toEqual(['total', 'sweep']);
  });

  it('starts with three outline points and takes more', () => {
    // Spider's variable-length calibration, for the same reason: the figure decides.
    const session = newPie();
    expect(session.getRepeatCount()).toBe(3);
    expect(session.getSteps().map((s) => s.key)).toEqual(['outline1', 'outline2', 'outline3']);
    expect(session.addRepeat()).toBe(true);
    expect(session.getSteps()).toHaveLength(4);
  });

  it('fits the centre through the outline without it ever being clicked', () => {
    // The donut case: there is no centre in the image to click.
    const session = newPie();
    expect(calibrate(session)).toBe(true);
    const centre = session.getAxes()!.getCentre();
    expect(centre.x).toBeCloseTo(100, 6);
    expect(centre.y).toBeCloseTo(100, 6);
    expect(session.getAxes()!.getRadius()).toBeCloseTo(50, 6);
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
  it('refuses outline points that describe no circle', () => {
    // Three COLLINEAR points fit a circle of infinite radius -- the degenerate case a
    // least-squares fit cannot report as success. Every angle would read 0 while the
    // calibration claimed to work, which is the silent-wrong-number shape the guards
    // exist for.
    const session = newPie();
    for (const x of [100, 150, 200]) {
      expect(session.handleCalibrationClick(x, 100)).toBe('point-placed');
    }
    expect(session.runCalibration()).toBe(false);
    expect(session.getCalibrationError()).toMatch(/must lie on a circle|same pixel/i);
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

      expect(loadSession(total, '360').getCalibrationError()).toMatch(/total must be a positive number/i);
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

      expect(loadSession('100', sweep).getCalibrationError()).toMatch(/sweep must be between/i);
    });
  }

  it('accepts a healthy pie on both entrances — the guards add no false positive', () => {
    const session = newPie();
    expect(calibrate(session)).toBe(true);
    expect(session.getCalibrationError()).toBeNull();

    const loaded = loadSession('100', '360');
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
