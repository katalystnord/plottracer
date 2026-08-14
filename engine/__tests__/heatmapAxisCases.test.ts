import { describe, expect, it } from 'vitest';
import { CalibrationSession, HEATMAP_AXES_CONFIG } from '../calibrationSession.js';
import { heatmapBandCounts, heatmapBounds, initialGridFor } from '../heatmapRun.js';
import type { XYAxes } from '../../core/axes/xy.js';

/**
 * THE FOUR AXIS CASES — the design's own list, as named tests (v2.2 rewrite).
 *
 * ⚑⚑ WHY THIS FILE EXISTS. The settled design named four combinations —
 * category×category, category×value, value×value, value×category — *"all of
 * which occur in published figures"* — and gave an expected outcome for none of
 * them. The build implemented the two category ones and nobody noticed the
 * other half was missing for a whole release, because a conclusion in a memo
 * reads as satisfied while a red test does not. See CLAUDE.md, "From an agreed
 * design to a build — four gates".
 *
 * ⚑⚑ THE DEFECT THESE PIN DOWN: "is the axis category or value" is about WHAT
 * INDEXES the rows and columns — names or numbers. It was read as WHETHER THE
 * GRID EXISTS AT ALL, and `initialGridFor` gave a value axis exactly two
 * dividers — one cell spanning the figure. David: *"I think we need to have
 * column and row number markers even if they are not categories."* A heatmap is
 * a MATRIX whichever way its axes are indexed.
 *
 * ⚑ THE COUNT IS DECLARED ONCE, IN THE WALK, FOR BOTH KINDS, in the `dz` slot of
 * each axis's second point. A category axis has no coordinate competing for
 * `dx`, which is why the count used to live there — but putting the two kinds'
 * counts in different slots is the same asymmetry that produced a second count
 * box in the grid panel. One slot, both kinds; `dx` always means the coordinate
 * or nothing.
 */

/** Drive the eight-click walk, entering whatever each step actually asks for. */
function walk(
  options: Record<string, string>,
  values: { x1: string[]; x2: string[]; y1: string[]; y2: string[] }
): CalibrationSession<XYAxes> {
  const s = new CalibrationSession(HEATMAP_AXES_CONFIG);
  for (const [k, v] of Object.entries(options)) s.setOption(k, v);
  const clicks: Array<[number, number, string[]]> = [
    [100, 300, values.x1],
    [400, 300, values.x2],
    [100, 300, values.y1],
    [100, 100, values.y2],
    [120, 420, []], // the colour key's strip ends
    [380, 420, []],
    [150, 420, ['5']], // two labelled ticks on the key
    [350, 420, ['95']],
  ];
  for (const [px, py, vals] of clicks) {
    s.handleCalibrationClick(px, py);
    if (vals.length > 0) s.confirmCalibrationValues(vals);
  }
  return s;
}

/** The dividers a calibrated session puts on each axis. */
function dividersOf(s: CalibrationSession<XYAxes>): { x: number[]; y: number[] } {
  expect(s.runCalibration()).toBe(true);
  const axes = s.getAxes()!;
  const bounds = heatmapBounds(axes as never)!;
  expect(bounds).not.toBeNull();
  const grid = initialGridFor(bounds, heatmapBandCounts(axes as never));
  return { x: [...grid.xDividers], y: [...grid.yDividers] };
}

