import { describe, it, expect } from 'vitest';
import { CalibrationSession, XY_AXES_CONFIG } from '../calibrationSession.js';
import { buildExportSections, buildExportJson } from '../exportAssembly.js';
import type { ExportAssemblyInput } from '../exportAssembly.js';

/**
 * ⚑⚑ ONE READING, ONE PRECISION - a cap and the datum it qualifies (v2.3).
 *
 * THE DEFECT: the export has rounded a datum to about half a pixel in data units
 * since B6, and wrote its error caps RAW. So one measurement of one thing reached
 * one file at two precisions - a value at `4.29` beside its own cap at
 * `6.012269938650307`, which reads as though the cap had been measured with a
 * better instrument. It was measured with the same instrument, off the same
 * figure, in the same click.
 *
 * ⚑ `spreadsheetModel` had already found this and deliberately left the PANEL
 * unrounded so that it would keep agreeing with the file, noting that the file
 * was arguably the defect. It was, and this is where it is fixed: at the
 * accessors both surfaces read, so neither has to know.
 *
 * ⚑ THE CALIBRATION HERE IS DELIBERATELY AWKWARD. A fixture where 200 px is
 * exactly 10 units cannot see this at all: every reading comes out to two
 * decimals whether it was rounded or not. 7 units over 163 px does not.
 */

/** X: 0 at px 100, 10 at px 300. Y: 0 at py 300, 7 at py 137. */
function awkwardSession() {
  const s = new CalibrationSession(XY_AXES_CONFIG);
  for (const [px, py, v] of [
    [100, 300, '0'],
    [300, 300, '10'],
    [100, 300, '0'],
    [100, 137, '7'],
  ] as Array<[number, number, string]>) {
    s.handleCalibrationClick(px, py);
    s.confirmCalibrationValues([v]);
  }
  expect(s.runCalibration()).toBe(true);
  s.renameDataset(0, 'Sample');
  s.addDataPoint(200, 200); // y = 700/163 = 4.294478...
  expect(
    s.captureErrorCap({
      targetIndex: 0,
      datumPixel: { x: 200, y: 200 },
      capPixel: { x: 200, y: 160 }, // y = 980/163 = 6.012269...
      baseName: 'SD',
    })
  ).toBeNull();
  return s;
}

const sectionFor = (s: ReturnType<typeof awkwardSession>, precision: 'auto' | 'full') =>
  buildExportSections({
    session: s,
    axes: s.getAxes()!,
    configId: 'xy',
    scope: 'active',
    measures: [],
    precision,
  } as unknown as ExportAssemblyInput)[0]!;

type Section = ReturnType<typeof sectionFor>;
const cell = (section: Section, name: string) =>
  section.rows[0]![section.header.indexOf(name)];

describe('a cap is reported to the same precision as the reading it qualifies', () => {
  it('⚑⚑ the cap is rounded to the figure\'s own resolution, like the datum beside it', () => {
    const section = sectionFor(awkwardSession(), 'auto');
    // 700/163 and 980/163, both at this pixel's half-pixel resolution.
    expect(cell(section, 'Y')).toBe(4.29);
    expect(cell(section, 'SD upper')).toBe(6.01);
  });

  it('⚑ and so is the DELTA, which is the number a plotting library takes', () => {
    const section = sectionFor(awkwardSession(), 'auto');
    expect(cell(section, 'SD upper delta')).toBe(1.72);
  });

  it('⚑⚑ WITHOUT the rounding the cap carries fifteen digits beside a two-digit datum', () => {
    // The `full` precision mode is what the old behaviour looked like, and it is
    // still available on purpose - what was wrong was getting it unasked.
    const section = sectionFor(awkwardSession(), 'full');
    expect(cell(section, 'SD upper')).toBeCloseTo(980 / 163, 12);
    expect(cell(section, 'SD upper')).not.toBe(6.01);
    // ⚑ And the datum is unrounded there too, so the file is still internally
    // consistent - which is the property this whole test is about.
    expect(cell(section, 'Y')).toBeCloseTo(700 / 163, 12);
  });

  it('⚑ the JSON says the same numbers - a reader who switches format meets one record', () => {
    const doc = JSON.parse(
      buildExportJson({
        session: awkwardSession(),
        axes: awkwardSession().getAxes()!,
        configId: 'xy',
        scope: 'active',
        measures: [],
        precision: 'auto',
      } as unknown as ExportAssemblyInput)
    );
    const point = doc.series[0].points[0];
    expect(point['SD upper']).toBe(6.01);
  });
});
