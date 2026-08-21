import { describe, expect, it } from 'vitest';
import { ALL_TYPES, labelOf, calibratedHealthy } from './fixtures/anyType.js';

/**
 * ⚑⚑ TENET 11, PROMOTED FROM A SWEEP TO A TEST - *does our record supply
 * exactly what a generator requires?*
 *
 * The rule has been project practice since v2.0 and was run by hand across all
 * twelve types on 2026-08-14: eleven correlate, `Line` fails. **A manual sweep
 * would not have noticed a thirteenth type**, which is the same objection that
 * moved the axes-type registry out of `Workspace.tsx` - so the sweep lives here
 * now, iterating `ALL_AXES_TYPE_CONFIGS`.
 *
 * ⚑ THE TENET HAS EXACTLY TWO FAILURE MODES, which is what makes it cheap:
 *   1. a **CENTRE** where the generator needs an **EXTENT** - `shading='flat'`
 *      refuses centres, and unequal cells cannot be recovered from them;
 *   2. a **COORDINATE DERIVED** where it should have been **MEASURED**.
 *
 * This file tests (2), because (2) has an observable form and (1) does not:
 *
 * ▶ **A MEASURED COORDINATE IS A FUNCTION OF ITS OWN PIXEL AND THE CALIBRATION,
 *   AND OF NOTHING ELSE.** So capturing a second datum somewhere else on the
 *   figure cannot change what the first one reads. If it can, the first datum's
 *   coordinate was never measured - it was inferred from its neighbours, and a
 *   library handed the record could not place it.
 *
 * ⚑ Why that phrasing rather than "capture them in a different ORDER". Order
 * was the obvious test and it is the WRONG one: `getExportRows` ranks a
 * categorical line by LEFT-TO-RIGHT pixel order, so capturing right-to-left
 * already comes out right (`exportRows.test.ts` pins exactly that). The defect
 * survives an order test and dies to a neighbour test.
 *
 * ⚑ (1) is left to the per-type record tests, where it is checked by
 * REGENERATION rather than by a property - the heatmap's record was validated
 * by redrawing the hardest published figure from it (max difference 0.0), which
 * is a stronger instrument than anything expressible here.
 */

/**
 * A heatmap's rows do NOT come from the datasets - its cells are read from the
 * image through the grid and supplied by the caller (`ExportAssemblyInput
 * .heatmapCells`), so `getExportRows` answers a question this type does not
 * ask. Excluded by its DECLARED export shape rather than by name, so the
 * exclusion cannot quietly widen.
 */
const suppliesItsOwnRows = ([, config]: (typeof ALL_TYPES)[number]): boolean =>
  config.exportShape !== 'heatmap';

const IN_SCOPE = ALL_TYPES.filter(suppliesItsOwnRows);

/**
 * Types KNOWN to fail this, with the fix already scheduled. A pinned type
 * asserts the OPPOSITE - that the coordinate does still move - so the board
 * stays honest in both directions: red today if a healthy type were to break,
 * and **red on the day the pinned defect is FIXED**, which is what forces the
 * pin to be deleted rather than left to rot.
 *
 * ⚠️ NOT `it.fails`, which was the first attempt. `it.fails` passes when the
 * body throws **for any reason at all**, so a broken fixture would wear the
 * defect's clothes and the pin would go quiet - the same silent-pass shape as
 * A6b's `toBe(undefined)`. Asserting the wrong behaviour explicitly keeps every
 * setup assertion loud.
 *
 * ⚑ `categorical` (Line) with NO CATEGORY AXIS MARKED - its category coordinate
 * is an ORDINAL derived at export time from where the point sits among the
 * others, never measured and never stored. Capture a figure whose second
 * category has no point and every later point silently moves up one: the v2.1
 * fabricated-category defect alive in a second place.
 *
 * ⚠️⚑⚑ AND THAT PIN COULD NOT FIRE (v2.3 re-audit, F33). v2.3 fixed this type by
 * collapsing it onto a banded x axis - but the band is only a coordinate once
 * the user has MARKED the axis, and this fixture never marked one, so the sweep
 * exercised the unmarked fallback and nothing else. The pin therefore asserted a
 * thing that is true forever: an unmarked axis has no measured coordinate BY
 * CONSTRUCTION, so no fix could ever turn this assertion red, and the mechanism
 * whose whole purpose is to fail on the day of the fix had quietly become
 * unfailable. It read as coverage of a scheduled defect while covering nothing.
 *
 * ▶ The rule this file now follows: **a pin has to name a case that a fix would
 * change.** The unmarked fallback is not that case - it is the honest answer to
 * a question nobody asked - so the MARKED case is swept beside every other type
 * below, where it is an ordinary green expectation and not a pin at all.
 */
const KNOWN_DERIVED: Record<string, string> = {
  categorical:
    'with NO category axis marked, x is a rank among the other points - mark the axis and it becomes a measured band (swept separately below)',
};

