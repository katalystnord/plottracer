import { describe, expect, it } from 'vitest';
import { CalibrationSession, type CalibratedAxes } from '../calibrationSession.js';
import { ALL_TYPES, calibratedHealthy, labelOf } from './fixtures/anyType.js';
import { capFreeDirection } from '../../algorithms/errorCapture.js';
import { hasErrorSlots } from '../../algorithms/errorExtent.js';

/**
 * ⚑⚑ ERROR BARS ARE NOT AN XY FEATURE, AND THIS IS THE SWEEP THAT SAYS SO
 * (v2.3 re-audit, F44).
 *
 * David, 2026-08-21, asking the question this file answers: *"Bars, in technical
 * cases often have error bars. And we are able to add error bars to bar charts
 * now? And are they reusing the same underlying mechanism and drawing patterns
 * as we have for XY-graphs?"*
 *
 * The answer was yes on all three counts, and nothing was checking it across the
 * board - the claim lived in `ERROR_EXTENT_SLOTS`'s header (*"a bar series
 * ALREADY has tuples, so a fixed role-to-slot table would have written an upper
 * cap straight over 'Bar end'"*) and in `capFreeDirection`'s, one of which had
 * gone STALE and said the opposite of what the code does.
 *
 * ⚑ A SWEEP, not three per-type tests. A thirteenth type joins automatically -
 * the same reason the tenet-11 pin iterates the registry.
 *
 * ⚑ It asserts the MECHANISM is shared, not that a number is right: the four
 * roles are appended to whatever slots the type already owns, the same whisker
 * builder draws them, and the same accessor reports them. Per-type numbers are
 * `errorReachesEveryFormat`'s job.
 */

/** Heatmap has no data points at all - its record is cells read from the image,
 *  so "a cap on a datum" is not a question this type asks. Excluded by its
 *  declared export shape rather than by name, so the exclusion cannot widen. */
const IN_SCOPE = ALL_TYPES.filter(([, config]) => config.exportShape !== 'heatmap');

describe('every graph type records error the same way', () => {
  it('is not vacuous - and it names the one type it drops', () => {
    expect(ALL_TYPES.filter(([, c]) => c.exportShape === 'heatmap').map(([id]) => id)).toEqual([
      'heatmap',
    ]);
    expect(IN_SCOPE.length).toBeGreaterThanOrEqual(11);
  });

  for (const [id, config] of IN_SCOPE) {
    it(`${labelOf(id)}: a cap is captured, stored in the datum's own tuple, and drawn`, () => {
      const session: CalibrationSession<CalibratedAxes> = calibratedHealthy(id, config);
      session.addDataPoint(300, 220);
      const datum = session.getDataPoints()[0];
      expect(datum, 'the fixture must place a datum to hang a cap off').toBeDefined();

      const ownSlots = session.getDataset().getSlotNames().length;
      const refusal = session.captureErrorCap({
        targetIndex: 0,
        datumPixel: { x: datum!.px, y: datum!.py },
        capPixel: { x: datum!.px, y: datum!.py - 25 },
        baseName: 'SD',
      });
      expect(refusal, `${id} refused an error cap: ${refusal}`).toBeNull();

      // ⚑⚑ THE FOUR ROLES ARE APPENDED to whatever slots the type already owns -
      // the whole reason a fixed role-to-slot table was rejected. A Bar keeps
      // 'Bar start'/'Bar end' and takes the roles after them; a Box Plot keeps
      // its five letter values.
      const slots = session.getDataset().getSlotNames();
      expect(hasErrorSlots(slots), `${id}'s slots do not end in the four roles`).toBe(true);
      expect(slots.slice(-4)).toEqual(['SD upper', 'SD lower', 'SD left', 'SD right']);
      // Nothing the type owned was overwritten to make room.
      if (ownSlots > 0) expect(slots.length).toBe(ownSlots + 4);

      // ⚑ THE SAME WHISKER BUILDER, with no branch per type: a cap and its
      // mirror are two whiskers, drawn from the stored pairing.
      expect(session.getErrorWhiskers().length, `${id} drew no whisker`).toBe(2);

      // ⚑ And the SAME accessor reports the roles that were measured.
      expect(session.getErrorColumns(0).map((c) => c.label)).toEqual(['SD upper', 'SD lower']);
    });
  }
});

/**
 * ⚑⚑ THE ONE CONSTRAINT, AND WHICH TYPES CAN HAVE IT.
 *
 * A figure draws an error bar ALIGNED WITH its datum, so pinning the cap to that
 * line records what the figure shows. It needs a working `dataToPixel`, which
 * four types still do not have.
 *
 * ⚠️ `capFreeDirection`'s own header said Bar was among them - written before
 * v2.3's 1-D branch and never updated, so it read as an authoritative "no" to
 * the exact question someone would ask about bar charts. The list is asserted
 * here instead, where it cannot go stale silently.
 */
describe('which types can pin a cap to the value axis', () => {
  /**
   * ⚑ MEASURED, one entry at a time, not assumed. Four of these are the types
   * whose `dataToPixel` is still the upstream stub; spider constrains a reading
   * to its SPOKE at capture time instead, and a pie's datum is an ANGLE with no
   * "value axis" for a cap to run along at all.
   */
  const CANNOT = ['polar', 'ternary', 'map', 'ccr', 'spider', 'pie'];

  for (const [id, config] of IN_SCOPE) {
    it(`${labelOf(id)}: ${CANNOT.includes(id) ? 'cannot say (unconstrained)' : 'pins the cap to its value axis'}`, () => {
      const session: CalibrationSession<CalibratedAxes> = calibratedHealthy(id, config);
      session.addDataPoint(300, 220);
      const datum = session.getDataPoints()[0]!;
      const direction = capFreeDirection(
        session.getAxes()!,
        { x: datum.px, y: datum.py },
        'upper'
      );
      if (CANNOT.includes(id)) {
        // ⚑ Null degrades to UNCONSTRAINED, never to "disabled" - the capture
        // above proves the feature still works on these types.
        expect(direction).toBeNull();
      } else {
        expect(direction, `${id} should be able to say which way its value runs`).not.toBeNull();
        // A unit vector, so the constraint is a real direction and not a stub.
        expect(Math.hypot(direction!.x, direction!.y)).toBeCloseTo(1, 6);
      }
    });
  }
});
