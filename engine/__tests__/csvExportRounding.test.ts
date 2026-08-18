import { describe, expect, it } from 'vitest';
import {
  histogramSection,
  buildHistogramJSON,
  buildTupleSeriesJSON,
  allSeriesSection,
  measurementsSection,
  type SeriesForCSV,
  type ExportRow,
} from '../csvExport.js';
import type { ValueRounder } from '../../core/exportPrecision.js';
import type { HistogramBin } from '../../algorithms/histogram.js';
import type { TupleRow } from '../calibrationSession.js';

/**
 * The exporters that carry a ValueRounder, and the side-by-side series block.
 *
 * ⚑ WHY THIS FILE EXISTS. `csvExport.ts` scored 58.48% - the lowest in
 * `engine/` - and 91 of its 142 unnoticed mutants had NO COVERAGE AT ALL:
 * `histogramSection`, `buildHistogramJSON` and `buildTupleSeriesJSON` were
 * never called by any test, and `allSeriesSection` only through a `as never`
 * cast that pinned neither its ragged rows nor its role columns.
 *
 * These functions are the last thing that touches a number before it leaves
 * the app, so they are tenet 1's actual exit door. What they get wrong is
 * invisible by construction: a bin start read at the VALUE axis's resolution
 * instead of the bin axis's is still a plausible-looking number in a
 * plausible-looking column.
 *
 * The existing suite could not have caught that, because it exports through
 * the identity rounder - under which every dimension mix-up is a no-op. Both
 * instruments below exist to remove that blindness: `dimRounder` gives each
 * dimension a DIFFERENT resolution, and `recordingRounder` captures the exact
 * (coords, dim) each cell asked for.
 */

/** Rounds dim 0 to whole numbers and dim 1 to two decimals - so a cell that
 *  reads the wrong dimension comes out a visibly different number. */
const dimRounder: ValueRounder = {
  at: (coords, dim) => roundDim(coords[dim] as number, dim),
  scalarAt: (value, _coords, dim) => roundDim(value, dim),
};
function roundDim(v: number, dim: number): number {
  return dim === 0 ? Math.round(v) : Math.round(v * 100) / 100;
}

/** Records every rounding request, so the COORDS a cell was read at can be
 *  asserted - not just the number that came back. */
function recordingRounder(): ValueRounder & { calls: { coords: number[]; dim: number; scalar?: number }[] } {
  const calls: { coords: number[]; dim: number; scalar?: number }[] = [];
  return {
    calls,
    at: (coords, dim) => {
      calls.push({ coords: [...coords], dim });
      return coords[dim] as number;
    },
    scalarAt: (value, coords, dim) => {
      calls.push({ coords: [...coords], dim, scalar: value });
      return value;
    },
  };
}

const bin = (binStart: number, binEnd: number, value: number, valueErr?: number): HistogramBin =>
  valueErr === undefined ? { binStart, binEnd, value } : { binStart, binEnd, value, valueErr };

