/**
 * v2.7 V12-V27 (docs/v2.7-vector-cases.md, "Lines and points read from the
 * drawing"): Find lines on a drawn figure reads the PDF's paths.
 *
 * Fixtures: engine/__tests__/fixtures/vector/make_lines.py (matplotlib); each
 * PDF has a truth file of what was drawn, in page points. The PDF is read as
 * the app reads it (pdf.js), placed through the recorded render (V19), and the
 * lines that come back are checked against the truth.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readDrawing, readTextBoxes, type PdfTextItem } from '../pdfDrawing.js';
import { pageToImage, placeDrawing } from '../drawingPlacement.js';
import type { Provenance } from '../projectFile.js';
import { findLinesFromDrawing, type PlacedDrawing } from '../../algorithms/findLines/fromDrawing.js';
import type { Box } from '../../algorithms/findLines/ink.js';
import type { FindLinesResult } from '../../algorithms/findLines/lines.js';

const FIX = join(__dirname, 'fixtures/vector');
type Pt = [number, number];
interface Case {
  drawing: PlacedDrawing;
  box: Box;
  legend: Box | null;
  truth: Pt[][];
}
const cases: Record<string, Case> = {};
const NAMES = ['lines-cross', 'lines-dashed', 'lines-markers', 'lines-contour-labels', 'lines-empty-gap', 'lines-straight', 'lines-clipped', 'lines-legend', 'lines-doubled'];

beforeAll(async () => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  for (const name of NAMES) {
    const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(join(FIX, name + '.pdf'))), verbosity: 0 }).promise;
    const page = await doc.getPage(1);
    const vp = page.getViewport({ scale: 3.7 }); // about what the app renders a page at
    const prov: Provenance = { source: { pageTransform: vp.transform as [number, number, number, number, number, number] } };
    const drawing = readDrawing(await page.getOperatorList(), pdfjs.OPS as unknown as Record<string, number>);
    const text = readTextBoxes((await page.getTextContent()).items as PdfTextItem[]);
    const t = JSON.parse(readFileSync(join(FIX, name + '.truth.json'), 'utf8')) as { box: number[]; legend_box: number[] | null; lines: { points: Pt[] }[] };
    const at = (p: Pt): Pt => {
      const q = pageToImage(prov, p)!;
      return [q.x, q.y];
    };
    const boxOf = (b: number[]): Box => {
      const a = at([b[0]!, b[1]!]), c = at([b[2]!, b[3]!]);
      return { x0: Math.min(a[0], c[0]), y0: Math.min(a[1], c[1]), x1: Math.max(a[0], c[0]), y1: Math.max(a[1], c[1]) };
    };
    cases[name] = {
      drawing: placeDrawing(prov, drawing, text)!,
      box: boxOf(t.box),
      legend: t.legend_box ? boxOf(t.legend_box) : null,
      truth: t.lines.map((l) => l.points.map(at)),
    };
  }
});

const BLACK = [0, 0, 0] as const;
function read(name: string, opts: { masks?: Box[] } = {}): FindLinesResult {
  const c = cases[name]!;
  return findLinesFromDrawing(c.drawing, BLACK, c.box, opts);
}

/** Points along a polyline every 1 px, so a check covers its whole length. */
function densify(L: readonly Pt[]): Pt[] {
  const out: Pt[] = [];
  for (let i = 1; i < L.length; i++) {
    const [a, b] = [L[i - 1]!, L[i]!];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])));
    for (let k = 0; k < n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  if (L.length) out.push(L[L.length - 1]!);
  return out;
}
const distTo = (p: Pt, L: readonly Pt[]): number => {
  let best = Infinity;
  for (let i = 1; i < L.length; i++) {
    const [a, b] = [L[i - 1]!, L[i]!];
    const vx = b[0] - a[0], vy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / (vx * vx + vy * vy || 1)));
    best = Math.min(best, Math.hypot(p[0] - a[0] - t * vx, p[1] - a[1] - t * vy));
  }
  if (L.length === 1) best = Math.hypot(p[0] - L[0]![0], p[1] - L[0]![1]);
  return best;
};
const share = (from: readonly Pt[], onto: readonly Pt[], tol = 1.5) => {
  const d = densify(from);
  return d.filter((p) => distTo(p, onto) <= tol).length / d.length;
};

/** Each true line comes back as ONE returned line that covers it and holds nothing else. */
function expectWhole(name: string, res: FindLinesResult) {
  const truth = cases[name]!.truth;
  for (const [k, T] of truth.entries()) {
    const whole = res.lines.some((L) => share(T, L.points) >= 0.9 && share(L.points, T) >= 0.9);
    expect(whole, `${name}: true line ${k} comes back whole`).toBe(true);
  }
}
/** No returned line holds two true lines (a switch at a crossing). */
function expectNoSwitch(name: string, res: FindLinesResult) {
  const truth = cases[name]!.truth;
  for (const L of res.lines) {
    const on = truth.filter((T) => share(L.points, T) >= 0.15).length;
    expect(on, 'a returned line runs along one true line only').toBeLessThanOrEqual(1);
  }
}

