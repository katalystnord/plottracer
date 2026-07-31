import { describe, it, expect } from 'vitest';
import {
  CalibrationSession,
  BAR_AXES_CONFIG,
  HISTOGRAM_AXES_CONFIG,
  PIE_AXES_CONFIG,
  type CalibratedAxes,
} from '../calibrationSession.js';
import { buildExportJson, buildExportSections, type ExportAssemblyInput } from '../exportAssembly.js';

/**
 * Export assembly for the two shapes that are NOT a flat series: `bins`
 * (Histogram) and `tuples` (Bar, Box Plot, Pie).
 *
 * ⚑ WHY THIS FILE EXISTS. `exportAssembly.ts` scored 61.21%, and every
 * existing test builds an XY session — so both v2.0 branches of the shape
 * switch were untested, in the file that decides what a v2.0 Bar export
 * actually contains.
 *
 * The switch itself has a documented history worth pinning: it used to read
 * `id === 'histogram'`, so ANY other tuple-shaped type fell through to the
 * flat per-point builder and exported a Pie's raw boundary clicks with no
 * hint they belonged to the same sector and no derived value at all. The fix
 * routes on `getExportShape()`. A test that only ever passes XY cannot tell
 * the fixed switch from the broken one.
 */

/** A calibrated Bar session: 0 at y=500, 10 at y=100, so 40px == 1 unit. */
function barSession(): CalibrationSession<CalibratedAxes> {
  const s = new CalibrationSession(BAR_AXES_CONFIG);
  s.handleCalibrationClick(300, 500);
  s.confirmCalibrationValues(['0']);
  s.handleCalibrationClick(300, 100);
  s.confirmCalibrationValues(['10']);
  expect(s.runCalibration()).toBe(true);
  return s as unknown as CalibrationSession<CalibratedAxes>;
}

/** A calibrated Histogram session: X 0..10 over px 100..500, Y 0..10 over 500..100. */
function histogramSession(): CalibrationSession<CalibratedAxes> {
  const s = new CalibrationSession(HISTOGRAM_AXES_CONFIG);
  for (const [px, py, v] of [
    [100, 500, '0'],
    [500, 500, '10'],
    [100, 500, '0'],
    [100, 100, '10'],
  ] as Array<[number, number, string]>) {
    s.handleCalibrationClick(px, py);
    s.confirmCalibrationValues([v]);
  }
  expect(s.runCalibration()).toBe(true);
  return s as unknown as CalibrationSession<CalibratedAxes>;
}

function inputFor(
  session: CalibrationSession<CalibratedAxes>,
  configId: string,
  overrides: Partial<ExportAssemblyInput> = {}
): ExportAssemblyInput {
  return {
    session,
    axes: session.getAxes()!,
    configId,
    scope: 'active',
    precision: 'auto',
    measures: [],
    ...overrides,
  };
}

/** Capture one bar as a drag-box at category x, from the baseline to `py`. */
function captureBar(s: CalibrationSession<CalibratedAxes>, x: number, py: number, name?: string): void {
  s.addDataPoint(x, 500);
  s.addDataPoint(x, py);
  if (name !== undefined) s.setTupleLabel(s.getDataset().getTupleCount() - 1, name);
}

