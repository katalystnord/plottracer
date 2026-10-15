/**
 * v2.7 V19 - where a point of a PDF's DRAWING lands in the working picture.
 *
 * Reading a figure's drawing gives positions in the PDF page's own space. The
 * picture the user works on is that page as pdf.js rendered it, then cropped,
 * rotated, flipped and deskewed. So the project records both halves, and a
 * drawn point is placed through them in order:
 *
 *   page space --(source.pageTransform, pdf.js's own viewport matrix)--> the
 *   rendered page --(each recorded edit, in the order made)--> the picture.
 *
 * ⚑ The edits use editPointMap, the same function every edit's own mapPoint is,
 * so the record cannot describe a different edit from the one that ran.
 */
import { editPointMap, type ImageEdit } from './imageEdit.js';
import type { Provenance } from './projectFile.js';

export type { ImageEdit };

/** A point in the image before the first edit -> the same point in the picture now. */
export function placeThroughEdits(edits: readonly ImageEdit[], p: { x: number; y: number }): { x: number; y: number } {
  let at = p;
  for (const e of edits) at = editPointMap(e)(at.x, at.y);
  return at;
}

/** A point in PDF page space -> the working picture, or null when the figure
 * did not come from a PDF page whose render was recorded. */
export function pageToImage(prov: Provenance, p: readonly [number, number]): { x: number; y: number } | null {
  const m = prov.source?.pageTransform;
  if (!m) return null;
  const rendered = { x: m[0] * p[0] + m[2] * p[1] + m[4], y: m[1] * p[0] + m[3] * p[1] + m[5] };
  return placeThroughEdits(prov.edits ?? [], rendered);
}
