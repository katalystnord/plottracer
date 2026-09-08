/**
 * ⚑⚑ ONE READ OF THE WHOLE BAND, RELATED TO THE TICKS - David's design.
 *
 * *"we just need to relate this with the positions on the tick marks, for the
 * odd chance that there might be multiple line category descriptions."*
 */
import { describe, expect, it } from 'vitest';
import { wordsToTicks, type OcrWord } from '../ocrWordsToTicks.js';

/** Four categories, 100px apart, on an axis running left to right at y=200. */
const DIVIDERS = [
  { x: 0, y: 200 },
  { x: 100, y: 200 },
  { x: 200, y: 200 },
  { x: 300, y: 200 },
  { x: 400, y: 200 },
];

/** The straightened frame IS the figure's frame, for the horizontal cases. */
const identity = (x: number, y: number) => ({ x, y });

function word(text: string, x0: number, x1: number, y0 = 210, y1 = 225, confidence = 90): OcrWord {
  return { text, confidence, bbox: { x0, y0, x1, y1 } };
}

describe('relating one whole-band read to the ticks', () => {
  it('files each word under the category its anchor lands in', () => {
    const out = wordsToTicks({
      words: [word('Kenaf', 20, 80), word('Jute', 120, 180), word('Flax', 320, 380)],
      toSource: identity,
      dividers: DIVIDERS,
      along: 'x',
      axisAt: 200,
    });
    expect(out).toEqual([
      { categoryIndex: 0, text: 'Kenaf', confidence: 90 },
      { categoryIndex: 1, text: 'Jute', confidence: 90 },
      { categoryIndex: 3, text: 'Flax', confidence: 90 },
    ]);
  });

  it('⚑ leaves a category no word reached with NO entry, not an empty one', () => {
    // Category 2 is untouched above. An empty string and an unread category look
    // identical downstream, and the card treats "no reading" as "leave it alone".
    const out = wordsToTicks({
      words: [word('Kenaf', 20, 80)],
      toSource: identity,
      dividers: DIVIDERS,
      along: 'x',
      axisAt: 200,
    });
    expect(out.map((r) => r.categoryIndex)).toEqual([0]);
  });

  it('⚑⚑ joins a MULTI-LINE label, in reading order, with nothing written for the case', () => {
    const out = wordsToTicks({
      words: [word('Sea', 20, 60, 210, 225), word('island', 20, 80, 230, 245)],
      toSource: identity,
      dividers: DIVIDERS,
      along: 'x',
      axisAt: 200,
    });
    expect(out).toEqual([{ categoryIndex: 0, text: 'Sea island', confidence: 90 }]);
  });

  it('⚑ reports a label at its WEAKEST word, so one crisp word cannot carry a garbled one', () => {
    const out = wordsToTicks({
      words: [word('Sea', 20, 60, 210, 225, 96), word('isiand', 20, 80, 230, 245, 41)],
      toSource: identity,
      dividers: DIVIDERS,
      along: 'x',
      axisAt: 200,
    });
    expect(out[0]!.confidence).toBe(41);
  });

  it('⚑⚑ takes the ANCHOR end of a rotated label, not its centre', () => {
    // A real 45 degree date label: the END of the text sits AT its tick and the
    // rest trails down and to the LEFT, which is what `rotation=45, ha=right`
    // draws. The tick is at x=310, just inside category 3.
    //
    // ⚠️ THE FIRST VERSION OF THIS TEST WAS VACUOUS - mutating anchor to centre
    // left it green, because the label was short enough that both landed in the
    // same band. A test of "anchor, not centre" has to put them in DIFFERENT
    // bands or it tests nothing.
    const k = Math.SQRT1_2;
    const toSource = (x: number, y: number) => ({
      x: 310 - (90 - x) * k + y * k,
      y: 210 + (90 - x) * k + y * k,
    });
    const out = wordsToTicks({
      words: [{ text: '2021-01-08', confidence: 88, bbox: { x0: 0, y0: 0, x1: 90, y1: 14 } }],
      toSource,
      dividers: DIVIDERS,
      along: 'x',
      axisAt: 200,
    });
    // Anchor lands at x=310 -> category 3. The box's CENTRE lands at x~283,
    // which is category 2 - the mis-filing this rule exists to prevent, and it
    // bites the LONG labels only, so short ones would look fine throughout.
    expect(out).toEqual([{ categoryIndex: 3, text: '2021-01-08', confidence: 88 }]);
  });

  it('works down a rotated chart’s vertical category axis too', () => {
    const out = wordsToTicks({
      words: [word('Kenaf', 210, 260, 20, 80)],
      toSource: identity,
      dividers: [
        { x: 200, y: 0 },
        { x: 200, y: 100 },
        { x: 200, y: 200 },
      ],
      along: 'y',
      axisAt: 200,
    });
    expect(out).toEqual([{ categoryIndex: 0, text: 'Kenaf', confidence: 90 }]);
  });

  it('ignores whitespace the reader adds between blocks', () => {
    const out = wordsToTicks({
      words: [word('  ', 20, 30), word('Kenaf', 20, 80)],
      toSource: identity,
      dividers: DIVIDERS,
      along: 'x',
      axisAt: 200,
    });
    expect(out).toEqual([{ categoryIndex: 0, text: 'Kenaf', confidence: 90 }]);
  });
});
