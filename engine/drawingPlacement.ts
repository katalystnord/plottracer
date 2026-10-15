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
import type { PageDrawing, Pt } from './pdfDrawing.js';
import type { PlacedDrawing } from '../algorithms/findLines/fromDrawing.js';

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

/**
 * The page's drawing and text, placed in the working picture (v2.7 V12), for
 * Find lines to read. Null when the figure's page render was not recorded.
 * ⚑ Colours become 0-255, as the picture's are, so a colour picked off the
 * picture is compared like for like.
 */
export function placeDrawing(prov: Provenance, drawing: PageDrawing, text: readonly [number, number, number, number][]): PlacedDrawing | null {
  const m = prov.source?.pageTransform;
  if (!m) return null;
  const at = (p: Pt): Pt => {
    const q = pageToImage(prov, p)!;
    return [q.x, q.y];
  };
  // every recorded edit is an isometry, so one scale holds over the picture
  const pxPerPt = Math.hypot(m[0], m[1]);
  const to255 = (c: readonly number[]): [number, number, number] => {
    const big = c.some((v) => v > 1);
    return [0, 1, 2].map((i) => Math.round(big ? c[i]! : c[i]! * 255)) as [number, number, number];
  };
  const box = (b: readonly [number, number, number, number]) => {
    const q = [at([b[0], b[1]]), at([b[2], b[1]]), at([b[0], b[3]]), at([b[2], b[3]])];
    const xs = q.map((p) => p[0]), ys = q.map((p) => p[1]);
    return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  };
  return {
    shapes: drawing.shapes.map((s) => ({
      subs: s.subs.map((sp) => sp.map(at)),
      stroked: s.stroked,
      filled: s.filled,
      stroke: to255(s.stroke),
      fill: to255(s.fill),
      lineWidth: s.lineWidth * pxPerPt,
      dash: s.dash,
    })),
    text: text.map(box),
    pxPerPt,
  };
}
