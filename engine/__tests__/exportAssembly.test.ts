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

/** `Object.hasOwn` in a repo that compiles to ES2020. Asking whether the KEY is
 * there, not whether reading it gives undefined - which is the whole question
 * for `rSquared` and `converged`, where an absent field means "does not apply". */
const hasKey = (obj: object, key: string): boolean => Object.prototype.hasOwnProperty.call(obj, key);

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

/**
 * The fit block INSIDE the file, not merely the fact that a block appeared.
 *
 * ⚑ Two of its keys are ABSENT on purpose, and absence is the whole meaning:
 * `rSquared` is undefined for a flat series (v1.5.1 - R² divides by zero when
 * every y is the mean, and the old code answered 1, which is not a rounding
 * error but an invented number), and `converged` does not apply to a polynomial,
 * which is solved directly and has nothing to settle. A test that only checks
 * the values that ARE written cannot tell "omitted" from "written as null".
 */
describe('the curve fit block that reaches the file', () => {
  const fitOf = (session: CalibrationSession<XYAxes>, overrides: Partial<ExportAssemblyInput> = {}) =>
    JSON.parse(buildExportJson(inputFor(session, overrides))).series[0].fit as Record<string, unknown>;

  function fitted(session: CalibrationSession<XYAxes>, model?: 'exponential') {
    const result = runCurveFit(session.getDataset(), session.getAxes()!, {
      degree: 1,
      restrict: false,
      ...(model ? { model } : {}),
    });
    if ('error' in result) throw new Error(result.error);
    setCurveFitState(session.getDataset(), result.curveFit);
  }

  it('carries R² for a series that has one', () => {
    const session = buildSession();
    fitted(session);
    // The points are exactly collinear, so a straight-line fit is exact.
    expect(fitOf(session).rSquared).toBeCloseTo(1, 6);
  });

  it('OMITS R² for a flat series rather than claiming 1', () => {
    // Every y identical: SStot is exactly 0, so R² has no value at all. The key
    // must be missing, not null and not 1 - a reader that finds a number there
    // reads it as a goodness this fit never had.
    const session = new CalibrationSession(XY_AXES_CONFIG);
    calibrateStandardXY(session);
    session.runCalibration();
    for (const px of [100, 130, 160, 190]) session.addDataPoint(px, 235);
    fitted(session);

    const fit = fitOf(session);
    expect(hasKey(fit, 'rSquared')).toBe(false);
    // ...and RMS, which IS defined here, still arrives - the honest headline.
    expect(fit.rms).toBeCloseTo(0, 6);
  });

  it('omits `converged` for a polynomial, which has nothing to settle', () => {
    const session = buildSession();
    fitted(session);
    expect(hasKey(fitOf(session), 'converged')).toBe(false);
  });

  it('carries `converged` for a solver-fitted model, and that model’s own name', () => {
    // ⚑ The red warning on the card has to ride into the file: a nonlinear fit
    // that ran out of iterations must never be read as a result.
    const session = buildSession();
    fitted(session, 'exponential');
    const fit = fitOf(session);
    expect(hasKey(fit, 'converged')).toBe(true);
    expect(typeof fit.converged).toBe('boolean');
    expect(fit.model).toBe('exponential');
  });

  it('samples the fitted curve as real x/y points', () => {
    const session = buildSession();
    fitted(session);
    const samples = fitOf(session).samples as Array<{ x: number; y: number }>;
    expect(samples.length).toBeGreaterThan(1);
    for (const p of samples) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
    // A sampled straight line still satisfies the line it was fitted to.
    const last = samples[samples.length - 1]!;
    expect(last.y).toBeCloseTo(2 * last.x + 1, 6);
  });
});

