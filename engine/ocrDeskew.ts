/**
 * ⚑⚑ STRAIGHTEN THE LABEL BAND, THEN READ IT WHOLE (v2.5).
 *
 * David, 2026-09-08, on a candlestick figure whose date labels run at 45 degrees
 * and read back as `he' "0 3 9` at confidence 32: *"I have NEVER seen category
 * names with different angles, have you? They should be the same, no? Which
 * means, how about showing ONE with a slider, not just fixed steps, and ONE
 * results window to show the read."*
 *
 * ⚑⚑ THE ANGLE IS A PROPERTY OF THE AXIS, and the code already said so -
 * `axisQuarterTurn` picks ONE turn for the whole axis by mean confidence,
 * because per-label confidence picks a confidently wrong turn for one label in
 * six. What it did not do was follow that through: it quantised a continuous
 * property to FOUR values, and then offered a per-ROW rotate button for a
 * per-AXIS fact. A 45 degree axis has no good quarter turn, so all four are
 * equally wrong and the card shows the least bad garbage.
 *
 * ⚑⚑ AND NO PER-LABEL CROP. David: *"All we need (I think) is to know the angle
 * at which the text read resonably, and that gets us all the text for the whole
 * marked region. And THEN, we just need to relate this with the positions on the
 * tick marks."* He is right, and it dissolves a problem rather than solving it:
 * an axis-aligned box cut at the category dividers CANNOT contain a diagonal
 * label, which is why every thumbnail on his card was a streak of two or three
 * labels. Straighten first and the cutting is not needed at all.
 *
 * ⚠️ THE ONE MEASUREMENT THAT ARGUES THE OTHER WAY, kept here on purpose: the
 * v2.4 spike found a whole axis in one box reading `30 | 20 | ) | V | 5 10` at
 * confidence 54 while the same numbers read perfectly one tick at a time. It
 * does NOT refute this - it tested a horizontal strip, undeskewed, taking the
 * whole returned string, and never used the word boxes the engine returns. But
 * it is why this has to be MEASURED against `ocrCorpusRecall`'s 35/36 floor
 * rather than assumed better.
 */

/** A greyscale ink mask: 1 where there is ink, 0 where there is paper. */
function inkMask(
  data: Uint8ClampedArray,
  width: number,
  height: number
): { ink: Float32Array; width: number; height: number } {
  const ink = new Float32Array(width * height);
  // ⚑ The paper is whatever the BORDER is, measured, not assumed white - the
  // same rule the candle bodies are judged by. A dark-themed figure has ink that
  // is LIGHTER than its ground, and a hardcoded threshold reads it as all ink.
  let border = 0;
  let n = 0;
  for (let x = 0; x < width; x++) {
    border += luma(data, width, x, 0) + luma(data, width, x, height - 1);
    n += 2;
  }
  const paper = n > 0 ? border / n : 255;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      ink[y * width + x] = Math.abs(luma(data, width, x, y) - paper) / 255;
    }
  }
  return { ink, width, height };
}

function luma(data: Uint8ClampedArray, width: number, x: number, y: number): number {
  const i = (y * width + x) * 4;
  return 0.299 * (data[i] ?? 0) + 0.587 * (data[i + 1] ?? 0) + 0.114 * (data[i + 2] ?? 0);
}

/** Candidate angles swept, in degrees. ⚑ Wider than the 45 that prompted this:
 *  chart tools offer 30, 45, 60 and 90, and a hand-drawn figure lands between. */
export const DESKEW_RANGE_DEG = 75;

/**
 * The angle the band's text runs at, in RADIANS, measured off the ink.
 *
 * ⚑⚑ PROJECTION-PROFILE VARIANCE, the classic deskew: rotate the ink by a
 * candidate angle, sum each row, and score how PEAKY the result is. Text rows
 * aligned with the sum direction give tall peaks separated by empty gaps, so the
 * variance is maximal at the true angle. Nothing here reads a character.
 *
 * ⚑ Positive means the text runs down to the right, as a matplotlib
 * `rotation=-45` label does.
 *
 * ⛔ It OFFERS. The slider is what settles it, because a band containing a
 * stray gridline or a truncated neighbour can peak in the wrong place, and the
 * user can see the read while we cannot.
 */
