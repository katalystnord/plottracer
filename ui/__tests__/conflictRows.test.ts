import { describe, expect, it } from 'vitest';
import { conflictRows, crowdedIsSystematic, systematicCrowdedMessage } from '../src/panels/BarTable.js';
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

// ⚑ One cell per named value, `null` where there is no reading - the shape the
// session hands over since v2.5 (see `engine/valueColumns.ts`). These fixtures
// describe a ONE-value type, which is what a bar chart is.
const column = (seriesIndex: number, values: (number | null)[]) => ({
  seriesIndex,
  seriesName: `Series ${seriesIndex + 1}`,
  cells: values.map((v) => [v]),
  tupleIndices: values.map((v, i) => (v === null ? null : i)),
});

const table = (values: (number | null)[], names: string[], extraSeries = 0): BarCategoryTable =>
  ({
    categoryNames: names,
    categoryRawNames: names,
    valueColumns: ['Value'],
    columns: [
      column(0, values),
      ...Array.from({ length: extraSeries }, (_, i) => column(i + 1, values)),
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

  it('⚑⚑ names the SERIES once there is more than one, and stays quiet at one', () => {
    // `crowded` spans every series, so on a grouped figure "Category 2, 281.5,
    // in the table above" says nothing about WHICH column it means - and the two
    // candidates may sit in a series the user is not even looking at.
    const one = conflictRows(CROWDED, table([342, 281, 207], ['A', 'B', 'C']), display);
    expect(one.find((r) => r.key === 'held')!.note).toBe('in the table above');

    const many = conflictRows(CROWDED, table([342, 281, 207], ['A', 'B', 'C'], 1), display);
    expect(many.find((r) => r.key === 'held')!.note).toBe('Series 1, in the table above');
    expect(many.find((r) => r.key === 'hidden')!.note).toBe('Series 1, not shown above');
  });

  it('⚑ still offers the hidden bar when the cell somehow holds nothing', () => {
    const rows = conflictRows(CROWDED, table([342, null, 207], ['A', 'B', 'C']), display);
    expect(rows.filter((r) => r.kind === 'candidate').map((r) => r.key)).toEqual(['hidden']);
  });
});

/**
 * ⚑⚑ TWO SITUATIONS, ONE SYMPTOM, OPPOSITE REMEDIES.
 *
 * ⚠️ THE FIRST VERSION OF THIS PANEL SHIPPED A WALL. Every crowded reading drew
 * its own block with its own neighbours - fine for one, unusable for five: the
 * same four values repeating down the panel with nothing saying what was
 * actually wrong. David, tracing a second colour into series 1: *"this is what I
 * thought. It is completely broken."* The design had only ever been exercised
 * with ONE conflict, which is the fixture being blind to what it lacks.
 */
describe('telling a few strays from a whole second series', () => {
  /** Crowded readings in ONE series, at these categories. */
  const at = (...ix: number[]) => ix.map((categoryIndex) => ({ seriesIndex: 0, categoryIndex }));

  it('⚑⚑ one stray in a four-category figure is NOT systematic', () => {
    expect(crowdedIsSystematic(at(1), 4)).toBe(false);
  });

  it('⚑⚑ every category doubled IS - that is a second series in one slot', () => {
    expect(crowdedIsSystematic(at(0, 1, 2, 3), 4)).toBe(true);
  });

  it('⚑ counts DISTINCT categories, not readings - three strays in one band is still one band', () => {
    // Otherwise a single category collecting several extras (a dense legend, a
    // mis-declared count) would be read as "you traced two series", and the
    // panel would offer the wrong remedy with confidence.
    expect(crowdedIsSystematic(at(1, 1, 1), 4)).toBe(false);
  });

  it('⚑ needs at least two doubled categories, so one cannot carry the claim', () => {
    expect(crowdedIsSystematic(at(0), 2)).toBe(false);
    expect(crowdedIsSystematic(at(0, 1), 2)).toBe(true);
  });

  it('⚑ says nothing at all on a figure with no categories', () => {
    expect(crowdedIsSystematic(at(0), 0)).toBe(false);
  });

  it('⚑⚑ names the remedy, and does NOT tell the user to delete anything', () => {
    // The readings are all real in this case. Offering to delete them one at a
    // time would be offering the wrong thing, once per category.
    const msg = systematicCrowdedMessage(4, 'bar');
    expect(msg).toContain('add a series');
    expect(msg).toContain('belong in a series of their own');
    expect(msg).not.toMatch(/delete|remove/i);
  });

  it('⚑ offers the cause as a condition, because the panel cannot know it', () => {
    expect(systematicCrowdedMessage(4, 'bar')).toMatch(/If you traced two colours/);
  });

  it('⚑⚑ two unrelated strays in DIFFERENT series are not systematic', () => {
    // The claim is "you traced two colours into ONE series", so the evidence has
    // to be one series doubled across its own categories. Counting distinct
    // categories across ALL series instead, a swatch caught by series 1 and a
    // stray bar in series 2 looked systematic on any figure of four categories
    // or fewer - and the panel then gave advice for a mistake nobody had made
    // while suppressing the rows that would have fixed the real one.
    const spread = [
      { seriesIndex: 0, categoryIndex: 0 },
      { seriesIndex: 1, categoryIndex: 2 },
    ];
    expect(crowdedIsSystematic(spread, 4)).toBe(false);
  });

  it('⚑ but ONE series doubled across its own categories still is', () => {
    const oneSeries = [
      { seriesIndex: 1, categoryIndex: 0 },
      { seriesIndex: 1, categoryIndex: 1 },
      { seriesIndex: 1, categoryIndex: 2 },
    ];
    expect(crowdedIsSystematic(oneSeries, 4)).toBe(true);
  });
});
