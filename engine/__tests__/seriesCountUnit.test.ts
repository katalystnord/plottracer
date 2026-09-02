import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { CalibrationSession, type CalibratedAxes } from '../calibrationSession.js';
import { ALL_TYPES, calibratedHealthy, labelOf } from './fixtures/anyType.js';

/**
 * ⚑⚑ THE SERIES ENTRY MUST NOT COUNT POINTS FOR A TYPE WHOSE RECORD IS NOT
 * POINTS.
 *
 * Found on the screenshot bench, 2026-08-26, re-shooting the website gallery:
 *
 *     histogram   "Series 1 (20)"   over TEN bins
 *     bar         "Series 1 (30)"   over FIFTEEN bars
 *     scatter     "Series 1 (26)"   over 26 points  <- the only right one
 *
 * Two corners make a bar, so the count is exactly double the record and reads as
 * a number about the same thing. David, on the heatmap's version of this in
 * v2.3: two lines counting different things with nothing on screen saying they
 * were different questions.
 *
 * ⚠️ AND THE v2.3 FIX WAS WRITTEN AS A NAME CHECK - `config.outputPanel !==
 * 'heatmap'` - where the question is *does this type's record count points?*
 * Heatmap was the type that happened to be looked at; bar, box plot, histogram
 * and pie have the same record shape and were left. CLAUDE.md's first pattern:
 * does this belong to the TYPE, or to a QUESTION? If a question, every type
 * gets it.
 *
 * ⚑ `getExportShape()` IS THAT QUESTION, and it already exists. It is also the
 * only thing that can answer it, because the shape is DYNAMIC: a Bar session
 * carrying box-plot groups exports as tuples while the type says nothing. Its
 * own doc says to resolve through it and never to read the config field.
 */

/**
 * Which types record POINTS, one entry at a time.
 *
 * ⚑ A TABLE, so a thirteenth type has to be classified rather than defaulting
 * into whichever branch it happens to land in.
 */
const RECORDS_POINTS: Record<string, boolean> = {
  xy: true,
  categorical: true, // one point per category - a plain click, no second end
  polar: true,
  ternary: true,
  map: true,
  ccr: true,
  spider: true, // N x 1D: one reading per spoke, independent slots -> flat
  histogram: false, // bins
  heatmap: false, // cells, read from the image
  bar: false, // two corners per bar
  span: false, // two MEASURED ends per span - the interval IS the datum
  boxplot: false, // five per box
  pie: false, // two edges per sector
};

describe('a series entry counts points only where a datum IS a point', () => {
  it('is not vacuous - every registered type is classified', () => {
    const ids = ALL_TYPES.map(([id]) => id).sort();
    expect(Object.keys(RECORDS_POINTS).sort()).toEqual(ids);
  });

  for (const [id, config] of ALL_TYPES) {
    it(`${labelOf(id)}: ${RECORDS_POINTS[id] ? 'counts points' : 'does NOT count points'}`, () => {
      const session: CalibrationSession<CalibratedAxes> = calibratedHealthy(id, config);
      expect(session.getExportShape() === 'flat').toBe(RECORDS_POINTS[id]);
    });
  }

  it('⚑ and the UI asks that question, not the type name', () => {
    // ⚑ Asserts the SOURCE, like `oneFigureResetList`: what fails here is the
    // name check coming back for a fourth type, which no runtime assertion
    // about one session can see.
    const workspace = readFileSync(
      path.join(import.meta.dirname, '..', '..', 'ui', 'src', 'Workspace.tsx'),
      'utf8'
    );
    expect(workspace).toMatch(/showPointCount=\{[^}]*getExportShape\(\)/);
    expect(workspace).not.toMatch(/showPointCount=\{config\.outputPanel/);
  });
});
