/**
 * [Read graph axis] on a picture (engine/pictureAxes.ts): the detector's plot area and label boxes, the
 * reads of the label crops and of the strip along each axis, LABELS LEADING (David, 2026-10-19: "We get the
 * axes and the axis calibration from the axis identification, not the tick marks"), read by
 * labelCalibration.ts unchanged. The figure is built by hand, as a detector would report it: a plot area
 * from (100, 50) to (450, 300); X labels every 50 px from x = 100 under it, Y labels every 50 px up from
 * y = 300 left of it. No tick marks are detected unless a case says so.
 */
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { atCorners, axisLinesNear, cropTexts, labelBands, labelCrops, labelTexts, labelTicks, onAxisLines, pictureAxes, type BandWord, type CropRead, type Detection } from '../pictureAxes.js';
import { readPng } from './helpers/readPng.js';
import { readAxesFromLabels } from '../labelCalibration.js';

const size = { width: 500, height: 400 };
const box = (x0: number, y0: number, x1: number, y1: number) => ({ x0, y0, x1, y1 });
const PLOT: Detection = { cls: 'plot_area', box: box(100, 50, 450, 300), score: 0.99 };

/** Labels 12 px high, 9 px under the X axis and 9 px left of the Y axis (where a tick of 6 px would end). */
function figure(xs: string[], ys: string[], score = 0.9): { dets: Detection[]; text: Map<string, string> } {
  const dets: Detection[] = [PLOT];
  const text = new Map<string, string>();
  xs.forEach((s, i) => {
    const x = 100 + 50 * i;
    const b = box(x - 4 * s.length, 309, x + 4 * s.length, 321);
    dets.push({ cls: 'x_tick_label', box: b, score });
    text.set(`${Math.round(b.x0) - 1},${Math.round(b.y0) - 1}`, s);
  });
  ys.forEach((s, i) => {
    const y = 300 - 50 * i;
    const b = box(91 - 8 * s.length, y - 6, 91, y + 6);
    dets.push({ cls: 'y_tick_label', box: b, score });
    text.set(`${Math.round(b.x0) - 1},${Math.round(b.y0) - 1}`, s);
  });
  return { dets, text };
}

/** A reader that reads every crop right, at 95% confidence, at every turn it is asked for. */
function readAll(dets: Detection[], text: Map<string, string>): CropRead[][] {
  return labelCrops(dets, size).map((c) => c.turns.map(() => ({ text: text.get(`${c.box.x0},${c.box.y0}`) ?? '', confidence: 95 })));
}
const noBand = (dets: Detection[]) => labelBands(dets, size).map(() => [] as BandWord[]);

