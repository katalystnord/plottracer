import { describe, expect, it } from 'vitest';
import { indexOfPlacedPoint } from '../canvasClickRoute.js';
import { emptyCategoryNames } from '../colorTraceReport.js';
import { samplePixelRgb } from '../../algorithms/samplePixel.js';

/**
 * THEME G: THE DECISIONS INSIDE `handleImageClick`, WHERE A TEST CAN REACH THEM.
 *
 * ⚑⚑ THE TEST FOR A CANDIDATE (theme F's own rule): does it DECIDE something
 * from data rather than render it, and is it currently unreachable except by an
 * Electron run? All three below were both. They sat inside a 163-line
 * `useCallback` in `Workspace.tsx`, which mutation testing cannot see into and
 * only an 18-minute e2e can execute.
 *
 * ⚑ NO BEHAVIOUR CHANGES HERE. This is the `refactor 4` method: the hook's BODY
 * moves, the hook stays and calls it. What changes is who can ask the question.
 */

/**
 * ⛔ THE CATEGORY-EDGE CLICK TESTS WENT WITH THE GESTURE (v2.4). They covered
 * `resolveCategoryEdgeClick` - which click is the first edge, which is the
 * second, and when the value-axis handle may stand in for the first. Both ends
 * of the category axis are calibration steps now, so a canvas click is never an
 * axis edge and the function is deleted rather than left unreachable.
 */

describe('G - which point did I just place', () => {
  const pts = [
    { px: 10, py: 10 },
    { px: 20, py: 20 },
    { px: 30, py: 30 },
  ];

  it('finds the point at the clicked pixel, wherever the model put it', () => {
    // ⚑ Insert-in-place can splice a new point into the MIDDLE of a curve, so
    // "the newest is the last index" is false - the defect this search exists
    // to avoid, in both places that place a point.
    expect(indexOfPlacedPoint(pts, 20, 20, false)).toBe(1);
  });

  it('⚑ a SNAPPED point is not at the clicked pixel, and falls back to the last', () => {
    // A spider capture lands on the ray, not under the cursor. The grouped path
    // always appends, so the last index is right there - and only there.
    expect(indexOfPlacedPoint(pts, 999, 999, true)).toBe(2);
  });

  it('⚑ without that fallback it answers NULL rather than guessing', () => {
    // The interpolation-anchor path has no append guarantee, so an unfound
    // point must select nothing rather than the last thing in the list.
    expect(indexOfPlacedPoint(pts, 999, 999, false)).toBeNull();
  });
});

describe('G - the pixel under the cursor', () => {
  // 3x2 image: red, green, blue on the top row.
  const data = new Uint8ClampedArray([
    255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255,
    1, 2, 3, 255, 4, 5, 6, 255, 7, 8, 9, 255,
  ]);
  const img = { data, width: 3, height: 2 };

  it('reads the colour at a pixel', () => {
    expect(samplePixelRgb(img, 1, 0)).toEqual([0, 255, 0]);
    expect(samplePixelRgb(img, 2, 1)).toEqual([7, 8, 9]);
  });

  it('⚑ rounds and CLAMPS, because a click can land off the image', () => {
    // Every caller was doing this by hand - three copies of the same four lines,
    // the third added the same day this was extracted. A click at -3 must read
    // the edge pixel, never index -1 into the array and hand back garbage.
    expect(samplePixelRgb(img, -3, -3)).toEqual([255, 0, 0]);
    expect(samplePixelRgb(img, 99, 99)).toEqual([7, 8, 9]);
    expect(samplePixelRgb(img, 0.6, 0.4)).toEqual([0, 255, 0]);
  });
});

describe('G - naming the categories a bar detect came back empty on', () => {
  it('⚑⚑ maps a BAND back to the CATEGORY, because the two run opposite ways', () => {
    // The split reports empty slots by BAND, which is image order (left to
    // right). The categories are in the AXIS's order, which runs the other way
    // whenever the axis was marked right-to-left or bottom-to-top. Reporting
    // the band index as if it were the category names the wrong one - and it
    // names a real category, so nothing looks wrong.
    const names = emptyCategoryNames([0, 2], (band) => 3 - band, ['A', 'B', 'C', 'D']);
    expect(names).toEqual(['D', 'B']);
  });

  it('⚑ an UNNAMED category is reported by position, never as a blank', () => {
    // A blank in a list of what is missing reads as "nothing is missing here".
    expect(emptyCategoryNames([1], (b) => b, ['A', '', 'C'])).toEqual(['Category 2']);
  });

  it('says nothing when nothing came back empty', () => {
    expect(emptyCategoryNames([], (b) => b, ['A'])).toEqual([]);
  });
});
