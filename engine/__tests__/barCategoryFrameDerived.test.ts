/**
 * ⚑⚑ A2 - THE UNMARKED CASE RUNS THE MARKED CASE'S PRINCIPLES, ON A FRAME
 * MEASURED OFF THE INK.
 *
 * David, 2026-08-21: *"Everything should work on the principles that are there
 * for the case Bar - Axis marked and it should be reused for the Axis unmarked
 * case. And if we need to review the mechanisms to make that work, then we
 * will. Yes, REUSE, but even more, the need to be CONSISTENT and CLEAR."*
 *
 * ⚑⚑ THE MARKED CASE'S PRINCIPLE, STATED. A category is a BAND: an interval on
 * the category axis. A bar's position is which band it falls in; its width is
 * its two corners projected into that same band frame. All three answers come
 * from ONE shared frame, which is why they agree across series.
 *
 * ⚑⚑ WHY THE UNMARKED CASE FAILED, AND IT IS NOT THE PRINCIPLE. `bandIndexAt`
 * and `bandCoordinateAt` both open `if (!edges) return null`
 * (`core/bandedAxis.ts:536,545`), so with no axis marked the session fell back
 * to something with no frame at all: the name-list index in CAPTURE order for
 * the coordinate, and nothing whatever for the extent. Two models where the
 * type has one.
 *
 * ⚑ THE FRAME IS RECOVERABLE FROM WHAT WAS ALREADY MEASURED. `capFreeDirection`
 * (`algorithms/errorCapture.ts:176`) gives a 1-D axes' value direction, rotated
 * charts included; the category direction is its perpendicular. Each bar's two
 * corners project onto it as an interval. The dividers are the midpoints
 * between adjacent bar centres, and the outer edges continue half a pitch past
 * the end bars - so the SAME `bandIndexForParam` / `bandCoordinateForParam`
 * answer, on measured geometry instead of declared geometry.
 *
 * ⚑⚑ THE HEADLINE CASE IS AN IDENTITY. The three-bar fixture below is the same
 * figure `barCategoryCoordinate.test.ts` marks an axis on, and its bars' centres
 * put the derived dividers at exactly the declared ones. So the same clicks must
 * produce the same Position and the same extent with the axis marked and
 * without it. That is the whole finding in one assertion: if the two disagree,
 * one of them is not running the type's model.
 *
 * ⚑ THREE FRAME SOURCES, AND THE THIRD ALREADY EXISTED. Marked: bands from the
 * axis. Unmarked with ONE series holding readings: bands from that series' own
 * bars, and the coordinate is shared because there is nothing to share it with.
 * Unmarked with SEVERAL: a grouped chart's side-by-side bars are
 * indistinguishable from separate categories in the ink alone, so the frame
 * cannot be claimed as shared - and v2.3 theme E already wrote that sentence for
 * Line at `calibrationSession.ts:1841`, as the header `Position (in series)`.
 * Bar says the same words in the same situation.
 *
 * ⚠️⚑⚑ WHAT AN EMPTY CATEGORY COSTS, AND IT IS NOT A WRONG NUMBER. A category
 * with no bar in ANY series leaves no ink, so the derived frame does not know it
 * is there and the categories either side of it CLOSE UP: two bars that a
 * declared axis would call Position 1 and 3 come out 1 and 2. David's reading,
 * and it is the right one: *"what we are saying is that if we cannot measure a
 * CATEGORY, we drop it, so the other categories should collapse."*
 *
 * ⚑ THE COLLAPSED RECORD IS FAITHFUL TO THE INK - measured, not asserted. Two
 * bars 80 wide on a measured pitch of 200 export as 0.4 of a band, against 0.8
 * of a band on the true three-category axis. Regenerate both: the collapsed one
 * gives bars 0.4 wide with a 0.6 gap, the true one bars 0.8 wide with a 1.2 gap.
 * The SAME ratio, 1.5, so the two figures are identical up to a uniform scale.
 * 0.4 is not a corrupted 0.8; it is the correct reading of a bar filling 40% of
 * the pitch that could actually be seen.
 *
 * ▶ So exactly ONE thing is lost, and it is not a measurement: the knowledge
 * that the empty slot was a CATEGORY. A count is a declaration, the ink cannot
 * carry it, and inventing a row for it would mean inventing that row's VALUE
 * too - a missing bar means zero or means no data, and the figure does not say
 * which. Marking the axis is how the user states it, and the last case here is
 * that statement being made on the very same clicks.
 */
