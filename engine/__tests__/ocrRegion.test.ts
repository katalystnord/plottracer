import { describe, it, expect } from 'vitest';

import { cropForOcr, normalizeOcrText, axisQuarterTurn } from '../ocrRegion.js';

/**
 * The pure half of reading a label off the figure (v2.4, OCR phase 1).
 *
 * ⚑ These are the agreed design's cases, named for the CASE rather than the
 * function, and each was shown to fail before `engine/ocrRegion.ts` existed -
 * gate 2 in CLAUDE.md. The design is
 * `project_ocr_category_capture_design` in the memory notes.
 *
 * ⚑ WHY THE GEOMETRY IS HERE AND NOT IN THE MAIN PROCESS. The reader takes
 * encoded bytes and gives back text; everything about WHICH pixels it reads is
 * ours, so it lives where it can be tested without an OCR engine, an Electron
 * process or a figure. `cropImage`/`applyImageEditOp` already do the work - this
 * module only says which of them to call.
 */

/** A tiny image whose every pixel is identifiable: red = x, green = y. */
function ramp(w: number, h: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      out[i] = x;
      out[i + 1] = y;
      out[i + 2] = 0;
      out[i + 3] = 255;
    }
  }
  return out;
}

const at = (c: { data: Uint8ClampedArray; width: number }, x: number, y: number) => {
  const i = (y * c.width + x) * 4;
  return { x: c.data[i]!, y: c.data[i + 1]! };
};

describe('OCR region: the reader is handed one label, not the figure', () => {
  it('reads the pixels under the drawn box and nothing else', () => {
    const crop = cropForOcr(ramp(20, 10), 20, 10, { x: 4, y: 2, width: 5, height: 3 }, 0);
    expect(crop).not.toBeNull();
    expect([crop!.width, crop!.height]).toEqual([5, 3]);
    // Its top-left IS the box's top-left in the figure - the whole point of a
    // region gesture is that the association is stated, not inferred.
    expect(at(crop!, 0, 0)).toEqual({ x: 4, y: 2 });
    expect(at(crop!, 4, 2)).toEqual({ x: 8, y: 4 });
  });

  it('refuses a box that has fallen off the figure rather than reading blank paper', () => {
    // `clampCropRect` already refuses an empty or off-image rectangle; a stray
    // click must not reach the reader as a region of nothing, because whatever
    // came back would still arrive looking like a proposal.
    expect(cropForOcr(ramp(20, 10), 20, 10, { x: 30, y: 30, width: 5, height: 5 }, 0)).toBeNull();
    expect(cropForOcr(ramp(20, 10), 20, 10, { x: 2, y: 2, width: 0, height: 5 }, 0)).toBeNull();
  });

  it('hands the reader a rotated label the right way up', () => {
    // ⚑ A quarter turn CLOCKWISE, applied to the CROP - the figure is never
    // touched. `applyImageEditOp('rotate-cw')` is the app's existing lossless
    // 90-degree rotation, so a turned crop cannot drift from what the canvas
    // would have shown.
    const straight = cropForOcr(ramp(20, 10), 20, 10, { x: 4, y: 2, width: 5, height: 3 }, 0)!;
    const turned = cropForOcr(ramp(20, 10), 20, 10, { x: 4, y: 2, width: 5, height: 3 }, 1)!;
    expect([turned.width, turned.height]).toEqual([3, 5]);
    // Clockwise: the crop's bottom-left pixel becomes the turned crop's top-left.
    expect(at(turned, 0, 0)).toEqual(at(straight, 0, 2));
    // And four turns is the identity, so the control can simply cycle.
    const round = cropForOcr(ramp(20, 10), 20, 10, { x: 4, y: 2, width: 5, height: 3 }, 0)!;
    expect(Array.from(round.data)).toEqual(Array.from(straight.data));
  });
});

describe('OCR region: a transcription is tidied, never invented', () => {
  it('collapses the reader own line breaks into the one line a label is', () => {
    expect(normalizeOcrText('Mar\n')).toBe('Mar');
    expect(normalizeOcrText('  Flax \n\n')).toBe('Flax');
    expect(normalizeOcrText('Cure\ntime')).toBe('Cure time');
  });

  it('gives back nothing for a region that read nothing', () => {
    // ⚑ An empty proposal is "no reading", never "erase the name" - the review
    // card leaves that category alone (design case 8).
    expect(normalizeOcrText('   \n ')).toBe('');
    expect(normalizeOcrText('')).toBe('');
  });
});

describe('OCR region: the AXIS decides the angle, not one label', () => {
  /**
   * ⚑⚑ THE MEASURED CASE, and the numbers are the measurement itself.
   *
   * `samples/bar-tensile-strength.png`, its six category labels turned 90
   * clockwise, each read at all four quarter turns (2026-08-30, offline, with
   * the codec self-checked first). Rows are turns 0/90/180/270, columns are the
   * six labels.
   *
   * ▶ Per LABEL, best confidence picks the right turn five times out of six:
   * `Kenaf` reads as garbage `"Jeusy"` at 90 with confidence 79, beating the
   * correct reading at 270 on 73. A confident wrong answer is the one thing this
   * project may not assert.
   *
   * ▶ Per AXIS, the mean picks 270 by 90 against 53 - because every label on an
   * axis is turned the same way, so the evidence lives one level up from the
   * thing being judged. The label that could not defend itself is carried by the
   * other five.
   */
  const MEASURED = [
    [38, 72, 41, 65, 25, 50], // 0
    [15, 53, 56, 79, 40, 0], //  90
    [63, 45, 41, 56, 77, 36], // 180
    [96, 95, 96, 73, 96, 83], // 270
  ];

  it('picks the turn the whole axis agrees on', () => {
    expect(axisQuarterTurn(MEASURED)).toBe(3);
  });

  it('carries the one label whose own best reading is wrong', () => {
    // The failure this exists to prevent, stated as the comparison it wins:
    // Kenaf is column 3, and its own best turn is 90 (79) rather than 270 (73).
    const kenaf = MEASURED.map((row) => row[3]!);
    const ownBest = kenaf.indexOf(Math.max(...kenaf));
    expect(ownBest).toBe(1);
    expect(axisQuarterTurn(MEASURED)).not.toBe(ownBest);
  });

  it('says nothing when there is nothing to compare', () => {
    // ⚑ No readings, no angle - and the caller then leaves the crop as the user
    // drew it. Refusing is not a failure state here; it is "no evidence".
    expect(axisQuarterTurn([])).toBeNull();
    expect(axisQuarterTurn([[], [], [], []])).toBeNull();
  });

  it('needs all four turns before it will name one', () => {
    // A partial sweep would compare a turn against turns nobody tried, which is
    // exactly the shape of a confident wrong answer.
    expect(axisQuarterTurn([[90], [10], [10]])).toBeNull();
  });
});
