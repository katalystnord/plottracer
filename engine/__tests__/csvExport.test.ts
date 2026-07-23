import { describe, expect, it } from 'vitest';
import { buildFlatDataCSV, buildTupleDataCSV, buildMeasurementsCSV, buildAllSeriesCSV, buildSeriesJSON, curveFitSummarySection, fittedCurveSection, geometrySummarySection, geometryTableSection, type ExportRow, type CurveFitExport } from '../csvExport.js';
import type { GeometryResult } from '../../algorithms/geometry.js';
import { renderTable } from '../tableFormats.js';
import type { TupleRow } from '../calibrationSession.js';
import { FULL_PRECISION_ROUNDER } from '../../core/exportPrecision.js';

describe('buildFlatDataCSV', () => {
  // Checkpoint 76: headers are the AXES' own labels now, not a generated
  // value/value1/value2 list. The old names were a documented simplification
  // ("axis labels aren't tracked anywhere in ui/ yet") that was untrue --
  // getAxesLabels() had always been there with zero callers.
  it('heads the value columns with the axes\' own labels', () => {
    const rows: ExportRow[] = [
      { px: 300, py: 300, values: [5] },
      { px: 300, py: 100, values: [10] },
    ];
    expect(buildFlatDataCSV(rows, ['Y'])).toBe('x_px,y_px,Y\n300,300,5\n300,100,10');
  });

  it('emits one column per label, in the axes\' order (XY)', () => {
    const rows: ExportRow[] = [{ px: 250, py: 175, values: [5, 5] }];
    expect(buildFlatDataCSV(rows, ['X', 'Y'])).toBe('x_px,y_px,X,Y\n250,175,5,5');
  });

  it('carries a Bar row\'s Label through as its first column', () => {
    // The defect this fixes: a Bar CSV was bare numbers with nothing saying
    // which bar produced each.
    const rows: ExportRow[] = [{ px: 150, py: 200, values: ['Control', 50] }];
    expect(buildFlatDataCSV(rows, ['Label', 'Y'])).toBe('x_px,y_px,Label,Y\n150,200,Control,50');
  });

  it('exports a blank cell for an unmeasured value, never a zero', () => {
    const rows: ExportRow[] = [{ px: 1, py: 2, values: [null, null] }];
    expect(buildFlatDataCSV(rows, ['X', 'Y'])).toBe('x_px,y_px,X,Y\n1,2,,');
  });

  it('quotes a label containing the delimiter and doubles embedded quotes', () => {
    // Now genuinely reachable: Bar labels are free text, so a category called
    // "Control, 5mM" is an ordinary input rather than a contrived one.
    const rows: ExportRow[] = [{ px: 1, py: 2, values: ['Control, 5mM', 3] }];
    expect(buildFlatDataCSV(rows, ['Label', 'Y'])).toContain('"Control, 5mM"');
  });
});

describe('buildTupleDataCSV', () => {
  it('writes one row per tuple with one column per point group', () => {
    const groupNames = ['Min', 'Q1', 'Median', 'Q3', 'Max'];
    const rows: TupleRow[] = [
      {
        tupleIndex: 0,
        label: 'Sample A',
        points: [
          { px: 0, py: 0, data: [1] },
          { px: 0, py: 0, data: [2] },
          { px: 0, py: 0, data: [3] },
          { px: 0, py: 0, data: [4] },
          { px: 0, py: 0, data: [5] },
        ],
      },
    ];
    expect(buildTupleDataCSV(groupNames, rows, FULL_PRECISION_ROUNDER)).toBe('category,Min,Q1,Median,Q3,Max\nSample A,1,2,3,4,5');
  });

  it('exports a blank cell for a still-open slot', () => {
    const groupNames = ['Min', 'Q1'];
    const rows: TupleRow[] = [{ tupleIndex: 0, label: 'Bar0', points: [{ px: 0, py: 0, data: [1] }, null] }];
    expect(buildTupleDataCSV(groupNames, rows, FULL_PRECISION_ROUNDER)).toBe('category,Min,Q1\nBar0,1,');
  });

  it('quotes a category label containing a comma', () => {
    const groupNames = ['Min'];
    const rows: TupleRow[] = [{ tupleIndex: 0, label: 'Sample, batch 2', points: [{ px: 0, py: 0, data: [1] }] }];
    expect(buildTupleDataCSV(groupNames, rows, FULL_PRECISION_ROUNDER)).toBe('category,Min\n"Sample, batch 2",1');
  });
});

