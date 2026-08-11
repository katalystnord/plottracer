import { describe, it, expect } from 'vitest';
import { traceSpiderAlongSpokes, type SpokeRay } from '../spiderTrace.js';

/**
 * The axis-aware colour trace (v1.4).
 *
 * ⚑ What these tests are really guarding is the REFUSAL. Reading a crossing off a
 * ray is easy; the value of this tool over a generic curve trace is that it says
 * "I found three of these and cannot tell you which" instead of picking the
 * outermost and presenting a guess in the record's clothing. Half of what follows
 * is therefore about runs that should NOT become a reading.
 */

const W = 300;
const H = 300;
const ORIGIN = { x: 150, y: 150 };

/** Three spokes at 0 / 120 / 240 degrees, 100px long. */
const SPOKES: SpokeRay[] = [0, 120, 240].map((deg) => {
  const rad = (deg * Math.PI) / 180;
  return { ux: Math.sin(rad), uy: -Math.cos(rad), lengthPx: 100 };
});

function blankMask(): Uint8Array {
  return new Uint8Array(W * H);
}

/** The reading is the OUTER edge of the ink, so an expectation is "the boundary,
 * give or take the sampling step and pixel rounding" — never an exact float. */
function expectNear(actual: number | null, expected: number, tolerance = 1.5): void {
  expect(actual).not.toBeNull();
  expect(Math.abs(actual! - expected)).toBeLessThanOrEqual(tolerance);
}

/** Mark an annulus centred on the origin — a ring crossing EVERY spoke at `radius`,
 * which is what a closed radar polygon looks like to a ray walking outward. */
function markRing(mask: Uint8Array, radius: number, thickness = 4): void {
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const d = Math.hypot(x - ORIGIN.x, y - ORIGIN.y);
      if (Math.abs(d - radius) <= thickness / 2) mask[y * W + x] = 1;
    }
  }
}

/** Mark a filled disc — the hub of the web, or a centre dot. */
function markDisc(mask: Uint8Array, cx: number, cy: number, radius: number): void {
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (Math.hypot(x - cx, y - cy) <= radius) mask[y * W + x] = 1;
    }
  }
}

