import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { barCalibrationFromLabels, categoryCentresFromLabels } from '../axisDetection.js';
import type { AxesFromLabels } from '../labelCalibration.js';

/**
 * [Automatic axis detection] on a bar-family figure (v2.7; David's item "bar automatic axis detection P1/P2 and
 * Cat 1/Cat n"; the walk notes, "The category axis on two tick marks"): P1 and P2 on the value axis's outermost
 * labelled tick marks, with their numbers; Cat 1 and Cat n on the first and last category's tick marks, found
 * where the category labels are centred, and the count of categories.
 */

const FRAME = { x: 100, y: 50, width: 400, height: 300 };
const label = (cx: number, cy: number, w = 30, h = 12) => ({ x0: cx - w / 2, y0: cy - h / 2, x1: cx + w / 2, y1: cy + h / 2 });

describe('the categories, from the labels beside the category axis', () => {
  it('given four category labels under an upright bar chart, the categories are their centres, left to right', () => {
    const labels = [label(400, 365), label(150, 365), label(250, 365), label(350, 365)];
    expect(categoryCentresFromLabels(labels, FRAME, 'bottom')).toEqual([150, 250, 350, 400]);
  });

  it('given a two-word label, it is one category, centred between its words', () => {
    // the words 228..252 and 256..280: a 4 px gap, a third of the labels' height
    const labels = [label(150, 365), label(240, 365, 24), label(268, 365, 24), label(400, 365)];
    expect(categoryCentresFromLabels(labels, FRAME, 'bottom')).toEqual([150, 254, 400]);
  });

  it('given an axis title further out and value labels left of the plot, neither is a category', () => {
    const labels = [label(150, 365), label(300, 365), label(450, 365), label(300, 395, 120), label(80, 200), label(80, 100)];
    expect(categoryCentresFromLabels(labels, FRAME, 'bottom')).toEqual([150, 300, 450]);
  });

  it('given horizontal bars with wide labels close together, each label is still its own category', () => {
    // 60 px wide and 12 px tall, 20 px apart: the 8 px between them is a gap between labels, not between words
    const labels = [label(60, 100, 60, 12), label(60, 120, 60, 12), label(60, 140, 60, 12), label(60, 160, 60, 12)];
    expect(categoryCentresFromLabels(labels, FRAME, 'left')).toEqual([160, 140, 120, 100]);
  });

  it('given horizontal bars, the categories are the labels left of the plot, bottom to top', () => {
    const labels = [label(70, 100), label(70, 200), label(70, 300), label(300, 365)];
    expect(categoryCentresFromLabels(labels, FRAME, 'left')).toEqual([300, 200, 100]);
  });
});

const yRead = (pairs: [number, number][]): AxesFromLabels['y'] => ({
  axis: 'y', ok: true, log: false, side: 'left', second: null, unused: [],
  pairs: pairs.map(([py, value]) => ({ value, label: String(value), labelBox: label(80, py), tick: [100, py] as [number, number] })),
});
const notRead: AxesFromLabels['x'] = { axis: 'x', ok: false, reason: 'no label sits at a tick mark', pairs: [], unused: [] };

describe('what the button places on a bar chart', () => {
  it('given the value labels 0 to 30 and four categories, P1 and P2 sit on 0 and 30, and Cat 1 and Cat n on the first and last category, on the axis line, with the count 4', () => {
    const read: AxesFromLabels = { x: notRead, y: yRead([[350, 0], [250, 10], [150, 20], [50, 30]]), points: null };
    const labels = [label(150, 365), label(250, 365), label(350, 365), label(450, 365)];
    const got = barCalibrationFromLabels(read, labels, FRAME, false)!;
    expect(got.value).toEqual([{ px: 100, py: 350, value: 0 }, { px: 100, py: 50, value: 30 }]);
    expect(got.categories).toEqual({ first: { px: 150, py: 350 }, last: { px: 450, py: 350 }, count: 4 });
  });

  it('given no value labels read, the categories are still placed', () => {
    const read: AxesFromLabels = { x: notRead, y: { ...notRead, axis: 'y' }, points: null };
    const got = barCalibrationFromLabels(read, [label(150, 365), label(450, 365)], FRAME, false)!;
    expect(got.value).toEqual([]);
    expect(got.categories?.count).toBe(2);
  });

  it('given a horizontal bar chart while Horizontal bars is not ticked (numbers along the bottom, words up the side), no category is placed and the answer says the axes look the other way round', () => {
    const xNumbers: AxesFromLabels['x'] = {
      axis: 'x', ok: true, log: false, side: 'bottom', second: null, unused: [],
      pairs: [0, 10, 20, 30].map((v, i) => ({ value: v, label: String(v), labelBox: label(150 + 100 * i, 365), tick: [150 + 100 * i, 350] as [number, number] })),
    };
    const read: AxesFromLabels = { x: xNumbers, y: { ...notRead, axis: 'y' }, points: null };
    const labels = [label(150, 365), label(250, 365), label(350, 365), label(450, 365), label(70, 100), label(70, 200)];
    const got = barCalibrationFromLabels(read, labels, FRAME, false)!;
    expect(got.categories).toBeNull();
    expect(got.value).toEqual([]);
    expect(got.otherWayRound).toBe(true);
  });

  it('given nothing read on either axis, nothing is placed', () => {
    const read: AxesFromLabels = { x: notRead, y: { ...notRead, axis: 'y' }, points: null };
    expect(barCalibrationFromLabels(read, [], FRAME, false)).toBeNull();
  });
});

describe('measured on the shipped grouped-bar figure, from the chart-element detector’s own boxes', () => {
  it('given bar-grouped-viability’s x tick label boxes and its plot area, the four categories land within 3 px of the tick marks drawn under them', () => {
    const fixture = JSON.parse(readFileSync('engine/__tests__/fixtures/figdet/bar-grouped-viability.predict.json', 'utf8')) as {
      detections: { cls: string; box: [number, number, number, number]; score: number }[];
    };
    const box = (b: [number, number, number, number]) => ({ x0: b[0], y0: b[1], x1: b[2], y1: b[3] });
    const plot = box(fixture.detections.find((d) => d.cls === 'plot_area')!.box);
    const frame = { x: plot.x0, y: plot.y0, width: plot.x1 - plot.x0, height: plot.y1 - plot.y0 };
    const labels = fixture.detections.filter((d) => d.cls === 'x_tick_label' && d.score >= 0.5).map((d) => box(d.box));
    const centres = categoryCentresFromLabels(labels, frame, 'bottom');
    // the tick marks drawn under the four groups, measured off the PNG (samples/bar-grouped-viability.truth.json c1/c2)
    const truth = JSON.parse(readFileSync('samples/bar-grouped-viability.truth.json', 'utf8')) as { calibration: { anchors: Record<string, { px: number; value?: number }> } };
    const a = truth.calibration.anchors;
    expect(centres).toHaveLength(a['c2']!.value!);
    expect(Math.abs(centres[0]! - a['c1']!.px)).toBeLessThan(3);
    expect(Math.abs(centres[centres.length - 1]! - a['c2']!.px)).toBeLessThan(3);
  });
});
