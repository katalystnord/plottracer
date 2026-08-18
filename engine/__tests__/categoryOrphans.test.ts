import { describe, expect, it } from 'vitest';
import { CalibrationSession, BAR_AXES_CONFIG } from '../calibrationSession.js';
import type { BarAxes } from '../../core/axes/bar.js';

/**
 * ⚑⚑ A DELETED BAR GIVES ITS CATEGORY BACK - round-2 audit.
 *
 * Every new bar reserves a fresh category slot, and nothing ever gave one
 * back. The shared v2.0 Bar table draws its rows from the CategoryAxis rather
 * than from the tuples, so each deleted bar left a dead row with a null value
 * - and the per-cell delete only renders where a value exists, so the ghost
 * row had NO delete affordance on any cell. It saved and reloaded with the
 * file.
 *
 * Worse than untidy: retyping the freed name on a replacement bar hit
 * `setTupleLabel`'s sole-owner branch and renamed IN PLACE, leaving two
 * identically named rows - after which `getCategoryIndex` resolved that name
 * to the invisible one, and a third series' bar filed into a row nobody can
 * see. It fails the keystone test outright: a capable first-time user is left
 * with a row they can neither fill nor remove.
 */
function calibratedBar(): CalibrationSession<BarAxes> {
  const s = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
  s.handleCalibrationClick(300, 500);
  s.confirmCalibrationValues(['0']);
  s.handleCalibrationClick(300, 100);
  s.confirmCalibrationValues(['10']);
  expect(s.runCalibration()).toBe(true);
  return s;
}

function bar(s: CalibrationSession<BarAxes>, x: number, name?: string): void {
  s.addDataPoint(x, 500);
  s.addDataPoint(x, 300);
  if (name !== undefined) s.setTupleLabel(s.getDataset().getTupleCount() - 1, name);
}

describe('deleting a bar releases its category', () => {
  it('⚑ leaves no ghost row behind', () => {
    const s = calibratedBar();
    bar(s, 150, 'Flax');
    bar(s, 250, 'Hemp');
    expect(s.getBarCategoryTable().categoryNames).toHaveLength(2);

    s.removeTuple(1);
    const names = s.getBarCategoryTable().categoryNames;
    expect(names).toHaveLength(1);
    expect(names[0]).toBe('Flax');
  });

  it('releases it through removeLastPoint too - every deletion door', () => {
    const s = calibratedBar();
    bar(s, 150, 'Flax');
    bar(s, 250, 'Hemp');
    s.removeLastPoint();
    s.removeLastPoint(); // the whole second bar
    expect(s.getBarCategoryTable().categoryNames).toHaveLength(1);
  });

  it('⚑ renumbers the SURVIVING bars, so their labels do not shift', () => {
    // Removing an index shifts every later one; without renumbering the stored
    // metadata, the remaining bars would silently point at the wrong names.
    const s = calibratedBar();
    bar(s, 150, 'Flax');
    bar(s, 250, 'Hemp');
    bar(s, 350, 'Jute');

    s.removeTuple(0); // drop the FIRST, so both survivors must shift down
    expect(s.getBarCategoryTable().categoryNames).toEqual(['Hemp', 'Jute']);
    expect(s.getTupleLabel(0)).toBe('Hemp');
    expect(s.getTupleLabel(1)).toBe('Jute');
  });

  it('⚑ lets the freed NAME be reused without creating a duplicate row', () => {
    // The corollary defect: the ghost kept the name, so retyping it renamed
    // the ghost in place and left two rows called Hemp.
    const s = calibratedBar();
    bar(s, 150, 'Flax');
    bar(s, 250, 'Hemp');
    s.removeTuple(1);
    bar(s, 350, 'Hemp');

    const labels = s.getBarCategoryTable().categoryNames;
    expect(labels).toEqual(['Flax', 'Hemp']);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('⚑ keeps a category another SERIES still uses', () => {
    // The guard that stops this over-reaching: shared identity is the whole
    // point of the canonical list.
    const s = calibratedBar();
    bar(s, 150, 'Flax');
    s.addDataset('Series 2');
    bar(s, 160, 'Flax'); // the same category, second series

    s.removeTuple(0); // remove series 2's bar
    expect(s.getBarCategoryTable().categoryNames).toEqual(['Flax']);
  });

  it('releases the categories a removed SERIES solely owned', () => {
    const s = calibratedBar();
    bar(s, 150, 'Flax');
    s.addDataset('Series 2');
    bar(s, 250, 'Hemp'); // only series 2 has Hemp
    expect(s.getBarCategoryTable().categoryNames).toHaveLength(2);

    s.removeDataset(1);
    expect(s.getBarCategoryTable().categoryNames).toEqual(['Flax']);
  });

  it('an untouched figure keeps every category it has', () => {
    const s = calibratedBar();
    bar(s, 150, 'Flax');
    bar(s, 250, 'Hemp');
    expect(s.getBarCategoryTable().categoryNames).toHaveLength(2);
  });
});
