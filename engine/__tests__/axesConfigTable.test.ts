import { describe, expect, it } from 'vitest';
import { ALL_AXES_TYPE_CONFIGS } from '../axesTypeConfigs.js';
import {
  XY_AXES_CONFIG,
  HISTOGRAM_AXES_CONFIG,
  BAR_AXES_CONFIG,
  CATEGORICAL_LINE_CONFIG,
  BOX_PLOT_AXES_CONFIG,
  POLAR_AXES_CONFIG,
  TERNARY_AXES_CONFIG,
  MAP_AXES_CONFIG,
  CIRCULAR_CHART_RECORDER_AXES_CONFIG,
  SPIDER_AXES_CONFIG,
  PIE_AXES_CONFIG,
  HEATMAP_AXES_CONFIG,
  commonOriginPairs,
  commonOriginReuse,
  type AxesTypeConfig,
  type CalibratedAxes,
} from '../calibrationSession.js';

/**
 * The axes-type CONFIG TABLE, checked as data.
 *
 * ⚑ WHY THIS FILE EXISTS. `engine/calibrationSession.ts` carries 1,321
 * mutants no test notices - a third of everything left in the codebase after
 * the 2026-07-31 sweep - and by far the densest region (405 of them) is this
 * table: the per-type `options`, `fixedSteps`, `valueLabels`, guards and
 * defaults. They are plain object literals, so every label, default and
 * choice value mutates to `""` or `{}` and survives, because nothing ever
 * asserted the table's CONTENT.
 *
 * ⚑ AND THE DEFAULTS HAVE BEEN SILENTLY WRONG BEFORE. The CCR config's own
 * comment records it: *"We hardcoded 'day' while the code comment claimed it
 * 'matches WPD's own sidebar defaults' - it did not. Same silent-divergence
 * class as MapAxes's origin."* Two of those defaults are checked today, but
 * only through the Electron e2e - minutes per run, and it covers two entries
 * out of the whole table. This is the same check as a pure unit, over all of
 * it.
 *
 * The cross-cutting invariants below are the more valuable half. A guard that
 * names a step key which does not exist does not fail - it silently does
 * NOTHING, and this project has been bitten by exactly that: checkpoint 69's
 * trailing-digit heuristic "silently no-opped on Ternary (a/b/c) and CCR
 * (t1r2/t2r2)". These assertions make a typo'd key a red test instead of an
 * absent refusal.
 */

/**
 * ⚑⚑ THE REGISTRY, not a list of its own - and the reason is sitting in this
 * file's own history.
 *
 * ⚠️ This was a hand-written array of ELEVEN configs while the app had TWELVE:
 * `HEATMAP_AXES_CONFIG` was never added, so the largest type this project has
 * built escaped EVERY cross-cutting invariant below for the whole of v2.2 -
 * silently, with the file green throughout.
 *
 * That is not a slip, it is the shape David named: *"I do NOT want to come back
 * to this problem for the next chart type, i.e. bubble graphs."* A new type used
 * to join a UI dropdown and join nothing else; a hand-maintained list does not
 * grow when you add a type. Pointing this at `ALL_AXES_TYPE_CONFIGS` means a
 * thirteenth is enrolled here the moment it is registered, and
 * `everyGraphType.test.ts` makes registering it unavoidable.
 */
const ALL: readonly AxesTypeConfig<CalibratedAxes>[] = ALL_AXES_TYPE_CONFIGS;

/** Every step key a config can produce, including a repeating group's first
 * unrolled instance (getSteps appends the index: `spoke` -> `spoke1`). */
function stepKeys(config: AxesTypeConfig<CalibratedAxes>): string[] {
  const keys = config.fixedSteps.map((s) => s.key);
  const repeating = config.repeatingStep;
  if (repeating) {
    for (let i = 1; i <= Math.max(repeating.min, 3); i++) keys.push(`${repeating.step.key}${i}`);
  }
  return keys;
}

