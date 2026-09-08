/**
 * ⚑⚑⚑ THE GATE FOR THE WHOLE-BAND READ (v2.5): does it hold the floor?
 *
 * David's design - measure the axis's angle, straighten the band, read it ONCE,
 * and relate the words to the ticks - has to be scored against the path it
 * replaces before anything is switched over. This is the same corpus, the same
 * truth files and the SAME band rule as `ocrCorpusRecall`, so the only variable
 * is the reading strategy.
 *
 * ⚠️ THE MEASUREMENT THAT ARGUES AGAINST IT, and why it is not decisive: the
 * v2.4 spike found a whole axis in one box reading `30 | 20 | ) | V | 5 10` at
 * confidence 54 while the same numbers read perfectly one tick at a time. That
 * tested a horizontal strip, undeskewed, taking the whole returned string, and
 * never used the word boxes. It is a warning, not a refutation - which is
 * exactly why this file exists rather than an argument.
 *
 * ⛔ IT MUST HOLD 35/36 ON THESE HORIZONTAL FIGURES. A 45 degree figure reading
 * beautifully does not buy a single label off the corpus the tool is actually
 * pointed at.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { readPng } from './helpers/readPng.js';
import { encodePng } from './helpers/encodePng.js';
import { axisRunsAlong, cropForOcr, upscaleForOcr } from '../ocrRegion.js';
import { deskewBand, findBandAngle } from '../ocrDeskew.js';
import { wordsToTicks } from '../ocrWordsToTicks.js';

const require_ = createRequire(import.meta.url);
const ocr = require_('../../ui/electron-ocr.cjs') as {
  readText(
    b: string,
    t?: number
  ): Promise<{
    text?: string;
    confidence?: number;
    words?: { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }[];
    error?: string;
  }>;
  shutdownOcr(): Promise<void>;
};

const FIGURES = [
  'bar-tensile-strength',
  'bar-box-plot-tensile-strength',
  'bar-floating-temperature',
  'bar-grouped-missing-assay',
  'bar-grouped-viability',
  'bar-stacked-cost',
  // ⚑⚑ THE ROTATED CASE, and the corpus had none until now: every other figure
  // we ship draws its labels horizontal, so the whole harness was blind to
  // rotated text by construction. David's 45 degree figure read back as
  // `he' "0 3 9` at confidence 32 and nothing could see it.
  'candlestick-trading-week',
];
/**
 * ⚑⚑ ONE BAND RULE FOR EVERY FIGURE, and both numbers were MEASURED by sweeping
 * them across the whole corpus rather than chosen - a harness tuned per figure
 * measures the tuner.
 *
 * DEPTH 120: a 45 degree label drops about 64px below the axis, so the old 34
 * (fine for horizontal labels) CLIPS a rotated one. Measured at TOP 8: depth 34
 * reads the rotated figure 0/8 at a nonsense 55 degrees, depth 120 reads it 7/8
 * at -45. The horizontal figures are unchanged either way.
 *
 * TOP_GAP 8: the band must start BELOW THE TICK MARKS. At 3 the ticks are inside
 * it and each one rotates into a dash the reader prepends to its label -
 * `- 2021-01-03`, seven times over, otherwise perfect. At 8 they are gone.
 * ⚠️ AND 12 IS A CLIFF: the horizontal labels start right under their ticks, so
 * 12 clips them and the corpus collapses to 21/44. The window is narrow, which
 * is a fact about the FEATURE and not just this harness - the user drags this
 * band by hand.
 */
const DEPTH = 120;
const TOP_GAP = 8;

/**
 * What each figure reads through the whole-band path, as a FLOOR.
 *
 * ⚑ The six horizontal figures score exactly what the per-label path scores -
 * `bar-stacked-cost` misses the same single label (`Q1` read as `Ql`), which is
 * a glyph confusion and not a strategy difference. So the new path costs
 * nothing on the corpus the tool is actually pointed at.
 *
 * ⚑⚑ AND IT ADDS THE CASE THE OLD PATH CANNOT READ AT ALL: 7 of 8 at 45
 * degrees, against 0 of 8 for every quarter turn. The remaining miss is the
 * LEFTMOST label - a rotated label trails past the axis START, so the band's own
 * left edge clips `2021-01-01` into `-1-01-01`.
 */
const FLOORS: Record<string, number> = {
  'bar-tensile-strength': 6,
  'bar-box-plot-tensile-strength': 5,
  'bar-floating-temperature': 12,
  'bar-grouped-missing-assay': 5,
  'bar-grouped-viability': 4,
  'bar-stacked-cost': 3,
  'candlestick-trading-week': 7,
};

