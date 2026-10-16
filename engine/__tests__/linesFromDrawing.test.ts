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
import { findLinesFromDrawing, markersFromDrawing, type PlacedDrawing } from '../../algorithms/findLines/fromDrawing.js';
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
const NAMES = ['lines-cross', 'lines-dashed', 'lines-markers', 'lines-contour-labels', 'lines-empty-gap', 'lines-straight', 'lines-clipped', 'lines-legend', 'lines-doubled', 'markers-scatter', 'lines-smoothed', 'markers-clipped', 'predashed'];

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

  it('V16: a straight line whose ends lie just outside the plot box keeps the part inside, cut at the box edge', () => {
    // ⚑ Found on the V22a held-out set (matplotlib's straight y = 0.4x drawn as
    // one segment from axis edge to axis edge): a box drawn a fraction of a
    // pixel inside the axes put both corners outside, and the whole line was
    // dropped. Built here from a made-up shape, not from that figure.
    const ink: [number, number, number] = [31, 119, 180];
    const shape = (subs: Pt[][]) => ({ subs, stroked: true, filled: false, stroke: ink, fill: ink, lineWidth: 2, dash: null });
    const drawing: PlacedDrawing = {
      shapes: [
        shape([[[99.9, 400], [600.1, 150], [600.1, 150]]]), // ends a tenth of a pixel past each side
        shape([[[80, 300], [300, 80]]]), // crosses the box's top-left corner, both ends outside
      ],
      text: [],
      pxPerPt: 2,
    };
    const box: Box = { x0: 100, y0: 100, x1: 600, y1: 500 };
    const res = findLinesFromDrawing(drawing, ink, box);
    expect(res.lines).toHaveLength(2);
    const [a, b] = res.lines;
    expect(a!.points[0]![0]).toBeCloseTo(100, 6);
    expect(a!.points[a!.points.length - 1]![0]).toBeCloseTo(600, 6);
    for (const p of b!.points) {
      expect(p[0]).toBeGreaterThanOrEqual(100 - 1e-9);
      expect(p[1]).toBeGreaterThanOrEqual(100 - 1e-9);
    }
    expect(b!.points.map((p) => p.map((v) => +v.toFixed(6)))).toEqual([[100, 280], [280, 100]]);
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

describe('V14: a line with markers on it is listed, and left as read', () => {
  it('a smoothed line through 6 markers: one line, and a place saying 101 corners and 6 markers', () => {
    const res = read('lines-smoothed');
    expect(res.lines).toHaveLength(1);
    const pl = res.places.filter((p) => p.kind === 'markers');
    expect(pl).toHaveLength(1);
    expect(pl[0]!.lines).toEqual([0]);
    expect(pl[0]!.counts).toEqual({ corners: 101, markers: 6 });
  });

  it('a line with a marker every few points is listed too: the markers may be the data', () => {
    const pl = read('lines-markers').places.filter((p) => p.kind === 'markers');
    expect(pl).toHaveLength(2);
    for (const p of pl) expect(p.counts!.markers).toBe(10);
  });

  it('a line with no markers on it gets no such place', () => {
    expect(read('lines-cross').places.filter((p) => p.kind === 'markers')).toHaveLength(0);
  });
});

describe('V15: By colour, Scattered points, on a drawn figure reads one point per marker', () => {
  const hex = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)] as const;
  /** Every true marker centre has exactly one point within half a pixel, and there is nothing else. */
  function expectOnePerMarker(points: readonly Pt[], truth: readonly Pt[]) {
    expect(points).toHaveLength(truth.length);
    for (const t of truth) {
      expect(points.filter((p) => Math.hypot(p[0] - t[0], p[1] - t[1]) < 0.5)).toHaveLength(1);
    }
  }

  /** The true markers not under the legend: the legend is opaque, so those are hidden in the figure itself. */
  const visible = (c: Case, k: number) => c.truth[k]!.filter((t) => !(t[0] >= c.legend!.x0 && t[0] <= c.legend!.x1 && t[1] >= c.legend!.y0 && t[1] <= c.legend!.y1));

  it('filled markers: one point at each centre; the legend sample is left out once the legend is masked', () => {
    const c = cases['markers-scatter']!;
    expectOnePerMarker(markersFromDrawing(c.drawing, hex('#d62728'), c.box, [c.legend!]), visible(c, 0));
    expectOnePerMarker(markersFromDrawing(c.drawing, hex('#1f77b4'), c.box, [c.legend!]), visible(c, 1));
  });

  it('unmasked, the legend\'s marker sample is read too, as on pixels', () => {
    const c = cases['markers-scatter']!;
    // every red marker, the two under the legend among them, plus the legend's own sample
    expect(markersFromDrawing(c.drawing, hex('#d62728'), c.box)).toHaveLength(c.truth[0]!.length + 1);
  });

  it('hollow markers (outline only) are read by their outline colour', () => {
    const c = cases['markers-scatter']!;
    expectOnePerMarker(markersFromDrawing(c.drawing, hex('#2ca02c'), c.box, [c.legend!]), visible(c, 2));
  });

  it('a marker painted twice counts once', () => {
    const c = cases['markers-scatter']!;
    const twice: PlacedDrawing = { ...c.drawing, shapes: [...c.drawing.shapes, ...c.drawing.shapes] };
    expectOnePerMarker(markersFromDrawing(twice, hex('#d62728'), c.box, [c.legend!]), visible(c, 0));
  });

  it('markers on a line are read, and the line itself is not a marker', () => {
    const c = cases['lines-markers']!;
    const pts = markersFromDrawing(c.drawing, BLACK, c.box);
    const centres = c.truth.flatMap((T) => T.filter((_, i) => i % 8 === 0));
    expectOnePerMarker(pts, centres);
  });
});

