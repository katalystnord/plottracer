/**
 * Markers that run together, taken apart (v2.7; docs/v2.7-workflow-walk.md, "Series told apart by their markers").
 *
 * A blob of one ink can hold several markers drawn over each other. Each series' marker, as it stands alone in the
 * plot, is a template; the blob is explained one marker at a time: where a template covers the most of the blob's
 * ink not yet explained while putting little of itself on paper, a marker of that template is placed, and so on until
 * no placement explains enough. Overlapping markers share pixels, so a placement is scored on the blob's whole ink for
 * what it puts on paper, and on what is not yet explained for what it adds.
 */

/** A marker's pixels, as offsets from its centre. */
export interface MarkerTemplate {
  offsets: [number, number][];
}

/** A template from a marker's pixels (indices into a `w`-wide image): offsets from its rounded centroid. */
export function templateOf(pix: readonly number[], w: number): MarkerTemplate {
  let sx = 0, sy = 0;
  for (const i of pix) {
    sx += i % w;
    sy += Math.floor(i / w);
  }
  const cx = Math.round(sx / pix.length), cy = Math.round(sy / pix.length);
  return { offsets: pix.map((i) => [(i % w) - cx, Math.floor(i / w) - cy] as [number, number]) };
}

export interface FittedMarker {
  /** Centre, image px (pixel centre, +0.5 as blob centroids are). */
  x: number;
  y: number;
  /** Which template. */
  template: number;
}

/** The share of a template that must land on not-yet-explained ink for a placement to count. */
const MIN_GAIN = 0.35;
/** The share of a template that may land on paper. */
const MAX_OFF = 0.2;

/** The markers in one blob (pixel indices into a `w`-wide image), each one of `templates`. */
export function fitMarkers(blob: readonly number[], w: number, templates: readonly MarkerTemplate[]): FittedMarker[] {
  if (!blob.length || !templates.length) return [];
  // a local grid round the blob, with a margin of a template's reach, so every placement reads inside it
  let reach = 0;
  for (const t of templates) for (const [dx, dy] of t.offsets) reach = Math.max(reach, Math.abs(dx), Math.abs(dy));
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const i of blob) {
    const x = i % w, y = Math.floor(i / w);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const ox = minX - reach, oy = minY - reach;
  const gw = maxX - minX + 1 + 2 * reach, gh = maxY - minY + 1 + 2 * reach;
  const ink = new Uint8Array(gw * gh);
  for (const i of blob) ink[(Math.floor(i / w) - oy) * gw + (i % w) - ox] = 1;
  const unexplained = ink.slice();
  let left = blob.length;
  // a placement is centred anywhere in the blob's box (an open marker's centre is on paper); its score is the ink it
  // explains, in pixels, less what it puts on paper (where a small marker fits inside a large one, the large one
  // explains more), and it counts only when it explains enough and puts little on paper
  const T = templates.length;
  const meanOff = templates.map((q) => {
    let a = 0, b = 0;
    for (const [dx, dy] of q.offsets) { a += dx; b += dy; }
    return [a / q.offsets.length, b / q.offsets.length] as const;
  });
  const score = new Float64Array(gw * gh * T).fill(-Infinity);
  const rescore = (x0: number, y0: number, x1: number, y1: number) => {
    for (let cy = Math.max(reach, y0); cy <= Math.min(gh - 1 - reach, y1); cy++) {
      for (let cx = Math.max(reach, x0); cx <= Math.min(gw - 1 - reach, x1); cx++) {
        for (let t = 0; t < T; t++) {
          const offs = templates[t]!.offsets;
          let gain = 0, off = 0;
          for (const [dx, dy] of offs) {
            const j = (cy + dy) * gw + cx + dx;
            if (!ink[j]) off++;
            else if (unexplained[j]) gain++;
          }
          score[(cy * gw + cx) * T + t] = off > MAX_OFF * offs.length || gain < MIN_GAIN * offs.length ? -Infinity : gain - 3 * off;
        }
      }
    }
  };
  rescore(reach, reach, gw - 1 - reach, gh - 1 - reach);
  const out: FittedMarker[] = [];
  const smallest = Math.min(...templates.map((q) => q.offsets.length));
  for (let guard = 0; guard < 2000 && left >= 0.25 * smallest; guard++) {
    let bi = -1, bs = -Infinity;
    for (let k = 0; k < score.length; k++) if (score[k]! > bs) { bs = score[k]!; bi = k; }
    if (bi < 0) break;
    const t = bi % T, c = (bi - t) / T, cx = c % gw, cy = (c - cx) / gw;
    for (const [dx, dy] of templates[t]!.offsets) {
      const j = (cy + dy) * gw + cx + dx;
      if (unexplained[j]) { unexplained[j] = 0; left--; }
    }
    // the marker's centre is its centroid, as a lone marker's point is: the template's offsets are from its rounded
    // centroid, so the remainder is added back
    out.push({ x: cx + ox + 0.5 + meanOff[t]![0], y: cy + oy + 0.5 + meanOff[t]![1], template: t });
    // only placements that overlap this one can change
    rescore(cx - 2 * reach, cy - 2 * reach, cx + 2 * reach, cy + 2 * reach);
  }
  return out;
}

