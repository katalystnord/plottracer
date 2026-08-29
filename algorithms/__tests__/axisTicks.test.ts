/**
 * Tick-mark detection, graded against the BUNDLED FIGURES and their committed
 * ground truth - not against a chart the test drew for itself.
 *
 * ⚑ [ground truth is the instrument]: a test that invents its own figure proves
 * self-consistency, and the spider over-read is this project's standing example
 * of a synthetic fixture agreeing with the code and disagreeing with reality.
 * Every case here reads a real `samples/*.png` and, where it checks positions,
 * compares them with the axis the truth file itself records.
 */
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { detectAxisTicks } from '../axisTicks.js';
import { readPng } from '../../engine/__tests__/helpers/readPng.js';
import { readFileSync } from 'node:fs';

const SAMPLES = path.resolve(import.meta.dirname, '../../samples');

interface Anchor {
  px: number;
  py: number;
  value?: number;
}

function sample(name: string): {
  image: ReturnType<typeof readPng>;
  anchors: Record<string, Anchor>;
} {
  const image = readPng(path.join(SAMPLES, `${name}.png`));
  const truth = JSON.parse(readFileSync(path.join(SAMPLES, `${name}.truth.json`), 'utf8')) as {
    calibration?: { anchors?: Record<string, Anchor> };
  };
  return { image, anchors: truth.calibration?.anchors ?? {} };
}

/** DOWN, for the x axis of an upright chart: away from the plot. */
const DOWN = { x: 0, y: 1 };
const UP = { x: 0, y: -1 };

describe('the ticks a figure actually draws on an axis it was handed', () => {
  it('⚑⚑ finds all eight, within a pixel of where the axis says they are', () => {
    // heatmap-weld-temperature prints a label every 2 units over 0..14, so the
    // figure draws eight ticks - and the truth file's own x1/x2 anchors say
    // exactly where each of those values falls.
    const { image, anchors } = sample('heatmap-weld-temperature');
    const x1 = anchors['x1']!;
    const x2 = anchors['x2']!;
    const found = detectAxisTicks(image, { x: x1.px, y: x1.py }, { x: x2.px, y: x2.py }, DOWN);

    expect(found.candidates).toHaveLength(8);
    const expected = [0, 2, 4, 6, 8, 10, 12, 14].map(
      (v) => x1.px + ((x2.px - x1.px) * (v - x1.value!)) / (x2.value! - x1.value!)
    );
    const worst = Math.max(
      ...found.candidates.map((c, i) => Math.abs(c.pixel.x - expected[i]!))
    );
    // Sub-pixel: the figure's own ticks are 2px wide, so a centre lands within
    // half a pixel of the value the calibration puts there.
    expect(worst, 'a tick is ink, so its position is a measurement').toBeLessThan(1);
  });

  it('reports even spacing, which is what lets a caller offer them', () => {
    const { image, anchors } = sample('xy-stress-strain');
    const found = detectAxisTicks(
      image,
      { x: anchors['x1']!.px, y: anchors['x1']!.py },
      { x: anchors['x2']!.px, y: anchors['x2']!.py },
      DOWN
    );
    expect(found.candidates.length).toBeGreaterThanOrEqual(6);
    expect(found.evenness, 'a printed axis is regular to well under a percent').toBeLessThan(0.01);
    expect(found.pitch).toBeGreaterThan(0);
  });

  /**
   * ⚠️⚑⚑ WHY INWARD IS NOT A FALLBACK - and this replaces a claim that was
   * WRONG, which is worth leaving written down. A first cut asserted that the
   * inward band reads a histogram's BARS as ticks, 12 against 6; that was true
   * of a throwaway prototype whose rule was "ink through 60% of a fixed window",
   * and it is not true of this module, whose rule is an unbroken run attached to
   * the spine. Re-measured after the rule changed: inward returns 1 or 2
   * candidates on every one of the nine bundled figures, outward returns 5 to 9.
   *
   * ▶ So the honest statement is the weaker and checkable one: inward is a
   * source of FALSE POSITIVES rather than a second opinion. On a histogram it
   * would also be reading the very bars the calibration must be independent of.
   * ⚑ Changing the instrument invalidates its readings; the numbers in a comment
   * have to be taken again, not carried over.
   */
  it('finds far more outward than inward, so inward is never worth searching', () => {
    const { image, anchors } = sample('histogram-pore-size');
    const from = { x: anchors['x1']!.px, y: anchors['x1']!.py };
    const to = { x: anchors['x2']!.px, y: anchors['x2']!.py };
    const outward = detectAxisTicks(image, from, to, DOWN);
    const inward = detectAxisTicks(image, from, to, UP);
    expect(outward.evenness, 'the real ticks are regular').toBeLessThan(0.01);
    expect(outward.candidates.length).toBeGreaterThan(inward.candidates.length);
    expect(inward.evenness, 'and what inward finds is too little to even be regular').toBeNull();
  });

  it('reads a LOG-scaled figure’s ticks too - the scale is the caller’s business', () => {
    // ⛔ AND ITS EVENNESS MUST NOT BE READ AS A VERDICT. Decade ticks are evenly
    // spaced in pixels while minor ticks between them are deliberately not, so
    // on a log axis "uneven" means the axis is doing its job. A caller that
    // refuses on evenness alone would refuse exactly the figures where reading
    // the labels matters most.
    const { image, anchors } = sample('heatmap-assay-log');
    const found = detectAxisTicks(
      image,
      { x: anchors['x1']!.px, y: anchors['x1']!.py },
      { x: anchors['x2']!.px, y: anchors['x2']!.py },
      DOWN
    );
    expect(found.candidates.length).toBeGreaterThanOrEqual(3);
  });

  it('⚑ still RETURNS what it found when the spacing is ragged, rather than nothing', () => {
    // heatmap-timecourse's outward band picks up something irregular. The
    // evenness says so - and the candidates come back anyway, because a user who
    // can see what was found can tell whether a miss was a miss or was never
    // there. Detection that answers "nothing" rather than proposing what it did
    // find is a defect this project has already paid for on the heatmap grid.
    const { image, anchors } = sample('heatmap-timecourse');
    const found = detectAxisTicks(
      image,
      { x: anchors['x1']!.px, y: anchors['x1']!.py },
      { x: anchors['x2']!.px, y: anchors['x2']!.py },
      DOWN
    );
    expect(found.candidates.length).toBeGreaterThan(0);
    expect(found.evenness, 'ragged, and it says so instead of hiding it').toBeGreaterThan(0.1);
  });

  it('cannot call two ticks even, because two ticks always are', () => {
    const { image, anchors } = sample('xy-stress-strain');
    const x1 = anchors['x1']!;
    const x2 = anchors['x2']!;
    // A short stretch of the same axis, holding at most a couple of ticks.
    const found = detectAxisTicks(
      image,
      { x: x1.px, y: x1.py },
      { x: x1.px + (x2.px - x1.px) * 0.15, y: x1.py },
      DOWN
    );
    expect(found.candidates.length).toBeLessThan(3);
    expect(found.evenness).toBeNull();
    expect(found.pitch).toBeNull();
  });

  it('refuses a degenerate axis instead of dividing by its length', () => {
    const { image } = sample('xy-stress-strain');
    const found = detectAxisTicks(image, { x: 100, y: 100 }, { x: 100, y: 100 }, DOWN);
    expect(found.candidates).toHaveLength(0);
    expect(found.evenness).toBeNull();
  });
});
