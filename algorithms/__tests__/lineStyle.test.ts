/**
 * A line's style, measured, and series told apart by it (v2.7; docs/v2.7-workflow-walk.md, "Series told apart by
 * their line style"). The corpus is fixtures/findLines/dashes: series sharing one ink, in matplotlib, ggplot2 and R
 * styles, with each series' pixel polyline and its legend sample.
 */
import { describe, expect, it } from 'vitest';
import { findLines } from '../findLines/lines.js';
import { assignStyles, inkTest, styleAlong, styleOfRuns, styleOfSample } from '../lineStyle.js';
import { dashFigures, seriesOf } from './helpers/dashCorpus.js';

describe('a style from the runs of ink along a path', () => {
  it('given ink all along, the line is solid', () => {
    expect(styleOfRuns({ on: [300], off: [] }).solid).toBe(true);
  });
  it("given matplotlib's '--' at 100 dpi (marks 8 px, gaps 3 px), the period is one mark and one gap: 11 px", () => {
    const s = styleOfRuns({ on: [8, 8, 8, 8, 8], off: [3, 3, 3, 3, 3] });
    expect(s).toMatchObject({ solid: false, twoKinds: false, period: 11 });
  });
  it("given a dash-dot (marks 13 and 2 px, gaps 3 px), there are two kinds of mark and the period is a whole cycle", () => {
    const s = styleOfRuns({ on: [13, 2, 13, 2, 13, 2], off: [3, 3, 3, 3, 3, 3] });
    expect(s).toMatchObject({ twoKinds: true, period: 21 });
  });
  it('given dots rasterised 1 and 3 px long, they are one kind of mark, not a dash-dot', () => {
    expect(styleOfRuns({ on: [1, 3, 1, 3, 1, 3, 1, 3], off: [4, 3, 4, 3, 4, 3, 4] }).twoKinds).toBe(false);
  });
  it('given a solid line that followed a dotted one for a stretch, it is solid: the style is where most of its length is', () => {
    expect(styleOfRuns({ on: [2, 2, 2, 2, 2, 2, 2, 2, 2, 2], off: [3, 3, 3, 3, 3, 3, 3, 3, 3, 3], allOn: [600, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2], length: 680 }).solid).toBe(true);
  });
});

describe('the found lines given to the legend entries by style, on the dash-coded corpus', () => {
  let right = 0, none = 0;
  const wrong: string[] = [];
  for (const f of dashFigures()) {
    for (const inkS of [...new Set(f.series.map((s) => s.ink.join(',')))]) {
      const ss = f.series.filter((s) => s.ink.join(',') === inkS);
      const ink = inkTest(f.img.data, f.img.width, f.img.height, ss[0]!.ink, [255, 255, 255]);
      const entries = ss.map((s) => styleOfSample({ x0: s.sample[0], y0: s.sample[1], x1: s.sample[2], y1: s.sample[3] }, ink));
      const r = findLines(f.img.data, f.img.width, f.img.height, ss[0]!.ink, f.box, { contour: false, masks: [f.legend] });
      const given = assignStyles(r.lines.map((L) => styleAlong(L.points, ink)), entries);
      r.lines.forEach((L, i) => {
        const k = seriesOf(L, ss);
        if (k < 0) return;
        if (given[i] === null) none += L.points.length;
        else if (given[i] === k) right += L.points.length;
        else wrong.push(`${f.name}: ${ss[k]!.name} (${L.points.length} points) given to ${ss[given[i]!]!.name}`);
      });
    }
  }
  it('given any figure of the corpus, no line that follows one series is given to another series', () => {
    expect(wrong).toEqual([]);
  });
  it('given the whole corpus, at least 90% of the length of the lines that follow a series is given to that series', () => {
    expect(right / (right + none)).toBeGreaterThanOrEqual(0.9);
  });
});
