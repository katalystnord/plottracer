import { describe, expect, it } from 'vitest';
import * as CONFIGS from '../axesTypeConfigs.js';
import { ALL_AXES_TYPE_CONFIGS } from '../axesTypeConfigs.js';
import type { AxesTypeConfig, CalibratedAxes, AxesOption } from '../axesTypeConfigs.js';
import { ALL_TYPES, labelOf, calibratedHealthy } from './fixtures/anyType.js';

/**
 * ⚑⚑⚑ THE INVARIANTS EVERY GRAPH TYPE MUST SATISFY - and the point is that a
 * NEW type is enrolled automatically.
 *
 * David, 2026-08-16, after I re-derived the "a heatmap always has a numeric
 * scale" premise inside the very file whose header condemns it: *"I do NOT want
 * to come back to this problem for the next chart type, i.e. bubble graphs."*
 *
 * ⚠️ WHY IT KEPT COMING BACK - it was never a belief anyone held. **A new graph
 * type joined the app by being added to a UI dropdown list, and joined nothing
 * else.** The one enumerable list of types lived in `ui/src/Workspace.tsx`,
 * private, ordering the picker. So every cross-type check hand-listed its types,
 * and *a hand-maintained list does not grow when you add a type*: a new type was
 * ABSENT from every invariant by default, silently, and nothing failed.
 *
 * ⚑ So the fix is not care, it is MEMBERSHIP. The registry moved to `engine/`
 * and everything here iterates it. The tests below cannot be written in a way
 * that a thirteenth type escapes, because none of them names a type.
 *
 * ▶ THE ACCEPTANCE TEST FOR THAT CLAIM, and it is worth re-running by hand
 * whenever these are edited: add a throwaway config to the registry and check
 * the board goes RED. If it stays green, only the instances were fixed.
 */

/** Every `*_CONFIG` this module exports, found by SHAPE rather than by name, so
 * a config that breaks the naming habit is still caught. */
function exportedConfigs(): { name: string; config: AxesTypeConfig<CalibratedAxes> }[] {
  return (Object.entries(CONFIGS) as [string, unknown][])
    .filter(([, v]) => {
      const c = v as { id?: unknown; buildAxes?: unknown } | null;
      return typeof c === 'object' && c !== null && typeof c.id === 'string' && typeof c.buildAxes === 'function';
    })
    .map(([name, config]) => ({ name, config: config as AxesTypeConfig<CalibratedAxes> }));
}

