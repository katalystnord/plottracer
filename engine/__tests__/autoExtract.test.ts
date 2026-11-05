import { describe, expect, it } from 'vitest';
import { autoExtractTools, planAutoExtract, autoExtractLine, autoExtractFooter, autoExtractNotRead } from '../autoExtract.js';
import { ALL_AXES_TYPE_CONFIGS } from '../axesTypeConfigs.js';

const getAxesTypeConfig = (id: string) => ALL_AXES_TYPE_CONFIGS.find((c) => c.id === id)!;
import type { LegendEntry } from '../legendRead.js';

const box = { x0: 0, y0: 0, x1: 10, y1: 10 };
const entry = (name: string, colour: [number, number, number] | null, sample: LegendEntry['sample'] = null): LegendEntry => ({ name, colour, sample, textBox: box, sampleBox: box });
const RED: [number, number, number] = [192, 57, 43];
const BLUE: [number, number, number] = [31, 119, 180];
const one = [{ index: 0, name: 'Series 1', pointCount: 0 }];

describe('Auto-extract all series: one step per series the legend names', () => {
  it('given a legend of two names on an XY figure, each is read by Find lines on its own colour, into a series of its name', () => {
    const plan = planAutoExtract(getAxesTypeConfig('xy'), [entry('Blend A', BLUE), entry('Blend B', RED)], one);
    expect(plan).toEqual([
      { entry: 0, name: 'Blend A', colour: BLUE, tool: 'lines', into: 0 },
      { entry: 1, name: 'Blend B', colour: RED, tool: 'lines', into: 'new' },
    ]);
  });

  it('a legend entry drawn as a marker is read as points, one drawn as a line as a line', () => {
    const plan = planAutoExtract(getAxesTypeConfig('xy'), [entry('Fit', BLUE, 'line'), entry('Measured', RED, 'marker')], one);
    expect(plan.map((s) => ('tool' in s ? s.tool : 'skip' in s ? s.skip : 'read with another'))).toEqual(['lines', 'points']);
  });

  it('on a polar figure, which Find lines does not read, a line entry is read by Colour trace as a curve and a marker entry as points', () => {
    const plan = planAutoExtract(getAxesTypeConfig('polar'), [entry('Fit', BLUE, 'line'), entry('Measured', RED, 'marker')], one);
    expect(plan.map((s) => ('tool' in s ? s.tool : 'skip' in s ? s.skip : 'read with another'))).toEqual(['shapes', 'points']);
  });

  it('on a bar chart every series is read as the type reads its shapes', () => {
    const plan = planAutoExtract(getAxesTypeConfig('bar'), [entry('2019', BLUE, 'swatch'), entry('2020', RED, 'swatch')], one);
    expect(plan.map((s) => ('tool' in s ? s.tool : 'skip' in s ? s.skip : 'read with another'))).toEqual(['shapes', 'shapes']);
  });

  // docs/v2.7-workflow-walk.md, "Series told apart by their line style"
  it('two entries in one ink read as lines: the ink is read once, by the first, for both, to be told apart by style', () => {
    const plan = planAutoExtract(getAxesTypeConfig('xy'), [entry('series 1', [0, 0, 0]), entry('series 2', [10, 10, 10])], one);
    expect(plan[0]).toMatchObject({ entry: 0, name: 'series 1', tool: 'lines', shares: [1] });
    expect(plan[1]).toEqual({ entry: 1, name: 'series 2', readWith: 0 });
  });

  // docs/v2.7-workflow-walk.md, "Series told apart by their markers"
  it('two entries in one ink read as points: the ink is read once, by the first, for both, to be told apart by marker', () => {
    const plan = planAutoExtract(getAxesTypeConfig('xy'), [entry('series 1', [0, 0, 0], 'marker'), entry('series 2', [10, 10, 10], 'marker')], one);
    expect(plan[0]).toMatchObject({ entry: 0, name: 'series 1', tool: 'points', shares: [1] });
    expect(plan[1]).toEqual({ entry: 1, name: 'series 2', readWith: 0 });
  });

  it('given marker entries in different inks, each is read on its own ink as before', () => {
    const plan = planAutoExtract(getAxesTypeConfig('xy'), [entry('series 1', BLUE, 'marker'), entry('series 2', RED, 'marker')], one);
    expect(plan).toEqual([
      { entry: 0, name: 'series 1', colour: BLUE, tool: 'points', into: 0 },
      { entry: 1, name: 'series 2', colour: RED, tool: 'points', into: 'new' },
    ]);
  });

  it('a line and a marker entry in one ink are read by different tools, so colour cannot tell them apart: the second is not read', () => {
    const plan = planAutoExtract(getAxesTypeConfig('xy'), [entry('series 1', [0, 0, 0], 'line'), entry('series 2', [10, 10, 10], 'marker')], one);
    expect(plan[1]).toEqual({
      entry: 1,
      name: 'series 2',
      skip: 'Same colour as series 1, so colour cannot tell them apart: its data was all read into series 1. Move each to its own series in the series list.',
    });
  });

  it('an entry with no colour beside it is not read, and says what to do instead', () => {
    const plan = planAutoExtract(getAxesTypeConfig('xy'), [entry('Control', null)], one);
    expect(plan[0]).toEqual({ entry: 0, name: 'Control', skip: 'No colour was found beside “Control” in the legend, so it was not read. Pick its colour from the figure with Find lines or Colour trace.' });
  });

  it('pressed again, each series goes back into the series of its name, never a second copy', () => {
    const series = [
      { index: 0, name: 'Blend A', pointCount: 120 },
      { index: 1, name: 'Blend B', pointCount: 98 },
    ];
    const plan = planAutoExtract(getAxesTypeConfig('xy'), [entry('Blend A', BLUE), entry('Blend B', RED)], series);
    expect(plan.map((s) => ('into' in s ? s.into : null))).toEqual([0, 1]);
  });

  it('a series the user already filled is never taken over by another name', () => {
    const series = [{ index: 0, name: 'My trace', pointCount: 40 }];
    const plan = planAutoExtract(getAxesTypeConfig('xy'), [entry('Blend A', BLUE)], series);
    expect(plan[0]).toMatchObject({ into: 'new' });
  });

  it('an empty series another entry is named after is kept for that entry', () => {
    const series = [{ index: 0, name: 'Blend B', pointCount: 0 }];
    const plan = planAutoExtract(getAxesTypeConfig('xy'), [entry('Blend A', BLUE), entry('Blend B', RED)], series);
    expect(plan.map((s) => ('into' in s ? s.into : null))).toEqual(['new', 0]);
  });

  it('greyed where no tool on the card reads a series by colour: heatmap, box plot', () => {
    expect(autoExtractTools(getAxesTypeConfig('heatmap'))).toEqual([]);
    expect(autoExtractTools(getAxesTypeConfig('boxplot'))).toEqual([]);
    expect(planAutoExtract(getAxesTypeConfig('heatmap'), [entry('A', BLUE)], one)).toEqual([]);
  });
});

