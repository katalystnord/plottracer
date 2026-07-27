import { describe, expect, it } from 'vitest';
import { CalibrationSession, SPIDER_AXES_CONFIG } from '../calibrationSession.js';
import type { SpiderAxes } from '../../core/axes/spider.js';
import { Dataset } from '../../core/dataset.js';

/**
 * Spider CAPTURE and EXPORT (v1.4 Stage 2).
 *
 * The one thing worth being paranoid about: a captured point's value must be read
 * against the spoke it was captured ON, taken from its point group — never against
 * whichever ray it happens to sit nearest. The two agree for a click that landed on
 * its axis and diverge exactly when the user mis-clicked, which is the case where a
 * nearest-ray reading would export a number off a DIFFERENT axis's scale while the
 * table still showed it in the slot they aimed at.
 */

/** Centre (100,100); `n` spokes of 100px, clockwise from 12 o'clock. */
function spokePixel(i: number, n: number, radius = 100): [number, number] {
  const angle = (2 * Math.PI * i) / n;
  return [100 + radius * Math.sin(angle), 100 - radius * Math.cos(angle)];
}

function calibratedSpider(values: string[], names: string[], centre = '0'): CalibrationSession<SpiderAxes> {
  const session = new CalibrationSession(SPIDER_AXES_CONFIG);
  const n = values.length;
  while (session.getRepeatCount() < n) session.addRepeat();
  session.handleCalibrationClick(100, 100);
  for (let i = 0; i < n; i++) {
    const [px, py] = spokePixel(i, n);
    session.handleCalibrationClick(px, py);
    session.confirmCalibrationValues([values[i]!, names[i]!]);
  }
  session.setGlobalFieldValue('centreValue', centre);
  expect(session.runCalibration()).toBe(true);
  return session;
}

const THREE = () => calibratedSpider(['100', '100', '100'], ['Strength', 'Weight', 'Cost']);

describe('a calibrated spider gives every series one capture slot per axis', () => {
  it('names the point groups after the spokes', () => {
    // ⚑ Cannot be `defaultPointGroups`: a spider's groups do not exist until its
    // axes are calibrated, and their names are transcribed at that moment.
    expect(THREE().getPointGroups()).toEqual(['Strength', 'Weight', 'Cost']);
  });

  it('falls back positionally for an axis left unnamed', () => {
    const session = calibratedSpider(['10', '10', '10'], ['A', '', 'C']);
    expect(session.getPointGroups()).toEqual(['A', 'Axis 2', 'C']);
  });

  it('gives EVERY series the slots, not just the active one', () => {
    const session = THREE();
    session.addDataset();
    session.setActiveDataset(1);
    expect(session.getPointGroups()).toEqual(['Strength', 'Weight', 'Cost']);
  });

  it('renames in place when a re-calibration keeps the same axis count', () => {
    const session = THREE();
    for (let i = 0; i < 3; i++) session.addDataPoint(...spokePixel(i, 3, 50));
    // Rename axis 2 by re-placing its calibration point with a new name.
    session.updateCalibPointPixel('spoke2', ...spokePixel(1, 3));
    expect(session.getPointGroups()).toEqual(['Strength', 'Weight', 'Cost']);
    expect(session.getDataPoints()).toHaveLength(3);
  });
});

describe('a captured point is read against ITS OWN axis', () => {
  it('reads each slot off its own spoke', () => {
    const session = THREE();
    // Halfway out along each of the three rays, in slot order.
    for (let i = 0; i < 3; i++) session.addDataPoint(...spokePixel(i, 3, 50));
    const rows = session.getExportRows(0);
    expect(rows.map((r) => r.values[2])).toEqual([50, 50, 50]);
  });

  it('⚑ does NOT re-read a mis-clicked point off the ray it sits nearest', () => {
    // The heart of it. Slot 0 is "Strength" (12 o'clock); this click is placed way
    // over on the Weight ray. Read against Weight it would be 50 — a plausible
    // number off the wrong axis. Read against the axis it was captured on, its
    // projection onto that ray is what the record says, and the warning below is
    // what tells the user something is wrong.
    const session = THREE();
    session.addDataPoint(...spokePixel(1, 3, 50)); // fills slot 0 (Strength)
    const row = session.getExportRows(0)[0]!;
    expect(row.values[0]).toBe(1);
    expect(row.values[1]).toBe('Strength');
    // Projection of the Weight-ray point onto the Strength ray: 50 * cos(120°).
    expect(row.values[2]).toBeCloseTo(-25, 6);
    expect(row.values[2]).not.toBeCloseTo(50, 6);
  });

  it('exports Axis, Name, Value — independent variables first', () => {
    const session = THREE();
    session.addDataPoint(...spokePixel(0, 3, 50));
    expect(session.getExportFields()).toEqual(['Axis', 'Name', 'Value']);
    expect(session.getExportRows(0)[0]!.values).toEqual([1, 'Strength', 50]);
  });

  it('numbers the Axis column from 1, matching what the calibration card shows', () => {
    const session = THREE();
    for (let i = 0; i < 3; i++) session.addDataPoint(...spokePixel(i, 3, 50));
    expect(session.getExportRows(0).map((r) => r.values[0])).toEqual([1, 2, 3]);
  });

  it('exports a blank name for an axis nobody transcribed, not an invented one', () => {
    const session = calibratedSpider(['10', '10', '10'], ['A', '', 'C']);
    for (let i = 0; i < 3; i++) session.addDataPoint(...spokePixel(i, 3, 50));
    // The positional fallback is a DISPLAY label; what the file records for an
    // untranscribed name is the label the app derived, never a guess at the figure.
    expect(session.getExportRows(0)[1]!.values[1]).toBe('Axis 2');
  });
});