describe('⚑⚑ every graph type is REGISTERED - a type cannot join the app silently', () => {
  it('the registry holds exactly the configs this module exports', () => {
    // ⚑⚑ THE KEYSTONE. Both sides are DERIVED - one from the module's own
    // exports, one from the registry - so neither can be quietly edited to agree
    // with the other. A list that agrees with itself proves nothing; this is the
    // same move `ADDS_POINT_ON_CLICK` makes for the click router.
    // ⚑ THIS is what makes a bubble chart's arrival noisy instead of silent:
    // define `BUBBLE_AXES_CONFIG`, forget the registry, and this fails.
    const exported = exportedConfigs().map((e) => e.config.id).sort();
    const registered = ALL_AXES_TYPE_CONFIGS.map((c) => c.id).sort();
    expect(registered).toEqual(exported);
  });

  it('every registered type has a UNIQUE id, since the id is how a file names its type', () => {
    // A duplicate id means a saved project reopens as the wrong graph type -
    // `ALL_AXES_TYPE_CONFIGS.find(c => c.id === …)` takes the first match.
    const ids = ALL_AXES_TYPE_CONFIGS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('is not vacuous - the registry is populated and the shape filter finds things', () => {
    // ⚑ Without this the two assertions above would BOTH pass on an empty
    // registry and an export filter that matched nothing, which is exactly how a
    // structural test goes quiet without failing.
    expect(ALL_AXES_TYPE_CONFIGS.length).toBeGreaterThan(5);
    expect(exportedConfigs().length).toBe(ALL_AXES_TYPE_CONFIGS.length);
  });
});

/**
 * ⚑⚑ WHAT `runCalibration` PROMISES ABOUT METADATA, ENFORCED - v2.2 audit
 * finding A4, built 2026-08-17 (pass 5).
 *
 * `runCalibration` used to copy the previous axes' metadata onto the new object.
 * That carry is GONE (v2.2, 2026-08-16) - the heatmap's record moved onto the
 * session, so there was nothing left to copy - and the code says why, ending
 * with a claim:
 *
 * > *"Everything else in axes metadata … is DECLARED during calibration and
 * > rewritten by `buildAxes` on every build, so it survives without help."*
 *
 * ⚑⚑ THAT IS A REQUIREMENT STATED IN A COMMENT, which gate 3 forbids without a
 * test of the same name. It was enforced for exactly ONE type (`pieCapture
 * .test.ts`), and it is now the load-bearing invariant for TWELVE: with nothing
 * carried across, a type whose `buildAxes` writes a key only sometimes LOSES
 * that key on the next build, in silence, into the saved file. The carry used to
 * hide that; nothing does now.
 *
 * ⚑ The audit memo recorded this check as done and pointed at THIS FILE. It was
 * not here. A ✅ beside a design is the same false evidence as a comment beside
 * unenforced code - the next reader checks, sees the claim, and stops looking.
 *
 * ▶ THE FAILURE IT GUARDS, specifically: a `buildAxes` that stamps a key only
 * while some option is ON. Turn that option off, rebuild, and the key is simply
 * absent - and with nothing carried across, absent is permanent. No type does
 * this today (the heatmap's `heatmapXKind: xCategory ? 'category' : 'value'`
 * varies the VALUE, never whether the KEY is written); this is what keeps it
 * that way for the thirteenth.
 *
 * ⚠️ A COMPANION TEST WAS WRITTEN AND DELETED, deliberately, and it is worth
 * saying why: it calibrated, re-calibrated with the same inputs, and compared
 * the metadata. `buildAxes` is deterministic and nothing is carried, so both
 * builds are the same build - the test could not fail, and it would have sat
 * here looking like coverage of the invariant above. **Coverage-shaped is worse
 * than absent**, which is the finding this whole pass keeps re-deriving. Varying
 * the OPTIONS is what makes the two builds genuinely different.
 */
describe('⚑⚑ a type stamps the SAME metadata keys whatever its options say', () => {
  /** The value an option takes when flipped away from its default. */
  function flipped(option: AxesOption): string | null {
    if (option.kind === 'checkbox') return String(!option.default);
    if (option.kind === 'choice') {
      const other = option.choices.find((c) => c.value !== option.default);
      return other ? other.value : null;
    }
    return null; // text: its VALUE varies by nature; it cannot add or drop a key
  }

  let flipsThatBuilt = 0;

  for (const [id, config] of ALL_TYPES) {
    const options = config.options ?? [];
    if (options.length === 0) continue;

    it(`${labelOf(id)}: flipping any option changes VALUES, never which keys exist`, () => {
      const base = calibratedHealthy(id, config);
      const baseKeys = Object.keys(base.getAxes()!.getMetadata()).sort();

      for (const option of options) {
        const value = flipped(option);
        if (value === null) continue;

        const session = calibratedHealthy(id, config);
        session.setOption(option.key, value);

        // ⚑ A flip may be REFUSED, and legitimately so - a heatmap with a
        // CATEGORY colour key is refused on purpose, naming what it would cost.
        // A refusal leaves the previous axes in place, so there is no new build
        // to compare; skipping it is right, but skipping SILENTLY is how a loop
        // like this ends up asserting nothing at all. Hence the counter.
        if (session.getCalibrationError()) continue;

        flipsThatBuilt++;
        expect(
          Object.keys(session.getAxes()!.getMetadata()).sort(),
          `${id} writes a different set of metadata keys when ${option.key}=${value}. A key written only under some options is LOST the moment they change, because runCalibration carries nothing across.`
        ).toEqual(baseKeys);
      }
    });
  }

  it('is not vacuous - flips actually reached a build', () => {
    // Without this, every flip being refused would leave the whole describe
    // green while comparing nothing. The number is a floor, not a fixture: it
    // only has to prove the loop did work.
    expect(flipsThatBuilt).toBeGreaterThan(5);
  });
});
