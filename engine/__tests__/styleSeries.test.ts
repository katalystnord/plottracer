/**
 * Auto-extract on series sharing one ink: which found lines make each legend entry's series (v2.7;
 * docs/v2.7-workflow-walk.md, "Series told apart by their line style", the cases still to build).
 */
import { describe, expect, it } from 'vitest';
import { planStyleSeries, type StyledLine } from '../styleSeries.js';
import type { LineStyle } from '../../algorithms/lineStyle.js';

const solid: LineStyle = { solid: true, twoKinds: false, period: null, duty: null, marks: 1 };
const dashed: LineStyle = { solid: false, twoKinds: false, period: 11, duty: 0.73, marks: 40 };
const dotted: LineStyle = { solid: false, twoKinds: false, period: 6, duty: 0.5, marks: 90 };
const line = (style: LineStyle, xMin: number, xMax: number): StyledLine => ({ style, xMin, xMax });

describe('which found lines make each entry series', () => {
  it('given a solid, a dashed and a dotted line and the three entries, each entry gets its own line', () => {
    const p = planStyleSeries([line(dotted, 0, 500), line(solid, 0, 500), line(dashed, 0, 500)], [solid, dashed, dotted]);
    expect(p).toEqual({ perEntry: [[1], [2], [0]], left: [], empty: [] });
  });

  it('given an entry whose line came in two pieces end to end, both are its, in order along x, to be joined', () => {
    const p = planStyleSeries([line(dotted, 260, 500), line(solid, 0, 500), line(dotted, 0, 250)], [solid, dotted]);
    expect(p!.perEntry).toEqual([[1], [2, 0]]);
  });

  it('given a piece with an entry style that runs alongside that entry line, it is not joined: it is left, to be checked', () => {
    const p = planStyleSeries([line(dotted, 0, 500), line(dotted, 20, 60)], [solid, dotted]);
    expect(p!.perEntry).toEqual([[], [0]]);
    expect(p!.left).toEqual([{ line: 1, why: 'overlaps', entry: 1 }]);
  });

  it('given a line whose style matches no entry, it is left, to be checked', () => {
    const odd: LineStyle = { solid: false, twoKinds: true, period: 40, duty: 0.2, marks: 30 };
    const p = planStyleSeries([line(solid, 0, 500), line(odd, 0, 500)], [solid, dotted]);
    expect(p!.left).toEqual([{ line: 1, why: 'unmatched' }]);
  });

  it('given an entry no line has the style of, it is empty, to be checked at the legend', () => {
    const p = planStyleSeries([line(solid, 0, 500)], [solid, dotted]);
    expect(p!.empty).toEqual([1]);
  });

  it('given entries whose styles cannot be told apart (two solid), there is no plan: the read goes as before', () => {
    expect(planStyleSeries([line(solid, 0, 500), line(solid, 0, 500)], [solid, solid])).toBeNull();
  });

  it('given an entry whose sample could not be measured, it takes no part, and the others are still matched', () => {
    const p = planStyleSeries([line(solid, 0, 500), line(dashed, 0, 500)], [solid, null, dashed]);
    expect(p!.perEntry).toEqual([[0], [], [1]]);
    expect(p!.empty).toEqual([1]);
  });
});
