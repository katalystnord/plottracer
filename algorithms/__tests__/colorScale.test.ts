import { describe, it, expect } from 'vitest';
import {
  MIN_TICK_SEPARATION_PX,
  checkColorScale,
  readColor,
  positionAtValue,
  valueAtPosition,
  type ColorScale,
} from '../colorScale.js';
import { sampleColorBar, type ColorBarStrip } from '../colorBar.js';
import type { RGB } from '../colorFilter.js';

/**
 * ⚑ MUTATION: measured with a throwaway config scoped to `algorithms/colorScale.ts`
 * — see the note at the top of `colorBar.test.ts` for the recipe.
 */

const KEY_W = 201;
const KEY_H = 21;
const KEY_Y = 10;

/** A black→white key across a 201px image, sampled down its middle. */
function greyStrip(): ColorBarStrip {
  const data = new Uint8ClampedArray(KEY_W * KEY_H * 4);
  for (let y = 0; y < KEY_H; y++)
    for (let x = 0; x < KEY_W; x++) {
      const v = Math.round((x / (KEY_W - 1)) * 255);
      const i = (y * KEY_W + x) * 4;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  const result = sampleColorBar(data, KEY_W, KEY_H, { x: 0, y: KEY_Y }, { x: KEY_W - 1, y: KEY_Y });
  expect(result.reason).toBeNull();
  return result.strip!;
}

const STRIP = greyStrip();

/** The same samples on a strip of a chosen length, placed AWAY from the image
 * origin — so that `from` is not zero and cannot hide a sign error. */
function offsetStrip(lengthPx: number): ColorBarStrip {
  return {
    samples: STRIP.samples,
    from: { x: 37, y: 33 },
    to: { x: 37 + lengthPx, y: 33 },
    thickness: 1,
  };
}

/**
 * The colour this key prints at position `t` — read back OFF THE STRIP rather
 * than recomputed from the ramp formula.
 *
 * ⚑ The first version recomputed it and was wrong by one count per channel,
 * which quietly turned every "exact match" test into an off-ramp one: the
 * reading then refined to a position slightly off the sample, and three
 * assertions about exact values failed for a reason that had nothing to do with
 * the code under test. Ask the instrument what it says; do not re-derive it.
 */
const colourAt = (t: number): RGB => {
  const index = Math.round(t * (STRIP.samples.length - 1));
  return STRIP.samples[index]!.rgb;
};

/** A scale whose two labelled ticks sit at 10% and 90% along the key — where a
 * figure's outermost printed labels usually are, INSIDE the ramp rather than at
 * its ends. */
function scaleOf(valueAt10: number, valueAt90: number, log = false): ColorScale {
  return {
    strip: STRIP,
    ticks: [
      { point: { x: 0.1 * (KEY_W - 1), y: KEY_Y }, value: valueAt10 },
      { point: { x: 0.9 * (KEY_W - 1), y: KEY_Y }, value: valueAt90 },
    ],
    log,
  };
}

describe('checkColorScale', () => {
  it('accepts an ordinary two-tick scale', () => {
    expect(checkColorScale(scaleOf(0, 100))).toBeNull();
  });

  it('accepts a key that runs high to low', () => {
    // Plenty of figures draw the large value on the left. Nothing about that is
    // an error, and refusing it would refuse a real figure.
    expect(checkColorScale(scaleOf(100, 0))).toBeNull();
  });

  it('refuses two ticks carrying the same number', () => {
    expect(checkColorScale(scaleOf(50, 50))).toBe('ticks-equal-value');
  });

  it('refuses a tick whose value is not a number', () => {
    expect(checkColorScale(scaleOf(NaN, 100))).toBe('tick-not-a-number');
    expect(checkColorScale(scaleOf(0, Infinity))).toBe('tick-not-a-number');
  });

  it('refuses two ticks at the same position on the key', () => {
    const scale = scaleOf(0, 100);
    const coincident: ColorScale = {
      ...scale,
      ticks: [
        { point: { x: 100, y: KEY_Y }, value: 0 },
        { point: { x: 100, y: KEY_Y - 5 }, value: 100 },
      ],
    };
    // ⚑ The second click is five pixels AWAY on screen and still the same tick:
    // only the component along the key carries any information, so a scale from
    // these two would divide by nothing.
    expect(checkColorScale(coincident)).toBe('ticks-coincide');
  });

  it('accepts ticks exactly the minimum separation apart', () => {
    // ⚑ A 256px strip, so one pixel of separation is exactly 1/256 of it and the
    // boundary is a clean binary fraction. On the 200px strip this first used,
    // the arithmetic landed a hair above 1.0 and "exactly the minimum" was never
    // actually tested — the assertion passed for both sides of the comparison.
    const apart = (px: number): ColorScale => ({
      strip: offsetStrip(256),
      ticks: [
        { point: { x: 137, y: 33 }, value: 0 },
        { point: { x: 137 + px, y: 33 }, value: 100 },
      ],
      log: false,
    });
    expect(checkColorScale(apart(MIN_TICK_SEPARATION_PX))).toBeNull();
    expect(checkColorScale(apart(MIN_TICK_SEPARATION_PX * 0.5))).toBe('ticks-coincide');
  });

  it('measures the strip’s length correctly enough to judge the threshold', () => {
    // ⚑ A 3-4-5 strip placed away from the origin: 120 across, 160 down, 200
    // long. The two ticks sit 0.9px apart ALONG it — just inside the refusal.
    // Any error in the length moves that verdict: an over-long strip makes 0.9px
    // look like more than a pixel and lets it through, and a length that comes
    // out as NaN compares false against everything and lets it through too. This
    // is the one place the length is load-bearing, so it is measured here rather
    // than through a helper the module does not expose.
    const unit = { x: 0.6, y: 0.8 };
    const separation = 0.9;
    const tight: ColorScale = {
      strip: { samples: STRIP.samples, from: { x: 30, y: 40 }, to: { x: 150, y: 200 }, thickness: 1 },
      ticks: [
        { point: { x: 30, y: 40 }, value: 0 },
        { point: { x: 30 + unit.x * separation, y: 40 + unit.y * separation }, value: 100 },
      ],
      log: false,
    };
    expect(checkColorScale(tight)).toBe('ticks-coincide');
  });

  it('measures the strip’s length from BOTH ends, wherever it sits', () => {
    // ⚑ A strip that starts at the image origin hides half the arithmetic: with
    // `from` at (0, 0), adding and subtracting it give the same answer, so a sign
    // error in the length is invisible. Real keys are never at the origin, and a
    // rotated scan makes them diagonal.
    const diagonal: ColorScale = {
      strip: { samples: STRIP.samples, from: { x: 40, y: 30 }, to: { x: 200, y: 150 }, thickness: 1 },
      ticks: [
        // 200px along a 200px strip: comfortably separated, unless the length is
        // computed wrongly.
        { point: { x: 40, y: 30 }, value: 0 },
        { point: { x: 200, y: 150 }, value: 100 },
      ],
      log: false,
    };
    expect(checkColorScale(diagonal)).toBeNull();
    expect(valueAtPosition(diagonal, 0.5)).toBeCloseTo(50, 10);
  });

  it('refuses a tick that cannot be projected onto the strip at all', () => {
    // Both of the model's degenerate entrances: a strip whose two ends are the
    // same point (never produced by sampling, but a project file can hold one),
    // and a tick click that is not a finite position.
    const degenerate: ColorScale = {
      strip: { samples: STRIP.samples, from: { x: 10, y: 10 }, to: { x: 10, y: 10 }, thickness: 1 },
      ticks: [
        { point: { x: 10, y: 10 }, value: 0 },
        { point: { x: 90, y: 10 }, value: 100 },
      ],
      log: false,
    };
    expect(checkColorScale(degenerate)).toBe('ticks-coincide');

    const notFinite: ColorScale = {
      ...scaleOf(0, 100),
      ticks: [
        { point: { x: NaN, y: KEY_Y }, value: 0 },
        { point: { x: 0.9 * (KEY_W - 1), y: KEY_Y }, value: 100 },
      ],
    };
    expect(checkColorScale(notFinite)).toBe('ticks-coincide');

    // ⚑ And the SECOND tick, not just the first: a guard that only checks one of
    // a pair is the shape this project has been bitten by repeatedly.
    const secondNotFinite: ColorScale = {
      ...scaleOf(0, 100),
      ticks: [
        { point: { x: 0.1 * (KEY_W - 1), y: KEY_Y }, value: 0 },
        { point: { x: 0.9 * (KEY_W - 1), y: Infinity }, value: 100 },
      ],
    };
    expect(checkColorScale(secondNotFinite)).toBe('ticks-coincide');
  });

  it('refuses a log key whose labelled values are not both positive', () => {
    // ⚑ The rule the value axes already carry: `Math.log(0)` is −Infinity, and
    // a scale built on it reports itself calibrated while every cell reads back
    // as nothing. Shared with `core/axes/logScale.ts` rather than rewritten.
    expect(checkColorScale(scaleOf(0, 100, true))).toBe('log-needs-positive');
    expect(checkColorScale(scaleOf(-10, 100, true))).toBe('log-needs-positive');
    expect(checkColorScale(scaleOf(-100, -1, true))).toBe('log-needs-positive');
    expect(checkColorScale(scaleOf(1, 100, true))).toBeNull();
  });
});

describe('valueAtPosition', () => {
  it('interpolates between the two labelled ticks', () => {
    const scale = scaleOf(0, 100);
    expect(valueAtPosition(scale, 0.1)).toBeCloseTo(0, 10);
    expect(valueAtPosition(scale, 0.9)).toBeCloseTo(100, 10);
    expect(valueAtPosition(scale, 0.5)).toBeCloseTo(50, 10);
  });

  it('EXTRAPOLATES past the labelled ticks instead of clamping', () => {
    // ⚑ The printed labels are almost never at the very ends of the ramp, so the
    // hottest and coldest cells in the figure lie OUTSIDE them. Clamping would
    // flatten every one of them onto the last labelled value — and the extremes
    // are usually the reason the figure exists.
    const scale = scaleOf(0, 100);
    expect(valueAtPosition(scale, 0)).toBeCloseTo(-12.5, 6);
    expect(valueAtPosition(scale, 1)).toBeCloseTo(112.5, 6);
  });

  it('runs backwards when the key does', () => {
    const scale = scaleOf(100, 0);
    expect(valueAtPosition(scale, 0.1)).toBeCloseTo(100, 10);
    expect(valueAtPosition(scale, 0.5)).toBeCloseTo(50, 10);
    expect(valueAtPosition(scale, 0.9)).toBeCloseTo(0, 10);
  });

  it('is geometric on a log key', () => {
    // ⚑ 10..1000, NOT 1..1000: `Math.log(1)` is zero, so a key that starts at 1
    // gives the same answer whether the interpolation adds or subtracts its
    // first endpoint. The fixture that starts at 1 tests half the formula.
    const scale = scaleOf(10, 1000, true);
    expect(valueAtPosition(scale, 0.1)).toBeCloseTo(10, 8);
    expect(valueAtPosition(scale, 0.9)).toBeCloseTo(1000, 8);
    // Halfway along a decade key is the geometric mean, not the arithmetic one.
    expect(valueAtPosition(scale, 0.5)).toBeCloseTo(Math.sqrt(10 * 1000), 8);
    expect(valueAtPosition(scale, 0.5)).not.toBeCloseTo((10 + 1000) / 2, 0);
  });

  it('is null for a refused scale or a position that is not a number', () => {
    expect(valueAtPosition(scaleOf(50, 50), 0.5)).toBeNull();
    expect(valueAtPosition(scaleOf(0, 100), NaN)).toBeNull();
    expect(valueAtPosition(scaleOf(0, 100), Infinity)).toBeNull();
  });
});

describe('readColor', () => {
  it('turns a colour into a value with the interval it cannot be told apart from', () => {
    const scale = scaleOf(0, 100);
    const reading = readColor(scale, colourAt(0.5))!;
    expect(reading.distance).toBe(0);
    expect(reading.value).toBeCloseTo(50, 1);
    expect(reading.low).toBeLessThan(reading.value);
    expect(reading.high).toBeGreaterThan(reading.value);
    expect(reading.rivals).toHaveLength(0);
  });

  it('orders the interval by VALUE even when the key runs backwards', () => {
    // ⚑ A caller comparing `low` and `high` must never have to know which way
    // the figure drew its key. On a descending key the band's low POSITION is
    // its high VALUE, and getting that the wrong way round produces an interval
    // that contains nothing.
    const forwards = readColor(scaleOf(0, 100), colourAt(0.5))!;
    const backwards = readColor(scaleOf(100, 0), colourAt(0.5))!;
    expect(backwards.low).toBeLessThan(backwards.high);
    // Same positions, swapped labels: the key is mirrored, so the value is too.
    expect(backwards.value).toBeCloseTo(100 - forwards.value, 6);
    expect(backwards.high - backwards.low).toBeCloseTo(forwards.high - forwards.low, 6);
  });

  it('carries the band through a LOG key, where it comes out asymmetric', () => {
    // ⚑ THE PAYOFF OF REPORTING AN INTERVAL RATHER THAN A ± . An interval maps
    // through any monotone scale by mapping its two ends; a symmetric error bar
    // would have had to be propagated through the logarithm, and would have been
    // wrong on both sides.
    const reading = readColor(scaleOf(10, 1000, true), colourAt(0.5))!;
    expect(reading.value).toBeCloseTo(Math.sqrt(10 * 1000), 6);
    expect(reading.low).toBeLessThan(reading.value);
    expect(reading.high).toBeGreaterThan(reading.value);
    const below = reading.value - reading.low;
    const above = reading.high - reading.value;
    expect(above).toBeGreaterThan(below * 1.05);
    // …and near-symmetric in RATIO, which is what a log scale means. Only
    // NEAR: the band's two edges are interpolated between 8-bit samples, so
    // quantisation leaves a few percent that no mapping can remove. The
    // additive halves differ by far more than that, which is the distinction
    // being drawn here.
    expect(reading.high / reading.value).toBeCloseTo(reading.value / reading.low, 1);
  });

  it('reports rival VALUES, not just rival positions', () => {
    // A key that returns to the same grey: the ambiguity has to reach the caller
    // in the figure's own units, or the caller cannot show it.
    const width = 401;
    const data = new Uint8ClampedArray(width * KEY_H * 4);
    for (let y = 0; y < KEY_H; y++)
      for (let x = 0; x < width; x++) {
        const u = x / (width - 1);
        const v = Math.round((1 - Math.abs(u * 2 - 1)) * 255);
        const i = (y * width + x) * 4;
        data[i] = v;
        data[i + 1] = v;
        data[i + 2] = v;
        data[i + 3] = 255;
      }
    const strip = sampleColorBar(data, width, KEY_H, { x: 0, y: KEY_Y }, { x: width - 1, y: KEY_Y })
      .strip!;
    const scale: ColorScale = {
      strip,
      ticks: [
        { point: { x: 0, y: KEY_Y }, value: 0 },
        { point: { x: width - 1, y: KEY_Y }, value: 100 },
      ],
      log: false,
    };
    const midGrey = 128;
    const reading = readColor(scale, [midGrey, midGrey, midGrey])!;
    expect(reading.rivals).toHaveLength(1);
    // 25 and 75 on this key are the same colour. Both are real answers.
    expect(reading.value).toBeCloseTo(25, 0);
    expect(reading.rivals[0]!.value).toBeCloseTo(75, 0);
    expect(reading.rivals[0]!.low).toBeLessThan(reading.rivals[0]!.high);
  });

  it('passes the off-ramp distance through untouched', () => {
    // The value scale must not launder the evidence: a cell tinted away from the
    // key is still reported as tinted, in RGB units, because that is the number
    // that says whether to trust the value at all.
    const scale = scaleOf(0, 100);
    const [r, g, b] = colourAt(0.5);
    const reading = readColor(scale, [r, Math.min(255, g + 20), b])!;
    expect(reading.distance).toBeGreaterThan(0);
    expect(reading.high - reading.low).toBeGreaterThan(
      readColor(scale, colourAt(0.5))!.high - readColor(scale, colourAt(0.5))!.low
    );
  });

  it('is null for a refused scale, and for a strip with nothing to invert against', () => {
    expect(readColor(scaleOf(50, 50), colourAt(0.5))).toBeNull();
    const empty: ColorScale = {
      strip: { samples: [], from: { x: 0, y: 0 }, to: { x: 100, y: 0 }, thickness: 1 },
      ticks: [
        { point: { x: 0, y: 0 }, value: 0 },
        { point: { x: 100, y: 0 }, value: 100 },
      ],
      log: false,
    };
    expect(readColor(empty, [0, 0, 0])).toBeNull();
  });
});

describe('positionAtValue — the third axis inverts like the other two', () => {
  /**
   * ⚑⚑ David: *"Heatmaps are a 2.5D graph type. The values are STORED ON THE
   * THIRD AXIS. Changing a value in a cell MOVES THE VALUE on the third axis
   * that records the value, and nothing else!"* Editing a cell is the same
   * gesture as editing a data point's y — the point moves through the axes'
   * inverse transform, just along the colour key rather than inside the plot.
   */
  it('round-trips against valueAtPosition on a linear key', () => {
    const scale = scaleOf(0, 100);
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const v = valueAtPosition(scale, t)!;
      expect(positionAtValue(scale, v)).toBeCloseTo(t, 9);
    }
  });

  it('round-trips on a LOG key, where the spacing is not uniform', () => {
    const scale = scaleOf(1, 100, true);
    for (const t of [0.1, 0.5, 0.9]) {
      const v = valueAtPosition(scale, t)!;
      expect(positionAtValue(scale, v)).toBeCloseTo(t, 9);
    }
  });

  it('REFUSES a value a log key cannot hold, rather than answering', () => {
    // ⚑ Zero and negatives have no position on a log scale. Returning a number
    // would put the cell somewhere the figure could never have drawn it.
    const scale = scaleOf(1, 100, true);
    expect(positionAtValue(scale, 0)).toBeNull();
    expect(positionAtValue(scale, -5)).toBeNull();
    expect(positionAtValue(scale, NaN)).toBeNull();
  });
});
