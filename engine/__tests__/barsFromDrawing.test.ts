/**
 * v2.7 V18 (docs/v2.7-vector-cases.md, "Bars"): on a bar chart drawn as vectors,
 * By colour ▸ Bars reads each bar from its drawn rectangle. The record is the
 * bar's height (David, 2026-10-12), so the test is the reverse check: the
 * heights filed through the app's own bar path equal the data the figure was
 * made from, to its 2 decimals.
 *
 * Fixtures: fixtures/vector/make_bars.py (matplotlib). The calibration is the
 * walk a user makes (P1, P2 on the value axis, then the category axis's two
 * outer edges and its count), at the positions the GENERATOR gave them.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readDrawing, readTextBoxes, type PdfTextItem } from '../pdfDrawing.js';
import { pageToImage, placeDrawing } from '../drawingPlacement.js';
import type { Provenance } from '../projectFile.js';
import type { PlacedDrawing } from '../../algorithms/findLines/fromDrawing.js';
import { barsFromDrawing } from '../barsFromDrawing.js';
import { partitionSwatchSuspects } from '../barDetectRun.js';
import { CalibrationSession, BAR_AXES_CONFIG, type CalibratedAxes } from '../calibrationSession.js';
import { walkCategoryAxis } from './helpers/categoryWalk.js';

const FIX = join(__dirname, 'fixtures/vector');
type Pt = [number, number];
interface Truth {
  box: number[];
  horizontal: boolean;
  value: [number, number][];
  category: { from: Pt; to: Pt; count: number };
  series: { colour: [number, number, number]; heights: number[] }[];
  swatches: number[][];
  floating?: number[];
}
const figs: Record<string, { drawing: PlacedDrawing; truth: Truth; at: (p: Pt) => Pt; size: { w: number; h: number } }> = {};

beforeAll(async () => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  for (const name of ['bars-grouped', 'bars-horizontal', 'bars-floating']) {
    const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(join(FIX, name + '.pdf'))), verbosity: 0 }).promise;
    const page = await doc.getPage(1);
    const vp = page.getViewport({ scale: 3.7 });
    const prov: Provenance = { source: { pageTransform: vp.transform as [number, number, number, number, number, number] } };
    const drawing = readDrawing(await page.getOperatorList(), pdfjs.OPS as unknown as Record<string, number>);
    const text = readTextBoxes((await page.getTextContent()).items as PdfTextItem[]);
    figs[name] = {
      drawing: placeDrawing(prov, drawing, text)!,
      truth: JSON.parse(readFileSync(join(FIX, name + '.truth.json'), 'utf8')),
      at: (p) => { const q = pageToImage(prov, p)!; return [q.x, q.y]; },
      size: { w: vp.width, h: vp.height },
    };
  }
});

/** A bar session calibrated the way a user walks it, at the generator's positions. */
function session(name: string): CalibrationSession<CalibratedAxes> {
  const f = figs[name]!;
  const t = f.truth;
  const s = new CalibrationSession<CalibratedAxes>(BAR_AXES_CONFIG as never);
  if (t.horizontal) s.setOption('isRotated', 'true');
  for (const [v, pos] of t.value) {
    const p = t.horizontal ? f.at([pos, t.box[1]!]) : f.at([t.box[0]!, pos]);
    s.handleCalibrationClick(p[0], p[1]);
    s.confirmCalibrationValues([String(v)]);
  }
  const from = f.at(t.category.from), to = f.at(t.category.to);
  walkCategoryAxis(s, { from: { x: from[0], y: from[1] }, to: { x: to[0], y: to[1] }, count: t.category.count });
  if (!s.runCalibration()) throw new Error(`${name}: calibration refused: ${s.getCalibrationError()}`);
  return s;
}

/** The series' bars as the app files them: read, swatches held back, filed.
 * `maskLegend` marks the legend as not-data, as a user does (V17). */
