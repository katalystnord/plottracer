import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { runBarDetect } from '../barDetectRun.js';
import { readPng } from './helpers/readPng.js';

/**
 * ⚑⚑ A BAR DRAWN ACROSS THE BASELINE IS ONE BAR, AND THE RECORD SAID TWO.
 *
 * David, driving the built app on `samples/bar-floating-temperature.png`:
 * *"The autotracing when we have bars crossing zero splits the bars into
 * multiple bars."* Measured off that figure's own pixels: the bar ink is
 * `31,78,121` and the zero rule is drawn OVER it in `90,97,105`, two pixels
 * thick, at py 461-462. The colour filter drops those two rows, so the
 * connected component is severed and each half comes back as its own bar.
 *
 * The panel showed it plainly - 12 months became 17 rows, with Jan reading
 * `0.11 .. 2` and `-8 .. -0.04` on two lines. Every number is plausible and
 * the figure has five bars that do not exist.
 *
 * ⚑ THE GATE IS THE USER'S OWN DECLARATION, which is this project's standing
 * rule for any bar technique: it may only refuse or corroborate, and it must be
 * gated by something computed from what the user said, so the population it
 * cannot help is provably untouched. Here that is the DECLARED BASELINE - the
 * two pieces must both reach it, from opposite sides, within the tolerance the
 * caller already states for "does this shape sit on the baseline". No new
 * threshold is invented.
 */

const W = 200;
const H = 140;

function image(rects: { x0: number; y0: number; x1: number; y1: number }[]) {
  const data = new Uint8ClampedArray(W * H * 4).fill(255);
  for (const r of rects) {
    for (let y = r.y0; y <= r.y1; y += 1) {
      for (let x = r.x0; x <= r.x1; x += 1) {
        const i = (y * W + x) * 4;
        data[i] = 0;
        data[i + 1] = 0;
        data[i + 2] = 0;
      }
    }
  }
  return data;
}

const BLACK: [number, number, number] = [0, 0, 0];
/** The baseline runs at py 70, and the rule the figure draws over it is 2px. */
const BASELINE = { atPixel: 70, tolerancePx: 2 };

/** ⚑ `baseline` is passed POSITIONALLY rather than defaulted, because a default
 * parameter fires on an explicit `undefined` too - the first version of the
 * "no baseline was declared" case below silently ran WITH one and passed the
 * wrong assertion. [[feedback_fixture_blind_by_construction]] in miniature. */
const detect = (data: Uint8ClampedArray, baseline: typeof BASELINE | undefined) =>
  runBarDetect(data, W, H, BLACK, 30, 'foreground', undefined, { minDiameter: 3 }, undefined, baseline);

describe('a bar severed by the rule drawn along the baseline', () => {
  it('⚑⚑ comes back as ONE bar spanning both sides, not two', () => {
    // One bar from py 40 to py 100, with the rule at 69-70 removed from the mask.
    const result = detect(image([
      { x0: 20, y0: 40, x1: 60, y1: 68 },
      { x0: 20, y0: 71, x1: 60, y1: 100 },
    ]), BASELINE);
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.boxes).toHaveLength(1);
    expect(result.boxes[0]!.start.y).toBe(40);
    expect(result.boxes[0]!.end.y).toBe(101);
    expect(result.joinedAcrossBaseline).toBe(1);
  });

  it('says nothing and joins nothing when no baseline was declared', () => {
    const result = detect(
      image([
        { x0: 20, y0: 40, x1: 60, y1: 68 },
        { x0: 20, y0: 71, x1: 60, y1: 100 },
      ]),
      undefined
    );
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.boxes).toHaveLength(2);
    expect(result.joinedAcrossBaseline).toBeUndefined();
  });

  it('⚑ leaves two bars alone when only one of them reaches the baseline', () => {
    // The upper shape floats well clear of the rule - a legend swatch, or a
    // stacked segment. Nothing says these are one bar.
    const result = detect(image([
      { x0: 20, y0: 20, x1: 60, y1: 40 },
      { x0: 20, y0: 71, x1: 60, y1: 100 },
    ]), BASELINE);
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.boxes).toHaveLength(2);
    expect(result.joinedAcrossBaseline).toBe(0);
  });

  it('⚑ leaves two bars alone when they do not share a category extent', () => {
    // Two different months, one above the line and one below it.
    const result = detect(image([
      { x0: 20, y0: 40, x1: 60, y1: 68 },
      { x0: 100, y0: 71, x1: 140, y1: 100 },
    ]), BASELINE);
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.boxes).toHaveLength(2);
    expect(result.joinedAcrossBaseline).toBe(0);
  });
});

/**
 * ⚑⚑ THE SHIPPED FIGURE, not a stand-in. A test that draws its own bars can
 * only prove the code self-consistent, and the severing rule here is a real
 * anti-aliased two-pixel line the generator drew, not one this file removed.
 */
