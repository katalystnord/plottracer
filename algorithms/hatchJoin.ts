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

/**
 * How much of the smaller box must lie inside the other before two pieces are
 * called one shape.
 *
 * ⚑ MEASURED: a DIAGONAL hatch (matplotlib's `/`, `\\`, `x`, `+`) cuts a bar
 * into parallelogram strips whose bounding boxes overlap almost entirely -
 * Adobe `2003.json` is 5px black bands at 45 degrees every ~32px - while two
 * genuinely separate bars never overlap at all: they sit side by side, or stack
 * with a clear gap. So any substantial overlap is evidence of one shape, and the
 * threshold only has to sit above the incidental.
 */
const OVERLAP_IS_ONE_SHAPE = 0.5;

/**
 * How much of a merged shape's own box its ink must fill.
 *
 * ⚠️⚑⚑ THE GUARD AGAINST CHAINING, and it was measured the hard way. Linking
 * every pair of overlapping boxes and taking the transitive closure is
 * single-link clustering, and on a noisy mask it welds the whole figure
 * together: A overlaps B overlaps C merges A with C though they share nothing.
 * On the PMC corpus that cost 204 bars over 48 figures, with a tell that names
 * the fault exactly - `PMC3762776___g004` went from 148 predictions to TEN,
 * which is its ground-truth count, while its matches went from 10 to ZERO. The
 * right number of wrong shapes.
 * ▶ So a merged cluster has to look like a BAR: its pieces must fill most of the
 * box they span. A hatched bar loses only the width of its own lines - about 5px
 * in 32 on the measured figures, so 80% or more remains - while chained noise
 * spans a large box and fills almost none of it.
 */
const MIN_MERGED_FILL = 0.5;

/** Does this box straddle a declared band boundary? */
function crossesADivider(
  box: { minX: number; minY: number; maxX: number; maxY: number },
  categoryAxis: 'x' | 'y',
  dividers?: readonly number[]
): boolean {
  if (!dividers || dividers.length < 3) return false;
  const lo = categoryAxis === 'x' ? box.minX : box.minY;
  const hi = categoryAxis === 'x' ? box.maxX : box.maxY;
  // ⚑ The OUTER two dividers are the axis ends, not boundaries between bands -
  // a bar legitimately touches those.
  return dividers.slice(1, -1).some((d) => d > lo && d < hi);
}

/** Do these two boxes overlap enough that they cannot be separate bars? */
function overlapsSubstantially(a: Blob, b: Blob): boolean {
  const w = Math.min(a.bbox.maxX, b.bbox.maxX) - Math.max(a.bbox.minX, b.bbox.minX);
  const h = Math.min(a.bbox.maxY, b.bbox.maxY) - Math.max(a.bbox.minY, b.bbox.minY);
  if (w <= 0 || h <= 0) return false;
  const smaller = Math.min(
    (a.bbox.maxX - a.bbox.minX) * (a.bbox.maxY - a.bbox.minY),
    (b.bbox.maxX - b.bbox.minX) * (b.bbox.maxY - b.bbox.minY)
  );
  return smaller > 0 && (w * h) / smaller >= OVERLAP_IS_ONE_SHAPE;
}

export function joinAcrossHatch(
  blobs: readonly Blob[],
  categoryAxis: 'x' | 'y',
  /**
   * The user's declared band boundaries along the category axis, ascending.
   *
   * ⚠️⚑⚑ A REBUILT BAR MAY NOT CROSS ONE, and this is the gate that made the
   * overlap rule safe. One category holds one bar of a given colour, so a
   * cluster spanning a divider is not a shredded bar - it is two bars being
   * welded together, which is a plausible wrong number rather than a visible
   * miss. Measured before it existed: the overlap rule cost 204 real bars over
   * 48 PMC figures, with a 46-bar figure collapsing to 22.
   */
  dividers?: readonly number[]
): HatchJoinResult {
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

  /** Everything reachable from `seed` by overlapping boxes - a DIAGONAL hatch. */
  const overlapCluster = (seedIndex: number): number[] => {
    const members = [seedIndex];
    const queue = [seedIndex];
    while (queue.length) {
      const cur = blobs[queue.pop()!]!;
      blobs.forEach((b, k) => {
        if (taken.has(k) || members.includes(k)) return;
        if (!overlapsSubstantially(cur, b)) return;
        members.push(k);
        queue.push(k);
      });
    }
    return members;
  };

  const merge = (indices: readonly number[]): void => {
    for (const k of indices) taken.add(k);
    joined += 1;
    const parts = indices.map((k) => blobs[k]!);
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
  };

  // ⚑⚑ TWO SHAPES OF EVIDENCE, because a hatch comes in two shapes. A
  // HORIZONTAL hatch slices a bar into slabs that stack with small regular gaps
  // and never overlap; a DIAGONAL one cuts it into parallelogram strips whose
  // boxes overlap almost entirely. Neither rule sees the other's case, and both
  // describe something two separate bars cannot do.
  blobs.forEach((_, i) => {
    if (taken.has(i)) return;
    const cluster = overlapCluster(i);
    if (cluster.length < 2) return;
    const parts = cluster.map((k) => blobs[k]!);
    const box = {
      minX: Math.min(...parts.map((b) => b.bbox.minX)),
      minY: Math.min(...parts.map((b) => b.bbox.minY)),
      maxX: Math.max(...parts.map((b) => b.bbox.maxX)),
      maxY: Math.max(...parts.map((b) => b.bbox.maxY)),
    };
    const boxArea = (box.maxX - box.minX) * (box.maxY - box.minY);
    const ink = parts.reduce((n, b) => n + b.area, 0);
    if (!(boxArea > 0) || ink / boxArea < MIN_MERGED_FILL) return;
    if (crossesADivider(box, categoryAxis, dividers)) return;
    merge(cluster);
  });

  blobs.forEach((seed, i) => {
    if (taken.has(i)) return;
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
    merge(group.map(({ k }) => k));
  });

  blobs.forEach((b, i) => {
    if (!taken.has(i)) out.push(b);
  });
  return { blobs: out, joined };
}