describe('the config table - cross-cutting invariants', () => {
  it('every graph type has a unique id and a non-empty label', () => {
    const ids = ALL.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of ALL) {
      expect(c.id, 'id must not be blank').not.toBe('');
      expect(c.label, `${c.id} label must not be blank`).not.toBe('');
      expect(c.axesKind, `${c.id} axesKind must not be blank`).not.toBe('');
    }
  });

  it('⚑ every bespoke data panel is claimed by exactly one type', () => {
    // ⚑⚑ A PANEL WITH TWO OWNERS IS A CASCADE BUG WAITING TO HAPPEN, and a panel
    // with none is dead code. The cascade in Workspace.tsx is ordered, so two
    // types claiming 'bar' would silently give the second one the first's table
    // - the same shape as the v1.4 export defect, where a spider fell into the
    // tuple-table branch and read values off the nearest ray.
    const owners = new Map<string, string[]>();
    for (const c of ALL) {
      if (!c.outputPanel) continue;
      owners.set(c.outputPanel, [...(owners.get(c.outputPanel) ?? []), c.id]);
    }
    for (const [panel, ids] of owners) {
      expect(ids, `panel '${panel}' is claimed by ${ids.join(' and ')}`).toHaveLength(1);
    }
    // Every value the union offers is actually used -- a panel nothing renders
    // is a branch that cannot be reached.
    expect([...owners.keys()].sort()).toEqual(['bar', 'bins', 'heatmap', 'spider']);
  });

  it('⚑ a type declaring no panel falls to the GENERIC pair, and that is a series question', () => {
    // The types without `outputPanel` get the tuple table when the SERIES has
    // slots and the flat spreadsheet otherwise. That is question 1 of the three
    // named on the config ("does this SERIES have slots?"), which is runtime and
    // must NOT be answered from the type -- so the only thing to assert here is
    // that they genuinely declare nothing rather than declaring a wrong panel.
    const generic = ALL.filter((c) => !c.outputPanel).map((c) => c.id);
    expect(generic, 'the generic branch must still serve someone').not.toHaveLength(0);
    for (const c of ALL) {
      if (generic.includes(c.id)) expect(c.outputPanel).toBeUndefined();
    }
  });

  it('⚑ a type that REFUSES auto-extract says why, in words a user can act on', () => {
    // ⚑⚑ THE REFUSAL AND ITS REASON ARE DECLARED TOGETHER, so they cannot drift.
    // This was a `config.id === 'boxplot' ? … : config.id === 'categorical' ? …`
    // cascade in Workspace.tsx, which meant a type joined the contentless
    // fallback -- "Not available for this graph type" -- by DEFAULT. Heatmap and
    // Pie had already fallen into it, on the two types where the reason is the
    // most interesting thing about them, and nothing anywhere reported it.
    for (const c of ALL) {
      if ((c.autoExtractKind ?? 'curve') !== 'none') {
        expect(c.autoExtractRefusal, `${c.id} does not refuse auto-extract, so it must not explain a refusal`).toBeUndefined();
        continue;
      }
      const reason = c.autoExtractRefusal;
      expect(reason, `${c.id} refuses auto-extract without saying why`).toBeTruthy();
      // "Refuse with the REQUIREMENT": naming the refusal is not enough, the
      // sentence has to point at what the user should do instead.
      expect(reason!.length, `${c.id}'s reason is too short to be a reason`).toBeGreaterThan(40);
      expect(reason, `${c.id} restates the generic fallback instead of explaining`).not.toMatch(
        /not available for this graph type/i
      );
    }
  });

  it('⚑ every value column is named: valueLabels matches dataDim exactly', () => {
    // These labels ARE the on-screen table headers and the export headers. A
    // short list silently drops a column's name from every file.
    for (const c of ALL) {
      expect(c.valueLabels.length, `${c.id} names ${c.valueLabels.length} of ${c.dataDim} columns`).toBe(c.dataDim);
      for (const label of c.valueLabels) expect(label, `${c.id} has a blank column name`).not.toBe('');
    }
  });

  it('⚑ every distinct-pixel guard names REAL steps - a typo silently disables the refusal', () => {
    // checkGuards resolves these with `steps.findIndex(st => st.key === ...)`;
    // an unknown key yields -1, `cal.getPoint(-1)` is null, and the guard
    // quietly passes everything. That is the checkpoint-69 defect exactly.
    for (const c of ALL) {
      const known = stepKeys(c);
      for (const group of c.distinctPixelSteps ?? []) {
        expect(group.length, `${c.id} has a distinct-pixel group of one`).toBeGreaterThan(1);
        for (const key of group) {
          expect(known, `${c.id}: distinctPixelSteps names unknown step "${key}"`).toContain(key);
        }
      }
    }
  });

  it('⚑ every parallel-axis and radial guard names real steps too', () => {
    for (const c of ALL) {
      const known = stepKeys(c);
      const pag = c.parallelAxisGuard;
      if (pag) {
        for (const key of [...pag.v1, ...pag.v2]) {
          expect(known, `${c.id}: parallelAxisGuard names unknown step "${key}"`).toContain(key);
        }
        expect(pag.label).not.toBe('');
      }
      const rdg = c.radialDistinctGuard;
      if (rdg) {
        for (const key of [rdg.origin, rdg.p1, rdg.p2]) {
          expect(known, `${c.id}: radialDistinctGuard names unknown step "${key}"`).toContain(key);
        }
        expect(rdg.label).not.toBe('');
      }
    }
  });

  it('⚑ every log-scale guard names a real OPTION and real calibration points', () => {
    // `optionBool(options, g.option)` on an unknown key is always false, so
    // the whole zero/sign refusal never fires -- and a log axis through zero
    // reads back NaN for every value while calibrate() reports success.
    for (const c of ALL) {
      const optionKeys = (c.options ?? []).map((o) => o.key);
      for (const g of c.logScaleGuards ?? []) {
        expect(optionKeys, `${c.id}: logScaleGuard names unknown option "${g.option}"`).toContain(g.option);
        expect(g.label, `${c.id}: logScaleGuard has a blank axis label`).not.toBe('');
        expect(g.points.length).toBeGreaterThan(1);
        for (const p of g.points) {
          expect(p).toBeGreaterThanOrEqual(0);
          expect(p, `${c.id}: logScaleGuard point ${p} is past its own step list`).toBeLessThan(stepKeys(c).length);
        }
      }
    }
  });

  it('⚑ every CHOICE option defaults to one of its own choices', () => {
    // A default outside its own list renders as an empty <select> and, worse,
    // reaches buildAxes as an unrecognised string.
    for (const c of ALL) {
      for (const o of c.options ?? []) {
        if (o.kind !== 'choice') continue;
        const values = o.choices.map((ch) => ch.value);
        expect(values, `${c.id}.${o.key}: default "${o.default}" is not among its choices`).toContain(o.default);
        expect(new Set(values).size, `${c.id}.${o.key} has duplicate choice values`).toBe(values.length);
        for (const ch of o.choices) expect(ch.label, `${c.id}.${o.key} has a blank choice label`).not.toBe('');
      }
    }
  });

  it('every option has a unique key and a non-empty label, within its own type', () => {
    for (const c of ALL) {
      const keys = (c.options ?? []).map((o) => o.key);
      expect(new Set(keys).size, `${c.id} has duplicate option keys`).toBe(keys.length);
      for (const o of c.options ?? []) {
        expect(o.key).not.toBe('');
        // ⚑⚑ AN OPTION MUST BE IDENTIFIABLE ON SCREEN - which is not the same as
        // "has a label of its own". A `choice` inside a GROUP is a radio row
        // under the group's heading (`Workspace.tsx` renders one per distinct
        // `group`), so `{ label: '', group: 'X axis', choices: [Values,
        // Categories] }` is fully named: the heading says which axis and each
        // choice says what it is. Demanding a label there would force a
        // redundant word beside the heading.
        //
        // ⚠️ THIS TEST USED TO DEMAND A LABEL UNCONDITIONALLY, and the heatmap -
        // the ONLY type using grouped choices - was absent from `ALL`, so the
        // invariant never met the pattern it could not express. The list not
        // growing is what kept a too-strong rule looking correct for a whole
        // release.
        const named = o.label !== '' || (o.group ?? '') !== '';
        expect(named, `${c.id}.${o.key} is unnamed: no label and no group`).toBe(true);
        // And a choice's own options are always named - that half is not
        // negotiable, because those words ARE the control.
        if (o.kind === 'choice') {
          expect(o.choices.length, `${c.id}.${o.key} is a choice with nothing to choose`).toBeGreaterThan(1);
          for (const ch of o.choices) {
            expect(ch.label, `${c.id}.${o.key} has a blank choice value`).not.toBe('');
          }
        }
      }
    }
  });

  it('every calibration step has a unique key, a label, a prompt and a colour', () => {
    // The prompt is the only thing telling the user WHERE to click; a blank
    // one leaves the tips bar empty at the exact moment it is needed.
    for (const c of ALL) {
      const keys = c.fixedSteps.map((s) => s.key);
      expect(new Set(keys).size, `${c.id} has duplicate step keys`).toBe(keys.length);
      for (const s of c.fixedSteps) {
        expect(s.key).not.toBe('');
        expect(s.label, `${c.id}.${s.key} has a blank label`).not.toBe('');
        expect(s.prompt, `${c.id}.${s.key} has a blank prompt`).not.toBe('');
        expect(s.color, `${c.id}.${s.key} has a blank colour`).toMatch(/^#[0-9a-fA-F]{6}$/);
      }
    }
  });

  it('every value field writes to a real slot and carries a label', () => {
    for (const c of ALL) {
      const steps = [...c.fixedSteps, ...(c.repeatingStep ? [c.repeatingStep.step] : [])];
      for (const s of steps) {
        for (const vf of s.valueFields) {
          expect(['dx', 'dy', 'dz'], `${c.id}.${s.key}.${vf.key} writes to "${vf.field}"`).toContain(vf.field);
          expect(vf.label, `${c.id}.${s.key}.${vf.key} has a blank label`).not.toBe('');
        }
      }
    }
  });

  it('⚑ a type storing a value in dz declares 3 calibration dimensions', () => {
    // A 2-slot Calibration DROPS dz on the floor while every number still
    // reads back correctly -- exactly how a spider's axis names would vanish
    // silently. plotData's reader has the mirror of this rule.
    for (const c of ALL) {
      const steps = [...c.fixedSteps, ...(c.repeatingStep ? [c.repeatingStep.step] : [])];
      const usesDz = steps.some((s) => s.valueFields.some((vf) => vf.field === 'dz'));
      if (usesDz) {
        expect(c.calibrationDimensions, `${c.id} stores dz but declares ${c.calibrationDimensions ?? 2} dimensions`).toBe(3);
      }
    }
  });

  it('numbers a repeating PROMPT only where the repeats are distinguishable', () => {
    // ⚑ A real design distinction, pinned so it stays deliberate. A spider's
    // spokes are each a SEPARATE named axis, so its prompt says which one is
    // wanted ("axis #, going clockwise"). A pie's outline points are
    // interchangeable - any three fit a circle - so numbering the prompt would
    // imply an order the figure does not have. Label numbered in both cases;
    // prompt numbered only for spider.
    expect(SPIDER_AXES_CONFIG.repeatingStep!.step.prompt).toContain('#');
    expect(PIE_AXES_CONFIG.repeatingStep!.step.prompt).not.toContain('#');
  });

  it('a repeating type declares a sensible floor and a noun for its group', () => {
    for (const c of ALL) {
      const r = c.repeatingStep;
      if (!r) continue;
      expect(r.min, `${c.id} repeats with a floor below 1`).toBeGreaterThanOrEqual(1);
      expect(r.noun).not.toBe('');
      expect(r.nounPlural).not.toBe('');
      // '#' is the placeholder getSteps substitutes the index into. The LABEL
      // must carry it -- that is the step chip, and without it every repeated
      // step is captioned identically ("Outline", "Outline", ...) with no way
      // to tell which one is being asked for.
      expect(r.step.label, `${c.id}'s repeating label has no # placeholder`).toContain('#');
    }
  });
});