describe('the axes read from a picture: labels lead', () => {
  it('a figure with NO tick marks detected reads both axes from its labels alone, with the four calibration points', () => {
    const { dets, text } = figure(['0', '2', '4', '6', '8'], ['0', '10', '20', '30', '40']);
    const r = pictureAxes(dets, readAll(dets, text), noBand(dets), size);
    expect(r.x.ok && r.x.pairs.map((p) => p.value)).toEqual([0, 2, 4, 6, 8]);
    expect(r.y.ok && r.y.pairs.map((p) => p.value).sort((a, b) => a - b)).toEqual([0, 10, 20, 30, 40]);
    // each value sits where its label is centred: 2 at x = 150, 30 at y = 150
    expect(r.x.ok && r.x.pairs.find((p) => p.value === 2)!.tick[0]).toBeCloseTo(150, 5);
    expect(r.y.ok && r.y.pairs.find((p) => p.value === 30)!.tick[1]).toBeCloseTo(150, 5);
    expect(r.points).not.toBeNull();
  });

  it('tick marks the detector reports play no part, even placed wrong', () => {
    const { dets, text } = figure(['0', '2', '4', '6', '8'], ['0', '10', '20', '30', '40']);
    const misplaced: Detection[] = [100, 157, 193, 260, 290].map((x) => ({ cls: 'x_tick', box: box(x - 3, 297, x + 3, 303), score: 0.95 }));
    const all = [...dets, ...misplaced];
    const r = pictureAxes(all, readAll(all, text), noBand(all), size);
    expect(r.x.ok && r.x.pairs.find((p) => p.value === 2)!.tick[0]).toBeCloseTo(150, 5);
  });

  it('a label misread at low confidence is corrected from its neighbours, as on a PDF', () => {
    const { dets, text } = figure(['0', '2', '4', '6', '8'], ['0', '10', '20', '30', '40']);
    const reads = readAll(dets, text);
    const crops = labelCrops(dets, size);
    const i = crops.findIndex((c) => text.get(`${c.box.x0},${c.box.y0}`) === '6' && c.box.y0 > 300);
    reads[i] = [{ text: '8', confidence: 40 }];
    const r = pictureAxes(dets, reads, noBand(dets), size);
    expect(r.x.ok && r.x.pairs.map((p) => p.value)).toEqual([0, 2, 4, 6, 8]);
    expect(r.x.ok && r.x.pairs.find((p) => p.value === 6)!.vetted?.read).toBe('8');
  });

  it('labels the reader is unsure of cannot vouch for a correction: the misread axis is refused, not guessed', () => {
    const { dets, text } = figure(['0', '2', '4', '6', '8'], ['0', '10', '20', '30', '40']);
    const reads = readAll(dets, text).map((rs) => rs.map((r) => ({ ...r, confidence: 50 })));
    const crops = labelCrops(dets, size);
    const i = crops.findIndex((c) => text.get(`${c.box.x0},${c.box.y0}`) === '6' && c.box.y0 > 300);
    reads[i] = [{ text: '8', confidence: 40 }];
    const r = pictureAxes(dets, reads, noBand(dets), size);
    expect(r.x.ok).toBe(false);
    expect(r.points).toBeNull();
  });

  it('a label the detector missed but PaddleOCR found in the strip is a label too', () => {
    const { dets, text } = figure(['0', '2', '4', '6', '8'], ['0', '10', '20', '30', '40']);
    // the detector misses "4" and "8" under the X axis
    const kept = dets.filter((d) => !(d.cls === 'x_tick_label' && (Math.abs((d.box.x0 + d.box.x1) / 2 - 200) < 1 || Math.abs((d.box.x0 + d.box.x1) / 2 - 300) < 1)));
    const bands = labelBands(kept, size);
    const words = bands.map((b) => (b.axis === 'x'
      ? [['4', 200], ['8', 300]].map(([s, x]) => ({ text: String(s), confidence: 96, bbox: box(((x as number) - 4 - b.box.x0) * b.factor, (309 - b.box.y0) * b.factor, ((x as number) + 4 - b.box.x0) * b.factor, (321 - b.box.y0) * b.factor) }))
      : []));
    const r = pictureAxes(kept, readAll(kept, text), words, size);
    expect(r.x.ok && r.x.pairs.map((p) => p.value)).toEqual([0, 2, 4, 6, 8]);
  });
});

describe('the strips along the axes', () => {
  const { dets } = figure(['0', '2', '4', '6', '8'], ['0', '10', '20', '30', '40']);
  const [x, y] = labelBands(dets, size);

  it('the X strip starts at the labels\' tops, short of the tick marks, and runs out past the labels', () => {
    expect(x!.axis).toBe('x');
    expect(x!.box.y0).toBe(307); // labels start at 309: two pixels above, never up at the axis (300)
    expect(x!.box.y1).toBe(325);
  });

  it('the Y strip ends at the labels\' right edge, short of the tick marks', () => {
    expect(y!.axis).toBe('y');
    expect(y!.box.x1).toBe(93); // labels end at 91; the axis is at 100
  });

  it('a strip is enlarged so 12 px labels read at least 32 px high', () => {
    expect(x!.factor).toBe(3);
  });

  it('no plot area, no strips', () => {
    expect(labelBands(dets.filter((d) => d.cls !== 'plot_area'), size)).toEqual([]);
  });
});