describe('V23: a dashed line written as separate short pieces, with no dash array', () => {
  // fixtures/vector/make_predashed.py; found reading ChartDetective, which
  // leaves such dashes to the user to select by hand
  it('V23: a line whose dashes are separate short pieces is one whole line, not dropped as ticks', () => {
    const c = cases['predashed']!;
    const res = findLinesFromDrawing(c.drawing, [0, 0, 255], c.box);
    expectWhole('predashed', res);
    expect(res.lines).toHaveLength(2);
  });
  it('V23: the touching pen strokes of a label drawn in strokes (cairo\'s contour labels) are not taken for a dashed line', () => {
    const ink: [number, number, number] = [0, 0, 255];
    const stroke = (p: Pt, q: Pt) => ({ subs: [[p, q]], stroked: true, filled: false, stroke: ink, fill: ink, lineWidth: 1, dash: null });
    // a digit's long stroke drawn as four touching pieces, end to end, as a
    // pen-drawn glyph flattens it: regular, collinear, but no gaps and short
    const shapes = [0, 1, 2, 3].map((i) => stroke([100, 100 + 2 * i], [100, 102 + 2 * i]));
    const res = findLinesFromDrawing({ shapes, text: [], pxPerPt: 1 }, ink, { x0: 0, y0: 0, x1: 300, y1: 300 });
    expect(res.lines).toHaveLength(0);
  });
});

describe('V16 for markers: what the figure clips away is not shown, so it is not data', () => {
  it('Scattered points over the whole figure reads only the markers inside the axes, not those the figure clips away', () => {
    const c = cases['markers-clipped']!;
    // the region is the whole figure, as By colour reads it when no region is drawn
    const all = { x0: 0, y0: 0, x1: 1e5, y1: 1e5 };
    const got = markersFromDrawing(c.drawing, [214, 39, 40], all);
    expect(got).toHaveLength(c.truth[0]!.length);
    for (const p of c.truth[0]!) expect(got.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 0.5)).toBe(true);
  });
});

describe('a style set through the PDF graphics state (ExtGState) is the style drawn', () => {
  // fixtures/vector/make_gstate.py: three blue strokes whose width, dash and
  // stroke alpha are set ONLY through `/Gn gs`, as some exporters write them
  // (found reading ChartDetective, which gets it from pdf.js's renderer)
  let shapes: ReturnType<typeof readDrawing>['shapes'] = [];
  beforeAll(async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(join(FIX, 'gstate.pdf'))), verbosity: 0 }).promise;
    const ops = await (await doc.getPage(1)).getOperatorList();
    shapes = readDrawing(ops, pdfjs.OPS as unknown as Record<string, number>).shapes.filter((s) => s.stroke[2] === 255 && s.stroke[0] === 0);
  });
  const at = (y: number) => shapes.find((s) => s.subs[0]![0]![1] === y);

  it('a line width set through the graphics state is the line\'s width', () => {
    expect(at(50)?.lineWidth).toBe(4);
  });
  it('a dash set through the graphics state makes the line dashed', () => {
    expect(at(100)?.dash).toEqual([6, 3]);
    expect(at(50)?.dash).toBeNull();
  });
  it('a stroke painted fully transparent is not ink, so it is not read', () => {
    expect(at(150)).toBeUndefined();
    expect(shapes).toHaveLength(2);
  });
});

describe('V15: two markers at one spot are two points, unless the drawing painted one marker twice', () => {
  const red: [number, number, number] = [214, 39, 40];
  /** A square marker of side 4 px centred at p, filled or outlined. */
  const marker = (p: Pt, mode: 'fill' | 'stroke') => ({
    subs: [[[p[0] - 2, p[1] - 2], [p[0] + 2, p[1] - 2], [p[0] + 2, p[1] + 2], [p[0] - 2, p[1] + 2], [p[0] - 2, p[1] - 2]] as Pt[]],
    stroked: mode === 'stroke', filled: mode === 'fill', stroke: red, fill: red, lineWidth: 1, dash: null,
  });
  const read = (shapes: ReturnType<typeof marker>[]) =>
    markersFromDrawing({ shapes, text: [], pxPerPt: 1 }, red, { x0: 0, y0: 0, x1: 500, y1: 500 });
  const pts: Pt[] = [[50, 50], [100, 80], [150, 120], [200, 60]];

  it('a data point repeated at one spot (integer data) is kept as two points', () => {
    const got = read([...pts.map((p) => marker(p, 'fill')), marker([100, 80], 'fill')]);
    expect(got).toHaveLength(5);
  });
  it('a marker filled and then outlined at one spot is one point', () => {
    const got = read([...pts.map((p) => marker(p, 'fill')), ...pts.map((p) => marker(p, 'stroke'))]);
    expect(got).toHaveLength(4);
  });
  it('a whole series painted twice is read once', () => {
    const got = read([...pts.map((p) => marker(p, 'fill')), ...pts.map((p) => marker(p, 'fill'))]);
    expect(got).toHaveLength(4);
  });
});
