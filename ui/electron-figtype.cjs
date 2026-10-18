// The graph-type suggestion's models (v2.7, docs/v2.7-figure-type.md), run in the OCR's worker
// thread (electron-ocr-worker.cjs) beside PaddleOCR, on the same onnxruntime-web.
//
// ⚑ PURE: pixels in, the two models' raw logits out. The fusion into one suggestion is
// engine/figureType.ts, where it is unit-tested; the sessions are handed in.
'use strict'

const fs = require('fs')
const path = require('path')

const MODEL_DIR = path.join(__dirname, 'figtype-model')
const SIZE = 224
const MEAN = [0.485, 0.456, 0.406]
const STD = [0.47853944, 0.4732864, 0.47434163] // Docling's own, kept for the fine-tune too

/**
 * ⚑⚑ PIL'S BILINEAR RESIZE, TO THE UNIT. Both models were trained and measured on images shrunk
 * by Pillow's `resize(..., BILINEAR)`, which on a reduction widens its filter to cover every source
 * pixel an output pixel spans (an average, not a 4-pixel sample), works in 22-bit fixed point,
 * does the horizontal pass first and clips to 0..255 after each pass. A plain bilinear sample of
 * the same figure is a different picture to the model; this is the Pillow arithmetic itself
 * (libImaging/Resample.c), checked pixel for pixel against Pillow in figtypeResize.test.ts.
 */
const PRECISION_BITS = 32 - 8 - 2

function coefficients(inSize, outSize) {
  const scale = inSize / outSize
  const filterscale = Math.max(scale, 1)
  const support = 1.0 * filterscale
  const ksize = Math.ceil(support) * 2 + 1
  const bounds = new Int32Array(outSize * 2)
  const kk = new Int32Array(outSize * ksize)
  const pre = new Float64Array(ksize)
  for (let xx = 0; xx < outSize; xx++) {
    const center = (xx + 0.5) * scale
    const ss = 1.0 / filterscale
    let xmin = Math.trunc(center - support + 0.5)
    if (xmin < 0) xmin = 0
    let xmax = Math.trunc(center + support + 0.5)
    if (xmax > inSize) xmax = inSize
    xmax -= xmin
    let ww = 0
    for (let x = 0; x < xmax; x++) {
      const t = Math.abs((x + xmin - center + 0.5) * ss)
      const w = t < 1 ? 1 - t : 0
      pre[x] = w
      ww += w
    }
    for (let x = 0; x < ksize; x++) {
      const w = x < xmax && ww !== 0 ? pre[x] / ww : 0
      kk[xx * ksize + x] = w < 0 ? Math.trunc(-0.5 + w * (1 << PRECISION_BITS)) : Math.trunc(0.5 + w * (1 << PRECISION_BITS))
    }
    bounds[xx * 2] = xmin
    bounds[xx * 2 + 1] = xmax
  }
  return { ksize, bounds, kk }
}

const clip8 = (v) => {
  const x = v >> PRECISION_BITS
  return x < 0 ? 0 : x > 255 ? 255 : x
}

/** RGB bytes (w*h*3) to RGB bytes (W*H*3), as Pillow's Image.resize((W, H), BILINEAR). */
function resizeLikePil(rgb, w, h, W, H) {
  let src = rgb
  let sw = w
  if (W !== w) {
    const { ksize, bounds, kk } = coefficients(w, W)
    const out = new Uint8Array(W * h * 3)
    for (let y = 0; y < h; y++) {
      for (let xx = 0; xx < W; xx++) {
        const xmin = bounds[xx * 2], xmax = bounds[xx * 2 + 1]
        for (let c = 0; c < 3; c++) {
          let ss = 1 << (PRECISION_BITS - 1)
          for (let x = 0; x < xmax; x++) ss += src[(y * sw + x + xmin) * 3 + c] * kk[xx * ksize + x]
          out[(y * W + xx) * 3 + c] = clip8(ss)
        }
      }
    }
    src = out
    sw = W
  }
  if (H !== h) {
    const { ksize, bounds, kk } = coefficients(h, H)
    const out = new Uint8Array(sw * H * 3)
    for (let yy = 0; yy < H; yy++) {
      const ymin = bounds[yy * 2], ymax = bounds[yy * 2 + 1]
      for (let x = 0; x < sw; x++) {
        for (let c = 0; c < 3; c++) {
          let ss = 1 << (PRECISION_BITS - 1)
          for (let y = 0; y < ymax; y++) ss += src[((y + ymin) * sw + x) * 3 + c] * kk[yy * ksize + y]
          out[(yy * sw + x) * 3 + c] = clip8(ss)
        }
      }
    }
    src = out
  }
  return src
}

/** RGBA pixels to the models' input: alpha dropped (as PIL's convert('RGB')), 224 x 224, normalised, NCHW. */
function toInput({ data, width, height }) {
  const rgb = new Uint8Array(width * height * 3)
  for (let p = 0; p < width * height; p++) for (let c = 0; c < 3; c++) rgb[p * 3 + c] = data[p * 4 + c]
  const small = resizeLikePil(rgb, width, height, SIZE, SIZE)
  const out = new Float32Array(3 * SIZE * SIZE)
  for (let c = 0; c < 3; c++) {
    for (let p = 0; p < SIZE * SIZE; p++) out[c * SIZE * SIZE + p] = (small[p * 3 + c] / 255 - MEAN[c]) / STD[c]
  }
  return out
}

async function startModels(ort) {
  const options = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' }
  const [own, docling] = await Promise.all([
    ort.InferenceSession.create(fs.readFileSync(path.join(MODEL_DIR, 'own.onnx')), options),
    ort.InferenceSession.create(fs.readFileSync(path.join(MODEL_DIR, 'docling.onnx')), options),
  ])
  return { ort, own, docling }
}

/** The two models' raw logits for one figure. */
async function classify({ ort, own, docling }, image) {
  const x = new ort.Tensor('float32', toInput(image), [1, 3, SIZE, SIZE])
  const run = async (s) => Array.from((await s.run({ [s.inputNames[0]]: x }))[s.outputNames[0]].data)
  return { own: await run(own), docling: await run(docling) }
}

module.exports = { resizeLikePil, toInput, startModels, classify, MODEL_DIR }
