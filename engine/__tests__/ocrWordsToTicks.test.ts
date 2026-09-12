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

/**
 * ⚑⚑ A LABEL THAT OVERHANGS THE AXIS END STILL BELONGS TO ITS CATEGORY.
 *
 * The first and last labels of a row routinely sit a little outside the axis
 * span - a rotated one leans past the end, and a wide one is centred on a tick
 * that is itself only half a band in. Filed by a strict "inside a band or
 * nowhere" test, those were DROPPED, so the outermost category came back
 * unnamed while every other one read fine.
 *
 * ⚑ The codebase already settled this rule for the same dividers: the doc on
 * `bandIndexForParam` says *"the outermost bands are UNBOUNDED - anything left
 * of the first divider is category 0"*, because a bar just outside the declared
 * span still belongs to the category it is nearest. A word is the same claim
 * about the same axis, and having two answers to one question is how they drift.
 *
 * ⚠️ NOT unbounded, though, and that is the one difference worth keeping. A BAR
 * is known to belong to the figure; a WORD might be the axis title, a legend
 * entry or a stray number the box happened to catch, and forcing junk into
 * category 0 would be worse than dropping it. So the reach is HALF A BAND past
 * each end - measured against the figure's own geometry rather than a pixel
 * guess - which covers an overhanging label and nothing else.
 */
describe('a label just outside the span', () => {
  it('⚑⚑ files an overhanging FIRST label into category 0 rather than dropping it', () => {
    const out = wordsToTicks({
      // Anchored 20px left of the axis start: a rotated label leaning past it.
      words: [word('2021-01-01', -40, -20)],
      toSource: identity,
      dividers: DIVIDERS,
      along: 'x',
      axisAt: 200,
    });
    expect(out).toEqual([{ categoryIndex: 0, text: '2021-01-01', confidence: 90 }]);
  });

  it('⚑⚑ files an overhanging LAST label into the last category', () => {
    const out = wordsToTicks({
      words: [word('2021-01-08', 420, 440)],
      toSource: identity,
      dividers: DIVIDERS,
      along: 'x',
      axisAt: 200,
    });
    expect(out).toEqual([{ categoryIndex: 3, text: '2021-01-08', confidence: 90 }]);
  });

  it('⚠️ still drops a word FAR outside - that is junk the box caught, not a label', () => {
    // Beyond half a band (50px here) past the end. An axis title or a legend
    // entry must not be forced into category 0.
    const out = wordsToTicks({
      words: [word('Date', -200, -160), word('Price', 600, 660)],
      toSource: identity,
      dividers: DIVIDERS,
      along: 'x',
      axisAt: 200,
    });
    expect(out).toEqual([]);
  });
});

/**
 * ⚑⚑ A TICK MARK IS NOT A WORD.
 *
 * Measured on a real figure: a band dragged a few pixels below the axis catches
 * the row of tick marks, and the reader returns each one as a `-`. Joined in
 * reading order, every category came back named `- 2021-01-01`.
 *
 * ⚑ The band has to be allowed to touch the axis - asking the user to start it
 * clear of the ticks is tribal knowledge, and a rotated label's top corner sits
 * right under the axis anyway. So the reading drops what cannot be a name rather
 * than the user avoiding it.
 *
 * ⚑ The rule is "no letter and no digit", not a list of characters to strip: a
 * name may legitimately contain punctuation (`pH 7.4`, `t-test`, `n=12`), and it
 * is only a word made ENTIRELY of punctuation that carries nothing.
 */
describe('punctuation the band caught', () => {
  it('⚑⚑ drops a tick mark read as a dash, and keeps the label it sat under', () => {
    const out = wordsToTicks({
      // The tick at the band centre, and the label just below it.
      words: [word('-', 45, 55, 202, 208), word('2021-01-01', 20, 80)],
      toSource: identity,
      dividers: DIVIDERS,
      along: 'x',
      axisAt: 200,
    });
    expect(out).toEqual([{ categoryIndex: 0, text: '2021-01-01', confidence: 90 }]);
  });

  it('⚑ keeps punctuation that is part of a name', () => {
    const out = wordsToTicks({
      words: [word('pH', 20, 50), word('7.4', 55, 80), word('n=12', 120, 180)],
      toSource: identity,
      dividers: DIVIDERS,
      along: 'x',
      axisAt: 200,
    });
    expect(out).toEqual([
      { categoryIndex: 0, text: 'pH 7.4', confidence: 90 },
      { categoryIndex: 1, text: 'n=12', confidence: 90 },
    ]);
  });

  it('⚑ a category whose ONLY reading was punctuation gets no entry at all', () => {
    // Not an empty name: an empty reading and an unread category must stay
    // indistinguishable downstream, which is what lets the card leave it alone.
    const out = wordsToTicks({
      words: [word('-', 45, 55, 202, 208)],
      toSource: identity,
      dividers: DIVIDERS,
      along: 'x',
      axisAt: 200,
    });
    expect(out).toEqual([]);
  });
});

