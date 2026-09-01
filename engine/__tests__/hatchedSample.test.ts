import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

import { runBarDetect } from '../barDetectRun.js';
import { readPng } from './helpers/readPng.js';

/**
 * ⚑⚑ THE HATCHED EXAMPLE, TRACED END TO END ON ITS OWN INK.
 *
 * `samples/bar-hatched-extraction-yield.png` exists so a person can see the
 * hatch join work, and so this can check it on real pixels rather than on
 * fabricated blob geometry. A hatch is drawn in a colour the trace drops, so
 * without the join a colour fill returns each bar as a pile of fragments - about
 * 34 pieces per bar on the benchmark corpus, where a perfectly drawn bar scored
 * ZERO.
 *
 * ⚑ The category axis comes from the figure's OWN truth file, exactly as the
 * walk's two clicks and declared count would supply it - which is also the gate
 * the join runs under.
 */
describe('the hatched example is traced as six bars, not as confetti', () => {
  it('⚑⚑ returns one box per bar and lands on each value', () => {
    const img = readPng('samples/bar-hatched-extraction-yield.png');
    const truth = JSON.parse(
      readFileSync('samples/bar-hatched-extraction-yield.truth.json', 'utf8')
    ) as {
      calibration: { anchors: Record<string, { px: number; py: number; value?: number }> };
      series: { points: { category: string; value: number }[] }[];
    };
    const anchors = truth.calibration.anchors;
    const p1 = anchors['p1']!;
    const p2 = anchors['p2']!;
    const c1 = anchors['c1']!;
    const c2 = anchors['c2']!;
    const count = c2.value!;
    // The declared bands: the two clicked ends, split evenly by the count.
    const dividers = Array.from(
      { length: count + 1 },
      (_, i) => c1.px + ((c2.px - c1.px) * i) / count
    );

    const result = runBarDetect(
      img.data,
      img.width,
      img.height,
      // The bar fill, sampled from inside a bar rather than declared here.
      (() => {
        const x = Math.round((dividers[0]! + dividers[1]!) / 2);
        const y = Math.round(p1.py - 30);
        const o = (y * img.width + x) * 4;
        return [img.data[o]!, img.data[o + 1]!, img.data[o + 2]!] as [number, number, number];
      })(),
      60,
      'foreground',
      undefined,
      { minDiameter: 3 },
      { dividers, categoryAxis: 'x' }
    );
    expect('error' in result ? result.error : null).toBeNull();
    if ('error' in result) return;

    // ⚑⚑ SIX BOXES. Without the join this figure comes back in pieces; the
    // number is the whole point of the example.
    expect(result.boxes).toHaveLength(count);
    expect(result.joinedAcrossHatch).toBeGreaterThan(0);

    // ...and each box's height reads its own value through the truth's own
    // two value anchors, so the join cannot have kept a fragment's extent.
    const perUnit = (p1.py - p2.py) / (p2.value! - p1.value!);
    const read = result.boxes
      .slice()
      .sort((a, b) => Math.min(a.start.x, a.end.x) - Math.min(b.start.x, b.end.x))
      .map((b) => (p1.py - Math.min(b.start.y, b.end.y)) / perUnit);
    const want = truth.series[0]!.points.map((p) => p.value);
    read.forEach((v, i) => {
      expect(Math.abs(v - want[i]!), `bar ${i + 1}: read ${v.toFixed(2)}, truth ${want[i]}`).toBeLessThan(0.5);
    });
  });
});
