/**
 * The export assembly -- what a file is made OF.
 *
 * ⚑ Until this file existed the assembly lived inside `Workspace.tsx`'s
 * `exportData`, reachable only by launching a real Electron app. Every question
 * below ("does a fit stay out of the data table?", "does geometry respect the
 * axes type?") cost ~18 minutes to ask. They cost milliseconds here.
 *
 * The blocks are graded by what they can DETECT, not by what they cover: each
 * asserts a value or a structural relationship that a plausible wrong
 * implementation would get wrong.
 */
import { describe, it, expect } from 'vitest';
import { CalibrationSession, XY_AXES_CONFIG, type CalibratedAxes } from '../calibrationSession.js';
import { setCurveFitState, runCurveFit } from '../curveFitPanel.js';
import { setGeometryState } from '../geometryPanel.js';
import { buildExportJson, buildExportSections, type ExportAssemblyInput } from '../exportAssembly.js';
import type { XYAxes } from '../../core/axes/xy.js';
import type { TableSection } from '../tableFormats.js';

// X1=0 @ (100,250), X2=10 @ (400,250) -- x_data = (px-100)/30.
// Y1=0 @ (100,250), Y2=10 @ (100,100) -- y_data = (250-py)/15.
function calibrateStandardXY(session: CalibrationSession<XYAxes>) {
  const steps: Array<[number, number, string]> = [
    [100, 250, '0'],
    [400, 250, '10'],
    [100, 250, '0'],
    [100, 100, '10'],
  ];
  for (const [px, py, value] of steps) {
    session.handleCalibrationClick(px, py);
    session.confirmCalibrationValues([value]);
  }
}

// Pixels on the data-space line y = 2x + 1 at x = 0, 1, 2, 3.
const LINE_PIXELS: Array<[number, number]> = [
  [100, 235],
  [130, 205],
  [160, 175],
  [190, 145],
];

// The record those pixels must produce: the clicked pixel, then the calibrated
// value. Asserting BOTH halves means a broken rounder, a swapped axis and a
// dropped pixel column are each visible.
const LINE_ROWS = [
  [100, 235, 0, 1],
  [130, 205, 1, 3],
  [160, 175, 2, 5],
  [190, 145, 3, 7],
];

function buildSession(): CalibrationSession<XYAxes> {
  const session = new CalibrationSession(XY_AXES_CONFIG);
  calibrateStandardXY(session);
  session.runCalibration();
  for (const [px, py] of LINE_PIXELS) session.addDataPoint(px, py);
  return session;
}

function inputFor(
  session: CalibrationSession<XYAxes>,
  overrides: Partial<ExportAssemblyInput> = {}
): ExportAssemblyInput {
  return {
    session: session as unknown as CalibrationSession<CalibratedAxes>,
    axes: session.getAxes()! as unknown as CalibratedAxes,
    configId: 'xy',
    scope: 'active',
    precision: 'auto',
    measures: [],
    ...overrides,
  };
}

function titles(sections: readonly TableSection[]): (string | undefined)[] {
  return sections.map((s) => s.title);
}

function numericRows(section: TableSection): number[][] {
  return section.rows.map((r) => r.map(Number));
}

describe('the record itself', () => {
  it('writes the clicked pixel AND the calibrated value for a plain XY series', () => {
    const sections = buildExportSections(inputFor(buildSession()));
    expect(numericRows(sections[0]!)).toEqual(LINE_ROWS);
  });

  it('produces JSON carrying the same series', () => {
    const content = buildExportJson(inputFor(buildSession()));
    const parsed = JSON.parse(content);
    expect(JSON.stringify(parsed)).toContain('Series 1');
    // The last point's value survives the JSON path too.
    expect(content).toMatch(/\b7\b/);
  });

  it('scope "all" and scope "active" build DIFFERENT tables', () => {
    const session = buildSession();
    session.addDataset('Series 2');
    session.setActiveDataset(0);
    const active = buildExportSections(inputFor(session, { scope: 'active' }));
    const all = buildExportSections(inputFor(session, { scope: 'all' }));
    // The all-series table heads each column with the series name; the active
    // one does not know there is a second series at all.
    expect(all[0]!.header.join(' ')).toContain('Series 2');
    expect(active[0]!.header.join(' ')).not.toContain('Series 2');
  });
});

describe('derived blocks stay SEPARATE (tenet 9)', () => {
  it('emits a curve fit as its own sections, never mixed into the data table', () => {
    const session = buildSession();
    const fit = runCurveFit(session.getDataset(), session.getAxes()!, { degree: 1, restrict: false });
    if ('error' in fit) throw new Error(fit.error);
    setCurveFitState(session.getDataset(), fit.curveFit);

    const sections = buildExportSections(inputFor(session));
    // Section 0 is still the record, untouched by the fit.
    expect(numericRows(sections[0]!)).toEqual(LINE_ROWS);
    // ...and the fit arrives as ADDITIONAL, titled blocks.
    expect(sections.length).toBeGreaterThan(1);
    expect(titles(sections).join('|').toLowerCase()).toContain('fit');
  });

  it('adds a measurements block only when there are measurements', () => {
    const session = buildSession();
    const without = titles(buildExportSections(inputFor(session)));
    const with_ = titles(
      buildExportSections(
        inputFor(session, { measures: [{ tool: 'distance', value: 4.2, unit: 'px' }] })
      )
    );
    expect(without.join('|')).not.toContain('Measurements');
    expect(with_).toContain('Measurements');
  });

  it('carries the measurement VALUE through, not just the block', () => {
    const sections = buildExportSections(
      inputFor(buildSession(), { measures: [{ tool: 'distance', value: 4.2, unit: 'px' }] })
    );
    const block = sections.find((s) => s.title === 'Measurements')!;
    expect(block.rows[0]).toEqual(['distance', 4.2, 'px']);
  });
});

describe('the geometry gate', () => {
  /**
   * ⚑ THE SUBTLE ONE. Geometry is XY-only, and the gate reads `configId`. A
   * non-XY figure must contribute no geometry block even when a geometry state
   * is sitting on the dataset -- and the only way to tell a working gate from
   * one that never fires is to set that state and check BOTH ways.
   */
  it('emits geometry for an XY figure whose series has it switched on', () => {
    const session = buildSession();
    setGeometryState(session.getDataset(), { closed: false });
    const sections = buildExportSections(inputFor(session, { configId: 'xy' }));
    expect(titles(sections).join('|').toLowerCase()).toContain('geometr');
  });

  it('emits NO geometry when the axes type is not xy, even with the state set', () => {
    const session = buildSession();
    setGeometryState(session.getDataset(), { closed: false });
    const sections = buildExportSections(inputFor(session, { configId: 'polar' }));
    expect(titles(sections).join('|').toLowerCase()).not.toContain('geometr');
  });
});

describe('precision', () => {
  it('"full" and "auto" are not the same file', () => {
    // A pixel deliberately BETWEEN the round data values, so rounding to the
    // figure's own resolution actually changes the digits written.
    const session = new CalibrationSession(XY_AXES_CONFIG);
    calibrateStandardXY(session);
    session.runCalibration();
    session.addDataPoint(117, 231);

    const auto = buildExportSections(inputFor(session, { precision: 'auto' }));
    const full = buildExportSections(inputFor(session, { precision: 'full' }));
    expect(JSON.stringify(full[0]!.rows)).not.toEqual(JSON.stringify(auto[0]!.rows));
  });
});
