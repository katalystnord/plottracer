// ChartDete (CACHED, MIT, Copyright 2023 Pengyu Yan) as the chart-element detector (v2.7), in the app's own
// onnxruntime-web, in the OCR worker beside PaddleOCR (electron-ocr-worker.cjs). David, 2026-10-19: "give that a
// real try". Measured on CHART-Info's PMC test figures through the app's own pipeline: axes 95.8% within 2%,
// legend marker + label pairs 94% (plottracer-ref research/v2.7-figdet FINDINGS.md).
//
// ⚑ PURE: pixels in, boxes out, in the app's class names; what they become is engine/ (pictureAxes).
//
// ⚑⚑ IN PIECES, BECAUSE THE WHOLE MODEL DOES NOT EXPORT (chartdete_pieces.py): the backbone and pyramid, the
// proposal head, region pooling (ONNX's own RoiAlign), and per cascade stage the context fuser's convolutions,
// the box encoder and the head, all 8-bit. The glue between them is mmdetection 2.28's own, written out here:
//   image      imrescale to (1333, 800) keeping the ratio, OpenCV's 8-bit bilinear (the model's TEST pipeline
//              loads without to_float32, so its fixed-point weights and rounding are copied), RGB normalised by
//              ImageNet's mean and std (the TEST pipeline's, not the 216.45... values elsewhere in the config),
//              padded to a multiple of 32
//   proposals  3 anchors a position (base 8 x stride, ratios 0.5 1 2), sigmoid objectness, the 1000 best of each
//              level, deltas decoded and clipped, empty boxes dropped, suppression at IoU 0.7 within each level,
//              the 1000 best kept
//   stages     each region to its pyramid level by size, pooled 7x7; the five maps averaged to 7x7 for the
//              context fuser; the box encoder; the head; regions refined between stages (class-agnostic, each
//              stage's stds)
//   result     the stages' raw scores averaged, softmax over 18 classes and background, the last deltas
//              applied, scaled to the figure, suppression at IoU 0.7 within each class, the 200 best
// ⚑ The box encoder is the attention-free form (chartdete_encoder_fast.py): ChartDete's mask is True on its
// REAL boxes, so its attention only ever sees identical padding and returns one constant a layer; exactly the
// same (1.7e-6), any number of boxes.
'use strict'

const fs = require('fs')
const path = require('path')

const MODEL_DIR = path.join(__dirname, 'figdet-model', 'chartdete')
const PIECES = ['backbone', 'rpn', 'roialign0', 'roialign1', 'roialign2', 'roialign3', 'global0', 'global1', 'global2',
  'encoderfast0', 'encoderfast1', 'encoderfast2', 'head0', 'head1', 'head2']
const CLASSES = ['x_title', 'y_title', 'plot_area', 'other', 'xlabel', 'ylabel', 'chart_title', 'x_tick', 'y_tick', 'legend_patch',
  'legend_label', 'legend_title', 'legend_area', 'mark_label', 'value_label', 'y_axis_area', 'x_axis_area', 'tick_grouping']
/** ChartDete's classes in the app's names (the ones the app uses; the rest are left out). */
const AS_OURS = { xlabel: 'x_tick_label', ylabel: 'y_tick_label', legend_patch: 'legend_marker', plot_area: 'plot_area', x_tick: 'x_tick',
  y_tick: 'y_tick', x_title: 'x_title', y_title: 'y_title', chart_title: 'chart_title', legend_area: 'legend_area', legend_label: 'legend_label' }
const MEAN = [123.675, 116.28, 103.53]
const STD = [58.395, 57.12, 57.375]
const STAGE_STDS = [[0.1, 0.1, 0.2, 0.2], [0.05, 0.05, 0.1, 0.1], [0.033, 0.033, 0.067, 0.067]]
const MAX_RATIO = Math.abs(Math.log(16 / 1000))
const COEF = 2048
const KEEP = 0.05

/** The pieces, loaded once; `dir` only for the tests' full-precision check. */
async function startChartDete(ort, dir = MODEL_DIR) {
  const opts = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' }
  const S = {}
  for (const p of PIECES) S[p] = await ort.InferenceSession.create(fs.readFileSync(path.join(dir, `${p}.onnx`)), opts)
  return { ort, S }
}

