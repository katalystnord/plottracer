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
