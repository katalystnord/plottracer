/**
 * Find lines reads DOTTED lines (v2.7; docs/v2.7-workflow-walk.md, "Series told apart by their line style").
 *
 * Measured first, on the dash-coded corpus (fixtures/findLines/dashes): solid and dashed series came back whole, and
 * every dotted one (matplotlib ':', ggplot2 and R's "13") was covered 0-51%, its dots filed as label ink - a dot has no
 * direction, so the dash-gap pairing, which joins ends that point at each other, never reaches it.
 */
import { describe, expect, it } from 'vitest';
import { findLines } from '../findLines/lines.js';
import { coverage, dashFigures, isDotted, styleName } from './helpers/dashCorpus.js';

const figures = dashFigures();

describe('a dotted line is read as a line', () => {
  for (const f of figures) {
    const inks = [...new Set(f.series.map((s) => s.ink.join(',')))];
    for (const ink of inks) {
      const ss = f.series.filter((s) => s.ink.join(',') === ink);
      const r = findLines(f.img.data, f.img.width, f.img.height, ss[0]!.ink, f.box, { contour: false, masks: [f.legend] });
      const cov = coverage(r.lines, ss, f.legend);
      ss.forEach((s, i) => {
        if (!isDotted(s.style)) return;
        it(`given ${f.name}, its dotted ${s.name} (${styleName(s.style)}) is read along at least 90% of its length, in at most 2 pieces`, () => {
          expect(cov[i]!.cover).toBeGreaterThanOrEqual(0.9);
          expect(cov[i]!.pieces).toBeLessThanOrEqual(2);
        });
      });
    }
  }
});

describe('reading dots takes nothing from the other lines', () => {
  for (const f of figures) {
    const inks = [...new Set(f.series.map((s) => s.ink.join(',')))];
    for (const ink of inks) {
      const ss = f.series.filter((s) => s.ink.join(',') === ink);
      const r = findLines(f.img.data, f.img.width, f.img.height, ss[0]!.ink, f.box, { contour: false, masks: [f.legend] });
      const cov = coverage(r.lines, ss, f.legend);
      ss.forEach((s, i) => {
        if (isDotted(s.style)) return;
        it(`given ${f.name}, ${s.name} (${styleName(s.style)}) is still read along at least 65% of its length`, () => {
          expect(cov[i]!.cover).toBeGreaterThanOrEqual(0.65);
        });
      });
    }
  }
});
