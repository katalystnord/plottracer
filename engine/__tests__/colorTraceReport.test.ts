import { describe, it, expect } from 'vitest';
import {
  colorTraceRefusal,
  overBroadNote,
  spiderTraceReport,
  barTraceReport,
  blobTraceReport,
  curveTraceReport,
  type ReportedReading,
  type RefusalInput,
} from '../colorTraceReport.js';

const reading = (
  index: number,
  name: string,
  hasPoint: boolean,
  reason: ReportedReading['reason']
): ReportedReading => ({ index, name, point: hasPoint ? { x: 1, y: 1 } : null, reason });

const refusal = (over: Partial<RefusalInput> = {}) =>
  colorTraceRefusal({ isCalibrated: true, autoExtractKind: 'curve', hasSlots: false, hasImage: true, ...over });

const spider = (readings: ReportedReading[], placed: number, matched = 1000) =>
  spiderTraceReport({ readings, placed, matched, width: 1000, height: 1000 });

describe('what the trace refuses, and in what order', () => {
  it('asks for a calibration first - traced points need a coordinate system', () => {
    expect(refusal({ isCalibrated: false })).toBe('Calibrate the axes first - traced points need a coordinate system.');
  });

  it('outranks the other refusals with the calibration one', () => {
    // Nothing else is worth saying to someone who has not calibrated yet.
    expect(refusal({ isCalibrated: false, hasImage: false, autoExtractKind: 'none' })).toContain('Calibrate the axes first');
  });

  it('refuses a type that declares no auto-extract at all', () => {
    expect(refusal({ autoExtractKind: 'none' })).toBe(
      'Auto-extract adds ordinary points; it does not apply to a Box Plot / Error Bar series.'
    );
  });

  it('⚑ refuses a SLOTTED series on a curve type - the check is the series, not the graph type', () => {
    // Box Plot is reachable as a toggle on a Bar session, so a bar-shaped type
    // can be carrying a slotted series that must not receive ordinary points.
    expect(refusal({ hasSlots: true, autoExtractKind: 'curve' })).toContain('does not apply to a Box Plot');
    expect(refusal({ hasSlots: true, autoExtractKind: undefined })).toContain('does not apply to a Box Plot');
  });

  it('lets the two slot-aware kinds through even with slots', () => {
    // Spider fills one slot per ray; Bar files a box per shape. Both know what
    // a slotted series is, so neither is the case this guard exists for.
    expect(refusal({ hasSlots: true, autoExtractKind: 'along-axes' })).toBeNull();
    expect(refusal({ hasSlots: true, autoExtractKind: 'bounding-box' })).toBeNull();
  });

  it('reports a missing image last, and lets a ready trace through', () => {
    expect(refusal({ hasImage: false })).toBe('No image loaded.');
    expect(refusal()).toBeNull();
  });
});

describe('the over-broad warning', () => {
  it('fires only ABOVE a quarter of the image', () => {
    expect(overBroadNote(250_000, 1000, 1000).warn).toBe('');
    expect(overBroadNote(250_001, 1000, 1000).warn).not.toBe('');
  });

  it('names the likely cause and both remedies', () => {
    const { warn } = overBroadNote(900_000, 1000, 1000);
    expect(warn).toContain('grabbed the grid/axes');
    expect(warn).toContain('lower the tolerance');
    expect(warn).toContain('Grid Removal');
  });

  it('reports the percentage of the whole image, not of the matched region', () => {
    expect(overBroadNote(100, 100, 10).pct).toBeCloseTo(10);
  });
});