describe('the crops\' reads and the strips\' words, combined', () => {
  const crops = labelCrops([{ cls: 'x_tick_label', box: box(146, 309, 154, 321), score: 0.9 }], size);
  const band = { axis: 'x' as const, box: box(0, 300, 500, 330), factor: 2 };
  const word = (t: string, x0: number, conf = 90) => ({ text: t, confidence: conf, bbox: box((x0 - 0) * 2, (309 - 300) * 2, (x0 + 8) * 2, (321 - 300) * 2) });

  it('a strip word agreeing with a crop raises its confidence', () => {
    const t = labelTexts(crops, [[{ text: '2', confidence: 70 }]], [band], [[word('2', 146, 97)]]);
    expect(t).toHaveLength(1);
    expect(t[0]!.confidence).toBe(97);
  });

  it('a strip word differing from a crop is an alternative the vetting can try', () => {
    const t = labelTexts(crops, [[{ text: '7', confidence: 70 }]], [band], [[word('2', 146)]]);
    expect(t).toHaveLength(1);
    expect(t[0]!.alternatives).toContain('2');
  });

  it('a strip word with no crop is added, placed back in the figure\'s pixels', () => {
    const t = labelTexts(crops, [[{ text: '2', confidence: 90 }]], [band], [[word('4', 196)]]);
    expect(t.map((x) => x.str)).toEqual(['2', '4']);
    expect(t[1]!.box).toEqual(box(196, 309, 204, 321));
  });
});

describe('labels lead: each numeric label\'s centre on the plot area\'s edge', () => {
  it('an X label gives a stroke across the bottom edge at its centre; a Y label across the left edge; a word without a digit, none', () => {
    const texts = [
      { str: '20', box: box(142, 309, 158, 321), size: 12 },
      { str: '30', box: box(75, 144, 91, 156), size: 12 },
      { str: 'Time', box: box(250, 330, 290, 342), size: 12 },
    ];
    const s = labelTicks(texts, [PLOT], 1.5);
    expect(s.map((x) => x.subs[0])).toEqual([[[150, 297], [150, 303]], [[97, 150], [103, 150]]]);
  });
});

describe('the label crops and their reads', () => {

  it('a crop gets a pixel of margin, clipped to the figure', () => {
    const c = labelCrops([{ cls: 'x_tick_label', box: box(0.4, 10.2, 20.6, 22), score: 0.9 }], size);
    expect(c).toEqual([{ box: box(0, 9, 22, 23), turns: [0] }]);
  });

  it('a crop taller than it is wide is read as printed and turned a quarter each way', () => {
    const c = labelCrops([{ cls: 'y_tick_label', box: box(10, 10, 22, 50), score: 0.9 }], size);
    expect(c[0]!.turns).toEqual([0, 90, 270]);
  });

  it('the most confident non-empty read is the text, the other reads its alternatives', () => {
    const crops = labelCrops([{ cls: 'y_tick_label', box: box(10, 10, 22, 50), score: 0.9 }], size);
    const t = cropTexts(crops, [[{ text: 'ON', confidence: 60 }, { text: '20', confidence: 97 }, { text: ' ', confidence: 99 }]]);
    expect(t).toEqual([{ str: '20', box: crops[0]!.box, size: 42, confidence: 97, alternatives: ['ON'] }]);
  });

  it('a crop with nothing read gives no text', () => {
    const crops = labelCrops([{ cls: 'x_tick_label', box: box(10, 10, 30, 22), score: 0.9 }], size);
    expect(cropTexts(crops, [[{ text: '', confidence: 0 }]])).toEqual([]);
  });

});

