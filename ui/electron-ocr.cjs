// Reading TEXT off a figure, in the main process (v2.4; PaddleOCR since v2.7).
//
// ⚑⚑ THIS FILE IS ONE FUNCTION WIDE ON PURPOSE: bytes in, text and confidence
// out. Everything about WHICH pixels get read - the box the user drew, the
// angle the axis is written at - is geometry, and geometry lives in
// engine/ocrRegion.ts where it can be tested without an OCR engine, an Electron
// process or a figure. The renderer crops, turns and encodes; this reads.
//
// ⚑⚑ WHY PADDLEOCR (v2.7, docs/v2.7-paddle-ocr.md). Measured on 12,751 tick
// labels from 887 published charts (CHART-Info 2022 PMC), PP-OCRv6 tiny read
// 89.6% exactly where the Tesseract it replaces read 79.8%, and it carries the
// characters a science label needs (å ä ö, Greek, µ, °, superscripts). The models
// are PP-OCRv6 tiny detection and recognition (Apache-2.0, PaddlePaddle),
// converted to ONNX by tools/ocr-model/build.sh and run by onnxruntime-web's wasm
// build (MIT), so one set of files serves every platform. The engine runs in its
// own thread, `electron-ocr-worker.cjs`, which says why.
//
// ⚑⚑ OFFLINE IS A PRODUCT CONSTRAINT, NOT A SETTING. The models are read from
// ui/ocr-model/ and the wasm runtime from its own package directory; nothing is
// fetched and nothing is written. engine/__tests__/ocrOffline.test.ts proves it
// with the network removed.
'use strict'

const path = require('path')
const { Worker } = require('worker_threads')

/**
 * ⚠️⚑⚑ A READER THAT NEVER ANSWERS MUST BECOME A REFUSAL. The Tesseract worker
 * once hung for ever on a missing module (v2.4); the bound stays because the next
 * dead engine should be a sentence on screen, not a control that never comes back.
 * With the engine in a thread, running out of time now really stops the read.
 */
const READ_TIMEOUT_MS = 30000

let worker = null
let nextId = 1
const pending = new Map()

function dropWorker(reason) {
  const w = worker
  worker = null
  for (const [, settle] of pending) settle({ error: reason })
  pending.clear()
  if (w) void w.terminate()
}

function getWorker() {
  if (worker) return worker
  const w = new Worker(path.join(__dirname, 'electron-ocr-worker.cjs'))
  w.on('message', ({ id, answer, error }) => {
    const settle = pending.get(id)
    if (!settle) return
    pending.delete(id)
    settle(error !== undefined ? { error: `Could not read the text: ${error}` } : answer)
  })
  // ⚑ A thread that dies takes its reads with it as refusals, never as silence.
  w.on('error', (e) => dropWorker(`Could not read the text: ${e && e.message ? e.message : String(e)}`))
  w.on('exit', () => {
    if (worker === w) dropWorker('Could not read the text: the reader stopped unexpectedly.')
  })
  w.unref()
  worker = w
  return w
}

/**
 * Read one already-cropped, already-turned region.
 *
 * Returns `{ text, confidence, words }` (confidence 0 to 100, each word with its
 * own box in the region's pixels), or `{ error }` with a sentence the panel can
 * show. `options.detectorBoxes` is for a crop the caller has already isolated
 * and margined (contour labels); see electron-ocr-paddle.cjs. ⚑ A REFUSAL IS A VALUE HERE, not a thrown stack: the one thing the user
 * must never see is a region that silently produced nothing, because an absent
 * proposal is indistinguishable from a label that genuinely read as blank.
 */
function readText(pngBase64, timeoutMs = READ_TIMEOUT_MS, options = {}) {
  return new Promise((resolve) => {
    const id = nextId++
    let timer = null
    pending.set(id, (answer) => {
      if (timer) clearTimeout(timer)
      resolve(answer)
    })
    timer = setTimeout(() => {
      if (!pending.has(id)) return
      // ⚑ The thread is ended, so a later attempt starts a fresh one.
      dropWorker(
        `The text reader did not answer within ${Math.round(timeoutMs / 1000)} seconds, so it was stopped. Try again, and if it keeps happening the OCR engine did not start.`
      )
    }, timeoutMs)
    try {
      getWorker().postMessage({ id, pngBase64: String(pngBase64), options: { detectorBoxes: Boolean(options && options.detectorBoxes) } })
    } catch (e) {
      dropWorker(`Could not read the text: ${e && e.message ? e.message : String(e)}`)
    }
  })
}

/**
 * The graph-type models' raw logits for one captured figure (Automatic graph extraction, v2.7):
 * `{ own, docling }`, or `{ error }` with a sentence. Same thread, same bound and the same rule as
 * `readText`: a refusal is a value, never a hang. engine/figureType.ts turns the logits into the
 * suggestion.
 */
function classifyFigure(pngBase64, timeoutMs = READ_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const id = nextId++
    let timer = null
    pending.set(id, (answer) => {
      if (timer) clearTimeout(timer)
      // the worker words its errors for the text reader; this request is about the graph type
      resolve(answer && answer.error ? { error: answer.error.replace(/^Could not read the text:/, 'Could not read the graph type:') } : answer)
    })
    timer = setTimeout(() => {
      if (!pending.has(id)) return
      dropWorker(
        `The graph type reader did not answer within ${Math.round(timeoutMs / 1000)} seconds, so it was stopped. Try again, or choose the graph type yourself.`
      )
    }, timeoutMs)
    try {
      getWorker().postMessage({ id, kind: 'figtype', pngBase64: String(pngBase64) })
    } catch (e) {
      dropWorker(`Could not read the graph type: ${e && e.message ? e.message : String(e)}`)
    }
  })
}

/**
 * The chart-element detector's boxes for one captured figure (Automatic graph extraction, v2.7):
 * `{ detections: [{ cls, box, score }] }`, or `{ error }` with a sentence. Same thread, same bound and
 * the same rule as `readText`: a refusal is a value, never a hang.
 */
function detectChartElements(pngBase64, timeoutMs = READ_TIMEOUT_MS) {
  // COMPARISON BUILD ONLY: ChartDete in its own Python, when asked for at launch (electron-chartdete.cjs)
  if (process.env.PLOTTRACER_DETECTOR === 'chartdete') return require('./electron-chartdete.cjs').detectWithChartDete(pngBase64)
  return new Promise((resolve) => {
    const id = nextId++
    let timer = null
    pending.set(id, (answer) => {
      if (timer) clearTimeout(timer)
      resolve(answer && answer.error ? { error: answer.error.replace(/^Could not read the text:/, 'Could not find the chart\'s axes:') } : answer)
    })
    timer = setTimeout(() => {
      if (!pending.has(id)) return
      dropWorker(
        `The axis reader did not answer within ${Math.round(timeoutMs / 1000)} seconds, so it was stopped. Try again, or calibrate by hand.`
      )
    }, timeoutMs)
    try {
      getWorker().postMessage({ id, kind: 'figdet', pngBase64: String(pngBase64) })
    } catch (e) {
      dropWorker(`Could not find the chart's axes: ${e && e.message ? e.message : String(e)}`)
    }
  })
}

/** Let the reader's thread go when the app is quitting. */
async function shutdownOcr() {
  const w = worker
  worker = null
  pending.clear()
  if (w) await w.terminate()
}

module.exports = { readText, classifyFigure, detectChartElements, shutdownOcr }
