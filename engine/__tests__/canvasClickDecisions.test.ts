import { describe, expect, it } from 'vitest';
import { resolveCategoryEdgeClick, indexOfPlacedPoint } from '../canvasClickRoute.js';
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

describe('G - which pixel is the category axis edge', () => {
  const at = (x: number, y: number) => ({ x, y });

  it('the FIRST click of two is held, not marked', () => {
    expect(
      resolveCategoryEdgeClick({ point: at(50, 400), first: null, seed: null, canReuseSeed: false })
    ).toEqual({ kind: 'hold-first', point: at(50, 400) });
  });

  it('the second click marks the axis between them', () => {
    expect(
      resolveCategoryEdgeClick({ point: at(600, 400), first: at(50, 400), seed: null, canReuseSeed: false })
    ).toEqual({ kind: 'mark', from: at(50, 400), to: at(600, 400) });
  });

  it('⚑ the calibration SEED stands in for the first click, so the walk is one click', () => {
    // v2.1's own promise - "P1 is already the first edge, so the prompt asks for
    // one click, not two". The seed only counts when the panel says it may:
    // `canReuseSeed` is the panel's answer, not a guess made here.
    expect(
      resolveCategoryEdgeClick({ point: at(600, 400), first: null, seed: at(50, 400), canReuseSeed: true })
    ).toEqual({ kind: 'mark', from: at(50, 400), to: at(600, 400) });
  });

  it('⚑ and an UNUSABLE seed does not silently become the first edge', () => {
    // A seed exists but the panel refused to reuse it: the click must start the
    // pair, not mark an axis from a corner the user was never told about.
    expect(
      resolveCategoryEdgeClick({ point: at(600, 400), first: null, seed: at(50, 400), canReuseSeed: false })
    ).toEqual({ kind: 'hold-first', point: at(600, 400) });
  });

  it('⚑ a stored first edge OUTRANKS the seed - it is the one the user placed', () => {
    expect(
      resolveCategoryEdgeClick({ point: at(600, 400), first: at(80, 400), seed: at(50, 400), canReuseSeed: true })
    ).toEqual({ kind: 'mark', from: at(80, 400), to: at(600, 400) });
  });
});

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
