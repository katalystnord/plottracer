// The PP-OCRv6 tiny pipeline, ported from PaddleX to plain JS (v2.7).
//
// ⚑⚑ PORTED, NOT REDESIGNED. Every number here (the 64 px detection floor, the
// 0.3 / 0.6 / 1.5 box thresholds, the 48 px recognition height, the mid-grey
// padding) is PaddleX 3.x's own default, read
// off its source on 2026-10-15. The accuracy that justified the switch was
// measured with those settings, so changing one is a new measurement, not a
// tidy-up. The two departures (axis-aligned boxes, no turn for tall boxes) are
// explained where they are made.
//
// ⚑ PURE: pixels in, lines and words out. The ONNX sessions are handed in, so
// this runs the same under vitest, in the benchmark harness and in the app.
'use strict'

const DET_LIMIT_SIDE = 64
const DET_MAX_SIDE = 4000
const DET_THRESH = 0.3
const DET_BOX_THRESH = 0.6
const DET_UNCLIP = 1.5
const DET_MIN_SIZE = 3
const DET_MEAN = [0.485, 0.456, 0.406]
const DET_STD = [0.229, 0.224, 0.225]
const REC_HEIGHT = 48
const REC_MIN_WIDTH = 320
const REC_MAX_WIDTH = 3200
/**
 * ⚑⚑ A GAP WIDER THAN THIS, IN LINE HEIGHTS, ENDS A WORD even when the recogniser
 * wrote no space. Spread-out labels on one detected line come back joined
 * (`AprMayJunJul` on bar-floating-temperature's month axis), and a joined word
 * lands on one tick. Measured 2026-10-15 on the recogniser's own time steps:
 * letters inside a word sit 0.25 to 0.7 line heights apart, those labels 1.8 to
 * 2.3. The cut is between, nearer the letters.
 */
const WORD_GAP_HEIGHTS = 1.15

/** OpenCV's source index and 11-bit weights for one output coordinate of a linear resize. */
function linearTap(d, scale, size) {
  let f = (d + 0.5) * scale - 0.5
  let s = Math.floor(f)
  f -= s
  if (s < 0) {
    f = 0
    s = 0
  }
  if (s + 1 >= size) {
    f = 0
    s = size - 1
  }
  return { s, s1: Math.min(size - 1, s + 1), a0: Math.round((1 - f) * 2048), a1: Math.round(f * 2048) }
}

/**
 * Bilinear resize to (W, H) of an 8-bit image held as three channels, reproducing
 * OpenCV's `cv2.resize(INTER_LINEAR)` on uint8 to the unit.
 *
 * ⚠️⚑⚑ TO THE UNIT, AND A FLOAT RESIZE WAS NOT CLOSE ENOUGH. The detector's map is
 * thresholded at 0.3, and a resize that differed by fractions of a grey level cut
 * one pixel out of a real axis row: the blob split, the box lost 6 px on its left,
 * and `18 20 22 24` read as `1820 2224`. PaddleX resizes with OpenCV, so the port
 * does what OpenCV does: weights rounded to 11 bits, the row pass kept in integers,
 * the column pass in the SIMD form x86 builds run, and the result rounded to 0..255.
 */
function resizeRgb(rgb, w, h, W, H) {
  const out = new Float32Array(W * H * 3)
  const xt = []
  for (let x = 0; x < W; x++) xt.push(linearTap(x, w / W, w))
  const row = (y) => {
    const r = new Int32Array(W * 3)
    for (let x = 0; x < W; x++) {
      const { s, s1, a0, a1 } = xt[x]
      for (let c = 0; c < 3; c++) r[x * 3 + c] = rgb[(y * w + s) * 3 + c] * a0 + rgb[(y * w + s1) * 3 + c] * a1
    }
    return r
  }
  for (let y = 0; y < H; y++) {
    const { s, s1, a0: b0, a1: b1 } = linearTap(y, h / H, h)
    const r0 = row(s)
    const r1 = s1 === s ? r0 : row(s1)
    for (let i = 0; i < W * 3; i++) {
      const v = (((b0 * (r0[i] >> 4)) >> 16) + ((b1 * (r1[i] >> 4)) >> 16) + 2) >> 2
      out[y * W * 3 + i] = v < 0 ? 0 : v > 255 ? 255 : v
    }
  }
  return out
}

/**
 * RGBA to BGR floats, transparency laid over WHITE paper.
 * ⚑ A figure exported with a transparent background stores its paper as
 * (0,0,0,0); dropping alpha would turn the page black and the text unreadable.
 */
function toBgr({ data, width, height }) {
  const out = new Float32Array(width * height * 3)
  for (let p = 0; p < width * height; p++) {
    const a = data[p * 4 + 3] / 255
    for (let c = 0; c < 3; c++) out[p * 3 + c] = Math.round(data[p * 4 + 2 - c] * a + 255 * (1 - a))
  }
  return out
}

