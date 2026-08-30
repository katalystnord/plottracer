import { describe, it, expect, afterAll } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  cropForOcr,
  labelRegionsInBand,
  axisQuarterTurn,
  axisRunsAlong,
  normalizeOcrText,
  type QuarterTurn,
} from '../ocrRegion.js';
import { encodePng } from './helpers/encodePng.js';

/**
 * ⚑⚑ THE WHOLE FEATURE, ON REAL INK, AGAINST COMMITTED GROUND TRUTH (v2.4).
 *
 * One drag round the row of category labels on `samples/bar-tensile-strength.png`
 * becomes six names in the review card. Every step is the shipped code: the
 * axis's own dividers cut the band, `cropForOcr` takes each piece,
 * `ui/electron-ocr.cjs` reads it, and `axisQuarterTurn` decides which way the
 * labels are written.
 *
 * ⚑ THE INSTRUMENT IS THE FIGURE'S OWN TRUTH FILE, not numbers this test made
 * up: the category axis's two ends and its count come from
 * `bar-tensile-strength.truth.json`, and the six expected names are its own
 * `series[0].points`. A test that invented its geometry would prove
 * self-consistency ([[feedback_ground_truth_is_the_instrument]]).
 *
 * ⚑ The fixture is the sample's pixels as raw RGBA, gzipped (25KB) - so no PNG
 * DECODER is needed anywhere, and a decoder bug cannot masquerade as an OCR
 * finding. See helpers/encodePng.ts for why only the encoder exists.
 */

const require_ = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));

interface OcrModule {
  readText(pngBase64: string): Promise<{ text?: string; confidence?: number; error?: string }>;
  shutdownOcr(): Promise<void>;
}
const ocr = require_('../../ui/electron-ocr.cjs') as OcrModule;

afterAll(async () => {
  await ocr.shutdownOcr();
});

describe('OCR: one band drag names every category', () => {
  it('reads all six names off the figure, at the turn the axis agrees on', async () => {
    const meta = JSON.parse(
      readFileSync(path.join(here, 'fixtures/ocr/bar-tensile-strength.rgba.json'), 'utf8')
    ) as { width: number; height: number };
    const pixels = new Uint8ClampedArray(
      gunzipSync(readFileSync(path.join(here, 'fixtures/ocr/bar-tensile-strength.rgba.gz')))
    );
    const truth = JSON.parse(readFileSync('samples/bar-tensile-strength.truth.json', 'utf8')) as {
      calibration: { anchors: Record<string, { px: number; py: number; value?: number }> };
      series: { points: { category: string }[] }[];
    };

    // The category axis exactly as the walk records it: two clicked ends and a
    // declared count, which is what CategoryAxis turns into N+1 dividers.
    const c1 = truth.calibration.anchors['c1']!;
    const c2 = truth.calibration.anchors['c2']!;
    const count = c2.value!;
    const ends = [
      { x: c1.px, y: c1.py },
      { x: c2.px, y: c2.py },
    ] as const;
    const dividers = Array.from({ length: count + 1 }, (_, i) => ({
      x: ends[0].x + ((ends[1].x - ends[0].x) * i) / count,
      y: ends[0].y + ((ends[1].y - ends[0].y) * i) / count,
    }));

    // ONE gesture: a box round the row of labels, just below the axis.
    const band = {
      x: Math.round(Math.min(ends[0].x, ends[1].x)),
      y: Math.round(ends[0].y + 4),
      width: Math.round(Math.abs(ends[1].x - ends[0].x)),
      height: 30,
    };
    const regions = labelRegionsInBand(band, dividers, axisRunsAlong(ends[0], ends[1]));
    expect(regions.map((r) => r.categoryIndex)).toEqual([0, 1, 2, 3, 4, 5]);

    const readAll = async (turn: QuarterTurn) => {
      const rows: { text: string; confidence: number }[] = [];
      for (const region of regions) {
        const crop = cropForOcr(pixels, meta.width, meta.height, region.rect, turn);
        expect(crop, 'a region cut from the band had no pixels').not.toBeNull();
        const answer = await ocr.readText(encodePng(crop!).toString('base64'));
        expect(answer.error).toBeUndefined();
        rows.push({ text: normalizeOcrText(answer.text ?? ''), confidence: answer.confidence ?? 0 });
      }
      return rows;
    };

    const byTurn = [await readAll(0), await readAll(1), await readAll(2), await readAll(3)];
    const turn = axisQuarterTurn(byTurn.map((rows) => rows.map((r) => r.confidence)));
    // These labels are printed horizontally, so the axis must agree that no turn
    // is needed - the same vote that rescues a rotated axis has to leave an
    // ordinary one alone.
    expect(turn).toBe(0);
    expect(byTurn[turn!]!.map((r) => r.text)).toEqual(
      truth.series[0]!.points.map((p) => p.category)
    );
  }, 120000);
});
