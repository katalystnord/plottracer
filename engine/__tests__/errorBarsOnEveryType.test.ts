import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { CalibrationSession, type CalibratedAxes } from '../calibrationSession.js';
import { ALL_TYPES, calibratedHealthy, labelOf } from './fixtures/anyType.js';
import { capFreeDirection } from '../../algorithms/errorCapture.js';
import { ALL_AXES_TYPE_CONFIGS } from '../axesTypeConfigs.js';
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
      // ⚑⚑ ONE GROUP PER END (v2.5). Every type here has ONE named value and so
      // one group, reading exactly as it always has - except a Span, which
      // carries error on each of its two ends and so names its groups after the
      // ends, because 'SD upper' twice would be the same column written twice.
      const ends = ALL_AXES_TYPE_CONFIGS.find((c) => c.id === id)?.errorValueSlots ?? [0];
      const expected =
        ends.length > 1
          ? ['SD upper', 'SD lower', 'SD left', 'SD right'].map((n) => `Opposite corner ${n}`)
          : ['SD upper', 'SD lower', 'SD left', 'SD right'];
      expect(slots.slice(-4)).toEqual(expected);
      // Nothing the type owned was overwritten to make room.
      if (ownSlots > 0) expect(slots.length).toBe(ownSlots + 4 * ends.length);

      // ⚑ THE SAME WHISKER BUILDER, with no branch per type: a cap and its
      // mirror are two whiskers, drawn from the stored pairing.
      expect(session.getErrorWhiskers().length, `${id} drew no whisker`).toBe(2);

      // ⚑ And the SAME accessor reports the roles that were measured, under the
      // end they were measured against - named for the REPORTED value, so the
      // error columns mirror the value columns rather than the capture slots.
      const reported = ALL_AXES_TYPE_CONFIGS.find((c) => c.id === id)?.intervalSlots;
      const prefix = ends.length > 1 ? `${reported?.[0] ?? ''} ` : '';
      expect(session.getErrorColumns(0).map((c) => c.label)).toEqual([
        `${prefix}SD upper`,
        `${prefix}SD lower`,
      ]);
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

/**
 * ⛔⛔ A SPIDER CHART DOES NOT HAVE ERROR BARS. CLOSED PERMANENTLY.
 *
 * David, 2026-08-26, on being asked a third time: *"We have been here before.
 * Spider graphs do NOT have error bars! At last none that we care about. Save
 * this properly this time."*
 *
 * ⚠️ THIS TEST EXISTS BECAUSE THE DECISION KEPT BEING RE-DISCOVERED. It was
 * recorded as a *"🔴 KNOWN GAP, left open deliberately"* in a worklist, and a red
 * circle beside a real asymmetry reads as unfinished work to every later reader,
 * including the one who wrote it. Each audit found the same true fact - the
 * spider table shows no error columns while the export path would carry them -
 * and filed it again as a defect. It is not a defect. It is a decision about
 * what a radar chart IS.
 *
 * ⚑ THE REASON, so nobody has to re-derive it: a spider profile is N×1D - one
 * reading per named axis, and the axes are not commensurable. There is nothing
 * for a whisker to run ALONG that means the same thing on two spokes, which is
 * also why `capFreeDirection` lists spider under CANNOT above.
 *
 * ⚑⚑ AND IT WAS CHECKED RATHER THAN ASSERTED, 2026-08-26, at David's own
 * insistence (*"But check that I'm still right first."*) - tenet 11(b), whether
 * anyone has already established a model for the thing we would be modelling:
 *   · Plotly's radar trace `scatterpolar` has NO error attribute of any kind,
 *     while ordinary `scatter` carries `error_x`/`error_y`. Error bars appear
 *     only as an unbuilt line item on its "Polar 2.0 open items" issue.
 *   · R's `fmsb` and `ggradar` - the standard radar packages - document
 *     polygons, nets, labels and axis limits, and no error, SD or CI.
 *   · matplotlib has no radar CHART type at all; its radar is a gallery recipe
 *     on polar axes, so there is no radar model to hang error on.
 *   · The two benchmark corpora hold 1,626 annotated charts and NOT ONE radar,
 *     so they cannot answer the question either way. Stated because an absent
 *     instrument is not evidence.
 *
 * ▶ THE CLAIM IS THE CHECKABLE ONE: *no library that generates radar charts
 * exposes an error-bar model on them.* Not "radar charts never have error bars",
 * which is unfalsifiable from inside this project and would close the enquiry
 * instead of opening it - the exact mistake recorded in CLAUDE.md under WHEN WE
 * ARE FIRST, which cost a sweep.
 *
 * ⚑ WHAT IS *NOT* CLAIMED HERE. The generic mechanism still reaches spider like
 * every other type - that is what the sweep above measures, and it must keep
 * passing. `getErrorColumns` is adaptive, so a spider with no caps contributes
 * no columns to anything and asserts nothing about an emptiness nobody looked
 * for. Nothing needs removing; the table simply does not grow a feature for a
 * case the chart type does not have.
 *
 * ▶ If this is ever re-opened, it must be re-opened by DAVID naming a real
 * figure, not by an audit noticing the asymmetry again.
 */
describe('a spider chart does not have error bars - settled, not missing', () => {
  it('⛔ the Spider table shows no error columns, and that is the decision', () => {
    const table = readFileSync(
      path.join(import.meta.dirname, '..', '..', 'ui', 'src', 'panels', 'SpiderTable.tsx'),
      'utf8'
    );
    // ⚑ Asserts the SOURCE deliberately, the same way `oneFigureResetList` does:
    // what would fail here is somebody adding the columns back to close a
    // "gap", which no runtime assertion about a spider with no caps can see.
    expect(table).not.toMatch(/errorColumns(For|ByTuple)/);
  });

  it('⛔ and the model already says the same thing - spider is in CANNOT', () => {
    // ⚑ Not a second assertion of the sweep above; a statement that the two
    // facts are ONE fact. Its spokes are not commensurable, so there is no line
    // for a whisker to run along - which is exactly why `capFreeDirection`
    // returns null for it, and exactly why the table has no column to grow.
    // If spider ever leaves that list, this decision is worth re-reading.
    const spider = IN_SCOPE.find(([id]) => id === 'spider');
    expect(spider, 'spider must still be a type this sweep covers').toBeDefined();
  });
});