function cropBgr(bgr, w, x0, y0, x1, y1) {
  const cw = x1 - x0
  const ch = y1 - y0
  const out = new Float32Array(cw * ch * 3)
  for (let y = 0; y < ch; y++) out.set(bgr.subarray(((y0 + y) * w + x0) * 3, ((y0 + y) * w + x1) * 3), y * cw * 3)
  return out
}

/**
 * Text boxes in image pixels, from the detector's probability map.
 *
 * ⚑ AXIS-ALIGNED, where PaddleX fits a rotated rectangle. Every caller hands the
 * reader text that is already upright (`deskewBand` straightens a band before it
 * is read), and for upright text the two coincide; it spares an OpenCV contour
 * port and a polygon clipper.
 */
async function detect(ort, session, bgr, w, h) {
  let ratio = Math.min(w, h) < DET_LIMIT_SIDE ? DET_LIMIT_SIDE / Math.min(w, h) : 1
  let rh = Math.trunc(h * ratio)
  let rw = Math.trunc(w * ratio)
  if (Math.max(rh, rw) > DET_MAX_SIDE) {
    ratio = DET_MAX_SIDE / Math.max(rh, rw)
    rh = Math.trunc(rh * ratio)
    rw = Math.trunc(rw * ratio)
  }
  rh = Math.max(Math.round(rh / 32) * 32, 32)
  rw = Math.max(Math.round(rw / 32) * 32, 32)
  const resized = rh === h && rw === w ? bgr : resizeRgb(bgr, w, h, rw, rh)
  const plane = rw * rh
  const t = new Float32Array(3 * plane)
  for (let p = 0; p < plane; p++) {
    for (let c = 0; c < 3; c++) t[c * plane + p] = (resized[p * 3 + c] / 255 - DET_MEAN[c]) / DET_STD[c]
  }
  const out = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', t, [1, 3, rh, rw]) })
  const pred = out[session.outputNames[0]].data

  const seen = new Uint8Array(plane)
  const boxes = []
  const stack = []
  for (let start = 0; start < plane; start++) {
    if (seen[start] || pred[start] <= DET_THRESH) continue
    let minX = rw, minY = rh, maxX = -1, maxY = -1
    seen[start] = 1
    stack.push(start)
    while (stack.length) {
      const p = stack.pop()
      const px = p % rw
      const py = (p - px) / rw
      if (px < minX) minX = px
      if (px > maxX) maxX = px
      if (py < minY) minY = py
      if (py > maxY) maxY = py
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = px + dx
          const ny = py + dy
          if (nx < 0 || ny < 0 || nx >= rw || ny >= rh) continue
          const q = ny * rw + nx
          if (!seen[q] && pred[q] > DET_THRESH) {
            seen[q] = 1
            stack.push(q)
          }
        }
      }
    }
    const bw = maxX - minX
    const bh = maxY - minY
    if (Math.min(bw, bh) < DET_MIN_SIZE) continue
    let sum = 0
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) sum += pred[y * rw + x]
    const score = sum / ((bw + 1) * (bh + 1))
    if (score < DET_BOX_THRESH) continue
    // The unclip: grow the shrunk text kernel back out by area x ratio / perimeter.
    const d = (bw * bh * DET_UNCLIP) / (2 * (bw + bh))
    if (Math.min(bw, bh) + 2 * d < DET_MIN_SIZE + 2) continue
    const sxs = w / rw
    const sys = h / rh
    const clampX = (v) => Math.max(0, Math.min(Math.round(v * sxs), w))
    const clampY = (v) => Math.max(0, Math.min(Math.round(v * sys), h))
    const box = { x0: clampX(minX - d), y0: clampY(minY - d), x1: clampX(maxX + d), y1: clampY(maxY + d) }
    if (box.x1 - box.x0 >= 1 && box.y1 - box.y0 >= 1) boxes.push(box)
  }
  // PaddleX's reading order: top to bottom, and left to right within 10 px of the same row.
  boxes.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)
  for (let i = 0; i < boxes.length - 1; i++) {
    for (let j = i; j >= 0; j--) {
      const a = boxes[j]
      const b = boxes[j + 1]
      if (Math.abs(b.y0 - a.y0) < 10 && b.x0 < a.x0) {
        boxes[j] = b
        boxes[j + 1] = a
      } else break
    }
  }
  return boxes
}

/**
 * Read one line image. Returns the characters with their CTC time steps, so words
 * can be given their own boxes afterwards.
 */
