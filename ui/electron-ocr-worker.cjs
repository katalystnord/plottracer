// The OCR engine's own thread (v2.7). `ui/electron-ocr.cjs` starts it and talks to it.
//
// ⚑⚑ WHY A THREAD. onnxruntime-web's wasm build computes on the thread that calls
// it, so in the main process every read would stall the app's own event loop,
// and an angle sweep is about seventeen reads. Measured 2026-10-15: run in the
// main thread, a 1 ms timeout could not even fire until the read had finished.
// Here the main process stays free, and a read that never ends can be stopped by
// ending the thread.
'use strict'

const fs = require('fs')
const path = require('path')
const { parentPort } = require('worker_threads')
const { decodePng } = require('./electron-ocr-png.cjs')
const { readPixels } = require('./electron-ocr-paddle.cjs')
const figtype = require('./electron-figtype.cjs')
const figdet = require('./electron-figdet.cjs')
const chartdete = require('./electron-chartdete-onnx.cjs')
// ⚑ RF-DETR for everything since 2026-11-06 (docs/v2.7-workflow-walk.md, "Bars seen whole by the detector"): measured at
// the input size the app runs it at (768 px), it reads 92.7% of 1,608 real axes right and 2.4% wrong against ChartDete's
// 75.9% and 2.2%. ChartDete had been preferred on a measurement taken at 384 px. PLOTTRACER_DETECTOR=chartdete asks
// for ChartDete where its pack is installed, to compare.
const DETECTOR = process.env.PLOTTRACER_DETECTOR === 'chartdete' && fs.existsSync(chartdete.MODEL_DIR) ? 'chartdete' : 'rfdetr'

const MODEL_DIR = path.join(__dirname, 'ocr-model')

async function startEngine() {
  const ort = require('onnxruntime-web')
  const options = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' }
  const [det, rec] = await Promise.all([
    ort.InferenceSession.create(fs.readFileSync(path.join(MODEL_DIR, 'det.onnx')), options),
    ort.InferenceSession.create(fs.readFileSync(path.join(MODEL_DIR, 'rec.onnx')), options),
  ])
  // Code points, not glyphs (tools/ocr-model/build.sh says why); 0 is the CTC blank.
  const chars = JSON.parse(fs.readFileSync(path.join(MODEL_DIR, 'rec-chars.json'), 'utf8')).map((cp) => (cp ? String.fromCodePoint(cp) : ''))
  return { ort, det, rec, chars }
}

let engine = null
// ⚑ The graph-type models (v2.7, electron-figtype.cjs) share this thread and its onnxruntime-web:
// one runtime in the app, started only when the graph type is first suggested.
let models = null
let detector = null
// RF-DETR for bars (v2.7, its `bar` class): ChartDete reads the axes and legend where it is installed, and has no bars
let barDetector = null

parentPort.on('message', async ({ id, kind, pngBase64, options }) => {
  try {
    const image = decodePng(Buffer.from(String(pngBase64), 'base64'))
    if (kind === 'figtype') {
      if (!models) models = figtype.startModels(require('onnxruntime-web'))
      parentPort.postMessage({ id, answer: await figtype.classify(await models, image) })
      return
    }
    // the chart-element detector (v2.7), loaded on first use, like the classifiers: RF-DETR (electron-figdet.cjs), or
    // ChartDete when PLOTTRACER_DETECTOR=chartdete asks for it (electron-chartdete-onnx.cjs), to compare
    if (kind === 'figdet' && options && options.bars) {
      if (!barDetector) barDetector = DETECTOR === 'rfdetr' && detector ? detector : figdet.startDetector(require('onnxruntime-web'))
      const found = await figdet.detect(await barDetector, image)
      parentPort.postMessage({ id, answer: { detections: (found.detections || []).filter((d) => d.cls === 'bar'), detector: 'rfdetr' } })
      return
    }
    if (kind === 'figdet') {
      const det = DETECTOR === 'chartdete' ? chartdete : figdet
      if (!detector) detector = DETECTOR === 'chartdete' ? chartdete.startChartDete(require('onnxruntime-web')) : figdet.startDetector(require('onnxruntime-web'))
      // the answer says which detector gave it, for the comparison switch and for the packaged-app test
      parentPort.postMessage({ id, answer: { ...(await det.detect(await detector, image)), detector: DETECTOR } })
      return
    }
    if (!engine) engine = startEngine()
    parentPort.postMessage({ id, answer: await readPixels(await engine, image, options) })
  } catch (e) {
    // ⚑ A failed START is forgotten, so the next read tries again cleanly.
    if (engine) engine.catch(() => (engine = null))
    if (models) models.catch(() => (models = null))
    if (detector) detector.catch(() => (detector = null))
    parentPort.postMessage({ id, error: e && e.message ? e.message : String(e) })
  }
})