describe('export scope decides WHICH series reach the file', () => {
  function twoSeries(): CalibrationSession<XYAxes> {
    const session = buildSession();
    session.addDataset('Series 2');
    session.setActiveDataset(1);
    session.addDataPoint(220, 115); // (4, 9) - still on y = 2x + 1
    session.addDataPoint(250, 85); // (5, 11), so this series can carry a fit too
    return session;
  }

  it('scope "active" writes only the active series - the second one, here', () => {
    const parsed = JSON.parse(buildExportJson(inputFor(twoSeries(), { scope: 'active' })));
    expect(parsed.series.map((s: { name: string }) => s.name)).toEqual(['Series 2']);
  });

  it('scope "all" writes every series, in order', () => {
    const parsed = JSON.parse(buildExportJson(inputFor(twoSeries(), { scope: 'all' })));
    expect(parsed.series.map((s: { name: string }) => s.name)).toEqual(['Series 1', 'Series 2']);
  });

  it('names the fit after the series it belongs to, under either scope', () => {
    // ⚑ The blocks are keyed by NAME, so resolving the active series wrongly
    // does not lose the fit - it files it against somebody else's data.
    const session = twoSeries();
    const result = runCurveFit(session.getDataset(), session.getAxes()!, { degree: 1, restrict: false });
    if ('error' in result) throw new Error(result.error);
    setCurveFitState(session.getDataset(), result.curveFit);

    for (const scope of ['active', 'all'] as const) {
      const sections = buildExportSections(inputFor(session, { scope }));
      const summary = sections.find((s) => (s.title ?? '').toLowerCase().includes('fit'));
      expect(summary, `no fit block for scope ${scope}`).toBeDefined();
      expect(JSON.stringify(summary!.rows)).toContain('Series 2');
      expect(JSON.stringify(summary!.rows)).not.toContain('Series 1');
    }
  });

  it('emits one fit block per fitted series and none for the others', () => {
    const session = twoSeries();
    const result = runCurveFit(session.getDataset(), session.getAxes()!, { degree: 1, restrict: false });
    if ('error' in result) throw new Error(result.error);
    setCurveFitState(session.getDataset(), result.curveFit);

    const sections = buildExportSections(inputFor(session, { scope: 'all' }));
    const summary = sections.find((s) => (s.title ?? '').toLowerCase().includes('fit'));
    expect(summary!.rows).toHaveLength(1);
  });
});

/**
 * ⚑ These three blocks had NO mutation coverage at all before they were
 * written: no test reached this module with an error relation set, none looked
 * at geometry in the JSON path (only in the sections), and none exercised a fit
 * saved before nonlinear models existed. Each is a whole feature's worth of
 * export, not an edge of one.
 */
describe('an error series exports as a series carrying its relation', () => {
  function withErrorSeries(): CalibrationSession<XYAxes> {
    const session = buildSession();
    session.addDataset('Upper');
    session.setActiveDataset(1);
    // Caps one data-unit above the first two points of Series 1.
    session.addDataPoint(100, 220);
    session.addDataPoint(130, 190);
    expect(session.setErrorRelation(1, { role: 'upper', of: 'Series 1' })).toBeNull();
    session.setActiveDataset(0);
    return session;
  }

  it('carries the relation into JSON, naming the series it belongs to', () => {
    const parsed = JSON.parse(buildExportJson(inputFor(withErrorSeries(), { scope: 'all' })));
    const upper = parsed.series.find((s: { name: string }) => s.name === 'Upper');
    expect(upper.relation).toEqual({ role: 'upper', of: 'Series 1' });
  });

  it('carries the measured Δ into JSON as well as the table', () => {
    // Both formats, deliberately: the absolute cap position is what was measured
    // off the pixels and stays the record, while the Δ is what a plotting library
    // takes. Until v2.1 the JSON dropped it, leaving a JSON reader to re-derive
    // the cap→datum pairing - the one rule that has shipped wrong twice.
    const parsed = JSON.parse(buildExportJson(inputFor(withErrorSeries(), { scope: 'all' })));
    const upper = parsed.series.find((s: { name: string }) => s.name === 'Upper');
    expect(upper.deltas).toHaveLength(2);
    for (const d of upper.deltas) expect(d).toBeCloseTo(1, 6);
  });

  it('carries the measured Δ as its own column in the table export', () => {
    const sections = buildExportSections(inputFor(withErrorSeries(), { scope: 'all' }));
    const header = sections[0]!.header.map(String);
    const deltaAt = header.indexOf('Upper delta');
    expect(deltaAt, `no delta column in ${header.join(' | ')}`).toBeGreaterThan(-1);
    const column = sections[0]!.rows.map((r) => r[deltaAt]);
    // Two caps were placed, one data-unit above the first two points; the rows
    // past them stay BLANK rather than reporting an error of zero.
    expect(column.slice(0, 2).map(Number)).toEqual([1, 1]);
    expect(column.slice(2)).toEqual(['', '']);
  });

  it('leaves an ordinary series with no relation key at all', () => {
    const parsed = JSON.parse(buildExportJson(inputFor(withErrorSeries(), { scope: 'all' })));
    const plain = parsed.series.find((s: { name: string }) => s.name === 'Series 1');
    expect(hasKey(plain, 'relation')).toBe(false);
    expect(hasKey(plain, 'deltas')).toBe(false);
  });
});