describe('buildMeasurementsCSV', () => {
  // Checkpoint 82: `value` is a NUMBER and the unit has its own column. These
  // assertions used to read `value: '90°'` -- a glyph inside a value, rounded to
  // 4 sig figs, with no un-rounded copy anywhere. They were pinning the defect.
  it('writes tool/value/unit, with value as a raw number', () => {
    const csv = buildMeasurementsCSV([
      { tool: 'slope', value: 12.4, unit: '' },
      { tool: 'angle', value: 90, unit: '°' },
    ]);
    expect(csv).toBe('tool,value,unit\nslope,12.4,\nangle,90,°');
  });

  it('exports FULL precision, not the card\'s 4 significant figures', () => {
    const csv = buildMeasurementsCSV([{ tool: 'distance', value: 1.23456789, unit: 'mm' }]);
    expect(csv).toContain('1.23456789');
  });
});

describe('buildAllSeriesCSV', () => {
  const row = (values: ExportRow['values']): ExportRow => ({ px: 0, py: 0, values });

  it('lays every series side by side with named value columns and ragged rows', () => {
    const csv = buildAllSeriesCSV(
      [
        { name: 'Control', rows: [row([5, 5]), row([6, 7])] },
        { name: 'Treated', rows: [row([10, 20])] },
      ],
      ['X', 'Y']
    );
    expect(csv).toBe('#,Control X,Control Y,Treated X,Treated Y\n1,5,5,10,20\n2,6,7,,');
  });

  it('quotes series names that contain commas', () => {
    const csv = buildAllSeriesCSV([{ name: 'Sample, A', rows: [row([1])] }], ['Y']);
    expect(csv.split('\n')[0]).toBe('#,"Sample, A Y"');
  });

  it('puts an error series\' role in its column names — CSV is flat, so the name carries the relation', () => {
    // "Disambiguated by name alone, no mode flag" (CLAUDE.md, from Vega-Lite),
    // which is also why the model needs no errorKind field: the user named the
    // series "SD", and the caption's meaning arrives with it.
    const csv = buildAllSeriesCSV(
      [
        { name: 'Sample A', rows: [row([2, 12])] },
        { name: 'SD', rows: [row([2, 15])], relation: { role: 'upper', of: 'Sample A' } },
        { name: 'SD', rows: [row([2, 9])], relation: { role: 'lower', of: 'Sample A' } },
      ],
      ['X', 'Y']
    );
    expect(csv.split('\n')[0]).toBe('#,Sample A X,Sample A Y,SD upper X,SD upper Y,SD lower X,SD lower Y');
  });
});

describe('buildSeriesJSON', () => {
  const row = (values: ExportRow['values']): ExportRow => ({ px: 0, py: 0, values });

  it('emits series with label-keyed points and an optional measurements array', () => {
    const json = buildSeriesJSON(
      [{ name: 'Control', rows: [row([5, 6]), row([7, 8])] }],
      ['X', 'Y'],
      [{ tool: 'slope', value: 12.4, unit: '' }]
    );
    expect(JSON.parse(json)).toEqual({
      series: [{ name: 'Control', points: [{ X: 5, Y: 6 }, { X: 7, Y: 8 }] }],
      measurements: [{ tool: 'slope', value: 12.4, unit: '' }],
    });
  });

  it('carries the relation on an error series, which stays a top-level series', () => {
    // The relational form IS the file (docs/error-bars-design.md). An error
    // series is not a different kind of entry -- it is a series with one more
    // key -- which is what lets a band, a bar, and a plain curve share a shape.
    const json = buildSeriesJSON(
      [
        { name: 'Sample A', rows: [row([2, 12])] },
        { name: 'SD', rows: [row([2, 15])], relation: { role: 'upper', of: 'Sample A' } },
      ],
      ['X', 'Y']
    );
    expect(JSON.parse(json)).toEqual({
      series: [
        { name: 'Sample A', points: [{ X: 2, Y: 12 }] },
        { name: 'SD', points: [{ X: 2, Y: 15 }], relation: { role: 'upper', of: 'Sample A' } },
      ],
    });
  });

  it('omits relation entirely for an ordinary series rather than nulling it', () => {
    const json = buildSeriesJSON([{ name: 'Control', rows: [row([5, 6])] }], ['X', 'Y']);
    expect('relation' in JSON.parse(json).series[0]).toBe(false);
  });

  it('keys a Bar series by its real labels, so JSON says what each bar is', () => {
    const json = buildSeriesJSON([{ name: 'Yield', rows: [row(['Control', 50])] }], ['Label', 'Y']);
    expect(JSON.parse(json).series[0].points).toEqual([{ Label: 'Control', Y: 50 }]);
  });

  it('emits null for an unmeasured value rather than dropping the key', () => {
    // "Not measured" must stay visible and must not read as 0 downstream.
    const json = buildSeriesJSON([{ name: 'S', rows: [row([1, null])] }], ['X', 'Y']);
    expect(JSON.parse(json).series[0].points).toEqual([{ X: 1, Y: null }]);
  });

  it('omits the measurements key when there are none', () => {
    const doc = JSON.parse(buildSeriesJSON([{ name: 'S', rows: [row([1])] }], ['Y']));
    expect(doc).not.toHaveProperty('measurements');
  });
});

