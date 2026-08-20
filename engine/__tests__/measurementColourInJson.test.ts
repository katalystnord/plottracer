/**
 * ⚑⚑ F22 - THE COLOUR INSTRUMENT'S ONLY READING, DROPPED BY THREE OF FOUR JSON
 * BUILDERS.
 *
 * `rgb` is the single stored reading in the whole measurement model
 * (`engine/projectFile.ts`): every other tool's reading IS its value, and a
 * Colour measurement's value is what the KEY says about a colour, which is null
 * whenever no key is calibrated or the key answers that colour twice. The
 * project file guards it and preserves it. `measurementsSection` exports it, so
 * csv, tsv, latex, matlab, python, r, xlsx and ods all carry `#rrggbb`.
 *
 * ⚠️ On the JSON side only `buildHeatmapJSON` passed the row through. The other
 * three mapped it to `{ tool, value, unit }`, so on every type except heatmap a
 * Colour measurement exported as
 *
 *     {"tool":"colour","value":null,"unit":""}
 *
 * The row survives and everything the instrument measured is gone. That is
 * worse than a missing column: a reader sees a measurement was taken and reads
 * null as "it found nothing".
 *
 * ⚑ FIXED AS ONE READER, not four matching ones - F19's lesson from this same
 * audit, where a comment claiming "every reader comes through this method" was
 * false because the export had its own. Three copies of the same object literal
 * are how one of them got left behind; there is now one `measurementsJson`, and
 * these tests ask each builder because a shared helper is only shared while
 * everyone calls it.
 */
import { describe, it, expect } from 'vitest';
import {
  buildSeriesJSON,
  buildHistogramJSON,
  buildTupleSeriesJSON,
  buildHeatmapJSON,
} from '../csvExport.js';
import { FULL_PRECISION_ROUNDER } from '../../core/exportPrecision.js';
import type { MeasurementCsvRow } from '../csvExport.js';

/** What the Colour tool records on a figure with no calibrated key: a colour,
 * and no value for it. */
const colourMeasure: MeasurementCsvRow[] = [
  { tool: 'colour', value: null, unit: '', colour: '#3366cc' },
];
const distanceMeasure: MeasurementCsvRow[] = [{ tool: 'Distance', value: 3.5, unit: 'mm' }];

const measurementsOf = (json: string) =>
  (JSON.parse(json) as { measurements?: Record<string, unknown>[] }).measurements;

describe('a Colour reading reaches the JSON of every type, not just the heatmap', () => {
  it('⚑⚑ a flat series carries the colour it measured', () => {
    const json = buildSeriesJSON([{ name: 'S', rows: [] }], ['X', 'Y'], colourMeasure);
    expect(measurementsOf(json)![0]).toEqual({
      tool: 'colour',
      value: null,
      unit: '',
      colour: '#3366cc',
    });
  });

  it('⚑⚑ a histogram carries it', () => {
    const json = buildHistogramJSON('S', [], FULL_PRECISION_ROUNDER, colourMeasure);
    expect(measurementsOf(json)![0]!['colour']).toBe('#3366cc');
  });

  it('⚑⚑ a tuple type (Bar, Box Plot, Pie) carries it', () => {
    const json = buildTupleSeriesJSON([{ name: 'S', rows: [] }], ['Min'], FULL_PRECISION_ROUNDER, undefined, colourMeasure);
    expect(measurementsOf(json)![0]!['colour']).toBe('#3366cc');
  });

  it('⚑ the heatmap still carries it, through the same one reader', () => {
    const json = buildHeatmapJSON([], colourMeasure);
    expect(measurementsOf(json)![0]!['colour']).toBe('#3366cc');
  });
});

describe('presence is the signal here too', () => {
  it('⚑ a measurement with no colour grows no colour key, in every builder', () => {
    for (const json of [
      buildSeriesJSON([{ name: 'S', rows: [] }], ['X', 'Y'], distanceMeasure),
      buildHistogramJSON('S', [], FULL_PRECISION_ROUNDER, distanceMeasure),
      buildTupleSeriesJSON([{ name: 'S', rows: [] }], ['Min'], FULL_PRECISION_ROUNDER, undefined, distanceMeasure),
      buildHeatmapJSON([], distanceMeasure),
    ]) {
      expect(measurementsOf(json)![0]).toEqual({ tool: 'Distance', value: 3.5, unit: 'mm' });
    }
  });
});