import { describe, it, expect } from 'vitest';
import { CalibrationSession, BAR_AXES_CONFIG, BOX_PLOT_AXES_CONFIG } from '../calibrationSession.js';
import { buildExportSections } from '../exportAssembly.js';
import type { TableSection } from '../tableFormats.js';
import type { ExportAssemblyInput } from '../exportAssembly.js';
import { walkCategoryAxis } from './helpers/categoryWalk.js';

/** Value axis: 0 at py 300, 10 at py 100. Vertical bars, screen-aligned. */
function barSession(config = BAR_AXES_CONFIG) {
  const s = new CalibrationSession(config);
  s.handleCalibrationClick(100, 300);
  expect(s.confirmCalibrationValues(['0'])).toBe(true);
  s.handleCalibrationClick(100, 100);
  expect(s.confirmCalibrationValues(['10'])).toBe(true);
  walkCategoryAxis(s);
  expect(s.runCalibration()).toBe(true);
  // ⚑⚑ THE AXIS IS THEN UNMARKED, DELIBERATELY - this whole file is about the
  // DERIVED frame: what a bar chart can say about position, pitch and extent
  // from the INK ALONE, with nothing declared. Since v2.4 the walk always marks
  // the axis, so that state is reached by withdrawing the declaration, which is
  // exactly what a pre-v2.4 project file presents on load.
  s.removeCategoryTicks();
  return s;
}

type BarSession = ReturnType<typeof barSession>;

/** Value axis running LEFT TO RIGHT: a horizontal bar chart, where the category
 * direction is vertical. */
function horizontalBarSession() {
  const s = new CalibrationSession(BAR_AXES_CONFIG);
  s.handleCalibrationClick(100, 300);
  expect(s.confirmCalibrationValues(['0'])).toBe(true);
  s.handleCalibrationClick(300, 300);
  expect(s.confirmCalibrationValues(['10'])).toBe(true);
  // ⚑ The category axis here is VERTICAL, but this file measures the DERIVED
  // frame, so the declaration is withdrawn either way - see `barSession`.
  walkCategoryAxis(s, { from: { x: 100, y: 100 }, to: { x: 100, y: 500 } });
  expect(s.runCalibration()).toBe(true);
  s.removeCategoryTicks();
  return s;
}

/** The declared frame the marked case uses: x 100..400, three categories, so
 * the bands are x 100-200, 200-300, 300-400. */
function withThreeCategories<S extends { markCategoryAxis: (a: { x: number; y: number }, b: { x: number; y: number }) => boolean; setCategoryCount: (n: number) => boolean }>(s: S) {
  expect(s.markCategoryAxis({ x: 100, y: 300 }, { x: 400, y: 300 })).toBe(true);
  expect(s.setCategoryCount(3)).toBe(true);
  return s;
}

/** Two opposite corners: baseline at `left`, top at `right`/`topPy`. */
function bar(s: BarSession, left: number, right: number, topPy: number) {
  s.addDataPoint(left, 300);
  s.addDataPoint(right, topPy);
}

/** A horizontal bar: baseline at px 100, tip at `tipPx`, spanning `top`..`bottom`. */
function hbar(s: BarSession, top: number, bottom: number, tipPx: number) {
  s.addDataPoint(100, top);
  s.addDataPoint(tipPx, bottom);
}

const sectionsFor = (s: BarSession, configId: string, scope: 'active' | 'all' = 'active') =>
  buildExportSections({
    session: s,
    axes: s.getAxes()!,
    configId,
    scope,
    measures: [],
    precision: 'auto',
  } as unknown as ExportAssemblyInput);

const column = (section: TableSection | undefined, name: string) =>
  section!.rows.map((r) => r[section!.header.indexOf(name)]);