describe('the config table - the per-type defaults, pinned', () => {
  /** The default value of a named option, for readability below. */
  function optionDefault(c: AxesTypeConfig<CalibratedAxes>, key: string): unknown {
    return (c.options ?? []).find((o) => o.key === key)?.default;
  }

  it('⚑ CCR defaults to a ONE WEEK rotation, anticlockwise - matching WPD on both paths', () => {
    // The documented regression: 'day' was hardcoded while the comment claimed
    // it matched WPD, whose <select> lists "1 Week" first AND whose
    // deserializer falls back to 'week'.
    expect(optionDefault(CIRCULAR_CHART_RECORDER_AXES_CONFIG, 'rotationTime')).toBe('week');
    expect(optionDefault(CIRCULAR_CHART_RECORDER_AXES_CONFIG, 'rotationDirection')).toBe('anticlockwise');
  });

  it('⚑ Map defaults to a BOTTOM-LEFT origin - the same silent-divergence class', () => {
    expect(optionDefault(MAP_AXES_CONFIG, 'origin')).toBe('bottom-left');
  });

  it('XY defaults to linear on both axes, with rotation correction ON', () => {
    // `skipRotation` false means correction is applied -- WPD's own default,
    // and the flag whose inversion an earlier audit caught.
    expect(optionDefault(XY_AXES_CONFIG, 'isLogX')).toBe(false);
    expect(optionDefault(XY_AXES_CONFIG, 'isLogY')).toBe(false);
    expect(optionDefault(XY_AXES_CONFIG, 'skipRotation')).toBe(false);
  });

  it('Bar defaults to linear, vertical, and SHARING a baseline at zero', () => {
    // v2.0: the ordinary zero-based bar chart is what the user walks past.
    expect(optionDefault(BAR_AXES_CONFIG, 'isLog')).toBe(false);
    expect(optionDefault(BAR_AXES_CONFIG, 'isRotated')).toBe(false);
    expect(optionDefault(BAR_AXES_CONFIG, 'hasBaseline')).toBe(true);
    expect(optionDefault(BAR_AXES_CONFIG, 'baselineValue')).toBe('0');
  });

  it('Polar defaults to degrees, anticlockwise, linear radial', () => {
    expect(optionDefault(POLAR_AXES_CONFIG, 'isDegrees')).toBe('true');
    expect(optionDefault(POLAR_AXES_CONFIG, 'isClockwise')).toBe('false');
    expect(optionDefault(POLAR_AXES_CONFIG, 'isLogR')).toBe(false);
  });

  it('Ternary defaults to a 0-100 range in Normal orientation', () => {
    // The orientation whose serialization bug once permuted every datum.
    expect(optionDefault(TERNARY_AXES_CONFIG, 'isRange100')).toBe('true');
    expect(optionDefault(TERNARY_AXES_CONFIG, 'isNormal')).toBe('true');
  });

  it('Pie defaults to a total of 100 and a full 360-degree sweep, untilted', () => {
    // "Leave the total at 100 and the slices read as percentages, which is
    // what a pie is" -- a default walked past, not an invention.
    const globals = PIE_AXES_CONFIG.globalFields;
    expect(globals.find((g) => g.key === 'total')?.defaultValue).toBe('100');
    expect(globals.find((g) => g.key === 'sweep')?.defaultValue).toBe('360');
    expect(optionDefault(PIE_AXES_CONFIG as unknown as AxesTypeConfig<CalibratedAxes>, 'isTilted')).toBe(false);
  });

  it('Spider starts at three spokes - the fewest that draws one', () => {
    expect(SPIDER_AXES_CONFIG.repeatingStep?.min).toBe(3);
    expect(optionDefault(SPIDER_AXES_CONFIG as unknown as AxesTypeConfig<CalibratedAxes>, 'isLogRadial')).toBe(false);
  });
});

