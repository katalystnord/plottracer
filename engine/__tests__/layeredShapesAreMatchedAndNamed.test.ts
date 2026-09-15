/**
 * ⚑⚑ TWO SERIES OF ONE SHAPE ARE ONE GROUP, AND A GROUP IS NAMED AFTER ALL OF
 * THEM.
 *
 * ⚠️ FOUND BY MUTATION, 2026-09-15. `engine/layeredSeries.ts` scored 68.57% with
 * TWELVE mutants no test reached at all, and they were not scattered: every one
 * sat in `listOf` or `layeredGroupName`. The cause was one gap in the fixtures -
 * no test ever put TWO series in the SAME group, so the grouping's own
 * accumulate step (`if (group) group.members.push(s)`) could be replaced with
 * `if (false)` and nothing noticed, and the list voice those two functions exist
 * for was never spoken.
 *
 * ⚑ The offer's own tests were not wrong, they were UNIFORM: one series per
 * shape, every time. [[feedback_fixture_blind_by_construction]] - ask what your
 * fixture sets to one, or to zero, or to symmetric.
 *
 * ⚠️⚑⚑ AND ONE SURVIVOR WAS A GATE 3 BREACH IN MY OWN COMMENT. `shapeKey`'s
 * header says *"Case- and space-insensitive... a file that writes `min` where we
 * write `Min` is the same shape, not a second one"*. Mutation replaced
 * `toLowerCase` with `toUpperCase` and deleted `.trim()`, and BOTH survived: the
 * comment asserted what the design requires and no test of that name enforced
 * it. It is enforced here.
 */
import { describe, expect, it } from 'vitest';
import {
  layeredSeriesGroups,
  layeredGroupName,
  layeredProjectOffer,
  isLayered,
} from '../layeredSeries.js';

const BAR = ['Corner', 'Opposite corner'];
const BOX = ['Min', 'Q1', 'Median', 'Q3', 'Max'];

describe('series of the same shape are one group', () => {
  it('⚑⚑ two Bar-shaped series group together rather than counting as two kinds', () => {
    const groups = layeredSeriesGroups([
      { name: 'Control', slots: BAR },
      { name: 'Treated', slots: BAR },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.members.map((m) => m.name)).toEqual(['Control', 'Treated']);
    expect(isLayered([{ name: 'a', slots: BAR }, { name: 'b', slots: BAR }])).toBe(false);
  });

  it('⚑ and a mixed file groups each shape once, keeping every member', () => {
    const groups = layeredSeriesGroups([
      { name: 'Control', slots: BAR },
      { name: 'Treated', slots: BOX },
      { name: 'Vehicle', slots: BAR },
    ]);
    expect(groups.map((g) => g.members.map((m) => m.name))).toEqual([
      ['Control', 'Vehicle'],
      ['Treated'],
    ]);
  });
});

describe('the shape key ignores case and surrounding space', () => {
  it('⚑⚑ a file writing `min` is the same shape as one writing `Min`', () => {
    expect(
      layeredSeriesGroups([
        { name: 'ours', slots: BOX },
        { name: 'theirs', slots: ['min', 'q1', 'median', 'q3', 'max'] },
      ])
    ).toHaveLength(1);
  });

  it('⚑ and padding around a slot name is not a second shape', () => {
    expect(
      layeredSeriesGroups([
        { name: 'ours', slots: BAR },
        { name: 'theirs', slots: [' Corner ', 'Opposite corner  '] },
      ])
    ).toHaveLength(1);
  });

  it('⚠️ a genuinely different name IS a second shape - the leniency must not over-reach', () => {
    expect(
      layeredSeriesGroups([
        { name: 'ours', slots: BAR },
        { name: 'theirs', slots: ['Corner', 'Far corner'] },
      ])
    ).toHaveLength(2);
  });
});

describe('what a split figure is called', () => {
  it('⚑⚑ names every series it holds, in the list voice', () => {
    expect(layeredGroupName([{ name: 'Control', slots: BAR }])).toBe('Control');
    expect(
      layeredGroupName([
        { name: 'Control', slots: BAR },
        { name: 'Treated', slots: BAR },
      ])
    ).toBe('Control and Treated');
    expect(
      layeredGroupName([
        { name: 'Control', slots: BAR },
        { name: 'Treated', slots: BAR },
        { name: 'Vehicle', slots: BAR },
      ])
    ).toBe('Control, Treated and Vehicle');
  });

  it('⚑ falls back to a word rather than to an empty tab', () => {
    // A series can reach the file door unnamed; a figure with no name at all
    // leaves the jumper showing nothing to click.
    expect(layeredGroupName([])).toBe('Figure');
    expect(layeredGroupName([{ name: '', slots: BAR }])).toBe('Figure');
  });
});

describe('the offer says what it is for, and nothing technical', () => {
  it('⚠⚑⚑ names NO series and NO slots - David deleted the generated middle', () => {
    /**
     * David, 2026-09-15, on the list this used to assert: *"Just remove the
     * technical wording from the offer altogether. It is not needed at all for
     * any graph or series type."*
     *
     * ⚠️ The deleted list was mine, and it read `Corner, Opposite corner` for a
     * BAR - how a bar is CAPTURED, a phrase that appears nowhere on screen,
     * where the panel's own header reads `Value`. It was written to make every
     * word checkable against the panel and achieved the opposite for the
     * commonest type.
     *
     * ⚑ This case is here so nobody restores it as a kindness.
     */
    const offer = layeredProjectOffer([
      { name: 'Control', slots: BAR },
      { name: 'Vehicle', slots: BAR },
      { name: 'Treated', slots: BOX },
    ]);
    expect(offer).not.toBeNull();
    expect(offer).not.toContain('Control');
    expect(offer).not.toContain('Corner');
    expect(offer).not.toContain('Min, Q1');
    // What it DOES carry: the reason and the remedy, in David's own words.
    expect(offer).toContain('series of different kinds');
    expect(offer).toContain('one copy of the graph image per series type');
  });

  it('⚑ the group NAME still lists the series, because those are the user\u2019s own words', () => {
    // The series name is what the user typed and can see in the panel; a slot
    // name is ours. That is why one survived the deletion and the other did not.
    expect(
      layeredGroupName([
        { name: 'Control', slots: BAR },
        { name: 'Vehicle', slots: BAR },
      ])
    ).toBe('Control and Vehicle');
  });
});
