/**
 * ⚑⚑ ERROR ATTACHES TO A NAMED VALUE, NOT TO A TUPLE.
 *
 * David, 2026-09-03: *"A floating bar chart is just a bar chart, but with two
 * ends on the span. And error bars work exactly the same, on each end."*
 *
 * Before this, `ERROR_ROLES` was appended ONCE to a tuple, which silently
 * assumed one datum per tuple. On a span that put an upper cap on the low end
 * and an upper cap on the high end into the SAME slot: the second overwrote the
 * first, and a figure with uncertainty at both ends recorded half of itself.
 *
 * ⚑ THE GROUPS HANG OFF THE CAPTURE SLOTS, not off the reported names. A span
 * reports `Min`/`Max` by SORTING its two corners, so the sorted name is not a
 * stable identity - drag one corner past the other and Min becomes Max. The
 * corner is what was measured, so the corner is what the error is stored
 * against; the report sorts value and error together.
 *
 * ⚑ Checked against the generators before it was built: matplotlib's `yerr` is
 * `shape(2, N)` - per data point - and ggplot2's `geom_errorbar` takes one
 * layer per end. Neither offers a span-with-error primitive; you COMPOSE it.
 * See `project_candlestick_and_span_error_taxonomy`.
 */
import { describe, expect, it } from 'vitest';
import {
  ERROR_EXTENT_SLOTS,
  errorGroupCount,
  errorSlotNames,
  hasErrorSlots,
  ownSlotNames,
  roleForSlot,
  slotForRole,
} from '../errorExtent.js';

const SPAN_OWN = ['Corner', 'Opposite corner'];

describe('error on each end of a span', () => {
  it('gives a span one error group per captured end', () => {
    const slots = errorSlotNames('SD', SPAN_OWN, SPAN_OWN);
    expect(errorGroupCount(slots)).toBe(2);
    expect(ownSlotNames(slots)).toEqual(SPAN_OWN);
  });

  it('stores an upper cap on one end in a different slot from the other end', () => {
    const slots = errorSlotNames('SD', SPAN_OWN, SPAN_OWN);
    const low = slotForRole('upper', slots, 0);
    const high = slotForRole('upper', slots, 1);
    expect(low).not.toBe(high);
    // Every role of every end lands somewhere of its own.
    const all = [0, 1].flatMap((v) =>
      (['upper', 'lower', 'left', 'right'] as const).map((r) => slotForRole(r, slots, v))
    );
    expect(new Set(all).size).toBe(all.length);
  });

  it('names each end\'s columns so the two cannot be confused', () => {
    const slots = errorSlotNames('SD', SPAN_OWN, SPAN_OWN);
    expect(slots).toContain('Corner SD upper');
    expect(slots).toContain('Opposite corner SD upper');
  });

  it('says which end a slot belongs to, not just which role', () => {
    const slots = errorSlotNames('SD', SPAN_OWN, SPAN_OWN);
    expect(roleForSlot(slotForRole('lower', slots, 1), slots)).toEqual({
      role: 'lower',
      valueIndex: 1,
    });
    expect(roleForSlot(0, slots)).toBeNull();
    expect(roleForSlot(1, slots)).toBeNull();
  });

  it('leaves a one-value type\'s layout exactly as it was', () => {
    // XY: a synthetic 'Value' plus four roles, roles at 1..4.
    const xy = errorSlotNames('SD');
    expect(xy).toEqual(['Value', 'SD upper', 'SD lower', 'SD left', 'SD right']);
    expect(errorGroupCount(xy)).toBe(1);
    expect(slotForRole('upper', xy)).toBe(1);
    expect(slotForRole('right', xy)).toBe(4);
    expect(ownSlotNames(xy)).toEqual([]);
    expect(ERROR_EXTENT_SLOTS).toEqual(xy.map((n) => n.replace('SD ', '').replace(/^(.)/, (c) => c.toUpperCase())));
  });

  it('still never reads a box plot\'s five own slots as roles', () => {
    const box = ['Min', 'Q1', 'Median', 'Q3', 'Max'];
    expect(hasErrorSlots(box)).toBe(false);
    expect(errorGroupCount(box)).toBe(0);
    expect(ownSlotNames(box)).toEqual(box);
  });

  it('does not eat the last own slot when counting groups', () => {
    // A pathological one-slot type plus one group: the group count must stop
    // rather than consume the datum and leave a tuple with no carrier.
    const slots = errorSlotNames('SD', ['Value']);
    expect(errorGroupCount(slots)).toBe(1);
  });
});