describe('the config table - how many clicks each type asks for', () => {
  it('asks for the number of calibration points its axes class requires', () => {
    // The step list IS the calibration walk. A missing step means a
    // calibration that can never complete; an extra one asks for a click the
    // maths ignores.
    const expected: Record<string, number> = {
      xy: 4,
      histogram: 4,
      // ⚑⚑ FOUR, NOT TWO, SINCE v2.4 - and the extra pair is the point. Two of
      // these clicks calibrate the VALUE axis, which is all `BarAxes` reads;
      // the other two calibrate the CATEGORY axis, which is not a
      // `CalibratedAxes` at all and has no pixel transform. The walk is the
      // FIGURE's calibration, not one class's argument list, and a bar chart
      // has two axes.
      // ⚠️ The old comment on this table - *"an extra one asks for a click the
      // maths ignores"* - is exactly the reading that let the category axis be
      // a fold-out seeded off P1 for three releases.
      bar: 4,
      categorical: 4,
      boxplot: 4,
      polar: 3,
      ternary: 3,
      map: 2,
      ccr: 5,
      pie: 0, // outline points are variable-length, collected without fixed steps
      spider: 1, // the shared origin; spokes come from the repeating group
      // ⚑ Heatmap (v2.2): THREE for the frame - the affine minimum, since x1
      // and y1 are the same corner - plus FOUR for the colour key (two opposite
      // corners of the strip, then two labelled ticks on it), plus the second
      // key corner. The key is the third AXIS, so it is calibrated like one.
      // ⚠️ ABSENT UNTIL THE 2026-08-16 AUDIT: `ALL` was hand-written with
      // eleven types while the app had twelve, so `expected['heatmap']` was
      // `undefined` and this invariant never ran on the largest type in the
      // release.
      heatmap: 8,
    };
    // ⚑ NO SILENT PASS FOR AN UNLISTED TYPE. `toBe(undefined)` would quietly
    // succeed for any type missing from the table above - which is exactly how
    // the heatmap escaped. A new type must be counted here, deliberately.
    for (const c of ALL) {
      expect(
        Object.prototype.hasOwnProperty.call(expected, c.id),
        `${c.id} has no expected click count - add one deliberately`
      ).toBe(true);
      expect(c.fixedSteps.length, `${c.id} asks for ${c.fixedSteps.length} fixed clicks`).toBe(expected[c.id]);
    }
  });

  // ⚑ Histogram and Box Plot BORROW their calibration and guards from XY and
  // Bar respectively, by REFERENCE, so the shared arrays cannot drift apart --
  // that is stated in both config comments and was previously six plain
  // `key: DONOR.key` lines each. They now go through `borrowFrom`, which skips
  // keys the donor omits (needed once exactOptionalPropertyTypes was turned on:
  // `key: DONOR.key` writes a key HOLDING undefined, and this object is read as
  // a table where absent and present-but-undefined are different answers).
  //
  // These assertions pin the borrow itself. Nothing else would notice a future
  // edit that dropped a key from the list -- the config would simply lose a
  // guard, silently, which is the failure mode this whole file exists to catch.
  it('Histogram borrows XY calibration and guards by reference', () => {
    expect(HISTOGRAM_AXES_CONFIG.logScaleGuards).toBe(XY_AXES_CONFIG.logScaleGuards);
    expect(HISTOGRAM_AXES_CONFIG.distinctPixelSteps).toBe(XY_AXES_CONFIG.distinctPixelSteps);
    expect(HISTOGRAM_AXES_CONFIG.parallelAxisGuard).toBe(XY_AXES_CONFIG.parallelAxisGuard);
    expect(HISTOGRAM_AXES_CONFIG.fixedSteps).toBe(XY_AXES_CONFIG.fixedSteps);
    expect(HISTOGRAM_AXES_CONFIG.options).toBe(XY_AXES_CONFIG.options);
    expect(HISTOGRAM_AXES_CONFIG.extractOptions).toBe(XY_AXES_CONFIG.extractOptions);
  });

  it('Box Plot borrows Bar the same way - but NOT its options', () => {
    expect(BOX_PLOT_AXES_CONFIG.logScaleGuards).toBe(BAR_AXES_CONFIG.logScaleGuards);
    expect(BOX_PLOT_AXES_CONFIG.distinctPixelSteps).toBe(BAR_AXES_CONFIG.distinctPixelSteps);
    expect(BOX_PLOT_AXES_CONFIG.fixedSteps).toBe(BAR_AXES_CONFIG.fixedSteps);
    // ⚑ v2.0 Phase 6: sharing Bar's `options` array leaked its
    // hasBaseline/baselineValue controls into every Box Plot session, where
    // buildAxes never reads them - controls that DID NOTHING. Box Plot owns its
    // array now, and this assertion is what stops the sharing coming back.
    expect(BOX_PLOT_AXES_CONFIG.options).not.toBe(BAR_AXES_CONFIG.options);
    expect(BOX_PLOT_AXES_CONFIG.options?.map((o) => o.key)).not.toContain('hasBaseline');
  });

  it('only Pie and CCR collect a value with no click attached to it', () => {
    // globalFields are the fields entered once, outside the click walk. Any
    // OTHER type growing one silently changes its calibration flow.
    const withGlobals = ALL.filter((c) => c.globalFields.length > 0).map((c) => c.id).sort();
    expect(withGlobals).toEqual(['ccr', 'pie']);
  });
});

