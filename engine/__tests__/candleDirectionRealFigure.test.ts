/**
 * ⚑⚑ THE CANDLE COLOUR IS SAMPLED OFF A REAL FIGURE, NOT OFF A PAINTED BLOCK.
 *
 * ⚠️ FOUND BY MUTATION TESTING, 2026-09-09: `candleDirection.ts` scored 68.35%,
 * the worst of the eight v2.5 files, and the survivors clustered in ONE place -
 * `sampleCandleBody`'s window. `inset`, `top`, `bottom`, `left` and `right`
 * could each be mutated, and the refusal beneath them replaced with `if (false)`,
 * with the whole board still green:
 *
 *     inset  = Math.min(3, (vMax - vMin) / 4)   ->  * 4
 *     top    = Math.ceil(vMin + inset)          ->  vMin - inset
 *     bottom = Math.floor(vMax - inset)         ->  vMax + inset
 *     left   = Math.ceil(cross - halfWidth/2)   ->  cross + halfWidth/2
 *     if (bottom < top || right < left) ...     ->  if (false)
 *
 * ⚑⚑ WHY NOTHING NOTICED: `twoCandles()` paints a UNIFORM rectangle in one flat
 * colour, so wherever inside it you sample you get the same answer and the
 * window cannot be wrong. Exactly the fixture question - what does your fixture
 * set to uniform? - and the answer was "the only thing under test".
 *
 * ▶ WHAT THE INSET IS FOR, and why a wrong window is dangerous rather than
 * untidy: a real body has anti-aliased edges and a wick running through it, and
 * the sampler has to stay off them. Colour IS the value here, so a body sampled
 * at its edge is a silently wrong direction - Open and Close exchanged, with
 * nothing on screen disagreeing.
 *
 * ⚠️ AND THIS FIGURE DOES NOT KILL EVERY ONE OF THEM, which is worth saying out
 * loud rather than implying: the generator draws the wick in the SAME colour as
 * the body, directly above and below it, so a window that overshoots vertically
 * lands on the wick and reads the same colour. What it does test is the half a
 * painted block cannot: eight bodies of two real colours, anti-aliased, over a
 * grid, four rising and four falling - so a window that misses the body, or
 * collapses, or reads the wrong channel, changes the answer.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { readPng } from './helpers/readPng.js';
import {
  CalibrationSession,
  CANDLESTICK_AXES_CONFIG,
  type CalibratedAxes,
} from '../calibrationSession.js';
import { sampleCandleBody } from '../candleDirection.js';

const FIGURE = 'samples/candlestick-trading-week.png';
const TRUTH = JSON.parse(readFileSync('samples/candlestick-trading-week.truth.json', 'utf8')) as {
  calibration: { anchors: Record<string, { px: number; py: number; value?: number }> };
  series: { points: { category: string; open: number; high: number; low: number; close: number }[] }[];
};

const DAYS = TRUTH.series[0]!.points;
const A = TRUTH.calibration.anchors;

/** The figure's own value axis: two anchors, read off the truth file. */
function yOf(value: number): number {
  const p1 = A['p1']!;
  const p2 = A['p2']!;
  return p1.py + ((value - p1.value!) * (p2.py - p1.py)) / (p2.value! - p1.value!);
}

/** Category i's centre. The axis spans the plot box and holds `count` bands, so
 *  a centre sits half a band in - the same rule the app's own ticks follow. */
function xOf(index: number): number {
  const c1 = A['c1']!;
  const c2 = A['c2']!;
  const count = c2.value!;
  return c1.px + ((index + 0.5) * (c2.px - c1.px)) / count;
}

