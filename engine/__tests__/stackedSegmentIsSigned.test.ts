import { describe, expect, it } from 'vitest';
import { BAR_AXES_CONFIG, CalibrationSession } from '../calibrationSession.js';
import type { BarAxes } from '../../core/axes/bar.js';
import { buildExportSections, buildExportJson } from '../exportAssembly.js';
import type { ExportAssemblyInput } from '../exportAssembly.js';
import { walkCategoryAxis } from './helpers/categoryWalk.js';

/**
 * ⚑⚑ A STACKED SEGMENT HAS A BASE AND A SIGNED CONTRIBUTION (v2.5).
 *
 * David, on a stacked profit-by-state chart whose segments run BOTH ways from
 * zero: *"The AREA of a part of a stacked chart cannot be negative... but its
 * points can definitely sit on a negative scale."* Both true, and they are
 * different facts - the extent is how tall the segment is, and which side of the
 * origin the figure drew it on says whether that is a contribution or a loss.
 *
 * ⚠️ TWO THINGS WERE WRONG, and the second was mine from the same morning:
 *   · the value was `Math.abs(...)` under a comment asserting *"a contribution
 *     to a stack is never negative"* - so a loss reported as a gain of the same
 *     size, and `barmode='stack'` handed that number draws it upward;
 *   · and `measuredFromFigureOrigin` dropped the segment's near end from the
 *     file, on the grounds that it sits on the figure's origin. It does not: a
 *     stacked segment stands on the TOP OF THE SEGMENT BELOW IT. A stack traced
 *     one series at a time - *"trace just the bottom segment of each bar"*, which
 *     is what the examples ask for - could not recover it.
 *
 * ▶ `bar(x, height, bottom)` names both, which is why the columns are `Base` and
 * `Value` rather than two corners in click order.
 */
function stackedFigure() {
  const s = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
  s.setOption('isStacked', 'true');
  s.handleCalibrationClick(300, 500);
  s.confirmCalibrationValues(['0']);
  s.handleCalibrationClick(300, 100);
  s.confirmCalibrationValues(['10']);
  walkCategoryAxis(s, { count: 2 });
  expect(s.runCalibration()).toBe(true);
  s.addDataPoint(150, 380); // a segment standing on 3, reaching 5: a GAIN of 2
  s.addDataPoint(190, 300);
  s.addDataPoint(350, 500); // one standing on 0 and reaching -2: a LOSS of 2
  s.addDataPoint(390, 580);
  return s;
}

const inputFor = (s: CalibrationSession<BarAxes>) =>
  ({ session: s, axes: s.getAxes()!, configId: 'bar', scope: 'active', measures: [], precision: 'auto' } as unknown as ExportAssemblyInput);

describe('a stacked segment drawn below the origin', () => {
  it('⚑⚑ reports a LOSS, not a gain of the same size', () => {
    const table = stackedFigure().getBarCategoryTable();
    expect(table.valueColumns).toEqual(['Base', 'Value']);
    expect(table.columns[0]!.cells[0]![1]).toBeCloseTo(2, 6); // upward: +2
    expect(table.columns[0]!.cells[1]![1]).toBeCloseTo(-2, 6); // downward: -2
  });

  it('⚑ and the EXTENT is still a magnitude - the sign is a separate fact', () => {
    // The two segments are the same height. Only the side of the origin differs.
    const cells = stackedFigure().getBarCategoryTable().columns[0]!.cells;
    expect(Math.abs(cells[0]![1]!)).toBeCloseTo(Math.abs(cells[1]![1]!), 6);
  });

  it('⚑⚑ and keeps its BASE, which a partly traced stack cannot recover', () => {
    const cells = stackedFigure().getBarCategoryTable().columns[0]!.cells;
    expect(cells[0]![0]).toBeCloseTo(3, 6); // stands on the segment below
    expect(cells[1]![0]).toBeCloseTo(0, 6); // stands on the origin
  });

  it('an UNSTACKED bar still reports one value, and no base', () => {
    // ⚑ The difference is a fact about the FIGURE, not about the type: an
    // ordinary bar's near end IS the origin, which is published once.
    const s = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    s.handleCalibrationClick(300, 500);
    s.confirmCalibrationValues(['0']);
    s.handleCalibrationClick(300, 100);
    s.confirmCalibrationValues(['10']);
    walkCategoryAxis(s, { count: 2 });
    expect(s.runCalibration()).toBe(true);
    s.addDataPoint(150, 500);
    s.addDataPoint(190, 300);
    expect(s.getBarCategoryTable().valueColumns).toEqual(['Value']);
  });
});

describe('and the file says the same words as the panel', () => {
  it('⚑⚑ Base and Value, in both renderings, with the loss signed', () => {
    const s = stackedFigure();
    const [data] = buildExportSections(inputFor(s));
    expect(data!.header).toContain('Base');
    expect(data!.header).toContain('Value');
    // ⚠️ Six columns, six cells. Emitting the derived number in its own place
    // AND again at the end put seven under six, which is the one way a table can
    // be wrong that nobody reads as wrong: every number under the wrong word.
    for (const row of data!.rows) expect(row).toHaveLength(data!.header.length);
    const at = (r: number, name: string) => data!.rows[r]![data!.header.indexOf(name)];
    expect(at(0, 'Base')).toBeCloseTo(3, 6);
    expect(at(0, 'Value')).toBeCloseTo(2, 6);
    expect(at(1, 'Value')).toBeCloseTo(-2, 6);

    const tuples = (JSON.parse(buildExportJson(inputFor(s))) as {
      series: { tuples: Record<string, number>[] }[];
    }).series[0]!.tuples;
    expect(tuples[1]!['Base']).toBeCloseTo(0, 6);
    expect(tuples[1]!['Value']).toBeCloseTo(-2, 6);
  });
});