/**
 * ⚑⚑ THE BAND REACHED UP INTO THE BARS - David's stacked figure, 2026-09-12.
 *
 * The names came back `Q1 EEE`, `Q2 EEEENEEED 0`, `Q3 EERE 0`, `Qa EEE` at
 * confidences 3, 0, 15 and 21. Reading the same band with the shipped reader
 * showed the four labels had been read PERFECTLY - 74, 92, 85, 76 - alongside
 * five pieces of bar ink and axis rule at 16, 5, 10, 0 and 0. The numbers below
 * are those measurements.
 */
describe('junk the band caught above the labels', () => {
  it('⚑⚑ drops a word that reads far worse than its own neighbours, and keeps the label', () => {
    const out = wordsToTicks({
      words: [
        word('EE', 10, 60, 180, 200, 16), // bar ink, above the text row
        word('Q1', 40, 60, 210, 225, 74),
        word('EE', 110, 150, 180, 200, 5),
        word('Q2', 140, 160, 210, 225, 92),
      ],
      toSource: identity,
      dividers: DIVIDERS,
      along: 'x',
      axisAt: 200,
    });
    expect(out).toEqual([
      { categoryIndex: 0, text: 'Q1', confidence: 74 },
      { categoryIndex: 1, text: 'Q2', confidence: 92 },
    ]);
  });

  it('⚑⚑ a band where EVERYTHING reads weakly is left alone - that is a poor scan, not an outlier', () => {
    // Nothing here is an authority, so nothing may rule anything else out. The
    // reading is reported weak, which is the only honest thing to say about it.
    const out = wordsToTicks({
      words: [word('Kenaf', 20, 60, 210, 225, 30), word('rn', 62, 80, 210, 225, 12)],
      toSource: identity,
      dividers: DIVIDERS,
      along: 'x',
      axisAt: 200,
    });
    expect(out).toEqual([{ categoryIndex: 0, text: 'Kenaf rn', confidence: 12 }]);
  });

  it('⚑⚑ a MULTI-LINE label survives, because its two lines read about as well as each other', () => {
    const out = wordsToTicks({
      words: [
        word('Kenaf', 20, 80, 205, 218, 88),
        word('fibre', 20, 80, 220, 233, 81),
      ],
      toSource: identity,
      dividers: DIVIDERS,
      along: 'x',
      axisAt: 200,
    });
    expect(out).toEqual([{ categoryIndex: 0, text: 'Kenaf fibre', confidence: 81 }]);
  });

  it('⚑⚑ a category holding ONLY junk still reports it, at its own confidence', () => {
    // ⚑ The authority is the category's own, deliberately. A word here has
    // nothing better beside it to be an outlier of, and reporting `EE` at 4 in a
    // card that shows every confidence tells the user more than an empty row,
    // which the card reads as "leave this name alone".
    const out = wordsToTicks({
      words: [word('Kenaf', 20, 80, 210, 225, 90), word('EE', 120, 180, 180, 200, 4)],
      toSource: identity,
      dividers: DIVIDERS,
      along: 'x',
      axisAt: 200,
    });
    expect(out).toEqual([
      { categoryIndex: 0, text: 'Kenaf', confidence: 90 },
      { categoryIndex: 1, text: 'EE', confidence: 4 },
    ]);
  });

  it('⚑⚑ a genuine second line that reads a good deal worse is KEPT - the bound the fraction has to respect', () => {
    // `Sea / isiand` at 96 and 41. This is the case that says the fraction
    // cannot be 0.5: the ratio here is 0.43 and the junk's is 0.22.
    const out = wordsToTicks({
      words: [word('Sea', 20, 60, 210, 225, 96), word('isiand', 20, 80, 230, 245, 41)],
      toSource: identity,
      dividers: DIVIDERS,
      along: 'x',
      axisAt: 200,
    });
    expect(out).toEqual([{ categoryIndex: 0, text: 'Sea isiand', confidence: 41 }]);
  });
});
