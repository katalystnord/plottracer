import { describe, it, expect } from 'vitest';

import { joinAcrossHatch, MIN_HATCH_PIECES, MAX_HATCH_GAP_PX } from '../hatchJoin.js';
import type { Blob } from '../blobDetect.js';

/**
 * ⚑⚑ A HATCHED BAR ARRIVES AS CONFETTI, AND ITS OWN SPACING IS THE EVIDENCE.
 *
 * The benchmark corpus made this concrete: matplotlib hatches every bar in the
 * Adobe CHART-Synthetic set, so the colour filter drops the hatch lines and
 * flood-fill connectivity returns ~34 fragments per bar. None overlaps the true
 * bar by half, so a perfectly drawn bar scores ZERO, and the corpus reads 35.3%
 * against 76.1% on real published figures. Declaring the axis and the baseline
 * changes nothing (35.3% -> 35.3%): the fragmentation happens first.
 *
 * ⚑⚑ WHY NO FOURIER TRANSFORM HERE, when the repo already proved one works.
 * `hatch-probe.py` established that a hatch is a 1D frequency peak along the bar
 * (Adobe median prominence 23.2 against real figures' 2.65, period 32.1px
 * matching a hand pixel-scan of 33.2px). That is the right instrument for asking
 * *"is this bar hatched?"* of a bar you already have. But for JOINING we are
 * holding the fragments themselves, and their geometry already carries the
 * period exactly: aligned, regularly spaced, separated by small gaps. The
 * evidence is in what the detector returned, so no transform is needed and none
 * is done.
 *
 * ⚑⚑ IT MIRRORS `joinAcrossBaseline`, deliberately - same file, same
 * `sameCategoryExtent` rule, same "put the shape back together BEFORE anything
 * reads it" position in the pipeline. A bar severed by a baseline rule and a bar
 * shredded by a hatch are one problem: the figure drew something across a bar in
 * a colour the filter drops.
 *
 * ⛔ AND IT MAY ONLY CORROBORATE. The standing rule for every bar technique here
 * (`project_bar_separation_retake`: every unconditional technique FAILED) is that
 * it must be gated by evidence, so the population it cannot help is provably
 * untouched. The gate is REGULARITY: three or more aligned pieces, small gaps,
 * and a consistent pitch. Two pieces with one gap is not a hatch and is left
 * alone - that case belongs to `joinAcrossBaseline`, which has its own gate.
 */

/** A blob with only what the join reads: its box and its area. */
function blob(minX: number, minY: number, maxX: number, maxY: number): Blob {
  const area = Math.max(1, (maxX - minX) * (maxY - minY));
  return {
    centroid: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
    area,
    diameter: 2 * Math.sqrt(area / Math.PI),
    bbox: { minX, minY, maxX, maxY },
  };
}

/** One upright bar at x 100..140, shredded into `pieces` by a periodic hatch. */
function shredded(pieces: number, gap = 5, run = 27, top = 100): Blob[] {
  return Array.from({ length: pieces }, (_, i) =>
    blob(100, top + i * (run + gap), 140, top + i * (run + gap) + run)
  );
}

describe('a hatched bar is put back together before anything reads it', () => {
  it('⚑⚑ joins the pieces of one shredded bar into one shape', () => {
    const out = joinAcrossHatch(shredded(8), 'x');
    expect(out.joined).toBe(1);
    expect(out.blobs).toHaveLength(1);
    // The whole bar: from the first piece's top to the last piece's foot.
    expect(out.blobs[0]!.bbox).toEqual({ minX: 100, minY: 100, maxX: 140, maxY: 351 });
  });

  it('reports the area of the ink it actually saw, not of the box it spans', () => {
    // ⚑ The gaps are hatch LINES - the figure drew them, we did not measure ink
    // there. A joined blob claiming the box's full area would be asserting
    // pixels nobody matched, and the size filters read this number.
    const pieces = shredded(8);
    const out = joinAcrossHatch(pieces, 'x');
    expect(out.blobs[0]!.area).toBe(pieces.reduce((n, b) => n + b.area, 0));
  });

  it('leaves a solid bar exactly as it was', () => {
    const solid = [blob(100, 100, 140, 355)];
    const out = joinAcrossHatch(solid, 'x');
    expect(out.joined).toBe(0);
    expect(out.blobs).toEqual(solid);
  });

  it('⛔ refuses TWO pieces with one gap - that is not a hatch', () => {
    // A bar cut once is the BASELINE case, and `joinAcrossBaseline` owns it with
    // its own gate (the user's declared baseline). Joining it here would act on
    // a shape with no periodic evidence at all.
    const out = joinAcrossHatch(shredded(2), 'x');
    expect(out.joined).toBe(0);
    expect(out.blobs).toHaveLength(2);
  });

  it('⛔ refuses pieces separated by a gap far wider than a drawn line', () => {
    // Two genuinely separate bars in one column - a stacked chart of the same
    // colour, or a bar and a legend swatch above it. Nothing periodic about it.
    const out = joinAcrossHatch(shredded(4, MAX_HATCH_GAP_PX + 6), 'x');
    expect(out.joined).toBe(0);
  });

  it('⛔ refuses pieces whose spacing is irregular', () => {
    // ⚑ THE REGULARITY IS THE WHOLE GATE. A hatch repeats; three shapes that
    // happen to stack with assorted gaps are three shapes.
    const ragged = [
      blob(100, 100, 140, 130),
      blob(100, 135, 140, 190),
      blob(100, 195, 140, 205),
      blob(100, 210, 140, 260),
    ];
    const out = joinAcrossHatch(ragged, 'x');
    expect(out.joined).toBe(0);
  });

  it('does not join pieces that sit in different categories', () => {
    // Side-by-side bars: they share no slice of the category axis, so they are
    // never candidates however regular their own pieces are.
    const left = shredded(6);
    const right = shredded(6).map((b) =>
      blob(b.bbox.minX + 60, b.bbox.minY, b.bbox.maxX + 60, b.bbox.maxY)
    );
    const out = joinAcrossHatch([...left, ...right], 'x');
    expect(out.joined).toBe(2);
    expect(out.blobs).toHaveLength(2);
    expect(out.blobs.map((b) => b.bbox.minX).sort((a, b) => a - b)).toEqual([100, 160]);
  });

  it('joins a horizontal chart along its own value axis', () => {
    // ⚑ Direction-agnostic, like every other bar technique here: `categoryAxis`
    // names which way the categories run and the pieces stack along the other.
    const pieces = Array.from({ length: 6 }, (_, i) => blob(100 + i * 32, 200, 127 + i * 32, 240));
    const out = joinAcrossHatch(pieces, 'y');
    expect(out.joined).toBe(1);
    expect(out.blobs[0]!.bbox).toEqual({ minX: 100, minY: 200, maxX: 287, maxY: 240 });
  });

  it('needs at least the declared number of pieces', () => {
    expect(joinAcrossHatch(shredded(MIN_HATCH_PIECES - 1), 'x').joined).toBe(0);
    expect(joinAcrossHatch(shredded(MIN_HATCH_PIECES), 'x').joined).toBe(1);
  });
});

