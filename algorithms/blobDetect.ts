/**
 * Blob detector - checkpoint 122, the SCATTER-PLOT auto-extraction algorithm.
 *
 * The colour filter says "these pixels are the series' colour"; for a CURVE we
 * reduce that mask one-point-per-column (Averaging Window, segmentFill.ts's
 * pointsFromColumnRuns). A SCATTER plot is different: each datum is a separate
 * marker, so the right reduction is one point per connected BLOB - the marker's
 * centroid. Averaging Window would merge two markers sharing a column, or split
 * one tall marker into several; blob detection records exactly one point where
 * each marker sits.
 *
 * Adapted from WPD's BlobDetectorAlgo (blobdetector.js, AGPL-3.0 like us - tenets
 * 5/8: take the mechanism, not its DOM param tables / `_wasRun` flags). The flood
 * is the mask-space sibling of segmentFill.ts's `floodFill`: same connected-region
 * idea, but over the binary colour mask (8-connected) rather than the RGB image
 * from a seed. WPD's 0.5-px centre offset and equivalent-circle diameter filter
 * are kept; its `moment` metadata is dropped - nothing downstream reads it, and
 * tenet 10 says don't record modeling we don't need.
 *
 * ⚑ Tenet 9: the centroid is MEASURED (the marker's pixel position), not
 * interpreted. One point per marker, recorded off the pixels.
 */

import type { Point2D } from './segmentFill.js';

export interface Blob {
  /** Blob centroid, already shifted +0.5 px to the pixel centre (WPD's offset). */
  centroid: Point2D;
  /** Pixel count in the blob. */
  area: number;
  /** Equivalent-circle diameter in pixels: 2·√(area/π). Used for size filtering
   * (drop antialiasing specks / a merged gridline blob). */
  diameter: number;
  /** The blob's axis-aligned bounding box, in the SAME continuous-pixel space
   * as centroid (i.e. `max` is one past the last matched pixel index, so the
   * box spans the blob's true visual extent) -- v2.0 Phase 7, added for
   * engine/barDetectRun.ts's opposite-corner bar capture. WPD's own blob
   * detector never tracked this; nothing upstream to port, and free during
   * the same flood that already visits every member pixel once. */
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
  /** The blob's OWN pixel indices, present only when `trackMembership` is set.
   *
   * ⚑ A bounding box is not a membership test, and treating it as one was a real
   * defect (code review, 2026-08-10): re-measuring a merged bar run from the
   * colour mask inside a blob's bbox also picks up any OTHER same-coloured ink in
   * that rectangle -- a legend swatch, a speck the diameter filter rejected, a
   * second disconnected bar. Where that contamination covers half a band's
   * columns the median stops protecting and the piece's value is silently wrong,
   * which is the exact failure the splitter was written to prevent.
   *
   * Free to collect: the flood already visits every member pixel once. Opt-in
   * because the curve/marker callers never need it and it costs the blob's area
   * in memory. */
  members?: Int32Array;
}

export interface BlobDetectOptions {
  /** Record each accepted blob's own pixel indices - see `Blob.members`. */
  trackMembership?: boolean;
  /** Reject blobs whose equivalent diameter is below this (px). Default 0 (keep
   * all) - a small value drops single-pixel noise and antialiasing edges. */
  minDiameter?: number;
  /** Reject blobs whose equivalent diameter exceeds this (px). Default Infinity -
   * a finite value drops a merged grid/axis blob that the tolerance grabbed. */
  maxDiameter?: number;
}

/**
 * Find connected blobs in a binary mask (1 = selected, the shape colorFilter
 * emits) and return one centroid per blob, keeping only those whose
 * equivalent-circle diameter falls in [minDiameter, maxDiameter]. 8-connected,
 * so a marker's diagonal antialiasing stays one blob. Each pixel is visited once
 * (O(width·height)); no fill cap is needed - a huge blob is simply reported and
 * then rejected by maxDiameter, never traversed twice.
 */
export function detectBlobs(
  mask: Uint8Array,
  width: number,
  height: number,
  opts: BlobDetectOptions = {}
): Blob[] {
  const minDia = opts.minDiameter ?? 0;
  const maxDia = opts.maxDiameter ?? Infinity;
  const track = opts.trackMembership === true;
  const visited = new Uint8Array(width * height);
  const blobs: Blob[] = [];
  const stack: number[] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const seed = y * width + x;
      if (!mask[seed] || visited[seed]) continue;

      // Flood the 8-connected blob, accumulating the centroid sums and area.
      visited[seed] = 1;
      stack.length = 0;
      stack.push(seed);
      let sumX = 0;
      let sumY = 0;
      let area = 0;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      const members: number[] = [];
      while (stack.length > 0) {
        const p = stack.pop()!;
        if (track) members.push(p);
        const px = p % width;
        const py = (p - px) / width;
        sumX += px;
        sumY += py;
        area++;
        if (px < minX) minX = px;
        if (py < minY) minY = py;
        if (px > maxX) maxX = px;
        if (py > maxY) maxY = py;
        for (let ny = py - 1; ny <= py + 1; ny++) {
          if (ny < 0 || ny >= height) continue;
          for (let nx = px - 1; nx <= px + 1; nx++) {
            if (nx < 0 || nx >= width) continue;
            const np = ny * width + nx;
            if (mask[np] && !visited[np]) {
              visited[np] = 1;
              stack.push(np);
            }
          }
        }
      }

      const diameter = 2 * Math.sqrt(area / Math.PI);
      if (diameter >= minDia && diameter <= maxDia) {
        // +0.5 shifts to the pixel CENTRE: a pixel's index names its corner,
        // and a blob's centroid is a position on the figure. The bbox's max is
        // +1 past the last matched pixel INDEX, so it spans the blob's true
        // visual extent (a pixel at column x covers [x, x+1)), not the
        // narrower box you'd get from the raw index range.
        blobs.push({
          centroid: { x: sumX / area + 0.5, y: sumY / area + 0.5 },
          area,
          diameter,
          bbox: { minX, minY, maxX: maxX + 1, maxY: maxY + 1 },
          ...(track ? { members: Int32Array.from(members) } : {}),
        });
      }
    }
  }
  return blobs;
}