describe('the spider report - the refusals ARE the worklist', () => {
  it('leads with how many of how many, agreeing with itself on plurals', () => {
    expect(spider([reading(0, 'A', true, null)], 1)).toContain('Read 1 of 1 axis.');
    expect(spider([reading(0, 'A', true, null), reading(1, 'B', true, null)], 2)).toContain('Read 2 of 2 axes.');
  });

  it('⚑ names an AMBIGUOUS ray and tells the user to place it', () => {
    // Declining rather than picking one is the whole design; a bare count would
    // leave the reader hunting the table for which rows are still empty.
    const out = spider([reading(0, 'Speed', false, 'ambiguous'), reading(1, 'Power', true, null)], 1);
    expect(out).toContain('Speed: the colour crosses that ray more than once');
    expect(out).toContain('place it yourself');
    expect(out).not.toContain('Power:');
  });

  it('⚑ distinguishes CLIPPED from nothing-found, and says what to check', () => {
    // Clipped means the colour was still there when the search stopped - the
    // crossing is past the axis's labelled range, usually because the known
    // point was calibrated on an inner ring. Reporting it as "nothing found"
    // would send the user looking for missing ink that is plainly there.
    const clipped = spider([reading(0, 'Speed', false, 'clipped')], 0);
    expect(clipped).toContain('the colour runs past the end of that axis');
    expect(clipped).toContain("check the axis's known point");
    expect(clipped).not.toContain('Nothing of that colour crosses');

    const none = spider([reading(0, 'Speed', false, 'none-found')], 0);
    expect(none).toBe(
      'Read 0 of 1 axis. Nothing of that colour crosses Speed. 1,000 matching pixels (0.1% of the image).'
    );
  });

  it('falls back to the axis POSITION when the figure never named it', () => {
    expect(spider([reading(0, '', false, 'none-found'), reading(4, '', false, 'none-found')], 0)).toContain(
      'crosses Axis 1, Axis 5'
    );
  });

  it('pluralises each clause independently - both clauses, both ways', () => {
    // ⚑ Ambiguous and clipped each carry their OWN "place it/them yourself",
    // so testing one plural proves nothing about the other.
    expect(spider([reading(0, 'A', false, 'ambiguous'), reading(1, 'B', false, 'ambiguous')], 0)).toContain(
      'place them yourself'
    );
    expect(spider([reading(0, 'A', false, 'ambiguous')], 0)).toContain('place it yourself');
    expect(spider([reading(0, 'A', false, 'clipped'), reading(1, 'B', false, 'clipped')], 0)).toContain(
      'place them yourself'
    );
    expect(spider([reading(0, 'A', false, 'clipped')], 0)).toContain('place it yourself');
  });

  it('⚑ reports rays that were OFFERED but not taken - a filled axis is left alone', () => {
    // `placed` comes from the session, which refuses to overwrite an axis that
    // already has a point. Silently offering 3 and placing 1 would read as a
    // failed trace.
    const readings = [reading(0, 'A', true, null), reading(1, 'B', true, null), reading(2, 'C', true, null)];
    expect(spider(readings, 1)).toContain('2 axes already had a point and were left alone.');
    expect(spider(readings, 2)).toContain('1 axis already had a point and was left alone.');
    expect(spider(readings, 3)).not.toContain('left alone');
  });

  it('says nothing about clauses that do not apply', () => {
    const clean = spider([reading(0, 'A', true, null)], 1);
    expect(clean).not.toContain('yourself');
    expect(clean).not.toContain('Nothing of that colour');
    expect(clean).not.toContain('left alone');
  });

  it('carries the match count and the warning on the end', () => {
    expect(spider([reading(0, 'A', true, null)], 1, 900_000)).toContain('90.0% of the image');
    expect(spider([reading(0, 'A', true, null)], 1, 900_000)).toContain('grabbed the grid/axes');
  });

  it('builds one sentence per applicable clause, in a fixed order', () => {
    const mixed = [
      reading(0, 'A', false, 'ambiguous'),
      reading(1, 'B', false, 'none-found'),
      reading(2, 'C', false, 'clipped'),
      reading(3, 'D', true, null),
    ];
    const out = spider(mixed, 0);
    const order = ['Read 0 of 4 axes.', 'A: the colour crosses', 'Nothing of that colour crosses B.', 'C: the colour runs past', 'already had a point'];
    let cursor = -1;
    for (const fragment of order) {
      const at = out.indexOf(fragment);
      expect(at, fragment).toBeGreaterThan(cursor);
      cursor = at;
    }
  });
});

describe('the bounding-box, blob and curve reports', () => {
  it('names whichever shape the active type actually captures', () => {
    expect(barTraceReport(3, 'bar', 100, 1000, 1000)).toContain('Placed 3 bars (one box per detected bar)');
    expect(barTraceReport(1, 'bin', 100, 1000, 1000)).toContain('Placed 1 bin (one box per detected bin)');
  });

  it('pluralises on the count, including zero', () => {
    expect(barTraceReport(0, 'bar', 100, 1000, 1000)).toContain('Placed 0 bars');
    expect(blobTraceReport(1, 100, 1000, 1000)).toContain('Placed 1 point (one per marker)');
    expect(blobTraceReport(2, 100, 1000, 1000)).toContain('Placed 2 points (one per marker)');
  });

  it('says how many points a curve trace produced', () => {
    expect(curveTraceReport(412, 100, 1000, 1000)).toContain('Traced 412 points');
  });

  it('every report carries the same match tail, warning included', () => {
    for (const out of [
      barTraceReport(1, 'bar', 900_000, 1000, 1000),
      blobTraceReport(1, 900_000, 1000, 1000),
      curveTraceReport(1, 900_000, 1000, 1000),
      spider([reading(0, 'A', true, null)], 1, 900_000),
    ]) {
      expect(out).toContain('matching pixels (90.0% of the image).');
      expect(out).toContain('lower the tolerance');
    }
  });
});