describe('samples/bar-floating-temperature.png, traced end to end', () => {
  const truth = JSON.parse(
    readFileSync(fileURLToPath(new URL('../../samples/bar-floating-temperature.truth.json', import.meta.url)), 'utf8')
  ) as { calibration: { anchors: { p1: { py: number; value: number }; p2: { py: number; value: number } } }; series: { points: { category: string; start: number; end: number }[] }[] };
  const img = readPng(fileURLToPath(new URL('../../samples/bar-floating-temperature.png', import.meta.url)));
  const { p1, p2 } = truth.calibration.anchors;
  /** The figure's own value transform, from its own calibration anchors. */
  const valueAt = (py: number) => p1.value + ((py - p1.py) * (p2.value - p1.value)) / (p2.py - p1.py);
  const BAR_INK: [number, number, number] = [31, 78, 121];
  const baseline = { atPixel: p1.py + ((0 - p1.value) * (p2.py - p1.py)) / (p2.value - p1.value), tolerancePx: 2 };

  it('⚑⚑ finds TWELVE bars - one per month - and five of them cross zero', () => {
    const result = runBarDetect(img.data, img.width, img.height, BAR_INK, 30, 'foreground', undefined, { minDiameter: 3 }, undefined, baseline);
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.boxes).toHaveLength(12);
    expect(result.joinedAcrossBaseline).toBe(5);
  });

  it('⚑ and every bar reads its two ends to within a tenth of a degree', () => {
    const result = runBarDetect(img.data, img.width, img.height, BAR_INK, 30, 'foreground', undefined, { minDiameter: 3 }, undefined, baseline);
    if ('error' in result) throw new Error(result.error);
    const found = result.boxes
      .map((b) => ({
        x: (b.start.x + b.end.x) / 2,
        lo: Math.min(valueAt(b.start.y), valueAt(b.end.y)),
        hi: Math.max(valueAt(b.start.y), valueAt(b.end.y)),
      }))
      .sort((a, b) => a.x - b.x);
    const points = truth.series[0]!.points;
    expect(found).toHaveLength(points.length);
    points.forEach((p, i) => {
      expect(found[i]!.lo).toBeCloseTo(Math.min(p.start, p.end), 1);
      expect(found[i]!.hi).toBeCloseTo(Math.max(p.start, p.end), 1);
    });
  });
});

/**
 * ⚑⚑ THE CONFIGURATION THE APP ACTUALLY RUNS IN, which the tests above do not.
 *
 * Every case above takes the no-categories branch of `runBarDetect` - the one
 * that was the ordinary path while marking the axis was an offer. Since v2.3 the
 * category axis is part of the calibration walk, so a real trace ALWAYS arrives
 * with declared dividers and takes the OTHER branch, where each blob is measured
 * against the bands and a merged run is cut at them.
 *
 * ⚠️ A FIXTURE IS BLIND TO WHAT IT LACKS: the join was proven on the branch the
 * app has stopped using. That is exactly the shape
 * [[feedback_fixture_blind_by_construction]] names, so the real figure is traced
 * here through the path a user's click now takes.
 */
describe('the same figure, traced the way the app now always traces it', () => {
  const truth = JSON.parse(
    readFileSync(fileURLToPath(new URL('../../samples/bar-floating-temperature.truth.json', import.meta.url)), 'utf8')
  ) as {
    calibration: { anchors: { p1: { px: number; py: number; value: number }; p2: { px: number; py: number; value: number }; c1: { px: number; py: number }; c2: { px: number; py: number; value: number } } };
    series: { points: { start: number; end: number }[] }[];
  };
  const img = readPng(fileURLToPath(new URL('../../samples/bar-floating-temperature.png', import.meta.url)));
  const { p1, p2, c1, c2 } = truth.calibration.anchors;
  const valueAt = (py: number) => p1.value + ((py - p1.py) * (p2.value - p1.value)) / (p2.py - p1.py);
  const baseline = { atPixel: p1.py + ((0 - p1.value) * (p2.py - p1.py)) / (p2.value - p1.value), tolerancePx: 2 };
  /** The twelve bands the walk declares, as the session hands them to detection:
   * N+1 dividers evenly spaced between the two clicked ends. */
  const dividers = Array.from({ length: c2.value + 1 }, (_, i) => c1.px + ((c2.px - c1.px) * i) / c2.value);

  it('⚑⚑ finds twelve bars with the categories DECLARED, not just without them', () => {
    const result = runBarDetect(
      img.data, img.width, img.height, [31, 78, 121], 30, 'foreground', undefined,
      { minDiameter: 3 }, { dividers, categoryAxis: 'x', expected: 12 }, baseline
    );
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.boxes).toHaveLength(12);
    expect(result.joinedAcrossBaseline).toBe(5);
    // ⚑ Every declared band got exactly one bar - the report detection makes
    // about the structure it was given, which is what a user reads.
    expect(result.expectation?.emptyBands).toEqual([]);
    expect(result.expectation?.complete).toBe(true);
  });

  it('⚑ and each band\u2019s bar still reads its two ends off the ink', () => {
    const result = runBarDetect(
      img.data, img.width, img.height, [31, 78, 121], 30, 'foreground', undefined,
      { minDiameter: 3 }, { dividers, categoryAxis: 'x', expected: 12 }, baseline
    );
    if ('error' in result) throw new Error(result.error);
    const found = result.boxes
      .map((b) => ({
        x: (b.start.x + b.end.x) / 2,
        lo: Math.min(valueAt(b.start.y), valueAt(b.end.y)),
        hi: Math.max(valueAt(b.start.y), valueAt(b.end.y)),
      }))
      .sort((a, b) => a.x - b.x);
    truth.series[0]!.points.forEach((p, i) => {
      expect(found[i]!.lo).toBeCloseTo(Math.min(p.start, p.end), 1);
      expect(found[i]!.hi).toBeCloseTo(Math.max(p.start, p.end), 1);
    });
  });
});
