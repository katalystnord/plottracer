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

describe('B4 — a MEASURED axis says where its clicks landed too', () => {
  /**
   * ⚑⚑ THE SAME WRONG BRANCH, IN A SECOND PLACE. David, on the layout:
   * *"we want to make it VISUALLY coherent for the user, when they are setting
   * value tick markers also?"* Right — and the reason it was not is that the
   * tick convention is declared `onlyWhen: 'xIsCategory'`, so a measured axis
   * cannot say whether its two clicks were band CENTRES or band BOUNDARIES.
   * It now has bands (case A1), so it has the question.
   *
   * ⚑ IT IS A WRONG READING, NOT A UI NICETY. Clicking x=0 and x=14 on a
   * 7-column figure gives boundaries at 0,2,…,14 if those were edges, and a
   * grid running −1.17…15.17 if they were centres. Every cell's recorded
   * x_min/x_max moves, and nothing on screen looks wrong. Neither convention is
   * rare: matplotlib's `imshow` labels cell centres, `pcolormesh` labels
   * boundaries.
   *
   * ⚑ THE CALIBRATION IS UNTOUCHED EITHER WAY — x=0 is still at that pixel.
   * Only the GRID extent changes, which is the two-layer model doing its job.
   */
  it('extends the grid half a band past clicks that marked CENTRES', () => {
    const s = walk(
      { xTicksCentred: 'true' },
      { x1: ['0'], x2: ['12', '7'], y1: ['0'], y2: ['6', '5'] }
    );
    const { x } = dividersOf(s);
    // Seven columns whose FIRST and LAST centres are 0 and 12: six gaps, so a
    // band is 2 wide and the plot box runs −1 … 13.
    expect(x).toHaveLength(8);
    expect(x[0]).toBeCloseTo(-1, 9);
    expect(x[7]).toBeCloseTo(13, 9);
  });

  it('takes the clicks as the boundaries under the other convention', () => {
    const s = walk({}, { x1: ['0'], x2: ['12', '7'], y1: ['0'], y2: ['6', '5'] });
    const { x } = dividersOf(s);
    expect(x[0]).toBeCloseTo(0, 9);
    expect(x[7]).toBeCloseTo(12, 9);
  });

  it('offers the choice on a measured axis at all', () => {
    // The control was hidden behind `onlyWhen: 'xIsCategory'`, so the question
    // could not be answered on the axis kind that now needs it most.
    const ticks = (HEATMAP_AXES_CONFIG.options ?? []).find((o) => o.key === 'xTicksCentred')!;
    expect((ticks as { onlyWhen?: string }).onlyWhen).toBeUndefined();
    // …and its label no longer says "category", because the question never was.
    expect(ticks.label).not.toMatch(/categor/i);
  });

  it('REFUSES centred clicks on a single band, which mark nothing', () => {
    // One band has one centre, so two clicks at different coordinates cannot
    // both be it. Half a band of a band that has no width is not a number.
    const s = walk(
      { xTicksCentred: 'true' },
      { x1: ['0'], x2: ['12', '7'], y1: ['0'], y2: ['6', '5'] }
    );
    const bad = walk(
      { xTicksCentred: 'true' },
      { x1: ['0'], x2: ['12', '1'], y1: ['0'], y2: ['6', '5'] }
    );
    expect(s.runCalibration()).toBe(true);
    expect(bad.runCalibration()).toBe(false);
  });
});