describe('A1 — value × value: a measured axis has bands too', () => {
  it('puts 7 columns and 5 rows on a figure whose axes are both numeric', () => {
    // ⚑⚑ THE CASE THAT WAS ENTIRELY ABSENT. Before this, both axes numeric gave
    // `[xMin, xMax]` and `[yMin, yMax]` — ONE cell covering the whole figure,
    // no dividers, nothing to select and nothing to drag.
    const s = walk(
      {},
      { x1: ['0'], x2: ['14', '7'], y1: ['0'], y2: ['6', '5'] }
    );
    const { x, y } = dividersOf(s);
    expect(x).toHaveLength(8); // 7 columns -> 8 boundaries
    expect(y).toHaveLength(6); // 5 rows    -> 6 boundaries
    // Evenly spread across the CALIBRATED span, in data coordinates.
    expect(x[0]).toBeCloseTo(0, 9);
    expect(x[7]).toBeCloseTo(14, 9);
    expect(x[1]).toBeCloseTo(2, 9);
    expect(y[0]).toBeCloseTo(0, 9);
    expect(y[5]).toBeCloseTo(6, 9);
  });

  it('asks a value axis for the coordinate AND the count, in that order', () => {
    // Gate 4's half of it at the model: the count has to be ASKED for, or the
    // user has no way to declare it and the case is unreachable on screen.
    const s = new CalibrationSession(HEATMAP_AXES_CONFIG);
    const x2 = s.getSteps().find((st) => st.key === 'x2')!;
    expect(x2.valueFields.map((f) => f.label)).toEqual(['X', 'Columns']);
    expect(x2.valueFields.map((f) => f.field)).toEqual(['dx', 'dz']);
    const y2 = s.getSteps().find((st) => st.key === 'y2')!;
    expect(y2.valueFields.map((f) => f.label)).toEqual(['Y', 'Rows']);
    expect(y2.valueFields.map((f) => f.field)).toEqual(['dy', 'dz']);
  });
});

describe('A2 — category × category', () => {
  it('puts the declared bands on both axes, indexed 0…N', () => {
    const s = walk(
      { xIsCategory: 'true', yIsCategory: 'true' },
      { x1: [], x2: ['6'], y1: [], y2: ['4'] }
    );
    const { x, y } = dividersOf(s);
    expect(x).toHaveLength(7);
    expect(y).toHaveLength(5);
    // An ordinal frame: the coordinates ARE the indices.
    expect(x[0]).toBeCloseTo(0, 9);
    expect(x[6]).toBeCloseTo(6, 9);
    expect(y[4]).toBeCloseTo(4, 9);
  });

  it('stores a category count in the SAME slot a value count uses', () => {
    // The asymmetry this removes: the two kinds used to answer "how many bands"
    // into different slots, which is why a value axis could not be asked at all.
    const s = new CalibrationSession(HEATMAP_AXES_CONFIG);
    s.setOption('xIsCategory', 'true');
    const x2 = s.getSteps().find((st) => st.key === 'x2')!;
    expect(x2.valueFields.map((f) => f.label)).toEqual(['Columns']);
    expect(x2.valueFields.map((f) => f.field)).toEqual(['dz']);
  });
});

describe('A3 — category × value', () => {
  it('bands both axes, with names available on x only', () => {
    const s = walk(
      { xIsCategory: 'true' },
      { x1: [], x2: ['6'], y1: ['0'], y2: ['6', '5'] }
    );
    const { x, y } = dividersOf(s);
    expect(x).toHaveLength(7);
    expect(y).toHaveLength(6);
    expect(x[6]).toBeCloseTo(6, 9); // ordinal
    expect(y[5]).toBeCloseTo(6, 9); // measured
  });
});

describe('A4 — value × category, the transpose', () => {
  it('bands both axes the other way round', () => {
    const s = walk(
      { yIsCategory: 'true' },
      { x1: ['0'], x2: ['14', '7'], y1: [], y2: ['4'] }
    );
    const { x, y } = dividersOf(s);
    expect(x).toHaveLength(8);
    expect(y).toHaveLength(5);
    expect(x[7]).toBeCloseTo(14, 9); // measured
    expect(y[4]).toBeCloseTo(4, 9); // ordinal
  });
});

describe('the count is a declaration, and a bad one is refused', () => {
  it('refuses a value axis with no count rather than inventing one cell', () => {
    // ⚑ The old behaviour dressed as a refusal: "no count" silently meant "one
    // cell spanning the figure", which reads back as a heatmap with one enormous
    // value in it. A missing declaration has to say so.
    const s = walk({}, { x1: ['0'], x2: ['14', ''], y1: ['0'], y2: ['6', '5'] });
    expect(s.runCalibration()).toBe(false);
  });

  it('refuses a count that is not a whole number', () => {
    const s = walk({}, { x1: ['0'], x2: ['14', '7.5'], y1: ['0'], y2: ['6', '5'] });
    expect(s.runCalibration()).toBe(false);
  });
});