function walkedFigure(): {
  session: CalibrationSession<CalibratedAxes>;
  data: Uint8ClampedArray;
  width: number;
  height: number;
} {
  const img = readPng(FIGURE);
  const session = new CalibrationSession<CalibratedAxes>(CANDLESTICK_AXES_CONFIG as never);
  const p1 = A['p1']!;
  const p2 = A['p2']!;
  session.handleCalibrationClick(p1.px, p1.py);
  session.confirmCalibrationValues([String(p1.value)]);
  session.handleCalibrationClick(p2.px, p2.py);
  session.confirmCalibrationValues([String(p2.value)]);
  const c1 = A['c1']!;
  const c2 = A['c2']!;
  session.handleCalibrationClick(c1.px, c1.py);
  session.handleCalibrationClick(c2.px, c2.py);
  session.confirmCalibrationValues([String(c2.value)]);
  expect(session.runCalibration(), session.getCalibrationError() ?? 'no error').toBe(true);

  // ⚑ The walk the app prompts for, bottom-up: the low, the lower body edge,
  // the upper body edge, the high. Not open-then-close - the prompts name
  // PLACES, because on a falling candle the open is the top edge.
  DAYS.forEach((d, i) => {
    const x = xOf(i);
    session.addDataPoint(x, yOf(d.low));
    session.addDataPoint(x, yOf(Math.min(d.open, d.close)));
    session.addDataPoint(x, yOf(Math.max(d.open, d.close)));
    session.addDataPoint(x, yOf(d.high));
  });
  return { session, data: img.data, width: img.width, height: img.height };
}

describe('a candle’s direction, read off the shipped figure', () => {
  it('⚑⚑ names all eight days the way the figure drew them', () => {
    const { session, data, width, height } = walkedFigure();
    const expected = DAYS.map((d) => d.close > d.open);
    // The fixture earns its keep by being MIXED: four rising, four falling, so
    // a sampler that has collapsed to one answer cannot pass by luck.
    expect(new Set(expected).size, 'the figure draws both appearances').toBe(2);

    const changed = session.readCandleDirections(data, width, height);
    expect(changed, 'every complete candle was read').toBeGreaterThan(0);

    const got = session.getCandlestickGlyphs().map((g) => g.rising);
    expect(got, `expected ${JSON.stringify(expected)}`).toEqual(expected);
  });

  it('⚑ and the values it filed are the figure’s own, to the pixel', () => {
    // The companion assertion: a direction read off the right body is worth
    // nothing if the marks landed somewhere else. This is what says the sample
    // window was aimed at the candle the row claims.
    const { session } = walkedFigure();
    const rows = session.getTupleRows();
    expect(rows.length).toBe(DAYS.length);
    rows.forEach((row, i) => {
      const d = DAYS[i]!;
      const cells = row.cells as (number | null)[];
      // Low, Open, Close, High - the type's own slot order.
      expect(cells[0], `day ${i + 1} low`).toBeCloseTo(d.low, 0);
      expect(cells[3], `day ${i + 1} high`).toBeCloseTo(d.high, 0);
      expect(new Set([cells[1], cells[2]]), `day ${i + 1} body edges`).toEqual(
        new Set([d.open, d.close].map((v) => expect.closeTo(v, 0) as unknown as number))
      );
    });
  });
});

/**
 * ⚑⚑ THE WINDOW ITSELF, TESTED WHERE THE REAL FIGURE CANNOT REACH.
 *
 * ⚠️ THE OBVIOUS FIX DID NOT WORK, AND MEASURING IS THE ONLY REASON I KNOW.
 * Reading the shipped figure took `candleDirection.ts` from 68.35% to 69.78% -
 * two mutants out of forty-one. The window survivors were untouched, because a
 * whole-figure test exercises the HAPPY PATH and the mutants live in cases the
 * figure does not contain:
 *
 *   · the generator draws the WICK IN THE BODY'S OWN COLOUR, directly above and
 *     below it, so a window that overshoots vertically lands on the wick and
 *     reads exactly the right colour;
 *   · and no day in the week is a doji, so the collapse refusal never fires.
 *
 * ▶ So these paint the case the docstring says the inset exists for, and which
 * no bundled figure has: *"a border is drawn ON the boundary, and an
 * anti-aliased one blends the body with the paper into a colour that is
 * neither."* A body with no wick, over paper, with a blended edge.
 *
 * ⚑⚑ AND THE REMAINING WINDOW SURVIVORS ARE EQUIVALENT MUTANTS - MEASURED, not
 * assumed. Running the real figure through the true window and through each
 * mutated one (`inset * 4`, `vMin - inset`, `vMax + inset`) returns the SAME
 * colour for all eight candles:
 *
 *     none    [214,39,40] [214,39,40] [214,39,40] [27,122,52] …
 *     inset   [214,39,40] [214,39,40] [214,39,40] [27,122,52] …
 *     top     [214,39,40] [214,39,40] [214,39,40] [27,122,52] …
 *     bottom  [214,39,40] [214,39,40] [214,39,40] [27,122,52] …
 *
 * The MEDOID is why, and it is the point of choosing one: a handful of edge or
 * wick pixels cannot move the most central colour. So the inset and the medoid
 * are two defences against one problem, and the medoid alone carries it. Killing
 * those mutants would need a fixture engineered to defeat the medoid - which
 * tests an implementation detail rather than anything a figure does.
 * ⛔ So they are left alive DELIBERATELY. A survivor that cannot change an
 * answer is not a gap, and a test written to kill it would be the kind that
 * proves the code agrees with itself.
 */