describe('reading each figure’s label band in ONE pass', () => {
  it('scores the whole-band read against the per-label floor', { timeout: 600000 }, async () => {
    const out: string[] = [];
    const scores: Record<string, number> = {};
    let totalHit = 0;
    let totalAll = 0;
    for (const name of FIGURES) {
      const img = readPng(`samples/${name}.png`);
      const truth = JSON.parse(readFileSync(`samples/${name}.truth.json`, 'utf8')) as {
        calibration: { anchors: Record<string, { px: number; py: number; value?: number }> };
        series: { points: { category?: string }[] }[];
      };
      const c1 = truth.calibration.anchors['c1']!;
      const c2 = truth.calibration.anchors['c2']!;
      const N = c2.value!;
      const longest = truth.series.reduce((a, b) => (b.points.length > a.points.length ? b : a));
      const names: string[] = [];
      for (const p of longest.points) if (p.category && !names.includes(p.category)) names.push(p.category);
      for (const s of truth.series)
        for (const p of s.points) if (p.category && !names.includes(p.category)) names.push(p.category);

      const dividers = Array.from({ length: N + 1 }, (_, i) => ({
        x: c1.px + ((c2.px - c1.px) * i) / N,
        y: c1.py + ((c2.py - c1.py) * i) / N,
      }));
      const along = axisRunsAlong({ x: c1.px, y: c1.py }, { x: c2.px, y: c2.py });
      const nx = -(c2.py - c1.py);
      const ny = c2.px - c1.px;
      const len = Math.hypot(nx, ny) || 1;
      const ox = (nx / len) * DEPTH;
      const oy = (ny / len) * DEPTH;
      const xs = [c1.px, c2.px, c1.px + ox, c2.px + ox];
      const ys = [c1.py, c2.py, c1.py + oy, c2.py + oy];
      const band = {
        x: Math.round(Math.min(...xs)),
        y: Math.round(Math.min(...ys) + (along === 'x' ? TOP_GAP : 0)),
        width: Math.round(Math.max(...xs) - Math.min(...xs)),
        height: Math.round(Math.max(...ys) - Math.min(...ys)),
      };

      const crop = cropForOcr(img.data, img.width, img.height, band, 0)!;
      // ⚑ The angle is found by READING at it - the reader's own confidence is
      // the instrument, generalising `axisQuarterTurn`'s measured rule off its
      // four fixed values.
      const readMeanConfidence = async (radians: number) => {
        const turned = deskewBand(crop.data, crop.width, crop.height, radians);
        const a = await ocr.readText(encodePng(upscaleForOcr(turned)).toString('base64'));
        const ws = (a.words ?? []).filter((w) => w.text.trim() !== '');
        // ⚑⚑ CONFIDENCE x LENGTH, SUMMED - not the mean. The mean is not
        // comparable across angles because the WORD COUNT changes with the
        // angle: a wrong angle returns a handful of confidently-read glyphs
        // (`©`, `&`) and outscores four correct labels. Measured - mean
        // confidence picked -30 for a horizontal figure and took it from 4/4 to
        // 0/4. Length is what separates a label from a confident smudge.
        return ws.reduce((t, w) => t + w.confidence * w.text.trim().length, 0);
      };
      const { radians: angle } = (await findBandAngle(readMeanConfidence))!;
      const straight = deskewBand(crop.data, crop.width, crop.height, angle);
      const scaled = upscaleForOcr(straight);
      const factor = straight.height === 0 ? 1 : scaled.height / straight.height;
      const answer = await ocr.readText(encodePng(scaled).toString('base64'));
      if (answer.error !== undefined || (answer.words ?? []).length === 0) {
        throw new Error(
          `OCR gave nothing for ${name}: error=${String(answer.error)} words=${(answer.words ?? []).length} text=${JSON.stringify(answer.text ?? '')}`
        );
      }
      const readings = wordsToTicks({
        words: (answer.words ?? []).map((w) => ({
          text: w.text,
          confidence: w.confidence,
          bbox: {
            x0: w.bbox.x0 / factor,
            y0: w.bbox.y0 / factor,
            x1: w.bbox.x1 / factor,
            y1: w.bbox.y1 / factor,
          },
        })),
        toSource: (x, y) => {
          const inCrop = straight.toSource(x, y);
          return { x: inCrop.x + band.x, y: inCrop.y + band.y };
        },
        dividers,
        along,
        axisAt: along === 'x' ? c1.py : c1.px,
      });

      const byIndex = new Map(readings.map((r) => [r.categoryIndex, r.text]));
      let hit = 0;
      const detail: string[] = [];
      for (let i = 0; i < N; i++) {
        const want = names[i];
        const got = byIndex.get(i) ?? '';
        if (want !== undefined && got === want) hit++;
        else detail.push(`      ${i + 1} want ${JSON.stringify(want ?? '?')} got ${JSON.stringify(got)}`);
      }
      totalHit += hit;
      totalAll += N;
      scores[name] = hit;
      out.push(`${name.padEnd(32)} ${hit}/${N}  angle ${Math.round((angle * 180) / Math.PI)}`);
      out.push(...detail);
    }
    // ⚠️ THE PER-FIGURE TABLE GOES IN THE FAILURE MESSAGE, NOT TO A FILE. This
    // wrote its score sheet to a scratchpad path belonging to the session that
    // authored it, so the test failed with ENOENT for every later run and on
    // CI - a harness that reports its own absence as the code's failure. The
    // numbers were always in `out`; the assertions below print them.
    // ⚑ PER FIGURE, not just a total: a total alone lets one figure improve
    // while another rots, and the pair nets to green. Same rule as the
    // per-label harness this is measured against.
    for (const [name, floor] of Object.entries(FLOORS)) {
      expect(scores[name], `${name} read ${scores[name]} of its category names, floor ${floor}\n${out.join('\n')}`)
        .toBeGreaterThanOrEqual(floor);
    }
    expect(totalHit, `corpus total\n${out.join('\n')}`).toBeGreaterThanOrEqual(42);
    expect(totalAll).toBe(44);
  });
});

afterAll(async () => {
  await ocr.shutdownOcr();
});
