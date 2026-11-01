// ChartDete in the app's own runtime (v2.7, ui/electron-chartdete-onnx.cjs): its ONNX pieces on onnxruntime-web
// must find what ChartDete's ORIGINAL code finds. The reference (fixtures/chartdete-reference.json) is mmdetection's
// inference_detector on the bundled samples, made by plottracer-ref research/v2.7-figdet; on the test figures the
// same port scored as the original (FINDINGS.md). Skipped where the model pack is absent: it is a download, not
// in git (docs/v2.7-figure-type.md).
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ui = path.join(import.meta.dirname, '..');
const chartdete = require(path.join(ui, 'electron-chartdete-onnx.cjs'));
const { decodePng } = require(path.join(ui, 'electron-ocr-png.cjs'));
const reference = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'fixtures/chartdete-reference.json'), 'utf8'));

type Box = [number, number, number, number];
const iou = (a: Box, b: Box) => {
  const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])), iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const u = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - ix * iy;
  return u > 0 ? (ix * iy) / u : 0;
};

async function run(dir: string | undefined, name: string) {
  const models = await chartdete.startChartDete(require('onnxruntime-web'), dir);
  const img = decodePng(fs.readFileSync(path.join(ui, '..', 'samples', name)));
  const got: { cls: string; box: { x0: number; y0: number; x1: number; y1: number }; score: number }[] = (await chartdete.detect(models, img)).detections;
  return got.map((d) => ({ cls: d.cls, box: [d.box.x0, d.box.y0, d.box.x1, d.box.y1] as Box, score: d.score }));
}
const images = Object.entries(reference.images) as [string, { cls: string; box: Box; score: number }[]][];

// ⚑ The glue: with the FULL-PRECISION pieces it must be ChartDete itself, box for box and score for score.
// The pieces live in the research cache (plottracer-ref research/v2.7-figdet chartdete_pieces.py), so this runs
// where they were made.
const FP32 = process.env.CHARTDETE_FP32_DIR ?? path.join(process.env.HOME ?? '', '.cache/figdet/chartdete-pieces');
describe.skipIf(!fs.existsSync(path.join(FP32, 'encoderfast0.onnx')))('the app\'s ChartDete glue is ChartDete itself', () => {
  for (const [name, want] of images) {
    it(`on ${name}, full precision: every box the original scores 0.5 or more, same class, same place, same score`, async () => {
      const got = await run(FP32, name);
      const off = want.filter((w) => !got.some((g) => g.cls === w.cls && iou(g.box, w.box) >= 0.95 && Math.abs(g.score - w.score) <= 0.01));
      expect(off).toEqual([]);
    }, 120_000);
  }
});

// ⚑ The shipped 8-bit pack: rounding moves a borderline score (one tick on xy-stress-strain, 0.70 -> 0.19), so
// this asks only that each of the original's boxes is FOUND; its accuracy at the app's 0.5 cut is measured on
// CHART-Info's test figures (FINDINGS.md: legend pairs 94 / 95 / 91% against the original's 94 / 94 / 92%).
describe.skipIf(!fs.existsSync(chartdete.MODEL_DIR))('the shipped 8-bit ChartDete finds what the original finds', () => {
  for (const [name, want] of images) {
    it(`on ${name}: every box the original scores 0.5 or more is found, same class, IoU 0.8`, async () => {
      const got = await run(undefined, name);
      const missing = want.filter((w) => !got.some((g) => g.cls === w.cls && iou(g.box, w.box) >= 0.8));
      expect(missing).toEqual([]);
    }, 120_000);
  }
});
