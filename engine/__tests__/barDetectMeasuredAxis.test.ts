import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

import { runBarDetect } from '../barDetectRun.js';
import { readPng } from './helpers/readPng.js';

/**
 * ⚑⚑ THE HATCH JOIN, WITH NOTHING DECLARED - on real ink.
 *
 * `hatchedSample.test.ts` proves the join works when the calibration walk has
 * supplied the category axis. This file is the case that walk never reaches: a
 * HISTOGRAM has no category ticks in its axes type, so nothing can ever declare
 * one for it, and a hatched histogram could not be rejoined at all. The same
 * holds for any bar chart auto-extracted before its walk is finished.
 *
 * ⚠️⚠️ AND THE FIRST VERSION OF THIS FILE ASSERTED THE WRONG THING, which is why
 * it runs on real ink. It expected our own hatched sample to come back as six
 * bars with nothing declared. It does not: that figure has a DIAGONAL hatch, and
 * a diagonal strip clipped to a bar leaves CORNER TRIANGLES, each with its own
 * extent across the bar - 64 distinct where a horizontal hatch gives 6. The
 * reading comes out at 1.375, below the gate, so it is refused.
 *
 * ▶ Every fixture in `categoryAxisFromFragments.test.ts` uses horizontal slabs
 * that share an extent exactly, so all of them were blind to that case by
 * construction. Real pixels found it in one run. The cases below now assert what
 * the figure DOES - refusal, and refusal costing nothing - because a test that
 * encodes a hope is worse than no test: it reads as coverage.
 */
function hatchedFigure() {
  const img = readPng('samples/bar-hatched-extraction-yield.png');
  const truth = JSON.parse(
    readFileSync('samples/bar-hatched-extraction-yield.truth.json', 'utf8')
  ) as {
    calibration: { anchors: Record<string, { px: number; py: number; value?: number }> };
    series: { points: { category: string; value: number }[] }[];
  };
  return { img, truth, a: truth.calibration.anchors };
}

/** The fill of the first bar, found by sampling inside the leftmost band. */
function barFill(img: { data: Uint8ClampedArray; width: number }, px: number, py: number) {
  const o = (py * img.width + px) * 4;
  return [img.data[o]!, img.data[o + 1]!, img.data[o + 2]!] as [number, number, number];
}

describe('a hatched figure with nothing declared', () => {
  it('⛔⛔ refuses our own DIAGONAL sample, and refusing changes nothing', () => {
    // ⚑ The reading is 1.375, below `MIN_EXTENT_RATIO`. It points the right way
    // (x, correct for this upright chart) and simply is not decisive enough to
    // act on - so the detector behaves exactly as it did before this existed,
    // and rejoining this figure still needs the walk's declared axis.
    const { img, a } = hatchedFigure();
    const count = a['c2']!.value!;
    const mid = Math.round(a['c1']!.px + (a['c2']!.px - a['c1']!.px) / (2 * count));
    const target = barFill(img, mid, Math.round(a['p1']!.py - 30));

    const result = runBarDetect(
      img.data, img.width, img.height, target, 60, 'foreground',
      undefined, { minDiameter: 3 }, undefined, undefined
    );
    if ('error' in result) throw new Error(result.error);
    expect(result.joinedAcrossHatch ?? 0).toBe(0);
    // Fragments, not bars - the figure is left exactly as the colour trace saw it.
    expect(result.boxes.length).toBeGreaterThan(count);
  });

  it('⚑⚑ the SAME figure is rejoined into six once the axis is declared', () => {
    // ⚑ The companion assertion, and the reason the case above is a refusal
    // rather than a failure: the join itself is fine on this figure. What is
    // missing is only the confidence to name the axis without being told.
    const { img, a } = hatchedFigure();
    const count = a['c2']!.value!;
    const dividers = Array.from(
      { length: count + 1 },
      (_, i) => a['c1']!.px + ((a['c2']!.px - a['c1']!.px) * i) / count
    );
    const mid = Math.round((dividers[0]! + dividers[1]!) / 2);
    const target = barFill(img, mid, Math.round(a['p1']!.py - 30));

    const result = runBarDetect(
      img.data, img.width, img.height, target, 60, 'foreground',
      undefined, { minDiameter: 3 }, { dividers, categoryAxis: 'x' }, undefined
    );
    if ('error' in result) throw new Error(result.error);
    expect(result.boxes).toHaveLength(count);
  });

  it('⛔ leaves an UNHATCHED figure exactly as it was', () => {
    // ⚑⚑ THE CONTROL, and the assertion that lets this run on every figure
    // rather than behind a declaration. On whole bars the two extent counts are
    // close, so the reading is refused. Measured across 6,494 real published
    // bars: -1 on one corpus split and +1 on the other, net zero.
    const img = readPng('samples/bar-tensile-strength.png');
    const truth = JSON.parse(
      readFileSync('samples/bar-tensile-strength.truth.json', 'utf8')
    ) as { calibration: { anchors: Record<string, { px: number; py: number; value?: number }> } };
    const a = truth.calibration.anchors;
    const count = a['c2']!.value!;
    const mid = Math.round(a['c1']!.px + (a['c2']!.px - a['c1']!.px) / (2 * count));
    const target = barFill(img, mid, Math.round(a['p1']!.py - 20));

    const result = runBarDetect(
      img.data, img.width, img.height, target, 60, 'foreground',
      undefined, { minDiameter: 3 }, undefined, undefined
    );
    if ('error' in result) throw new Error(result.error);
    expect(result.joinedAcrossHatch ?? 0).toBe(0);
  });
});
