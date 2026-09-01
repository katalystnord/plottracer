import { describe, it, expect } from 'vitest';

import {
  measureCategoryAxisFromFragments,
  MIN_EXTENT_RATIO,
  MIN_FRAGMENTS,
} from '../categoryAxisFromFragments.js';

/**
 * ⚑⚑ READING THE CATEGORY AXIS OFF THE FRAGMENTS, instead of being told it.
 *
 * `joinAcrossHatch` needs to know which way the categories run, and until now
 * that could only be DECLARED. So a histogram never got the join at all - its
 * axes type has no category ticks, so nothing can declare one - and neither did
 * any bar chart whose walk was unfinished.
 *
 * ⚑ THE RULE, and it is a fact about what a hatch physically does rather than a
 * heuristic: a hatch cuts one bar into slabs, and every slab is A SLICE OF THE
 * SAME RECTANGLE, so all of them share that bar's two edges across the bar.
 * Read the axes the wrong way round and that "shared" extent becomes each
 * slab's own band, which differs for every slab. So the correct axis is the one
 * with FEWER DISTINCT PERPENDICULAR EXTENTS, and the ratio between the two
 * counts is the confidence.
 *
 * ⛔⛔ WHY IT REFUSES RATHER THAN GUESSING, measured on 6,494 real published
 * bars: a DEFAULTED axis cost 24 bars, and `PMC6603941___5` fell from 21 of 21
 * to 9. That figure's ratio is 1.91. Every threshold in here is set so that
 * figure is REFUSED, and the tests below pin it by name rather than by a number
 * nobody can trace.
 */

interface Box { minX: number; minY: number; maxX: number; maxY: number }

/** `count` slabs of one upright bar: same x extent, stacked up the y axis. */
function hatchedUprightBar(x0: number, x1: number, yTop: number, count: number, pitch = 10): Box[] {
  return Array.from({ length: count }, (_, i) => ({
    minX: x0, maxX: x1,
    minY: yTop + i * pitch, maxY: yTop + i * pitch + 6,
  }));
}

/** The same, turned: slabs of one horizontal bar share their y extent. */
function hatchedHorizontalBar(y0: number, y1: number, xLeft: number, count: number, pitch = 10): Box[] {
  return Array.from({ length: count }, (_, i) => ({
    minY: y0, maxY: y1,
    minX: xLeft + i * pitch, maxX: xLeft + i * pitch + 6,
  }));
}

describe('the category axis is measured from the fragments, not declared', () => {
  it('⚑⚑ reads x when hatch slabs share their x extent', () => {
    // Three upright bars, each shredded into 8 slabs. Across all 24 fragments
    // there are 3 distinct x extents and 24 distinct y extents.
    const boxes = [
      ...hatchedUprightBar(10, 30, 100, 8),
      ...hatchedUprightBar(40, 60, 120, 8),
      ...hatchedUprightBar(70, 90, 140, 8),
    ];
    const m = measureCategoryAxisFromFragments(boxes, 2);
    expect(m?.categoryAxis).toBe('x');
    expect(m!.ratio).toBeGreaterThanOrEqual(MIN_EXTENT_RATIO);
  });

  it('⚑⚑ reads y on a horizontal chart, the case a default got wrong', () => {
    // The orientation that cost 24 real bars when it was assumed rather than
    // measured. Nothing here is symmetric with the case above by accident: the
    // shared extent is the y one, so the categories run down the image.
    const boxes = [
      ...hatchedHorizontalBar(10, 30, 100, 8),
      ...hatchedHorizontalBar(40, 60, 120, 8),
      ...hatchedHorizontalBar(70, 90, 140, 8),
    ];
    const m = measureCategoryAxisFromFragments(boxes, 2);
    expect(m?.categoryAxis).toBe('y');
    expect(m!.ratio).toBeGreaterThanOrEqual(MIN_EXTENT_RATIO);
  });

  it('⛔ refuses whole bars, because they say nothing either way', () => {
    // Six unfragmented bars: one x extent each AND one y extent each, so the
    // two counts are equal and there is no evidence at all. Rule A reads these
    // correctly at 95.5%; this one must not pretend to.
    const boxes: Box[] = Array.from({ length: 6 }, (_, i) => ({
      minX: 10 + i * 30, maxX: 30 + i * 30, minY: 100 - i * 7, maxY: 200,
    }));
    expect(measureCategoryAxisFromFragments(boxes, 2)).toBeNull();
  });

  it('⛔⛔ refuses at the ratio of the figure a default wrecked', () => {
    // ⚑ PMC6603941___5 measures 1.91, and lowering the gate to 1.5 takes it from
    // 21 bars of 21 down to 9 - the same collapse the original default caused.
    // This is the single measurement the threshold exists to respect, so it is
    // pinned here by the figure's own number rather than left to a constant
    // nobody can trace back to anything.
    expect(MIN_EXTENT_RATIO).toBeGreaterThan(1.91);
  });

  it('⛔ refuses three fragments, which cannot show a repeat', () => {
    // ⚠️ THE COUNT IS A LITERAL, NOT `MIN_FRAGMENTS - 1`. Building the fixture
    // out of the constant under test makes the test move with it: lower the
    // constant and the fixture shrinks too, so the case passes for any value
    // and proves nothing. Caught by mutation - this test survived MIN_FRAGMENTS
    // being dropped from 4 to 1.
    const boxes = hatchedUprightBar(10, 30, 100, 3);
    expect(boxes).toHaveLength(3);
    expect(measureCategoryAxisFromFragments(boxes, 2)).toBeNull();
  });

  it('⛔ and four fragments of one bar are read, so the floor is the reason above', () => {
    // The companion assertion: the case above must fail for its COUNT and not
    // because a four-slab bar is unreadable anyway.
    expect(measureCategoryAxisFromFragments(hatchedUprightBar(10, 30, 100, 4), 2)).not.toBeNull();
    expect(MIN_FRAGMENTS).toBe(4);
  });

  it('⚑ reads jittered slab edges as ONE extent, because real ink is not exact', () => {
    // ⚠️ THE JITTER IS THE POINT. A flood fill on an antialiased figure returns
    // edges that wobble by a pixel, so slabs of one bar never share a
    // coordinate exactly. An earlier version of this fixture used exact
    // coordinates, and exact-equality clustering passed it - the tolerance was
    // doing nothing and the test could not tell.
    const jitter = [0, 1, -1, 1, 0, -1, 1, 0];
    const boxes = jitter.map((d, i) => ({
      minX: 10 + d, maxX: 30 - d,
      minY: 100 + i * 10, maxY: 106 + i * 10,
    }));
    const m = measureCategoryAxisFromFragments(boxes, 2);
    expect(m?.categoryAxis).toBe('x');
    // One bar, however much its edges wobble.
    expect(m!.distinctAlongCategory).toBe(1);
  });

  it('counts two separated bars as two extents, not one', () => {
    // ⚑ The other side of the tolerance: it must absorb a wobble without
    // swallowing a neighbour. Two bars 20px apart, tolerance 2.
    const boxes = [...hatchedUprightBar(10, 30, 100, 6), ...hatchedUprightBar(50, 70, 100, 6)];
    const m = measureCategoryAxisFromFragments(boxes, 2);
    expect(m?.categoryAxis).toBe('x');
    expect(m!.distinctAlongCategory).toBe(2);
  });

  it('⛔ refuses an empty figure rather than dividing by zero', () => {
    expect(measureCategoryAxisFromFragments([], 2)).toBeNull();
  });
});
