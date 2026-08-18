import { describe, expect, it } from 'vitest';
import {
  detectDividers,
  proposeAllDividers,
  proposeDividers,
  reconcileWithCount,
  type PlotBox,
} from '../gridDetect.js';
import type { RGB } from '../colorFilter.js';

/**
 * Boundary detection's own logic, on figures built to order.
 *
 * ⚑ MUTATION: 84.62% (scoped throwaway config; recipe in `colorBar.test.ts`).
 * Lower than this project's pure modules usually run, and the reason is
 * structural rather than untested code: the MERGE step makes the peak
 * comparisons partly redundant. A boundary that spans two pixels produces two
 * elevated profile entries, and whether the crest is picked by comparing
 * neighbours or both entries are taken and merged, the boundary lands in the
 * same place. Belt and braces reads as surviving mutants. The rest are the two
 * families already documented for `colorBar.ts` - out-of-bounds reads that come
 * back as "nothing" either way, and thresholds mutated at a measure-zero point.
 *
 * ⚑ The real renders (`engine/__tests__/gridDetectRealPng.test.ts`) answer "does
 * it find a published figure's boundaries" - they draw NO cell borders, which is
 * the harder case. What they cannot produce on demand is a printed white RULE, a
 * rotated scan, a boundary too faint to see, or a change that happens in only
 * part of a column. Those are drawn here.
 */

const W = 240;
const H = 160;
const BOX: PlotBox = [
  { x: 20, y: 140 },
  { x: 220, y: 140 },
  { x: 20, y: 20 },
  { x: 220, y: 20 },
];

function blank(): Uint8ClampedArray {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  return data;
}

function fill(
  data: Uint8ClampedArray,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  rgb: RGB
): void {
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const i = (y * W + x) * 4;
      data[i] = rgb[0];
      data[i + 1] = rgb[1];
      data[i + 2] = rgb[2];
      data[i + 3] = 255;
    }
}

/** Three columns of distinct colour filling the box: boundaries at 0.25 and
 * 0.75 of it. */
function threeColumns(): Uint8ClampedArray {
  const data = blank();
  fill(data, 20, 20, 70, 140, [200, 40, 40]);
  fill(data, 70, 20, 170, 140, [40, 200, 40]);
  fill(data, 170, 20, 220, 140, [40, 40, 200]);
  return data;
}

