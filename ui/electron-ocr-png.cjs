// PNG bytes to RGBA pixels, for the OCR reader in the main process (v2.7).
//
// ⚑ WHY THIS EXISTS. Tesseract decoded the image itself; ONNX Runtime takes a
// tensor and nothing else, so the bytes the renderer sends (`canvas.toDataURL`,
// always 8-bit, non-interlaced RGBA) need decoding here. Node's own `zlib` does
// the hard part, so no image library is added to the shipped tree.
//
// ⚑ Anything outside what a canvas produces (16-bit, interlaced, a bit depth
// under 8) is REFUSED with a sentence rather than half-decoded: a wrongly decoded
// image reads as confident nonsense, which is worse than no reading.
'use strict'

const zlib = require('zlib')

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

/** Channels per pixel for each PNG colour type at 8 bits. */
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }

function paeth(a, b, c) {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  return pb <= pc ? b : c
}

/**
 * Decode a PNG into `{ data: Uint8ClampedArray (RGBA), width, height }`.
 * Throws an Error whose message is a sentence, which `readText` turns into a refusal.
 */
function decodePng(bytes) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIGNATURE)) throw new Error('the region is not a PNG image')
  let pos = 8
  let width = 0
  let height = 0
  let depth = 0
  let type = -1
  let interlace = 0
  let palette = null
  let paletteAlpha = null
  const idat = []
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos)
    const kind = buf.toString('ascii', pos + 4, pos + 8)
    const body = buf.subarray(pos + 8, pos + 8 + len)
    if (body.length !== len) throw new Error('the PNG image is cut short')
    if (kind === 'IHDR') {
      width = body.readUInt32BE(0)
      height = body.readUInt32BE(4)
      depth = body[8]
      type = body[9]
      interlace = body[12]
    } else if (kind === 'PLTE') palette = body
    else if (kind === 'tRNS') paletteAlpha = body
    else if (kind === 'IDAT') idat.push(body)
    else if (kind === 'IEND') break
    pos += 12 + len
  }
  const channels = CHANNELS[type]
  if (!width || !height || channels === undefined) throw new Error('the PNG image has no readable header')
  if (depth !== 8 || interlace !== 0) throw new Error('the PNG image is in a format the reader does not take (8-bit, non-interlaced only)')
  if (type === 3 && !palette) throw new Error('the PNG image has no palette')
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const stride = width * channels
  if (raw.length < height * (stride + 1)) throw new Error('the PNG image is cut short')
  const px = Buffer.alloc(height * stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const src = y * (stride + 1) + 1
    const dst = y * stride
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? px[dst + i - channels] : 0
      const b = y > 0 ? px[dst - stride + i] : 0
      const c = y > 0 && i >= channels ? px[dst - stride + i - channels] : 0
      const x = raw[src + i]
      let v
      if (filter === 0) v = x
      else if (filter === 1) v = x + a
      else if (filter === 2) v = x + b
      else if (filter === 3) v = x + ((a + b) >> 1)
      else if (filter === 4) v = x + paeth(a, b, c)
      else throw new Error('the PNG image is damaged')
      px[dst + i] = v & 255
    }
  }
  const data = new Uint8ClampedArray(width * height * 4)
  for (let p = 0, q = 0; p < width * height; p++, q += channels) {
    const o = p * 4
    if (type === 6) {
      data[o] = px[q]; data[o + 1] = px[q + 1]; data[o + 2] = px[q + 2]; data[o + 3] = px[q + 3]
    } else if (type === 2) {
      data[o] = px[q]; data[o + 1] = px[q + 1]; data[o + 2] = px[q + 2]; data[o + 3] = 255
    } else if (type === 0) {
      data[o] = data[o + 1] = data[o + 2] = px[q]; data[o + 3] = 255
    } else if (type === 4) {
      data[o] = data[o + 1] = data[o + 2] = px[q]; data[o + 3] = px[q + 1]
    } else {
      const k = px[q]
      data[o] = palette[k * 3]; data[o + 1] = palette[k * 3 + 1]; data[o + 2] = palette[k * 3 + 2]
      data[o + 3] = paletteAlpha && k < paletteAlpha.length ? paletteAlpha[k] : 255
    }
  }
  return { data, width, height }
}

module.exports = { decodePng }