describe('the axis points sit on the drawn axis line, found near the detector\'s rough edge', () => {
  // ⚑ David, 2026-10-19, on a picture read with the points a few pixels off the axis: "I would like to adjust
  // it" ... "we have to be able to use also an axis line detector for this?" The detector's plot box is an
  // estimate (run 1: half its edges within 2 px); the drawn axis line is measured with the heatmap grid's own
  // rule finder (algorithms/gridDetect.ts detectDividers). Fixtures: algorithms/__tests__/fixtures/ticks, real
  // rendered figures with their axis lines in the truth files.
  const T = path.resolve(import.meta.dirname, '../../algorithms/__tests__/fixtures/ticks');
  for (const name of ['ticks-out', 'ticks-in', 'histogram-ticks-out']) {
    it(`${name}: a plot box 5 px off both axes is snapped onto the drawn lines`, () => {
      const img = readPng(path.join(T, `${name}.png`));
      const truth = JSON.parse(readFileSync(path.join(T, `${name}.truth.json`), 'utf8')) as { axes: Record<'x' | 'y', { from: [number, number]; to: [number, number] }> };
      const xLine = truth.axes.x.from[1], yLine = truth.axes.y.from[0];
      const right = truth.axes.x.to[0], top = truth.axes.y.from[1]; // y.from is the top
      const rough: Detection = { cls: 'plot_area', box: box(yLine + 5, top + 5, right - 5, xLine - 5), score: 0.99 };
      const lines = axisLinesNear(img, [rough]);
      expect(Math.abs(lines.x! - xLine), 'X axis').toBeLessThanOrEqual(1.5);
      expect(Math.abs(lines.y! - yLine), 'Y axis').toBeLessThanOrEqual(1.5);
      // the data area's other two edges, on the frame the figure draws
      expect(Math.abs(lines.right! - right), 'right edge').toBeLessThanOrEqual(1.5);
      expect(Math.abs(lines.top! - top), 'top edge').toBeLessThanOrEqual(1.5);
    });
  }

  it('the read\'s points move across the axis onto the lines, and stay where their labels put them along it', () => {
    const read = {
      x: { axis: 'x' as const, ok: true as const, log: false, side: 'bottom' as const, second: null, unused: [], pairs: [{ value: 0, label: '0', labelBox: box(96, 309, 104, 321), tick: [100, 300] as [number, number] }] },
      y: { axis: 'y' as const, ok: true as const, log: false, side: 'left' as const, second: null, unused: [], pairs: [{ value: 0, label: '0', labelBox: box(83, 294, 91, 306), tick: [100, 300] as [number, number] }] },
      points: [{ px: 100, py: 300, x: 0, y: 0 }, { px: 400, py: 300, x: 6, y: 0 }, { px: 100, py: 300, x: 0, y: 0 }, { px: 100, py: 100, x: 0, y: 40 }],
    };
    const r = onAxisLines(read, { x: 303.5, y: 98, right: null, top: null });
    expect(r.points).toEqual([{ px: 100, py: 303.5, x: 0, y: 0 }, { px: 400, py: 303.5, x: 6, y: 0 }, { px: 98, py: 300, x: 0, y: 0 }, { px: 98, py: 100, x: 0, y: 40 }]);
    expect(r.x.ok && r.x.pairs[0]!.tick).toEqual([100, 303.5]);
    expect(r.y.ok && r.y.pairs[0]!.tick).toEqual([98, 300]);
  });

  it('no line found, nothing moves', () => {
    const read = { x: { axis: 'x' as const, ok: false as const, reason: 'r', pairs: [], unused: [] }, y: { axis: 'y' as const, ok: false as const, reason: 'r', pairs: [], unused: [] }, points: null };
    expect(onAxisLines(read, { x: null, y: null, right: null, top: null })).toEqual(read);
  });
});

describe('A) the corners of the data area, B) each axis\'s value range at them', () => {
  // ⚑ David, 2026-10-19: "A) Marking the corners of the data area, 3 points is all that is normally required.
  // Then B) ascribing each axis a value range or category range ... ascribing an axis values is not physically
  // connected to being alongside the markers for the data area. We just need to translate points in the data
  // area to points along a scale." The labels give each axis's scale; the corners are where the points go.
  const pair = (value: number, at: number, axis: 'x' | 'y') => ({ value, label: String(value), labelBox: box(0, 0, 1, 1), tick: (axis === 'x' ? [at, 300] : [100, at]) as [number, number] });
  const read = {
    x: { axis: 'x' as const, ok: true as const, log: false, side: 'bottom' as const, second: null, unused: [], pairs: [0, 2, 4, 6, 8].map((v, i) => pair(v, 100 + 50 * i, 'x')) },
    y: { axis: 'y' as const, ok: true as const, log: false, side: 'left' as const, second: null, unused: [], pairs: [0, 10, 20, 30, 40].map((v, i) => pair(v, 300 - 50 * i, 'y')) },
    points: [{ px: 100, py: 300, x: 0, y: 0 }, { px: 300, py: 300, x: 8, y: 0 }, { px: 100, py: 300, x: 0, y: 0 }, { px: 100, py: 100, x: 0, y: 40 }],
  };

  it('the points go on the corners: X1 = Y1 at the origin, X2 at the X axis\'s end, Y2 at the Y axis\'s top, each with the value its scale gives there', () => {
    const r = atCorners(read, { x0: 80, y0: 60, x1: 420, y1: 300 });
    expect(r.points).toEqual([
      { px: 80, py: 300, x: -0.8, y: 0 },
      { px: 420, py: 300, x: 12.8, y: 0 },
      { px: 80, py: 300, x: -0.8, y: 0 },
      { px: 80, py: 60, x: -0.8, y: 48 },
    ]);
  });

  it('a corner value is rounded to a tenth of the label step', () => {
    const r = atCorners(read, { x0: 80, y0: 60, x1: 423, y1: 300 });
    expect(r.points![1]!.x).toBe(13); // 12.92, to the nearest tenth of the step (2): 0.2
  });

  it('a log axis takes its range on the log scale', () => {
    const logRead = { ...read, y: { ...read.y, log: true, pairs: [1, 10, 100].map((v, i) => pair(v, 300 - 100 * i, 'y')) } };
    const r = atCorners(logRead, { x0: 80, y0: 50, x1: 420, y1: 300 });
    expect(r.points![3]!.y).toBeCloseTo(10 ** 2.5, 0); // 50 px above 100, half a decade
  });

  it('an axis not read keeps no points', () => {
    const bad = { ...read, y: { axis: 'y' as const, ok: false as const, reason: 'r', pairs: [], unused: [] }, points: null };
    expect(atCorners(bad, { x0: 80, y0: 60, x1: 420, y1: 300 }).points).toBeNull();
  });
});