describe('TSV delimiter', () => {
  it('buildFlatDataCSV with a tab separator produces a TSV row', () => {
    expect(buildFlatDataCSV([{ px: 1, py: 2, values: [5, 6] }], ['X', 'Y'], '\t')).toBe('x_px\ty_px\tX\tY\n1\t2\t5\t6');
  });
});

describe('curve fit export (v0.8)', () => {
  const row = (values: ExportRow['values']): ExportRow => ({ px: 0, py: 0, values });
  const fit: CurveFitExport = {
    series: 'Series 1',
    degree: 1,
    equation: 'y = 2x + 1',
    coefficients: [1, 2],
    rSquared: 0.997,
    rms: 0.4,
    n: 8,
    samples: [
      { x: 0, y: 1 },
      { x: 1, y: 3 },
    ],
  };

  it('buildSeriesJSON puts the fit under its own key, SEPARATE from points', () => {
    const doc = JSON.parse(buildSeriesJSON([{ name: 'Series 1', rows: [row([0, 1])], fit }], ['X', 'Y']));
    const s = doc.series[0];
    // The raw record is untouched -- no fit fields leaked into the points.
    expect(s.points).toEqual([{ X: 0, Y: 1 }]);
    // The derived fit is its own object, carrying the model AND its samples.
    expect(s.fit.equation).toBe('y = 2x + 1');
    expect(s.fit.coefficients).toEqual([1, 2]);
    expect(s.fit.rSquared).toBe(0.997);
    expect(s.fit.samples).toEqual([{ x: 0, y: 1 }, { x: 1, y: 3 }]);
  });

  it('omits the fit key entirely for a series with no fit', () => {
    const doc = JSON.parse(buildSeriesJSON([{ name: 'S', rows: [row([1, 2])] }], ['X', 'Y']));
    expect(doc.series[0]).not.toHaveProperty('fit');
  });

  it('the summary section lists the model + goodness-of-fit', () => {
    const csv = renderTable([curveFitSummarySection([fit])], 'csv');
    expect(csv).toBe('Curve fit\nseries,equation,coefficients,R2,RMS,n,degree\nSeries 1,y = 2x + 1,1 2,0.997,0.4,8,1');
  });

  it('the fitted-curve section is its own titled block of sampled points', () => {
    const csv = renderTable([fittedCurveSection(fit, ['X', 'Y'])], 'csv');
    expect(csv).toBe('Fitted curve — Series 1\nX,Y\n0,1\n1,3');
  });

  it('data, measurements and fit render as SEPARATED blocks in one document', () => {
    const doc = renderTable(
      [
        { header: ['x_px', 'y_px', 'X', 'Y'], rows: [[0, 0, 0, 1]] },
        curveFitSummarySection([fit]),
        fittedCurveSection(fit, ['X', 'Y']),
      ],
      'csv'
    );
    // Three blocks, blank-line separated; a reader can lift just the data.
    expect(doc.split('\n\n')).toHaveLength(3);
    expect(doc.split('\n\n')[0]).toBe('x_px,y_px,X,Y\n0,0,0,1');
  });

  const geom: GeometryResult = {
    arcLength: 5,
    area: 6,
    areaLabel: 'Area under curve',
    maxCurvature: { value: 1.5, index: 1 },
    perPoint: [
      { x: 0, y: 0, cumulativeLength: 0, curvature: 0 },
      { x: 3, y: 4, cumulativeLength: 5, curvature: 1.5 },
    ],
  };

  it('the Geometry summary section lists the stats with a 1-based max-curvature point', () => {
    const csv = renderTable([geometrySummarySection([{ series: 'S', result: geom }])], 'csv');
    expect(csv).toBe('Geometry\nseries,arc_length,area,area_kind,max_curvature,max_curvature_point\nS,5,6,Area under curve,1.5,2');
  });

  it('the Geometry per-point section is its own titled 1-based block', () => {
    const csv = renderTable([geometryTableSection('S', geom, ['X', 'Y'])], 'csv');
    expect(csv).toBe('Geometry per-point — S\npoint,X,Y,cumulative_length,curvature\n1,0,0,0,0\n2,3,4,5,1.5');
  });

  it('buildSeriesJSON emits geometry as its own key (1-based), omitted when absent', () => {
    const withGeom = JSON.parse(buildSeriesJSON([{ name: 'S', rows: [row([1, 2])], geometry: geom }], ['X', 'Y']));
    expect(withGeom.series[0].geometry.arcLength).toBe(5);
    expect(withGeom.series[0].geometry.maxCurvature.point).toBe(2);
    expect(withGeom.series[0].geometry.perPoint[0].point).toBe(1);
    const without = JSON.parse(buildSeriesJSON([{ name: 'S', rows: [row([1, 2])] }], ['X', 'Y']));
    expect(without.series[0]).not.toHaveProperty('geometry');
  });
});
