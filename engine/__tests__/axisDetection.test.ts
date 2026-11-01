import { describe, expect, it } from 'vitest';
import { calibrationFromLabels } from '../axisDetection.js';
import type { AxesFromLabels, AxisFromLabels, LabelPair } from '../labelCalibration.js';

/**
 * [Automatic axis detection] on the calibration card (David, 2026-10-31 and 2026-11-01; docs/v2.7-workflow-walk.md,
 * step 3). Every calibration point that can be detected is placed, each with the number printed at its tick; the
 * origin is shared only when the corner where the axes meet is labelled on both axes (option C: "Yes, C."),
 * otherwise X1 and Y1 are two points on their own labelled ticks. Every number is one printed on the figure.
 */

const pair = (value: number, tick: [number, number]): LabelPair => ({
  value,
  label: String(value),
  labelBox: { x0: tick[0] - 5, y0: tick[1] + 5, x1: tick[0] + 5, y1: tick[1] + 15 },
  tick,
});
const axis = (a: 'x' | 'y', pairs: LabelPair[], log = false): AxisFromLabels => ({ axis: a, ok: true, log, pairs, unused: [], side: a === 'x' ? 'bottom' : 'left', second: null });
const refused = (a: 'x' | 'y'): AxisFromLabels => ({ axis: a, ok: false, reason: 'only one number was read along it', pairs: [], unused: [] });
const read = (x: AxisFromLabels, y: AxisFromLabels): AxesFromLabels => ({ x, y, points: null });

// a plot whose axes meet at (100, 400): X runs to (500, 400), Y up to (100, 100)
const xFromCorner = axis('x', [pair(0, [100, 400]), pair(50, [300, 400]), pair(100, [500, 400])]);
const yFromCorner = axis('y', [pair(0, [100, 400]), pair(1000, [100, 250]), pair(2000, [100, 100])]);

describe('Automatic axis detection places the points it can read', () => {
  it('the corner labelled on both axes (0 and 0, like the spectrum): one shared origin, X2 and Y2', () => {
    const c = calibrationFromLabels(read(xFromCorner, yFromCorner))!;
    expect(c.sharedOrigin).toBe(true);
    expect(c.points).toEqual([
      { key: 'x1', px: 100, py: 400, value: 0 },
      { key: 'x2', px: 500, py: 400, value: 100 },
      { key: 'y1', px: 100, py: 400, value: 0 },
      { key: 'y2', px: 100, py: 100, value: 2000 },
    ]);
  });

  it('the corner not labelled on both axes: X1 and Y1 on their own first labelled ticks, two points', () => {
    const x = axis('x', [pair(20, [140, 400]), pair(100, [500, 400])]);
    const y = axis('y', [pair(500, [100, 330]), pair(2000, [100, 100])]);
    const c = calibrationFromLabels(read(x, y))!;
    expect(c.sharedOrigin).toBe(false);
    expect(c.points).toEqual([
      { key: 'x1', px: 140, py: 400, value: 20 },
      { key: 'x2', px: 500, py: 400, value: 100 },
      { key: 'y1', px: 100, py: 330, value: 500 },
      { key: 'y2', px: 100, py: 100, value: 2000 },
    ]);
  });

  it('the outermost labelled ticks are used, whatever order they were read in, and Y1 is the bottom one', () => {
    const y = axis('y', [pair(2000, [100, 100]), pair(0, [100, 400]), pair(1000, [100, 250])]);
    const c = calibrationFromLabels(read(xFromCorner, y))!;
    expect(c.points.find((p) => p.key === 'y1')).toEqual({ key: 'y1', px: 100, py: 400, value: 0 });
    expect(c.points.find((p) => p.key === 'y2')).toEqual({ key: 'y2', px: 100, py: 100, value: 2000 });
  });

  it('one axis read and the other not: that axis\'s two points are placed, and the other is left for the user', () => {
    const c = calibrationFromLabels(read(xFromCorner, refused('y')))!;
    expect(c.sharedOrigin).toBe(false);
    expect(c.points.map((p) => p.key)).toEqual(['x1', 'x2']);
  });

  it('nothing read on either axis: nothing to place, and the caller warns that no points could be fixed', () => {
    expect(calibrationFromLabels(read(refused('x'), refused('y')))).toBeNull();
  });

  it('a log axis read as log says so, for the Log box', () => {
    const y = axis('y', [pair(1, [100, 400]), pair(1000, [100, 100])], true);
    expect(calibrationFromLabels(read(xFromCorner, y))!.log).toEqual({ x: false, y: true });
  });
});
