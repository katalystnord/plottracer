/**
 * v2.7 V5-V11 (docs/v2.7-vector-cases.md, "Calibration read from the labels"):
 * the axes read from a drawn figure's own tick labels and tick marks.
 *
 * Fixtures: fixtures/vector/make_labels.py (matplotlib), whose truth files give
 * every labelled tick's value and position from ax.transData; and the V22
 * reverse fixtures (make_reverse.py, make_reverse.R), whose data must come out
 * exactly when the calibration is the one read from the labels.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readDrawing, readTextItems, type PdfTextItem } from '../pdfDrawing.js';
import { pageToImage, placeDrawing, placeTextItems } from '../drawingPlacement.js';
import type { Provenance } from '../projectFile.js';
import { readAxesFromLabels, type AxesFromLabels, type AxisFromLabels } from '../labelCalibration.js';
import { thinFoundLine } from '../lineEdits.js';
import { findLinesFromDrawing } from '../../algorithms/findLines/fromDrawing.js';
import { XYAxes } from '../../core/axes/xy.js';
import { Calibration } from '../../core/calibration.js';

const FIX = join(__dirname, 'fixtures/vector');
type Pt = [number, number];
interface AxisTruth { limits: [number, number]; log: boolean; ticks: [number, number][] }
interface Fig {
  read: AxesFromLabels;
  at: (x: number, y: number) => Pt;
  truth: { box: number[]; x: AxisTruth; y: AxisTruth } & Record<string, unknown>;
  prov: Provenance;
  drawing: ReturnType<typeof placeDrawing>;
}
const figs: Record<string, Fig> = {};
const NAMES = ['labels-linear', 'labels-negative', 'labels-log', 'labels-unpaired', 'labels-refused', 'labels-offset',
  'reverse-mpl-lines', 'reverse-rbase-line', 'reverse-rcairo-line', 'reverse-rgg-line', 'reverse-lo-lines'];

beforeAll(async () => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  for (const name of NAMES) {
    const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(join(FIX, name + '.pdf'))), verbosity: 0 }).promise;
    const page = await doc.getPage(1);
    const vp = page.getViewport({ scale: 3.7 });
    const prov: Provenance = { source: { pageTransform: vp.transform as [number, number, number, number, number, number] } };
    const items = (await page.getTextContent()).items as PdfTextItem[];
    const drawing = placeDrawing(prov, readDrawing(await page.getOperatorList(), pdfjs.OPS as unknown as Record<string, number>), [])!;
    const text = placeTextItems(prov, readTextItems(items));
    const at = (x: number, y: number): Pt => {
      const q = pageToImage(prov, [x, y])!;
      return [q.x, q.y];
    };
    figs[name] = {
      read: readAxesFromLabels(drawing, text, { width: vp.width, height: vp.height }),
      at,
      truth: JSON.parse(readFileSync(join(FIX, name + '.truth.json'), 'utf8')),
      prov,
      drawing,
    };
  }
});

const ok = (a: AxisFromLabels) => {
  if (!a.ok) throw new Error(`the ${a.axis} axis was refused: ${a.reason}`);
  return a;
};
const values = (a: AxisFromLabels) => ok(a).pairs.map((p) => p.value).sort((p, q) => p - q);
/** Each used pair sits at its own tick mark: the truth tick of that value, in picture px. */
function expectAtOwnTicks(name: string, axis: 'x' | 'y') {
  const f = figs[name]!;
  const a = ok(f.read[axis]);
  for (const p of a.pairs) {
    const t = f.truth[axis].ticks.find(([v]) => Math.abs(v - p.value) <= 1e-9 * Math.max(1, Math.abs(v)));
    expect(t, `${name} ${axis}: ${p.label} is a labelled tick of the figure`).toBeDefined();
    const want = axis === 'x' ? f.at(t![1], 0)[0] : f.at(0, t![1])[1];
    expect(Math.abs((axis === 'x' ? p.tick[0] : p.tick[1]) - want), `${name} ${axis}: ${p.label} at its tick`).toBeLessThan(0.05);
  }
}

