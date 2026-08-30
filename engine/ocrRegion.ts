import { clampCropRect, cropImage, applyImageEditOp, type CropRect } from './imageEdit.js';

/**
 * The pure half of reading a label off the figure (v2.4, OCR phase 1).
 *
 * ⚑⚑ THE READER TAKES BYTES AND GIVES BACK TEXT. Everything about WHICH pixels
 * it reads is ours and lives here, where it can be tested without an OCR engine,
 * an Electron process or a figure. That split is what keeps the OCR boundary one
 * function wide.
 *
 * ⚑ REUSE: the crop and the quarter turn are `cropImage` and
 * `applyImageEditOp('rotate-cw')`, the same two the image-edit tools have used
 * since checkpoint 63/64. A second cropper would be a second answer to "which
 * pixels are inside this box", and the figure would eventually disagree with the
 * card.
 *
 * ⚑ WHY A REGION AT ALL, measured rather than assumed: whole-figure OCR
 * recovered ZERO of a bar chart's twelve category labels, and one region per
 * label recovered twelve of twelve. The gesture that keeps the association
 * stated by the user rather than inferred is also the one that works.
 */

/** Quarter turns clockwise, applied to the CROP. The figure never turns. */
export type QuarterTurn = 0 | 1 | 2 | 3;

export interface OcrCrop {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/**
 * The pixels under one drawn box, turned as the reader should see them.
 *
 * Null where the box has fallen off the figure or has no area - `clampCropRect`
 * already refuses those, and passing one through would hand the reader blank
 * paper whose reading would still arrive looking like a proposal.
 */
export function cropForOcr(
  src: Uint8ClampedArray,
  width: number,
  height: number,
  rect: CropRect,
  turns: QuarterTurn
): OcrCrop | null {
  const clamped = clampCropRect(rect, width, height);
  if (!clamped) return null;
  const cropped = cropImage(src, width, height, clamped);
  if (!cropped) return null;
  let out: OcrCrop = { data: cropped.data, width: cropped.width, height: cropped.height };
  for (let i = 0; i < turns; i++) {
    const turned = applyImageEditOp('rotate-cw', out.data, out.width, out.height);
    out = { data: turned.data, width: turned.width, height: turned.height };
  }
  return out;
}

/**
 * One label is one line, so the reader's own line breaks are collapsed.
 *
 * ⚑ TIDIED, NEVER INVENTED. Nothing is spell-corrected, capitalised or matched
 * against a word list: what comes back is what was read, minus the whitespace
 * the engine adds around a block. An empty result stays empty, and the review
 * card treats that as "no reading" rather than "erase the name".
 */
export function normalizeOcrText(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

/**
 * ⚑⚑ WHICH WAY THE LABELS ON THIS AXIS ARE TURNED - asked of the AXIS, because
 * asking each label produces a confident wrong answer.
 *
 * `confidenceByTurn[t][i]` is label `i` read at turn `t`. Returns the turn with
 * the best MEAN confidence across the whole axis, or null when there is nothing
 * to compare.
 *
 * ▶ MEASURED 2026-08-30 on `samples/bar-tensile-strength.png`, six labels turned
 * 90 clockwise and read at all four turns (offline, codec self-checked first):
 *
 *   · per LABEL, best confidence picks the right turn **5 of 6** - `Kenaf` reads
 *     as `"Jeusy"` at 90 with confidence 79 and beats its own correct reading at
 *     270 on 73;
 *   · per AXIS, the mean picks 270 by **90 against 53**, and all six then read
 *     correctly.
 *
 * ⚑ The reason is not statistical luck: every label on an axis is drawn at the
 * same angle, so the angle is a property of the AXIS and the evidence for it
 * lives one level up from the label being judged. The same shape as the crowded
 * reading, which is decided across a series rather than in one cell.
 *
 * ⛔ It is still an OFFER. The card opens with this turn applied and the
 * thumbnails the right way up; the per-row rotate control stays, because 6/6 on
 * one figure is not a promise about every figure.
 */
export function axisQuarterTurn(
  confidenceByTurn: readonly (readonly number[])[]
): QuarterTurn | null {
  // ⚑ All four, or none. A partial sweep would compare a turn against turns
  // nobody tried - which is the confident-wrong-answer shape this function
  // exists to remove, reappearing one level up.
  if (confidenceByTurn.length !== 4) return null;
  let best: QuarterTurn | null = null;
  let bestMean = -Infinity;
  for (let t = 0; t < 4; t++) {
    const row = confidenceByTurn[t]!;
    if (row.length === 0) return null;
    const mean = row.reduce((a, b) => a + b, 0) / row.length;
    if (mean > bestMean) {
      bestMean = mean;
      best = t as QuarterTurn;
    }
  }
  return best;
}
