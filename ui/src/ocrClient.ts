import {
  cropForOcr,
  upscaleForOcr,
  labelRegionsInBand,
  axisQuarterTurn,
  normalizeOcrText,
  type QuarterTurn,
} from '../../engine/ocrRegion.js';
import type { CropRect } from '../../engine/imageEdit.js';

/**
 * Turning one dragged band into a proposal per category (v2.4).
 *
 * ⚑ GLUE ONLY, and deliberately so. Every decision in here is made somewhere
 * testable: `engine/ocrRegion.ts` cuts the band and picks the axis's turn,
 * `ui/electron-ocr.cjs` reads the pixels. What is left is the one thing that can
 * only happen in a renderer - turning pixels into PNG bytes through a canvas -
 * plus the loop that carries a row from one to the other.
 *
 * ⚑⚑ NOTHING HERE TOUCHES THE RECORD. A reading becomes an `OcrProposal` and
 * nothing more; only the review card's Apply writes a name. That is what makes
 * the provenance question answer itself (David, 2026-08-30): every name in the
 * record has been read and approved by a person, so there is nothing to mark.
 */

export interface OcrProposal {
  categoryIndex: number;
  rect: CropRect;
  /** What the reader made of it, tidied to one line. May be empty. */
  text: string;
  /** Reported beside the row as evidence, never used as a threshold. */
  confidence: number;
  /** The crop AS THE READER SAW IT, turned - the row's thumbnail. */
  thumbnail: string;
  /** Which quarter turn produced the text above, so `Rotate` can carry on. */
  turn: QuarterTurn;
}

export interface OcrBandResult {
  proposals: OcrProposal[];
  /** The turn the whole axis agreed on - shown so the card can say so. */
  turn: QuarterTurn;
}

export interface OcrFailure {
  error: string;
}

export function isOcrFailure<T extends object>(x: T | OcrFailure): x is OcrFailure {
  return (x as OcrFailure).error !== undefined;
}

/**
 * PNG bytes for a crop, via a canvas - the one step that needs a browser.
 *
 * ⚑ The full data URL is kept for the thumbnail and the bare base64 handed to
 * the reader, so the picture in the card and the pixels that were read are the
 * SAME bytes rather than two renderings that could drift.
 */
function encodeCrop(crop: { data: Uint8ClampedArray; width: number; height: number }): {
  dataUrl: string;
  base64: string;
} | null {
  const canvas = document.createElement('canvas');
  canvas.width = crop.width;
  canvas.height = crop.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  // ⚑ Copied into a fresh array: `ImageData` requires one backed by a plain
  // ArrayBuffer, and the crop's own buffer type is not narrowed to that. A label
  // crop is a few thousand pixels, so the copy is not worth a cast that would
  // silence the compiler about a real distinction.
  ctx.putImageData(
    new ImageData(new Uint8ClampedArray(crop.data), crop.width, crop.height),
    0,
    0
  );
  const dataUrl = canvas.toDataURL('image/png');
  return { dataUrl, base64: dataUrl.slice(dataUrl.indexOf(',') + 1) };
}

const NO_BRIDGE =
  'Reading text needs the desktop app - this window has no connection to it.';

async function readCrop(
  image: ImageData,
  rect: CropRect,
  turn: QuarterTurn
): Promise<{ text: string; confidence: number; thumbnail: string } | OcrFailure> {
  const api = window.electronAPI;
  if (!api) return { error: NO_BRIDGE };
  const crop = cropForOcr(image.data, image.width, image.height, rect, turn);
  if (!crop) return { error: 'That box is not on the figure.' };
  // ⚑ Scaled up before the reader sees it - a chart label is often 12 to 16
  // pixels tall and the engine wants several times that. Measured worth 8.7
  // points of exact-match on real published charts; see `upscaleForOcr`.
  const encoded = encodeCrop(upscaleForOcr(crop));
  if (!encoded) return { error: 'Could not prepare that region to be read.' };
  const answer = await api.readText(encoded.base64);
  if (answer.error !== undefined) return { error: answer.error };
  return {
    text: normalizeOcrText(answer.text ?? ''),
    confidence: answer.confidence ?? 0,
    thumbnail: encoded.dataUrl,
  };
}

/**
 * Read one region again at a given turn - what the card's `Rotate` runs.
 */
export async function readRegionAt(
  image: ImageData,
  rect: CropRect,
  categoryIndex: number,
  turn: QuarterTurn
): Promise<OcrProposal | OcrFailure> {
  const answer = await readCrop(image, rect, turn);
  if (isOcrFailure(answer)) return answer;
  return { categoryIndex, rect, turn, ...answer };
}

/**
 * One dragged band becomes one proposal per category it reaches.
 *
 * ⚑⚑ EVERY REGION IS READ AT ALL FOUR TURNS, and the AXIS picks which set to
 * keep. Per-label best confidence picks a confidently WRONG answer about one
 * label in six (measured: `Kenaf` read as `"Jeusy"` at 79, beating its own
 * correct reading at 73); the axis mean picks the right turn by 90 against 53,
 * because every label on an axis is written the same way up. The cost is four
 * reads of a small region, which measured at 2 to 15ms each.
 *
 * ⚑ The four sweeps are already in hand when the vote is taken, so the winning
 * turn needs no re-reading.
 */
export async function readLabelBand(
  image: ImageData,
  band: CropRect,
  dividers: readonly { x: number; y: number }[],
  along: 'x' | 'y'
): Promise<OcrBandResult | OcrFailure> {
  const regions = labelRegionsInBand(band, dividers, along);
  if (regions.length === 0) {
    return {
      error:
        'That box does not overlap any category on the axis. Drag it round the row of labels beneath the axis you marked.',
    };
  }
  const sweeps: { text: string; confidence: number; thumbnail: string }[][] = [];
  for (const turn of [0, 1, 2, 3] as QuarterTurn[]) {
    const rows: { text: string; confidence: number; thumbnail: string }[] = [];
    for (const region of regions) {
      const answer = await readCrop(image, region.rect, turn);
      // ⚑ One region failing ends the whole read rather than quietly proposing
      // for the others: a card that is short a row looks exactly like an axis
      // with fewer categories, and the user has no way to tell which it is.
      if (isOcrFailure(answer)) return answer;
      rows.push(answer);
    }
    sweeps.push(rows);
  }
  const turn = axisQuarterTurn(sweeps.map((rows) => rows.map((r) => r.confidence)));
  if (turn === null) return { error: 'Nothing could be read from that box.' };
  return {
    turn,
    proposals: regions.map((region, i) => ({
      categoryIndex: region.categoryIndex,
      rect: region.rect,
      turn,
      ...sweeps[turn]![i]!,
    })),
  };
}