/** The share of a blob's ink its fitted markers must explain for it to be taken apart. */
const EXPLAINED = 0.9;

/**
 * A blob taken apart into the markers that make it, or null when it is not markers drawn over each other: fewer than
 * two fit, or they leave more than a tenth of its ink unexplained (a marker with an error bar or a line through it, a
 * piece of text, a line). Without this guard a speck served as the template and fitted all along a grid: real PMC
 * scatters read 28 to 32 points per true point (docs/v2.7-workflow-walk.md, "Markers that run together").
 */
export function splitBlob(blob: readonly number[], w: number, templates: readonly MarkerTemplate[], explainedShare = EXPLAINED): FittedMarker[] | null {
  const fit = fitMarkers(blob, w, templates);
  if (fit.length < 2) return null;
  const covered = new Set<number>();
  for (const q of fit) {
    const cx = Math.floor(q.x), cy = Math.floor(q.y);
    for (const [dx, dy] of templates[q.template]!.offsets) covered.add((cy + dy) * w + cx + dx);
  }
  let explained = 0;
  for (const i of blob) if (covered.has(i)) explained++;
  return explained >= explainedShare * blob.length ? fit : null;
}

/** A blob, as the splitting reads it: its area and its box (algorithms/blobDetect.ts's Blob is one). */
export interface BlobPixels {
  area: number;
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
}

/** Whether a blob is shaped like one marker: at least 9 px, not a line (its box at most 2.2 times as long as wide),
 * and filling a good part of its box (not a stroke of text). */
export function compactBlob(b: BlobPixels): boolean {
  const bw = b.bbox.maxX - b.bbox.minX, bh = b.bbox.maxY - b.bbox.minY;
  return b.area >= 9 && Math.max(bw, bh) <= 2.2 * Math.min(bw, bh) && b.area >= 0.35 * bw * bh;
}

/** The marker the plot itself draws most, where there is no legend to say: of the compact blobs, the commonest area
 * (in steps of 15%), the smallest of those. Null with fewer than 3 compact blobs. */
export function typicalMarker<B extends BlobPixels>(blobs: readonly B[]): B | null {
  const compact = blobs.filter(compactBlob);
  if (compact.length < 3) return null;
  const bin = (b: B) => Math.round(Math.log(b.area) / Math.log(1.15));
  const count = new Map<number, number>();
  for (const b of compact) count.set(bin(b), (count.get(bin(b)) ?? 0) + 1);
  let mk = 0, mn = -1;
  for (const [k, n] of count) if (n > mn || (n === mn && k < mk)) { mn = n; mk = k; }
  return compact.filter((b) => bin(b) === mk).sort((a, b) => a.area - b.area)[0]!;
}

/** A blob clearly bigger than one marker of this area may be several: up to 1.6 times it is one. */
export const ONE_MARKER = 1.6;