function file(name: string, k: number, maskLegend = false) {
  const f = figs[name]!;
  const s = session(name);
  const baseline = s.baselinePixelForDetect() ?? undefined;
  const masks = maskLegend ? f.truth.swatches.map((b) => {
    const a = f.at([b[0]! - 2, b[1]! - 2]), c = f.at([b[2]! + 2, b[3]! + 2]);
    return { x0: Math.min(a[0], c[0]), y0: Math.min(a[1], c[1]), x1: Math.max(a[0], c[0]), y1: Math.max(a[1], c[1]) };
  }) : [];
  const result = barsFromDrawing(f.drawing, f.truth.series[k]!.colour, { x0: 0, y0: 0, x1: f.size.w, y1: f.size.h }, { categoryAxis: f.truth.horizontal ? 'y' : 'x', masks, ...(baseline ? { baseline } : {}) });
  const { file: filed, holdBack } = partitionSwatchSuspects(result);
  const added = s.addBarDetectBoxes(filed);
  // each bar's height, by its category's place along the axis
  const heights: number[] = [];
  for (const r of s.getTupleRows()) if (r.position !== null) heights[r.position - 1] = r.derived as number;
  return { s, result, added, holdBack, heights };
}

describe('V18: bars read from the drawing are the data the figure was made from', () => {
  it('V18: grouped bars, each series one bar per drawn rectangle, heights to the data\'s 2 decimals (negative bars too)', () => {
    for (const k of [0, 1]) {
      const { heights, added } = file('bars-grouped', k, true);
      const want = figs['bars-grouped']!.truth.series[k]!.heights;
      expect(added, `series ${k}: one bar per drawn rectangle`).toBe(want.length);
      expect(heights).toHaveLength(want.length);
      want.forEach((w, i) => expect(Math.abs(heights[i]! - w), `series ${k} bar ${i}`).toBeLessThan(0.005));
    }
  });

  it('V18: with the legend marked not-data, its swatch in the series\' colour is not read as a bar', () => {
    // ⚠️ Unmasked, matplotlib's default legend swatch (20 pt wide) is wider than
    // half these grouped bars (18 pt), so the swatch rule does not hold it back,
    // on pixels or on the drawing: a finding for David, not fixed here
    expect(file('bars-grouped', 0, true).added).toBe(5);
    expect(file('bars-grouped', 0, false).added).toBe(6);
  });

  it('V18: horizontal bars, outlined in their own colour, are read once each', () => {
    const { heights, added } = file('bars-horizontal', 0);
    const want = figs['bars-horizontal']!.truth.series[0]!.heights;
    expect(added).toBe(want.length);
    expect(heights).toHaveLength(want.length);
    want.forEach((w, i) => expect(Math.abs(heights[i]! - w), `bar ${i}`).toBeLessThan(0.005));
  });

  it('V18: a bar that does not stand on the baseline is filed, and the bar table\'s own off-baseline note says so', () => {
    const { s, added } = file('bars-floating', 0);
    expect(added).toBe(3);
    const flagged = s.getBarCategoryTable().advisory.map((a) => a.categoryIndex).sort();
    expect(flagged).toEqual(figs['bars-floating']!.truth.floating);
  });
});

describe('V18 away from matplotlib: R, ggplot2 and LibreOffice bars', () => {
  // fixtures/vector/make_bars.R and `make_bars.py lo`; one series, known
  // heights. The drawn heights must stand in the data's proportions, which
  // needs no calibration. LibreOffice closes each bar's outline twice and
  // starts its legend swatch half way along an edge.
  const data = [3.25, 5.1, 2.4, 6.75];
  for (const name of ['bars-rbase', 'bars-rcairo', 'bars-rgg', 'bars-lo']) {
    it(`V18 ${name}: one bar per drawn rectangle, heights in the data's proportions`, async () => {
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(join(FIX, name + '.pdf'))), verbosity: 0 }).promise;
      const page = await doc.getPage(1);
      const vp = page.getViewport({ scale: 3.7 });
      const prov: Provenance = { source: { pageTransform: vp.transform as [number, number, number, number, number, number] } };
      const placed = placeDrawing(prov, readDrawing(await page.getOperatorList(), pdfjs.OPS as unknown as Record<string, number>), [])!;
      const r = barsFromDrawing(placed, [31, 119, 180], { x0: 0, y0: 0, x1: vp.width, y1: vp.height }, { categoryAxis: 'x' });
      // the four bars, left to right (LibreOffice's swatch is the fifth: small and apart)
      const bars = r.boxes.filter((b) => b.end.x - b.start.x > 10 * 3.7).sort((a, b) => a.start.x - b.start.x);
      expect(bars).toHaveLength(4);
      const h = bars.map((b) => b.end.y - b.start.y);
      h.forEach((v, i) => expect(Math.abs(v / h[0]! - data[i]! / data[0]!), `bar ${i}`).toBeLessThan(1e-3));
    });
  }
});