describe('V5: the axes read from the figure\'s labels, each label beside its own tick mark', () => {
  it('V5: given labels X 0, 20 … 100 and Y 0, 500 … 3500, the read offers exactly those, each at its own tick', () => {
    const r = figs['labels-linear']!.read;
    expect(values(r.x)).toEqual([0, 20, 40, 60, 80, 100]);
    expect(values(r.y)).toEqual([0, 500, 1000, 1500, 2000, 2500, 3000, 3500]);
    expectAtOwnTicks('labels-linear', 'x');
    expectAtOwnTicks('labels-linear', 'y');
    expect(ok(r.x).log).toBe(false);
    expect(ok(r.y).log).toBe(false);
  });

  it('V5: labels with a minus sign and decimals are read as written (−1.5 is -1.5)', () => {
    const r = figs['labels-negative']!.read;
    expect(values(r.x)).toEqual([-1.5, -1, -0.5, 0, 0.5, 1, 1.5]);
    expect(values(r.y)).toEqual([-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1]);
    expectAtOwnTicks('labels-negative', 'x');
    expectAtOwnTicks('labels-negative', 'y');
  });
});

describe('V6: the calibration filled from the paired ticks is the figure\'s own', () => {
  for (const name of ['labels-linear', 'labels-negative', 'labels-log']) {
    it(`V6 ${name}: the four points calibrate the axes so every labelled tick reads its own value`, () => {
      const f = figs[name]!;
      const pts = f.read.points;
      expect(pts, 'four calibration points are offered').not.toBeNull();
      const cal = new Calibration(2);
      for (const p of pts!) cal.addPoint(p.px, p.py, String(p.x), String(p.y));
      const axes = new XYAxes();
      expect(axes.calibrate(cal, f.read.x.ok && f.read.x.log, f.read.y.ok && f.read.y.log, false)).toBe(true);
      const [bx0, by0] = [f.truth.box[0]!, f.truth.box[1]!];
      for (const [v, x] of f.truth.x.ticks) {
        const [px, py] = f.at(x, by0);
        expect(Math.abs(axes.pixelToData(px, py)[0]! - v)).toBeLessThan(1e-3 * Math.max(1, Math.abs(v)));
      }
      for (const [v, y] of f.truth.y.ticks) {
        const [px, py] = f.at(bx0, y);
        expect(Math.abs(axes.pixelToData(px, py)[1]! - v)).toBeLessThan(1e-3 * Math.max(1, Math.abs(v)));
      }
    });
  }
});

describe('V7: a label is paired only with a tick mark drawn at it', () => {
  it('V7: a number with no tick mark at it is shown as not used, with the reason', () => {
    const a = ok(figs['labels-unpaired']!.read.x);
    expect(values(a)).toEqual([0, 2, 4, 6, 8, 10]);
    const stray = a.unused.find((u) => u.label === '7.3');
    expect(stray, 'the annotation 7.3 is listed').toBeDefined();
    expect(stray!.reason).toBe('no tick mark at it');
  });

  it('V7: a tick mark with no label is shown as not used, with the reason', () => {
    const a = ok(figs['labels-unpaired']!.read.x);
    const bare = a.unused.filter((u) => u.label === null);
    expect(bare.length, 'the minor ticks are listed').toBeGreaterThan(0);
    for (const u of bare) expect(u.reason).toBe('no label at it');
  });
});

describe('V8: an axis that cannot be read is not offered, and never guessed', () => {
  it('V8: an axis with fewer than two usable pairs says why', () => {
    const y = figs['labels-refused']!.read.y;
    expect(y.ok).toBe(false);
    if (!y.ok) expect(y.reason).toBe('only one label sits at a tick mark; two are needed');
  });

  it('V8: an axis whose labels do not fit one linear or one log scale says why', () => {
    const x = figs['labels-refused']!.read.x;
    expect(x.ok).toBe(false);
    if (!x.ok) expect(x.reason).toBe('the labels do not fit one linear or one log scale');
    expect(figs['labels-refused']!.read.points).toBeNull();
  });

  it('V8: an axis with a scale factor printed by it (1e6) is not offered, since its labels are not the values', () => {
    const y = figs['labels-offset']!.read.y;
    expect(y.ok).toBe(false);
    if (!y.ok) expect(y.reason).toBe('a scale factor (1e6) is printed by the axis, so the labels are not the values');
    expect(figs['labels-offset']!.read.x.ok).toBe(true);
  });
});

describe('V9: exponent labels mean a log axis', () => {
  it('V9: 10¹, 10², 10³, 10⁴ are read as 10, 100, 1000, 10000 and the axis is offered as log', () => {
    const y = ok(figs['labels-log']!.read.y);
    expect(values(y)).toEqual([10, 100, 1000, 10000]);
    expect(y.pairs.map((p) => p.label).sort()).toEqual(['10^1', '10^2', '10^3', '10^4']);
    expect(y.log).toBe(true);
    expectAtOwnTicks('labels-log', 'y');
    expect(ok(figs['labels-log']!.read.x).log).toBe(false);
  });
});

