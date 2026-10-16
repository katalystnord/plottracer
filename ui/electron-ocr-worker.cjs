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

parentPort.on('message', async ({ id, pngBase64, options }) => {
  try {
    const image = decodePng(Buffer.from(String(pngBase64), 'base64'))
    if (!engine) engine = startEngine()
    parentPort.postMessage({ id, answer: await readPixels(await engine, image, options) })
  } catch (e) {
    // ⚑ A failed START is forgotten, so the next read tries again cleanly.
    if (engine) engine.catch(() => (engine = null))
    parentPort.postMessage({ id, error: e && e.message ? e.message : String(e) })
  }
})
