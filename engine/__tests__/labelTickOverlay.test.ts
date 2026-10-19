/**
 * The tick marks read with the labels, drawn with the app's own tick mark graphics (David,
 * 2026-10-18: "Why are you not using the same tick mark graphics that we had developed before?").
 */
import { describe, expect, it } from 'vitest';
import { labelTickGlyphs, labelTickMarkers, labelTickFromId, moveLabelTick } from '../labelTickOverlay.js';
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

  it('one axis line and one mark per tick, in the structure violet; each mark with its grip, as the category ticks', () => {
    expect(g).toHaveLength(2 + 3 + 2);
    expect(g.every((x) => x.color === CATEGORY_TICK_COLOR)).toBe(true);
    const marks = g.filter((x) => x.markerId !== null);
    expect(marks).toHaveLength(5);
    expect(marks.every((m) => m.grip !== null)).toBe(true);
  });

  it('(David, 2026-10-19: "You have still not used the adjustable tick markers") each mark has its draggable handle, bound to its axis, with the same identity as its mark', () => {
    const m = labelTickMarkers(r);
    expect(m).toHaveLength(5);
    expect(m.every((x) => x.draggable === true && x.kind === 'aid' && x.dragLine !== undefined)).toBe(true);
    expect(new Set(m.map((x) => x.id))).toEqual(new Set(g.filter((x) => x.markerId !== null).map((x) => x.markerId)));
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

describe('dragging a read tick mark, by the category ticks\' rules', () => {
  const r = read(axis('x', 'bottom', [[100, 400], [200, 400], [300, 400]]), axis('y', 'left', [[50, 300], [50, 100]]));

  it('the handle\'s drop is projected onto the axis line: the tick moves along it, never off it', () => {
    const id = labelTickMarkers(r).find((m) => labelTickFromId(m.id)?.axis === 'x' && labelTickFromId(m.id)?.index === 1)!.id;
    const moved = moveLabelTick(r, id, { x: 230, y: 414 })!;
    expect(moved.x.ok && moved.x.pairs[1]!.tick).toEqual([230, 400]);
    expect(moved.x.ok && moved.x.pairs[0]!.tick).toEqual([100, 400]);
  });

  it('a tick cannot cross its neighbour', () => {
    const id = labelTickMarkers(r).find((m) => labelTickFromId(m.id)?.axis === 'x' && labelTickFromId(m.id)?.index === 1)!.id;
    const moved = moveLabelTick(r, id, { x: 350, y: 414 })!;
    const x = moved.x.ok ? moved.x.pairs[1]!.tick[0] : NaN;
    expect(x).toBeGreaterThan(100);
    expect(x).toBeLessThan(300);
  });

  it('an id that is not a read tick changes nothing', () => {
    expect(labelTickFromId('categoryTick2')).toBeNull();
    expect(moveLabelTick(r, 'x1', { x: 0, y: 0 })).toBeNull();
  });
});

describe('the read axis runs corner to corner', () => {
  it('with the points on the data area\'s corners, the axis line covers the whole axis, past the last label (David: "it needs to run to the end of the line")', () => {
    const r = {
      ...read(axis('x', 'bottom', [[100, 400], [200, 400], [300, 400]]), axis('y', 'left', [[50, 300], [50, 100]])),
      points: [{ px: 50, py: 400, x: 0, y: 0 }, { px: 380, py: 400, x: 15, y: 0 }, { px: 50, py: 400, x: 0, y: 0 }, { px: 50, py: 60, x: 0, y: 60 }],
    };
    const g = labelTickGlyphs(r);
    expect(g[0]!.segments[0]).toEqual({ from: { x: 50, y: 400 }, to: { x: 380, y: 400 } });
  });
});
