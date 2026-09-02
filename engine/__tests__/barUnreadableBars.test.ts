import { describe, expect, it } from 'vitest';
import { BAR_AXES_CONFIG, SPAN_AXES_CONFIG, CalibrationSession } from '../calibrationSession.js';
import type { BarAxes } from '../../core/axes/bar.js';
import { walkCategoryAxis } from './helpers/categoryWalk.js';
import { buildExportSections } from '../exportAssembly.js';
import type { ExportAssemblyInput } from '../exportAssembly.js';

/**
 * ⚑⚑ A BAR THAT MISSES THE BASELINE MUST STILL BE ACCOUNTED FOR (v2.5).
 *
 * Bar lost `interval` when the Span chart took floating over, and the interval
 * was the only thing that put a NUMBER in that row. What was left was a null,
 * which the panel prints as the same dash a category with NO BAR prints - so a
 * measured bar and an absent one became indistinguishable on screen while both
 * of the bar's corners sat in the record and in every export the whole time.
 *
 * ⚑ That is `crowded`'s lesson word for word - *a complete-LOOKING table with a
 * real reading silently missing* - so the answer is `crowded`'s mechanism, not a
 * new one: the session reports what it could not report, and the panel says so.
 *
 * The cases are named for what the SCREEN shows, not for the function.
 */

// P1=0 @ (300,500), P2=10 @ (300,100) - the convention every bar fixture uses.
function calibratedBar(
  session: CalibrationSession<BarAxes>,
  count = 2,
  options: Record<string, string> = {}
): void {
  for (const [k, v] of Object.entries(options)) session.setOption(k, v);
  session.handleCalibrationClick(300, 500);
  session.confirmCalibrationValues(['0']);
  session.handleCalibrationClick(300, 100);
  session.confirmCalibrationValues(['10']);
  walkCategoryAxis(session, { count });
  expect(session.runCalibration()).toBe(true);
}

/** A bar sitting on the baseline in category 1, worth 5. */
function seatedBar(s: CalibrationSession<BarAxes>): void {
  s.addDataPoint(150, 500);
  s.addDataPoint(150, 300);
}

/** A bar floating between 2.5 and 7.5 in category 2 - it touches nothing. */
function floatingBar(s: CalibrationSession<BarAxes>): void {
  s.addDataPoint(350, 400);
  s.addDataPoint(350, 200);
}

describe('a bar that does not reach the baseline', () => {
  it('is REPORTED, not silently left as a dash beside the bars that read', () => {
    const s = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    calibratedBar(s);
    seatedBar(s);
    floatingBar(s);
    const table = s.getBarCategoryTable();
    // The reading it cannot state.
    expect(table.columns[0]!.values).toEqual([5, null]);
    // And the account of it: which series, which category, which bar, and why.
    expect(table.unreadable).toEqual([
      { seriesIndex: 0, categoryIndex: 1, tupleIndex: 1, reason: 'off-baseline' },
    ]);
  });

  it('⚑ keeps its row and both of its measured ends - nothing is dropped from the record', () => {
    const s = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    calibratedBar(s);
    seatedBar(s);
    floatingBar(s);
    // The row is there and names its bar, so the cell still selects it.
    expect(s.getBarCategoryTable().columns[0]!.tupleIndices).toEqual([0, 1]);
    const row = s.getTupleRows()[1]!;
    expect(row.points.map((p) => p?.data?.[0])).toEqual([2.5, 7.5]);
  });

  it('says nothing about a figure whose bars all sit down', () => {
    const s = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    calibratedBar(s);
    seatedBar(s);
    expect(s.getBarCategoryTable().unreadable).toEqual([]);
  });
});

