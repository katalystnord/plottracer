/**
 * ⚑⚑ THE PICKER'S ORDER IS A DESIGN, SO IT IS A TEST.
 *
 * The card picker is a 3-wide grid rendered straight from
 * `ALL_AXES_TYPE_CONFIGS`, so the list's ORDER is the LAYOUT. David gave this
 * layout himself on 2026-09-03, left to right and top to bottom - which makes it
 * an agreed design, and an agreed design's cases become named tests rather than
 * a comment that reads as satisfied.
 *
 * ⚑ THE RULE BEHIND IT: GROUP BY THE DATA, NOT BY THE PICTURE. David, correcting
 * a shape-first argument that had stood in `axesTypeConfigs.ts` since v1.6:
 * *"Just because pies are round does not make them more aligned with polar or
 * others. The data represented in bars are sometimes shown as a pie and vice
 * versa. Histograms, the odd one out, even though it looks like a bar, is
 * actually more aligned with a box or candlestick, as it describes an absolute
 * distribution, a statistical measurement."*
 *
 * ⚑ Asserted as ROWS rather than as a flat list, because rows are what a reader
 * sees. A diff that moves one type reads as a changed row here, not as an
 * off-by-one in a list of fourteen names.
 */
import { describe, expect, it } from 'vitest';
import { ALL_AXES_TYPE_CONFIGS } from '../axesTypeConfigs.js';

/** The picker's grid width - `GraphTypeCardPicker`'s own layout. */
const COLUMNS = 3;

function rows(): string[][] {
  const labels = ALL_AXES_TYPE_CONFIGS.map((c) => c.label);
  const out: string[][] = [];
  for (let i = 0; i < labels.length; i += COLUMNS) out.push(labels.slice(i, i + COLUMNS));
  return out;
}

describe('the graph-type picker lays out as agreed', () => {
  it('puts every type where David placed it', () => {
    expect(rows()).toEqual([
      ['XY', 'Line', 'Histogram'],
      ['Bar', 'Span chart', 'Pie / Donut'],
      ['Box Plot', 'Candlestick', 'Spider / Radar'],
      ['Heatmap', 'Map', 'Ternary'],
      ['Polar', 'Circular Chart Recorder'],
    ]);
  });

  it('⚑ keeps the bar family a 2x2 BLOCK, which is what a single row could not do', () => {
    // One measured value vs N named ones reads DOWN the columns; simple vs
    // compound reads ACROSS. Bar sits above Box Plot, Span above Candlestick.
    const grid = rows();
    expect([grid[1]![0], grid[1]![1]]).toEqual(['Bar', 'Span chart']);
    expect([grid[2]![0], grid[2]![1]]).toEqual(['Box Plot', 'Candlestick']);
  });

  it('⚑ keeps Pie beside Bar, because they carry the same record', () => {
    // A category and one magnitude, either way it is drawn. Round is a rendering
    // choice, not a family - which is the shape-first argument this replaced.
    const barRow = rows()[1]!;
    expect(barRow).toContain('Bar');
    expect(barRow).toContain('Pie / Donut');
  });

  it('is not vacuous - every registered type appears exactly once', () => {
    const flat = rows().flat();
    expect(flat).toHaveLength(ALL_AXES_TYPE_CONFIGS.length);
    expect(new Set(flat).size).toBe(flat.length);
  });
});