describe('an unmarked bar chart is framed by its own bars', () => {
  it('⚑⚑ the SAME clicks export the SAME coordinate marked and unmarked', () => {
    // The bars' centres are 150, 250, 350, so the midpoints between them are
    // 200 and 300 and the frame continues half a pitch past each end: edges at
    // 100 and 400. Those ARE the declared bands. A figure does not change
    // because someone did or did not tell us where its axis is.
    const marked = withThreeCategories(barSession());
    bar(marked, 110, 190, 200);
    bar(marked, 210, 290, 250);
    bar(marked, 310, 390, 150);

    const derived = barSession();
    bar(derived, 110, 190, 200);
    bar(derived, 210, 290, 250);
    bar(derived, 310, 390, 150);

    const [m] = sectionsFor(marked, 'bar');
    const [d] = sectionsFor(derived, 'bar');
    expect(column(d, 'Position')).toEqual(column(m, 'Position'));
    // ⚑ To a tolerance, not exactly. The two frames reach the same number by
    // different arithmetic - the declared one divides a span the user clicked,
    // the derived one a span computed from the bars - so they land 1e-15 apart
    // on the middle bar. Demanding bit equality would be pinning the order of
    // two floating-point operations, which is not what this case is about.
    for (const name of ['Position min', 'Position max']) {
      const got = column(d, name);
      const want = column(m, name);
      expect(got).toHaveLength(want.length);
      got.forEach((v, i) => expect(v as number).toBeCloseTo(want[i] as number, 9));
    }
  });

  it('⚑⚑ bars captured RIGHT TO LEFT are numbered by the figure, not by the hand', () => {
    // The A2 defect in one line. `metadata.categoryIndex` is appended as each
    // tuple opens, so clicking the rightmost bar first called it category 1.
    // A coordinate that changes with the capture order is a record of the
    // operator, not of the figure.
    const s = barSession();
    bar(s, 310, 390, 150);
    bar(s, 110, 190, 200);
    bar(s, 210, 290, 250);
    const [data] = sectionsFor(s, 'bar');
    expect(column(data, 'Position')).toEqual([3, 1, 2]);
  });

  it("⚑⚑ a bar's measured width reaches the file with no axis marked", () => {
    // Band 2 spans Position 1.5 to 2.5; this bar fills its middle 80%, which is
    // matplotlib's own default, so `bar(x=2, height=5, width=0.8)` regenerates
    // it. The two corners were measured either way - only the frame to state
    // them in was missing.
    const s = barSession();
    bar(s, 110, 190, 200);
    bar(s, 210, 290, 250);
    bar(s, 310, 390, 150);
    const [data] = sectionsFor(s, 'bar');
    expect(column(data, 'Position min')[1] as number).toBeCloseTo(1.6, 6);
    expect(column(data, 'Position max')[1] as number).toBeCloseTo(2.4, 6);
  });

  it('⚑⚑ the header claims Position, because the coordinate is measured now', () => {
    const s = barSession();
    bar(s, 110, 190, 200);
    bar(s, 210, 290, 250);
    const [data] = sectionsFor(s, 'bar');
    expect(data!.header).toContain('Position');
    expect(data!.header).not.toContain('Category index');
  });
});

describe('the frame follows the axis, not the screen', () => {
  it('⚑⚑ a ROTATED chart numbers along the category direction', () => {
    // The value axis is tilted, so the category direction is its perpendicular
    // and a naive sort on screen x would answer a different question. This is
    // why the direction comes from `capFreeDirection` rather than from `p.x`.
    const s = new CalibrationSession(BAR_AXES_CONFIG);
    s.handleCalibrationClick(100, 300);
    expect(s.confirmCalibrationValues(['0'])).toBe(true);
    s.handleCalibrationClick(160, 220); // value axis tilted 3-4-5
    expect(s.confirmCalibrationValues(['10'])).toBe(true);
    // ⚑ The category axis runs PERPENDICULAR to that tilt (4,3 normalised), so
    // its two ends are clicked along it - and then withdrawn, because this test
    // is about the DERIVED frame. See `barSession`.
    walkCategoryAxis(s, { from: { x: 100, y: 300 }, to: { x: 340, y: 480 } });
    expect(s.runCalibration()).toBe(true);
    s.removeCategoryTicks();
    // Three bars stepped ALONG the perpendicular (4, 3)/5, each one 40 further.
    bar(s, 132, 156, 276);
    bar(s, 164, 188, 252);
    bar(s, 196, 220, 228);
    const [data] = sectionsFor(s, 'bar');
    expect(column(data, 'Position')).toEqual([1, 2, 3]);
  });

  it('⚑⚑ a HORIZONTAL bar chart is framed on the vertical', () => {
    // The category axis is whichever one the value axis is not. Same mechanism,
    // no per-orientation rule - the lesson A1 already took from
    // `capFreeDirection`.
    const s = horizontalBarSession();
    hbar(s, 110, 190, 200);
    hbar(s, 210, 290, 250);
    hbar(s, 310, 390, 150);
    const [data] = sectionsFor(s, 'bar');
    expect(column(data, 'Position')).toEqual([1, 2, 3]);
  });
});

