import { describe, expect, it } from 'vitest';
import { keySpanFromClicks } from '../heatmapRun.js';
import { valueAtParam } from '../../algorithms/colorScale.js';

/**
 * ⚑⚑ WHAT THE COLOUR KEY READS AT ITS TWO ENDS — the third axis's extent, on
 * screen the moment the key is calibrated.
 *
 * THE CASE, from the built 2.2.0 package on 2026-08-17. David calibrated a key
 * printed `10¹` / `10²` — *"IC50 (nM, log scale)"* — and typed 10 and 100 at
 * those two ticks, which is the correct transcription. He did not tick **Log**,
 * because nothing asked and an unticked box never says *this key is linear*.
 * The key was read linearly, exactly as instructed, and thirty cells came out
 * on a span of −38 … 169: several of them negative, for a concentration.
 *
 * ⚑ NOTHING WAS WRONG. A linear key that goes negative is a perfectly legal
 * diverging key — temperature, anomaly, log-fold change — which is why nothing
 * refused it and why nothing here refuses it either. David: *"There can easily
 * be instances where crossing zero is perfectly reasonable. Just think of
 * temperature on a heatmap."* The bundled example's own key is *Peak
 * temperature (°C)*.
 *
 * ▶ So the fix is not a refusal, it is REPORTING what we already measured: the
 * two spans below are unmistakable side by side, and both are available before
 * a single cell is read.
 */

/** David's figure, to the pixel: a horizontal key bar with its two labelled
 * ticks well inside it, so the ramp runs on past both. */
const K1 = { px: 205, py: 1000 };
const K2 = { px: 1310, py: 1050 };
const KV1 = { px: 460, py: 1025, values: ['10'] };
const KV2 = { px: 940, py: 1025, values: ['100'] };

describe('⚑⚑ the colour key reports the extent it was calibrated to', () => {
  it('LOG: the key reads 3 … 589 — positive at both ends, as a concentration must be', () => {
    const span = keySpanFromClicks(K1, K2, KV1, KV2, true)!;
    expect(span).not.toBeNull();
    expect(span.from).toBeCloseTo(2.94, 1);
    expect(span.to).toBeCloseTo(589.7, 0);
    // The property that matters, stated as one: a log key cannot reach zero.
    expect(span.from).toBeGreaterThan(0);
  });

  it('LINEAR: the SAME clicks read −38 … 169 — the morning that prompted this', () => {
    // ⚑ Not a defect and not refused. This is what the user asked for, and the
    // point is only that it is now VISIBLE before the cells are read.
    const span = keySpanFromClicks(K1, K2, KV1, KV2, false)!;
    expect(span.from).toBeCloseTo(-37.8, 1);
    expect(span.to).toBeCloseTo(169.4, 1);
  });

  it('⚑ the two readings of one key differ by more than a rounding — they differ in SIGN', () => {
    // The whole argument for showing the number: a user cannot mistake one of
    // these lines for the other, whereas thirty cells of plausible numbers are
    // indistinguishable by eye.
    const asLog = keySpanFromClicks(K1, K2, KV1, KV2, true)!;
    const asLinear = keySpanFromClicks(K1, K2, KV1, KV2, false)!;
    expect(Math.sign(asLinear.from)).toBe(-1);
    expect(Math.sign(asLog.from)).toBe(1);
  });

  it('needs NO image — the extent is known the instant the fourth click lands', () => {
    // ⚑ Structural, and the reason this lives in engine/ rather than ui/: the
    // span was previously computed in `readCellsFor`, i.e. only once the cells
    // had been read, which is after the damage. Sampling the ramp is what a
    // READING needs; the ends need geometry and two numbers.
    expect(keySpanFromClicks.length).toBe(5); // k1, k2, kv1, kv2, log — no image
  });

  it('carries the strip CENTRELINE, so the readout and the cursor cannot disagree', () => {
    const span = keySpanFromClicks(K1, K2, KV1, KV2, false)!;
    // Runs along the bar's length, not corner-to-corner (which is its diagonal).
    expect(span.strip.to.x - span.strip.from.x).toBeCloseTo(K2.px - K1.px, 0);
    expect(span.strip.thickness).toBeGreaterThan(0);
  });
});

describe('the extent refuses rather than inventing one', () => {
  it('two ticks at the SAME place along the strip have no scale between them', () => {
    expect(keySpanFromClicks(K1, K2, KV1, { ...KV2, px: KV1.px, py: KV1.py }, false)).toBeNull();
  });

  it('a tick value that is not a number', () => {
    expect(keySpanFromClicks(K1, K2, { ...KV1, values: ['high'] }, KV2, false)).toBeNull();
  });

  it('a LOG key whose labels are not both positive — no log scale passes through zero', () => {
    expect(keySpanFromClicks(K1, K2, { ...KV1, values: ['0'] }, KV2, true)).toBeNull();
    expect(keySpanFromClicks(K1, K2, { ...KV1, values: ['-10'] }, KV2, true)).toBeNull();
    // …and the same key read LINEARLY is fine, because zero is an ordinary value.
    expect(keySpanFromClicks(K1, K2, { ...KV1, values: ['0'] }, KV2, false)).not.toBeNull();
  });

  it('corners that describe no strip at all', () => {
    expect(keySpanFromClicks(K1, K1, KV1, KV2, false)).toBeNull();
  });
});

describe('valueAtParam — the one expression of a key\'s scale', () => {
  it('⚑ is what BOTH the readings and the extent come out of', () => {
    // The extraction is the point: `valueAtPosition` delegates here, and so does
    // `keySpanFromClicks`. Finding A2 of this release was one idea in three
    // copies with silently different policies out of range.
    expect(valueAtParam(0.5, 0, 1, 0, 100, false)).toBeCloseTo(50, 9);
    expect(valueAtParam(0.5, 0, 1, 1, 100, true)).toBeCloseTo(10, 9);
  });

  it('EXTRAPOLATES past the labelled ticks, because the ramp does too', () => {
    // The printed labels are almost never at the ends of the ramp; there is real
    // sampled ink beyond them. The bound that matters is the STRIP, enforced
    // where readings are taken.
    expect(valueAtParam(2, 0, 1, 0, 100, false)).toBeCloseTo(200, 9);
    expect(valueAtParam(-1, 0, 1, 0, 100, false)).toBeCloseTo(-100, 9);
  });

  it('refuses what has no answer, rather than returning a number anyway', () => {
    expect(valueAtParam(0.5, 1, 1, 0, 100, false)).toBeNull(); // ticks coincide
    expect(valueAtParam(NaN, 0, 1, 0, 100, false)).toBeNull();
    expect(valueAtParam(0.5, 0, 1, 0, 100, true)).toBeNull(); // log through zero
    expect(valueAtParam(0.5, 0, 1, -1, 100, true)).toBeNull();
  });
});
