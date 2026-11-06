/**
 * The detector's classes are named by the model's own count (ui/electron-figdet.cjs `postprocess`; the code review of
 * 2026-11-06): a model carries one output more than it was trained with, so a model from before the `bar` class must
 * not have that extra output read as a bar.
 */
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const figdet = require(path.join(import.meta.dirname, '..', 'electron-figdet.cjs')) as {
  postprocess: (logits: Float32Array, boxes: Float32Array, nClasses: number, w: number, h: number) => { cls: string; score: number }[];
};

/** One query, sure of class `cls`, in a model with `n` outputs. */
function sureOf(cls: number, n: number) {
  const logits = new Float32Array(n).fill(-10);
  logits[cls] = 5;
  return figdet.postprocess(logits, new Float32Array([0.5, 0.5, 0.2, 0.2]), n, 100, 100).filter((d) => d.score > 0.5).map((d) => d.cls);
}

describe('the detector names its classes by the model it runs', () => {
  it('given the model trained with bars (14 classes, 15 outputs), its 14th class is a bar', () => {
    expect(sureOf(13, 15)).toEqual(['bar']);
  });

  it('given a model from before the bar class (13 classes, 14 outputs), its extra output is not read as a bar', () => {
    expect(sureOf(13, 14)).toEqual([]);
    expect(sureOf(2, 14)).toEqual(['y_tick']);
  });
});
