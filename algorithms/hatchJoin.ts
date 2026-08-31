import type { Blob } from './blobDetect.js';

/**
 * Put back together a bar that a HATCH FILL shredded (v2.4).
 *
 * ⚑⚑ WHY THIS IS NEEDED AT ALL, measured rather than supposed. matplotlib
 * hatches every bar in the Adobe CHART-Synthetic corpus, and a hatch line is
 * drawn in a colour the filter drops - on one measured bar, 2px of pure black
 * with anti-aliased shoulders either side (`83 6 0 0 25 99` across it) every
 * ~32px. Flood-fill connectivity therefore returns about 34 fragments where the
 * figure drew one bar, none of them overlapping the true bar by half, so a
 * perfectly drawn bar scores ZERO. That corpus reads 35.3% against 76.1% on real
 * published figures, and declaring the axis and baseline changes nothing
 * (35.3% -> 35.3%) because the shredding happens before any declaration is
 * consulted.
 *
 * ⚑⚑ IT MIRRORS `joinAcrossBaseline` ON PURPOSE. A bar severed by the zero rule
 * and a bar shredded by a hatch are the same problem - the figure drew something
 * across a bar in a colour we drop - so they are fixed the same way, in the same
 * place in the pipeline, using the same `sameCategoryExtent` test. Anything that
 * reads a bar afterwards sees the shape the figure contains.
 *
 * ⚑⚑ AND IT NEEDS NO FOURIER TRANSFORM, though the repo proved one works.
 * `hatch-probe.py` established that a hatch is a 1D frequency peak along the bar
 * - Adobe median prominence 23.2 against real figures' 2.65, recovered period
 * 32.1px against a hand pixel-scan of 33.2px. That is the right instrument for
 * asking whether a bar you ALREADY HAVE is hatched. Here we are holding the
 * fragments, and their geometry carries the same period exactly: aligned,
 * evenly spaced, parted by small gaps. The evidence is in what the detector
 * returned.
 *
 * ⛔ IT MAY ONLY CORROBORATE, which is this project's standing rule for every bar
 * technique: every unconditional one has failed, so a technique must be gated by
 * evidence and leave the population it cannot help provably untouched. The gate
 * is REGULARITY - three or more aligned pieces, small gaps, a consistent pitch.
 * Two pieces with one gap is not a hatch and is left to `joinAcrossBaseline`,
 * which has a gate of its own.
 */

/**
 * How many pieces before a stack is evidence of a repeating pattern.
 *
 * ⚑ THREE, because two pieces have ONE gap and one gap is not a period. A bar
 * cut once is the baseline case and belongs to the join that is gated on the
 * user's declared baseline.
 */
export const MIN_HATCH_PIECES = 3;

/**
 * The widest gap a drawn line may leave, in pixels.
 *
 * ⚑ MEASURED off the ink rather than chosen: the hatch line on Adobe
 * `1996.json` is ~2px of black with anti-aliased shoulders, a dark band of 4 to
 * 6px in all. Eight leaves room for a heavier hatch without reaching the scale
 * at which two SEPARATE bars sit apart.
 */
export const MAX_HATCH_GAP_PX = 8;

/** How far the spacing may wander from its own median and still be a pattern. */
const PITCH_TOLERANCE = 0.35;

/** Same rule, same number as `joinAcrossBaseline`'s: do these occupy the same
 *  slice of the category axis? */
const SAME_CATEGORY_OVERLAP = 0.9;

export interface HatchJoinResult {
  blobs: Blob[];
  /** How many shapes were rebuilt - reported so a card can say so. */
  joined: number;
}

export function joinAcrossHatch(blobs: readonly Blob[], categoryAxis: 'x' | 'y'): HatchJoinResult {
  const valueLo = (b: Blob) => (categoryAxis === 'x' ? b.bbox.minY : b.bbox.minX);
  const valueHi = (b: Blob) => (categoryAxis === 'x' ? b.bbox.maxY : b.bbox.maxX);
  const catLo = (b: Blob) => (categoryAxis === 'x' ? b.bbox.minX : b.bbox.minY);
  const catHi = (b: Blob) => (categoryAxis === 'x' ? b.bbox.maxX : b.bbox.maxY);
  const sameCategoryExtent = (a: Blob, b: Blob): boolean => {
    const overlap = Math.min(catHi(a), catHi(b)) - Math.max(catLo(a), catLo(b));
    const widest = Math.max(catHi(a) - catLo(a), catHi(b) - catLo(b));
    return widest > 0 && overlap / widest >= SAME_CATEGORY_OVERLAP;
  };

  const taken = new Set<number>();
  const out: Blob[] = [];
  let joined = 0;

  blobs.forEach((seed, i) => {
    if (taken.has(i)) return;
    // Everything sharing this seed's slice of the category axis, in value order.
    const group = blobs
      .map((b, k) => ({ b, k }))
      .filter(({ b, k }) => !taken.has(k) && (k === i || sameCategoryExtent(seed, b)))
      .sort((p, q) => valueLo(p.b) - valueLo(q.b));
    if (group.length < MIN_HATCH_PIECES) return;

    // ⚑ THE GATE, and all of it is arithmetic on what the detector returned:
    // every gap small, and the pitch steady. A hatch repeats; three shapes that
    // happen to stack with assorted gaps are three shapes.
    const gaps: number[] = [];
    const pitches: number[] = [];
    for (let n = 1; n < group.length; n++) {
      gaps.push(valueLo(group[n]!.b) - valueHi(group[n - 1]!.b));
      pitches.push(valueLo(group[n]!.b) - valueLo(group[n - 1]!.b));
    }
    if (gaps.some((g) => g < 0 || g > MAX_HATCH_GAP_PX)) return;
    const sorted = [...pitches].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)]!;
    if (!(median > 0)) return;
    if (pitches.some((p) => Math.abs(p - median) / median > PITCH_TOLERANCE)) return;

    for (const { k } of group) taken.add(k);
    joined += 1;
    const parts = group.map(({ b }) => b);
    // ⚑ THE AREA IS THE INK WE SAW, NOT THE BOX WE SPAN. The gaps are the
    // figure's own hatch lines - nothing matched there - and claiming the box's
    // full area would assert pixels nobody measured, to size filters that read
    // this number. Same reasoning as `joinAcrossBaseline`'s recomputed centroid.
    const area = parts.reduce((n, b) => n + b.area, 0);
    const members = parts.every((b) => b.members)
      ? (() => {
          const total = parts.reduce((n, b) => n + b.members!.length, 0);
          const m = new Int32Array(total);
          let at = 0;
          for (const b of parts) {
            m.set(b.members!, at);
            at += b.members!.length;
          }
          return m;
        })()
      : undefined;
    out.push({
      centroid: {
        x: parts.reduce((n, b) => n + b.centroid.x * b.area, 0) / area,
        y: parts.reduce((n, b) => n + b.centroid.y * b.area, 0) / area,
      },
      area,
      diameter: 2 * Math.sqrt(area / Math.PI),
      bbox: {
        minX: Math.min(...parts.map((b) => b.bbox.minX)),
        minY: Math.min(...parts.map((b) => b.bbox.minY)),
        maxX: Math.max(...parts.map((b) => b.bbox.maxX)),
        maxY: Math.max(...parts.map((b) => b.bbox.maxY)),
      },
      ...(members ? { members } : {}),
    });
  });

  blobs.forEach((b, i) => {
    if (!taken.has(i)) out.push(b);
  });
  return { blobs: out, joined };
}
