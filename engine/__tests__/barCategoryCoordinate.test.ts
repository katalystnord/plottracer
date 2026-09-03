/**
 * ⚑⚑ F21 - A BAR'S CATEGORY IS MEASURED, AND IT NEVER REACHED THE FILE.
 *
 * The v2.3 audit's tenet-11 pass, on the record as `9d9b94f` stood: of the
 * twelve types, **Bar fails both of the tenet's two failure modes and Box Plot
 * fails one**.
 *
 * (b) A COORDINATE DERIVED WHERE IT SHOULD HAVE BEEN MEASURED. `bandIndexAt`
 *     answers which category a bar sits in - the exact mechanism v2.3 gave
 *     Line - and it reached the screen and stopped there. The file carried one
 *     `category` column holding `getTupleLabel`, which is EMPTY unless someone
 *     transcribed the tick labels, and not naming is the documented default.
 *     So a bar chart captured the ordinary way exported rows with a blank
 *     category, in each series' own capture order, with no coordinate anywhere:
 *     a consumer handed two series where series 2 has no bar for the middle
 *     category cannot tell which rows refer to the same category. That is the
 *     defect measured and fixed for Line in `dc9993b`, still open on Bar.
 *
 * (a) A CENTRE WHERE THE GENERATOR NEEDS AN EXTENT. `capturesAsBox` says it
 *     plainly - *"a bar's two points are OPPOSITE corners"* - so the bar's
 *     width along the category axis is MEASURED, in two clicks. The file wrote
 *     neither end of it.
 *
 * ⚑⚑ THE FRAME COMES FROM THE CONSUMER, which is how the heatmap's edges were
 * settled (`shading='flat'` requires n+1 edges and refuses centres). A bar
 * generator takes `bar(x, height, width)` with x in CATEGORY units and width in
 * the same units - matplotlib's default bar is 0.8 of a band. So the extent is
 * exported as a POSITION on the category axis, in the band frame the `Position`
 * column already uses: band k spans k-0.5 to k+0.5, and an ordinary bar comes
 * out as 1.6 to 2.4. Nothing is invented - it is `paramAtPoint` through the same
 * dividers `bandIndexAt` uses, and a bar that is off-centre in its band (a
 * grouped chart, where that offset IS the series) exports off-centre.
 *
 * ⚑ MIRRORS, NOT NEW MECHANISMS. `Position` is Line's own column word; the band
 * frame is `core/bandedAxis.ts`; the identity-first column order is the
 * heatmap's (`column`, `row`, then the label, then the bounds), and David's rule
 * over that section is unconditional: *"Whatever we export (for all types of
 * graphs) needs to be usable as a basis for reconstructing the same graph."*
 *
 * ⚑ PRESENCE IS THE SIGNAL, as everywhere else in this exporter: no column
 * appears where nothing was measured.
 *
 * ⚠️⚑⚑ ONE OF F21's CONCLUSIONS WAS OVERTURNED BY A2 - read
 * `barCategoryFrameDerived.test.ts` beside this file. This header used to end
 * *"a rank over capture order would be the invention this whole finding is
 * about"*, and that sentence was right about capture order and wrong about what
 * follows from it. F21 read "no marked axis" as "nothing measured the frame", so
 * the unmarked case kept a name-list index under the header `Category index`.
 * David, 2026-08-21: *"Everything should work on the principles that are there
 * for the case Bar - Axis marked and it should be reused for the Axis unmarked
 * case."* The bars themselves measure the frame - their centres give the pitch
 * and the dividers - so the coordinate is a Position in both cases and the
 * invention F21 feared is avoided by MEASURING rather than by abstaining.
 * What stays genuinely unmeasurable is narrower: a single bar's pitch, and the
 * existence of a category that has no bar at all.
 */
import { describe, it, expect } from 'vitest';
import { CalibrationSession, BAR_AXES_CONFIG, BOX_PLOT_AXES_CONFIG } from '../calibrationSession.js';
import { buildExportSections, buildExportJson } from '../exportAssembly.js';
import type { ExportAssemblyInput } from '../exportAssembly.js';
import { walkCategoryAxis } from './helpers/categoryWalk.js';