export function estimateTextAngle(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  stepDeg = 1
): number {
  if (width < 2 || height < 2) return 0;
  const { ink } = inkMask(data, width, height);
  let bestScore = -Infinity;
  let bestDeg = 0;
  for (let deg = -DESKEW_RANGE_DEG; deg <= DESKEW_RANGE_DEG; deg += stepDeg) {
    const score = profileVariance(ink, width, height, (deg * Math.PI) / 180);
    if (score > bestScore) {
      bestScore = score;
      bestDeg = deg;
    }
  }
  return (bestDeg * Math.PI) / 180;
}

/** How peaky the row-sums are once the ink is rotated by `radians`. */
function profileVariance(
  ink: Float32Array,
  width: number,
  height: number,
  radians: number
): number {
  const cos = Math.cos(-radians);
  const sin = Math.sin(-radians);
  const cx = width / 2;
  const cy = height / 2;
  // ⚑ Rows indexed in the ROTATED frame, so the accumulator has to span the
  // rotated bounding box or a steep angle would fold its ends onto each other.
  const span = Math.ceil(Math.abs(width * sin) + Math.abs(height * cos)) + 1;
  const rows = new Float32Array(span);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = ink[y * width + x]!;
      if (v <= 0) continue;
      const ry = (x - cx) * sin + (y - cy) * cos + span / 2;
      const r = Math.round(ry);
      if (r >= 0 && r < span) rows[r] = rows[r]! + v;
    }
  }
  let mean = 0;
  for (const v of rows) mean += v;
  mean /= span;
  let variance = 0;
  for (const v of rows) variance += (v - mean) * (v - mean);
  return variance / span;
}

/** A straightened band, and the way back to the figure's own pixels. */
export interface DeskewedBand {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  /** Map a point in the straightened image back to the ORIGINAL crop's frame.
   *  ⚑ This is what turns a word's box into a position on the category axis. */
  toSource(x: number, y: number): { x: number; y: number };
}

/**
 * Rotate a band by `-radians`, so text that ran at that angle comes out level.
 *
 * ⚑ BILINEAR, and the reason is measured elsewhere in this feature: nearest
 * neighbour read 65.2% against bilinear's 75.1% on 876 real tick labels. The
 * engine is trained on scanned text, so a hard-edged staircase is the unfamiliar
 * input.
 *
 * ⚑ The output is the rotated content's own bounding box, so nothing is clipped
 * - a 45 degree band is wider and taller than the box it came from.
 */
export function deskewBand(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  radians: number
): DeskewedBand {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const outW = Math.max(1, Math.ceil(Math.abs(width * cos) + Math.abs(height * sin)));
  const outH = Math.max(1, Math.ceil(Math.abs(width * sin) + Math.abs(height * cos)));
  const out = new Uint8ClampedArray(outW * outH * 4);
  const cx = width / 2;
  const cy = height / 2;
  const ox = outW / 2;
  const oy = outH / 2;
  // ⚑ The paper colour fills what the rotation exposes at the corners, so the
  // reader is not handed black wedges it will try to make letters out of.
  const paper = borderColour(data, width, height);
  const toSource = (x: number, y: number) => {
    const dx = x - ox;
    const dy = y - oy;
    return { x: dx * cos - dy * sin + cx, y: dx * sin + dy * cos + cy };
  };
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const src = toSource(x + 0.5, y + 0.5);
      const d = (y * outW + x) * 4;
      if (src.x < 0 || src.y < 0 || src.x >= width - 1 || src.y >= height - 1) {
        out[d] = paper[0];
        out[d + 1] = paper[1];
        out[d + 2] = paper[2];
        out[d + 3] = 255;
        continue;
      }
      const x0 = Math.floor(src.x);
      const y0 = Math.floor(src.y);
      const wx = src.x - x0;
      const wy = src.y - y0;
      for (let c = 0; c < 4; c++) {
        const at = (px: number, py: number) => data[(py * width + px) * 4 + c] ?? 0;
        const top = at(x0, y0) * (1 - wx) + at(x0 + 1, y0) * wx;
        const bottom = at(x0, y0 + 1) * (1 - wx) + at(x0 + 1, y0 + 1) * wx;
        out[d + c] = Math.round(top * (1 - wy) + bottom * wy);
      }
    }
  }
  return { data: out, width: outW, height: outH, toSource };
}

function borderColour(
  data: Uint8ClampedArray,
  width: number,
  height: number
): [number, number, number] {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let x = 0; x < width; x++) {
    for (const y of [0, height - 1]) {
      const i = (y * width + x) * 4;
      r += data[i] ?? 0;
      g += data[i + 1] ?? 0;
      b += data[i + 2] ?? 0;
      n++;
    }
  }
  return n === 0 ? [255, 255, 255] : [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
}
