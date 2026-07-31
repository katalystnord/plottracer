import { describe, expect, it } from 'vitest';
import { logEndpointsUsable, logPositiveEndpointsUsable } from '../axes/logScale.js';

/**
 * The two log-endpoint rules, tested DIRECTLY.
 *
 * ⚑ WHY THIS FILE EXISTS. `core/axes/logScale.ts` was written on 2026-07-31 to
 * hold a refusal four axes classes had been getting wrong (see the commit that
 * added it: `Math.log(0)` is −Infinity, `Math.log(negative)` is NaN, and
 * `calibrate()` returned true on both). It scored 70% because it is only ever
 * reached THROUGH those four classes, and each of them exercises one rule with
 * one shape of input.
 *
 * The whole reason the module exists is that the two rules genuinely DIFFER —
 * XY may run through the negative decades, a radius may not — so testing them
 * only through their callers is exactly the arrangement that let them drift
 * into four separate inline copies in the first place.
 */

describe('the XY rule: no zero, no MIXED sign', () => {
  it('accepts an ordinary positive pair', () => {
    expect(logEndpointsUsable(1, 100)).toBe(true);
    expect(logEndpointsUsable(100, 1)).toBe(true);
  });

  it('⚑ accepts an ALL-NEGATIVE pair, which is a real negative-decade axis', () => {
    // WPD supports −100..−1 and reflects it before taking the logarithm.
    // Writing this rule as "both must be positive" would refuse a real figure,
    // which is precisely why it is not shared with the radius rule below.
    expect(logEndpointsUsable(-100, -1)).toBe(true);
    expect(logEndpointsUsable(-1, -100)).toBe(true);
  });

  it('refuses a zero at either end', () => {
    expect(logEndpointsUsable(0, 100)).toBe(false);
    expect(logEndpointsUsable(100, 0)).toBe(false);
    expect(logEndpointsUsable(0, 0)).toBe(false);
  });

  it('⚑ refuses a MIXED-sign pair, which has no logarithm at all', () => {
    // The else-branch takes log of a negative and yields NaN. This is the
    // case the original guard missed: it tested only for zero.
    expect(logEndpointsUsable(-1, 100)).toBe(false);
    expect(logEndpointsUsable(1, -100)).toBe(false);
  });

  it('refuses a non-number, including null and undefined', () => {
    expect(logEndpointsUsable(null, 100)).toBe(false);
    expect(logEndpointsUsable(undefined, 100)).toBe(false);
    expect(logEndpointsUsable(1, null)).toBe(false);
    expect(logEndpointsUsable(1, undefined)).toBe(false);
  });

  it('⚑ treats NaN as unusable, though it is a number and passes typeof', () => {
    // NaN > 0 and NaN < 0 are both false, so the sign comparison alone would
    // let a pair of NaNs through as "same sign".
    expect(logEndpointsUsable(NaN, 100)).toBe(false);
    expect(logEndpointsUsable(NaN, NaN)).toBe(false);
  });

  it('accepts values either side of 1, which are not a sign change', () => {
    expect(logEndpointsUsable(0.001, 1000)).toBe(true);
  });
});

describe('the radius rule: strictly positive', () => {
  it('accepts a positive pair', () => {
    expect(logPositiveEndpointsUsable(10, 100)).toBe(true);
    expect(logPositiveEndpointsUsable(0.5, 2)).toBe(true);
  });

  it('refuses zero at either end', () => {
    expect(logPositiveEndpointsUsable(0, 100)).toBe(false);
    expect(logPositiveEndpointsUsable(10, 0)).toBe(false);
  });

  it('⚑ refuses an all-negative pair, which the XY rule ACCEPTS', () => {
    // The one case where the two rules disagree, and the reason there are two
    // of them. A polar radius has no negative branch in its class at all.
    expect(logPositiveEndpointsUsable(-100, -1)).toBe(false);
    expect(logEndpointsUsable(-100, -1)).toBe(true);
  });

  it('refuses a mixed pair too', () => {
    expect(logPositiveEndpointsUsable(-1, 100)).toBe(false);
  });

  it('refuses non-numbers and NaN', () => {
    expect(logPositiveEndpointsUsable(null, 1)).toBe(false);
    expect(logPositiveEndpointsUsable(undefined, 1)).toBe(false);
    expect(logPositiveEndpointsUsable(NaN, 1)).toBe(false);
    expect(logPositiveEndpointsUsable(1, NaN)).toBe(false);
  });

  it('refuses Infinity, which has no finite logarithm to calibrate with', () => {
    expect(logPositiveEndpointsUsable(Infinity, 1)).toBe(false);
    expect(logEndpointsUsable(Infinity, 1)).toBe(false);
  });
});
