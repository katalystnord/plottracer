import { describe, expect, it } from 'vitest';
import {
  BAR_AXES_CONFIG,
  BOX_PLOT_AXES_CONFIG,
  CANDLESTICK_AXES_CONFIG,
  CATEGORICAL_LINE_CONFIG,
  SPAN_AXES_CONFIG,
  STACKED_AXES_CONFIG,
  CalibrationSession,
} from '../calibrationSession.js';
import type { BarAxes } from '../../core/axes/bar.js';
import { walkCategoryAxis } from './helpers/categoryWalk.js';

/**
 * The category axis on two tick marks (v2.7; David 2026-11-01: "two tick marks on a category axis as well, to be
 * sure we have the coordinates right"; the cases in docs/v2.7-workflow-walk.md, "The category axis on two tick
 * marks"). Cat 1 and Cat n are the first and last category's tick marks; the "ticks at" choice in the Categories
 * stage says what those tick marks are.
 */

const BAR_FAMILY = [
  ['Bar', BAR_AXES_CONFIG],
  ['Stacked bar', STACKED_AXES_CONFIG],
  ['Line with categories', CATEGORICAL_LINE_CONFIG],
  ['Box plot', BOX_PLOT_AXES_CONFIG],
  ['Candlestick', CANDLESTICK_AXES_CONFIG],
  ['Span chart', SPAN_AXES_CONFIG],
] as const;

/** A bar chart, value axis up the left, its four categories' tick marks at x = 100, 200, 300 and 400. */
function bar(count = 4, from = { x: 100, y: 500 }, to = { x: 400, y: 500 }): CalibrationSession<BarAxes> {
  const s = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
  s.handleCalibrationClick(50, 500);
  s.confirmCalibrationValues(['0']);
  s.handleCalibrationClick(50, 100);
  s.confirmCalibrationValues(['10']);
  walkCategoryAxis(s, { from, to, count });
  expect(s.runCalibration()).toBe(true);
  return s;
}

const xs = (points: readonly { x: number }[]) => points.map((p) => Math.round(p.x * 1000) / 1000);

describe('Cat 1 and Cat n are asked for as tick marks', () => {
  for (const [name, config] of BAR_FAMILY) {
    it(`given a ${name} figure at the Cat 1 and Cat n steps, the prompts ask for the first and last category's tick marks`, () => {
      const c1 = config.fixedSteps.find((s) => s.key === 'c1')!;
      const c2 = config.fixedSteps.find((s) => s.key === 'c2')!;
      expect(c1.prompt).toBe('Click the tick mark of the FIRST category');
      expect(c2.prompt).toBe('Click the tick mark of the LAST category, then enter how many CATEGORIES the figure has');
    });

    it(`given a ${name} figure, the calibration card offers no Common origin: Cat 1 is a category's tick mark, never the corner`, () => {
      expect(config.commonOrigin).toBeUndefined();
    });
  }
});

describe('ticks at centres (the default): the tick marks clicked are the first and last of n', () => {
  it('given Cat 1 and Cat n on the first and last of four tick marks, the Categories stage shows four, the first on Cat 1 and the last on Cat n', () => {
    const s = bar();
    expect(s.getCategoryAxis().getConvention()).toBe('centred');
    expect(xs(s.getCategoryAxis().getTickPoints())).toEqual([100, 200, 300, 400]);
  });

  it('given the same, a bar standing on the k-th tick mark is read into category k, the outer ones too', () => {
    const ca = bar().getCategoryAxis();
    expect([90, 100, 160, 200, 300, 400, 440].map((x) => ca.bandIndexAt({ x, y: 480 }))).toEqual([0, 0, 1, 1, 2, 3, 3]);
    expect(xs(ca.getDividerPoints())).toEqual([50, 150, 250, 350, 450]);
  });

  it('given a category axis down the side (horizontal bars), the same holds along it', () => {
    const s = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    s.setOption('isRotated', 'true');
    s.handleCalibrationClick(100, 500);
    s.confirmCalibrationValues(['0']);
    s.handleCalibrationClick(500, 500);
    s.confirmCalibrationValues(['10']);
    walkCategoryAxis(s, { from: { x: 80, y: 400 }, to: { x: 80, y: 100 }, count: 4 });
    expect(s.runCalibration()).toBe(true);
    expect(s.getCategoryAxis().getTickPoints().map((p) => Math.round(p.y))).toEqual([400, 300, 200, 100]);
  });
});