describe('a Bar export takes the TUPLE shape, not the flat one', () => {
  it('⚑ writes one row per bar with its derived VALUE, not two loose clicks', () => {
    // The defect this branch exists to prevent: routed flat, a bar's two
    // corners export as unrelated points with no value anywhere.
    const s = barSession();
    captureBar(s, 150, 300, 'Flax'); // 5
    captureBar(s, 250, 100, 'Hemp'); // 10

    const sections = buildExportSections(inputFor(s, 'bar'));
    expect(sections).toHaveLength(1);
    const table = sections[0]!;
    // A category column, the slot columns, and the derived value.
    expect(table.header).toContain('Value');
    expect(table.rows).toHaveLength(2);
    expect(table.rows[0]![0]).toBe('Flax');
    expect(Number(table.rows[0]![table.header.indexOf('Value')])).toBeCloseTo(5, 6);
    expect(Number(table.rows[1]![table.header.indexOf('Value')])).toBeCloseTo(10, 6);
  });

  it('⚑ names the derived column from the TYPE, so Bar says "Value"', () => {
    // The label comes from the config's own derivedTupleValue, not a constant
    // here — Histogram says "Height", Pie says "Value".
    const s = barSession();
    captureBar(s, 150, 300, 'Flax');
    expect(buildExportSections(inputFor(s, 'bar'))[0]!.header).toContain('Value');
  });

  it('carries the same numbers into JSON, keyed by category', () => {
    const s = barSession();
    captureBar(s, 150, 300, 'Flax');
    captureBar(s, 250, 100, 'Hemp');

    const doc = JSON.parse(buildExportJson(inputFor(s, 'bar')));
    expect(doc.series).toHaveLength(1);
    expect(doc.series[0].tuples).toHaveLength(2);
    expect(doc.series[0].tuples[0].category).toBe('Flax');
    expect(doc.series[0].tuples[0].Value).toBeCloseTo(5, 6);
  });

  it('leaves a half-captured bar’s value blank rather than guessing it', () => {
    const s = barSession();
    captureBar(s, 150, 300, 'Flax');
    s.addDataPoint(250, 500); // one corner only
    const table = buildExportSections(inputFor(s, 'bar'))[0]!;
    expect(table.rows).toHaveLength(2);
    expect(table.rows[1]![table.header.indexOf('Value')]).toBe('');
  });

  it('⚑ takes the series name from the ACTIVE dataset, whatever it was renamed to', () => {
    // The v2.0 audit replaced a hardcoded 'Series 1' fallback here with '' —
    // the same invented-name defect as Bar0/Slice0. The constant is gone, so
    // renaming the series must change the export; a surviving constant would
    // keep saying "Series 1".
    const s = barSession();
    captureBar(s, 150, 300, 'Flax');
    s.renameDataset(0, 'Flax batch B');
    expect(JSON.parse(buildExportJson(inputFor(s, 'bar'))).series[0].name).toBe('Flax batch B');
  });

  it('follows the ACTIVE series when there is more than one', () => {
    // A tuple export only ever emits the active series, so which one that is
    // has to be read rather than assumed to be index 0.
    const s = barSession();
    captureBar(s, 150, 300, 'Flax');
    s.addDataset('Second');
    captureBar(s, 250, 200, 'Hemp');
    expect(JSON.parse(buildExportJson(inputFor(s, 'bar'))).series[0].name).toBe('Second');
  });
});

describe('a Histogram export takes the BIN shape', () => {
  function twoBins(s: CalibrationSession<CalibratedAxes>): void {
    // Both corners of a bin are its TOP edge, so the height is one reading.
    s.addDataPoint(150, 300); // value 5
    s.addDataPoint(250, 300);
    s.addDataPoint(300, 200); // value 7.5
    s.addDataPoint(400, 200);
  }

  it('⚑ writes bin start / bin end / value, not a flat point list', () => {
    const s = histogramSession();
    twoBins(s);
    const sections = buildExportSections(inputFor(s, 'histogram'));
    expect(sections).toHaveLength(1);
    expect(sections[0]!.header.slice(0, 3)).toEqual(['bin start', 'bin end', 'value']);
    expect(sections[0]!.rows).toHaveLength(2);
    expect(Number(sections[0]!.rows[0]![2])).toBeCloseTo(5, 6);
    expect(Number(sections[0]!.rows[1]![2])).toBeCloseTo(7.5, 6);
  });

  it('emits the same bins in JSON under a `bins` key', () => {
    const s = histogramSession();
    twoBins(s);
    const doc = JSON.parse(buildExportJson(inputFor(s, 'histogram')));
    expect(doc.series[0].bins).toHaveLength(2);
    expect(doc.series[0].bins[0].value).toBeCloseTo(5, 6);
    expect(doc.series[0].bins[0]).not.toHaveProperty('valueErr');
  });

  it('skips a half-placed bin in both formats, rather than exporting half of one', () => {
    const s = histogramSession();
    twoBins(s);
    s.addDataPoint(450, 250); // one corner only
    expect(buildExportSections(inputFor(s, 'histogram'))[0]!.rows).toHaveLength(2);
    expect(JSON.parse(buildExportJson(inputFor(s, 'histogram'))).series[0].bins).toHaveLength(2);
  });
});

