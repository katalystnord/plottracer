// COMPARISON BUILD ONLY (David, 2026-10-19: "can you make a build for me with ChartDete instead, so that I can
// compare both, live?"). When PlotTracer is started with PLOTTRACER_DETECTOR=chartdete, the chart-element
// detector's requests go to ChartDete (MIT, Pengyu Yan) running in its own Python on this machine
// (plottracer-ref research/v2.7-figdet/chartdete_server.py) instead of the app's own RF-DETR. Everything after
// the boxes is the same pipeline. Not shippable: it needs that Python, mmdetection and PyTorch.
'use strict'

const { spawn } = require('child_process')
const os = require('os')
const path = require('path')

const HOME = os.homedir()
const PYTHON = process.env.PLOTTRACER_CHARTDETE_PYTHON || path.join(HOME, 'ml/figdet/chartdete-venv/bin/python')
const SERVER = process.env.PLOTTRACER_CHARTDETE_SERVER || path.join(HOME, 'store/code/katalystnord/plottracer-ref/research/v2.7-figdet/chartdete_server.py')
const WEIGHTS = process.env.PLOTTRACER_CHARTDETE_WEIGHTS || path.join(HOME, 'ml/vision/chartdete/weights')

let proc = null
let ready = null
let nextId = 1
const pending = new Map()

function start() {
  proc = spawn(PYTHON, ['-I', SERVER, path.join(WEIGHTS, 'cascade_rcnn_swin-t_fpn_LGF_VCE_PCE_coco_focalsmoothloss.py'), path.join(WEIGHTS, 'checkpoint.pth')], {
    cwd: path.join(HOME, 'ml/figdet/chartdete-code'),
    stdio: ['pipe', 'pipe', 'ignore'],
  })
  let buf = ''
  ready = new Promise((resolve, reject) => {
    proc.on('error', (e) => reject(e))
    proc.on('exit', (code) => {
      for (const [, r] of pending) r({ error: `ChartDete stopped (exit ${code}).` })
      pending.clear()
      proc = null
      reject(new Error(`ChartDete stopped (exit ${code}).`))
    })
    proc.stdout.on('data', (chunk) => {
      buf += chunk.toString()
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i)
        buf = buf.slice(i + 1)
        let msg
        try { msg = JSON.parse(line) } catch { continue }
        if (msg.ready) { resolve(); continue }
        const r = pending.get(msg.id)
        if (r) { pending.delete(msg.id); r(msg) }
      }
    })
  })
}

/** The same answer shape as the worker's detector: { detections } or { error }. Bounded, as every reader. */
async function detectWithChartDete(pngBase64, timeoutMs = 120000) {
  try {
    if (!proc) start()
    await ready
  } catch (e) {
    ready = null
    return { error: `Could not start ChartDete: ${e && e.message ? e.message : String(e)}` }
  }
  return new Promise((resolve) => {
    const id = nextId++
    const timer = setTimeout(() => { pending.delete(id); resolve({ error: 'ChartDete did not answer in time.' }) }, timeoutMs)
    pending.set(id, (msg) => { clearTimeout(timer); resolve(msg.error ? { error: msg.error } : { detections: msg.detections }) })
    proc.stdin.write(JSON.stringify({ id, png: String(pngBase64) }) + '\n')
  })
}

function stopChartDete() { if (proc) proc.kill() }

module.exports = { detectWithChartDete, stopChartDete }
