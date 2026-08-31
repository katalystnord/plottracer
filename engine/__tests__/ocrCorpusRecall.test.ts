import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { readPng } from './helpers/readPng.js';
import { encodePng } from './helpers/encodePng.js';
import { cropForOcr, labelRegionsInBand, axisQuarterTurn, normalizeOcrText, axisRunsAlong, type QuarterTurn } from '../ocrRegion.js';

const require_ = createRequire(import.meta.url);
const ocr = require_('../../ui/electron-ocr.cjs') as {
  readText(b: string, t?: number): Promise<{ text?: string; confidence?: number; error?: string }>;
  shutdownOcr(): Promise<void>;
};

const FIGURES = ['bar-tensile-strength','bar-box-plot-tensile-strength','bar-floating-temperature','bar-grouped-missing-assay','bar-grouped-viability','bar-stacked-cost'];
const DEPTH = 34; // how far past the axis the label band reaches

/**
 * What each figure reads today, as a floor rather than a target.
 *
 * ⚑ These are MEASURED numbers, not aspirations, and the two that are short of
 * full marks are short for reasons named in this file's header. Raising one is
 * a change to the feature; lowering one is a regression and should fail here.
 */
const FLOORS: Record<string, number> = {
  'bar-tensile-strength': 6,
  'bar-box-plot-tensile-strength': 5,
  'bar-floating-temperature': 12,
  'bar-grouped-missing-assay': 2,
  'bar-grouped-viability': 4,
  'bar-stacked-cost': 3,
};

/**
 * ⚑⚑⚑ HOW WELL DO WE READ THE CATEGORY NAMES ON EVERY FIGURE WE SHIP? (v2.4)
 *
 * David: *"I think that the majority are not at an angle. And we should probably
 * test that first. And how can we automate tests for success?"* Both halves of
 * that are answered here, and the second one was already answered by the repo:
 * **every bundled sample ships its own `.truth.json` carrying its category
 * names**, so success is measurable without anyone inventing a target.
 *
 * ⚑⚑ THE HARNESS MUST NOT GRADE ITS OWN AIM. The label band is derived from the
 * axis by ONE rule applied to every figure - out along the axis's own normal by
 * a fixed depth - never nudged per figure until it passes. A harness tuned
 * figure by figure measures the tuner ([[feedback_a_harness_only_tests_me]]).
 *
 * ⚠️ WHAT A GREEN RUN HERE DOES NOT MEAN. These are OUR figures, drawn by us,
 * and a tool can be shaped to fit its own examples without anyone intending it.
 * The counter-instrument is a REAL figure from outside the repo, and the first
 * one tried (matplotlib's own 45-degree gallery chart) read **0 of 16**. So this
 * number is a regression floor, not a claim about the world.
 *
 * ▶ MEASURED 2026-08-31: **32 of 35**, with two failure classes worth naming.
 *   · `bar-grouped-missing-assay` 2/4 - `Glucose` and `Sucrose` are WIDER than
 *     their category band, so a vertical slice catches its own label plus a
 *     piece of its neighbour's (`"Glucose Lact"`, `"ose Sucrose"`). The region
 *     follows the BAND and the label does not respect it. Same root cause as the
 *     45-degree failure, but on an ordinary horizontal figure, which makes it
 *     the more important half.
 *   · `bar-stacked-cost` 3/4 - `Q1` read as `Ql`, confidence 73. Character-level
 *     OCR noise with nothing for us to fix: it is what the offer window exists
 *     for, and a person corrects it in seconds.
 */
describe('reading the category names on every figure we ship', () => {
  it('holds its corpus score', { timeout: 600000 }, async () => {
    const out: string[] = [];
    const scores: Record<string, number> = {};
    let totalHit = 0, totalAll = 0;
    for (const name of FIGURES) {
      const img = readPng(`samples/${name}.png`);
      const truth = JSON.parse(readFileSync(`samples/${name}.truth.json`, 'utf8')) as {
        calibration: { anchors: Record<string, { px: number; py: number; value?: number }> };
        series: { points: { category?: string }[] }[];
      };
      const c1 = truth.calibration.anchors['c1']!, c2 = truth.calibration.anchors['c2']!;
      const N = c2.value!;
      const names: string[] = [];
      for (const s of truth.series) for (const p of s.points) if (p.category && !names.includes(p.category)) names.push(p.category);
      const dividers = Array.from({ length: N + 1 }, (_, i) => ({ x: c1.px + ((c2.px - c1.px) * i) / N, y: c1.py + ((c2.py - c1.py) * i) / N }));
      const along = axisRunsAlong({ x: c1.px, y: c1.py }, { x: c2.px, y: c2.py });
      // ⚑ The SAME band rule for every figure, derived from the axis, never
      // tuned per figure - otherwise the harness is grading its own aim.
      const nx = -(c2.py - c1.py), ny = c2.px - c1.px;
      const len = Math.hypot(nx, ny) || 1;
      const ox = (nx / len) * DEPTH, oy = (ny / len) * DEPTH;
      const xs = [c1.px, c2.px, c1.px + ox, c2.px + ox], ys = [c1.py, c2.py, c1.py + oy, c2.py + oy];
      const band = { x: Math.round(Math.min(...xs)), y: Math.round(Math.min(...ys) + (along === 'x' ? 3 : 0)), width: Math.round(Math.max(...xs) - Math.min(...xs)), height: Math.round(Math.max(...ys) - Math.min(...ys)) };
      const regions = labelRegionsInBand(band, dividers, along);
      const sweeps: { text: string; conf: number }[][] = [];
      for (const turn of [0, 1, 2, 3] as QuarterTurn[]) {
        const rows: { text: string; conf: number }[] = [];
        for (const r of regions) {
          const crop = cropForOcr(img.data, img.width, img.height, r.rect, turn);
          if (!crop) { rows.push({ text: '', conf: 0 }); continue; }
          const a = await ocr.readText(encodePng(crop).toString('base64'));
          rows.push({ text: normalizeOcrText(a.text ?? ''), conf: a.confidence ?? 0 });
        }
        sweeps.push(rows);
      }
      const turn = axisQuarterTurn(sweeps.map((r) => r.map((x) => x.conf)));
      const rows = sweeps[turn ?? 0]!;
      let hit = 0;
      const detail: string[] = [];
      rows.forEach((r, i) => {
        const want = names[i];
        const ok = want !== undefined && r.text === want;
        if (ok) hit++;
        if (!ok) detail.push(`      ${i + 1} want ${JSON.stringify(want ?? '?')} got ${JSON.stringify(r.text)} (${Math.round(r.conf)})`);
      });
      totalHit += hit; totalAll += rows.length;
      scores[name] = hit;
      out.push(`${name.padEnd(32)} ${hit}/${rows.length}  turn ${(turn ?? 0) * 90}`);
      out.push(...detail);
    }
    // ⚑ PER FIGURE, not just a total: a total alone lets one figure improve
    // while another rots, and the pair would net to green.
    for (const [name, floor] of Object.entries(FLOORS)) {
      expect(scores[name], `${name} read ${scores[name]} of its category names, floor ${floor}\n${out.join('\n')}`)
        .toBeGreaterThanOrEqual(floor);
    }
    expect(totalHit, `corpus total\n${out.join('\n')}`).toBeGreaterThanOrEqual(32);
    expect(totalAll).toBe(35);
  });
});

afterAll(async () => { await ocr.shutdownOcr(); });