/**
 * COMMON ORIGIN - the shared corner, and the reuse decision.
 *
 * ⚑ WHY THIS BLOCK EXISTS. Until v2.1 the capability was declared
 * (`supportsCommonOrigin: true`) while the two step keys it turns on were
 * LITERALS inside `Workspace.tsx` (`next?.key === 'y1'`, `placed['x1']`). Half a
 * declaration - and the hardcoded half is the half that silently does nothing on
 * a type whose steps are named differently, which is every bar-family type
 * (`p1`/`p2`, and categorical Line's `v1`/`v2`). None of it had a single test.
 */

/** A `placed` map with just these step keys filled in. */
function placedWith(...keys: string[]): Record<string, unknown> {
  return Object.fromEntries(keys.map((k) => [k, { px: 0, py: 0, values: [] }]));
}

describe('the shared corner is declared, not named at the call site', () => {
  it('names two real steps of its own type, donor before target', () => {
    for (const config of ALL) {
      const keys = stepKeys(config);
      for (const shared of commonOriginPairs(config)) {
        expect(keys, `${config.id}: commonOrigin.from`).toContain(shared.from);
        expect(keys, `${config.id}: commonOrigin.to`).toContain(shared.to);
        // The donor has to be placed before the walk arrives at the target, or
        // the reuse can never fire.
        expect(keys.indexOf(shared.from), `${config.id} ${shared.to}`).toBeLessThan(
          keys.indexOf(shared.to)
        );
      }
    }
  });

  it('prefills exactly one value per field of the step it fills', () => {
    // ⚑ Every declared pairing, not just the first: a type may share more than
    // one pixel (a heatmap shares both corners of its plot box), and a prefill
    // that outran its step's fields is what stopped common origin working on a
    // category axis at all.
    for (const config of ALL) {
      for (const shared of commonOriginPairs(config)) {
        const target = config.fixedSteps.find((st) => st.key === shared.to);
        expect(target, `${config.id}: ${shared.to} exists`).toBeDefined();
        expect(shared.prefill?.length ?? 0, `${config.id} ${shared.to}`).toBe(
          target!.valueFields.length
        );
      }
    }
  });

  it('shares ONE corner on a heatmap - two shared pairs cannot calibrate', () => {
    // ⚑⚑ Was `['x1->y1', 'x2->y2']`. Sharing both pairs leaves the calibration
    // with two distinct pixels, and two points cannot define a 2-D transform -
    // the axes come out parallel and the whole calibration is refused, whatever
    // corners are clicked. See `heatmapAxesConfig.test.ts` for the geometry.
    const pairs = commonOriginPairs(HEATMAP_AXES_CONFIG as unknown as AxesTypeConfig<CalibratedAxes>);
    expect(pairs.map((p) => `${p.from}->${p.to}`)).toEqual(['x1->y1']);
  });

  it('TRIMS a prefill to the fields the step actually has', () => {
    // ⚑ The category-axis defect: `x1 -> y1` declares a prefill of ['0'], and a
    // heatmap's categorical Y edge takes NO typed value, so the value was being
    // fed to a step with nowhere to put it. David: *"the common origin does not
    // work when you have a categorial axis."*
    const heat = HEATMAP_AXES_CONFIG as unknown as AxesTypeConfig<CalibratedAxes>;
    expect(commonOriginReuse(heat, true, 'y1', placedWith('x1'), { valueFields: [] })).toEqual({
      from: 'x1',
      prefill: [],
    });
    // …and a step that DOES have a field still gets its value.
    expect(
      commonOriginReuse(heat, true, 'y1', placedWith('x1'), {
        valueFields: [{ key: 'y1', label: 'Y', field: 'dy' }],
      })!.prefill
    ).toEqual(['0']);
  });

  it('XY and Histogram share ONE declaration, so they cannot drift apart', () => {
    expect(XY_AXES_CONFIG.commonOrigin).toEqual({ from: 'x1', to: 'y1', prefill: ['0'] });
    expect(HISTOGRAM_AXES_CONFIG.commonOrigin).toBe(XY_AXES_CONFIG.commonOrigin);
  });

  it('the types with no shared corner declare none', () => {
    for (const config of [BAR_AXES_CONFIG, CATEGORICAL_LINE_CONFIG, BOX_PLOT_AXES_CONFIG,
                          POLAR_AXES_CONFIG, TERNARY_AXES_CONFIG, MAP_AXES_CONFIG,
                          CIRCULAR_CHART_RECORDER_AXES_CONFIG, SPIDER_AXES_CONFIG,
                          PIE_AXES_CONFIG] as unknown as AxesTypeConfig<CalibratedAxes>[]) {
      expect(config.commonOrigin, config.id).toBeUndefined();
    }
  });
});

