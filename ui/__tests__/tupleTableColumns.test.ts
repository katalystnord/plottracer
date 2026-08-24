import { describe, expect, it } from 'vitest';
import { tupleTableColumns } from '../src/panels/TupleTable.js';
import type { TupleRow } from '../src/panels/TupleTable.js';

/**
 * ⚑⚑ THE CASE THAT HAD NO NAME.
 *
 * The rule "a row has a value or an interval, never both" was stated in the
 * model, tested in the model, and then re-decided in the component as two
 * inline consts that nothing could reach except a full Electron e2e. Gate 2:
 * an agreed design's cases become named tests, named for the CASE.
 *
 * The three single-shape cases were reasoned about when the rule was built. The
 * MIXED one - one series holding a bar that sits on the baseline AND a bar that
 * floats - never was, and it is the one a real figure produces most often:
 * a chart where one condition happens to start at zero.
 */
const row = (over: Partial<TupleRow>): TupleRow =>
  ({
    tupleIndex: 0,
    label: null,
    values: [],
    derived: null,
    interval: null,
    ...over,
  }) as TupleRow;

const SLOTS = ['Min', 'Max'] as const;
const VALUE_COLUMN = { label: 'Value' } as never;

const onBaseline = row({ derived: 8.004, interval: null });
const floating = row({ tupleIndex: 1, derived: null, interval: { min: 12, max: 30 } });

describe('which value columns a tuple table shows', () => {
  it('a figure whose bars all sit on the baseline shows Value and NOT Min/Max', () => {
    const { showDerived, showInterval } = tupleTableColumns([onBaseline], SLOTS, VALUE_COLUMN);
    expect(showDerived).toBe(true);
    expect(showInterval).toBe(false);
  });

  it('a figure whose bars all float shows Min/Max and NOT Value', () => {
    const { showDerived, showInterval } = tupleTableColumns([floating], SLOTS, VALUE_COLUMN);
    expect(showDerived).toBe(false);
    expect(showInterval).toBe(true);
  });

  it('⚑⚑ a MIXED figure shows BOTH - neither bar loses its reading to the other', () => {
    // Without this, one of the two shapes has no column to appear in at all:
    // the floating bar's ends, or the anchored bar's value. Which one vanishes
    // depends on which rule is asked first, and nothing on screen would say a
    // reading had been dropped.
    const { showDerived, showInterval } = tupleTableColumns(
      [onBaseline, floating],
      SLOTS,
      VALUE_COLUMN,
    );
    expect(showDerived).toBe(true);
    expect(showInterval).toBe(true);
  });

  it('⚑ an empty table asserts nothing - no Value heading over no readings', () => {
    expect(tupleTableColumns([], SLOTS, VALUE_COLUMN)).toEqual({
      showDerived: false,
      showInterval: false,
    });
  });

  it('⚑ a type with no interval slots never shows them, however its rows read', () => {
    // A box plot's five readings are five separate columns, not an interval.
    expect(tupleTableColumns([floating], undefined, VALUE_COLUMN).showInterval).toBe(false);
  });

  it('⚑ a type with no derived column never shows one', () => {
    expect(tupleTableColumns([onBaseline], SLOTS, null).showDerived).toBe(false);
  });
});
