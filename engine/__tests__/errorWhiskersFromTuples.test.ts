/**
 * The drawn whisker reads the datum's own record, not a guess.
 *
 * ⚑ `getErrorWhiskers` is the design's own safety argument — *"the rendering is
 * the check on what the storage leaves implicit"* — and checkpoint 85 exists
 * because it and the record had DIVERGED, matching caps by different rules on a
 * rotated calibration, so the glyph could pair a cap to a different datum than
 * the export reported. A check computed differently from the thing it checks is
 * not a check.
 *
 * ⚑⚑ With the pairing STORED (v2.3 B4) the two cannot disagree, because neither
 * of them is matching any more. That is the point: the check stops being a check
 * on an inference and becomes a drawing of a fact.
 */
import { describe, expect, it } from 'vitest';
import { CalibrationSession, XY_AXES_CONFIG } from '../calibrationSession.js';
import { setErrorRelation } from '../errorRelation.js';
import { errorSlotNames, slotForRole } from '../../algorithms/errorExtent.js';

/** x 0..10 over px 100..300; y 0..10 over py 300..100. */
function session() {
  const s = new CalibrationSession(XY_AXES_CONFIG);
  for (const [px, py, v] of [
    [100, 300, '0'],
    [300, 300, '10'],
    [100, 300, '0'],
    [100, 100, '10'],
  ] as Array<[number, number, string]>) {
    expect(s.handleCalibrationClick(px, py)).toBe('awaiting-value');
    expect(s.confirmCalibrationValues([v])).toBe(true);
  }
  expect(s.runCalibration()).toBe(true);
  s.renameDataset(0, 'Sample');
  return s;
}

/** Place datums, then attach caps to named tuples — the B4 storage shape. */
function withTupleCaps(
  s: ReturnType<typeof session>,
  datums: Array<{ x: number; y: number }>,
  caps: Array<{ tuple: number; role: 'upper' | 'lower'; x: number; y: number }>
) {
  const ds = s.getDatasets()[0]!;
  for (const d of datums) ds.addPixel(d.x, d.y);
  const slots = errorSlotNames('SD');
  ds.adoptSlots(slots); // AFTER the datums, BEFORE the caps — order matters
  for (const c of caps) {
    ds.addToTupleAt(c.tuple, slotForRole(c.role, slots.length), ds.addPixel(c.x, c.y));
  }
  return ds;
}

/** Every point each drawn whisker touches. A `GlyphSegment` is `{from, to}` —
 * the spine runs datum→cap and the second segment is the cap's perpendicular
 * tick. */
function whiskerSpans(s: ReturnType<typeof session>) {
  return s.getErrorWhiskers().map((segments) => segments.flatMap((seg) => [seg.from, seg.to]));
}

describe('a whisker is drawn from the datum the record names', () => {
  it('a tuple-recorded cap draws one whisker', () => {
    const s = session();
    withTupleCaps(s, [{ x: 200, y: 200 }], [{ tuple: 0, role: 'upper', x: 200, y: 160 }]);
    expect(s.getErrorWhiskers(), 'one cap, one whisker').toHaveLength(1);
  });

  it('⚑⚑ two datums whose caps share an x each draw to their OWN datum', () => {
    // The mis-pairing, at the RENDERING. Under nearest-x both caps resolve to
    // datum A, so the figure showed two whiskers hanging off one point while the
    // other sat bare — the picture agreeing with the wrong record rather than
    // catching it.
    const s = session();
    withTupleCaps(
      s,
      [
        { x: 180, y: 220 }, // A
        { x: 260, y: 160 }, // B
      ],
      [
        { tuple: 0, role: 'upper', x: 182, y: 190 }, // A's cap
        { tuple: 1, role: 'upper', x: 181, y: 130 }, // B's cap, dragged near A's x
      ]
    );
    const spans = whiskerSpans(s);
    expect(spans).toHaveLength(2);
    // Each whisker must touch its own datum's y, not the other's.
    const ys = spans.map((pts) => pts.map((p) => p.y));
    expect(ys.some((yy) => yy.some((y) => Math.abs(y - 220) < 1)), 'one whisker starts at A').toBe(true);
    expect(ys.some((yy) => yy.some((y) => Math.abs(y - 160) < 1)), 'one whisker starts at B').toBe(true);
  });

  it('a datum with no cap draws no whisker', () => {
    const s = session();
    withTupleCaps(s, [{ x: 200, y: 200 }, { x: 240, y: 180 }], [{ tuple: 0, role: 'upper', x: 200, y: 160 }]);
    expect(s.getErrorWhiskers(), 'only the one that has a cap').toHaveLength(1);
  });

  it('both roles on one datum draw two whiskers', () => {
    const s = session();
    withTupleCaps(
      s,
      [{ x: 200, y: 200 }],
      [
        { tuple: 0, role: 'upper', x: 200, y: 160 },
        { tuple: 0, role: 'lower', x: 200, y: 240 },
      ]
    );
    expect(s.getErrorWhiskers()).toHaveLength(2);
  });

  it('a series with error slots but no caps draws nothing', () => {
    const s = session();
    withTupleCaps(s, [{ x: 200, y: 200 }], []);
    expect(s.getErrorWhiskers()).toHaveLength(0);
  });
});

describe('the imported shape still draws — no regression', () => {
  it('caps in a related series are still whiskered', () => {
    // A WPD file, or any of ours written before B4. The old path stays because
    // an import genuinely arrives this way (tenet 6).
    const s = session();
    s.addDataPoint(200, 200);
    const capIndex = s.addDataset('SD upper');
    setErrorRelation(s.getDatasets()[capIndex]!, { role: 'upper', of: 'Sample' });
    s.setActiveDataset(capIndex);
    s.addDataPoint(200, 160);
    s.setActiveDataset(0);
    expect(s.getErrorWhiskers()).toHaveLength(1);
  });
});
