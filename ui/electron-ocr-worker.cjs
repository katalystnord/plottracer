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
// ⚑ ONE RF-DETR in the worker, for the axes, the legend and the bars (v2.7): a second copy of the 110 MB model would
// stay resident beside the first. ChartDete, when asked for, is its own.
let rfdetr = null
let chartdeteModels = null
const startRfdetr = () => rfdetr || (rfdetr = figdet.startDetector(require('onnxruntime-web')))

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
      const found = await figdet.detect(await startRfdetr(), image)
      parentPort.postMessage({ id, answer: { detections: (found.detections || []).filter((d) => d.cls === 'bar'), detector: 'rfdetr' } })
      return
    }
    if (kind === 'figdet') {
      const found = DETECTOR === 'chartdete'
        ? await chartdete.detect(await (chartdeteModels || (chartdeteModels = chartdete.startChartDete(require('onnxruntime-web')))), image)
        : await figdet.detect(await startRfdetr(), image)
      // the answer says which detector gave it, for the comparison switch and for the packaged-app test
      parentPort.postMessage({ id, answer: { ...found, detector: DETECTOR } })
      return
    }
    if (!engine) engine = startEngine()
    parentPort.postMessage({ id, answer: await readPixels(await engine, image, options) })
  } catch (e) {
    // ⚑ A failed START is forgotten, so the next read tries again cleanly.
    if (engine) engine.catch(() => (engine = null))
    if (models) models.catch(() => (models = null))
    if (rfdetr) rfdetr.catch(() => (rfdetr = null))
    if (chartdeteModels) chartdeteModels.catch(() => (chartdeteModels = null))
    parentPort.postMessage({ id, error: e && e.message ? e.message : String(e) })
  }
})