describe('nothing is claimed that the ink cannot support', () => {
  it('⚑⚑ several series unmarked say Position (in series), the words Line uses', () => {
    // A grouped chart's two side-by-side bars and two adjacent categories are
    // the same ink. So the ordinal is kept - it was measured - and the claim
    // that it is SHARED is the part that is dropped.
    const s = barSession();
    bar(s, 110, 190, 200);
    bar(s, 210, 290, 250);
    s.addDataset('Series 2');
    s.setActiveDataset(1);
    bar(s, 120, 200, 220);
    const [data] = sectionsFor(s, 'bar', 'all');
    expect(data!.header).toContain('Position (in series)');
    expect(data!.header).not.toContain('Category index');
  });

  it('⚑⚑ ONE bar has no measurable pitch, so it gets no extent', () => {
    // A single bar's width is measured; the BAND it sits in is not, because a
    // pitch needs two bars to be seen. Reporting the bar as filling its band
    // would be asserting a spacing nobody measured.
    const s = barSession();
    bar(s, 210, 290, 250);
    const [data] = sectionsFor(s, 'bar');
    expect(column(data, 'Position')).toEqual([1]);
    expect(data!.header).not.toContain('Position min');
  });

  it('⚑ a half-dragged bar still has no extent', () => {
    const s = barSession();
    bar(s, 110, 190, 200);
    s.addDataPoint(210, 300); // one corner only
    const [data] = sectionsFor(s, 'bar');
    expect(column(data, 'Position max')[1] ?? '').toBe('');
  });

  it('⚑ a Box Plot gets the coordinate and still no extent', () => {
    // `capturesAsBox` is the type saying its two points are OPPOSITE CORNERS.
    // A box plot's five clicks are five values on ONE category, so the spread
    // between them says nothing about a width - which is why the coordinate
    // crosses over to this type and the extent does not.
    const s = barSession(BOX_PLOT_AXES_CONFIG);
    for (const py of [290, 275, 260, 245, 230]) s.addDataPoint(150, py);
    for (const py of [280, 265, 250, 235, 220]) s.addDataPoint(250, py);
    const [data] = sectionsFor(s, 'boxplot');
    expect(column(data, 'Position')).toEqual([1, 2]);
    expect(data!.header).not.toContain('Position min');
  });
});

describe('the outlier that proves the others right', () => {
  it('⚠️⚑⚑ a category with NO bar anywhere leaves no ink, so the frame under-counts', () => {
    // David's case, written down rather than discovered later. Three categories
    // in the figure, the middle bar absent from the only series: the two bars'
    // centres are 150 and 350, so the measured pitch is 200 and the frame has
    // two bands. The remaining categories COLLAPSE, to 1 and 2.
    //
    // ⚑ And the record stays faithful - see the header for the arithmetic. The
    // bars export as 0.4 of a band against 0.8 on a declared three-category
    // axis, and the two regenerate to the same figure up to scale. Nothing in
    // the image says a third category exists, so nothing here claims one.
    const s = barSession();
    bar(s, 110, 190, 200);
    bar(s, 310, 390, 150);
    const [data] = sectionsFor(s, 'bar');
    expect(column(data, 'Position')).toEqual([1, 2]);
    expect(column(data, 'Position max')[0] as number).toBeCloseTo(1.2, 6);
  });

  it('⚠️⚑⚑ and MARKING the axis is the correction, on the very same clicks', () => {
    // The same two bars, one declaration later: three bands, the second one
    // empty, and the bars are back at Position 1 and 3 with their true width.
    // Nothing was re-clicked - the frame changed, and the frame is the only
    // thing that was ever in question.
    const s = withThreeCategories(barSession());
    bar(s, 110, 190, 200);
    bar(s, 310, 390, 150);
    const [data] = sectionsFor(s, 'bar');
    expect(column(data, 'Position')).toEqual([1, 3]);
    expect(column(data, 'Position max')[0] as number).toBeCloseTo(1.4, 6);
  });
});