describe('a DIAGONAL hatch, whose pieces overlap instead of stacking', () => {
  /**
   * ⚑⚑ THE SECOND SHAPE OF THE SAME PROBLEM, and the 1D rule above cannot see
   * it. matplotlib's `/`, `\`, `x` and `+` cut a bar into parallelogram STRIPS -
   * Adobe `2003.json` is 5px black bands at 45 degrees every ~32px - and
   * consecutive strips have different extents but bounding boxes that overlap
   * almost entirely. Two separate bars never overlap at all: they sit side by
   * side, or stack with a clear gap.
   */
  /** Strips of a bar cut diagonally: each spans most of the bar's box. */
  function diagonalStrips(count: number): Blob[] {
    return Array.from({ length: count }, (_, i) => {
      const b = blob(100 + i * 4, 100 + i * 4, 200 + i * 4, 300 + i * 4);
      // The ink is the strip itself, not the box it spans.
      return { ...b, area: 100 * 200 * 0.8 / count };
    });
  }

  it('⚑⚑ joins strips whose boxes overlap', () => {
    const out = joinAcrossHatch(diagonalStrips(5), 'x');
    expect(out.joined).toBe(1);
    expect(out.blobs).toHaveLength(1);
  });

  it('⛔ refuses a cluster that does not FILL the box it spans', () => {
    // ⚠️ THE CHAINING GUARD, and it was measured the hard way: linking every
    // overlapping pair and taking the transitive closure welded whole figures
    // together on a noisy mask, costing 204 real bars over 48 PMC figures.
    // `PMC3762776___g004` went from 148 predictions to TEN - its ground-truth
    // count - while its matches went from 10 to ZERO. The right number of wrong
    // shapes. A hatched bar keeps most of its area; chained noise does not.
    // ⚠️ THE FIRST VERSION OF THIS FIXTURE WAS VACUOUS and passed with the guard
    // REMOVED: its boxes overlapped by only a third, below the threshold that
    // links two pieces at all, so no cluster ever formed and the refusal was
    // never exercised. These overlap by 90% - so they certainly link - and carry
    // almost no ink, so only the fill test can refuse them.
    const sparse = Array.from({ length: 5 }, (_, i) => {
      const b = blob(100 + i * 10, 100 + i * 10, 300 + i * 10, 300 + i * 10);
      return { ...b, area: 20 };
    });
    expect(joinAcrossHatch(sparse, 'x').joined).toBe(0);
  });

  it('⛔ refuses a merge that would cross a declared band boundary', () => {
    // ⚑⚑ ONE CATEGORY HOLDS ONE BAR OF A GIVEN COLOUR, so a cluster spanning a
    // divider is two bars being welded together - a plausible wrong number
    // rather than a visible miss. This is the gate that took the cost on real
    // published figures from 204 bars to two.
    const strips = diagonalStrips(5);
    // Axis ends at 50 and 400, with a real boundary at 150 - inside the strips.
    expect(joinAcrossHatch(strips, 'x', [50, 150, 400]).joined).toBe(0);
    // The same strips with the boundary moved clear of them are joined.
    expect(joinAcrossHatch(strips, 'x', [50, 350, 400]).joined).toBe(1);
  });

  it('lets a bar touch the OUTER dividers, which are the axis ends', () => {
    // ⚑ The first and last entries bound the whole axis rather than separating
    // two bands, and a bar legitimately reaches them.
    const strips = diagonalStrips(5);
    expect(joinAcrossHatch(strips, 'x', [110, 400]).joined).toBe(1);
  });
});