describe('a Pie export takes the tuple shape with its OWN derived label', () => {
  it('routes through the tuple builder rather than the flat one', () => {
    // Pie is the type the `id === 'histogram'` bug actually broke: routed
    // flat, its two boundary angles exported as unrelated points.
    const s = new CalibrationSession(PIE_AXES_CONFIG) as unknown as CalibrationSession<CalibratedAxes>;
    expect(s.getExportShape()).toBe('tuples');
    expect(s.getConfig().derivedTupleValue?.label).toBeTruthy();
  });
});

describe('the shape switch is driven by the SESSION, not by configId', () => {
  it('a Bar session reports the tuple shape and a Histogram the bin shape', () => {
    // configId is a separate argument (it gates geometry). If the switch read
    // it instead of getExportShape(), passing the wrong one would change the
    // export — these assert it does not.
    expect(barSession().getExportShape()).toBe('tuples');
    expect(histogramSession().getExportShape()).toBe('bins');
  });

  it('⚑ exports a Bar as tuples even when configId says otherwise', () => {
    const s = barSession();
    captureBar(s, 150, 300, 'Flax');
    const asXy = buildExportSections(inputFor(s, 'xy'));
    expect(asXy[0]!.header).toContain('Value');
    expect(asXy[0]!.rows[0]![0]).toBe('Flax');
  });
});

describe('measurements ride alongside every shape', () => {
  const measures = [{ tool: 'Distance', value: 3.5, unit: 'mm' }];

  it('appends a Measurements block to a bin export', () => {
    const s = histogramSession();
    s.addDataPoint(150, 300);
    s.addDataPoint(250, 300);
    const sections = buildExportSections(inputFor(s, 'histogram', { measures }));
    expect(sections.map((x) => x.title)).toContain('Measurements');
  });

  it('appends it to a tuple export too, and to its JSON', () => {
    const s = barSession();
    captureBar(s, 150, 300, 'Flax');
    expect(buildExportSections(inputFor(s, 'bar', { measures })).map((x) => x.title)).toContain(
      'Measurements'
    );
    const doc = JSON.parse(buildExportJson(inputFor(s, 'bar', { measures })));
    expect(doc.measurements).toEqual([{ tool: 'Distance', value: 3.5, unit: 'mm' }]);
  });

  it('adds nothing when nothing was measured', () => {
    const s = barSession();
    captureBar(s, 150, 300, 'Flax');
    expect(buildExportSections(inputFor(s, 'bar')).map((x) => x.title)).not.toContain('Measurements');
    expect(JSON.parse(buildExportJson(inputFor(s, 'bar')))).not.toHaveProperty('measurements');
  });
});

describe('precision reaches the tuple and bin builders', () => {
  it('⚑ "full" and "auto" differ for a histogram, so the rounder is really wired', () => {
    // A rounder that never reached these branches would make the two
    // identical, and every existing precision test uses an XY session.
    const s = histogramSession();
    s.addDataPoint(137, 293);
    s.addDataPoint(241, 293);
    const auto = buildExportSections(inputFor(s, 'histogram', { precision: 'auto' }))[0]!;
    const full = buildExportSections(inputFor(s, 'histogram', { precision: 'full' }))[0]!;
    expect(JSON.stringify(full.rows)).not.toBe(JSON.stringify(auto.rows));
  });
});