describe('ticks between categories: the tick marks clicked are the outer edges', () => {
  it('given the Categories stage switched to ticks between categories, Cat 1 and Cat n are the outer edges and three tick marks fall between', () => {
    const s = bar();
    expect(s.setCategoryTickConvention('edge')).toBe(true);
    expect(xs(s.getCategoryAxis().getTickPoints())).toEqual([175, 250, 325]);
    expect(xs(s.getCategoryAxis().getDividerPoints())).toEqual([100, 175, 250, 325, 400]);
  });

  it('given it switched back to centres, the tick marks go back, and the Cat 1 and Cat n handles never moved', () => {
    const s = bar();
    s.setCategoryTickConvention('edge');
    s.setCategoryTickConvention('centred');
    expect(xs(s.getCategoryAxis().getTickPoints())).toEqual([100, 200, 300, 400]);
    const placed = s.getPlacedPoints();
    expect([placed['c1']!.px, placed['c2']!.px]).toEqual([100, 400]);
  });

  it('given ticks between categories and the calibration run again (an option changed), the edges stay on Cat 1 and Cat n', () => {
    const s = bar();
    s.setCategoryTickConvention('edge');
    s.setOption('isLog', 'false');
    s.runCalibration();
    expect(xs(s.getCategoryAxis().getDividerPoints())).toEqual([100, 175, 250, 325, 400]);
  });
});

describe('the tick marks survive the other entrances', () => {
  it('given a tick dragged and the calibration run again, the dragged tick stays where it was put', () => {
    const s = bar();
    expect(s.moveCategoryTick(1, { x: 210, y: 500 })).toBe(true);
    s.runCalibration();
    expect(xs(s.getCategoryAxis().getTickPoints())).toEqual([100, 210, 300, 400]);
  });

  it('given the picture turned, the first tick mark is still on Cat 1 and the last on Cat n', () => {
    const s = bar();
    s.transformAllPixels((x, y) => ({ x: 1000 - y, y: x }));
    const ticks = s.getCategoryAxis().getTickPoints();
    const placed = s.getPlacedPoints();
    expect(Math.hypot(ticks[0]!.x - placed['c1']!.px, ticks[0]!.y - placed['c1']!.py)).toBeLessThan(1e-6);
    expect(Math.hypot(ticks[3]!.x - placed['c2']!.px, ticks[3]!.y - placed['c2']!.py)).toBeLessThan(1e-6);
  });

  it('given undo, the tick marks come back where they were', () => {
    const s = bar();
    const snap = s.captureState();
    s.setCategoryTickConvention('edge');
    s.restoreState(snap);
    s.runCalibration();
    expect(xs(s.getCategoryAxis().getTickPoints())).toEqual([100, 200, 300, 400]);
  });
});

describe('a project saved before v2.7 clicked the outer edges', () => {
  /** The same chart as a file from before v2.7 stores it: no word on what the clicks were. */
  function savedBeforeV27(): CalibrationSession<BarAxes> {
    const s = bar(4, { x: 50, y: 500 }, { x: 450, y: 500 });
    const snap = s.captureState();
    const data = JSON.parse(JSON.stringify(snap.plotData)) as { categoryAxisColl: { geometry: Record<string, unknown> }[] };
    const geometry = data.categoryAxisColl[0]!.geometry;
    delete geometry['clicked'];
    geometry['edges'] = [{ x: 50, y: 500 }, { x: 450, y: 500 }];
    geometry['ticks'] = [0.125, 0.375, 0.625, 0.875];
    s.restoreState({ ...snap, plotData: data as never });
    return s;
  }

  it('given such a project, its categories open where they were: four bands from x = 50 to 450', () => {
    const s = savedBeforeV27();
    expect(xs(s.getCategoryAxis().getDividerPoints())).toEqual([50, 150, 250, 350, 450]);
  });

  it('given such a project and the calibration run again, they stay there', () => {
    const s = savedBeforeV27();
    s.runCalibration();
    expect(xs(s.getCategoryAxis().getDividerPoints())).toEqual([50, 150, 250, 350, 450]);
  });
});

describe('one category', () => {
  it('given one category, there is one tick mark to click, so the two clicks are its outer edges', () => {
    const s = bar(1);
    expect(xs(s.getCategoryAxis().getDividerPoints())).toEqual([100, 400]);
  });
});
