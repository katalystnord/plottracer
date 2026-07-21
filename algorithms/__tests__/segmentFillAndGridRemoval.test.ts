import { describe, it, expect } from 'vitest';
import {
  floodFill,
  pointsFromColumnRuns,
  orderByNearestNeighbour,
  subsample,
} from '../segmentFill.js';
import { removeGridLinesOp, hexToRGB } from '../gridRemoval.js';

/** Builds a flat RGBA buffer for a `width`x`height` image, solid `bg` everywhere. */
function makeImage(width: number, height: number, bg: [number, number, number]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = bg[0];
    data[i + 1] = bg[1];
    data[i + 2] = bg[2];
    data[i + 3] = 255;
  }
  return data;
}

function setPixel(data: Uint8ClampedArray, width: number, x: number, y: number, rgb: [number, number, number]): void {
  const i = (y * width + x) * 4;
  data[i] = rgb[0];
  data[i + 1] = rgb[1];
  data[i + 2] = rgb[2];
  data[i + 3] = 255;
}

describe('segmentFill', () => {
  it('flood-fills a straight diagonal line of matching-color pixels', () => {
    const width = 10;
    const height = 10;
    const data = makeImage(width, height, [255, 255, 255]);
    // Draw a diagonal line of black pixels from (0,0) to (9,9).
    for (let i = 0; i < 10; i++) setPixel(data, width, i, i, [0, 0, 0]);

    const result = floodFill(data, width, height, 0, 0, 10);
    // 4-connected flood fill on a strict diagonal only reaches the seed
    // pixel itself (diagonal neighbors aren't 4-connected) — confirms the
    // connectivity rule is preserved faithfully from the original.
    expect(result.filled).toBe(1);
  });

  it('flood-fills a connected horizontal line fully', () => {
    const width = 10;
    const height = 3;
    const data = makeImage(width, height, [255, 255, 255]);
    for (let x = 0; x < 10; x++) setPixel(data, width, x, 1, [0, 0, 0]);

    const result = floodFill(data, width, height, 5, 1, 10);
    expect(result.filled).toBe(10);

    const points = pointsFromColumnRuns(result.mask, width, height);
    expect(points).toHaveLength(10);
    expect(points.every((p) => p.y === 1)).toBe(true);
  });

  it('the mask holds only pixels that PASSED the colour test, not every pixel examined', () => {
    // The regression this pins: `visited` was BFS bookkeeping doing double duty
    // as the output mask, so every rejected pixel was in it and the trace was
    // the fill dilated by 1px. A 1px line exported THREE columns.
    //
    // The old test above could never have caught it -- a dilated column
    // (y=0,1,2) still has median y=1, so the two bugs cancelled. Verified by
    // execution 2026-07-16.
    const width = 11;
    const height = 9;
    const data = makeImage(width, height, [255, 255, 255]);
    for (const y of [3, 4, 5]) setPixel(data, width, 5, y, [0, 0, 0]);

    const result = floodFill(data, width, height, 5, 4, 10);
    expect(result.filled).toBe(3);

    const points = pointsFromColumnRuns(result.mask, width, height);
    expect(points).toEqual([{ x: 5, y: 4 }]); // ONE column, at the line's centre
  });

  it('subsample returns evenly-spaced points capped at maxPoints, including BOTH endpoints', () => {
    const points = Array.from({ length: 100 }, (_, i) => ({ x: i, y: 0 }));
    const sub = subsample(points, 10);
    expect(sub).toHaveLength(10);
    expect(sub[0]).toEqual({ x: 0, y: 0 });
    // The old step dropped points 91-99 entirely, landing on 90. On a
    // stress-strain trace the final point is the failure point.
    expect(sub[sub.length - 1]).toEqual({ x: 99, y: 0 });
  });

  it('subsample handles a maxPoints of 1 without dividing by zero', () => {
    const points = Array.from({ length: 10 }, (_, i) => ({ x: i, y: 0 }));
    expect(subsample(points, 1)).toEqual([{ x: 0, y: 0 }]);
  });

  it('subsample returns the input unchanged when already under the cap', () => {
    const points = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
    expect(subsample(points, 10)).toBe(points);
  });
});

