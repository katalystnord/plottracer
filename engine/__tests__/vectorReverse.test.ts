/**
 * v2.7 V22, the reverse check (docs/v2.7-vector-cases.md): what is read from a
 * figure's DRAWING equals the DATA the figure was made from, to the data's own
 * printed digits.
 *
 * linesFromDrawing.test.ts checks the reader against the drawn geometry; this
 * checks the whole path a user's numbers take against the numbers themselves:
 * the PDF read as the app reads it (pdf.js), placed through the recorded render
 * (V19), read by Find lines or Scattered points, thinned into series points as
 * the app does (thinFoundLine), and turned into values by the app's XY axes.
 *
 * Fixtures: fixtures/vector/make_reverse.py (matplotlib, LibreOffice) and
 * make_reverse.R (R pdf(), cairo_pdf(), ggplot2). The data are written to 2
 * decimals; the calibration is two known values per axis at the positions the
 * GENERATOR gave them, standing in for the user's four clicks made exactly.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readDrawing, readTextBoxes, type PdfTextItem } from '../pdfDrawing.js';
import { pageToImage, placeDrawing } from '../drawingPlacement.js';
import type { Provenance } from '../projectFile.js';
import { thinFoundLine } from '../lineEdits.js';
import { findLinesFromDrawing, markersFromDrawing, type PlacedDrawing } from '../../algorithms/findLines/fromDrawing.js';
import type { Box } from '../../algorithms/findLines/ink.js';
import { XYAxes } from '../../core/axes/xy.js';
import { Calibration } from '../../core/calibration.js';

const FIX = join(__dirname, 'fixtures/vector');
type Pt = [number, number];
interface Truth {
  generator: string;
  digits: number;
  box: [number, number, number, number];
  calib: { x: [number, number][]; y: [number, number][] };
  series: { drawn: 'line' | 'markers' | 'line+markers'; colour: [number, number, number]; data: Pt[] }[];
}
interface Case {
  truth: Truth;
  drawing: PlacedDrawing;
  box: Box;
  axes: XYAxes;
}

const FIGURES = [
  'reverse-mpl-lines', 'reverse-mpl-linemarkers', 'reverse-mpl-scatter',
  'reverse-rbase-line', 'reverse-rbase-markers', 'reverse-rbase-linemarkers',
  'reverse-rcairo-line', 'reverse-rcairo-markers', 'reverse-rcairo-linemarkers',
  'reverse-rgg-line', 'reverse-rgg-markers', 'reverse-rgg-linemarkers',
  'reverse-lo-lines', 'reverse-lo-linemarkers',
  'reverse-mpl-dense',
];
const cases: Record<string, Case> = {};

beforeAll(async () => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  for (const name of FIGURES) {
    const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(join(FIX, name + '.pdf'))), verbosity: 0 }).promise;
    const page = await doc.getPage(1);
    const vp = page.getViewport({ scale: 3.7 }); // about what the app renders a page at
    const prov: Provenance = { source: { pageTransform: vp.transform as [number, number, number, number, number, number] } };
    const drawing = readDrawing(await page.getOperatorList(), pdfjs.OPS as unknown as Record<string, number>);
    const text = readTextBoxes((await page.getTextContent()).items as PdfTextItem[]);
    const truth = JSON.parse(readFileSync(join(FIX, name + '.truth.json'), 'utf8')) as Truth;
    const at = (x: number, y: number): Pt => {
      const q = pageToImage(prov, [x, y])!;
      return [q.x, q.y];
    };
    const [bx0, by0, bx1, by1] = truth.box;
    const a = at(bx0, by0), c = at(bx1, by1);
    // the four calibration clicks: two on the bottom axis, two on the left
    const cal = new Calibration(2);
    for (const [v, x] of truth.calib.x) cal.addPoint(...at(x, by0), String(v), '0');
    for (const [v, y] of truth.calib.y) cal.addPoint(...at(bx0, y), '0', String(v));
    const axes = new XYAxes();
    if (!axes.calibrate(cal, false, false, false)) throw new Error(`${name}: the calibration was refused`);
    cases[name] = {
      truth,
      drawing: placeDrawing(prov, drawing, text)!,
      box: { x0: Math.min(a[0], c[0]), y0: Math.min(a[1], c[1]), x1: Math.max(a[0], c[0]), y1: Math.max(a[1], c[1]) },
      axes,
    };
  }
});

const toData = (axes: XYAxes, p: { x: number; y: number }): Pt => axes.pixelToData(p.x, p.y) as Pt;
/** The largest difference, in data units, between what was read and the data. */
const worst = (got: readonly Pt[], want: readonly Pt[]) =>
  Math.max(...got.map((g, i) => Math.max(Math.abs(g[0] - want[i]![0]), Math.abs(g[1] - want[i]![1]))));