describe('V12: Find lines on a drawn figure reads the drawing', () => {
  it('V12: three same-ink curves come back as three whole lines, one series each', () => {
    const res = read('lines-cross');
    expectWhole('lines-cross', res);
    expect(res.lines).toHaveLength(3);
  });

  it('V25: lines that cross never take each other over', () => {
    expectNoSwitch('lines-cross', read('lines-cross'));
    expectNoSwitch('lines-dashed', read('lines-dashed'));
  });

  it('V26: the plot frame drawn in the same ink is not returned as a line', () => {
    const c = cases['lines-cross']!;
    const res = read('lines-cross');
    const onFrame = (p: number[]) => Math.min(Math.abs(p[0]! - c.box.x0), Math.abs(p[0]! - c.box.x1), Math.abs(p[1]! - c.box.y0), Math.abs(p[1]! - c.box.y1)) < 2;
    for (const L of res.lines) expect(L.points.every(onFrame)).toBe(false);
  });

  it('V23: a dashed or dotted line is one line, with no gaps bridged', () => {
    const res = read('lines-dashed');
    expectWhole('lines-dashed', res);
    expect(res.lines).toHaveLength(3);
    expect(res.lines.flatMap((L) => L.gaps)).toHaveLength(0);
  });

  it('V15: a line drawn through markers comes back as one line, not broken at each marker', () => {
    const res = read('lines-markers');
    expectWhole('lines-markers', res);
    expect(res.lines).toHaveLength(2);
  });

  it('V24: a contour cut by its inline text label comes back as one line, the gap marked bridged', () => {
    const res = read('lines-contour-labels');
    // The label hides part of each loop: what IS drawn must all lie on the
    // true loop, and cover it but for what the label hides; the hidden part
    // is a straight bridge, marked bridged, never passed off as measured.
    for (const T of cases['lines-contour-labels']!.truth) {
      const L = res.lines.find((l) => share(T, l.points) >= 0.75);
      expect(L, 'each loop comes back as one line').toBeDefined();
      const measured = L!.points.filter((_, i) => L!.roles[i] === 'measured');
      const onLoop = measured.filter((p) => distTo(p as Pt, T) <= 1.5).length / measured.length;
      expect(onLoop).toBeGreaterThan(0.98);
      expect(L!.closed).toBe(true);
    }
    expect(res.lines).toHaveLength(3);
    const gaps = res.lines.flatMap((L) => L.gaps);
    expect(gaps.length).toBeGreaterThan(0);
    for (const L of res.lines) expect(L.roles).toHaveLength(L.points.length);
    expect(res.lines.some((L) => L.roles.includes('bridged'))).toBe(true);
  });

  it('V24: two pieces with an empty gap between them stay two lines', () => {
    const res = read('lines-empty-gap');
    expect(res.lines).toHaveLength(2);
    expectWhole('lines-empty-gap', res);
  });

  it('V27: a straight reference or fit line drawn as one segment is returned, as two points', () => {
    const res = read('lines-straight');
    expectWhole('lines-straight', res);
    expect(res.lines.filter((L) => L.points.length === 2).length).toBeGreaterThanOrEqual(2);
  });

  it('V16: the part of a line outside the plot area is not added', () => {
    const c = cases['lines-clipped']!;
    const res = read('lines-clipped');
    expectWhole('lines-clipped', res);
    for (const L of res.lines) for (const p of L.points) {
      expect(p[1]).toBeGreaterThanOrEqual(c.box.y0 - 1);
      expect(p[1]).toBeLessThanOrEqual(c.box.y1 + 1);
    }
  });

  it('V17: a masked legend leaves its sample lines out; unmasked, they come back as short lines of their own', () => {
    const c = cases['lines-legend']!;
    const masked = read('lines-legend', { masks: [c.legend!] });
    expectWhole('lines-legend', masked);
    expect(masked.lines).toHaveLength(2);
    const unmasked = read('lines-legend');
    expect(unmasked.lines).toHaveLength(4);
  });

  it('V28: a series drawn twice comes back as drawn, and Places to check says the lines lie on top of each other', () => {
    const res = read('lines-doubled');
    // the dotted and the solid path are two drawn lines; the path painted twice exactly is one
    expect(res.lines).toHaveLength(3);
    expectWhole('lines-doubled', res);
    const over = res.places.filter((p) => p.kind === 'overlap');
    expect(over).toHaveLength(1);
    const [a, b] = over[0]!.lines;
    const truth = cases['lines-doubled']!.truth;
    const which = (i: number) => truth.findIndex((T) => share(T, res.lines[i]!.points) >= 0.9 && share(res.lines[i]!.points, T) >= 0.9);
    expect([which(a!), which(b!)].sort()).toEqual([0, 1]);
  });

  it('V28: lines that only cross or touch are not said to lie on top of each other', () => {
    expect(read('lines-cross').places.filter((p) => p.kind === 'overlap')).toHaveLength(0);
    expect(read('lines-dashed').places.filter((p) => p.kind === 'overlap')).toHaveLength(0);
  });

  it('V29: every point read lies on the drawn ink (within half a pixel of the true line)', () => {
    for (const name of ['lines-cross', 'lines-dashed', 'lines-markers']) {
      const truth = cases[name]!.truth;
      for (const L of read(name).lines) for (const p of L.points) {
        expect(Math.min(...truth.map((T) => distTo(p as Pt, T)))).toBeLessThan(0.5);
      }
    }
  });
});
