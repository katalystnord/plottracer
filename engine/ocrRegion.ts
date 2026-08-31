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

export interface LabelRegion {
  categoryIndex: number;
  rect: CropRect;
}

/**
 * ⚑⚑ THE USER DRAWS THE BAND; THE AXIS DECIDES THE CUTS.
 *
 * One drag round the row of category labels, cut into one region per category at
 * the category axis's own N+1 dividers.
 *
 * ⚑ WHY NOT HAND THE BAND STRAIGHT TO THE READER: measured in the spike, a whole
 * axis in one box read `30 | 20 | ) | V | 5 10` at confidence 54, while the same
 * numbers read perfectly one tick at a time. A strip is not a region. So the
 * band is never OCR'd; only its pieces are.
 *
 * ⚑⚑ WHY NOT OFFER k RECTANGLES INSTEAD, which the design first proposed: we
 * would then be DRAWING where the labels are, which we have not measured, on a
 * figure that may put them anywhere. One drag says where the labels are (the
 * user can see them) and the axis says where one ends and the next begins (we
 * measured that, from their own two clicks and their declared count). Each half
 * comes from whoever actually knows.
 *
 * ⚑ Direction-agnostic, so a chart with horizontal bars works without this code
 * knowing that rotation exists: `along` names the dimension the categories run
 * in, and the other dimension is left exactly as the user drew it.
 */
export function labelRegionsInBand(
  band: CropRect,
  dividers: readonly { x: number; y: number }[],
  along: 'x' | 'y'
): LabelRegion[] {
  if (dividers.length < 2) return [];
  const bandStart = along === 'x' ? band.x : band.y;
  const bandEnd = bandStart + (along === 'x' ? band.width : band.height);
  const out: LabelRegion[] = [];
  for (let i = 0; i + 1 < dividers.length; i++) {
    const a = along === 'x' ? dividers[i]!.x : dividers[i]!.y;
    const b = along === 'x' ? dividers[i + 1]!.x : dividers[i + 1]!.y;
    // ⚑ min/max rather than a-then-b: the two axis ends are the user's clicks IN
    // THE ORDER THEY MADE THEM, so a right-to-left marking gives descending
    // dividers. Which category a band IS must not depend on the direction of the
    // hand that marked it.
    const from = Math.max(Math.min(a, b), bandStart);
    const to = Math.min(Math.max(a, b), bandEnd);
    const size = to - from;
    // ⚑ A band the drag does not reach gets NO proposal, and is not stretched to
    // meet one: a box drawn over half the axis means the user pointed at half
    // the labels, and the rest are left exactly as they were.
    if (size < 1) continue;
    out.push({
      categoryIndex: i,
      rect:
        along === 'x'
          ? { x: from, y: band.y, width: size, height: band.height }
          : { x: band.x, y: from, width: band.width, height: size },
    });
  }
  return out;
}

/**
 * Which dimension an axis runs in, from the two ends the user clicked.
 *
 * ⚑ MEASURED off their own clicks rather than declared by an option: the
 * `Horizontal bars` checkbox says how the BARS are drawn, and reading it here
 * would be a second source for a fact the geometry already carries.
 */
export function axisRunsAlong(
  a: { x: number; y: number },
  b: { x: number; y: number }
): 'x' | 'y' {
  return Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? 'x' : 'y';
}

/**
 * The height a crop is scaled up to before the reader sees it.
 *
 * ⚑⚑ MEASURED, not chosen: on 876 tick labels from real published charts,
 * scaling small crops up took the exact-match score from 70.1% to 78.8%. A chart
 * label is often 12 to 16 pixels tall, and the engine is trained on scanned text
 * several times that - so the single commonest failure was a short numeric label
 * coming back EMPTY at confidence 0.
 */
export const OCR_MIN_HEIGHT = 48;

/**
 * Scale a crop up so short text is tall enough for the reader.
 *
 * ⚑ NEAREST NEIGHBOUR, by whole factors only. Text is high-contrast line art:
 * smoothing it invents grey edges where the glyph has none, which is the
 * opposite of helpful, and a whole factor keeps every original pixel a clean
 * block rather than resampling the strokes.
 *
 * ⚑ Returns the crop UNCHANGED when it is already tall enough, so a big region
 * is never blown up into a slow read for nothing.
 */
export function upscaleForOcr(crop: OcrCrop, minHeight = OCR_MIN_HEIGHT): OcrCrop {
  if (crop.height <= 0 || crop.height >= minHeight) return crop;
  const factor = Math.min(6, Math.ceil(minHeight / crop.height));
  if (factor < 2) return crop;
  const width = crop.width * factor;
  const height = crop.height * factor;
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const sy = (y / factor) | 0;
    for (let x = 0; x < width; x++) {
      const sx = (x / factor) | 0;
      const s = (sy * crop.width + sx) * 4;
      const d = (y * width + x) * 4;
      out[d] = crop.data[s]!;
      out[d + 1] = crop.data[s + 1]!;
      out[d + 2] = crop.data[s + 2]!;
      out[d + 3] = crop.data[s + 3]!;
    }
  }
  return { data: out, width, height };
}