describe('the Auto-extract report: one short line per series, the shared sentence once (David, 2026-11-02)', () => {
  it('given four blends each read as one line of 195 points with 2 places to check, each line says just that', () => {
    expect(autoExtractLine('Blend A', { lines: 1, points: 195, gaps: 0 })).toBe('Blend A: 1 line, 195 points');
  });

  // ⚑ David, 2026-11-04: a problem is said once, in Places to check; the card's line says what was read
  it('a series line counts what was read and no places: those are listed in Places to check alone', () => {
    expect(autoExtractLine('Blend A', { lines: 1, points: 195, gaps: 0 })).toBe('Blend A: 1 line, 195 points');
  });

  it('a series that could not be read says so in a few words and points to Places to check, where the reason is', () => {
    expect(autoExtractNotRead('Formulation B')).toBe('Formulation B: not read, see Places to check');
  });

  it('gaps bridged and more than one line are counted when there are some', () => {
    expect(autoExtractLine('Blend A', { lines: 2, points: 240, gaps: 1 })).toBe('Blend A: 2 lines, 240 points, 1 gap bridged');
  });

  it('a series read as points says how many', () => {
    expect(autoExtractLine('Measured', { points: 12 })).toBe('Measured: 12 points');
  });

  it('the places and the undo are said once, under all the series; the places only when there are some', () => {
    expect(autoExtractFooter(true)).toBe('Places to check are listed on the right. Undo takes the whole read back.');
    expect(autoExtractFooter(false)).toBe('Undo takes the whole read back.');
  });
});
