import { describe, expect, it } from 'vitest';
import {
  bandIndexForParam,
  CategoryAxis,
  dividerParamsFrom,
  generateTickParams,
  paramAtPoint,
  pointAtParam,
  tickCountFor,
  type TickConvention,
} from '../categoryAxis.js';

/**
 * CategoryAxis - v2.0 groundwork, unwired.
 *
 * Written before anything binds to this class (see the plan's phasing): a
 * category axis is only a name list here, so these tests are about the list
 * itself -- adding, renaming, reordering, removing -- not about what a bound
 * dataset does with an index into it.
 */

function withThree(): CategoryAxis {
  const ax = new CategoryAxis();
  ax.addCategory('Alpha');
  ax.addCategory('Beta');
  ax.addCategory('Gamma');
  return ax;
}

describe('adding and reading categories', () => {
  it('appends and returns the new index', () => {
    const ax = new CategoryAxis();
    expect(ax.addCategory('Alpha')).toBe(0);
    expect(ax.addCategory('Beta')).toBe(1);
    expect(ax.getCategories()).toEqual(['Alpha', 'Beta']);
    expect(ax.getCategoryCount()).toBe(2);
  });

  it('starts empty', () => {
    const ax = new CategoryAxis();
    expect(ax.getCategories()).toEqual([]);
    expect(ax.getCategoryCount()).toBe(0);
  });

  it('finds a category by name, or -1 when absent', () => {
    const ax = withThree();
    expect(ax.getCategoryIndex('Beta')).toBe(1);
    expect(ax.getCategoryIndex('Delta')).toBe(-1);
  });

  it('never coerces a numeric-looking name -- stays a string, unconditionally', () => {
    const ax = new CategoryAxis();
    ax.addCategory('2020');
    expect(ax.getCategories()[0]).toBe('2020');
    expect(typeof ax.getCategories()[0]).toBe('string');
  });
});

describe('renaming', () => {
  it('renames in place, leaving the index and the other names unchanged', () => {
    const ax = withThree();
    expect(ax.renameCategory(1, 'Beta II')).toBe(true);
    expect(ax.getCategories()).toEqual(['Alpha', 'Beta II', 'Gamma']);
  });

  it('refuses an out-of-range index and leaves the list untouched', () => {
    const ax = withThree();
    expect(ax.renameCategory(3, 'Delta')).toBe(false);
    expect(ax.renameCategory(-1, 'Delta')).toBe(false);
    expect(ax.getCategories()).toEqual(['Alpha', 'Beta', 'Gamma']);
  });
});