describe('the off-axis warning', () => {
  it('fires for a point nearer a different axis than its own', () => {
    const session = THREE();
    session.addDataPoint(...spokePixel(1, 3, 50)); // slot 0, but on ray 1
    const [warning] = session.getOffAxisWarnings();
    expect(warning).toBeDefined();
    expect(warning!.capturedOnLabel).toBe('Strength');
    expect(warning!.nearestLabel).toBe('Weight');
    expect(warning!.offRayPx).toBeGreaterThan(0);
  });

  it('stays silent for points placed on their own axis', () => {
    const session = THREE();
    for (let i = 0; i < 3; i++) session.addDataPoint(...spokePixel(i, 3, 50));
    expect(session.getOffAxisWarnings()).toEqual([]);
  });

  it('tolerates a click that is off its ray but still closest to it', () => {
    // ⚑ The threshold is "nearer another ray", not a fixed pixel tolerance — so an
    // ordinary imprecise click on the right axis is NOT nagged about.
    const session = THREE();
    const [px, py] = spokePixel(0, 3, 50);
    session.addDataPoint(px + 8, py);
    expect(session.getOffAxisWarnings()).toEqual([]);
  });

  it('tightens automatically as the spokes crowd together', () => {
    // The same 8px sideways slip that is fine on a 3-spoke chart is a different
    // proposition on a 24-spoke one. Nothing is configured for this; it falls out
    // of comparing against the other rays.
    const many = calibratedSpider(Array(24).fill('100'), Array.from({ length: 24 }, (_, i) => `A${i}`));
    const [px, py] = spokePixel(0, 24, 50);
    many.addDataPoint(px + 8, py);
    expect(many.getOffAxisWarnings()).toHaveLength(1);
  });

  it('warns without correcting — the recorded pixel is untouched', () => {
    // Snapping would record a value against an axis nobody chose; refusing would
    // discard a real measurement.
    const session = THREE();
    const [px, py] = spokePixel(1, 3, 50);
    session.addDataPoint(px, py);
    expect(session.getOffAxisWarnings()).toHaveLength(1);
    const point = session.getDataPoints()[0]!;
    expect(point.px).toBeCloseTo(px, 10);
    expect(point.py).toBeCloseTo(py, 10);
  });

  it('clears when the point is dragged back onto its own axis', () => {
    const session = THREE();
    session.addDataPoint(...spokePixel(1, 3, 50));
    expect(session.getOffAxisWarnings()).toHaveLength(1);
    session.updateDataPointPixel(0, ...spokePixel(0, 3, 50));
    expect(session.getOffAxisWarnings()).toEqual([]);
  });

  it('says nothing on a graph type that has no spokes', () => {
    const session = new CalibrationSession(SPIDER_AXES_CONFIG);
    expect(session.getOffAxisWarnings()).toEqual([]);
  });
});

describe('the load path refuses to restructure data it cannot re-pair', () => {
  /** A project whose dataset's slot count disagrees with the axes' spoke count. */
  function loadMismatched(groupNames: string[]): CalibrationSession<SpiderAxes> {
    const built = calibratedSpider(['100', '100', '100'], ['Strength', 'Weight', 'Cost']);
    const axes = built.getAxes()!;

    const dataset = new Dataset(1);
    dataset.name = 'Series 1';
    if (groupNames.length > 0) dataset.setPointGroups([...groupNames]);
    for (let i = 0; i < 2; i++) {
      const [px, py] = spokePixel(i, 3, 40);
      dataset.addPixel(px, py);
    }

    const session = new CalibrationSession(SPIDER_AXES_CONFIG);
    session.loadCalibrated(axes, [dataset]);
    return session;
  }

  it('leaves the recorded slots alone when their COUNT disagrees with the axes', () => {
    // ⚑ Renaming is safe when the counts match — it is a pure relabel. When they
    // differ, slot k of an existing tuple no longer means the axis it was recorded
    // against, and rewriting the names would make the table assert a pairing
    // nobody measured: exactly the failure the error-bar record is parked on. The
    // data keeps the names it was captured under and the mismatch stays visible.
    const session = loadMismatched(['Old A', 'Old B']);
    expect(session.getPointGroups()).toEqual(['Old A', 'Old B']);
    expect(session.getDataPoints()).toHaveLength(2);
  });

  it('exports a point that belongs to no axis as UNMEASURED, not as axis 1', () => {
    // A dataset carrying pixels but no tuples (an older or hand-edited file) has
    // nothing saying which axis each point was read against. Defaulting them onto
    // spoke 0 would put real-looking numbers in a row nobody assigned them to.
    const session = loadMismatched([]);
    const rows = session.getExportRows(0);
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.values).toEqual([null, '', null]);
  });

  it('still says nothing off-axis about points with no axis to be off', () => {
    expect(loadMismatched([]).getOffAxisWarnings()).toEqual([]);
  });
});
