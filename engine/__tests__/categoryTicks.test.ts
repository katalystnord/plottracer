import { describe, expect, it } from 'vitest';
import {
  BAR_AXES_CONFIG,
  BOX_PLOT_AXES_CONFIG,
  CATEGORICAL_LINE_CONFIG,
  HISTOGRAM_AXES_CONFIG,
  PIE_AXES_CONFIG,
  POLAR_AXES_CONFIG,
  SPIDER_AXES_CONFIG,
  XY_AXES_CONFIG,
  CalibrationSession,
} from '../calibrationSession.js';
import type { BarAxes } from '../../core/axes/bar.js';
import type { CalibratedAxes } from '../axesTypeConfigs.js';

/**
 * CATEGORY TICKS, wired into the session (v2.1).
 *
 * ⚑ WHAT THIS FILE IS ACTUALLY FOR. The geometry itself is tested in
 * `core/__tests__/categoryAxis.test.ts`, where it is pure. What only the SESSION
 * can get wrong is the wiring: which graph types may have ticks at all, which
 * placed pixel seeds the axis, and whether the geometry survives the three other
 * entrances this codebase keeps being bitten by — an image edit, the undo
 * snapshot, and a reset.
 *
 * ⚑ Ticks are an AID. Nothing here should ever assert that a tick changes a
 * measured VALUE, because none of them do.
 */

const A = { x: 100, y: 500 };
const B = { x: 600, y: 500 };

/** A calibrated Bar session. P1=0 at the origin (100,500), P2=10 at (100,100). */
function calibratedBar(): CalibrationSession<BarAxes> {
  const s = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
  s.handleCalibrationClick(A.x, A.y);
  s.confirmCalibrationValues(['0']);
  s.handleCalibrationClick(100, 100);
  s.confirmCalibrationValues(['10']);
  expect(s.runCalibration()).toBe(true);
  return s;
}

/** A Bar session whose category axis is marked with `n` categories. */
function withTicks(n = 4): CalibrationSession<BarAxes> {
  const s = calibratedBar();
  const seed = s.categoryTickOriginPixel();
  expect(seed).not.toBeNull();
  expect(s.markCategoryAxis({ x: seed!.px, y: seed!.py }, B)).toBe(true);
  expect(s.setCategoryCount(n)).toBe(true);
  return s;
}

describe('which graph types have categories at all', () => {
  it('the three whose other axis is categorical, and only those', () => {
    for (const config of [BAR_AXES_CONFIG, CATEGORICAL_LINE_CONFIG, BOX_PLOT_AXES_CONFIG]) {
      const s = new CalibrationSession(config as never);
      expect(s.supportsCategoryTicks(), config.id).toBe(true);
    }
    for (const config of [XY_AXES_CONFIG, HISTOGRAM_AXES_CONFIG, SPIDER_AXES_CONFIG,
                          PIE_AXES_CONFIG, POLAR_AXES_CONFIG]) {
      const s = new CalibrationSession(config as never);
      expect(s.supportsCategoryTicks(), config.id).toBe(false);
    }
  });

  it('⚑ every mutator refuses on a type with no categories, leaving nothing behind', () => {
    // Otherwise a stray call could give a spider tick geometry, which would then
    // serialize into its project file and mean nothing to anyone.
    const s = new CalibrationSession<CalibratedAxes>(SPIDER_AXES_CONFIG as never);
    expect(s.markCategoryAxis(A, B)).toBe(false);
    expect(s.setCategoryCount(4)).toBe(false);
    expect(s.setCategoryTickConvention('edge')).toBe(false);
    expect(s.moveCategoryTick(0, A)).toBe(false);
    expect(s.clearCategoryAxisGeometry()).toBe(false);
    expect(s.categoryBandAt(300, 300)).toBeNull();
    expect(s.categoryTickOriginPixel()).toBeNull();
    expect(s.getCategoryAxis().hasGeometry()).toBe(false);
  });
});

describe('the seed pixel — what makes marking the axis one click, not two', () => {
  it('is nothing until the seed step has been placed', () => {
    const s = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    expect(s.categoryTickOriginPixel()).toBeNull();
  });

  it('is P1 once placed — the value origin sits on the category axis edge', () => {
    expect(calibratedBar().categoryTickOriginPixel()).toEqual({ px: 100, py: 500 });
  });

  it('⚑ is V1 for categorical Line, which names its steps differently', () => {
    // The whole reason the seed is declared rather than written as 'p1' at the
    // call site: a literal would work for Bar and Box Plot and quietly return
    // nothing here.
    const s = new CalibrationSession<BarAxes>(CATEGORICAL_LINE_CONFIG);
    s.handleCalibrationClick(70, 480);
    s.confirmCalibrationValues(['0']);
    expect(s.categoryTickOriginPixel()).toEqual({ px: 70, py: 480 });
  });

  it('Box Plot shares Bar’s steps, so it shares the seed', () => {
    const s = new CalibrationSession<BarAxes>(BOX_PLOT_AXES_CONFIG);
    s.handleCalibrationClick(11, 22);
    s.confirmCalibrationValues(['0']);
    expect(s.categoryTickOriginPixel()).toEqual({ px: 11, py: 22 });
  });
});

