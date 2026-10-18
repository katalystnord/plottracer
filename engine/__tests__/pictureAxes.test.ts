/**
 * [Read graph axis] on a picture (engine/pictureAxes.ts): a detector's boxes and the reads of its
 * label crops, assembled as the research measured them and read by labelCalibration.ts unchanged.
 * The figure here is built by hand, as a detector would report it: an X axis along y = 300 with
 * ticks every 50 px from x = 100, a Y axis along x = 100 with ticks every 50 px up from y = 300.
 */
import { describe, expect, it } from 'vitest';
import { cropTexts, labelCrops, pictureAxes, tickStrokes, type CropRead, type Detection } from '../pictureAxes.js';

const size = { width: 500, height: 400 };
const box = (x0: number, y0: number, x1: number, y1: number) => ({ x0, y0, x1, y1 });

/** Ticks pointing out of the plot, 6 px long; labels 12 px high, just beyond the tick's end. */
function figure(xs: string[], ys: string[], score = 0.9): { dets: Detection[]; text: Map<string, string> } {
  const dets: Detection[] = [];
  const text = new Map<string, string>();
  xs.forEach((s, i) => {
    const x = 100 + 50 * i;
    dets.push({ cls: 'x_tick', box: box(x - 1, 300, x + 1, 306), score });
    const b = box(x - 4 * s.length, 309, x + 4 * s.length, 321);
    dets.push({ cls: 'x_tick_label', box: b, score });
    text.set(`${Math.round(b.x0) - 1},${Math.round(b.y0) - 1}`, s);
  });
  ys.forEach((s, i) => {
    const y = 300 - 50 * i;
    dets.push({ cls: 'y_tick', box: box(94, y - 1, 100, y + 1), score });
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

describe('the axes read from a picture through a detector and the reader', () => {
  it('a figure whose ticks and labels are all found reads both axes, with the four calibration points', () => {
    const { dets, text } = figure(['0', '2', '4', '6', '8'], ['0', '10', '20', '30', '40']);
    const r = pictureAxes(dets, readAll(dets, text), size);
    expect(r.x.ok && r.x.pairs.map((p) => p.value)).toEqual([0, 2, 4, 6, 8]);
    expect(r.y.ok && r.y.pairs.map((p) => p.value).sort((a, b) => a - b)).toEqual([0, 10, 20, 30, 40]);
    expect(r.points).not.toBeNull();
  });

  it('a label misread at low confidence is corrected from its neighbours, as on a PDF', () => {
    const { dets, text } = figure(['0', '2', '4', '6', '8'], ['0', '10', '20', '30', '40']);
    const reads = readAll(dets, text);
    const crops = labelCrops(dets, size);
    const i = crops.findIndex((c) => text.get(`${c.box.x0},${c.box.y0}`) === '6' && c.box.y0 > 300);
    reads[i] = [{ text: '8', confidence: 40 }];
    const r = pictureAxes(dets, reads, size);
    expect(r.x.ok && r.x.pairs.map((p) => p.value)).toEqual([0, 2, 4, 6, 8]);
    expect(r.x.ok && r.x.pairs.find((p) => p.value === 6)!.vetted?.read).toBe('8');
  });

  it('labels the reader is unsure of cannot vouch for a correction: the misread axis is refused, not guessed', () => {
    const { dets, text } = figure(['0', '2', '4', '6', '8'], ['0', '10', '20', '30', '40']);
    const reads = readAll(dets, text).map((rs) => rs.map((r) => ({ ...r, confidence: 50 })));
    const crops = labelCrops(dets, size);
    const i = crops.findIndex((c) => text.get(`${c.box.x0},${c.box.y0}`) === '6' && c.box.y0 > 300);
    reads[i] = [{ text: '8', confidence: 40 }];
    const r = pictureAxes(dets, reads, size);
    expect(r.x.ok).toBe(false);
    expect(r.points).toBeNull();
  });

  it('boxes the detector is unsure of (below 0.5) are not used', () => {
    const { dets, text } = figure(['0', '2', '4'], ['0', '10', '20'], 0.4);
    expect(labelCrops(dets, size)).toEqual([]);
    expect(tickStrokes(dets, 1.4)).toEqual([]);
    const r = pictureAxes(dets, readAll(dets, text), size);
    expect(r.x.ok).toBe(false);
    expect(r.points).toBeNull();
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

  it('a tick mark is a stroke across its axis, 2 pt each way from the box\'s middle, with the detector\'s score', () => {
    const s = tickStrokes([
      { cls: 'x_tick', box: box(99, 300, 101, 306), score: 0.8 },
      { cls: 'y_tick', box: box(94, 249, 100, 251), score: 0.7 },
    ], 1.5);
    expect(s.map((x) => [x.subs[0], x.confidence])).toEqual([[[[100, 300], [100, 306]], 0.8], [[[94, 250], [100, 250]], 0.7]]);
  });
});
