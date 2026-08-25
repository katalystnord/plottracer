import { describe, expect, it } from 'vitest';
import { conflictRows } from '../src/panels/BarTable.js';
import type { BarCategoryTable } from '../src/panels/BarTable.js';

/**
 * ⚑⚑ THE READING THAT HAD NO ROW TO CLICK.
 *
 * `crowded` carries the `tupleIndex` of the bar it is describing, and the panel
 * printed a sentence and threw it away - so it said a reading was missing and
 * gave the user nothing to press, while every other row in that table selects
 * its bar on click.
 */
const display = { atData: (v: readonly number[]) => v[0]! } as never;

const table = (values: (number | null)[], names: string[]): BarCategoryTable =>
  ({
    categoryNames: names,
    categoryRawNames: names,
    columns: [
      {
        seriesIndex: 0,
        seriesName: 'Series 1',
        values,
        intervals: values.map(() => null),
        tupleIndices: values.map((v, i) => (v === null ? null : i)),
      },
    ],
    crowded: [],
  }) as unknown as BarCategoryTable;

const CROWDED = { seriesIndex: 0, categoryIndex: 1, tupleIndex: 9 };

describe('the rows shown for a crowded reading', () => {
  it('⚑⚑ offers BOTH candidates - the hidden bar AND the one holding the cell', () => {
    // First-wins is CAPTURE ORDER, not correctness. On an auto-trace that order
    // is position along the category axis, so a swatch left of the bar it
    // collides with takes the cell and the real bar is the hidden one. A panel
    // that offered only the hidden row would be asserting the wrong winner.
    const rows = conflictRows(CROWDED, table([342, 281, 207], ['A', 'B', 'C']), display);
    const candidates = rows.filter((r) => r.kind === 'candidate');
    expect(candidates.map((r) => r.tupleIndex)).toEqual([1, 9]);
  });

  it('⚑ shows the neighbour above and below as CONTEXT, and they are inert', () => {
    const rows = conflictRows(CROWDED, table([342, 281, 207], ['A', 'B', 'C']), display);
    const context = rows.filter((r) => r.kind === 'context');
    expect(context.map((r) => r.label)).toEqual(['A', 'C']);
    expect(context.every((r) => r.tupleIndex === null)).toBe(true);
    expect(context.map((r) => r.reading)).toEqual(['342', '207']);
  });

  it('⚑⚑ says the hidden reading is NOT READ, never a blank', () => {
    // It lost the cell, so its value is not among `col.values` at all. A blank
    // there would read as "this bar measured nothing", which is a different and
    // false claim - the whole point is that a real reading exists.
    const rows = conflictRows(CROWDED, table([342, 281, 207], ['A', 'B', 'C']), display);
    expect(rows.find((r) => r.key === 'hidden')!.reading).toBe('not read');
  });

  it('⚑ names which row is which, so neither has to be guessed at', () => {
    const rows = conflictRows(CROWDED, table([342, 281, 207], ['A', 'B', 'C']), display);
    expect(rows.find((r) => r.key === 'held')!.note).toBe('in the table above');
    expect(rows.find((r) => r.key === 'hidden')!.note).toBe('not shown above');
  });

  it('⚑ drops the neighbour that does not exist at either end', () => {
    const first = conflictRows({ ...CROWDED, categoryIndex: 0 }, table([342, 281], ['A', 'B']), display);
    expect(first.map((r) => r.key)).toEqual(['held', 'hidden', 'below']);
    const last = conflictRows({ ...CROWDED, categoryIndex: 1 }, table([342, 281], ['A', 'B']), display);
    expect(last.map((r) => r.key)).toEqual(['above', 'held', 'hidden']);
  });

  it('⚑ numbers an unnamed category rather than showing an empty label', () => {
    // The fabricated-name rule in reverse: a blank in a list of rows you are
    // being asked to choose between says nothing at all.
    const rows = conflictRows(CROWDED, table([342, 281, 207], ['', '', '']), display);
    expect(rows.map((r) => r.label)).toEqual(['Category 1', 'Category 2', 'Category 2', 'Category 3']);
  });

  it('⚑ still offers the hidden bar when the cell somehow holds nothing', () => {
    const rows = conflictRows(CROWDED, table([342, null, 207], ['A', 'B', 'C']), display);
    expect(rows.filter((r) => r.kind === 'candidate').map((r) => r.key)).toEqual(['hidden']);
  });
});
