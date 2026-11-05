/**
 * v2.7 Legend detection card (David, 2026-10-17): the user marks the legend with
 * the Mask an area box; Read legend reads it, from the figure's DRAWING when it
 * is drawn, else from the PICTURE (PaddleOCR's words and the pixels beside
 * them); each entry is a name and the colour of its sample.
 *
 * Fixtures: fixtures/vector/make_bars.py (bars-grouped: a legend A, B with
 * filled swatches; the same figure as bars-grouped.png at 2 px per point) and
 * make_lines.py (lines-legend: two lines' sample lines).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readDrawing, readTextItems, type PdfTextItem } from '../pdfDrawing.js';
import { pageToImage, placeDrawing, placeTextItems } from '../drawingPlacement.js';
import type { Provenance } from '../projectFile.js';
import { readLegendFromDrawing, readLegendFromPixels, whitenColour } from '../legendRead.js';
import { readPng } from './helpers/readPng.js';

const FIX = join(__dirname, 'fixtures/vector');
type Box = { x0: number; y0: number; x1: number; y1: number };

async function drawn(name: string) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(join(FIX, name + '.pdf'))), verbosity: 0 }).promise;
  const page = await doc.getPage(1);
  const vp = page.getViewport({ scale: 3.7 });
  const prov: Provenance = { source: { pageTransform: vp.transform as [number, number, number, number, number, number] } };
  const drawing = placeDrawing(prov, readDrawing(await page.getOperatorList(), pdfjs.OPS as unknown as Record<string, number>), [])!;
  const text = placeTextItems(prov, readTextItems((await page.getTextContent()).items as PdfTextItem[]));
  const box = (b: number[]): Box => {
    const a = pageToImage(prov, [b[0]! - 2, b[1]! - 2])!, c = pageToImage(prov, [b[2]! + 2, b[3]! + 2])!;
    return { x0: Math.min(a.x, c.x), y0: Math.min(a.y, c.y), x1: Math.max(a.x, c.x), y1: Math.max(a.y, c.y) };
  };
  return { drawing, text, box };
}

describe('Read legend, on a drawn figure', () => {
  it('a bar chart\'s legend reads as its entries, each a name and its swatch\'s colour, top to bottom', async () => {
    const t = JSON.parse(readFileSync(join(FIX, 'bars-grouped.truth.json'), 'utf8'));
    const { drawing, text, box } = await drawn('bars-grouped');
    const got = readLegendFromDrawing(drawing, text, box(t.legend.box));
    expect(got.map((e) => [e.name, e.colour, e.sample])).toEqual(t.legend.entries.map((e: { name: string; colour: number[] }) => [e.name, e.colour, 'swatch']));
  });

  it('a line chart\'s legend reads its sample lines as lines, with their names', async () => {
    const t = JSON.parse(readFileSync(join(FIX, 'lines-legend.truth.json'), 'utf8'));
    const { drawing, text, box } = await drawn('lines-legend');
    const got = readLegendFromDrawing(drawing, text, box(t.legend_box));
    expect(got.map((e) => [e.name, e.colour, e.sample])).toEqual([['series 1', [0, 0, 0], 'line'], ['series 2', [0, 0, 0], 'line']]);
  });

  it('a box with no legend in it reads nothing', async () => {
    const t = JSON.parse(readFileSync(join(FIX, 'bars-grouped.truth.json'), 'utf8'));
    const { drawing, text, box } = await drawn('bars-grouped');
    // the empty top-right corner of the plot
    const [, , x1, y1] = t.box as [number, number, number, number];
    expect(readLegendFromDrawing(drawing, text, box([x1 - 40, y1 - 25, x1 - 5, y1 - 5]))).toEqual([]);
  });
});

describe('Read legend, on a picture', () => {
  it('a bar chart\'s legend in a picture reads as its entries: the words as read, and the colour beside each', () => {
    const t = JSON.parse(readFileSync(join(FIX, 'bars-grouped.truth.json'), 'utf8'));
    const img = readPng(join(FIX, 'bars-grouped.png'));
    const H = img.height, k = 2; // 144 dpi: 2 px per point, y down
    const px = (b: number[]): Box => ({ x0: b[0]! * k, y0: H - b[3]! * k, x1: b[2]! * k, y1: H - b[1]! * k });
    // the words as PaddleOCR returns them: text and box, in the picture's pixels
    const words = t.legend.entries.map((e: { name: string; text: number[] }) => ({ text: e.name, bbox: px(e.text) }));
    const lb = t.legend.box as number[];
    const got = readLegendFromPixels(words, img.data, img.width, img.height, px([lb[0]! - 2, lb[1]! - 2, lb[2]! + 2, lb[3]! + 2]));
    expect(got.map((e) => e.name)).toEqual(['A', 'B']);
    got.forEach((e, i) => {
      const want = t.legend.entries[i].colour as number[];
      expect(e.colour, `entry ${i} has a colour`).not.toBeNull();
      expect(Math.hypot(e.colour![0] - want[0]!, e.colour![1] - want[1]!, e.colour![2] - want[2]!), `entry ${i} colour`).toBeLessThan(12);
    });
  });
});

describe('Read legend on a picture: the samples are not read as text', () => {
  it('a "word" with no letter or digit (two swatches read as "=") is not an entry', () => {
    const t = JSON.parse(readFileSync(join(FIX, 'bars-grouped.truth.json'), 'utf8'));
    const img = readPng(join(FIX, 'bars-grouped.png'));
    const H = img.height, k = 2;
    const px = (b: number[]): Box => ({ x0: b[0]! * k, y0: H - b[3]! * k, x1: b[2]! * k, y1: H - b[1]! * k });
    const lb = t.legend.box as number[];
    // what the reader returned once in the full suite: the two swatches as "="
    const words = [{ text: '=', bbox: px([lb[0]! + 2, lb[1]! + 4, lb[0]! + 32, lb[3]! - 4]) }];
    expect(readLegendFromPixels(words, img.data, img.width, img.height, px(lb))).toEqual([]);
  });

  it('before the read, strongly coloured pixels (swatches, coloured sample lines) are turned white and dark text is kept', () => {
    const rgba = new Uint8ClampedArray([31, 119, 180, 255, 255, 127, 14, 255, 20, 20, 20, 255, 128, 128, 128, 255]);
    whitenColour(rgba);
    expect([...rgba]).toEqual([255, 255, 255, 255, 255, 255, 255, 255, 20, 20, 20, 255, 128, 128, 128, 255]);
  });
});

// docs/v2.7-workflow-walk.md, "Series told apart by their line style": measured in the app on the bundled
// dash-coded figure, whose four legend samples are black lines (solid, dashed, dash-dot, dotted)
describe('Read legend on a picture of thin and dotted sample lines', () => {
  const img = readPng('samples/xy-dashed-release.png');
  const box: Box = { x0: 716, y0: 538, x1: 872, y1: 634 };
  // the words PaddleOCR returned there, boxes as read
  const words = [
    { text: 'Formulation A', bbox: { x0: 769.5, y0: 544, x1: 860.1, y1: 561 } },
    { text: 'Formulation B', bbox: { x0: 769.0, y0: 566, x1: 858.3, y1: 580 } },
    { text: 'Formulation C', bbox: { x0: 767.7, y0: 586, x1: 858.3, y1: 603 } },
    { text: 'Formulation D', bbox: { x0: 767.7, y0: 607, x1: 858.3, y1: 624 } },
  ];
  it("given thin sample lines, each one's colour is the curves' own ink, not the grey of the sample's anti-aliased edge", () => {
    const got = readLegendFromPixels(words, img.data, img.width, img.height, box);
    // the curves are drawn in (17, 17, 17), measured in the plot; Auto-extract takes inks within 40 as one colour.
    // What the strip's commonest colour gave: [59, 59, 59] for three, and [215, 215, 215] for the dotted one.
    for (const e of got) expect(Math.hypot(e.colour![0] - 17, e.colour![1] - 17, e.colour![2] - 17), `${e.name} ${e.colour}`).toBeLessThan(40);
  });
  it("given a word read inside another entry's sample, on its row (the dotted sample read as \"na\"), it is the sample, not a name", () => {
    const got = readLegendFromPixels([...words, { text: 'na', bbox: { x0: 735.1, y0: 612, x1: 743.3, y1: 619 } }], img.data, img.width, img.height, box);
    expect(got.map((e) => e.name)).toEqual(['Formulation A', 'Formulation B', 'Formulation C', 'Formulation D']);
  });
});

// the code review of 8816f1e..666ea46 (2026-11-05): a legend in one row, its keys drawn close
describe('Read legend on a picture: a legend in one row', () => {
  it("given a short name close enough to lie in the next entry's sample strip, it is still a name: its ink is letters, not a sample line", () => {
    const w = 120, h = 30;
    const rgba = new Uint8ClampedArray(w * h * 4).fill(255);
    const ink = (x0: number, y0: number, x1: number, y1: number) => {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) rgba.set([0, 0, 0, 255], (y * w + x) * 4);
    };
    ink(10, 15, 30, 16); // A's key, a line
    ink(38, 10, 44, 20); // the letter A
    ink(52, 15, 72, 16); // B's key
    ink(79, 10, 85, 20); // the letter B
    const words = [
      { text: 'A', bbox: { x0: 39, y0: 10, x1: 45, y1: 20 } },
      { text: 'B', bbox: { x0: 80, y0: 10, x1: 86, y1: 20 } },
    ];
    const got = readLegendFromPixels(words, rgba, w, h, { x0: 0, y0: 0, x1: w - 1, y1: h - 1 });
    expect(got.map((e) => e.name)).toEqual(['A', 'B']);
  });
});

// docs/v2.7-workflow-walk.md, "Series told apart by their markers": on a picture the drawing cannot say what a sample
// is, so it is measured: a sample that runs across its strip is a line, one that stands alone in it a marker
describe('Read legend on a picture: what each sample is', () => {
  it('given marker samples (a filled circle, a filled square, an open triangle), each entry is a marker, its box round the marker', () => {
    const t = JSON.parse(readFileSync('ui/__tests__/fixtures/autoExtract/markers-scatter.truth.json', 'utf8')) as { legend: number[]; entries: { name: string; text: number[] }[] };
    const img = readPng('ui/__tests__/fixtures/autoExtract/markers-scatter.png');
    const L = t.legend;
    const words = t.entries.map((e) => ({ text: e.name, bbox: { x0: e.text[0]!, y0: e.text[1]!, x1: e.text[2]!, y1: e.text[3]! } }));
    const got = readLegendFromPixels(words, img.data, img.width, img.height, { x0: L[0]! - 4, y0: L[1]! - 4, x1: L[2]! + 4, y1: L[3]! + 4 });
    expect(got.map((e) => [e.name, e.sample])).toEqual([['Wild type', 'marker'], ['Mutant', 'marker'], ['Rescue', 'marker']]);
    // the box is the marker's own, beside its name, not the whole strip
    for (const e of got) expect(e.sampleBox!.x1 - e.sampleBox!.x0, e.name).toBeLessThan(16);
  });

  it('given line samples (solid, dashed, dash-dot, dotted), each entry is a line', () => {
    const img = readPng('samples/xy-dashed-release.png');
    const words = [
      { text: 'Formulation A', bbox: { x0: 769.5, y0: 544, x1: 860.1, y1: 561 } },
      { text: 'Formulation B', bbox: { x0: 769.0, y0: 566, x1: 858.3, y1: 580 } },
      { text: 'Formulation C', bbox: { x0: 767.7, y0: 586, x1: 858.3, y1: 603 } },
      { text: 'Formulation D', bbox: { x0: 767.7, y0: 607, x1: 858.3, y1: 624 } },
    ];
    const got = readLegendFromPixels(words, img.data, img.width, img.height, { x0: 716, y0: 538, x1: 872, y1: 634 });
    expect(got.map((e) => e.sample)).toEqual(['line', 'line', 'line', 'line']);
  });
});