describe('the body sample stays inside the body', () => {
  const W = 60;
  const H = 60;
  /** A filled rectangle, its 2px edge blended toward the paper, on white. */
  function bodyWithBlendedEdge(
    top: number,
    bottom: number,
    fill: [number, number, number]
  ): Uint8ClampedArray {
    const src = new Uint8ClampedArray(W * H * 4).fill(255);
    const put = (x: number, y: number, rgb: [number, number, number]): void => {
      const i = (y * W + x) * 4;
      src[i] = rgb[0];
      src[i + 1] = rgb[1];
      src[i + 2] = rgb[2];
      src[i + 3] = 255;
    };
    // The blend ring: what anti-aliasing actually leaves behind, a colour the
    // figure never chose. Two rows deep, so an overshoot cannot miss it.
    const blend: [number, number, number] = [
      Math.round((fill[0] + 255) / 2),
      Math.round((fill[1] + 255) / 2),
      Math.round((fill[2] + 255) / 2),
    ];
    for (let y = top - 2; y <= bottom + 2; y++) {
      for (let x = 18; x <= 42; x++) {
        if (y < 0 || y >= H) continue;
        put(x, y, y < top || y > bottom ? blend : fill);
      }
    }
    return src;
  }

  const GREEN: [number, number, number] = [27, 122, 52];

  it('⚑⚑ reads the FILL, not the blended edge, on a body with no wick to hide behind', () => {
    // A short body: 10 rows, so a 3px overshoot at each end would take SIX rows
    // of blend against four of fill and carry the medoid with it.
    const top = 25;
    const bottom = 34;
    const src = bodyWithBlendedEdge(top, bottom, GREEN);
    const rgb = sampleCandleBody(src, W, H, { x: 30, y: bottom }, { x: 30, y: top }, 24);
    expect(rgb, 'nothing sampled').not.toBeNull();
    expect(rgb, `read ${JSON.stringify(rgb)} rather than the body's own colour`).toEqual(GREEN);
  });

  it('⚑ and the same body read from either end gives the same answer', () => {
    // The corners arrive in whatever order the walk placed them; `vMin`/`vMax`
    // exist so that cannot matter.
    const src = bodyWithBlendedEdge(25, 34, GREEN);
    const up = sampleCandleBody(src, W, H, { x: 30, y: 34 }, { x: 30, y: 25 }, 24);
    const down = sampleCandleBody(src, W, H, { x: 30, y: 25 }, { x: 30, y: 34 }, 24);
    expect(up).toEqual(down);
  });

  it('⚑ a doji still reads - its body is a line, and the figure draws it', () => {
    // Named in the docstring as a case that must work: open equal to close has
    // no height, and the reading is still real.
    const src = bodyWithBlendedEdge(30, 30, GREEN);
    expect(sampleCandleBody(src, W, H, { x: 30, y: 30 }, { x: 30, y: 30 }, 24)).toEqual(GREEN);
  });

  it('⚑ refuses when the box has no pixels at all, rather than inventing a colour', () => {
    // "Null only when the box has no pixels at all: off the image, or zero
    // width" - the docstring's own promise, and the branch nothing reached.
    const src = bodyWithBlendedEdge(25, 34, GREEN);
    expect(sampleCandleBody(src, W, H, { x: 30, y: 30 }, { x: 30, y: 30 }, 0)).not.toBeNull();
    expect(sampleCandleBody(src, W, H, { x: -400, y: 30 }, { x: -400, y: 30 }, 24)).toBeNull();
    expect(sampleCandleBody(src, W, H, { x: 30, y: -400 }, { x: 30, y: -420 }, 24)).toBeNull();
  });
});