describe('segmentFill — curves that double back (checkpoint 78)', () => {
  /** Draws `on` pixels black on white and returns the buffer. */
  function shape(width: number, height: number, on: readonly [number, number][]): Uint8ClampedArray {
    const data = makeImage(width, height, [255, 255, 255]);
    for (const [x, y] of on) setPixel(data, width, x, y, [0, 0, 0]);
    return data;
  }

  /** A C: an upper branch at y=2 and a lower at y=8, joined at x=8. */
  const cShape: [number, number][] = [];
  for (let x = 2; x <= 8; x++) {
    cShape.push([x, 2]);
    cShape.push([x, 8]);
  }
  for (let y = 2; y <= 8; y++) cShape.push([8, y]);

  it('recovers BOTH branches — the old median kept only one and looked immaculate', () => {
    // THE bug this checkpoint exists for. orderByColumnMedian on this exact
    // shape, with a correct mask, gave upperKept=0 / lowerKept=6: the entire
    // upper branch silently deleted, and the surviving 7 points all genuinely
    // on the figure -- so the output looked perfect and was half a curve.
    // Verified by execution, 2026-07-16. These are the shapes the tool is for:
    // hysteresis, unloading, stress-strain past peak.
    const data = shape(12, 12, cShape);
    const { mask } = floodFill(data, 12, 12, 2, 2, 10);
    const points = pointsFromColumnRuns(mask, 12, 12);

    expect(points.some((p) => p.y === 2)).toBe(true); // upper branch survived
    expect(points.some((p) => p.y === 8)).toBe(true); // lower branch survived
    const upperCols = points.filter((p) => p.y === 2).length;
    expect(upperCols).toBeGreaterThan(4); // the whole branch, not a stray point
  });

  it('never reports a point that is not on the figure', () => {
    // Distinct from the branch loss above, and worth its own test because the
    // two were confused while diagnosing this: a median can only ever return a
    // y from its own column, so it never invented anything. The
    // points-in-empty-space the audit saw came from the DILATION bug corrupting
    // the pixel list it sampled. Losing data and inventing data are different
    // failures; this pins the second one for the new code.
    const data = shape(12, 12, cShape);
    const { mask } = floodFill(data, 12, 12, 2, 2, 10);
    const points = pointsFromColumnRuns(mask, 12, 12);

    const onCurve = points.filter((p) => cShape.some(([x, y]) => x === p.x && y === p.y));
    expect(onCurve).toHaveLength(points.length);
  });

  it('emits one point per branch in a column that crosses both', () => {
    const data = shape(12, 12, cShape);
    const { mask } = floodFill(data, 12, 12, 2, 2, 10);
    const points = pointsFromColumnRuns(mask, 12, 12);
    const atX5 = points.filter((p) => p.x === 5).map((p) => p.y).sort((a, b) => a - b);
    expect(atX5).toEqual([2, 8]); // NOT [5] -- the median of the two
  });

  it('never invents a point in the whitespace between two branches', () => {
    const data = shape(12, 12, cShape);
    const { mask } = floodFill(data, 12, 12, 2, 2, 10);
    const points = pointsFromColumnRuns(mask, 12, 12);
    // x=2..7 have branches only at y=2 and y=8; the interior is blank.
    const invented = points.filter((p) => p.x < 8 && p.y > 2 && p.y < 8);
    expect(invented).toEqual([]);
  });

  it('walks a doubling-back curve into curve order, which sorting by x cannot', () => {
    // Column order zigzags upper-lower-upper-lower-... Curve order runs along
    // one branch, round the turn, and back along the other -- so each branch is
    // traversed as ONE contiguous stretch. That is what x-sorting destroys and
    // what the NN walk restores; it is the whole reason this half exists.
    const data = shape(12, 12, cShape);
    const { mask } = floodFill(data, 12, 12, 2, 2, 10);
    const ordered = orderByNearestNeighbour(pointsFromColumnRuns(mask, 12, 12));

    // How many times the walk switches branch. Curve order: exactly once
    // (via the turn). Column order would switch on every single point.
    const branch = ordered.map((p) => (p.y <= 2 ? 'upper' : p.y >= 8 ? 'lower' : 'turn'));
    const switches = branch.slice(1).filter((b, i) => b !== branch[i]).length;
    expect(switches).toBeLessThanOrEqual(2); // upper -> turn -> lower
  });

  it('collapses a VERTICAL run to one point per column — lossy, but never invented', () => {
    // Found by this checkpoint's own test failing (2026-07-16), and worth
    // pinning rather than hiding: column scanning takes one point per run, so
    // the C's vertical turn (x=8, y=2..8) becomes a single point at its centre.
    // Information is lost.
    //
    // But the point it emits, (8,5), IS a real curve pixel -- which is exactly
    // the line this checkpoint draws. The old median collapse INVENTED points
    // in empty space; this one under-samples a real feature. Lossy is
    // recoverable (trace it as two segments, or place points by hand);
    // fabricated is not, because nothing on screen says it happened.
    //
    // Inherent to column scanning, and WPD's averaging window has the same
    // property. Fixing it means row scanning or a skeleton -- a different
    // design, not a patch. Logged, not chased.
    const data = shape(12, 12, cShape);
    const { mask } = floodFill(data, 12, 12, 2, 2, 10);
    const atX8 = pointsFromColumnRuns(mask, 12, 12).filter((p) => p.x === 8);

    expect(atX8).toEqual([{ x: 8, y: 5 }]);
    expect(cShape.some(([x, y]) => x === 8 && y === 5)).toBe(true); // on the curve
  });

  it('leaves a monotonic curve in its natural left-to-right order (the common case)', () => {
    // The regression guard: the everyday trace must not move.
    const on: [number, number][] = [];
    for (let x = 0; x < 10; x++) on.push([x, x]);
    const data = shape(10, 10, on);
    // 4-connected: a strict diagonal isn't connected, so draw it as a staircase.
    for (let x = 1; x < 10; x++) setPixel(data, 10, x, x - 1, [0, 0, 0]);

    const { mask } = floodFill(data, 10, 10, 0, 0, 10);
    const ordered = orderByNearestNeighbour(pointsFromColumnRuns(mask, 10, 10));
    expect(ordered.map((p) => p.x)).toEqual([...ordered.map((p) => p.x)].sort((a, b) => a - b));
  });

  it('splits two branches but not a thick line with an anti-aliasing hole', () => {
    // The run-gap rule earns its keep here: a 1px hole must not become a second
    // branch, while real branches (separated by plot whitespace) must split.
    const data = makeImage(12, 12, [255, 255, 255]);
    for (const y of [3, 4, 6]) setPixel(data, 12, 5, y, [0, 0, 0]); // hole at y=5
    setPixel(data, 12, 5, 10, [0, 0, 0]); // a genuinely separate branch
    const { mask } = floodFill(data, 12, 12, 5, 3, 10);

    const ys = pointsFromColumnRuns(mask, 12, 12).map((p) => p.y);
    // The 3,4,(5),6 group is ONE run; y=10 never joins the fill at all.
    expect(ys).toEqual([4]);
  });
});

describe('gridRemoval', () => {
  it('replaces pixels within tolerance of the grid color, leaves others untouched', () => {
    const width = 3;
    const height = 1;
    const data = makeImage(width, height, [255, 255, 255]);
    setPixel(data, width, 1, 0, [200, 200, 200]); // "grid line" pixel

    const result = removeGridLinesOp(data, width, height, [200, 200, 200], [255, 255, 255], 10);
    // Middle pixel (grid) replaced with white; outer pixels untouched.
    expect(Array.from(result.data.slice(0, 3))).toEqual([255, 255, 255]);
    expect(Array.from(result.data.slice(4, 7))).toEqual([255, 255, 255]);
    expect(Array.from(result.data.slice(8, 11))).toEqual([255, 255, 255]);
  });

  it('hexToRGB converts a hex color string to an RGB triple', () => {
    expect(hexToRGB('#c8c8c8')).toEqual([200, 200, 200]);
    expect(hexToRGB('#000000')).toEqual([0, 0, 0]);
    expect(hexToRGB('#ffffff')).toEqual([255, 255, 255]);
  });
});
