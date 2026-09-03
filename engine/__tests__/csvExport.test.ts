import { describe, expect, it } from 'vitest';
import { buildFlatDataCSV, buildTupleDataCSV, buildSeriesJSON, curveFitSummarySection, fittedCurveSection, geometrySummarySection, geometryTableSection, type ExportRow, type CurveFitExport } from '../csvExport.js';
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
  it('writes one row per tuple with one column per slot', () => {
    const groupNames = ['Min', 'Q1', 'Median', 'Q3', 'Max'];
    const rows: TupleRow[] = [
      {
        tupleIndex: 0,
        position: null, positionFrame: 'index', positionSpan: null, interval: null, cells: [],
        label: 'Sample A', derived: null,
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
    const rows: TupleRow[] = [{ tupleIndex: 0, position: null, positionFrame: 'index', positionSpan: null, interval: null, cells: [], label: 'Bar0', derived: null, points: [{ px: 0, py: 0, data: [1] }, null] }];
    expect(buildTupleDataCSV(groupNames, rows, FULL_PRECISION_ROUNDER)).toBe('category,Min,Q1\nBar0,1,');
  });

  it('quotes a category label containing a comma', () => {
    const groupNames = ['Min'];
    const rows: TupleRow[] = [{ tupleIndex: 0, position: null, positionFrame: 'index', positionSpan: null, interval: null, cells: [], label: 'Sample, batch 2', derived: null, points: [{ px: 0, py: 0, data: [1] }] }];
    expect(buildTupleDataCSV(groupNames, rows, FULL_PRECISION_ROUNDER)).toBe('category,Min\n"Sample, batch 2",1');
  });

  // v2.0 groundwork: TupleRow.derived (a pie sector's proportion, a bar's
  // extent) previously reached the on-screen table only -- never CSV/TSV/etc.
  describe('the derived-value column (v2.0)', () => {
    it('adds no column when no derivedLabel is given -- unchanged from before this fix', () => {
      const groupNames = ['Sector start', 'Sector end'];
      const rows: TupleRow[] = [
        { tupleIndex: 0, position: null, positionFrame: 'index', positionSpan: null, interval: null, cells: [], label: 'Slice A', derived: 42, points: [{ px: 0, py: 0, data: [10] }, { px: 0, py: 0, data: [20] }] },
      ];
      expect(buildTupleDataCSV(groupNames, rows, FULL_PRECISION_ROUNDER)).toBe(
        'category,Sector start,Sector end\nSlice A,10,20'
      );
    });

    it('appends the derived value under its declared label when one is given', () => {
      const groupNames = ['Sector start', 'Sector end'];
      const rows: TupleRow[] = [
        { tupleIndex: 0, position: null, positionFrame: 'index', positionSpan: null, interval: null, cells: [], label: 'Slice A', derived: 42, points: [{ px: 0, py: 0, data: [10] }, { px: 0, py: 0, data: [20] }] },
      ];
      expect(buildTupleDataCSV(groupNames, rows, FULL_PRECISION_ROUNDER, ',', 'Value')).toBe(
        'category,Sector start,Sector end,Value\nSlice A,10,20,42'
      );
    });

    it('leaves the derived cell blank for a tuple with no derived value, not a fabricated 0', () => {
      const groupNames = ['Sector start', 'Sector end'];
      const rows: TupleRow[] = [
        { tupleIndex: 0, position: null, positionFrame: 'index', positionSpan: null, interval: null, cells: [], label: 'Slice A', derived: 42, points: [{ px: 0, py: 0, data: [10] }, { px: 0, py: 0, data: [20] }] },
        { tupleIndex: 1, position: null, positionFrame: 'index', positionSpan: null, interval: null, cells: [], label: 'Slice B', derived: null, points: [{ px: 0, py: 0, data: [20] }, null] },
      ];
      expect(buildTupleDataCSV(groupNames, rows, FULL_PRECISION_ROUNDER, ',', 'Value')).toBe(
        'category,Sector start,Sector end,Value\nSlice A,10,20,42\nSlice B,20,,'
      );
    });

    it('omits the column entirely when a label is declared but every row is null (matches hasRoles-style presence rule)', () => {
      const groupNames = ['Min', 'Q1'];
      const rows: TupleRow[] = [{ tupleIndex: 0, position: null, positionFrame: 'index', positionSpan: null, interval: null, cells: [], label: 'Sample A', derived: null, points: [{ px: 0, py: 0, data: [1] }, null] }];
      expect(buildTupleDataCSV(groupNames, rows, FULL_PRECISION_ROUNDER, ',', 'Value')).toBe('category,Min,Q1\nSample A,1,');
    });
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

  it('carries the deltas beside the absolute cap positions, nulling a row with no cap', () => {
    // Both, deliberately (see SeriesForCSV.deltas): the absolutes are the record,
    // the deltas are what matplotlib's yerr takes. A null says "no cap on this
    // row" - never a 0, which would read as an error bar of zero length.
    const doc = JSON.parse(
      buildSeriesJSON(
        [{ name: 'Upper', rows: [row([0, 2]), row([1, 4])], relation: { role: 'upper', of: 'S' }, deltas: [1, null] }],
        ['X', 'Y']
      )
    );
    expect(doc.series[0].deltas).toEqual([1, null]);
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

  it('carries `degree` in JSON only where it means something', () => {
    // The same v1.5 defect the summary column already guards, in the other
    // format: a Gaussian has no degree, and the number that would ride along is
    // the leftover polynomial spinner value. Three cases, because the rule reads
    // BOTH whether a model is named and which one it is.
    const degreeOf = (f: CurveFitExport) =>
      JSON.parse(buildSeriesJSON([{ name: 'S', rows: [row([0, 1])], fit: f }], ['X', 'Y'])).series[0].fit.degree;
    expect(degreeOf(fit)).toBe(1); // no model named: a polynomial, from before models existed
    expect(degreeOf({ ...fit, model: 'polynomial' })).toBe(1);
    expect(degreeOf({ ...fit, model: 'gaussian', degree: 7 })).toBeUndefined();
  });

  it('omits the fit key entirely for a series with no fit', () => {
    const doc = JSON.parse(buildSeriesJSON([{ name: 'S', rows: [row([1, 2])] }], ['X', 'Y']));
    expect(doc.series[0]).not.toHaveProperty('fit');
  });

  it('the summary section lists the model + goodness-of-fit', () => {
    const csv = renderTable([curveFitSummarySection([fit])], 'csv');
    // `settled` joined the header in v1.5; this fixture is a polynomial, which
    // has nothing to converge, hence n/a.
    expect(csv).toBe('Curve fit\nseries,equation,coefficients,R2,RMS,n,degree,model,settled\nSeries 1,y = 2x + 1,1 2,0.997,0.4,8,1,polynomial,n/a');
  });

  it('the fitted-curve section is its own titled block of sampled points', () => {
    const csv = renderTable([fittedCurveSection(fit, ['X', 'Y'])], 'csv');
    expect(csv).toBe('Fitted curve - Series 1\nX,Y\n0,1\n1,3');
  });

  // ⚑ v1.5: a fit that did NOT settle must not leave the app looking like one
  // that did. Levenberg-Marquardt always returns something, and the screen
  // already refuses to call an unsettled fit an answer -- but the FILE is where
  // that claim outlives the screen, and the person a project is handed off to
  // has nothing but the file to go on (tenet 9).
  const unsettled: CurveFitExport = { ...fit, converged: false };

  it('says in the summary row whether the solver settled', () => {
    const csv = renderTable([curveFitSummarySection([{ ...fit, converged: true }])], 'csv');
    expect(csv.split('\n')[1]).toContain('settled');
    expect(csv.split('\n')[2]).toMatch(/,yes$/);
  });

  it('marks a fit that did NOT settle, in the very row a reader takes the numbers from', () => {
    const csv = renderTable([curveFitSummarySection([unsettled])], 'csv');
    expect(csv.split('\n')[2]).toMatch(/,no$/);
  });

  it('says n/a for a polynomial, which is solved directly and has nothing to converge', () => {
    const csv = renderTable([curveFitSummarySection([fit])], 'csv');
    expect(csv.split('\n')[2]).toMatch(/,n\/a$/);
  });

  it('marks the sampled-curve block too, because that block can be taken on its own', () => {
    const csv = renderTable([fittedCurveSection(unsettled, ['X', 'Y'])], 'csv');
    expect(csv.split('\n')[0]).toBe('Fitted curve - Series 1 (did not settle)');
  });

  // ⚑ Every other test here hands the labels in, so the column names a caller
  // does NOT supply were never exercised. A blank header in an exported table is
  // not cosmetic: the block is designed to be taken on its own, and a nameless
  // column in a file nobody has the app open beside is a column of numbers
  // meaning nothing.
  it('names the sampled columns x and y when the caller supplies no labels', () => {
    expect(fittedCurveSection(fit).header).toEqual(['x', 'y']);
  });

  it('falls back per column, so one supplied label does not blank the other', () => {
    expect(fittedCurveSection(fit, ['Time']).header).toEqual(['Time', 'y']);
  });

  // ⚑ v1.5 audit: `degree` rode into every export including the five nonlinear
  // models, which have no degree -- and because the UI merely UNMOUNTS the Degree
  // control when the model changes, the number exported was the leftover
  // polynomial spinner value. Meanwhile the one thing that identifies the fit --
  // WHICH model produced the equation -- had no column at all, recoverable only
  // by parsing the equation string.
  it('names the model that produced the equation', () => {
    const csv = renderTable([curveFitSummarySection([{ ...fit, model: 'gaussian' }])], 'csv');
    expect(csv.split('\n')[1]).toContain('model');
    expect(csv.split('\n')[2]).toContain('gaussian');
  });

  it('leaves degree BLANK for a model that has no degree, never a stale number', () => {
    // The exact defect: a degree-7 polynomial, then switch to Gaussian and refit.
    const csv = renderTable([curveFitSummarySection([{ ...fit, model: 'gaussian', degree: 7 }])], 'csv');
    // The degree FIELD, not the row: R2 = 0.997 also contains a 7.
    const header = csv.split('\n')[1]!.split(',');
    const row = csv.split('\n')[2]!.split(',');
    expect(row[header.indexOf('degree')]).toBe('');
  });

  it('still reports the degree for a polynomial, where it is the model', () => {
    const csv = renderTable([curveFitSummarySection([{ ...fit, model: 'polynomial', degree: 3 }])], 'csv');
    const header = csv.split('\n')[1]!.split(',');
    const row = csv.split('\n')[2]!.split(',');
    expect(row[header.indexOf('degree')]).toBe('3');
  });

  // ⚑ A flat series has no variation for R² to measure against, so the fit
  // carries none. A blank cell says that; the 1 it used to carry claimed a
  // perfect fit for a model that explained nothing.
  it('leaves the R2 cell BLANK when the series had no variation', () => {
    const { rSquared: _drop, ...noR2 } = fit;
    const csv = renderTable([curveFitSummarySection([noR2 as CurveFitExport])], 'csv');
    const header = csv.split('\n')[1]!.split(',');
    const row = csv.split('\n')[2]!.split(',');
    expect(row[header.indexOf('R2')]).toBe('');
    // RMS is still there: it needs no reference variance and is the honest number.
    expect(row[header.indexOf('RMS')]).toBe('0.4');
  });

  it('omits rSquared from JSON rather than nulling it', () => {
    const { rSquared: _drop, ...noR2 } = fit;
    const doc = JSON.parse(
      buildSeriesJSON([{ name: 'S', rows: [row([0, 1])], fit: noR2 as CurveFitExport }], ['X', 'Y'])
    );
    expect(doc.series[0].fit).not.toHaveProperty('rSquared');
    expect(doc.series[0].fit.rms).toBe(0.4);
  });

  it('carries the flag into JSON, and omits it where it would mean nothing', () => {
    const bad = JSON.parse(buildSeriesJSON([{ name: 'S', rows: [row([0, 1])], fit: unsettled }], ['X', 'Y']));
    expect(bad.series[0].fit.converged).toBe(false);
    // A polynomial has nothing to converge, so the key is ABSENT rather than a
    // `true` that would assert something the solver never tested.
    const poly = JSON.parse(buildSeriesJSON([{ name: 'S', rows: [row([0, 1])], fit }], ['X', 'Y']));
    expect(poly.series[0].fit).not.toHaveProperty('converged');
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
    expect(csv).toBe('Geometry per-point - S\npoint,X,Y,cumulative_length,curvature\n1,0,0,0,0\n2,3,4,5,1.5');
  });

  it('names the per-point x/y columns even when the caller supplies no labels', () => {
    expect(geometryTableSection('S', geom).header).toEqual(['point', 'x', 'y', 'cumulative_length', 'curvature']);
    expect(geometryTableSection('S', geom, ['Time']).header[2]).toBe('y');
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

// v1.3 - the anchor/interpolated role rides out with the data.
//
// The tenet-9 claim the product rests on is that a reader can tell what a human
// put on the figure from what the app invented. That held for the PROJECT FILE
// (roles round-trip) but NOT for exports: a spline sample left byte-identical to
// an assigned anchor, so a CSV handed on to anyone else quietly presented derived
// points as record. These pin the contract David chose (2026-07-25): the stored
// words, blank where the distinction doesn't apply, column only when it's real.
describe('interpolation role in exports (v1.3)', () => {
  const anchored: ExportRow[] = [
    { px: 100, py: 200, values: [1, 10], role: 'anchor' },
    { px: 110, py: 190, values: [2, 20], role: 'interpolated' },
    { px: 120, py: 180, values: [3, 30], role: 'anchor' },
  ];

  it('adds a role column to a flat export that carries roles', () => {
    expect(buildFlatDataCSV(anchored, ['X', 'Y'])).toBe(
      'x_px,y_px,X,Y,role\n100,200,1,10,anchor\n110,190,2,20,interpolated\n120,180,3,30,anchor'
    );
  });

  it('leaves an ordinary series byte-identical - no role column at all', () => {
    // The column's PRESENCE is the signal. A plain trace must not grow an empty
    // column, or every existing consumer's parser shifts for nothing.
    const plain: ExportRow[] = [{ px: 100, py: 200, values: [1, 10] }];
    expect(buildFlatDataCSV(plain, ['X', 'Y'])).toBe('x_px,y_px,X,Y\n100,200,1,10');
  });

  it('blanks the role of an ordinary point inside a role-carrying series', () => {
    // A hand-placed point in an interpolation series has no role -- we state the
    // fact the record holds and invent nothing for the points it doesn't cover.
    const mixed: ExportRow[] = [
      { px: 100, py: 200, values: [1, 10], role: 'anchor' },
      { px: 105, py: 195, values: [4, 40] },
    ];
    expect(buildFlatDataCSV(mixed, ['X', 'Y'])).toBe('x_px,y_px,X,Y,role\n100,200,1,10,anchor\n105,195,4,40,');
  });

  it('attaches role to a JSON point only where it applies', () => {
    const doc = JSON.parse(
      buildSeriesJSON(
        [
          { name: 'Guided', rows: anchored },
          { name: 'Traced', rows: [{ px: 9, py: 9, values: [9, 90] }] },
        ],
        ['X', 'Y']
      )
    );
    expect(doc.series[0].points[0]).toEqual({ X: 1, Y: 10, role: 'anchor' });
    expect(doc.series[0].points[1].role).toBe('interpolated');
    // An ordinary series' points stay exactly as they were -- no null role key.
    expect(doc.series[1].points[0]).toEqual({ X: 9, Y: 90 });
  });
});
