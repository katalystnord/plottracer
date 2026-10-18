/**
 * The tick marks read with the labels, drawn with the app's own tick mark graphics (David,
 * 2026-10-18: "Why are you not using the same tick mark graphics that we had developed before?").
 */
import { describe, expect, it } from 'vitest';
import { labelTickGlyphs } from '../labelTickOverlay.js';
import { CATEGORY_TICK_COLOR } from '../categoryTickOverlay.js';
import type { AxesFromLabels, AxisFromLabels } from '../labelCalibration.js';

const box = { x0: 0, y0: 0, x1: 1, y1: 1 };
const axis = (a: 'x' | 'y', side: 'bottom' | 'top' | 'left' | 'right', ticks: [number, number][]): AxisFromLabels => ({
  axis: a, ok: true, log: false, side, second: null, unused: [],
  pairs: ticks.map((t, i) => ({ value: i, label: String(i), labelBox: box, tick: t })),
});
const read = (x: AxisFromLabels, y: AxisFromLabels): AxesFromLabels => ({ x, y, points: null });

describe('the read tick marks, drawn as the category ticks are', () => {
  const r = read(
    axis('x', 'bottom', [[300, 400], [100, 400], [200, 400]]),
    axis('y', 'left', [[50, 300], [50, 100]])
  );
  const g = labelTickGlyphs(r);

  it('one axis line and one mark per tick, in the structure violet, with no grip (not adjustable yet)', () => {
    expect(g).toHaveLength(2 + 3 + 2);
    expect(g.every((x) => x.color === CATEGORY_TICK_COLOR && x.grip === null && x.markerId === null)).toBe(true);
  });

  it('an X axis along the bottom: the line runs the ticks\' span, the marks stand DOWN, toward the labels', () => {
    expect(g[0]!.segments[0]).toEqual({ from: { x: 100, y: 400 }, to: { x: 300, y: 400 } });
    const marks = g.slice(1, 4).map((m) => m.segments[0]!);
    expect(marks.every((s) => s.from.y === 400 && s.to.y > 400 && s.to.x === s.from.x)).toBe(true);
  });

  it('a Y axis along the left: the marks stand LEFT, toward the labels', () => {
    const marks = g.slice(5).map((m) => m.segments[0]!);
    expect(marks.every((s) => s.from.x === 50 && s.to.x < 50 && s.to.y === s.from.y)).toBe(true);
  });

  it('an axis along the top stands its marks up, one along the right stands them right', () => {
    const t = labelTickGlyphs(read(axis('x', 'top', [[100, 20], [200, 20]]), axis('y', 'right', [[500, 300], [500, 100]])));
    expect(t[1]!.segments[0]!.to.y).toBeLessThan(20);
    expect(t[4]!.segments[0]!.to.x).toBeGreaterThan(500);
  });

  it('a refused axis draws nothing', () => {
    const t = labelTickGlyphs(read({ axis: 'x', ok: false, reason: 'r', pairs: [], unused: [] }, axis('y', 'left', [[50, 300], [50, 100]])));
    expect(t).toHaveLength(1 + 2);
  });
});