describe('V11: how precisely the labels pin the scale', () => {
  it('V11: half the last printed digit: 0.5 for whole numbers, 0.05 for one decimal, 0.005 for two', () => {
    expect(ok(figs['labels-linear']!.read.x).precision).toBe(0.5);
    expect(ok(figs['labels-linear']!.read.y).precision).toBe(0.5);
    expect(ok(figs['labels-negative']!.read.x).precision).toBe(0.05);
    expect(ok(figs['labels-negative']!.read.y).precision).toBe(0.005);
  });
});

describe('V22, the calibration half: read from the labels, the data come out as the figure was made', () => {
  for (const name of ['reverse-mpl-lines', 'reverse-rbase-line', 'reverse-rcairo-line', 'reverse-rgg-line', 'reverse-lo-lines']) {
    it(`V22 ${name}: a line read from the drawing, through the calibration read from its labels, is the data to its printed digits`, () => {
      const f = figs[name]!;
      const pts = f.read.points;
      expect(pts, `${name}: four calibration points are offered`).not.toBeNull();
      const cal = new Calibration(2);
      for (const p of pts!) cal.addPoint(p.px, p.py, String(p.x), String(p.y));
      const axes = new XYAxes();
      expect(axes.calibrate(cal, false, false, false)).toBe(true);
      const t = f.truth as unknown as { box: number[]; series: { colour: [number, number, number]; data: Pt[] }[] };
      const a = f.at(t.box[0]!, t.box[1]!), c = f.at(t.box[2]!, t.box[3]!);
      const box = { x0: Math.min(a[0], c[0]), y0: Math.min(a[1], c[1]), x1: Math.max(a[0], c[0]), y1: Math.max(a[1], c[1]) };
      for (const s of t.series) {
        const lines = findLinesFromDrawing(f.drawing!, s.colour, box).lines;
        expect(lines).toHaveLength(1);
        let got = thinFoundLine(lines[0]!.points, lines[0]!.roles).map((p) => axes.pixelToData(p.x, p.y) as Pt);
        if (got[0]![0] > got[got.length - 1]![0]) got = got.reverse();
        expect(got).toHaveLength(s.data.length);
        const worst = Math.max(...got.map((g, i) => Math.max(Math.abs(g[0] - s.data[i]![0]), Math.abs(g[1] - s.data[i]![1]))));
        expect(worst).toBeLessThan(0.005);
      }
    });
  }
});

/**
 * Forms met on real preprint charts (plottracer-ref research/v2.7-vector/bench,
 * labelsreal.harness.ts), each built here from made-up marks and text so the
 * rule is tested apart from the chart it was found on.
 */
