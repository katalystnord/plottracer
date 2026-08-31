import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { readPng } from './helpers/readPng.js';
import { encodePng } from './helpers/encodePng.js';
import { cropForOcr, upscaleForOcr, labelRegionsInBand, axisQuarterTurn, normalizeOcrText, axisRunsAlong, type QuarterTurn } from '../ocrRegion.js';

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
  'bar-grouped-missing-assay': 4,
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
 * ▶ MEASURED 2026-08-31: **35 of 36**, and getting there corrected two
 * instruments before it corrected any code.
 *
 * ⚠️⚑⚑ THE FIRST RUN SAID 32 OF 35, AND I DIAGNOSED IT WRONG. Two figures
 * looked like feature failures and neither was:
 *
 *   1. `bar-grouped-missing-assay` read 2/4 as `"Glucose Lact"`, `"ose
 *      Sucrose"` - which I read as "labels wider than their band" and nearly
 *      built a fix for. **The TRUTH FILE was wrong.** It declared FOUR
 *      categories where the figure draws FIVE: the count of GAPS BETWEEN
 *      categories rather than of categories, with the resulting wrong pitch
 *      then baked into both axis ends (166.5 - 206.3/2 = 63.33 and
 *      785.4 + 206.3/2 = 888.67, exactly what was stored). Every band was 25%
 *      too wide, so of course each slice caught its neighbour.
 *   2. With that fixed the reads came back perfect - `Lactose` 94, `Sucrose` 96,
 *      `Maltose` 91 - and still scored 2/5, because **this harness built its
 *      expected list by first appearance across series**. `Control` has no
 *      Lactose (that is the figure's subject), so Lactose was appended LAST and
 *      every position after it compared against the wrong name.
 *
 * ▶ **A wrong instrument does not look wrong; it looks like a broken feature.**
 * Both faults pointed at the same figure and both produced plausible-looking
 * evidence for a bug that did not exist. That is why the ground truth is checked
 * against the ink when it disagrees with a reading, rather than the reading
 * being assumed at fault.
 *
 * ⚑ THE REMAINING MISSES, both character-level OCR noise with nothing for us to
 * fix - exactly what the offer window exists for: `bar-stacked-cost` reads `Q1`
 * as `Ql`, and `bar-grouped-missing-assay` reads `Maltose` as `Ma Itose`.
 *
 * ⚠️⚑⚑ 34 AND NOT 35, DELIBERATELY, AND THE TRADE IS WORTH WRITING DOWN. The
 * reader's page-segmentation mode and the upscaling of small crops were both
 * settled on the ICPR corpus of REAL published charts, where they are worth
 * **+10.2 points of exact match on 2,140 labels (70.4% to 80.6%)**. On these six
 * figures of ours the same settings cost ONE label. Six clean figures we drew
 * ourselves do not outrank 2,140 from real papers, so the floor moved and the
 * reason is here rather than in a commit nobody re-reads.
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
      // ⚑⚑ AXIS ORDER, NOT FIRST-APPEARANCE ORDER. A series lists its categories
      // along the axis, but a series may be MISSING one - which is the whole
      // subject of `bar-grouped-missing-assay`, where Control has no Lactose. A
      // naive merge across series appends the missing one at the END, so every
      // later position is compared against the wrong name and three perfect
      // readings (`Lactose` 94, `Sucrose` 96, `Maltose` 91) score as failures.
      // ▶ The series that carries the MOST categories is the one that saw the
      // whole axis; anything it still lacks is appended after it.
      const longest = truth.series.reduce((a, b) => (b.points.length > a.points.length ? b : a));
      const names: string[] = [];
      for (const p of longest.points) if (p.category && !names.includes(p.category)) names.push(p.category);
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
          const a = await ocr.readText(encodePng(upscaleForOcr(crop)).toString('base64'));
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
    expect(totalHit, `corpus total\n${out.join('\n')}`).toBeGreaterThanOrEqual(34);
    expect(totalAll).toBe(36);
  });
});

afterAll(async () => { await ocr.shutdownOcr(); });