describe('commonOriginReuse - when the walk should take the shared pixel', () => {
  const xy = XY_AXES_CONFIG as unknown as AxesTypeConfig<CalibratedAxes>;

  it('fires on arriving at the target with the donor placed', () => {
    expect(commonOriginReuse(xy, true, 'y1', placedWith('x1', 'x2'))).toEqual({
      from: 'x1',
      prefill: ['0'],
    });
  });

  it('does not fire when the user has turned the option off', () => {
    expect(commonOriginReuse(xy, false, 'y1', placedWith('x1', 'x2'))).toBeNull();
  });

  it('does not fire for a type that declares no shared corner', () => {
    const bar = BAR_AXES_CONFIG as unknown as AxesTypeConfig<CalibratedAxes>;
    expect(commonOriginReuse(bar, true, 'p2', placedWith('p1'))).toBeNull();
  });

  it('does not fire at any step but the declared target', () => {
    expect(commonOriginReuse(xy, true, 'x2', placedWith('x1'))).toBeNull();
    expect(commonOriginReuse(xy, true, 'y2', placedWith('x1', 'x2', 'y1'))).toBeNull();
  });

  it('does not fire before the donor has been placed', () => {
    expect(commonOriginReuse(xy, true, 'y1', placedWith('x2'))).toBeNull();
  });

  it('⚑ does not fire once the target is placed - an offer on arrival, not a rule', () => {
    // Without this the reuse would re-assert itself and overwrite a pixel the
    // user had already put down by hand.
    expect(commonOriginReuse(xy, true, 'y1', placedWith('x1', 'x2', 'y1'))).toBeNull();
  });

  it('does not fire when the walk has run off the end', () => {
    expect(commonOriginReuse(xy, true, undefined, placedWith('x1', 'x2', 'y1', 'y2'))).toBeNull();
  });

  it('⚑ hands back a COPY of the prefill, so a caller cannot mutate the config', () => {
    const first = commonOriginReuse(xy, true, 'y1', placedWith('x1'))!;
    first.prefill[0] = 'tampered';
    expect(commonOriginReuse(xy, true, 'y1', placedWith('x1'))!.prefill).toEqual(['0']);
    expect(commonOriginPairs(XY_AXES_CONFIG as unknown as AxesTypeConfig<CalibratedAxes>)[0]!.prefill).toEqual(['0']);
  });

  it('Histogram behaves identically, which is the point of the declaration', () => {
    const hist = HISTOGRAM_AXES_CONFIG as unknown as AxesTypeConfig<CalibratedAxes>;
    expect(commonOriginReuse(hist, true, 'y1', placedWith('x1', 'x2'))).toEqual({
      from: 'x1',
      prefill: ['0'],
    });
  });
});
