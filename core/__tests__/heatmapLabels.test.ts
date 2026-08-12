import { describe, expect, it } from 'vitest';
import { formatLabelList, labelAt, labelCoverage, parseLabelList, reindexLabels } from '../heatmapLabels.js';

/**
 * The names on a heatmap's axes — "the label is the coordinate" (v2.2).
 *
 * ⚑ The record shape is a plain list per axis, indexed by cell, so these tests
 * are about the two things that can silently lose data: a name that contains the
 * separator, and a position that shifts because an empty slot was dropped.
 */

describe('parseLabelList', () => {
  it('takes one label per comma, trimmed', () => {
    expect(parseLabelList('BRCA1, TP53 , EGFR')).toEqual(['BRCA1', 'TP53', 'EGFR']);
  });

  it('is empty for an empty field — no labels, not one blank one', () => {
    expect(parseLabelList('')).toEqual([]);
    expect(parseLabelList('   ')).toEqual([]);
  });

  it('KEEPS AN EMPTY SLOT, so a gap does not renumber the axis', () => {
    // ⚑ Dropping the blank would move C onto column 2 — every later cell filed
    // under the wrong name while every value stayed right.
    expect(parseLabelList('A,,C')).toEqual(['A', '', 'C']);
    expect(parseLabelList('A,B,')).toEqual(['A', 'B', '']);
  });

  it('lets a QUOTED label keep its comma', () => {
    // ⚑ `Treatment A, 10 mg` is an ordinary published category name; splitting
    // it in half loses exactly the thing being recorded.
    expect(parseLabelList('"Treatment A, 10 mg", Control')).toEqual(['Treatment A, 10 mg', 'Control']);
  });

  it('lets a doubled quote stand for a literal one', () => {
    expect(parseLabelList('"6"" pipe", plain')).toEqual(['6" pipe', 'plain']);
  });
});

describe('formatLabelList', () => {
  it('rebuilds the line the user would have typed', () => {
    expect(formatLabelList(['BRCA1', 'TP53'])).toBe('BRCA1, TP53');
  });

  it('quotes only what needs it, so a reopened list does not grow punctuation', () => {
    expect(formatLabelList(['Treatment A, 10 mg', 'Control'])).toBe('"Treatment A, 10 mg", Control');
    expect(formatLabelList(['6" pipe'])).toBe('"6"" pipe"');
  });

  it('drops TRAILING empties, which padding creates and the user never typed', () => {
    // ⚑ `reindexLabels` pads a short list to the grid's size; without this a
    // reopened project showed "BRCA1, TP53, , , " — punctuation growing every
    // time the grid did. Gaps BETWEEN names are positions and stay.
    expect(formatLabelList(['A', 'B', '', ''])).toBe('A, B');
    expect(formatLabelList(['A', '', 'C'])).toBe('A, , C');
    expect(formatLabelList(['', ''])).toBe('');
  });

  it('round-trips a list with commas, quotes and gaps', () => {
    const labels = ['A, B', '', '6" pipe', 'plain'];
    expect(parseLabelList(formatLabelList(labels))).toEqual(labels);
  });
});

describe('reindexLabels — the order the figure is READ in', () => {
  it('leaves a list alone when the cells run the way the figure reads', () => {
    expect(reindexLabels(['A', 'B', 'C'], 3, false)).toEqual(['A', 'B', 'C']);
  });

  it('REVERSES when cell 0 is the far end of the figure', () => {
    // ⚑⚑ The audit's finding: cell row 0 is yMin, the BOTTOM of the plot, while
    // a person copying names off a published heatmap reads them top-down. The
    // first name typed belongs to the LAST row index.
    expect(reindexLabels(['top', 'middle', 'bottom'], 3, true)).toEqual(['bottom', 'middle', 'top']);
  });

  it('PADS BEFORE REVERSING, so a short list names the rows it was read from', () => {
    // ⚑ Three names on a five-row figure belong to the TOP three rows. Reversing
    // without padding would slide them two rows down the figure — a silent
    // mis-filing that looks like a shorter list, not like a wrong one.
    expect(reindexLabels(['a', 'b', 'c'], 5, true)).toEqual(['', '', 'c', 'b', 'a']);
    expect(reindexLabels(['a', 'b', 'c'], 5, false)).toEqual(['a', 'b', 'c', '', '']);
  });

  it('is its own inverse, which is what lets one rule serve both directions', () => {
    const typed = ['top', '', 'bottom'];
    expect(reindexLabels(reindexLabels(typed, 3, true), 3, true)).toEqual(typed);
  });

  it('leaves SURPLUS labels past the grid where they are', () => {
    // They have no cell to be reversed against; `labelCoverage` reports them.
    expect(reindexLabels(['a', 'b', 'c'], 2, true)).toEqual(['b', 'a', 'c']);
  });

  it('refuses to invent an order for a nonsense cell count', () => {
    expect(reindexLabels(['a'], -1, true)).toEqual(['a']);
    expect(reindexLabels(['a'], 1.5, true)).toEqual(['a']);
    // ⚑ NaN is the one that needs the guard, and mutation is what showed it:
    // -1 and 1.5 fall out the same way with or without it, but `Array.from({
    // length: NaN })` is EMPTY — the names would be dropped, not reordered.
    expect(reindexLabels(['a', 'b'], NaN, true)).toEqual(['a', 'b']);
  });
});

describe('labelAt', () => {
  it('gives the name, or an empty string where there is none', () => {
    expect(labelAt(['A', 'B'], 1)).toBe('B');
    // ⚑ A SHORT LIST IS NOT AN ERROR: three true names on a twelve-column figure
    // beats pushing the user into inventing nine more.
    expect(labelAt(['A', 'B'], 5)).toBe('');
    expect(labelAt(['A'], -1)).toBe('');
    expect(labelAt(['A'], 1.5)).toBe('');
  });
});

describe('labelCoverage', () => {
  it('says nothing at all when nothing has been named', () => {
    expect(labelCoverage([], 5)).toBe('');
  });

  it('counts the named cells rather than refusing a short list', () => {
    expect(labelCoverage(['A', 'B'], 5)).toBe('2 of 5 named');
    expect(labelCoverage(['A', '', 'C'], 5)).toBe('2 of 5 named');
  });

  it('still speaks up when NOTHING is named but names exist past the grid', () => {
    // ⚑ The state a removed boundary can leave: no cell named, and names
    // addressing cells that are not there. Staying silent here would hide the
    // surplus entirely, since the numbers cannot show it.
    expect(labelCoverage(['', ''], 0)).toBe('0 of 0 named; 2 more labels than cells');
  });

  it('SAYS SO when there are more labels than cells', () => {
    // ⚑ The case a removed boundary creates: names addressing cells that are not
    // there. Visible, because the numbers cannot show it.
    expect(labelCoverage(['A', 'B', 'C'], 2)).toBe('2 of 2 named; 1 more label than cells');
    expect(labelCoverage(['A', 'B', 'C', 'D'], 2)).toBe('2 of 2 named; 2 more labels than cells');
  });
});
