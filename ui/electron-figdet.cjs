// The chart-element detector (v2.7, docs/v2.7-figure-type.md): RF-DETR Nano (Apache-2.0), fine-tuned
// on generated figures and CHART-Info's PMC training split (plottracer-ref research/v2.7-figdet), run in
// the OCR's worker thread (electron-ocr-worker.cjs) beside PaddleOCR, on the same onnxruntime-web.
//
// ⚑ PURE: pixels in, boxes out. What the boxes become (axes, tick marks, labels) is engine/, where it is
// unit-tested; the session is handed in.
//
// ⚑⚑ RF-DETR'S OWN predict(), TO THE LETTER (rfdetr/detr.py, rfdetr/models/postprocess.py), because the
// research measured the model through it: the image as RGB in 0..1, resized to the model's square input
// by torch's bilinear WITHOUT antialiasing (as it trains), normalised by ImageNet's mean and std; then a
// sigmoid over every query's class scores, the 300 best (query, class) pairs by a stable descending sort,
// and each box from normalised centre-width-height to pixel corners, clamped to the image. Checked against
// predict() itself in figdetParity.test.ts.
'use strict'

const fs = require('fs')
const path = require('path')

const MODEL = path.join(__dirname, 'figdet-model', 'detector.onnx')
const SIZE = 768
const MEAN = [0.485, 0.456, 0.406]
const STD = [0.229, 0.224, 0.225]
const NUM_SELECT = 300
/** The training set's classes, in its order (gen_det.py, chartinfo_to_coco.py). */
const CLASSES = ['plot_area', 'x_tick', 'y_tick', 'x_tick_label', 'y_tick_label', 'x_title', 'y_title', 'chart_title',
  'legend_area', 'legend_marker', 'legend_label', 'key_tick', 'key_tick_label']

/** RGBA pixels to the model's input: torch's bilinear (align_corners false, no antialias), normalised, NCHW. */
function toInput({ data, width, height }) {
  const out = new Float32Array(3 * SIZE * SIZE)
  const sx = width / SIZE, sy = height / SIZE
  for (let yy = 0; yy < SIZE; yy++) {
    let fy = (yy + 0.5) * sy - 0.5
    if (fy < 0) fy = 0
    const y0 = Math.min(Math.floor(fy), height - 1), y1 = Math.min(y0 + 1, height - 1), wy = fy - y0
    for (let xx = 0; xx < SIZE; xx++) {
      let fx = (xx + 0.5) * sx - 0.5
      if (fx < 0) fx = 0
      const x0 = Math.min(Math.floor(fx), width - 1), x1 = Math.min(x0 + 1, width - 1), wx = fx - x0
      for (let c = 0; c < 3; c++) {
        const a = data[(y0 * width + x0) * 4 + c] / 255, b = data[(y0 * width + x1) * 4 + c] / 255
        const d = data[(y1 * width + x0) * 4 + c] / 255, e = data[(y1 * width + x1) * 4 + c] / 255
        const top = a + (b - a) * wx, bottom = d + (e - d) * wx
        out[c * SIZE * SIZE + yy * SIZE + xx] = (top + (bottom - top) * wy - MEAN[c]) / STD[c]
      }
    }
  }
  return out
}

/** The model's two outputs to boxes: RF-DETR's PostProcess. Every class index the training set does not
 * name (the model carries one more) is left out. */
function postprocess(logits, boxes, nClasses, width, height) {
  const nQ = logits.length / nClasses
  const prob = new Float64Array(logits.length)
  for (let i = 0; i < logits.length; i++) prob[i] = 1 / (1 + Math.exp(-logits[i]))
  const order = Array.from(prob.keys()).sort((a, b) => prob[b] - prob[a] || a - b).slice(0, Math.min(NUM_SELECT, nQ * nClasses))
  const out = []
  for (const i of order) {
    const q = Math.floor(i / nClasses), cls = i % nClasses
    if (cls >= CLASSES.length) continue
    const [cx, cy, w, h] = [boxes[q * 4], boxes[q * 4 + 1], boxes[q * 4 + 2], boxes[q * 4 + 3]]
    const clamp = (v, hi) => Math.min(Math.max(v, 0), hi)
    out.push({
      cls: CLASSES[cls],
      box: { x0: clamp((cx - w / 2) * width, width), y0: clamp((cy - h / 2) * height, height), x1: clamp((cx + w / 2) * width, width), y1: clamp((cy + h / 2) * height, height) },
      score: prob[i],
    })
  }
  return out
}

async function startDetector(ort) {
  const session = await ort.InferenceSession.create(fs.readFileSync(MODEL), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' })
  return { ort, session }
}

/** The detector's boxes for one figure: `{ detections: [{ cls, box, score }] }`, best first. */
async function detect(models, img) {
  const { ort, session } = models
  const feeds = { [session.inputNames[0]]: new ort.Tensor('float32', toInput(img), [1, 3, SIZE, SIZE]) }
  const r = await session.run(feeds)
  const logits = r.labels ?? r[session.outputNames[1]]
  const boxes = r.dets ?? r[session.outputNames[0]]
  return { detections: postprocess(logits.data, boxes.data, logits.dims[2], img.width, img.height) }
}

module.exports = { toInput, postprocess, startDetector, detect, MODEL, CLASSES }