describe('the histogram CSV block', () => {
  it('⚑ reads each edge at the BIN axis and the height at the VALUE axis', () => {
    // Histogram axes is XY: both edges are dimension 0 and the magnitude is
    // dimension 1. Under the identity rounder every swap of those is a no-op,
    // which is exactly why this never showed up before - here dim 0 rounds to
    // whole numbers, so a height read at dim 0 loses its decimals and a bin
    // edge read at dim 1 keeps decimals it should not have.
    const s = histogramSection([bin(1.4, 2.6, 7.25)], dimRounder);
    expect(s.rows).toEqual([[1, 3, 7.25]]);
  });

  it('reads each edge AT ITS OWN position, with the bin value as the reference', () => {
    // The documented contract: "each edge's X-resolution is read at that edge
    // (with the bin's value as the reference Y)". On a rotated or log
    // calibration the resolution genuinely differs between the two edges, so
    // reading both at binStart would round the far edge by the near edge's
    // rule.
    const r = recordingRounder();
    histogramSection([bin(1, 4, 9)], r);
    expect(r.calls).toEqual([
      { coords: [1, 9], dim: 0 }, // bin start, at itself
      { coords: [4, 9], dim: 0 }, // bin end, at ITSELF - not at binStart
      { coords: [1, 9], dim: 1 }, // the height
    ]);
  });

  it('skips a half-placed bin rather than exporting a blank edge', () => {
    // A null bin is one corner short. A blank edge in a numeric column reads
    // as a real zero downstream, which is worse than the row being absent.
    const s = histogramSection([bin(0, 1, 5), null, bin(2, 3, 8)], dimRounder);
    expect(s.rows).toEqual([
      [0, 1, 5],
      [2, 3, 8],
    ]);
  });

  it('exports nothing at all when no bin is complete', () => {
    const s = histogramSection([null, null], dimRounder);
    expect(s.rows).toEqual([]);
    expect(s.header).toEqual(['bin start', 'bin end', 'value']);
  });

  it('stays three columns wide while no bin carries an error', () => {
    // The presence rule: today nothing writes valueErr, so today's files must
    // not grow a column of blanks that a reader mistakes for measured zeros.
    expect(histogramSection([bin(0, 1, 5)], dimRounder).header).toEqual(['bin start', 'bin end', 'value']);
  });

  it('grows the error column as soon as ANY bin carries one, blank on the rest', () => {
    // `some`, not `every`: one bin with an error is enough for the column to
    // be meaningful, and the bins without one get a blank - never a zero,
    // which would assert a measurement of "no error".
    const s = histogramSection([bin(0, 1, 5, 0.125), bin(1, 2, 8)], dimRounder);
    expect(s.header).toEqual(['bin start', 'bin end', 'value', 'value error']);
    expect(s.rows).toEqual([
      [0, 1, 5, 0.13], // the error rounds at the VALUE dimension, like the value
      [1, 2, 8, ''],
    ]);
  });
});

describe('the histogram JSON export', () => {
  it('rounds each field at the same dimension the CSV does', () => {
    // The two exports must not disagree about a number. Same fixture as the
    // CSV case above, and the same three results.
    const doc = JSON.parse(buildHistogramJSON('Counts', [bin(1.4, 2.6, 7.25)], dimRounder));
    expect(doc.series).toEqual([{ name: 'Counts', bins: [{ binStart: 1, binEnd: 3, value: 7.25 }] }]);
  });

  it('omits valueErr entirely rather than nulling it', () => {
    // The schema-wide rule: an absent field means "not measured", and never a
    // value. A `valueErr: null` would be a reader's problem forever.
    const doc = JSON.parse(buildHistogramJSON('Counts', [bin(0, 1, 5)], dimRounder));
    expect(doc.series[0].bins[0]).not.toHaveProperty('valueErr');
    expect(Object.keys(doc.series[0].bins[0])).toEqual(['binStart', 'binEnd', 'value']);
  });

  it('includes valueErr, rounded at the value dimension, when a bin has one', () => {
    const doc = JSON.parse(buildHistogramJSON('Counts', [bin(0, 1, 5, 0.125)], dimRounder));
    expect(doc.series[0].bins[0]).toEqual({ binStart: 0, binEnd: 1, value: 5, valueErr: 0.13 });
  });

  it('skips incomplete bins here too', () => {
    const doc = JSON.parse(buildHistogramJSON('Counts', [null, bin(2, 3, 8), null], dimRounder));
    expect(doc.series[0].bins).toHaveLength(1);
  });

  it('carries measurements as their own array, and omits the key when there are none', () => {
    const none = JSON.parse(buildHistogramJSON('Counts', [bin(0, 1, 5)], dimRounder));
    expect(none).not.toHaveProperty('measurements');

    const some = JSON.parse(
      buildHistogramJSON('Counts', [bin(0, 1, 5)], dimRounder, [{ tool: 'Distance', value: 3.5, unit: 'mm' }])
    );
    expect(some.measurements).toEqual([{ tool: 'Distance', value: 3.5, unit: 'mm' }]);
  });
});

const view = (data: number[] | null) => ({ px: 0, py: 0, data });
const tuple = (tupleIndex: number, label: string, points: (ReturnType<typeof view> | null)[], derived: number | null): TupleRow =>
  ({ tupleIndex, label, points, derived }) as TupleRow;