describe('detectDividers', () => {
  it('finds a bare colour discontinuity', () => {
    const { candidates } = detectDividers(threeColumns(), W, H, BOX, 'x');
    const positions = candidates.map((c) => c.position).sort((a, b) => a - b);
    expect(positions).toHaveLength(2);
    expect(positions[0]).toBeCloseTo(0.25, 2);
    expect(positions[1]).toBeCloseTo(0.75, 2);
  });

  it('puts a DRAWN RULE’s boundary in the middle of the rule', () => {
    // ⚑ A printed border changes colour twice - once entering it, once leaving -
    // and a naive peak finder calls a 4px rule two boundaries 4px apart, which
    // makes a cell with no interior between them. The merge puts one boundary at
    // the rule's centre, where the figure says it is.
    const data = threeColumns();
    fill(data, 68, 20, 72, 140, [255, 255, 255]);
    const { candidates } = detectDividers(data, W, H, BOX, 'x');
    const positions = candidates.map((c) => c.position).sort((a, b) => a - b);
    expect(positions).toHaveLength(2);
    expect(positions[0]).toBeCloseTo(0.25, 2);
  });

  it('scans DOWN the other axis when asked, in the box’s own frame', () => {
    const data = blank();
    // Two rows: the split is at pixel y = 80, which is halfway UP the box, and
    // the y axis runs from the origin corner (y = 140) upward.
    fill(data, 20, 80, 220, 140, [200, 40, 40]);
    fill(data, 20, 20, 220, 80, [40, 40, 200]);
    const { candidates } = detectDividers(data, W, H, BOX, 'y');
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.position).toBeCloseTo(0.5, 2);
  });

  it('ignores a change that happens in only PART of a column', () => {
    // ⚑ The difference between a boundary and DATA. One cell of a column being a
    // different colour is exactly what a heatmap looks like; a boundary is a
    // change all the way across. Taking the median of the cross-section is what
    // draws that line - a mean would call this a boundary.
    const data = blank();
    fill(data, 20, 20, 220, 140, [120, 120, 120]);
    fill(data, 120, 20, 220, 50, [220, 40, 40]); // one cell, top-right
    const { candidates } = detectDividers(data, W, H, BOX, 'x');
    expect(candidates).toHaveLength(0);
  });

  it('MISSES a boundary too faint to see, rather than inventing one', () => {
    // Two adjacent cells whose values are nearly equal have a boundary that is
    // not in the figure to be found. Reporting it would mean lowering the floor
    // until noise qualifies.
    const data = blank();
    fill(data, 20, 20, 120, 140, [120, 120, 120]);
    fill(data, 120, 20, 220, 140, [122, 122, 122]);
    expect(detectDividers(data, W, H, BOX, 'x').candidates).toHaveLength(0);
    // …and the caller is told, rather than left to assume the figure has one cell.
    const report = reconcileWithCount([], 2);
    expect(report.agrees).toBe(false);
    expect(report.missing).toBe(1);
  });

  it('still sees a boundary that is INTERRUPTED across part of the figure', () => {
    // ⚑ The other half of "all the way across". A rule broken by an overlaid
    // annotation, or a row of cells that happens to match its neighbour, changes
    // over most of the column but not all of it - and that is still a boundary.
    // Taking the MEDIAN of the cross-section is what gets both this and the
    // one-cell case above right; a mean gets neither, and reading the middle
    // sample without sorting gets exactly this one wrong.
    for (const crossSamples of [24, 25]) {
      const data = blank();
      fill(data, 20, 20, 220, 140, [120, 120, 120]);
      // The change covers the top and bottom of the column but not its middle.
      fill(data, 120, 20, 220, 55, [220, 40, 40]);
      fill(data, 120, 105, 220, 140, [220, 40, 40]);
      const { candidates } = detectDividers(data, W, H, BOX, 'x', { crossSamples });
      expect(candidates, `crossSamples ${crossSamples}`).toHaveLength(1);
      expect(candidates[0]!.position).toBeCloseTo(0.5, 1);
    }
  });

  it('counts a change of exactly the floor as a boundary', () => {
    // The threshold is "smaller than", not "no bigger than": a change exactly at
    // the floor is the smallest one that is not rounding.
    const data = blank();
    fill(data, 20, 20, 120, 140, [100, 100, 100]);
    fill(data, 120, 20, 220, 140, [108, 100, 100]); // distance exactly 8
    expect(detectDividers(data, W, H, BOX, 'x').candidates).toHaveLength(1);
    fill(data, 120, 20, 220, 140, [107, 100, 100]); // distance 7
    expect(detectDividers(data, W, H, BOX, 'x').candidates).toHaveLength(0);
  });

  it('ranks by how firm each boundary is', () => {
    const data = blank();
    fill(data, 20, 20, 90, 140, [10, 10, 10]);
    fill(data, 90, 20, 160, 140, [250, 250, 250]); // a huge step
    fill(data, 160, 20, 220, 140, [235, 235, 235]); // a small one
    const { candidates } = detectDividers(data, W, H, BOX, 'x');
    expect(candidates).toHaveLength(2);
    expect(candidates[0]!.strength).toBeGreaterThan(candidates[1]!.strength);
    expect(candidates[0]!.position).toBeCloseTo(0.35, 2);
  });

  it('reads a ROTATED figure in its own frame', () => {
    // A scanned page. The box is a rotated quadrilateral and the columns are not
    // the image's columns, so scanning image rows would find nothing at all.
    const angle = 0.25;
    const rotate = (p: { x: number; y: number }) => ({
      x: 120 + (p.x - 120) * Math.cos(angle) - (p.y - 80) * Math.sin(angle),
      y: 80 + (p.x - 120) * Math.sin(angle) + (p.y - 80) * Math.cos(angle),
    });
    const box: PlotBox = [
      rotate({ x: 40, y: 130 }),
      rotate({ x: 200, y: 130 }),
      rotate({ x: 40, y: 30 }),
      rotate({ x: 200, y: 30 }),
    ];
    const data = blank();
    for (let u = 0; u <= 400; u++)
      for (let v = 0; v <= 300; v++) {
        const p = rotate({ x: 40 + (u / 400) * 160, y: 130 - (v / 300) * 100 });
        const x = Math.round(p.x);
        const y = Math.round(p.y);
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const i = (y * W + x) * 4;
        const rgb: RGB = u < 160 ? [200, 40, 40] : [40, 40, 200];
        data[i] = rgb[0];
        data[i + 1] = rgb[1];
        data[i + 2] = rgb[2];
        data[i + 3] = 255;
      }
    const { candidates } = detectDividers(data, W, H, box, 'x');
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.position).toBeCloseTo(0.4, 1);
  });

  it('scans at the resolution of the axis it was asked about', () => {
    // ⚑ The box is 200px wide and 120px tall, so scanning x must take 200 steps
    // and y 120 - not the other way round, and not the shorter of the two. A
    // scan at the wrong resolution still finds wide boundaries and quietly loses
    // narrow ones, which is the kind of wrong that only shows up on the one
    // figure that mattered.
    expect(detectDividers(threeColumns(), W, H, BOX, 'x').profile).toHaveLength(200);
    expect(detectDividers(threeColumns(), W, H, BOX, 'y').profile).toHaveLength(120);
  });

  it('scans a TRAPEZOID at its longer edge, so the short side is not under-sampled', () => {
    // A photographed page is not a rectangle. Taking the shorter of the two
    // opposite edges would sample the longer one at less than pixel resolution.
    const trapezoid: PlotBox = [
      { x: 20, y: 140 },
      { x: 120, y: 140 },
      { x: 20, y: 20 },
      { x: 220, y: 20 },
    ];
    expect(detectDividers(threeColumns(), W, H, trapezoid, 'x').profile).toHaveLength(200);
  });

  it('is empty for a box with no extent', () => {
    const degenerate: PlotBox = [
      { x: 20, y: 20 },
      { x: 20, y: 20 },
      { x: 20, y: 20 },
      { x: 20, y: 20 },
    ];
    const result = detectDividers(threeColumns(), W, H, degenerate, 'x');
    expect(result.candidates).toEqual([]);
    expect(result.profile).toEqual([]);
  });

  it('treats pixels that are not there as absent, not as a change', () => {
    // A box dragged off the canvas, or a transparent figure. "Nothing" must not
    // register as a colour, or the image's edge becomes a boundary.
    const data = threeColumns();
    const offImage: PlotBox = [
      { x: 400, y: 400 },
      { x: 600, y: 400 },
      { x: 400, y: 300 },
      { x: 600, y: 300 },
    ];
    expect(detectDividers(data, W, H, offImage, 'x').candidates).toEqual([]);
    // ⚑ Every side separately. A guard that checks three of the four looks
    // exactly like one that checks all of them, until a box is dragged off the
    // fourth - and then it reads whatever the buffer holds and calls the change
    // a boundary.
    const outside = (dx: number, dy: number): PlotBox => [
      { x: 20 + dx, y: 140 + dy },
      { x: 220 + dx, y: 140 + dy },
      { x: 20 + dx, y: 20 + dy },
      { x: 220 + dx, y: 20 + dy },
    ];
    for (const [dx, dy] of [
      [-400, 0],
      [400, 0],
      [0, -400],
      [0, 400],
    ] as Array<[number, number]>) {
      const result = detectDividers(data, W, H, outside(dx, dy), 'x');
      expect(result.candidates, `offset ${dx},${dy}`).toEqual([]);
      expect(result.profile.every((v) => Number.isFinite(v)), `offset ${dx},${dy}`).toBe(true);
    }
    for (let y = 20; y < 140; y++)
      for (let x = 20; x < 220; x++) data[(y * W + x) * 4 + 3] = 0;
    expect(detectDividers(data, W, H, BOX, 'x').candidates).toEqual([]);
  });

  it('returns the profile, so a user can SEE why something was or was not found', () => {
    const { profile } = detectDividers(threeColumns(), W, H, BOX, 'x');
    expect(profile.length).toBeGreaterThan(150);
    expect(Math.max(...profile)).toBeGreaterThan(100);
    // Flat inside the cells: the peaks are the whole story. Three of them, not
    // two - the box's far edge is a change too, and the PROFILE keeps it. Only
    // the candidate list drops the edges, because only the candidates are a
    // proposal; the profile is the evidence, and hiding part of the evidence
    // would defeat the point of returning it.
    expect(profile.filter((v) => v > 8)).toHaveLength(3);
    expect(detectDividers(threeColumns(), W, H, BOX, 'x').candidates).toHaveLength(2);
  });
});