describe('traceSpiderAlongSpokes', () => {
  it('reads one crossing per ray, at the distance the colour actually crosses it', () => {
    const mask = blankMask();
    markRing(mask, 50);
    const found = traceSpiderAlongSpokes(mask, W, H, ORIGIN, SPOKES);

    expect(found).toHaveLength(3);
    for (const candidate of found) {
      expect(candidate.reason).toBeNull();
      expect(candidate.runs).toHaveLength(1);
      expect(candidate.atPx).not.toBeNull();
      // ⚑ 50 — the stroke's CENTRE, which is where the drawn ring actually is.
      // This expected 52, the stroke's outer edge, and that number WAS the defect
      // this file's premise: a stroked shape read at its far edge over-reads by
      // half its line width, and on the real bundled figure (whose vertices carry
      // markers) by a whole marker radius, uniformly, on every axis at once.
      // See SpokeRun.atPx and the PNG test in engine/__tests__/spiderTraceRun.
      expectNear(candidate.atPx, 50);
    }
  });

  it('reads a FILLED shape at its boundary, not at half its value', () => {
    // ⚑ The defect this file's first version shipped with, and the reason the
    // reading is the run's outer end. A filled radar polygon is ink from the hub
    // outwards, so a ray finds ONE run reaching from the centre to the vertex —
    // whose midpoint is half the number the figure states. That is the bar-midpoint
    // error (`59f94a6`) arriving on the one graph type where auto-extract is
    // allowed, wearing a plausible value.
    const mask = blankMask();
    markDisc(mask, ORIGIN.x, ORIGIN.y, 60);
    const found = traceSpiderAlongSpokes(mask, W, H, ORIGIN, SPOKES);

    for (const candidate of found) {
      expect(candidate.reason).toBeNull();
      expectNear(candidate.atPx, 60);
    }
  });

  it('is not dragged inward by a sharp vertex', () => {
    // At a spike — a value far above both its neighbours — the polygon's two edges
    // hug the ray, so the ink extends a long way back towards the centre. Reading
    // the middle of that would under-report the spike by an amount that depends on
    // how sharp it is: a wrong number whose error is invisible and unbounded.
    const mask = blankMask();
    const [ux, uy] = [SPOKES[0]!.ux, SPOKES[0]!.uy];
    for (let t = 40; t <= 90; t += 0.25) {
      // A wedge closing on the ray as it approaches t = 90.
      const halfWidth = (90 - t) / 3;
      for (let o = -halfWidth; o <= halfWidth; o += 0.5) {
        const x = Math.round(ORIGIN.x + t * ux - o * uy);
        const y = Math.round(ORIGIN.y + t * uy + o * ux);
        mask[y * W + x] = 1;
      }
    }
    const candidate = traceSpiderAlongSpokes(mask, W, H, ORIGIN, SPOKES)[0]!;
    expectNear(candidate.atPx, 90);
  });

  it('REFUSES to choose when a ray crosses the colour more than once', () => {
    // ⚑ The whole point of the tool. A grid ring drawn in a similar hue, a second
    // series, or the far edge of a filled polygon all produce a second run. Picking
    // the outermost would be a guess wearing the record's clothes — the exact defect
    // that got auto-extract refused on bars, where the midpoint it returned was
    // never the datum.
    const mask = blankMask();
    markRing(mask, 40);
    markRing(mask, 80);
    const found = traceSpiderAlongSpokes(mask, W, H, ORIGIN, SPOKES);

    for (const candidate of found) {
      expect(candidate.reason).toBe('ambiguous');
      expect(candidate.atPx).toBeNull();
      // ⚑ ...and it hands back BOTH, so the user can be shown what was found rather
      // than just told no. A refusal with no evidence is a dead end.
      expect(candidate.runs).toHaveLength(2);
      // The rings' own radii — see the first test on why this is not 42/82.
      expectNear(candidate.runs[0]!.atPx, 40);
      expectNear(candidate.runs[1]!.atPx, 80);
    }
  });

  it('says so when a ray crosses nothing at all', () => {
    const found = traceSpiderAlongSpokes(blankMask(), W, H, ORIGIN, SPOKES);
    for (const candidate of found) {
      expect(candidate.reason).toBe('none-found');
      expect(candidate.atPx).toBeNull();
      expect(candidate.runs).toHaveLength(0);
    }
  });

  it('ignores the hub, which every ray passes through', () => {
    // Without the centre exclusion a filled centre dot — or the point where the
    // series polygon's own outline meets itself — registers as a crossing on EVERY
    // axis at once, at a distance of nearly zero. That is not a reading; it is the
    // same pixel counted N times.
    const mask = blankMask();
    markDisc(mask, ORIGIN.x, ORIGIN.y, 3);
    markRing(mask, 60);
    const found = traceSpiderAlongSpokes(mask, W, H, ORIGIN, SPOKES);

    for (const candidate of found) {
      expect(candidate.runs).toHaveLength(1);
      expectNear(candidate.atPx, 60);
    }
  });

  it('discards speckle too short to be a drawn line', () => {
    // A single matched pixel is an antialiasing fringe, not a line. Left in, it
    // makes a clean single crossing read as ambiguous — a refusal caused by noise
    // rather than by real doubt, which trains the user to ignore the refusals.
    const mask = blankMask();
    markRing(mask, 70);
    const [ux, uy] = [SPOKES[0]!.ux, SPOKES[0]!.uy];
    const sx = Math.round(ORIGIN.x + 30 * ux);
    const sy = Math.round(ORIGIN.y + 30 * uy);
    mask[sy * W + sx] = 1;

    const found = traceSpiderAlongSpokes(mask, W, H, ORIGIN, SPOKES);
    expect(found[0]!.reason).toBeNull();
    expect(found[0]!.runs).toHaveLength(1);
    expectNear(found[0]!.atPx, 70);
  });

  it('looks a little past the calibrated known point, but not indefinitely', () => {
    // A series may legitimately exceed the axis's labelled maximum, so stopping dead
    // at the known point would silently drop those readings. The overshoot is
    // bounded, though: past it the ray is off the figure, where whatever matches is
    // a legend swatch or a caption, not the series.
    const near = blankMask();
    markRing(near, 108); // 8% past a 100px spoke
    expectNear(traceSpiderAlongSpokes(near, W, H, ORIGIN, SPOKES)[0]!.atPx, 108);

    const far = blankMask();
    markRing(far, 130); // 30% past — outside the default 15% overshoot
    expect(traceSpiderAlongSpokes(far, W, H, ORIGIN, SPOKES)[0]!.reason).toBe('none-found');
  });

  it('REFUSES a crossing that was cut off by the search limit', () => {
    // ⚑ Release-audit finding. A run still open when the walk stops was pushed with
    // its end AT the limit and reported as one clean crossing — so every clipped
    // axis recorded exactly centre + (known − centre) × 1.15: a number produced by
    // the search window, not by the figure, and flagged as unambiguous. It happens
    // whenever a series exceeds the labelled maximum by more than the overshoot, or
    // the user calibrated the known point on an inner ring. The evidence to detect
    // it was already there — the run ends exactly at maxPx — and was unused.
    const mask = blankMask();
    const [ux, uy] = [SPOKES[0]!.ux, SPOKES[0]!.uy];
    for (let t = 100; t <= 130; t += 0.25) {
      const x = Math.round(ORIGIN.x + t * ux);
      const y = Math.round(ORIGIN.y + t * uy);
      mask[y * W + x] = 1; // ink running out past the 115px search limit
    }
    const candidate = traceSpiderAlongSpokes(mask, W, H, ORIGIN, SPOKES)[0]!;
    expect(candidate.atPx).toBeNull();
    expect(candidate.reason).toBe('clipped');
  });

  it('stops at the edge of the image instead of reading past it', () => {
    // A spoke pointing at the border runs out of pixels before it runs out of
    // length. Sampling off the buffer must read as "no colour here", not as a hit on
    // whatever the row-major index wraps onto — which would be a crossing invented
    // out of a neighbouring row.
    // ⚑ This assertion USED TO BE VACUOUS, and the release audit caught it: the ring
    // was drawn about the image's centre while the ray started at x=290 heading
    // right, so no sample could ever match, `runs` was empty, and `.every()` was
    // true whether the bounds check existed or not. Neutering the guard it names
    // did not fail it. Now the ink is ON the ray, just beyond the edge of the
    // image, so the test can only pass if sampling stops at the border.
    const mask = blankMask();
    const originX = 290;
    for (let x = originX; x < W; x++) for (let y = 148; y <= 152; y++) mask[y * W + x] = 1;
    const edge: SpokeRay[] = [{ ux: 1, uy: 0, lengthPx: 400 }];
    const found = traceSpiderAlongSpokes(mask, W, H, { x: originX, y: 150 }, edge);
    // The ink runs to x=299 (the last column), i.e. 9px along the ray — never the
    // 400px the spoke claims, and never a wrapped hit on the next row.
    expect(found[0]!.runs.length).toBeGreaterThan(0);
    expect(found[0]!.runs.every((r) => r.toPx <= 10)).toBe(true);
  });
});