describe('reordering - permutation-checked, mirroring Dataset.reorderPixels', () => {
  it('applies order[newIndex] = oldIndex', () => {
    const ax = withThree();
    expect(ax.reorderCategories([2, 0, 1])).toBe(true);
    expect(ax.getCategories()).toEqual(['Gamma', 'Alpha', 'Beta']);
  });

  it('refuses the wrong length', () => {
    const ax = withThree();
    expect(ax.reorderCategories([0, 1])).toBe(false);
    expect(ax.getCategories()).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('refuses an out-of-range index', () => {
    const ax = withThree();
    expect(ax.reorderCategories([0, 1, 3])).toBe(false);
    expect(ax.getCategories()).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('refuses the same index twice -- not a permutation', () => {
    const ax = withThree();
    expect(ax.reorderCategories([0, 0, 2])).toBe(false);
    expect(ax.getCategories()).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('refuses a non-integer index', () => {
    const ax = withThree();
    expect(ax.reorderCategories([0.5, 1, 2])).toBe(false);
    expect(ax.getCategories()).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('a no-op reorder (identity) succeeds and changes nothing', () => {
    const ax = withThree();
    expect(ax.reorderCategories([0, 1, 2])).toBe(true);
    expect(ax.getCategories()).toEqual(['Alpha', 'Beta', 'Gamma']);
  });
});

describe('removing', () => {
  it('removes by index and shifts every later index down by one', () => {
    const ax = withThree();
    expect(ax.removeCategory(1)).toBe(true);
    expect(ax.getCategories()).toEqual(['Alpha', 'Gamma']);
  });

  it('refuses an out-of-range index and leaves the list untouched', () => {
    const ax = withThree();
    expect(ax.removeCategory(5)).toBe(false);
    expect(ax.getCategories()).toEqual(['Alpha', 'Beta', 'Gamma']);
  });
});

// ---------------------------------------------------------------------------
// Geometry (v2.1) - the category ticks.
//
// ⚑ These are tests of an AID, not of a calibration. Nothing here decides a
// measured VALUE: a bar reads its value from the calibrated value axis, and
// auto-extract finds bars from ink. Ticks divide and label. So the assertions
// below are about STRUCTURE (how many marks, in what order, which band a point
// lands in) and about REFUSALS - never about sub-pixel accuracy, which is not
// load-bearing here and must not be made so.
// ---------------------------------------------------------------------------

const A = { x: 100, y: 500 };
const B = { x: 600, y: 500 };

/** An axis from x=100 to x=600 with `n` categories under `convention`. */
function withAxis(n: number, convention: TickConvention = 'centred'): CategoryAxis {
  const ax = new CategoryAxis();
  expect(ax.setAxisEdges(A, B)).toBe(true);
  expect(ax.setConvention(convention)).toBe(true);
  expect(ax.setCategoryCount(n)).toBe(true);
  return ax;
}

describe('tickCountFor / generateTickParams - how many marks, and where', () => {
  it('centred draws one tick per category, edge draws one between each pair', () => {
    expect(tickCountFor('centred', 5)).toBe(5);
    expect(tickCountFor('edge', 5)).toBe(4);
  });

  it('a single category needs one centred tick and no edge ticks at all', () => {
    expect(generateTickParams('centred', 1)).toEqual([0.5]);
    expect(generateTickParams('edge', 1)).toEqual([]);
  });

  it('centred ticks sit at the band centres', () => {
    expect(generateTickParams('centred', 4)).toEqual([0.125, 0.375, 0.625, 0.875]);
  });

  it('edge ticks sit on the interior band boundaries', () => {
    expect(generateTickParams('edge', 4)).toEqual([0.25, 0.5, 0.75]);
  });

  it('refuses a count that is not a positive whole number', () => {
    for (const bad of [0, -3, 2.5, NaN, Infinity]) {
      expect(tickCountFor('centred', bad)).toBe(0);
      expect(generateTickParams('centred', bad)).toEqual([]);
      expect(generateTickParams('edge', bad)).toEqual([]);
    }
  });
});

describe('dividerParamsFrom - both conventions resolve to the SAME bands', () => {
  it('⚑ the central claim of the design: same axis, same count, same N+1 dividers', () => {
    for (const n of [1, 2, 3, 5, 12]) {
      const centred = dividerParamsFrom('centred', generateTickParams('centred', n));
      const edge = dividerParamsFrom('edge', generateTickParams('edge', n));
      expect(centred.length).toBe(n + 1);
      expect(edge.length).toBe(n + 1);
      centred.forEach((t, i) => expect(t).toBeCloseTo(edge[i]!, 12));
    }
  });

  it('edge mode uses the ticks themselves, closed by the two axis edges', () => {
    expect(dividerParamsFrom('edge', [0.25, 0.5, 0.75])).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });

  it('centred mode uses the MIDPOINTS between adjacent ticks', () => {
    // Deliberately uneven, as dragged ticks are: the midpoints must follow the
    // ticks rather than being recomputed as an even division.
    expect(dividerParamsFrom('centred', [0.1, 0.5, 0.9])).toEqual([0, 0.3, 0.7, 1]);
  });

  it('one category has no interior divider in either convention', () => {
    expect(dividerParamsFrom('centred', [0.5])).toEqual([0, 1]);
    expect(dividerParamsFrom('edge', [])).toEqual([0, 1]);
  });
});

describe('bandIndexForParam - the outermost bands are unbounded', () => {
  const dividers = [0, 0.25, 0.5, 0.75, 1];

  it('places a parameter in its band', () => {
    expect(bandIndexForParam(0.1, dividers)).toBe(0);
    expect(bandIndexForParam(0.4, dividers)).toBe(1);
    expect(bandIndexForParam(0.6, dividers)).toBe(2);
    expect(bandIndexForParam(0.9, dividers)).toBe(3);
  });

  it('⚑ a bar OUTSIDE the declared span still belongs to the nearest category', () => {
    expect(bandIndexForParam(-5, dividers)).toBe(0);
    expect(bandIndexForParam(4, dividers)).toBe(3);
  });

  it('a divider itself belongs to the band it opens', () => {
    expect(bandIndexForParam(0.25, dividers)).toBe(1);
    expect(bandIndexForParam(0.75, dividers)).toBe(3);
  });

  it('answers nothing for a non-finite parameter or an empty axis', () => {
    expect(bandIndexForParam(NaN, dividers)).toBeNull();
    expect(bandIndexForParam(0.5, [])).toBeNull();
    expect(bandIndexForParam(0.5, [0])).toBeNull();
  });
});

describe('pointAtParam / paramAtPoint', () => {
  const edges = [A, B] as const;

  it('round-trips a parameter through image coordinates', () => {
    for (const t of [0, 0.25, 0.5, 1, 1.4, -0.2]) {
      expect(paramAtPoint(edges, pointAtParam(edges, t))).toBeCloseTo(t, 12);
    }
  });

  it('projects an off-axis point onto the axis, ignoring the perpendicular part', () => {
    // A bar's centre is nowhere near the axis line; only its position ALONG the
    // category direction identifies it.
    expect(paramAtPoint(edges, { x: 350, y: 120 })).toBeCloseTo(0.5, 12);
    expect(paramAtPoint(edges, { x: 350, y: 900 })).toBeCloseTo(0.5, 12);
  });

  it('works on an axis that is not image-aligned', () => {
    const tilted = [{ x: 0, y: 0 }, { x: 300, y: 400 }] as const; // length 500
    expect(paramAtPoint(tilted, { x: 150, y: 200 })).toBeCloseTo(0.5, 12);
    expect(pointAtParam(tilted, 0.5)).toEqual({ x: 150, y: 200 });
  });

  it('returns NaN rather than a number for a zero-length axis', () => {
    expect(paramAtPoint([A, A], { x: 1, y: 2 })).toBeNaN();
  });

  it('⚑ returns NaN, not Infinity, for a DENORMALLY short axis', () => {
    // The case two identical points cannot expose: the endpoints differ, so the
    // numerator stays finite, but the squared length underflows to zero. Without
    // the guard this divides to Infinity, and an infinite parameter reads as a
    // real position to anything that does not check.
    const denormal = [{ x: 0, y: 0 }, { x: 1e-200, y: 0 }] as const;
    expect(1e-200 * 1e-200).toBe(0); // the underflow this test turns on
    expect(paramAtPoint(denormal, { x: 1000, y: 0 })).toBeNaN();
  });
});

describe('setAxisEdges - the refusal that must be able to fire', () => {
  it('⚑ refuses two coincident edges instead of reporting success', () => {
    // The calibrate()-cannot-fail shape. A zero-length axis divides by zero in
    // paramAtPoint, so every tick, divider and assignment would read NaN with
    // nothing on screen wrong.
    const ax = new CategoryAxis();
    expect(ax.setAxisEdges(A, { ...A })).toBe(false);
    expect(ax.hasGeometry()).toBe(false);
    expect(ax.getTickParams()).toEqual([]);
  });

  it('⚑ refuses a DENORMALLY short axis, which is not the same question', () => {
    // Distinct points, so a coordinate-equality check passes them -- but the
    // squared length underflows to zero and every projection would be Infinity.
    const ax = new CategoryAxis();
    expect(ax.setAxisEdges({ x: 0, y: 0 }, { x: 1e-200, y: 0 })).toBe(false);
    expect(ax.hasGeometry()).toBe(false);
  });

  it('refuses a non-finite coordinate', () => {
    const ax = new CategoryAxis();
    expect(ax.setAxisEdges({ x: NaN, y: 0 }, B)).toBe(false);
    expect(ax.setAxisEdges(A, { x: 0, y: Infinity })).toBe(false);
    expect(ax.hasGeometry()).toBe(false);
  });

  it('copies the points, so a caller mutating its own object cannot move the axis', () => {
    const ax = new CategoryAxis();
    const mine = { x: 100, y: 500 };
    ax.setAxisEdges(mine, B);
    (mine as { x: number }).x = 999;
    expect(ax.getAxisEdges()![0]).toEqual({ x: 100, y: 500 });
  });
});

describe('declaring the categories', () => {
  it('the count IS the name list length - one source, not two', () => {
    const ax = withAxis(4);
    expect(ax.getCategoryCount()).toBe(4);
    expect(ax.getCategories()).toEqual(['', '', '', '']);
    expect(ax.getTickParams()).toHaveLength(4);
  });

  it('⚑ growing never invents a name - new categories are blank', () => {
    const ax = new CategoryAxis();
    ax.addCategory('Flax');
    ax.addCategory('Hemp');
    ax.setAxisEdges(A, B);
    ax.setCategoryCount(4);
    expect(ax.getCategories()).toEqual(['Flax', 'Hemp', '', '']);
  });

  it('shrinking drops the trailing categories', () => {
    const ax = new CategoryAxis();
    ax.addCategory('Flax');
    ax.addCategory('Hemp');
    ax.addCategory('Jute');
    ax.setAxisEdges(A, B);
    ax.setCategoryCount(2);
    expect(ax.getCategories()).toEqual(['Flax', 'Hemp']);
  });

  it('refuses a count below one, leaving the ticks alone', () => {
    const ax = withAxis(3);
    expect(ax.setCategoryCount(0)).toBe(false);
    expect(ax.setCategoryCount(2.5)).toBe(false);
    expect(ax.getTickParams()).toHaveLength(3);
  });

  it('regenerating with no axis placed produces nothing and says so', () => {
    const ax = new CategoryAxis();
    ax.addCategory('Flax');
    expect(ax.regenerateTicks()).toBe(false);
    expect(ax.getTickParams()).toEqual([]);
    expect(ax.getDividerParams()).toEqual([]);
    expect(ax.getTickPoints()).toEqual([]);
    expect(ax.getDividerPoints()).toEqual([]);
  });
});

describe('the convention toggle moves the marks on screen', () => {
  it('flipping it changes how many ticks there are and where', () => {
    const ax = withAxis(4, 'centred');
    expect(ax.getTickPoints().map((p) => p.x)).toEqual([162.5, 287.5, 412.5, 537.5]);
    expect(ax.setConvention('edge')).toBe(true);
    expect(ax.getTickPoints().map((p) => p.x)).toEqual([225, 350, 475]);
  });

  it('⚑ but the BANDS are unchanged - that is why the choice is not about accuracy', () => {
    const centred = withAxis(4, 'centred');
    const edge = withAxis(4, 'edge');
    // ⚑ Assert the VALUES, not merely that the two agree. Comparing the two
    // outputs to each other passes on [] === [], so this claim survived a mutant
    // that made getDividerPoints always empty - an agreement test proves nothing
    // until at least one side is pinned to a known answer.
    const expected = [
      { x: 100, y: 500 },
      { x: 225, y: 500 },
      { x: 350, y: 500 },
      { x: 475, y: 500 },
      { x: 600, y: 500 },
    ];
    expect(centred.getDividerPoints()).toEqual(expected);
    expect(edge.getDividerPoints()).toEqual(expected);
  });

  it('refuses a convention it does not know', () => {
    const ax = withAxis(3);
    expect(ax.setConvention('middle' as TickConvention)).toBe(false);
    expect(ax.getConvention()).toBe('centred');
  });
});

describe('dragging a tick', () => {
  it('projects the drop point onto the axis and records the adjustment', () => {
    const ax = withAxis(4);
    expect(ax.hasAdjustments()).toBe(false);
    expect(ax.moveTick(1, { x: 300, y: 40 })).toBe(true); // well off the axis line
    expect(ax.getTickPoints()[1]!.x).toBeCloseTo(300, 9);
    expect(ax.getTickPoints()[1]!.y).toBeCloseTo(500, 9); // snapped onto the axis
    expect(ax.hasAdjustments()).toBe(true);
  });

  it('⚑ a tick can never cross its neighbour - that would reassign categories silently', () => {
    const ax = withAxis(4);
    const before = [...ax.getTickParams()];
    ax.moveTick(1, { x: 5000, y: 500 }); // dragged far past ticks 2 and 3
    const after = ax.getTickParams();
    expect(after[1]!).toBeLessThan(before[2]!);
    expect(after[1]!).toBeGreaterThan(before[0]!);
    expect([...after]).toEqual([...after].sort((a, b) => a - b));
  });

  it('the outermost ticks are held inside the axis edges', () => {
    const ax = withAxis(3);
    ax.moveTick(0, { x: -9000, y: 500 });
    ax.moveTick(2, { x: 9000, y: 500 });
    expect(ax.getTickParams()[0]!).toBeGreaterThan(0);
    expect(ax.getTickParams()[2]!).toBeLessThan(1);
  });

  it('refuses an index that is not a tick, and a drag with no axis placed', () => {
    const ax = withAxis(3);
    expect(ax.moveTick(-1, { x: 200, y: 500 })).toBe(false);
    expect(ax.moveTick(3, { x: 200, y: 500 })).toBe(false);
    expect(ax.moveTick(1.5, { x: 200, y: 500 })).toBe(false);
    expect(ax.moveTick(0, { x: NaN, y: 500 })).toBe(false);
    expect(ax.hasAdjustments()).toBe(false);
    expect(new CategoryAxis().moveTick(0, { x: 1, y: 1 })).toBe(false);
  });

  it('⚑ regenerating discards the adjustment - which is why callers must warn first', () => {
    const ax = withAxis(4);
    ax.moveTick(1, { x: 300, y: 500 });
    expect(ax.hasAdjustments()).toBe(true);
    ax.setCategoryCount(5);
    expect(ax.hasAdjustments()).toBe(false);
    expect(ax.getTickParams()).toEqual(generateTickParams('centred', 5));
  });
});

describe('ticksAreStale - the one way the count and the marks can disagree', () => {
  it('is false for a freshly declared axis', () => {
    expect(withAxis(4).ticksAreStale()).toBe(false);
    expect(withAxis(4, 'edge').ticksAreStale()).toBe(false);
  });

  it('turns true when a category arrives through the NAMING path instead', () => {
    const ax = withAxis(4);
    ax.addCategory('Extra');
    expect(ax.ticksAreStale()).toBe(true);
    ax.regenerateTicks();
    expect(ax.ticksAreStale()).toBe(false);
  });

  it('stays false while there is no geometry to be stale about', () => {
    const ax = new CategoryAxis();
    ax.addCategory('Flax');
    expect(ax.ticksAreStale()).toBe(false);
  });
});

describe('bandIndexAt - what replaces the nearest-donor guess', () => {
  it('files a bar under the category it sits in', () => {
    const ax = withAxis(4); // bands at x = 100-225, 225-350, 350-475, 475-600
    expect(ax.bandIndexAt({ x: 150, y: 300 })).toBe(0);
    expect(ax.bandIndexAt({ x: 300, y: 300 })).toBe(1);
    expect(ax.bandIndexAt({ x: 400, y: 300 })).toBe(2);
    expect(ax.bandIndexAt({ x: 550, y: 300 })).toBe(3);
  });

  it('⚑ gives the same answer in both conventions', () => {
    const centred = withAxis(4, 'centred');
    const edge = withAxis(4, 'edge');
    for (const x of [110, 224, 226, 349, 351, 474, 476, 599]) {
      expect(centred.bandIndexAt({ x, y: 300 })).toBe(edge.bandIndexAt({ x, y: 300 }));
    }
  });

  it('⚑ does not depend on capture order, unlike the prefill it replaces', () => {
    const ax = withAxis(3);
    const leftToRight = [150, 350, 550].map((x) => ax.bandIndexAt({ x, y: 300 }));
    const rightToLeft = [550, 350, 150].map((x) => ax.bandIndexAt({ x, y: 300 }));
    expect(leftToRight).toEqual([0, 1, 2]);
    expect([...rightToLeft].reverse()).toEqual(leftToRight);
  });

  it('answers nothing before the axis is marked', () => {
    const ax = new CategoryAxis();
    ax.setCategoryCount(3);
    expect(ax.bandIndexAt({ x: 150, y: 300 })).toBeNull();
  });

  it('answers nothing for a non-finite point', () => {
    expect(withAxis(3).bandIndexAt({ x: NaN, y: 0 })).toBeNull();
  });
});

/**
 * ⚑⚑ DELETED WITH ITS SUBJECT: the `clearGeometry` block.
 *
 * `CategoryAxis.clearGeometry` existed for two session mutators - "Re-place
 * axis" and "Remove ticks" - and both are gone. Since v2.4 the category axis IS
 * calibration steps c1/c2: re-placing it is dragging those handles, which never
 * drops the geometry, and "Remove ticks" was removed with the card rebuild.
 *
 * ▶ The property it asserted, that an axis with no geometry keeps its names, is
 * still true and still tested - `the defaults a fresh axis starts from` covers
 * the no-geometry state, and the un-ticked figure is exercised where it really
 * occurs, on a WPD import (`wpdImport.test.ts`).
 */

describe('the defaults a fresh axis starts from', () => {
  it('is centred, unmarked, unadjusted and named', () => {
    const ax = new CategoryAxis();
    expect(ax.name).toBe('Category');
    expect(ax.getConvention()).toBe('centred');
    expect(ax.hasGeometry()).toBe(false);
    expect(ax.hasAdjustments()).toBe(false);
    expect(ax.getAxisEdges()).toBeNull();
  });

  it('generates centred ticks without anyone selecting the convention', () => {
    const ax = new CategoryAxis();
    ax.setAxisEdges(A, B);
    ax.setCategoryCount(2);
    expect(ax.getTickParams()).toEqual([0.25, 0.75]); // centred; edge would be [0.5]
  });

  it('reports geometry once the axis is marked, and says so', () => {
    const ax = new CategoryAxis();
    expect(ax.setAxisEdges(A, B)).toBe(true);
    expect(ax.hasGeometry()).toBe(true);
    expect(ax.getAxisEdges()).toEqual([A, B]);
    expect(ax.regenerateTicks()).toBe(true);
  });
});

describe('axes that are not image-aligned', () => {
  it('⚑ accepts a 45-degree axis, where |dx| equals |dy|', () => {
    // The one tilt at which a squared length computed as dx*dx - dy*dy is
    // exactly zero - i.e. where a sign slip would refuse a perfectly good axis
    // and every horizontal-axis test would stay green.
    const ax = new CategoryAxis();
    expect(ax.setAxisEdges({ x: 0, y: 0 }, { x: 100, y: 100 })).toBe(true);
    expect(ax.setCategoryCount(2)).toBe(true);
    expect(ax.getTickPoints()).toEqual([{ x: 25, y: 25 }, { x: 75, y: 75 }]);
  });

  it('⚑ projects onto a tilted axis whose origin is NOT at (0,0)', () => {
    // With the axis starting at the origin, both `a.x` and `a.y` are zero and a
    // dropped subtraction is invisible. Offset it so it is not.
    const tilted = [{ x: 50, y: 60 }, { x: 350, y: 460 }] as const;
    expect(paramAtPoint(tilted, { x: 200, y: 260 })).toBeCloseTo(0.5, 12);
    expect(paramAtPoint(tilted, { x: 50, y: 60 })).toBeCloseTo(0, 12);
    expect(paramAtPoint(tilted, { x: 350, y: 460 })).toBeCloseTo(1, 12);
  });

  it('assigns bands along a tilted axis', () => {
    const ax = new CategoryAxis();
    ax.setAxisEdges({ x: 50, y: 60 }, { x: 350, y: 460 });
    ax.setCategoryCount(2);
    expect(ax.bandIndexAt({ x: 120, y: 150 })).toBe(0);
    expect(ax.bandIndexAt({ x: 300, y: 400 })).toBe(1);
  });
});

describe('a single category is a real case, not an edge case', () => {
  it('accepts a count of one and puts everything in band 0', () => {
    const ax = withAxis(1);
    expect(ax.getTickParams()).toEqual([0.5]);
    expect(ax.getDividerParams()).toEqual([0, 1]);
    expect(bandIndexForParam(0.5, [0, 1])).toBe(0);
    expect(ax.bandIndexAt({ x: 120, y: 9 })).toBe(0);
    expect(ax.bandIndexAt({ x: -400, y: 9 })).toBe(0);
  });

  it('declares its first category from an empty list', () => {
    const ax = new CategoryAxis();
    ax.setAxisEdges(A, B);
    expect(ax.setCategoryCount(1)).toBe(true);
    expect(ax.getCategories()).toEqual(['']);
  });
});

describe('dragging is clamped by the NEIGHBOUR, not just by the axis', () => {
  it('⚑ a middle tick dragged left stops at its predecessor, not at the axis edge', () => {
    const ax = withAxis(4); // 0.125 0.375 0.625 0.875
    const before = [...ax.getTickParams()];
    ax.moveTick(2, { x: -9000, y: 500 });
    const after = ax.getTickParams();
    expect(after[2]!).toBeGreaterThan(before[1]!); // held by tick 1...
    expect(after[2]!).toBeLessThan(before[1]! + 0.01); // ...and right up against it
  });

  it('a middle tick dragged right stops at its successor', () => {
    const ax = withAxis(4);
    const before = [...ax.getTickParams()];
    ax.moveTick(1, { x: 9000, y: 500 });
    const after = ax.getTickParams();
    expect(after[1]!).toBeLessThan(before[2]!);
    expect(after[1]!).toBeGreaterThan(before[2]! - 0.01);
  });
});

describe('the inherited list guards still hold', () => {
  it('reorderCategories refuses a list that is not a permutation', () => {
    const ax = withThree();
    expect(ax.reorderCategories([0, 1, 1])).toBe(false);
    expect(ax.reorderCategories([0, 1, 3])).toBe(false);
    expect(ax.reorderCategories([0, 1, -1])).toBe(false);
    expect(ax.reorderCategories([0, 1.5, 2])).toBe(false);
    expect(ax.getCategories()).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(ax.reorderCategories([2, 0, 1])).toBe(true);
    expect(ax.getCategories()).toEqual(['Gamma', 'Alpha', 'Beta']);
  });

  it('removeCategory refuses a negative or fractional index', () => {
    const ax = withThree();
    expect(ax.removeCategory(-1)).toBe(false);
    expect(ax.removeCategory(1.5)).toBe(false);
    expect(ax.getCategories()).toEqual(['Alpha', 'Beta', 'Gamma']);
  });
});

describe('removeCategory boundary', () => {
  it('refuses an index one past the end - the boundary, not just a wild value', () => {
    const ax = withThree();
    expect(ax.removeCategory(3)).toBe(false);
    expect(ax.getCategories()).toEqual(['Alpha', 'Beta', 'Gamma']);
  });
});

describe('the point accessors return real geometry, not just agreeing emptiness', () => {
  it('getTickPoints places every tick on the axis line at a known position', () => {
    const ax = withAxis(2);
    expect(ax.getTickPoints()).toEqual([{ x: 225, y: 500 }, { x: 475, y: 500 }]);
  });

  it('getDividerPoints closes the set with the two axis edges', () => {
    const ax = withAxis(2);
    expect(ax.getDividerPoints()).toEqual([
      { x: 100, y: 500 },
      { x: 350, y: 500 },
      { x: 600, y: 500 },
    ]);
  });

  it('moveTick moves the POINT the caller will draw, not only the parameter', () => {
    const ax = withAxis(2);
    expect(ax.moveTick(0, { x: 180, y: 77 })).toBe(true);
    expect(ax.getTickPoints()[0]).toEqual({ x: 180, y: 500 });
  });

  it('a drag with no axis marked is refused and does not throw', () => {
    const ax = new CategoryAxis();
    ax.setCategoryCount(3);
    expect(() => ax.moveTick(0, { x: 1, y: 1 })).not.toThrow();
    expect(ax.moveTick(0, { x: 1, y: 1 })).toBe(false);
  });
});

describe('moveTick survives a point that is finite but absurd', () => {
  it('⚑ refuses a coordinate whose projection OVERFLOWS, rather than storing NaN', () => {
    // isUsablePoint passes -- 1e308 is finite -- but the dot product overflows
    // to Infinity, so the finite-t guard is the only thing standing between this
    // and a tick silently set to NaN with moveTick reporting success.
    const ax = withAxis(3);
    const before = [...ax.getTickParams()];
    expect(Number.isFinite(1e308)).toBe(true);
    expect(ax.moveTick(0, { x: 1e308, y: 500 })).toBe(false);
    expect(ax.getTickParams()).toEqual(before);
    expect(ax.hasAdjustments()).toBe(false);
  });
});

describe('restoreTickParams - the LOAD door enforces what the click path does', () => {
  /** The parameters a 4-category centred axis generates. */
  const FOUR = [0.125, 0.375, 0.625, 0.875];

  it('accepts a stored set that satisfies every invariant', () => {
    const ax = withAxis(4);
    expect(ax.restoreTickParams([0.1, 0.4, 0.6, 0.9], true)).toBe(true);
    expect(ax.getTickParams()).toEqual([0.1, 0.4, 0.6, 0.9]);
    expect(ax.hasAdjustments()).toBe(true);
  });

  it('defaults to unadjusted, so a file that never said so does not claim it', () => {
    const ax = withAxis(4);
    ax.restoreTickParams([0.1, 0.4, 0.6, 0.9]);
    expect(ax.hasAdjustments()).toBe(false);
  });

  it('⚑ REGENERATES rather than refusing - the ticks are an aid, the data is not', () => {
    // Refusing the load would cost the user their measurements over a broken
    // hint. Rebuilding the hint costs nothing measured.
    //
    // ⚑ The axis is DRAGGED out of shape first, deliberately. Starting from a
    // freshly generated axis, "regenerated" and "left untouched" are the same
    // state, so the assertion passed either way and the mutant survived.
    const ax = withAxis(4);
    ax.moveTick(0, { x: 110, y: 500 });
    ax.moveTick(3, { x: 590, y: 500 });
    expect(ax.getTickParams()).not.toEqual(FOUR);

    expect(ax.restoreTickParams([0.5])).toBe(false);
    expect(ax.getTickParams()).toEqual(FOUR); // rebuilt, not merely left alone
    expect(ax.hasAdjustments()).toBe(false);
  });

  it('rejects a set of the wrong length for the convention and count', () => {
    expect(withAxis(4).restoreTickParams([0.2, 0.4, 0.6])).toBe(false); // centred wants 4
    expect(withAxis(4, 'edge').restoreTickParams([0.2, 0.4, 0.6, 0.8])).toBe(false); // edge wants 3
  });

  it('rejects ticks that are not strictly inside the axis', () => {
    expect(withAxis(2).restoreTickParams([0, 0.5])).toBe(false);
    expect(withAxis(2).restoreTickParams([0.5, 1])).toBe(false);
    expect(withAxis(2).restoreTickParams([-0.2, 0.5])).toBe(false);
    expect(withAxis(2).restoreTickParams([0.5, 1.4])).toBe(false);
  });

  it('rejects ticks that are not strictly increasing - order carries the categories', () => {
    expect(withAxis(3).restoreTickParams([0.6, 0.2, 0.8])).toBe(false);
    expect(withAxis(3).restoreTickParams([0.2, 0.2, 0.8])).toBe(false); // equal, so a zero-width band
  });

  it('rejects a non-finite tick', () => {
    expect(withAxis(2).restoreTickParams([NaN, 0.5])).toBe(false);
    expect(withAxis(2).restoreTickParams([0.2, Infinity])).toBe(false);
  });

  it('rejects anything that is not an array at all', () => {
    expect(withAxis(2).restoreTickParams('0.2,0.7' as unknown as number[])).toBe(false);
    expect(withAxis(2).restoreTickParams(null as unknown as number[])).toBe(false);
  });

  it('does nothing when no axis has been marked', () => {
    const ax = new CategoryAxis();
    ax.setCategoryCount(3);
    expect(ax.restoreTickParams([0.2, 0.5, 0.8])).toBe(false);
    expect(ax.getTickParams()).toEqual([]);
  });

  it('an empty set is CORRECT for a single edge-mode category, not a rejection', () => {
    const ax = withAxis(1, 'edge');
    expect(ax.restoreTickParams([])).toBe(true);
    expect(ax.getTickParams()).toEqual([]);
  });

  it('copies the array, so the caller cannot move ticks by mutating what it passed', () => {
    const ax = withAxis(2);
    const mine = [0.2, 0.7];
    ax.restoreTickParams(mine);
    mine[0] = 0.9;
    expect(ax.getTickParams()).toEqual([0.2, 0.7]);
  });
});

describe('⚑ the load door enforces SPACING, not merely order (review #4)', () => {
  it('rejects ticks packed closer than a drag could ever leave them', () => {
    // `moveTick` says the window between two neighbours is never empty, and
    // guarantees it by leaving EPS on each side. The load path used to check
    // only "strictly increasing", so a hand-edited file could get in under a
    // weaker rule than the click path keeps.
    const ax = withAxis(4);
    expect(ax.restoreTickParams([0.5, 0.5 + 1e-12, 0.5 + 2e-12, 0.9])).toBe(false);
    expect(ax.getTickParams()).toEqual(generateTickParams('centred', 4)); // regenerated
  });

  it('⚑ and that is what kept dragging from REORDERING the ticks', () => {
    // The consequence, asserted rather than described: with sub-EPS neighbours
    // accepted, dragging the middle tick clamped it BELOW its predecessor --
    // ticks out of order, dividers non-monotonic, every later band wrong.
    const ax = withAxis(4);
    ax.restoreTickParams([0.5, 0.5 + 1e-12, 0.5 + 2e-12, 0.9]); // refused, regenerated
    ax.moveTick(1, { x: 0, y: 500 });
    const params = ax.getTickParams();
    expect([...params]).toEqual([...params].sort((a, b) => a - b));
    expect(ax.getDividerParams()).toEqual([...ax.getDividerParams()].sort((a, b) => a - b));
  });

  it('⚑ accepts the spacing a DRAG itself produces - the guard must not out-strict the click path', () => {
    // moveTick clamps to `prev + EPS`, so the least adjacent spacing it can
    // leave is EPS (1e-6). A first draft used 2*EPS here and would have refused
    // a file the app had just written itself.
    const ax = withAxis(2);
    ax.moveTick(0, { x: 100, y: 500 }); // clamped hard against the axis start
    const dragged = [...ax.getTickParams()];
    expect(ax.restoreTickParams(dragged)).toBe(true);
    expect(ax.restoreTickParams([0.5, 0.5 + 2e-6])).toBe(true);
  });

  it('⚑⚑ …including a tick dragged against its NEIGHBOUR, where the clamp rounds DOWN', () => {
    // The case the test above misses, and the reason this one exists. Clamping
    // tick 0 against the axis START lands on `0 + EPS`, which is exactly
    // representable and can never trip the guard. Clamping a tick against its
    // NEIGHBOUR lands on `prev + EPS`, and at most tick positions that
    // subtracts back to 9.999999999732445e-7 -- BELOW EPS. Comparing against
    // EPS exactly then rejects the set the drag has just made, regenerates it,
    // and clears `adjusted`, so the user's work vanishes with no warning -- on
    // every reopen and on every rotate or crop.
    // 72 of the centred tick positions for N = 2..24 round down this way;
    // N = 4's tick 1, at 0.375, is one of them.
    const EPS = 1e-6;
    const ax = withAxis(4);
    const neighbour = ax.getTickParams()[1]!;
    expect(neighbour).toBeCloseTo(0.375, 12);
    expect(neighbour + EPS - neighbour).toBeLessThan(EPS); // the premise, measured not assumed

    ax.moveTick(2, { x: 100, y: 500 }); // drag tick 2 hard onto tick 1
    const dragged = [...ax.getTickParams()];
    expect(dragged[2]! - dragged[1]!).toBeLessThan(EPS); // what a real drag leaves

    expect(ax.restoreTickParams(dragged, true)).toBe(true);
    expect(ax.getTickParams()).toEqual(dragged);
    expect(ax.hasAdjustments()).toBe(true);
  });

  it('⚑ and the slack is ONE ULP, not a licence - a genuinely collapsed pair is still refused', () => {
    // The loosened comparison must not become "any increasing set will do", or
    // the tick reordering it exists to prevent walks straight back in.
    const ax = withAxis(3);
    expect(ax.restoreTickParams([0.25, 0.25 + 1e-12, 0.75])).toBe(false);
  });

  it('still accepts an ordinary well-spread set', () => {
    const ax = withAxis(4);
    expect(ax.restoreTickParams([0.1, 0.4, 0.6, 0.9])).toBe(true);
  });
});
