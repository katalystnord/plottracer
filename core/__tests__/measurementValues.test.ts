import { describe, expect, it } from 'vitest';
import { measurementValue, slopeDeltas, measurementPixelValue } from '../measurementValues.js';

/**
 * Checkpoint 82 — measurements are numbers again.
 *
 * The defect: the record was a formatted string ("45.0°", "slope 1.234"), and
 * `fmtNum`'s `toPrecision(4)` string was the ONLY copy — the raw double never
 * reached the record, the project file, or the CSV.
 */
describe('measurementValue — raw numbers, unit reported separately', () => {
  it('reports a distance in pixels when there is no scale', () => {
    // Not a failure state: a length in px is a real measurement, and saying so
    // beats inventing a unit.
    expect(measurementValue('distance', [{ x: 0, y: 0 }, { x: 3, y: 4 }])).toEqual({
      fields: ['Distance'],
      values: [5],
      unit: 'px',
    });
  });

  it('scales a distance when a scale exists', () => {
    expect(
      measurementValue('distance', [{ x: 0, y: 0 }, { x: 3, y: 4 }], {
        scale: { unitPerPx: 2, unit: 'mm' },
      })
    ).toEqual({ fields: ['Distance'], values: [10], unit: 'mm' });
  });

  it('keeps FULL precision — the whole point of the checkpoint', () => {
    // The old record stored Number((1.23456789).toPrecision(4)) = 1.235 as a
    // STRING and threw the double away. Nothing here rounds.
    const v = measurementValue('slope', [{ x: 0, y: 0 }, { x: 1, y: 0 }], {
      axes: { pixelToData: (x: number, y: number) => [x, y * 1.23456789] },
    })!;
    expect(v.values[0]).toBe(0); // dy=0 over dx=1
    const v2 = measurementValue('distance', [{ x: 0, y: 0 }, { x: 1.23456789, y: 0 }])!;
    expect(v2.values[0]).toBe(1.23456789);
  });

  it('squares the unit for an area, and uses px² with no scale', () => {
    const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    expect(measurementValue('area', square)).toEqual({ fields: ['Area'], values: [100], unit: 'px²' });
    expect(measurementValue('area', square, { scale: { unitPerPx: 2, unit: 'mm' } })).toEqual({
      fields: ['Area'],
      values: [400], // 100 px² * 2² — the scale squares
      unit: 'mm²',
    });
  });

  it('measures an angle, and is scale-invariant by construction', () => {
    // [arm, vertex, arm] — a right angle.
    const pts = [{ x: 10, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 10 }];
    const v = measurementValue('angle', pts)!;
    expect(v.values[0]).toBeCloseTo(90, 9);
    expect(v.unit).toBe('°');
    // A scale must make no difference at all.
    expect(measurementValue('angle', pts, { scale: { unitPerPx: 7, unit: 'km' } })).toEqual(v);
  });

  it('stays accurate for a near-straight angle, where acos would not', () => {
    const pts = [{ x: 100, y: 0 }, { x: 0, y: 0 }, { x: -100, y: 0.0001 }];
    expect(measurementValue('angle', pts)!.values[0]).toBeCloseTo(180, 3);
  });

  it('measures slope in CHART units, not pixels', () => {
    // y = 2x in data space, via an axes that halves x and doubles y.
    const axes = { pixelToData: (px: number, py: number) => [px / 2, py * 2] };
    const v = measurementValue('slope', [{ x: 0, y: 0 }, { x: 2, y: 2 }], { axes })!;
    // data: (0,0) -> (1,4). slope = 4/1 = 4.
    expect(v.values[0]).toBe(4);
    expect(v.unit).toBe(''); // dimensionless — never the string "∞ (vertical)"
  });

  it('REPORTS a vertical slope as Infinity rather than swallowing it', () => {
    const axes = { pixelToData: (px: number, py: number) => [px, py] };
    const v = measurementValue('slope', [{ x: 5, y: 0 }, { x: 5, y: 10 }], { axes })!;
    expect(v.values[0]).toBe(Infinity);
  });

  it('returns null on incomplete geometry rather than a partial number', () => {
    expect(measurementValue('distance', [{ x: 0, y: 0 }])).toBeNull();
    expect(measurementValue('area', [{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBeNull();
    expect(measurementValue('angle', [{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBeNull();
  });

  it('returns null for a slope with no axes — it is the one in chart units', () => {
    expect(measurementValue('slope', [{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBeNull();
  });
});

describe('Set-scale is retroactive — it falls out of deriving', () => {
  it('re-derives an existing measurement when a scale arrives later', () => {
    // The old behaviour: a distance taken before Set-scale kept its "12.5 px"
    // string forever, and the remedy was to delete and re-measure. Nothing had
    // to be built for this — the value simply is not stored.
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }];
    expect(measurementValue('distance', pts)).toEqual({ fields: ['Distance'], values: [10], unit: 'px' });
    expect(measurementValue('distance', pts, { scale: { unitPerPx: 0.5, unit: 'cm' } })).toEqual({
      fields: ['Distance'],
      values: [5],
      unit: 'cm',
    });
  });
});

describe('slopeDeltas / measurementPixelValue — the card details, also derived', () => {
  it('derives Δx/Δy in chart units', () => {
    const axes = { pixelToData: (px: number, py: number) => [px, py] };
    expect(slopeDeltas([{ x: 1, y: 2 }, { x: 4, y: 8 }], axes)).toEqual({ dx: 3, dy: 6 });
    expect(slopeDeltas([{ x: 1, y: 2 }], axes)).toBeNull();
    expect(slopeDeltas([{ x: 1, y: 2 }, { x: 4, y: 8 }], null)).toBeNull();
  });

  it('reports the pixel magnitude regardless of scale', () => {
    expect(measurementPixelValue('distance', [{ x: 0, y: 0 }, { x: 3, y: 4 }])).toBe(5);
    expect(measurementPixelValue('slope', [{ x: 0, y: 0 }, { x: 3, y: 4 }])).toBeNull();
  });
});
