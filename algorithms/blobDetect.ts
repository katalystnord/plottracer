/**
 * Blob detector — checkpoint 122, the SCATTER-PLOT auto-extraction algorithm.
 *
 * The colour filter says "these pixels are the series' colour"; for a CURVE we
 * reduce that mask one-point-per-column (Averaging Window, segmentFill.ts's
 * pointsFromColumnRuns). A SCATTER plot is different: each datum is a separate
 * marker, so the right reduction is one point per connected BLOB — the marker's
 * centroid. Averaging Window would merge two markers sharing a column, or split
 * one tall marker into several; blob detection records exactly one point where
 * each marker sits.
 *
 * Adapted from WPD's BlobDetectorAlgo (blobdetector.js, AGPL-3.0 like us — tenets
 * 5/8: take the mechanism, not its DOM param tables / `_wasRun` flags). The flood
 * is the mask-space sibling of segmentFill.ts's `floodFill`: same connected-region
 * idea, but over the binary colour mask (8-connected) rather than the RGB image
 * from a seed. WPD's 0.5-px centre offset and equivalent-circle diameter filter
 * are kept; its `moment` metadata is dropped — nothing downstream reads it, and
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
  /** Record each accepted blob's own pixel indices — see `Blob.members`. */
  trackMembership?: boolean;
  /** Reject blobs whose equivalent diameter is below this (px). Default 0 (keep
   * all) — a small value drops single-pixel noise and antialiasing edges. */
  minDiameter?: number;
  /** Reject blobs whose equivalent diameter exceeds this (px). Default Infinity —
   * a finite value drops a merged grid/axis blob that the tolerance grabbed. */
  maxDiameter?: number;
}

/**
 * Find connected blobs in a binary mask (1 = selected, the shape colorFilter
 * emits) and return one centroid per blob, keeping only those whose
 * equivalent-circle diameter falls in [minDiameter, maxDiameter]. 8-connected,
 * so a marker's diagonal antialiasing stays one blob. Each pixel is visited once
 * (O(width·height)); no fill cap is needed — a huge blob is simply reported and
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
        // +0.5 shifts to the pixel centre, matching WPD. The bbox's max is
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