describe('a label used by one axis is not reported unused on the other', () => {
  it('the Y axis\'s "0" at the corner is not "not used on X" (the real read of a bundled picture)', () => {
    const f = JSON.parse(readFileSync(path.join(import.meta.dirname, 'fixtures/corner-label.json'), 'utf8'));
    const r = readAxesFromLabels({ shapes: f.shapes, text: f.text.map((t: { box: unknown }) => t.box), pxPerPt: f.pxPerPt }, f.text, f.size);
    const key = (b: { x0: number; y0: number; x1: number; y1: number }) => `${b.x0},${b.y0},${b.x1},${b.y1}`;
    const pairedX = new Set(r.x.pairs.map((p) => key(p.labelBox))), pairedY = new Set(r.y.pairs.map((p) => key(p.labelBox)));
    expect(r.y.ok && r.y.pairs.some((p) => p.value === 0), 'the Y axis uses its "0"').toBe(true);
    expect(r.x.unused.filter((u) => u.label !== null && pairedY.has(key(u.box))), 'unused on X but paired on Y').toEqual([]);
    expect(r.y.unused.filter((u) => u.label !== null && pairedX.has(key(u.box))), 'unused on Y but paired on X').toEqual([]);
  });
});

describe('labels printed with a unit sign', () => {
  it('a percent axis ("70%" ... "90%") reads as 70 ... 90, the numbers the figure prints (a real figure, 2026-10-19)', () => {
    const { dets, text } = figure(['10', '20', '30', '40', '50'], ['70%', '75%', '80%', '85%', '90%']);
    const r = pictureAxes(dets, readAll(dets, text), noBand(dets), size);
    expect(r.y.ok && r.y.pairs.map((p) => p.value).sort((a, b) => a - b)).toEqual([70, 75, 80, 85, 90]);
  });

  it('an axis with no number read says so, not "no label sits at a tick mark": on a picture tick marks take no part', () => {
    const { dets, text } = figure(['10', '20', '30', '40', '50'], ['a', 'b', 'c', 'd', 'e']);
    const r = pictureAxes(dets, readAll(dets, text), noBand(dets), size);
    expect(!r.y.ok && r.y.reason).toBe('no numbers were read along it');
  });
});

describe('a second axis on a picture is reported, as on a PDF', () => {
  it('tick labels beyond the plot\'s right edge: "a second Y axis along the right is not read" (a real figure with a pH axis on the right, 2026-10-19)', () => {
    const { dets, text } = figure(['0', '2', '4', '6', '8'], ['0', '10', '20', '30', '40']);
    const right: Detection[] = [300, 250, 200, 150].map((y) => ({ cls: 'y_tick_label', box: box(456, y - 6, 470, y + 6), score: 0.9 }));
    const all = [...dets, ...right];
    const r = pictureAxes(all, readAll(all, text), noBand(all), size);
    expect(r.y.ok && r.y.second).toBe('right');
    expect(r.x.ok && r.x.second).toBeNull();
  });
});