describe('the tuple JSON export (Pie, Box Plot, Bar)', () => {
  it('keys each slot by its group name and rounds it at dimension 0', () => {
    const doc = JSON.parse(
      buildTupleSeriesJSON(
        [{ name: 'Slices', rows: [tuple(0, 'Flax', [view([12.4]), view([98.6])], null)] }],
        ['start', 'end'],
        dimRounder,
        undefined
      )
    );
    expect(doc.series).toEqual([{ name: 'Slices', tuples: [{ category: 'Flax', start: 12, end: 99 }] }]);
  });

  it('⚑ writes null for a slot not yet placed, never a fabricated 0', () => {
    // The whole-app rule at the export door. A still-open pie boundary read as
    // 0 in a JSON file is a real angle, and nothing downstream can tell.
    const doc = JSON.parse(
      buildTupleSeriesJSON([{ name: 'Slices', rows: [tuple(0, 'Flax', [view([30]), null], null)] }], ['start', 'end'], dimRounder, undefined)
    );
    expect(doc.series[0].tuples[0]).toEqual({ category: 'Flax', start: 30, end: null });
  });

  it('writes null for a placed pixel that has no data, e.g. before calibration', () => {
    const doc = JSON.parse(
      buildTupleSeriesJSON([{ name: 'Slices', rows: [tuple(0, 'Flax', [view(null)], null)] }], ['start'], dimRounder, undefined)
    );
    expect(doc.series[0].tuples[0].start).toBeNull();
  });

  it('⚑ emits the DERIVED value exactly as given, never re-rounded', () => {
    // The file's own flagged rule. `derivedTupleValue.compute` has already
    // applied the right precision; the axis-resolution rounder would need a
    // working dataToPixel, which pie does not have. This rounder mangles
    // anything it touches - so an untouched 42.375 proves it was not touched.
    const doc = JSON.parse(
      buildTupleSeriesJSON([{ name: 'Slices', rows: [tuple(0, 'Flax', [view([30])], 42.375)] }], ['start'], dimRounder, 'value')
    );
    expect(doc.series[0].tuples[0].value).toBe(42.375);
  });

  it('adds no derived key when the type declares no label', () => {
    const doc = JSON.parse(
      buildTupleSeriesJSON([{ name: 'Slices', rows: [tuple(0, 'Flax', [view([30])], 42)] }], ['start'], dimRounder, undefined)
    );
    expect(doc.series[0].tuples[0]).not.toHaveProperty('value');
  });

  it('omits the derived key for a tuple that has no value, rather than nulling it', () => {
    // An incomplete tuple has no derived value to state; the label is declared
    // for the series, so the key must be absent on THAT row alone.
    const doc = JSON.parse(
      buildTupleSeriesJSON([{ name: 'Slices', rows: [tuple(0, 'Flax', [view([30])], 42), tuple(1, 'Hemp', [view([60])], null)] }], ['start'], dimRounder, 'value')
    );
    expect(doc.series[0].tuples[0].value).toBe(42);
    expect(doc.series[0].tuples[1]).not.toHaveProperty('value');
  });

  it('keeps an unnamed category as an empty string, not as a missing key', () => {
    const doc = JSON.parse(
      buildTupleSeriesJSON([{ name: 'Slices', rows: [tuple(0, '', [view([30])], null)] }], ['start'], dimRounder, undefined)
    );
    expect(doc.series[0].tuples[0].category).toBe('');
  });

  it('carries measurements, and omits the key when there are none', () => {
    const none = JSON.parse(buildTupleSeriesJSON([{ name: 'S', rows: [] }], ['a'], dimRounder, undefined));
    expect(none).not.toHaveProperty('measurements');
    const some = JSON.parse(
      buildTupleSeriesJSON([{ name: 'S', rows: [] }], ['a'], dimRounder, undefined, [{ tool: 'Angle', value: 45, unit: '°' }])
    );
    expect(some.measurements).toEqual([{ tool: 'Angle', value: 45, unit: '°' }]);
  });
});

/** An exported row. Pixel columns are dropped by this section, so the pixel
 *  coordinates are present but arbitrary. */
const row = (values: number[], role?: string): ExportRow => ({ px: 0, py: 0, values, ...(role ? { role } : {}) }) as ExportRow;

const series = (name: string, values: number[][], extra: Partial<SeriesForCSV> = {}): SeriesForCSV => ({
  name,
  rows: values.map((v) => row(v)),
  ...extra,
});