const byX = (ps: readonly Pt[]) => [...ps].sort((p, q) => p[0] - q[0] || p[1] - q[1]);

/** The series' line, as Find lines gives it and the app stores it, in data units. */
function lineAsData(name: string, k: number): Pt[][] {
  const c = cases[name]!;
  const s = c.truth.series[k]!;
  const res = findLinesFromDrawing(c.drawing, s.colour, c.box);
  return res.lines.map((L) => thinFoundLine(L.points, L.roles).map((p) => toData(c.axes, p)));
}
/** The series' markers, as Scattered points gives them, in data units. */
function markersAsData(name: string, k: number): Pt[] {
  const c = cases[name]!;
  const s = c.truth.series[k]!;
  return markersFromDrawing(c.drawing, s.colour, c.box).map(([x, y]) => toData(c.axes, { x, y }));
}

function expectLineIsData(name: string) {
  const c = cases[name]!;
  const half = 0.5 * 10 ** -c.truth.digits;
  for (const [k, s] of c.truth.series.entries()) {
    if (!s.drawn.includes('line')) continue;
    const lines = lineAsData(name, k);
    expect(lines, `${name} series ${k}: one line`).toHaveLength(1);
    let got = lines[0]!;
    // a line may come back in either direction; the data run left to right
    if (got.length > 1 && got[0]![0] > got[got.length - 1]![0]) got = [...got].reverse();
    expect(got.length, `${name} series ${k}: one point per data point`).toBe(s.data.length);
    expect(worst(got, s.data), `${name} series ${k}: every point within half the last printed digit`).toBeLessThan(half);
  }
}
function expectMarkersAreData(name: string) {
  const c = cases[name]!;
  const half = 0.5 * 10 ** -c.truth.digits;
  for (const [k, s] of c.truth.series.entries()) {
    if (!s.drawn.includes('markers')) continue;
    const got = byX(markersAsData(name, k));
    expect(got.length, `${name} series ${k}: one point per marker`).toBe(s.data.length);
    expect(worst(got, byX(s.data)), `${name} series ${k}: every marker within half the last printed digit`).toBeLessThan(half);
  }
}

describe('V22: what is read from the drawing is the data the figure was made from', () => {
  for (const [gen, names] of [
    ['matplotlib', ['reverse-mpl-lines', 'reverse-mpl-linemarkers', 'reverse-mpl-scatter']],
    ["R's pdf()", ['reverse-rbase-line', 'reverse-rbase-linemarkers', 'reverse-rbase-markers']],
    ["R's cairo_pdf()", ['reverse-rcairo-line', 'reverse-rcairo-linemarkers', 'reverse-rcairo-markers']],
    ['ggplot2', ['reverse-rgg-line', 'reverse-rgg-linemarkers', 'reverse-rgg-markers']],
    ['LibreOffice, smoothing off', ['reverse-lo-lines', 'reverse-lo-linemarkers']],
  ] as const) {
    const has = (n: string, what: string) => cases[n]!.truth.series.some((s) => s.drawn.includes(what));
    it(`V22 ${gen}: a line read by Find lines is the data, point for point, to its printed digits`, () => {
      for (const n of names.filter((n) => has(n, 'line'))) expectLineIsData(n);
    });
    it(`V22 ${gen}: markers read by Scattered points are the data, one per point, to its printed digits`, () => {
      for (const n of names.filter((n) => has(n, 'markers'))) expectMarkersAreData(n);
    });
  }

  it('V22 matplotlib, a dense line (corners 0.4 pt apart): every point kept is one of the data points, to its printed digits', () => {
    const c = cases['reverse-mpl-dense']!;
    const s = c.truth.series[0]!;
    const half = 0.5 * 10 ** -c.truth.digits;
    const lines = lineAsData('reverse-mpl-dense', 0);
    expect(lines).toHaveLength(1);
    const off = lines[0]!.map((g) => Math.min(...s.data.map((d) => Math.max(Math.abs(g[0] - d[0]), Math.abs(g[1] - d[1])))));
    expect(Math.max(...off)).toBeLessThan(half);
  });
  // ⚑ Whether EVERY corner of a dense drawn line is kept, rather than one every
  // 2.5 px, is the open thinning decision (design note below V22 in the cases
  // doc). Today the dense line above keeps 156 of its 451 data points.
  it.todo('given a drawn line whose corners are closer than 2.5 px, every corner is a point in the series (waits for David: thinning)');

  // ⚑ The other half of V22, the calibration READ from the labels, is in
  // labelCalibration.test.ts ("V22, the calibration half"), beside the reader.
});
