/**
 * ⚑⚑ ONE `Point2D`, ONE `GlyphSegment`, FOR EVERY MODULE THAT DRAWS A MARK.
 *
 * `histogramGlyph.ts` is where they live, and the directory already said so:
 * `errorBarGlyph.ts` imports both from there, and `barGlyph.ts`'s own header
 * cites that file for the baseline decision.
 *
 * ⚠️ AND THEN RE-DECLARED THEM ANYWAY, as did `candleDirection.ts` under a
 * comment reading *"as every other geometry module states it"* - which is the
 * reuse rule's exact failure: the sentence naming the shared thing sitting
 * above a private copy of it. Structurally identical types are worse than
 * different ones here, because everything typechecks right up until two modules
 * that draw the same staple have to hand a segment to each other.
 *
 * ⚑ `boxPlotGlyph.ts` keeps its own on purpose and is named here so the next
 * reader does not "fix" it: it carries the box-plot family's vocabulary,
 * `candlestickGlyph.ts` already imports from it rather than re-declaring, and
 * that is one shared home, not a stray copy.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const HOME = 'histogramGlyph.ts';
const MUST_IMPORT = ['barGlyph.ts', 'errorBarGlyph.ts', 'candleDirection.ts'];

const read = (f: string): string => readFileSync(`engine/${f}`, 'utf8');

describe('the mark-drawing modules share one geometry vocabulary', () => {
  it(`${HOME} is the home, and exports both`, () => {
    const home = read(HOME);
    expect(home).toMatch(/export interface Point2D/);
    expect(home).toMatch(/export interface GlyphSegment/);
  });

  it('no other module re-declares them', () => {
    for (const f of MUST_IMPORT) {
      const src = read(f);
      expect(src, `${f} declares its own Point2D`).not.toMatch(/^export interface Point2D/m);
      expect(src, `${f} declares its own GlyphSegment`).not.toMatch(/^export interface GlyphSegment/m);
      expect(src, `${f} does not take them from ${HOME}`).toContain("from './histogramGlyph.js'");
    }
  });

  it('⚑ the box plot family keeps its own, deliberately, and shares it', () => {
    expect(read('boxPlotGlyph.ts')).toMatch(/export interface Point2D/);
    expect(read('candlestickGlyph.ts'), 'candlestick imports rather than re-declares').toContain(
      "from './boxPlotGlyph.js'"
    );
  });
});