const rne = (v) => { const r = Math.round(v); return Math.abs(v % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r }
function weights(dstN, srcN) {
  const scale = srcN / dstN, ofs = new Int32Array(dstN), a0 = new Int32Array(dstN), a1 = new Int32Array(dstN)
  for (let d = 0; d < dstN; d++) {
    let f = Math.fround((d + 0.5) * scale - 0.5), s = Math.floor(f)
    f = Math.fround(f - s)
    if (s < 0) { f = 0; s = 0 }
    if (s >= srcN - 1) { f = 0; s = srcN - 1 }
    ofs[d] = s; a0[d] = rne(Math.fround(1 - f) * COEF); a1[d] = rne(f * COEF)
  }
  return { ofs, a0, a1 }
}

/** imrescale + OpenCV INTER_LINEAR on 8-bit pixels + Normalize(to_rgb) + Pad(32). */
function prepare(ort, { data, width: w, height: h }) {
  const sf = Math.min(1333 / Math.max(h, w), 800 / Math.min(h, w))
  const nw = Math.floor(w * sf + 0.5), nh = Math.floor(h * sf + 0.5)
  const pw = Math.ceil(nw / 32) * 32, ph = Math.ceil(nh / 32) * 32
  const out = new Float32Array(3 * ph * pw)
  const X = weights(nw, w), Y = weights(nh, h)
  const rows = new Map()
  const hrow = (sy) => {
    let r = rows.get(sy)
    if (r) return r
    r = new Int32Array(nw * 3)
    for (let x = 0; x < nw; x++) {
      const s0 = X.ofs[x], s1 = Math.min(s0 + 1, w - 1)
      for (let c = 0; c < 3; c++) r[x * 3 + c] = data[(sy * w + s0) * 4 + c] * X.a0[x] + data[(sy * w + s1) * 4 + c] * X.a1[x]
    }
    rows.set(sy, r)
    return r
  }
  for (let y = 0; y < nh; y++) {
    const r0 = hrow(Y.ofs[y]), r1 = hrow(Math.min(Y.ofs[y] + 1, h - 1)), b0 = Y.a0[y], b1 = Y.a1[y]
    for (let x = 0; x < nw; x++) for (let c = 0; c < 3; c++) {
      const v = Math.min(255, Math.max(0, Math.floor((r0[x * 3 + c] * b0 + r1[x * 3 + c] * b1 + (1 << 21)) / (1 << 22))))
      out[c * ph * pw + y * pw + x] = (v - MEAN[c]) / STD[c]
    }
    if (y > 2) rows.delete(Y.ofs[y - 2])
  }
  return { tensor: new ort.Tensor('float32', out, [1, 3, ph, pw]), imgW: nw, imgH: nh, scaleX: nw / w, scaleY: nh / h }
}

/** delta2bbox: deltas times stds, dw dh clamped, clipped to the image. */
function decode(box, d, stds, W, H) {
  const px = (box[0] + box[2]) * 0.5, py = (box[1] + box[3]) * 0.5, pw = box[2] - box[0], ph = box[3] - box[1]
  const dw = Math.max(-MAX_RATIO, Math.min(MAX_RATIO, d[2] * stds[2])), dh = Math.max(-MAX_RATIO, Math.min(MAX_RATIO, d[3] * stds[3]))
  const gx = px + pw * d[0] * stds[0], gy = py + ph * d[1] * stds[1], gw = pw * Math.exp(dw), gh = ph * Math.exp(dh)
  const c = (v, hi) => Math.max(0, Math.min(hi, v))
  return [c(gx - gw * 0.5, W), c(gy - gh * 0.5, H), c(gx + gw * 0.5, W), c(gy + gh * 0.5, H)]
}

/** mmcv's nms, highest score first, a box overlapping a kept one above thr dropped; within each group only. */
function nms(items, thr) {
  const order = items.slice().sort((a, b) => b.score - a.score)
  const keep = [], dead = new Uint8Array(order.length)
  for (let i = 0; i < order.length; i++) {
    if (dead[i]) continue
    const a = order[i].box
    keep.push(order[i])
    const aa = (a[2] - a[0]) * (a[3] - a[1])
    for (let j = i + 1; j < order.length; j++) {
      if (dead[j]) continue
      const b = order[j].box
      const iw = Math.min(a[2], b[2]) - Math.max(a[0], b[0]), ih = Math.min(a[3], b[3]) - Math.max(a[1], b[1])
      if (iw <= 0 || ih <= 0) continue
      const inter = iw * ih
      if (inter / (aa + (b[2] - b[0]) * (b[3] - b[1]) - inter) > thr) dead[j] = 1
    }
  }
  return keep
}
function batchedNms(items, thr) {
  const groups = new Map()
  for (const it of items) { if (!groups.has(it.group)) groups.set(it.group, []); groups.get(it.group).push(it) }
  return [...groups.values()].flatMap((g) => nms(g, thr)).sort((a, b) => b.score - a.score)
}

function proposals(out, W, H) {
  const all = []
  for (let L = 0; L < 5; L++) {
    const cls = out[`cls${L}`], reg = out[`reg${L}`]
    const [, A, h, w] = cls.dims, stride = 4 << L
    const base = [0.5, 1, 2].map((r) => { const hr = Math.sqrt(r), ws = (stride * 8) / hr, hs = stride * 8 * hr; return [-ws / 2, -hs / 2, ws / 2, hs / 2] })
    const cand = []
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let a = 0; a < A; a++) {
      cand.push({ s: 1 / (1 + Math.exp(-cls.data[(a * h + y) * w + x])), y, x, a })
    }
    cand.sort((p, q) => q.s - p.s)
    for (const c of cand.slice(0, 1000)) {
      const b = base[c.a], sx = c.x * stride, sy = c.y * stride
      const d = [0, 1, 2, 3].map((k) => reg.data[((c.a * 4 + k) * h + c.y) * w + c.x])
      const box = decode([b[0] + sx, b[1] + sy, b[2] + sx, b[3] + sy], d, [1, 1, 1, 1], W, H)
      if (box[2] - box[0] > 0 && box[3] - box[1] > 0) all.push({ box, score: c.s, group: L })
    }
  }
  return batchedNms(all, 0.7).slice(0, 1000).map((p) => p.box)
}

