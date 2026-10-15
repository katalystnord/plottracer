/**
 * v2.7 V1-V4a (docs/v2.7-vector-cases.md, "Telling what the figure is"): the
 * calibration card says whether a captured PDF figure is drawn, a picture, or
 * partly each - by the prevalence study's rule, measured on the PDF itself.
 *
 * Fixtures: engine/__tests__/fixtures/vector/make.py (matplotlib), one PDF per
 * kind, so what each one holds is known by construction.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { figureKind, figureKindLine, readDrawing, type PageDrawing, type Pt } from '../pdfDrawing.js';
import { pageToImage } from '../drawingPlacement.js';
import type { ImageEdit } from '../imageEdit.js';
import type { Provenance } from '../projectFile.js';

const FIX = join(__dirname, 'fixtures/vector');
type Page = { drawing: PageDrawing; width: number; height: number; pageArea: number; pageTransform: [number, number, number, number, number, number] };
const pages: Record<string, Page> = {};

beforeAll(async () => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  for (const name of ['drawn', 'picture', 'heatmap', 'partly-over', 'partly-inset', 'sparse']) {
    const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(join(FIX, name + '.pdf'))), verbosity: 0 }).promise;
    const page = await doc.getPage(1);
    const vp = page.getViewport({ scale: 2 });
    const ops = await page.getOperatorList();
    const [x0, y0, x1, y1] = page.view as number[];
    pages[name] = {
      drawing: readDrawing(ops, pdfjs.OPS as unknown as Record<string, number>),
      width: Math.ceil(vp.width),
      height: Math.ceil(vp.height),
      pageArea: (x1! - x0!) * (y1! - y0!),
      pageTransform: vp.transform as [number, number, number, number, number, number],
    };
  }
});

/** The kind of the captured figure: here the whole page, after `edits`. */
function kindOf(name: string, edits: ImageEdit[] = [], size?: { width: number; height: number }) {
  const p = pages[name]!;
  const prov: Provenance = { source: { pageTransform: p.pageTransform }, edits };
  const place = (q: Pt) => pageToImage(prov, q);
  return figureKind(p.drawing, place, size?.width ?? p.width, size?.height ?? p.height, p.pageArea);
}

describe('V1-V4: the calibration card says what the captured figure is', () => {
  it('V1: a figure drawn as vectors says so', () => {
    const k = kindOf('drawn');
    expect(k.kind).toBe('drawn');
    expect(figureKindLine(k)).toBe('Drawn as vectors in the PDF: Find lines reads its lines from the drawing.');
  });

  it('V2: a picture inside the PDF says it is read from its pixels', () => {
    const k = kindOf('picture');
    expect(k.kind).toBe('picture');
    expect(figureKindLine(k)).toBe('A picture inside the PDF: read from its pixels, as any image.');
  });

  it('V2: a heatmap with only drawn axes and a few contour lines is a picture (fewer than 40 shapes drawn)', () => {
    expect(kindOf('heatmap').kind).toBe('picture');
  });

  it('V3: series with markers drawn over a heatmap are lines drawn over a picture', () => {
    const k = kindOf('partly-over');
    expect(k.kind).toBe('partly');
    expect(figureKindLine(k)).toBe('Partly a picture: lines and labels are drawn over a picture.');
  });

  it('V3: a drawn chart with a picture inset says how much is a picture', () => {
    const k = kindOf('partly-inset');
    expect(k.kind).toBe('partly');
    expect(figureKindLine(k)).toMatch(/^Partly a picture: a picture covers about [1-5]0% of the figure; the rest is drawn\.$/);
  });

  it('V4: a PDF figure with nothing to say shows no line', () => {
    const k = kindOf('sparse');
    expect(k.kind).toBe('none');
    expect(figureKindLine(k)).toBeNull();
  });

  it('V4: a figure that is not from a PDF shows no line', () => {
    expect(figureKindLine(null)).toBeNull();
  });

  it('V4a: a crop that keeps only the drawn part of a partly-picture figure makes it drawn', () => {
    const p = pages['partly-inset']!;
    const rect = { x: 0, y: 0, width: Math.round(p.width * 0.4), height: p.height };
    const k = kindOf('partly-inset', [{ kind: 'crop', fromWidth: p.width, fromHeight: p.height, rect }], rect);
    expect(k.kind).toBe('drawn');
  });
});
