/**
 * ⚑⚑ EVERY GESTURE THAT REPLACES THE GRID GOES THROUGH ONE PATH.
 *
 * Three gestures change a heatmap's boundaries: dragging or adding or removing
 * one, pressing Detect grid, and laying an even lattice. All three renumber
 * cells, so all three have to reindex the readings a person took and re-read the
 * table - which is what `applyHeatmapGridEdit` does.
 *
 * ⚠️ THE EVEN GRID CALLED THE RAW `applyHeatmapGrid` INSTEAD, so it replaced
 * every boundary at once while the table kept the cells read off the OLD grid
 * and a person's readings stayed keyed to indices that no longer meant what they
 * had. Detection had already been moved onto the edit path for exactly this
 * reason; the even grid was left behind.
 *
 * ⚑ Asserted on the SOURCE, like `oneFigureResetList`, and for the same reason:
 * what fails here is a FOURTH caller of the raw function being written, which no
 * runtime assertion sees. Importing Workspace would only prove the component
 * agrees with itself.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const workspace = readFileSync(path.join(import.meta.dirname, '..', 'Workspace.tsx'), 'utf8');

/** Every `applyHeatmapGrid(` call that is not the definition or the edit path. */
function rawCallLines(): string[] {
  return workspace
    .split('\n')
    .map((line, i) => ({ line: line.trim(), n: i + 1 }))
    .filter(({ line }) => /(?<![A-Za-z])applyHeatmapGrid\(/.test(line))
    .map(({ line, n }) => `${n}: ${line}`);
}

describe('one rule for replacing a heatmap grid', () => {
  it('⚑ the raw apply has exactly the callers it is allowed', () => {
    const calls = rawCallLines();
    // Two: `applyHeatmapGridEdit`, which reindexes and re-reads, and
    // `runHeatmapRead`, which has just read the cells itself so there is
    // nothing stale to carry.
    expect(calls.length, `raw applyHeatmapGrid callers:\n${calls.join('\n')}`).toBe(2);
  });

  it('⚑⚑ the even grid goes through the edit path', () => {
    const at = workspace.indexOf('const overlayEvenHeatmapGrid');
    expect(at, 'overlayEvenHeatmapGrid is gone or renamed').toBeGreaterThan(-1);
    const body = workspace.slice(at, at + 2000);
    expect(body, 'the even grid replaces boundaries without re-reading').toContain(
      'applyHeatmapGridEdit(initialGridFor'
    );
  });

  it('⚑ and the edit path is the one that reindexes a person’s readings', () => {
    const at = workspace.indexOf('const applyHeatmapGridEdit');
    const body = workspace.slice(at, at + 2500);
    expect(body).toContain('reindexCellReadings');
  });

  it('⚑⚑ and it WRITES the reindexed readings to the record, not only to the screen', () => {
    // ⚠️ FOUND BY THE v2.5 PRE-TAG AUDIT. The reindex ran and its result went to
    // `setHeatmapCellReadings` alone - React state - while `layer.readings` kept
    // the OLD `col,row` keys beside the NEW grid. The table was right and the
    // record was wrong, so a save, or an undo and redo, filed a person's typed
    // number against a cell they never looked at, with `source = user` on it.
    // In the one type where colour IS the value and there is no eye-check.
    //
    // ⚠️⚠️ THIS IS A SOURCE-SHAPE ASSERTION, WHICH IS A WEAK INSTRUMENT, and it
    // is the same kind that let the defect through: the case above proves only
    // that the string `reindexCellReadings` appears in the body. It is what this
    // seam offers - the glue lives in a React callback with no unit entrance -
    // so it is used deliberately and labelled, not mistaken for proof. The real
    // check is the e2e walk: edit a cell, change the grid, undo, redo.
    const at = workspace.indexOf('const applyHeatmapGridEdit');
    const body = workspace.slice(at, at + 2500);
    expect(
      body,
      'the remapped readings never reach patchHeatmapLayer, so the record keeps the old keys'
    ).toContain('patchHeatmapLayer({ readings');
  });
});
