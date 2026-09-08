/**
 * ⚑⚑ WHAT A TYPE CALLS ITS VALUES REACHES THE FILE ONCE, SORTED, AND ROUNDED.
 *
 * v2.5 gave a figure the right to name more than one value per datum
 * (`CalibrationSession.getValueColumns`) so the panel and the file would say the
 * same words. `tupleDataSection`'s own parameter doc states the rule that was
 * meant to follow: *"Given and longer than one, they REPLACE the member and
 * derived columns."*
 *
 * ⚠️ IT REPLACED THE DERIVED COLUMN AND ONE OF THE TWO MEMBER BRANCHES. The
 * interval branch was left standing beside it, so a SPAN - the type the release
 * exists to add - satisfied both and wrote its pair twice. Gate 3: a comment
 * asserting what nothing enforced, three lines above the code that did not.
 *
 * ⚑ AND THE TWO ROUTES ARE NOT INTERCHANGEABLE, which is why the fix is to pick
 * the interval one rather than the newer one. `memberValues` SORTS a complete
 * pair smallest first and puts every reading through the export rounder;
 * `row.cells` is raw `pixelToData` in click order. So the choice decides three
 * things at once - how many columns, in which order, at what precision.
 *
 * These are the CASES, not the functions. Each one failed before the fix.
 */
import { describe, expect, it } from 'vitest';
import {
  CalibrationSession,
  type CalibratedAxes,
  BAR_AXES_CONFIG,
  BOX_PLOT_AXES_CONFIG,
  CANDLESTICK_AXES_CONFIG,
  SPAN_AXES_CONFIG,
} from '../calibrationSession.js';
import { buildExportSections, buildExportJson } from '../exportAssembly.js';
import type { ExportAssemblyInput } from '../exportAssembly.js';
import { walkCategoryAxis } from './helpers/categoryWalk.js';

/** ⚑ AWKWARD ON PURPOSE: 0..7 over 400px gives non-terminating decimals, so a
 *  reading that skips the rounder is visible as float noise rather than hiding
 *  behind a tidy number. A fixture on 0..8 would pass either way. */
function figure(
  config: unknown,
  clicks: readonly (readonly [number, number])[]
): CalibrationSession<CalibratedAxes> {
  const s = new CalibrationSession<CalibratedAxes>(config as never);
  s.handleCalibrationClick(100, 500);
  s.confirmCalibrationValues(['0']);
  s.handleCalibrationClick(100, 100);
  s.confirmCalibrationValues(['7']);
  walkCategoryAxis(s, { from: { x: 100, y: 500 }, to: { x: 400, y: 500 }, count: 3 });
  s.runCalibration();
  for (const [x, y] of clicks) s.addDataPoint(x, y);
  return s;
}

function sectionFor(s: CalibrationSession<CalibratedAxes>, configId: string) {
  const [data] = buildExportSections({
    session: s,
    axes: s.getAxes()!,
    configId,
    scope: 'active',
    measures: [],
    precision: 'auto',
  } as unknown as ExportAssemblyInput);
  return data!;
}

function jsonFor(s: CalibrationSession<CalibratedAxes>, configId: string) {
  return JSON.parse(
    buildExportJson({
      session: s,
      axes: s.getAxes()!,
      configId,
      scope: 'active',
      measures: [],
      precision: 'auto',
    } as unknown as ExportAssemblyInput)
  );
}

/** Every number the file claims, as a string, so "17 digits" is checkable. */
const noisy = (row: readonly unknown[]): unknown[] =>
  row.filter((v) => typeof v === 'number' && String(v).replace('-', '').replace('.', '').length > 12);

describe('a type names its values once, and the file says them that way', () => {
  it('a span names its two ends ONCE, not twice', () => {
    const s = figure(SPAN_AXES_CONFIG, [
      [120, 483],
      [120, 313],
    ]);
    const { header } = sectionFor(s, 'span');
    expect(header.filter((h) => h === 'Min')).toHaveLength(1);
    expect(header.filter((h) => h === 'Max')).toHaveLength(1);
  });

  it('a span reports its ends SMALLEST FIRST, whichever end was clicked first', () => {
    // ⚑ Clicked high end first. The record is an INTERVAL - it has no first and
    // second end, only a smaller and a larger one - so neither format may hand a
    // reader `Min` above `Max`.
    const s = figure(SPAN_AXES_CONFIG, [
      [120, 313],
      [120, 483],
    ]);
    const { header, rows } = sectionFor(s, 'span');
    const at = (name: string) => rows[0]![header.indexOf(name)] as number;
    expect(at('Min')).toBeLessThan(at('Max'));

    const tuple = jsonFor(s, 'span').series[0].tuples[0];
    expect(tuple.Min, JSON.stringify(tuple)).toBeLessThan(tuple.Max);
  });

  it('a box plot’s five values reach the file at the figure’s own precision', () => {
    const s = figure(BOX_PLOT_AXES_CONFIG, [
      [120, 483],
      [120, 441],
      [120, 377],
      [120, 313],
      [120, 259],
    ]);
    const { rows } = sectionFor(s, 'boxplot');
    expect(noisy(rows[0]!), `float noise in the file: ${JSON.stringify(rows[0])}`).toEqual([]);
  });

  it('a candlestick’s four values reach the file at the figure’s own precision', () => {
    const s = figure(CANDLESTICK_AXES_CONFIG, [
      [120, 483],
      [120, 441],
      [120, 313],
      [120, 259],
    ]);
    const { rows } = sectionFor(s, 'candlestick');
    expect(noisy(rows[0]!), `float noise in the file: ${JSON.stringify(rows[0])}`).toEqual([]);
  });

  it('a stacked segment’s Base is rounded like every other measured column', () => {
    // ⚑ `Base` is a REAL READING - the top of the segment below - so it is
    // entitled to exactly the treatment `Value` beside it gets. Unrounded, the
    // pair printed one figure at two precisions in adjacent columns.
    const s = figure(BAR_AXES_CONFIG, [
      [120, 483],
      [120, 313],
      [220, 313],
      [220, 217],
    ]);
    (s.getAxes() as unknown as { setStacked(v: boolean): void }).setStacked(true);
    const { rows } = sectionFor(s, 'bar');
    for (const row of rows) {
      expect(noisy(row), `float noise in the file: ${JSON.stringify(row)}`).toEqual([]);
    }
  });
});
