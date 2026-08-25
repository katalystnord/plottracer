import { describe, expect, it } from 'vitest';
import { tracingADifferentColour, NEW_COLOUR_DISTANCE } from '../colorTraceRun.js';

/**
 * ⚑⚑ THE OFFER THAT BELONGS AT THE GESTURE.
 *
 * Tracing a second colour into one series doubles EVERY category: the table can
 * show one reading per cell, so half of them vanish behind a message that
 * explains the mess after it is made. David, having done it on the viability
 * figure and unpicked it by hand: *"new colour should automatically suggest a
 * new series."*
 *
 * ⚑ The cases below sit well clear of the threshold on purpose. What has to be
 * true is WHICH SITUATIONS speak, not the exact number - a later tuning of
 * `NEW_COLOUR_DISTANCE` should not turn this file red.
 */
const BLUE = [31, 78, 121] as const;
const RED = [192, 57, 43] as const;

describe('when picking a colour should suggest a new series', () => {
  it('⚑⚑ speaks when the series already holds readings from another colour', () => {
    expect(tracingADifferentColour(BLUE, RED, 5)).toBe(true);
  });

  it('⚑⚑ stays SILENT on an empty series - it can take any colour', () => {
    // The first trace of a figure must not be nagged at. There is nothing there
    // to disagree with yet.
    expect(tracingADifferentColour(BLUE, RED, 0)).toBe(false);
  });

  it('⚑⚑ stays SILENT on a re-trace of the same colour - the adjust-and-look loop', () => {
    // Nudging the tolerance and tracing again is ordinary use. A suggestion that
    // fires here teaches the user to dismiss the one that matters.
    expect(tracingADifferentColour(BLUE, BLUE, 5)).toBe(false);
  });

  it('⚑ tolerates an eyedropper landing on an anti-aliased edge of the SAME ink', () => {
    // One pixel off a boundary picks a slightly different value for what is
    // plainly the same curve. That false positive would kill the feature.
    const nearlyBlue = [37, 84, 128] as const;
    expect(tracingADifferentColour(BLUE, nearlyBlue, 5)).toBe(false);
  });

  it('⚑ asks "different curve?", not "different pixel?" - the threshold is generous', () => {
    // Guards the intent rather than the number: whatever the constant becomes,
    // it must sit above a shade-difference and below two distinct series.
    const apart = (a: readonly number[], b: readonly number[]) =>
      Math.abs(a[0]! - b[0]!) + Math.abs(a[1]! - b[1]!) + Math.abs(a[2]! - b[2]!);
    expect(apart(BLUE, [37, 84, 128])).toBeLessThan(NEW_COLOUR_DISTANCE);
    expect(apart(BLUE, RED)).toBeGreaterThan(NEW_COLOUR_DISTANCE);
  });

  it('⚑ two greys a person would call different DO speak', () => {
    expect(tracingADifferentColour([40, 40, 40], [190, 190, 190], 3)).toBe(true);
  });
});