describe('⚑⚑ tenet 11 - a datum\'s coordinates are MEASURED, not derived from its neighbours', () => {
  it('is not vacuous - and it NAMES the one type it drops', () => {
    // ⚑ Without this, a filter that quietly matched nothing would leave the
    // whole file green while testing no type at all - and a filter that grew to
    // exclude the very type under suspicion would look identical.
    // ⚑ Named, not counted: a second matrix-shaped type would silently join the
    // exclusion under a count, and "how many did we skip" is not a question
    // anybody can act on. This fails with the id in the message instead.
    const excluded = ALL_TYPES.filter((t) => !suppliesItsOwnRows(t)).map(([id]) => id);
    expect(excluded).toEqual(['heatmap']);
    expect(ALL_TYPES.length).toBeGreaterThanOrEqual(12);
  });

  it('every PINNED failure names a type that still exists and is still in scope', () => {
    // A pin keyed on a stale id is a pin that stopped guarding anything while
    // still reading as deliberate.
    for (const id of Object.keys(KNOWN_DERIVED)) {
      expect(IN_SCOPE.map(([i]) => i)).toContain(id);
    }
  });

  for (const [id, config] of IN_SCOPE) {
    const pinned = KNOWN_DERIVED[id];
    const title = pinned
      ? `${labelOf(id)}: ⚠️ another datum elsewhere DOES change this one - ${pinned}`
      : `${labelOf(id)}: another datum elsewhere does not change this one`;

    it(title, () => {
      const session = calibratedHealthy(id, config);

      // The datum under test. Its exported values are read once, before any
      // neighbour exists.
      session.addDataPoint(200, 250);
      const first = session.getExportRows(0);
      expect(first.length, 'the fixture must produce a datum to test').toBe(1);
      const { px, py, values: before } = first[0]!;

      // Two more, elsewhere on the figure -- one to its LEFT, which is the
      // direction a rank is sensitive to, and one to its right.
      session.addDataPoint(150, 350);
      session.addDataPoint(450, 200);

      // ⚑ Found by its STORED pixel, not by the click: a spider constrains a
      // reading to its spoke, so the recorded pixel is the PROJECTION of the
      // click. That is a measurement being placed on its axis, not a coordinate
      // drifting -- and matching on the click would have reported it as one.
      const after = session.getExportRows(0).find((r) => r.px === px && r.py === py);
      expect(after, 'the datum must still be in the record').toBeDefined();

      if (pinned) {
        // ⚑ The pin. When v2.3 gives this type a measured coordinate, its values
        // stop moving, THIS assertion goes red, and whoever fixed it deletes the
        // entry from KNOWN_DERIVED. That is the whole point of pinning the wrong
        // behaviour rather than skipping the type.
        expect(
          after!.values,
          `${id} is pinned as a KNOWN tenet-11 failure. If its coordinates now hold still, the defect is FIXED - delete its entry from KNOWN_DERIVED.`
        ).not.toEqual(before);
      } else {
        expect(after!.values).toEqual(before);
      }
    });
  }

  /**
   * ⚑⚑ THE SAME QUESTION, ASKED OF THE CASE THE v2.3 FIX ACTUALLY CHANGED (F33).
   *
   * The pin above holds the UNMARKED fallback, which is derived by construction
   * and always will be. This is the half a fix could move: once the category
   * axis is marked, a point's category is the BAND its own pixel falls in, so it
   * is a function of that pixel and the calibration and of nothing else - which
   * is the property the whole file tests.
   *
   * ⚑ Swept for every type that offers category ticks, not for `categorical` by
   * name. Bar already passes it; a thirteenth banded type joins automatically,
   * which is why the sweep lives here rather than in a per-type file.
   */
  const BANDED = IN_SCOPE.filter(([, config]) => config.categoryTicks !== undefined);

  it('is not vacuous - some type actually offers category ticks', () => {
    expect(BANDED.map(([id]) => id)).toContain('categorical');
  });

  for (const [id, config] of BANDED) {
    it(`${labelOf(id)}: with the category axis MARKED, a neighbour cannot move this datum`, () => {
      const session = calibratedHealthy(id, config);
      // The axis the figure's categories sit on, and how many there are - the
      // two things the user marks, and the whole of what makes a band a
      // MEASURED coordinate rather than a rank.
      expect(session.markCategoryAxis({ x: 100, y: 400 }, { x: 500, y: 400 })).toBe(true);
      expect(session.setCategoryCount(4)).toBe(true);

      session.addDataPoint(200, 250);
      const first = session.getExportRows(0);
      expect(first.length, 'the fixture must produce a datum to test').toBe(1);
      const { px, py, values: before } = first[0]!;

      // One to its LEFT - the direction a rank is sensitive to - and one right.
      session.addDataPoint(150, 350);
      session.addDataPoint(450, 200);

      const after = session.getExportRows(0).find((r) => r.px === px && r.py === py);
      expect(after, 'the datum must still be in the record').toBeDefined();
      expect(
        after!.values,
        `${id}'s category is meant to be the BAND its own pixel falls in. If a neighbour moved it, the band is not being measured.`
      ).toEqual(before);
    });
  }
});