/** Value axis: 0 at py 300, 10 at py 100. */
function barSession(config = BAR_AXES_CONFIG) {
  const s = new CalibrationSession(config);
  s.handleCalibrationClick(100, 300);
  expect(s.confirmCalibrationValues(['0'])).toBe(true);
  s.handleCalibrationClick(100, 100);
  expect(s.confirmCalibrationValues(['10'])).toBe(true);
  walkCategoryAxis(s);
  expect(s.runCalibration()).toBe(true);
  return s;
}

/** The category axis runs x 100..400 with three categories, so the bands are
 * x 100-200, 200-300, 300-400. */
function withThreeCategories<S extends {
  updateCalibPointPixel: (key: string, px: number, py: number) => void;
  setCalibrationValues: (key: string, values: readonly string[]) => boolean;
}>(s: S) {
  // ⚑⚑ THE AXIS IS RE-PLACED THE WAY A USER RE-PLACES IT: the two category
  // handles are dragged, and the count is edited where it was declared. Since
  // v2.3 the category axis IS calibration steps c1/c2, so `markCategoryAxis`
  // moved the geometry while leaving the calibration record pointing at the old
  // ends - a state no gesture can produce.
  s.updateCalibPointPixel('c1', 100, 300);
  s.updateCalibPointPixel('c2', 400, 300);
  expect(s.setCalibrationValues('c2', ['3'])).toBe(true);
  return s;
}

/** A bar filling the middle 80% of a band, the ordinary matplotlib width. */
function bar(s: ReturnType<typeof barSession>, left: number, right: number, topPy: number) {
  s.addDataPoint(left, 300);
  s.addDataPoint(right, topPy);
}

const sectionsFor = (s: ReturnType<typeof barSession>, configId: string, scope: 'active' | 'all' = 'active') =>
  buildExportSections({
    session: s,
    axes: s.getAxes()!,
    configId,
    scope,
    measures: [],
    precision: 'auto',
  } as unknown as ExportAssemblyInput);

const jsonFor = (s: ReturnType<typeof barSession>, configId: string, scope: 'active' | 'all' = 'active') =>
  JSON.parse(
    buildExportJson({
      session: s,
      axes: s.getAxes()!,
      configId,
      scope,
      measures: [],
      precision: 'auto',
    } as unknown as ExportAssemblyInput)
  ) as { series: { name: string; tuples: Record<string, unknown>[] }[] };