describe('marking the axis and declaring the categories', () => {
  it('the whole gesture: reuse P1, click the far edge, say how many', () => {
    const s = withTicks(4);
    const ca = s.getCategoryAxis();
    expect(ca.hasGeometry()).toBe(true);
    expect(ca.getAxisEdges()).toEqual([{ x: 100, y: 500 }, { x: 600, y: 500 }]);
    expect(ca.getTickPoints().map((p) => p.x)).toEqual([162.5, 287.5, 412.5, 537.5]);
  });

  it('refuses a degenerate axis, the model’s own guard reaching through', () => {
    const s = calibratedBar();
    expect(s.markCategoryAxis(A, { ...A })).toBe(false);
    expect(s.getCategoryAxis().hasGeometry()).toBe(false);
  });

  it('files a bar under the category it sits in', () => {
    const s = withTicks(4); // bands at x = 100-225, 225-350, 350-475, 475-600
    expect(s.categoryBandAt(150, 300)).toBe(0);
    expect(s.categoryBandAt(300, 300)).toBe(1);
    expect(s.categoryBandAt(550, 300)).toBe(3);
  });

  it('clearing the marks keeps the category names', () => {
    const s = withTicks(3);
    s.getCategoryAxis().renameCategory(0, 'Flax');
    expect(s.clearCategoryAxisGeometry()).toBe(true);
    expect(s.getCategoryAxis().hasGeometry()).toBe(false);
    expect(s.getCategoryAxis().getCategories()).toEqual(['Flax', '', '']);
  });

  it('does not gate the calibration — a bar chart calibrates with no ticks at all', () => {
    const s = calibratedBar();
    expect(s.isCalibrated()).toBe(true);
    expect(s.getCategoryAxis().hasGeometry()).toBe(false);
  });
});

describe('⚑ the geometry survives the OTHER entrances', () => {
  it('an image edit moves the edges, and the ticks follow', () => {
    const s = withTicks(4);
    s.transformAllPixels((px, py) => ({ x: px + 40, y: py - 25 }));
    const ca = s.getCategoryAxis();
    expect(ca.getAxisEdges()).toEqual([{ x: 140, y: 475 }, { x: 640, y: 475 }]);
    expect(ca.getTickPoints().map((p) => p.x)).toEqual([202.5, 327.5, 452.5, 577.5]);
  });

  it('⚑ an image edit does NOT discard ticks the user dragged', () => {
    // setAxisEdges regenerates, so moving the edges naively would silently undo
    // the user's adjustments -- an image rotation quietly reverting their work.
    const s = withTicks(4);
    s.moveCategoryTick(1, { x: 300, y: 500 });
    const dragged = [...s.getCategoryAxis().getTickParams()];
    s.transformAllPixels((px, py) => ({ x: px + 40, y: py }));
    expect(s.getCategoryAxis().getTickParams()).toEqual(dragged);
    expect(s.getCategoryAxis().hasAdjustments()).toBe(true);
  });

  it('a rotation carries the geometry onto a tilted axis', () => {
    const s = withTicks(2);
    // 90 degrees about the origin: (x,y) -> (-y,x)
    s.transformAllPixels((px, py) => ({ x: -py, y: px }));
    expect(s.getCategoryAxis().getAxisEdges()).toEqual([{ x: -500, y: 100 }, { x: -500, y: 600 }]);
    expect(s.getCategoryAxis().getTickPoints()).toEqual([
      { x: -500, y: 225 },
      { x: -500, y: 475 },
    ]);
  });

  it('⚑ UNDO carries it — the snapshot is an entrance too', () => {
    const s = withTicks(4);
    s.setCategoryTickConvention('edge');
    s.moveCategoryTick(0, { x: 200, y: 500 });
    s.getCategoryAxis().renameCategory(2, 'Jute');
    const before = s.captureState();
    const ticks = [...s.getCategoryAxis().getTickParams()];

    s.clearCategoryAxisGeometry();
    expect(s.getCategoryAxis().hasGeometry()).toBe(false);

    s.restoreState(before);
    const ca = s.getCategoryAxis();
    expect(ca.hasGeometry()).toBe(true);
    expect(ca.getConvention()).toBe('edge');
    expect(ca.getTickParams()).toEqual(ticks);
    expect(ca.hasAdjustments()).toBe(true);
    expect(ca.getCategories()[2]).toBe('Jute');
    expect(ca.getAxisEdges()).toEqual([{ x: 100, y: 500 }, { x: 600, y: 500 }]);
  });

  it('undo of an unmarked session restores an unmarked one, not a stale axis', () => {
    const s = calibratedBar();
    const blank = s.captureState();
    s.markCategoryAxis(A, B);
    s.setCategoryCount(3);
    s.restoreState(blank);
    expect(s.getCategoryAxis().hasGeometry()).toBe(false);
  });

  it('“Reset calibration” discards the marks with everything else', () => {
    const s = withTicks(3);
    s.reset();
    expect(s.getCategoryAxis().hasGeometry()).toBe(false);
    expect(s.getCategoryAxis().getCategories()).toEqual([]);
  });

  it('clearing the POINTS leaves the marks alone — they describe the figure', () => {
    const s = withTicks(3);
    s.addDataPoint(150, 500);
    s.addDataPoint(150, 300);
    s.clearPoints();
    expect(s.getDataset().getTupleCount()).toBe(0);
    expect(s.getCategoryAxis().hasGeometry()).toBe(true);
    expect(s.getCategoryAxis().getTickParams()).toHaveLength(3);
  });
});
