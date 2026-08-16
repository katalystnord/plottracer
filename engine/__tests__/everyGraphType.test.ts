import { describe, expect, it } from 'vitest';
import * as CONFIGS from '../axesTypeConfigs.js';
import { ALL_AXES_TYPE_CONFIGS } from '../axesTypeConfigs.js';
import type { AxesTypeConfig, CalibratedAxes } from '../axesTypeConfigs.js';

/**
 * ⚑⚑⚑ THE INVARIANTS EVERY GRAPH TYPE MUST SATISFY — and the point is that a
 * NEW type is enrolled automatically.
 *
 * David, 2026-08-16, after I re-derived the "a heatmap always has a numeric
 * scale" premise inside the very file whose header condemns it: *"I do NOT want
 * to come back to this problem for the next chart type, i.e. bubble graphs."*
 *
 * ⚠️ WHY IT KEPT COMING BACK — it was never a belief anyone held. **A new graph
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

describe('⚑⚑ every graph type is REGISTERED — a type cannot join the app silently', () => {
  it('the registry holds exactly the configs this module exports', () => {
    // ⚑⚑ THE KEYSTONE. Both sides are DERIVED — one from the module's own
    // exports, one from the registry — so neither can be quietly edited to agree
    // with the other. A list that agrees with itself proves nothing; this is the
    // same move `ADDS_POINT_ON_CLICK` makes for the click router.
    // ⚑ THIS is what makes a bubble chart's arrival noisy instead of silent:
    // define `BUBBLE_AXES_CONFIG`, forget the registry, and this fails.
    const exported = exportedConfigs().map((e) => e.config.id).sort();
    const registered = ALL_AXES_TYPE_CONFIGS.map((c) => c.id).sort();
    expect(registered).toEqual(exported);
  });

  it('every registered type has a UNIQUE id, since the id is how a file names its type', () => {
    // A duplicate id means a saved project reopens as the wrong graph type —
    // `ALL_AXES_TYPE_CONFIGS.find(c => c.id === …)` takes the first match.
    const ids = ALL_AXES_TYPE_CONFIGS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('is not vacuous — the registry is populated and the shape filter finds things', () => {
    // ⚑ Without this the two assertions above would BOTH pass on an empty
    // registry and an export filter that matched nothing, which is exactly how a
    // structural test goes quiet without failing.
    expect(ALL_AXES_TYPE_CONFIGS.length).toBeGreaterThan(5);
    expect(exportedConfigs().length).toBe(ALL_AXES_TYPE_CONFIGS.length);
  });
});
