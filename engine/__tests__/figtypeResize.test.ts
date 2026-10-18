/**
 * The graph-type suggestion as the app runs it (ui/electron-figtype.cjs in the OCR's worker,
 * engine/figureType.ts for the fusion), against what the research measured.
 *
 * ⚑ The models were trained and measured on images shrunk by Pillow's BILINEAR resize; the port
 * reproduces it to the unit (fixtures made by Pillow from two bundled samples). And every bundled
 * sample gets the suggestion the research run gave it (plottracer-ref research/v2.7-figclass,
 * r3-e5 fused with Docling, 70%): not 29 of 29 right, but the measured answers, so a wrong model
 * file, a changed resize or a broken fusion shows here.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { suggestGraphType } from '../figureType.js';

const require_ = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..');
const { resizeLikePil } = require_(path.join(root, 'ui/electron-figtype.cjs')) as {
  resizeLikePil: (rgb: Uint8Array, w: number, h: number, W: number, H: number) => Uint8Array;
};
const { decodePng } = require_(path.join(root, 'ui/electron-ocr-png.cjs')) as {
  decodePng: (b: Buffer) => { data: Uint8Array; width: number; height: number };
};
const ocr = require_(path.join(root, 'ui/electron-ocr.cjs')) as {
  classifyFigure: (b64: string) => Promise<{ own?: number[]; docling?: number[]; error?: string }>;
  shutdownOcr: () => Promise<void>;
};

afterAll(async () => {
  await ocr.shutdownOcr();
});

describe('the graph-type models see the figure as they did when measured', () => {
  for (const name of ['bar-tensile-strength', 'spider-material-profile']) {
    it(`${name}: shrunk to 224 x 224 exactly as Pillow's BILINEAR resize does`, () => {
      const img = decodePng(readFileSync(path.join(root, 'samples', `${name}.png`)));
      const rgb = new Uint8Array(img.width * img.height * 3);
      for (let p = 0; p < img.width * img.height; p++) for (let c = 0; c < 3; c++) rgb[p * 3 + c] = img.data[p * 4 + c]!;
      const got = resizeLikePil(rgb, img.width, img.height, 224, 224);
      const want = new Uint8Array(readFileSync(path.join(here, 'fixtures/figtype', `${name}.pillow224.rgb`)));
      expect(got.length).toBe(want.length);
      expect(got.every((v, i) => v === want[i])).toBe(true);
    });
  }
});

/** The measured answers (research r3-e5 + Docling, 70%); null = no suggestion. */
const MEASURED: Record<string, string | null> = {
  'bar-box-plot-tensile-strength': 'boxplot', 'bar-floating-temperature': 'bar', 'bar-grouped-missing-assay': 'bar',
  'bar-grouped-viability': 'bar', 'bar-hatched-extraction-yield': 'bar', 'bar-stacked-cost': 'bar', 'bar-tensile-strength': 'bar',
  'candlestick-trading-week': 'boxplot', 'categorical-fibre-modulus': 'xy', 'circular-temperature-recording': null,
  'contour-potential-energy': null, 'donut-donut-flavours': 'pie', 'errorbar-failure-time-asymmetric': 'xy', 'errorbar-tensile-cure': 'xy',
  'heatmap-assay-log': null, 'heatmap-timecourse': null, 'heatmap-weld-temperature': 'heatmap', 'histogram-pore-size': 'bar',
  'map-collection-sites': 'map', 'pie-exploded-market-share': 'pie', 'pie-filler-composition': 'pie', 'pie-tilted-market-segments': 'pie',
  'polar-diffusion-rate': null, 'scatter-crosslink-modulus': 'xy', 'spider-material-profile': null, 'ternary-blend-composition': null,
  'xy-dashed-release': 'xy', 'xy-multiseries-modulus': 'xy', 'xy-stress-strain': 'xy',
};

describe('every bundled sample gets the graph type the research measured', () => {
  it('29 samples, through the worker the app uses', async () => {
    const got: Record<string, string | null> = {};
    for (const name of Object.keys(MEASURED)) {
      const r = await ocr.classifyFigure(readFileSync(path.join(root, 'samples', `${name}.png`)).toString('base64'));
      expect(r.error, name).toBeUndefined();
      got[name] = suggestGraphType(r.own!, r.docling!).type;
    }
    expect(got).toEqual(MEASURED);
  }, 120000);
});
