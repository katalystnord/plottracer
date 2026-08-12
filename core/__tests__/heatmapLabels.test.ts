import { describe, expect, it } from 'vitest';
import { formatLabelList, labelAt, labelCoverage, parseLabelList } from '../heatmapLabels.js';

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

  it('round-trips a list with commas, quotes and gaps', () => {
    const labels = ['A, B', '', '6" pipe', 'plain'];
    expect(parseLabelList(formatLabelList(labels))).toEqual(labels);
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

  it('SAYS SO when there are more labels than cells', () => {
    // ⚑ The case a removed boundary creates: names addressing cells that are not
    // there. Visible, because the numbers cannot show it.
    expect(labelCoverage(['A', 'B', 'C'], 2)).toBe('2 of 2 named; 1 more label than cells');
    expect(labelCoverage(['A', 'B', 'C', 'D'], 2)).toBe('2 of 2 named; 2 more labels than cells');
  });
});