describe('the side-by-side series block', () => {
  it('numbers rows from 1 and puts each series in its own columns', () => {
    const s = allSeriesSection(
      [series('Alpha', [[1, 2], [3, 4]]), series('Beta', [[5, 6]])],
      ['X', 'Y']
    );
    expect(s.header).toEqual(['#', 'Alpha X', 'Alpha Y', 'Beta X', 'Beta Y']);
    expect(s.rows[0]).toEqual([1, 1, 2, 5, 6]);
  });

  it('⚑ pads a SHORTER series with blank cells, keeping the longer one intact', () => {
    // Ragged is the normal case - two traced curves rarely have the same
    // point count. The row count comes from the LONGEST series; taking the
    // first or the shortest silently truncates real data out of the export.
    const s = allSeriesSection(
      [series('Alpha', [[1, 2]]), series('Beta', [[5, 6], [7, 8], [9, 10]])],
      ['X', 'Y']
    );
    expect(s.rows).toEqual([
      [1, 1, 2, 5, 6],
      [2, '', '', 7, 8],
      [3, '', '', 9, 10],
    ]);
  });

  it('emits a header and no rows when every series is empty', () => {
    const s = allSeriesSection([series('Alpha', [])], ['X', 'Y']);
    expect(s.header).toEqual(['#', 'Alpha X', 'Alpha Y']);
    expect(s.rows).toEqual([]);
  });

  it('⚑ gives a role column only to the series that HAS roles', () => {
    // Roles are decided per series: one curve can be interpolation-assisted
    // while its neighbours were placed by hand. A shared column would attach
    // "interpolated" to hand-placed points of the other series.
    const s = allSeriesSection(
      [
        { name: 'Alpha', rows: [row([1, 2], 'interpolated')] },
        series('Beta', [[5, 6]]),
      ],
      ['X', 'Y']
    );
    expect(s.header).toEqual(['#', 'Alpha X', 'Alpha Y', 'Alpha role', 'Beta X', 'Beta Y']);
    expect(s.rows[0]).toEqual([1, 1, 2, 'interpolated', 5, 6]);
  });

  it('leaves the role cell blank on a point without one, inside a series that has some', () => {
    const s = allSeriesSection(
      [{ name: 'Alpha', rows: [row([1, 2], 'interpolated'), row([3, 4])] }],
      ['X', 'Y']
    );
    expect(s.rows[1]).toEqual([2, 3, 4, '']);
  });

  it('blanks the role cell of a padded row too', () => {
    const s = allSeriesSection(
      [
        { name: 'Alpha', rows: [row([1, 2], 'interpolated')] },
        series('Beta', [[5, 6], [7, 8]]),
      ],
      ['X', 'Y']
    );
    expect(s.rows[1]).toEqual([2, '', '', '', 7, 8]);
  });
});

describe('an error series names its role in the column heading', () => {
  it('appends the role, so two series of the same name stay distinguishable', () => {
    const s = allSeriesSection(
      [series('Series 1', [[1, 2]], { relation: { role: 'upper', of: 'Series 1' } })],
      ['X', 'Y']
    );
    expect(s.header).toEqual(['#', 'Series 1 upper X', 'Series 1 upper Y']);
  });

  it('⚑ does NOT append a role the user already typed, avoiding "Upper upper"', () => {
    // The suffix check is case-insensitive on purpose: a user who names the
    // series "Series 1 Upper" has already said it, and repeating it reads as
    // a different series.
    const s = allSeriesSection(
      [series('Series 1 Upper', [[1, 2]], { relation: { role: 'upper', of: 'Series 1' } })],
      ['X', 'Y']
    );
    expect(s.header).toEqual(['#', 'Series 1 Upper X', 'Series 1 Upper Y']);
  });

  it('treats a name that is ONLY the role as already said', () => {
    const s = allSeriesSection([series('Upper', [[1]], { relation: { role: 'upper', of: 'A' } })], ['X']);
    expect(s.header).toEqual(['#', 'Upper X']);
  });

  it('⚑ requires a word BOUNDARY, so "Supper" still gets its role', () => {
    // The check is on " upper" with a leading space, not on "upper" anywhere.
    // Without it a series legitimately called "Supper" loses the role that
    // says what it measures.
    const s = allSeriesSection([series('Supper', [[1]], { relation: { role: 'upper', of: 'A' } })], ['X']);
    expect(s.header).toEqual(['#', 'Supper upper X']);
  });

  it('trims the name before deciding, and uses the trimmed form in the heading', () => {
    const s = allSeriesSection([series('  Series 1  ', [[1]], { relation: { role: 'lower', of: 'A' } })], ['X']);
    expect(s.header).toEqual(['#', 'Series 1 lower X']);
  });

  it('leaves an ordinary series name completely alone', () => {
    // The `!s.relation` early return: it must not even trim, since a name is
    // the user's own text.
    const s = allSeriesSection([series(' Alpha ', [[1]])], ['X']);
    expect(s.header).toEqual(['#', ' Alpha  X']);
  });

  it('names the role column with the same prefix as the value columns', () => {
    const s = allSeriesSection(
      [
        {
          name: 'Series 1',
          rows: [row([1], 'interpolated')],
          relation: { role: 'upper', of: 'Series 1' },
        },
      ],
      ['X']
    );
    expect(s.header).toEqual(['#', 'Series 1 upper X', 'Series 1 upper role']);
  });
});