/** AdaptiveAvgPool2d(7) of each of the five maps, concatenated: [1, 1280, 7, 7]. */
function pooled(ort, feats) {
  const out = new Float32Array(1280 * 49)
  feats.forEach((f, L) => {
    const [, C, h, w] = f.dims
    for (let c = 0; c < C; c++) for (let i = 0; i < 7; i++) for (let j = 0; j < 7; j++) {
      const y0 = Math.floor((i * h) / 7), y1 = Math.ceil(((i + 1) * h) / 7), x0 = Math.floor((j * w) / 7), x1 = Math.ceil(((j + 1) * w) / 7)
      let s = 0
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) s += f.data[(c * h + y) * w + x]
      out[(L * 256 + c) * 49 + i * 7 + j] = s / ((y1 - y0) * (x1 - x0))
    }
  })
  return new ort.Tensor('float32', out, [1, 1280, 7, 7])
}

/** The detector's boxes for one figure: `{ detections: [{ cls, box: {x0, y0, x1, y1}, score }] }`, best first. */
async function detect({ ort, S }, img) {
  const T = (data, dims) => new ort.Tensor('float32', data, dims)
  const p = prepare(ort, img)
  const fo = await S.backbone.run({ image: p.tensor })
  const feats = [0, 1, 2, 3, 4].map((i) => fo[`p${i}`])
  const ro = await S.rpn.run(Object.fromEntries(feats.map((f, i) => [`p${i}`, f])))
  let rois = proposals(ro, p.imgW, p.imgH)
  const n = rois.length
  if (!n) return { detections: [] }
  const pool = pooled(ort, feats)
  const scoreSum = new Float32Array(n * 19)
  let deltas = null
  for (let st = 0; st < 3; st++) {
    const roiFeats = new Float32Array(n * 256 * 49)
    for (let L = 0; L < 4; L++) {
      const idx = []
      rois.forEach((b, i) => { const lv = Math.min(3, Math.max(0, Math.floor(Math.log2(Math.sqrt((b[2] - b[0]) * (b[3] - b[1])) / 56 + 1e-6)))); if (lv === L) idx.push(i) })
      if (!idx.length) continue
      const r = new Float32Array(idx.length * 4)
      idx.forEach((i, k) => r.set(rois[i], k * 4))
      const y = (await S[`roialign${L}`].run({ x: feats[L], rois: T(r, [idx.length, 4]), batch: new ort.Tensor('int64', new BigInt64Array(idx.length), [idx.length]) })).y.data
      idx.forEach((i, k) => roiFeats.set(y.subarray(k * 256 * 49, (k + 1) * 256 * 49), i * 256 * 49))
    }
    const glob = (await S[`global${st}`].run({ pooled: pool })).glob
    const boxes = new Float32Array(n * 4)
    rois.forEach((b, i) => boxes.set([b[0] / p.imgW, b[1] / p.imgH, b[2] / p.imgW, b[3] / p.imgH], i * 4))
    const enc = (await S[`encoderfast${st}`].run({ boxes: T(boxes, [n, 4]) })).encoding.data
    const ho = await S[`head${st}`].run({ roi_feats: T(roiFeats, [n, 256, 7, 7]), glob, enc: T(enc, [n, 512]) })
    const sc = ho.scores.data
    for (let k = 0; k < n * 19; k++) scoreSum[k] += sc[k]
    deltas = ho.deltas.data
    if (st < 2) rois = rois.map((b, i) => decode(b, deltas.subarray(i * 4, i * 4 + 4), STAGE_STDS[st], p.imgW, p.imgH))
  }
  const cands = []
  rois.forEach((b, i) => {
    const box = decode(b, deltas.subarray(i * 4, i * 4 + 4), STAGE_STDS[2], p.imgW, p.imgH)
    const fig = [box[0] / p.scaleX, box[1] / p.scaleY, box[2] / p.scaleX, box[3] / p.scaleY]
    const z = Array.from(scoreSum.subarray(i * 19, i * 19 + 19), (v) => v / 3), mx = Math.max(...z)
    const e = z.map((v) => Math.exp(v - mx)), sum = e.reduce((a, v) => a + v, 0)
    for (let c = 0; c < 18; c++) { const s = e[c] / sum; if (s > 0) cands.push({ box: fig, score: s, group: c }) }
  })
  const detections = batchedNms(cands, 0.7).slice(0, 200)
    .filter((d) => d.score >= KEEP && AS_OURS[CLASSES[d.group]])
    .map((d) => ({ cls: AS_OURS[CLASSES[d.group]], box: { x0: d.box[0], y0: d.box[1], x1: d.box[2], y1: d.box[3] }, score: d.score }))
  return { detections }
}

module.exports = { startChartDete, detect, MODEL_DIR, PIECES }