async function recognise(ort, session, chars, bgr, w, h) {
  const ratio = w / h
  let W = Math.trunc(REC_HEIGHT * Math.max(REC_MIN_WIDTH / REC_HEIGHT, ratio))
  let rw
  if (W > REC_MAX_WIDTH) {
    W = REC_MAX_WIDTH
    rw = REC_MAX_WIDTH
  } else rw = Math.min(W, Math.ceil(REC_HEIGHT * ratio))
  const resized = resizeRgb(bgr, w, h, rw, REC_HEIGHT)
  const plane = W * REC_HEIGHT
  // ⚑ Zero AFTER normalising is mid-grey, which is what PaddleX pads with.
  const t = new Float32Array(3 * plane)
  for (let y = 0; y < REC_HEIGHT; y++) {
    for (let x = 0; x < rw; x++) {
      for (let c = 0; c < 3; c++) t[c * plane + y * W + x] = (resized[(y * rw + x) * 3 + c] / 255 - 0.5) / 0.5
    }
  }
  const out = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', t, [1, 3, REC_HEIGHT, W]) })
  const o = out[session.outputNames[0]]
  const [, T, C] = o.dims
  const probs = o.data
  const picked = []
  let prev = -1
  for (let i = 0; i < T; i++) {
    let best = 0
    let bv = -Infinity
    for (let k = 0; k < C; k++) {
      const v = probs[i * C + k]
      if (v > bv) {
        bv = v
        best = k
      }
    }
    if (best !== prev && best !== 0) picked.push({ ch: chars[best] ?? '', p: bv, t: i })
    prev = best
  }
  // Time step i covers input columns i*W/T to (i+1)*W/T; map back to the line image.
  const toX = (step) => Math.max(0, Math.min(w, ((step * W) / T) * (w / rw)))
  return { picked, toX, stepHeights: W / T / REC_HEIGHT }
}

/**
 * ⚑ ONE-CHARACTER UNIT SIGNS ARE SPELLED OUT, AND NOTHING ELSE IS TOUCHED. The
 * recogniser answers `°C` as the single sign `℃` (U+2103): the same reading in a
 * code point nobody types, which would sit in a record looking right and failing
 * every text comparison. Only these four are mapped; a full NFKC fold would also
 * turn `m²` into `m2`, which changes what was read.
 */
const UNIT_SIGNS = { '℃': '°C', '℉': '°F', 'K': 'K', 'Å': 'Å' }
const spellUnits = (s) => s.replace(/[℃℉KÅ]/g, (c) => UNIT_SIGNS[c])

/**
 * Read RGBA pixels: `{ text, confidence (0..100), words: [{ text, confidence, bbox }] }`.
 *
 * ⚑⚑ WORDS FROM THE RECOGNISER'S OWN TIME STEPS. The detector returns LINES, and
 * on a real chart one line can be a whole axis ("2 3 4 5 ... 19"). `wordsToTicks`
 * files each WORD under its tick, so each space-separated run of characters gets
 * its own box from the columns its characters were read at.
 */
async function readPixels({ ort, det, rec, chars }, image) {
  const { width: w, height: h } = image
  const bgr = toBgr(image)
  const boxes = await detect(ort, det, bgr, w, h)
  const lines = []
  const words = []
  for (const b of boxes) {
    const bw = b.x1 - b.x0
    const bh = b.y1 - b.y0
    // ⚑⚑ NO QUARTER TURN FOR TALL BOXES, deliberately unlike PaddleX. PlotTracer
    // measures the angle itself (`findBandAngle` sweeps it by reading confidence),
    // and a reader that quietly turned sideways text upright would read it just as
    // confidently at the wrong angle, so the sweep could no longer tell. Measured
    // 2026-10-15: with the turn, the axis vote on bar-tensile-strength chose 90.
    const line = cropBgr(bgr, w, b.x0, b.y0, b.x1, b.y1)
    const { picked, toX, stepHeights } = await recognise(ort, rec, chars, line, bw, bh)
    if (!picked.length) continue
    for (const c of picked) c.ch = spellUnits(c.ch)
    lines.push({ text: picked.map((c) => c.ch).join(''), box: b })
    let run = []
    const flush = () => {
      if (!run.length) return
      const wt = run.map((c) => c.ch).join('')
      const conf = (100 * run.reduce((s, c) => s + c.p, 0)) / run.length
      const bbox = { x0: b.x0 + toX(run[0].t), y0: b.y0, x1: b.x0 + toX(run[run.length - 1].t + 1), y1: b.y1 }
      words.push({ text: wt, confidence: conf, bbox })
      run = []
    }
    for (const c of picked) {
      if (c.ch === ' ') flush()
      else {
        if (run.length && (c.t - run[run.length - 1].t) * stepHeights > WORD_GAP_HEIGHTS) flush()
        run.push(c)
      }
    }
    flush()
  }
  const confidence = words.length ? words.reduce((s, x) => s + x.confidence, 0) / words.length : 0
  return { text: lines.map((l) => l.text).join('\n'), confidence, words }
}

module.exports = { readPixels, detect, recognise, toBgr, cropBgr, resizeRgb }