describe('the measurements block', () => {
  it('keeps the magnitude and its unit in separate columns', () => {
    // The checkpoint-82 contract: a number stays a number, so a reader gets
    // the magnitude without stripping a "°" suffix off a string.
    const s = measurementsSection([
      { tool: 'Angle', value: 45, unit: '°' },
      { tool: 'Distance', value: 3.5, unit: 'mm' },
    ]);
    expect(s.title).toBe('Measurements');
    expect(s.header).toEqual(['tool', 'value', 'unit']);
    expect(s.rows).toEqual([
      ['Angle', 45, '°'],
      ['Distance', 3.5, 'mm'],
    ]);
    expect(typeof s.rows[0]![1]).toBe('number');
  });

  it('is still a titled block when nothing has been measured', () => {
    const s = measurementsSection([]);
    expect(s.title).toBe('Measurements');
    expect(s.rows).toEqual([]);
  });
});

describe('an error-cap series exports its DELTA beside its absolute position', () => {
  // ⚑ BOTH, deliberately. The absolute cap position is what was measured off
  // the pixels, so it stays the record; the delta is what a plotting library
  // takes. Asked what numbers you would need to REDRAW the figure, the answer
  // is x, y, -delta, +delta - matplotlib's `yerr` and Excel want deltas,
  // ggplot's ymin/ymax want the absolutes, and carrying both means neither
  // reader has to do arithmetic on someone else's record.
  const datum = { name: 'Sample A', rows: [{ values: [1, 10] as (number | string)[] }] };
  const upper = {
    name: 'SD upper',
    rows: [{ values: [1, 12] as (number | string)[] }],
    relation: { role: 'upper' as const, of: 'Sample A' },
    deltas: [2],
  };
  const lower = {
    name: 'SD lower',
    rows: [{ values: [1, 7] as (number | string)[] }],
    relation: { role: 'lower' as const, of: 'Sample A' },
    deltas: [-3],
  };

  it('adds a delta column only to the error series, not to the datum', () => {
    const s = allSeriesSection([datum, upper, lower] as never, ['X', 'Y']);
    expect(s.header).toContain('SD upper delta');
    expect(s.header).toContain('SD lower delta');
    expect(s.header).not.toContain('Sample A delta');
  });

  it('keeps the absolute cap position AND the delta, never one instead of the other', () => {
    const s = allSeriesSection([datum, upper, lower] as never, ['X', 'Y']);
    expect(s.header).toContain('SD upper Y'); // the measured position survives
    expect(s.rows[0]).toContain(12); // ...and its value
    expect(s.rows[0]).toContain(2); // ...beside the derived delta
  });

  it('signs by role, so an asymmetric bar reads apart in the file', () => {
    const s = allSeriesSection([datum, upper, lower] as never, ['X', 'Y']);
    expect(s.rows[0]).toContain(2);
    expect(s.rows[0]).toContain(-3);
  });

  it('⚑ spells the header ASCII, not the on-screen Δ', () => {
    // A CSV header lands in other people's parsers; an ASCII one cannot arrive
    // mojibaked. The table on screen is free to use the sign.
    const s = allSeriesSection([upper] as never, ['X', 'Y']);
    expect(s.header.join(' ')).not.toMatch(/Δ/);
    expect(s.header.join(' ')).toMatch(/delta/);
  });

  it('writes BLANK, never 0, for a cap that resolves to no datum', () => {
    // 0 would read as "measured, and equal to the datum".
    const orphan = { ...upper, deltas: [null] };
    const s = allSeriesSection([orphan] as never, ['X', 'Y']);
    expect(s.rows[0]).toContain('');
    expect(s.rows[0]).not.toContain(0);
  });
});
