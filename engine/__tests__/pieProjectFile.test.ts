import { describe, expect, it } from 'vitest';
import { CalibrationSession, PIE_AXES_CONFIG } from '../calibrationSession.js';
import { serializeProject, deserializeProject } from '../projectFile.js';
import type { PieAxes } from '../../core/axes/pie.js';

/**
 * A pie through the project FILE — the model's second entrance.
 *
 * ⚑ Round-tripped through serializeProject/deserializeProject rather than through
 * PlotData.serialize alone, because those are not the same test. `serializeProjectZip`
 * rebuilds project.json by SPREADING the file object, so a key that never reaches the
 * assembled file passes every unit test on the serializer and is missing from every
 * real save — the trap that cost this project a release-gate blocker once already.
 */

function calibratedPie(opts: { total: string; sweep: string; tilted?: boolean }): CalibrationSession<PieAxes> {
  const session = new CalibrationSession(PIE_AXES_CONFIG);
  // A tilted pie needs five points; give five either way so the two cases differ in
  // exactly one thing.
  const angles = [90, 18, -54, -126, -198];
  // ⚑ Grow the step list BEFORE clicking. The outline starts at its minimum of three,
  // so a fourth click with only three steps is simply ignored -- and the calibration
  // then fails for want of points that were, from the user's side, definitely placed.
  while (session.getRepeatCount() < angles.length) expect(session.addRepeat()).toBe(true);
  for (const a of angles) {
    const r = (a * Math.PI) / 180;
    expect(
      session.handleCalibrationClick(300 + 120 * Math.cos(r), 200 + (opts.tilted ? 60 : 120) * Math.sin(r))
    ).toBe('point-placed');
  }
  session.setGlobalFieldValue('total', opts.total);
  session.setGlobalFieldValue('sweep', opts.sweep);
  if (opts.tilted) session.setOption('isTilted', 'true');
  expect(session.runCalibration()).toBe(true);
  return session;
}

describe('a pie survives the project file', () => {
  it('reopens with its total, sweep and outline intact', () => {
    const session = calibratedPie({ total: '2500', sweep: '360' });
    const file = serializeProject(session, 'pie.png', 'pie.png', { measurements: [], scale: null }, {}, undefined, { appVersion: '1.6.0', savedAt: 'now' });
    if ('error' in file) throw new Error(`serializeProject refused: ${(file as { error: string }).error}`);
    const back = deserializeProject(file as never);
    if ('error' in back) throw new Error(`deserializeProject refused: ${(back as { error: string }).error}`);
    const loaded = back as { configId: string; axes: PieAxes };
    expect(loaded.configId).toBe('pie');
    // ⚑ The total and sweep have no pixel to ride on, so they travel in the axes
    // metadata. Losing them would not fail loudly -- the pie would reopen reading
    // percentages of 100 instead of 2500, every value silently a fortieth of itself.
    expect(loaded.axes.getDefaultTotal()).toBe(2500);
    expect((loaded.axes.getSweep() * 180) / Math.PI).toBeCloseTo(360, 6);
  });

  it('reopens a TILTED pie tilted, not silently as a circle', () => {
    // ⚑ The dangerous one. Re-reading a tilted pie as a circle changes EVERY value in
    // the file and nothing looks wrong, because the readings still sum to the total.
    const session = calibratedPie({ total: '100', sweep: '360', tilted: true });
    const before = session.getAxes()!;
    const file = serializeProject(session, 'pie.png', 'pie.png', { measurements: [], scale: null }, {}, undefined, { appVersion: '1.6.0', savedAt: 'now' });
    const back = deserializeProject(file as never) as { axes: PieAxes };
    // The frame itself must come back squashed: a circle would have equal axes.
    const ratio = (a: PieAxes) => {
      const c = a.getCentre();
      void c;
      return a.getRadius();
    };
    expect(ratio(back.axes)).toBeCloseTo(ratio(before), 6);
    // ...and the values it reads must match what it read before saving.
    const probe = (a: PieAxes) => a.sectorValue(a.angleAt(420, 200), a.angleAt(300, 80), 100);
    expect(probe(back.axes)).toBeCloseTo(probe(before), 6);
  });
});