describe('V5-V8 on the forms real figures take', () => {
  type T = { str: string; box: { x0: number; y0: number; x1: number; y1: number }; size: number };
  const ink = [0, 0, 0] as [number, number, number];
  const seg = (a: Pt, b: Pt) => ({ subs: [[a, b]], stroked: true, filled: false, stroke: ink, fill: ink, lineWidth: 1, dash: null });
  /** A figure in picture px (1 px a point): X axis at y = 250, Y axis at x = 50. */
  function figure(o: { x?: [number, string[]][]; y?: [number, string[]][]; xTicks?: number[]; yTicks?: number[]; inward?: boolean; top?: [number, string][]; yMidOff?: number; extra?: T[] }) {
    const shapes = [];
    const text: T[] = [...(o.extra ?? [])];
    const piece = (s: string) => (s === ',' || s === '-' || s === '−' ? 3 : 6 * s.length);
    for (const [x, pieces] of o.x ?? []) {
      const w = pieces.reduce((a, s) => a + piece(s), 0);
      let at = x - w / 2;
      for (const s of pieces) {
        const y0 = o.inward ? 248.8 : 258;
        text.push({ str: s, box: { x0: at, y0, x1: at + piece(s), y1: y0 + 10 }, size: 10 });
        at += piece(s);
      }
    }
    for (const x of o.xTicks ?? (o.x ?? []).map(([x]) => x)) shapes.push(o.inward ? seg([x, 250], [x, 246]) : seg([x, 250], [x, 254]));
    for (const [y, pieces] of o.y ?? []) {
      const w = pieces.reduce((a, s) => a + piece(s), 0);
      let at = 42 - w;
      const y1 = y + (o.yMidOff ?? 3.5);
      for (const s of pieces) {
        text.push({ str: s, box: { x0: at, y0: y1 - 10, x1: at + piece(s), y1 }, size: 10 });
        at += piece(s);
      }
    }
    for (const y of o.yTicks ?? (o.y ?? []).map(([y]) => y)) shapes.push(seg([46, y], [50, y]));
    for (const [x, s] of o.top ?? []) {
      shapes.push(seg([x, 20], [x, 16]));
      text.push({ str: s, box: { x0: x - 3 * s.length, y0: 4, x1: x + 3 * s.length, y1: 14 }, size: 10 });
    }
    return readAxesFromLabels({ shapes, text: [], pxPerPt: 1 }, text, { width: 400, height: 300 });
  }
  const xs = (vals: string[][]) => vals.map((p, i): [number, string[]] => [80 + 60 * i, p]);
  const ys = (vals: string[][]) => vals.map((p, i): [number, string[]] => [230 - 50 * i, p]);

  it('a decimal comma set as its own piece reads as a decimal point: "0" "," "05" is 0.05', () => {
    const r = figure({ x: xs([['0', ',', '05'], ['0', ',', '10'], ['0', ',', '15']]), y: ys([['0'], ['1'], ['2']]) });
    expect(values(r.x)).toEqual([0.05, 0.1, 0.15]);
  });

  it('beside a decimal comma, "0,065" is 0.065 and never 65', () => {
    const r = figure({ x: xs([['0,04'], ['0,065'], ['0,09']]), xTicks: [80, 140, 200], y: ys([['0'], ['1'], ['2']]) });
    expect(values(r.x)).toEqual([0.04, 0.065, 0.09]);
  });

  it('with no decimal comma on the figure, "1,000" is a thousands separator', () => {
    const r = figure({ x: xs([['0'], ['1,000'], ['2,000']]), y: ys([['0'], ['1'], ['2']]) });
    expect(values(r.x)).toEqual([0, 1000, 2000]);
  });

  it('a minus set as its own piece joins its number: "−" "2" is -2', () => {
    const r = figure({ x: xs([['0'], ['1'], ['2']]), y: ys([['−', '2'], ['−', '1'], ['0']]) });
    expect(values(r.y)).toEqual([-2, -1, 0]);
  });

  it('two stacked panels sharing one axis line are read as one axis, not both', () => {
    // top panel 0 ... 1000 at y 20 ... 120, the bottom panel's 0 ... 1000 at
    // y 125 ... 225: the panels touch, so the break is a SMALL gap
    const panel = (top: number) => [0, 250, 500, 750, 1000].map((v, i): [number, string[]] => [top + 100 - 25 * i, [String(v)]]);
    const r = figure({ x: xs([['0'], ['1'], ['2']]), y: [...panel(20), ...panel(125)] });
    const y = ok(r.y);
    expect(values(r.y)).toEqual([0, 250, 500, 750, 1000]);
    const at = y.pairs.map((p) => p.tick[1]);
    expect(Math.max(...at) - Math.min(...at)).toBeCloseTo(100, 6);
  });

  it('a label whose box reaches a little into an inward tick still pairs with it', () => {
    const r = figure({ x: xs([['0'], ['10'], ['20']]), inward: true, y: ys([['0'], ['1'], ['2']]) });
    expect(values(r.x)).toEqual([0, 10, 20]);
  });

  it('a level Y label pairs by its digits\' middle, not its box\'s', () => {
    // the box runs a whole size above the baseline: its middle sits 2.8 px off
    // the tick while the digits' middle sits 1.3 px off (a pgfplots figure)
    const r = figure({ x: xs([['0'], ['1'], ['2']]), y: ys([['0'], ['5'], ['10']]), yMidOff: 2.2 });
    expect(values(r.y)).toEqual([0, 5, 10]);
  });

  it('a second X axis along the top, with more labels, is read and the read says it is the top one', () => {
    const r = figure({ x: xs([['0'], ['1'], ['2']]), y: ys([['0'], ['1'], ['2']]), top: [[80, '10'], [140, '20'], [200, '30'], [260, '40']] });
    const x = ok(r.x);
    expect(values(r.x)).toEqual([10, 20, 30, 40]);
    expect(x.side).toBe('top');
    expect(ok(r.y).side).toBe('left');
  });
});