/**
 * THE MARKER'S OWN BODY, without the lines touching it (v2.7; David, 2026-11-04). A marker and an error bar (or a
 * connecting line) of the same colour touch, so they are one blob, and the blob's centroid is pulled along the longer
 * arm: on errorbar-failure-time-asymmetric every point read too high, by up to 67 of 820 h.
 *
 * The body is the blob OPENED by a disc a little wider than a line: every pixel within `radius` of a pixel that is
 * itself at least `radius` from the blob's edge. A line up to about 2 x radius wide has no such pixel and goes; a
 * marker keeps its shape. Returns one centre per body piece (a bar joining two markers leaves two), each with +0.5 to
 * the pixel centre as the centroid has. ⚑ When the opening takes away little (`keep` of the blob or more: a lone
 * marker, whose corners an opening rounds) or nothing survives it (a marker too small to open), the answer is the
 * blob's own centroid, so a marker with nothing attached reads exactly as it always did.
 */
export function markerCentres(
  blob: Blob,
  width: number,
  opts: { radius?: number; keep?: number; minDiameter?: number } = {}
): Point2D[] {
  const members = blob.members;
  if (!members || members.length === 0) return [blob.centroid];
  const radius = opts.radius ?? 2;
  const keep = opts.keep ?? 0.8;
  const minDia = opts.minDiameter ?? 0;
  // a local grid with a one-pixel margin of background round the blob
  const x0 = Math.floor(blob.bbox.minX) - 1;
  const y0 = Math.floor(blob.bbox.minY) - 1;
  const w = Math.ceil(blob.bbox.maxX) - x0 + 1;
  const h = Math.ceil(blob.bbox.maxY) - y0 + 1;
  const inBlob = new Uint8Array(w * h);
  for (const p of members) {
    const px = p % width;
    const py = (p - px) / width;
    inBlob[(py - y0) * w + (px - x0)] = 1;
  }
  // chamfer 3-4 distances (3 per pixel straight, 4 diagonal) from the cells where `from` is 0
  const chamfer = (from: Uint8Array): Float64Array => {
    const d = new Float64Array(w * h);
    for (let i = 0; i < d.length; i++) d[i] = from[i] ? Infinity : 0;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (d[i] === 0) continue;
        if (x > 0) d[i] = Math.min(d[i]!, d[i - 1]! + 3);
        if (y > 0) {
          d[i] = Math.min(d[i]!, d[i - w]! + 3);
          if (x > 0) d[i] = Math.min(d[i]!, d[i - w - 1]! + 4);
          if (x < w - 1) d[i] = Math.min(d[i]!, d[i - w + 1]! + 4);
        }
      }
    for (let y = h - 1; y >= 0; y--)
      for (let x = w - 1; x >= 0; x--) {
        const i = y * w + x;
        if (d[i] === 0) continue;
        if (x < w - 1) d[i] = Math.min(d[i]!, d[i + 1]! + 3);
        if (y < h - 1) {
          d[i] = Math.min(d[i]!, d[i + w]! + 3);
          if (x < w - 1) d[i] = Math.min(d[i]!, d[i + w + 1]! + 4);
          if (x > 0) d[i] = Math.min(d[i]!, d[i + w - 1]! + 4);
        }
      }
    return d;
  };
  const r3 = radius * 3;
  // erode: the pixels more than `radius` from the edge (distance to the nearest background pixel)
  const toEdge = chamfer(inBlob);
  const notCore = new Uint8Array(w * h);
  let cores = 0;
  for (let i = 0; i < w * h; i++) {
    if (toEdge[i]! > r3) cores++;
    else notCore[i] = 1;
  }
  if (cores === 0) return [blob.centroid];
  // dilate back, inside the blob: the pixels within `radius` of a core pixel
  const toCore = chamfer(notCore);
  const body = new Uint8Array(w * h);
  let bodyArea = 0;
  for (let i = 0; i < w * h; i++)
    if (inBlob[i] && toCore[i]! <= r3) {
      body[i] = 1;
      bodyArea++;
    }
  if (bodyArea >= keep * members.length) return [blob.centroid];
  // one centre per piece of the body
  const out: Point2D[] = [];
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let s = 0; s < w * h; s++) {
    if (!body[s] || seen[s]) continue;
    seen[s] = 1;
    stack.push(s);
    let sx = 0, sy = 0, n = 0;
    while (stack.length) {
      const p = stack.pop()!;
      const px = p % w;
      const py = (p - px) / w;
      sx += px;
      sy += py;
      n++;
      for (let ny = Math.max(0, py - 1); ny <= Math.min(h - 1, py + 1); ny++)
        for (let nx = Math.max(0, px - 1); nx <= Math.min(w - 1, px + 1); nx++) {
          const q = ny * w + nx;
          if (body[q] && !seen[q]) {
            seen[q] = 1;
            stack.push(q);
          }
        }
    }
    if (2 * Math.sqrt(n / Math.PI) >= minDia) out.push({ x: x0 + sx / n + 0.5, y: y0 + sy / n + 0.5 });
  }
  return out.length ? out : [blob.centroid];
}
