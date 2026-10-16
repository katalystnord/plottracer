import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readPng } from './helpers/readPng.js';
import { encodePng } from './helpers/encodePng.js';
import { upscaleForOcr } from '../ocrRegion.js';

/**
 * The two cases the PaddleOCR reader adds (v2.7, docs/v2.7-paddle-ocr.md, cases 8 and 9).
 *
 * ⚑ Both run the module the shipped main process loads, `ui/electron-ocr.cjs`. The fixtures are
 * rendered by `fixtures/ocr/gen_labels.py` with the samples' own matplotlib settings, because no
 * shipped sample carries these characters or this crowding.
 */

const require_ = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const ocr = require_('../../ui/electron-ocr.cjs') as {
  readText(b: string): Promise<{
    text?: string;
    confidence?: number;
    error?: string;
    words?: { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }[];
  }>;
  shutdownOcr(): Promise<void>;
};
afterAll(async () => {
  await ocr.shutdownOcr();
});

const fixture = (name: string) => readFileSync(path.join(here, 'fixtures/ocr', name));

describe('case 8: the characters a science or Swedish label needs', () => {
  for (const [file, want] of [
    ['label-hallfasthet.png', 'Hållfasthet'],
    ['label-micrometre.png', 'µm'],
    ['label-degrees-c.png', '°C'],
  ] as const) {
    it(`reads ${want} exactly`, async () => {
      const answer = await ocr.readText(fixture(file).toString('base64'));
      expect(answer.error).toBeUndefined();
      // ⚑ The micro sign (U+00B5) and Greek mu (U+03BC) are one letter in two code points, and
      // the reader answers the Greek one, which Unicode recommends; NFKC folds the sign onto it.
      // Nothing else in these three strings changes under NFKC.
      expect(answer.text?.replace(/\s+/g, ' ').trim()).toBe(want.normalize('NFKC'));
    });
  }
});

describe('case 9: a crowded tick row the detector sees as one line', () => {
  it('gives every label its own word, in order, each in its own place', async () => {
    // ⚑ Upscaled exactly as `readBandAtAngle` does before it reads a band.
    const band = upscaleForOcr(readPng(path.join(here, 'fixtures/ocr/band-ticks-18-30.png')));
    const answer = await ocr.readText(encodePng(band).toString('base64'));
    expect(answer.error).toBeUndefined();
    const words = answer.words ?? [];
    expect(words.map((w) => w.text)).toEqual(['18', '20', '22', '24', '26', '28', '30']);
    for (let i = 1; i < words.length; i++) {
      expect(words[i]!.bbox.x0, `"${words[i]!.text}" overlaps the word before it`).toBeGreaterThanOrEqual(words[i - 1]!.bbox.x1);
    }
  });
});
