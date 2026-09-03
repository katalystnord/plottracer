/**
 * ⚑⚑ EVERY REGISTERED GRAPH TYPE HAS A PICKER ICON.
 *
 * The card picker renders `GRAPH_TYPE_ICONS[opt.id]` and falls back to nothing,
 * so a type that registers without one gets a CARD WITH NO PICTURE - and the
 * picker is the one screen where the picture is doing the work. Nothing said so
 * until v2.5: Candlestick was registered, the whole board stayed green, and the
 * only way to find the blank card was to open the picker and look.
 *
 * ⚑ Both sides are DERIVED - the registry on one, the icon map on the other -
 * so neither can be edited to agree with the other. The same move
 * `everyGraphType` makes for registration itself.
 */
import { describe, expect, it } from 'vitest';
import { ALL_AXES_TYPE_CONFIGS } from '../../../engine/axesTypeConfigs.js';
import { GRAPH_TYPE_ICONS } from '../icons.js';

describe('every graph type has an icon', () => {
  it('the picker can draw a card for every type the registry holds', () => {
    const missing = ALL_AXES_TYPE_CONFIGS.filter((c) => !GRAPH_TYPE_ICONS[c.id]).map((c) => c.id);
    expect(missing, 'these types would render a card with no picture').toEqual([]);
  });

  it('is not vacuous - the registry is populated and the map resolves', () => {
    expect(ALL_AXES_TYPE_CONFIGS.length).toBeGreaterThan(5);
    expect(typeof GRAPH_TYPE_ICONS[ALL_AXES_TYPE_CONFIGS[0]!.id]).toBe('function');
  });

  it('⚑ the two extra keys are the ones with no axes type, and nothing else', () => {
    // `donut` is the multi-series pie pattern and `errorbars` is a rail tool -
    // both exist only for the Open Example list's per-entry override. Naming
    // them keeps a THIRD orphan from arriving unnoticed.
    const ids = new Set(ALL_AXES_TYPE_CONFIGS.map((c) => c.id));
    expect(Object.keys(GRAPH_TYPE_ICONS).filter((k) => !ids.has(k)).sort()).toEqual([
      'donut',
      'errorbars',
    ]);
  });
});