describe('what is NOT an unreadable bar', () => {
  it('⚠️ a half-dragged bar is INCOMPLETE, and the table already aims at its missing corner', () => {
    const s = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    calibratedBar(s);
    s.addDataPoint(150, 500); // one corner only
    expect(s.getBarCategoryTable().unreadable).toEqual([]);
  });

  it('a stacked segment is measured from the segment below it, so it reads and reports', () => {
    const s = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    calibratedBar(s, 2, { isStacked: 'true' });
    floatingBar(s);
    const table = s.getBarCategoryTable();
    expect(table.columns[0]!.values[1]).toBeCloseTo(5, 6);
    expect(table.unreadable).toEqual([]);
  });

  it('⚑⚑ a SPAN reports both ends, so there is nothing for a notice to be about', () => {
    const s = new CalibrationSession<BarAxes>(SPAN_AXES_CONFIG);
    calibratedBar(s, 2);
    floatingBar(s);
    const table = s.getBarCategoryTable();
    expect(table.columns[0]!.intervals[1]).toEqual({ min: 2.5, max: 7.5 });
    expect(table.unreadable).toEqual([]);
  });
});

describe('a bar figure with no baseline declared', () => {
  it('⚑ is ONE fact about the figure: every bar is unreadable, and all for the same reason', () => {
    const s = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    calibratedBar(s, 2, { hasBaseline: 'false' });
    seatedBar(s);
    floatingBar(s);
    const table = s.getBarCategoryTable();
    expect(table.columns[0]!.values).toEqual([null, null]);
    expect(table.unreadable.map((u) => u.reason)).toEqual(['no-baseline', 'no-baseline']);
  });
});


/**
 * ⚑⚑ A SPAN IS CAPTURED THE WAY A BAR IS, AND THE SPLIT LEFT THAT BEHIND (v2.5).
 *
 * `capturesAsBox` is the type saying its two points are OPPOSITE CORNERS. Bar
 * declared it; Span, whose whole datum IS the box, did not - so two things went
 * missing at once, and only one of them was visible.
 *
 * ⚠️ MEASURED IN THE BUILT APP, not reasoned about: a corner-to-corner drag on a
 * Span chart recorded NOTHING - zero rows - while the tips bar told the user to
 * make exactly that gesture. The invisible half is below.
 */
describe('a span records what it measured along the category axis', () => {
  it('⚑⚑ its EXTENT is kept, not derived from where two clicks happened to land', () => {
    const s = new CalibrationSession<BarAxes>(SPAN_AXES_CONFIG);
    calibratedBar(s, 2);
    // A span drawn across a band, corner to opposite corner: the two clicks are
    // at different category coordinates, and that distance is a READING.
    s.addDataPoint(120, 400);
    s.addDataPoint(180, 200);
    const row = s.getTupleRows()[0]!;
    // ⚑ Without `capturesAsBox` this is null, and the width the user measured is
    // dropped on the floor - a COORDINATE DERIVED where it should have been
    // MEASURED, which is one of tenet 11's two named failure modes.
    expect(row.positionSpan).not.toBeNull();
    expect(row.positionSpan![0]).toBeLessThan(row.positionSpan![1]);
  });
});

describe('what the notice PROMISES has to be true', () => {
  /**
   * ⚑⚑ THE PANEL SAYS *"both measured ends are still in the record and in every
   * export"*, so a test says it too. A sentence that reassures the user about
   * something nothing enforces is exactly the false evidence of compliance this
   * project has learnt to distrust - and here it is the difference between "your
   * reading is not reportable" and "your work is gone".
   */
  it('a bar with no value still writes both of its ends to the file', () => {
    const s = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    calibratedBar(s);
    floatingBar(s);
    const [data] = buildExportSections({
      session: s,
      axes: s.getAxes()!,
      configId: 'bar',
      scope: 'active',
      measures: [],
      precision: 'auto',
    } as unknown as ExportAssemblyInput);
    const at = (name: string) => data!.rows[0]![data!.header.indexOf(name)];
    expect(at('Min')).toBeCloseTo(2.5, 6);
    expect(at('Max')).toBeCloseTo(7.5, 6);
  });
});
