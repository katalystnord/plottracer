/**
 * ⚑⚑ THE SPLIT IS NOT A ONE-WAY DOOR.
 *
 * ⚠️ David, 2026-09-15, choosing the surface: the offer existed ONLY at the
 * moment a project opened. `layeredProjectOffer` had exactly one production
 * caller, `Workspace.tsx`'s open path, so answering No left the figure readable
 * and the capability invisible forever. That is an invisible precondition by the
 * keystone persona's rule - a thing that appears once, unprompted, and can never
 * be found again.
 *
 * ⚑ It also explains a piece of dead code: `CalibrationSession`'s own
 * `getLayeredProjectOffer` had NO production caller at all, because the
 * Workspace called the module function directly. The accessor was written for a
 * panel surface that did not exist. This is that surface, so the accessor now
 * has the job it was written for rather than being deleted.
 *
 * ⚑ WHAT THIS FILE PINS is the MODEL half - what the panel asks and what the
 * split produces - because the panel is a rendering of exactly this answer. The
 * button and its line are driven in the e2e board.
 */
import { describe, expect, it } from 'vitest';
import { CalibrationSession, BAR_AXES_CONFIG } from '../../../engine/calibrationSession.js';
import { BOX_PLOT_SLOTS, OPPOSITE_CORNER_SLOTS } from '../../../engine/axesTypeConfigs.js';
import { Dataset } from '../../../core/dataset.js';
import { walkCategoryAxis } from '../../../engine/__tests__/helpers/categoryWalk.js';
import type { BarAxes } from '../../../core/axes/bar.js';

function calibratedBar(categories = 2): { axes: BarAxes; categoryAxis: ReturnType<CalibrationSession<BarAxes>['getCategoryAxis']> } {
  const s = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
  s.handleCalibrationClick(300, 500);
  s.confirmCalibrationValues(['0']);
  s.handleCalibrationClick(300, 100);
  s.confirmCalibrationValues(['10']);
  walkCategoryAxis(s, { count: categories });
  expect(s.runCalibration(), s.getCalibrationError() ?? 'no error').toBe(true);
  return { axes: s.getAxes()!, categoryAxis: s.getCategoryAxis() };
}

/** A series holding one complete tuple - a bare pixel is pruned by the load door. */
function seriesWithATuple(name: string, names: readonly string[], x: number): Dataset {
  const ds = new Dataset(names.length);
  ds.name = name;
  ds.setSlotNames([...names]);
  const tuple = ds.addTuple(ds.addPixel(x, 400))!;
  names.forEach((_, slot) => {
    if (slot === 0) return;
    ds.addToTupleAt(tuple, slot, ds.addPixel(x, 400 - slot * 30));
  });
  return ds;
}

function layeredSession(): CalibrationSession<BarAxes> {
  const s = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
  const { axes, categoryAxis } = calibratedBar();
  s.loadCalibrated(
    axes,
    [
      seriesWithATuple('Control', OPPOSITE_CORNER_SLOTS, 250),
      seriesWithATuple('Treated', BOX_PLOT_SLOTS, 350),
    ],
    categoryAxis
  );
  return s;
}

describe('a layered figure keeps saying so, not only at the door', () => {
  it('⚑⚑ the live session answers the same question the open path asked', () => {
    // The panel reads THIS, which is why declining at the door costs nothing:
    // the figure still knows what it is.
    const offer = layeredSession().getLayeredProjectOffer();
    expect(offer).not.toBeNull();
    expect(offer).toContain('Control');
    expect(offer).toContain('Treated');
    expect(offer).toContain('Min, Q1, Median, Q3, Max');
  });

  it('⚑ and a figure whose series agree says nothing, so the panel stays quiet', () => {
    const s = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    const { axes, categoryAxis } = calibratedBar();
    s.loadCalibrated(
      axes,
      [
        seriesWithATuple('A', OPPOSITE_CORNER_SLOTS, 250),
        seriesWithATuple('B', OPPOSITE_CORNER_SLOTS, 350),
      ],
      categoryAxis
    );
    expect(s.getLayeredProjectOffer()).toBeNull();
  });

  it('⚠️ the answer SURVIVES being declined - nothing about saying no changes it', () => {
    // There is no "declined" flag, and that is the point: the offer is a
    // FUNCTION OF THE FIGURE, not a one-shot event. A flag would be the thing
    // that made this a one-way door in the first place.
    const s = layeredSession();
    const first = s.getLayeredProjectOffer();
    const second = s.getLayeredProjectOffer();
    expect(second).toBe(first);
  });
});