describe('proposeDividers', () => {
  // ⚑ Deliberately NOT in strength order: the weakest comes first, so taking
  // "the first n" without ranking picks the wrong boundaries. An earlier version
  // listed them strongest-first and could not tell a real sort from no sort.
  const candidates = [
    { position: 0.4, strength: 12 },
    { position: 0.75, strength: 60 },
    { position: 0.25, strength: 90 },
  ];

  it('takes the strongest n−1 and adds the box’s own edges', () => {
    expect(proposeDividers(candidates, 3)).toEqual([0, 0.25, 0.75, 1]);
    expect(proposeDividers(candidates, 4)).toEqual([0, 0.25, 0.4, 0.75, 1]);
  });

  it('gives a single cell its two edges and nothing else', () => {
    expect(proposeDividers(candidates, 1)).toEqual([0, 1]);
  });

  it('handles the smallest real split - two cells, one boundary', () => {
    expect(proposeDividers(candidates, 2)).toEqual([0, 0.25, 1]);
  });

  it('returns NULL rather than a grid with a boundary missing', () => {
    // ⚑ A short grid looks exactly like a grid, and its cells are silently twice
    // as wide as the figure's. The user is told instead.
    expect(proposeDividers(candidates, 6)).toBeNull();
    expect(proposeDividers([], 3)).toBeNull();
    expect(proposeDividers(candidates, 0)).toBeNull();
    expect(proposeDividers(candidates, 2.5)).toBeNull();
  });

  it('offers everything it found when there is no count to declare', () => {
    expect(proposeAllDividers(candidates)).toEqual([0, 0.25, 0.4, 0.75, 1]);
    expect(proposeAllDividers([])).toEqual([0, 1]);
  });
});

describe('reconcileWithCount', () => {
  it('reports agreement, and how many are missing when it does not', () => {
    const three = [
      { position: 0.25, strength: 90 },
      { position: 0.5, strength: 80 },
    ];
    expect(reconcileWithCount(three, 3)).toEqual({
      agrees: true,
      found: 2,
      expected: 2,
      missing: 0,
    });
    expect(reconcileWithCount(three, 5).missing).toBe(2);
    // More found than declared is also a disagreement worth reporting - the
    // figure may have a boundary the user did not count.
    expect(reconcileWithCount(three, 2)).toEqual({
      agrees: false,
      found: 2,
      expected: 1,
      missing: -1,
    });
  });

  it('treats a nonsense count as no count at all', () => {
    expect(reconcileWithCount([], 0).expected).toBe(0);
    expect(reconcileWithCount([], -4).expected).toBe(0);
    expect(reconcileWithCount([], 1.5).expected).toBe(0);
  });
});