describe('a bar carries the category it was measured in', () => {
  it('⚑⚑ the same category reports the same Position in EVERY series', () => {
    const s = withThreeCategories(barSession());
    bar(s, 110, 190, 200); // band 1
    bar(s, 210, 290, 250); // band 2
    bar(s, 310, 390, 150); // band 3
    s.addDataset('Series 2');
    s.setActiveDataset(1);
    bar(s, 110, 190, 220); // band 1
    bar(s, 310, 390, 160); // band 3, with the middle one skipped
    const [first, second] = sectionsFor(s, 'bar', 'all');
    const at = (section: typeof first) =>
      section!.rows.map((r) => r[section!.header.indexOf('Position')]);
    expect(at(first)).toEqual([1, 2, 3]);
    expect(at(second)).toEqual([1, 3]);
  });

  it("⚑⚑ a bar's measured width reaches the file, in the band frame a generator takes", () => {
    // Band 2 spans Position 1.5 to 2.5; this bar fills its middle 80%, which is
    // matplotlib's own default. `bar(x=2, height=5, width=0.8)` regenerates it.
    const s = withThreeCategories(barSession());
    bar(s, 210, 290, 200);
    const [data] = sectionsFor(s, 'bar');
    const at = (name: string) => data!.rows[0]![data!.header.indexOf(name)];
    expect(at('Position min')).toBeCloseTo(1.6, 6);
    expect(at('Position max')).toBeCloseTo(2.4, 6);
    expect(at('Value')).toBeCloseTo(5, 6);
  });

  it('⚑ an off-centre bar exports off-centre, because that offset IS the series', () => {
    // A grouped chart: series 2 sits in the right half of the same band. A
    // record that reported the band alone would stack the two on one x.
    const s = withThreeCategories(barSession());
    bar(s, 210, 250, 200);
    bar(s, 250, 290, 250);
    const [data] = sectionsFor(s, 'bar');
    const at = (row: number, name: string) => data!.rows[row]![data!.header.indexOf(name)];
    expect(at(0, 'Position min')).toBeCloseTo(1.6, 6);
    expect(at(0, 'Position max')).toBeCloseTo(2.0, 6);
    expect(at(1, 'Position min')).toBeCloseTo(2.0, 6);
    expect(at(1, 'Position max')).toBeCloseTo(2.4, 6);
  });

  it('⚑ identity first, then the name, then the numbers - the heatmap cell order', () => {
    const s = withThreeCategories(barSession());
    bar(s, 210, 290, 200);
    const [data] = sectionsFor(s, 'bar');
    expect(data!.header).toEqual([
      'Position',
      'category',
      'Position min',
      'Position max',
      // ⚠️ NO `Min`/`Max` SINCE v2.5. A bar is measured FROM the figure's common
      // origin, so its near corner's reading is not a value on this axis: the
      // origin is written once in the file's `Figure` block, the far corner is
      // `Value`, and BOTH corners' category coordinates are the position span
      // above. Publishing `Min`/`Max` beside those stated one measurement twice,
      // under names implying an interval a Bar does not have - and a per-datum
      // base is how every plotting library encodes a FLOATING bar. See
      // `AxesTypeConfig.measuredFromFigureOrigin`.
      'Value',
    ]);
  });

  it('⚑ the JSON tuples carry the same coordinate, not just the tables', () => {
    const s = withThreeCategories(barSession());
    bar(s, 210, 290, 200);
    const doc = jsonFor(s, 'bar');
    const tuple = doc.series[0]!.tuples[0]!;
    expect(tuple['position']).toBe(2);
    expect(tuple['positionMin']).toBeCloseTo(1.6, 6);
    expect(tuple['positionMax']).toBeCloseTo(2.4, 6);
  });
});

describe('a Box Plot carries its category too', () => {
  it('⚑⚑ the coordinate belongs to the AXIS, so every type that marks one gets it', () => {
    const s = withThreeCategories(barSession(BOX_PLOT_AXES_CONFIG));
    s.addDataPoint(250, 280);
    const [data] = sectionsFor(s, 'boxplot');
    expect(data!.header[0]).toBe('Position');
    expect(data!.rows[0]![0]).toBe(2);
  });

  it('⚑ and no extent columns, because a box has no category-axis extent we measured', () => {
    const s = withThreeCategories(barSession(BOX_PLOT_AXES_CONFIG));
    s.addDataPoint(250, 280);
    const [data] = sectionsFor(s, 'boxplot');
    expect(data!.header).not.toContain('Position min');
  });
});

describe('nothing is invented where nothing was measured', () => {
  // ⚠️⚑⚑ SUPERSEDED BY A2, AND DELIBERATELY SO. F21 concluded that an unmarked
  // bar chart should export a name-list IDENTITY under the header `Category
  // index`, on the reasoning that nothing had measured where the categories sit.
  // David, 2026-08-21: *"Everything should work on the principles that are there
  // for the case Bar - Axis marked and it should be reused for the Axis unmarked
  // case."* The frame IS measurable off the bars - see
  // `barCategoryFrameDerived.test.ts` - so the coordinate is a Position in both
  // cases, and what remains genuinely unmeasured is narrower than F21 thought:
  // one bar's PITCH, and an empty category's existence.
  it('⚑⚑ marking the axis states the count the ink cannot carry', () => {
    // Same figure, same clicks, one more declaration. A2 made the coordinate
    // measured either way, so what marking adds is no longer the Position
    // column - it is that the bands are DECLARED, which is the only way an
    // empty category can be in the record at all.
    const s = withThreeCategories(barSession());
    bar(s, 210, 290, 200);
    const [data] = sectionsFor(s, 'bar');
    expect(data!.header).toContain('Position');
    expect(data!.rows[0]![0]).toBe(2); // band 2, not "the first bar I clicked"
  });

});