describe('B11 — a LOG colour key says what it needs, and refuses at the click', () => {
  /**
   * ⚑⚑ David: *"It is really difficult to know where to click, so clicking known
   * points like this causes this type of error."* He clicked the END of the
   * colour strip for the first key value and typed 0 — which is the natural
   * move, and on a linear key beginning at zero it is often right. On a LOG key
   * it can never be: the scale never reaches zero, and the ends of the ramp
   * usually carry no printed number at all (the weld sample's strip runs 60…780
   * while its ticks read 100…700).
   *
   * The old behaviour accepted the click, carried it through the rest of the
   * walk, and refused at Calibrate — by which point nothing said which of eight
   * clicks was wrong, and there was no way to edit it either.
   */
  it('asks for a LABELLED tick, and warns the ends carry no number', () => {
    const s = new CalibrationSession(HEATMAP_AXES_CONFIG);
    s.setOption('isLogValue', 'true');
    const kv1 = s.getSteps().find((st) => st.key === 'kv1')!;
    expect(kv1.prompt).toMatch(/LABELLED tick/);
    expect(kv1.prompt).toMatch(/never reaches zero|ends/i);
    // …and says it only when it applies.
    const linear = new CalibrationSession(HEATMAP_AXES_CONFIG);
    expect(linear.getSteps().find((st) => st.key === 'kv1')!.prompt).not.toMatch(/log/i);
  });

  it('REFUSES the zero at the click that completes the walk, not at Calibrate', () => {
    const s = new CalibrationSession(HEATMAP_AXES_CONFIG);
    s.setOption('isLogValue', 'true');
    const clicks: Array<[number, number, string[]]> = [
      [100, 300, ['0']], [400, 300, ['10', '5']],
      [100, 300, ['0']], [100, 100, ['20', '4']],
      [120, 420, []], [380, 420, []],
      [150, 420, ['0']], // the strip's end, typed as zero — David's click
      [350, 420, ['100']],
    ];
    const results = clicks.map(([px, py, vals]) => {
      s.handleCalibrationClick(px, py);
      return vals.length > 0 ? s.confirmCalibrationValues(vals) : true;
    });
    // Every step up to the last is accepted — one value alone cannot say whether
    // a log scale passes through zero, so the last confirm is the EARLIEST
    // honest moment to refuse.
    expect(results.slice(0, -1).every(Boolean)).toBe(true);
    expect(results[results.length - 1]).toBe(false);
    expect(s.getCalibrationError()).toMatch(/log colour scale/i);
  });

  it('keeps the pending pixel so the value can be corrected in place', () => {
    // ⚑ A refused confirm must not cost the click. The box keeps what was typed
    // and the user fixes the number — the alternative is hunting for that tick
    // again, which is what made the old refusal so expensive.
    const s = new CalibrationSession(HEATMAP_AXES_CONFIG);
    s.setOption('isLogValue', 'true');
    for (const [px, py, vals] of [
      [100, 300, ['0']], [400, 300, ['10', '5']],
      [100, 300, ['0']], [100, 100, ['20', '4']],
      [120, 420, []], [380, 420, []], [150, 420, ['5']],
    ] as Array<[number, number, string[]]>) {
      s.handleCalibrationClick(px, py);
      if (vals.length > 0) s.confirmCalibrationValues(vals);
    }
    s.handleCalibrationClick(350, 420);
    expect(s.confirmCalibrationValues(['-3'])).toBe(false);
    expect(s.getPendingPixel()).toEqual({ px: 350, py: 420 });
    expect(s.getCurrentStep()!.key).toBe('kv2');
    // …and the corrected value goes straight through.
    expect(s.confirmCalibrationValues(['100'])).toBe(true);
    expect(s.runCalibration()).toBe(true);
  });
});

describe('B11b — switching Log ON re-checks what was already typed', () => {
  it('reports immediately, rather than waiting for Calibrate', () => {
    // ⚑ A 0 typed on a LINEAR key is legitimate. Ticking Log makes it
    // impossible — and nothing said so until Calibrate, which is how David
    // ended up with a refusal and no idea which of eight clicks caused it.
    const s = new CalibrationSession(HEATMAP_AXES_CONFIG);
    for (const [px, py, vals] of [
      [100, 300, ['0']], [400, 300, ['10', '5']],
      [100, 300, ['0']], [100, 100, ['20', '4']],
      [120, 420, []], [380, 420, []], [150, 420, ['0']], [350, 420, ['100']],
    ] as Array<[number, number, string[]]>) {
      s.handleCalibrationClick(px, py);
      if (vals.length > 0) s.confirmCalibrationValues(vals);
    }
    expect(s.getCalibrationError()).toBeNull(); // fine on a linear key
    s.setOption('isLogValue', 'true');
    expect(s.getCalibrationError()).toMatch(/log colour scale/i);
    // …and switching it back off clears it, rather than leaving a stale verdict.
    s.setOption('isLogValue', 'false');
    expect(s.getCalibrationError()).toBeNull();
  });
});
