import { describe, expect, it } from 'vitest';
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
  type AxesTypeConfig,
  type CalibratedAxes,
} from '../calibrationSession.js';

/**
 * The axes-type CONFIG TABLE, checked as data.
 *
 * ⚑ WHY THIS FILE EXISTS. `engine/calibrationSession.ts` carries 1,321
 * mutants no test notices — a third of everything left in the codebase after
 * the 2026-07-31 sweep — and by far the densest region (405 of them) is this
 * table: the per-type `options`, `fixedSteps`, `valueLabels`, guards and
 * defaults. They are plain object literals, so every label, default and
 * choice value mutates to `""` or `{}` and survives, because nothing ever
 * asserted the table's CONTENT.
 *
 * ⚑ AND THE DEFAULTS HAVE BEEN SILENTLY WRONG BEFORE. The CCR config's own
 * comment records it: *"We hardcoded 'day' while the code comment claimed it
 * 'matches WPD's own sidebar defaults' — it did not. Same silent-divergence
 * class as MapAxes's origin."* Two of those defaults are checked today, but
 * only through the Electron e2e — minutes per run, and it covers two entries
 * out of the whole table. This is the same check as a pure unit, over all of
 * it.
 *
 * The cross-cutting invariants below are the more valuable half. A guard that
 * names a step key which does not exist does not fail — it silently does
 * NOTHING, and this project has been bitten by exactly that: checkpoint 69's
 * trailing-digit heuristic "silently no-opped on Ternary (a/b/c) and CCR
 * (t1r2/t2r2)". These assertions make a typo'd key a red test instead of an
 * absent refusal.
 */

const ALL: readonly AxesTypeConfig<CalibratedAxes>[] = [
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
] as unknown as readonly AxesTypeConfig<CalibratedAxes>[];

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

describe('the config table — cross-cutting invariants', () => {
  it('every graph type has a unique id and a non-empty label', () => {
    const ids = ALL.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of ALL) {
      expect(c.id, 'id must not be blank').not.toBe('');
      expect(c.label, `${c.id} label must not be blank`).not.toBe('');
      expect(c.axesKind, `${c.id} axesKind must not be blank`).not.toBe('');
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

  it('⚑ every distinct-pixel guard names REAL steps — a typo silently disables the refusal', () => {
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
        expect(o.label, `${c.id}.${o.key} has a blank label`).not.toBe('');
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
    // interchangeable — any three fit a circle — so numbering the prompt would
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

describe('the config table — the per-type defaults, pinned', () => {
  /** The default value of a named option, for readability below. */
  function optionDefault(c: AxesTypeConfig<CalibratedAxes>, key: string): unknown {
    return (c.options ?? []).find((o) => o.key === key)?.default;
  }

  it('⚑ CCR defaults to a ONE WEEK rotation, anticlockwise — matching WPD on both paths', () => {
    // The documented regression: 'day' was hardcoded while the comment claimed
    // it matched WPD, whose <select> lists "1 Week" first AND whose
    // deserializer falls back to 'week'.
    expect(optionDefault(CIRCULAR_CHART_RECORDER_AXES_CONFIG, 'rotationTime')).toBe('week');
    expect(optionDefault(CIRCULAR_CHART_RECORDER_AXES_CONFIG, 'rotationDirection')).toBe('anticlockwise');
  });

  it('⚑ Map defaults to a BOTTOM-LEFT origin — the same silent-divergence class', () => {
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

  it('Spider starts at three spokes — the fewest that draws one', () => {
    expect(SPIDER_AXES_CONFIG.repeatingStep?.min).toBe(3);
    expect(optionDefault(SPIDER_AXES_CONFIG as unknown as AxesTypeConfig<CalibratedAxes>, 'isLogRadial')).toBe(false);
  });
});

describe('the config table — how many clicks each type asks for', () => {
  it('asks for the number of calibration points its axes class requires', () => {
    // The step list IS the calibration walk. A missing step means a
    // calibration that can never complete; an extra one asks for a click the
    // maths ignores.
    const expected: Record<string, number> = {
      xy: 4,
      histogram: 4,
      bar: 2,
      categorical: 2,
      boxplot: 2,
      polar: 3,
      ternary: 3,
      map: 2,
      ccr: 5,
      pie: 0, // outline points are variable-length, collected without fixed steps
      spider: 1, // the shared origin; spokes come from the repeating group
    };
    for (const c of ALL) {
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

  it('Box Plot borrows Bar the same way — but NOT its options', () => {
    expect(BOX_PLOT_AXES_CONFIG.logScaleGuards).toBe(BAR_AXES_CONFIG.logScaleGuards);
    expect(BOX_PLOT_AXES_CONFIG.distinctPixelSteps).toBe(BAR_AXES_CONFIG.distinctPixelSteps);
    expect(BOX_PLOT_AXES_CONFIG.fixedSteps).toBe(BAR_AXES_CONFIG.fixedSteps);
    // ⚑ v2.0 Phase 6: sharing Bar's `options` array leaked its
    // hasBaseline/baselineValue controls into every Box Plot session, where
    // buildAxes never reads them — controls that DID NOTHING. Box Plot owns its
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
