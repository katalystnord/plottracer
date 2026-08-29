/**
 * Pressing an error cap does not start a link drag.
 *
 * ⚑⚑ THE DEFECT, reproduced by David on 2026-08-29 and traced by the pre-tag
 * audit. Since v2.3 B4 an error cap is a pixel of its datum's OWN series, and
 * `nearestDatumPixel` was never updated: it returned ALL pixels, caps included.
 * `errorLinkSnap` is that call with a 14px radius, and ImageCanvas tests it
 * BEFORE the landed-on-a-marker bail - so one press on a cap armed a link drag
 * AND Konva's own marker drag. On release both fired, each with its own commit.
 *
 * ▶ That is why ONE UNDO restored only half a damaged row. And because the link
 * path's `roleFromDrag` names the slot from drag DIRECTION, dragging the lower
 * cap inward resolved to 'upper' and wrote the REAL upper cap to the drop point:
 * a measured 113 replaced by 50, with nothing on screen wrong.
 *
 * ⚑ THE FIXTURE IS THE POINT. Both existing tests of this call
 * (`errorCaptureSession.test.ts`) use a series with NO caps, so neither could
 * ever have seen it - [[feedback_fixture_blind_by_construction]], named in
 * advance by CLAUDE.md.
 */
import { describe, expect, it } from 'vitest';
import { CalibrationSession, XY_AXES_CONFIG } from '../calibrationSession.js';
import type { XYAxes } from '../../core/axes/xy.js';
import { errorSlotNames, slotForRole } from '../../algorithms/errorExtent.js';

/** x 0..10 over px 100..300; y 0..10 over py 300..100. */
function session() {
  const s = new CalibrationSession<XYAxes>(XY_AXES_CONFIG);
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
  return s;
}

/** A datum at (200,200) with an upper cap 18px above it - a SHORT whisker, which
 *  is the geometry that made the two gestures overlap on David's row 7. */
function datumWithCap(s: CalibrationSession<XYAxes>) {
  const ds = s.getDatasets()[0]!;
  const datumIndex = ds.addPixel(200, 200);
  const slots = errorSlotNames('SD');
  ds.adoptSlots(slots);
  const capIndex = ds.addPixel(200, 182);
  ds.addToTupleAt(0, slotForRole('upper', slots.length), capIndex);
  return { ds, datumIndex, capIndex };
}

describe('pressing an error cap does not start a link drag', () => {
  it('nearestDatumPixel offers datums only, never a cap', () => {
    const s = session();
    const { capIndex } = datumWithCap(s);

    // Press exactly on the cap. Before the fix this answered with the cap
    // itself, at distance 0, and armed a link drag on top of the marker drag.
    const onCap = s.nearestDatumPixel(0, { x: 200, y: 182 }, 14);
    expect(onCap?.index, 'a cap must not be offered as a datum').not.toBe(capIndex);
    expect(onCap, 'and nothing else is within 14px of it').toBeNull();
  });

  it('⚑ and still finds the datum when the press is on the datum', () => {
    // The companion assertion: a guard that refuses what it should allow is the
    // same defect wearing the other face. The link drag must still start from a
    // datum, which is the gesture the whole error-bar tool is built on.
    const s = session();
    const { datumIndex } = datumWithCap(s);
    const onDatum = s.nearestDatumPixel(0, { x: 200, y: 200 }, 14);
    expect(onDatum?.index).toBe(datumIndex);
  });
});