describe('geometry reaches the file under either scope, named for its series', () => {
  it('rides into JSON alongside the points, never mixed into them', () => {
    const session = buildSession();
    setGeometryState(session.getDataset(), { closed: false });
    const parsed = JSON.parse(buildExportJson(inputFor(session, { configId: 'xy' })));
    expect(parsed.series[0].geometry.arcLength).toBeGreaterThan(0);
    // The record is still the record.
    expect(parsed.series[0].points).toHaveLength(LINE_PIXELS.length);
  });

  it('names each series’ geometry block when the scope is "all"', () => {
    const session = buildSession();
    session.addDataset('Series 2');
    session.setActiveDataset(1);
    session.addDataPoint(220, 115);
    session.addDataPoint(250, 85);
    setGeometryState(session.getDatasets()[1]!, { closed: false });

    const sections = buildExportSections(inputFor(session, { scope: 'all', configId: 'xy' }));
    const summary = sections.find((s) => (s.title ?? '').toLowerCase().includes('geometr'));
    expect(summary, 'no geometry block under scope "all"').toBeDefined();
    expect(JSON.stringify(summary!.rows)).toContain('Series 2');
  });

  it('names it for the ACTIVE series when the scope is "active"', () => {
    // ⚑ Blank here is the fabricated-name defect's twin: a geometry block filed
    // against no series at all, in the format every non-JSON export renders
    // through.
    const session = buildSession();
    session.addDataset('Series 2');
    session.setActiveDataset(1);
    session.addDataPoint(220, 115);
    session.addDataPoint(250, 85);
    setGeometryState(session.getDatasets()[1]!, { closed: false });

    const sections = buildExportSections(inputFor(session, { scope: 'active', configId: 'xy' }));
    const summary = sections.find((s) => (s.title ?? '').toLowerCase().includes('geometr'));
    expect(JSON.stringify(summary!.rows)).toContain('Series 2');
  });
});

describe('a fit saved before nonlinear models existed', () => {
  it('reads as a polynomial rather than as a model with no name', () => {
    // Files saved before v1.5 carry no `model` key at all, and the absence means
    // polynomial - the only kind that existed. Exporting an empty name there
    // would describe the fit as nothing in particular.
    const session = buildSession();
    const result = runCurveFit(session.getDataset(), session.getAxes()!, { degree: 1, restrict: false });
    if ('error' in result) throw new Error(result.error);
    const { model: _dropped, ...legacy } = result.curveFit;
    setCurveFitState(session.getDataset(), legacy);

    const parsed = JSON.parse(buildExportJson(inputFor(session)));
    expect(parsed.series[0].fit.model).toBe('polynomial');
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
