/**
 * Measure a bar to the outside of its own OUTLINE (v2.4).
 *
 * ⚑⚑ WHY, measured rather than supposed. A figure that strokes its bars draws
 * that stroke in a colour the trace does not match, so the fill stops just
 * inside it and the bar reads LOW. On
 * `samples/bar-hatched-extraction-yield.png` - a 1px black stroke - all six bars
 * came back low by a mean of **0.99px**, every one of them negative. Measured to
 * the outer edge of the stroke they read **+0.01px**, scattered either side.
 * That is the difference between a systematic bias and none, and a systematic
 * bias is the kind a person cannot see and cannot correct.
 *
 * ⚑ THE OUTER EDGE, NOT THE STROKE'S CENTRE, and both were measured (the centre
 * still reads -0.49px). The luminance above a bar top runs
 * `255, 255, 205, 0, 55, 69, 69` - paper, antialias, stroke, blend, fill - and
 * the row the mask begins on is already the blend BELOW the stroke, so stepping
 * out by the stroke's own width lands on the boundary the figure drew.
 *
 * ⛔⛔ IT IS SELF-LIMITING, which is what lets it run on every bar with no
 * declaration gating it. An outline is drawn DARKER than the fill it surrounds;
 * an antialiased edge against paper is LIGHTER. On two unoutlined sample figures
 * the band measures 0px on every bar and the readings are untouched. A figure
 * that does not stroke its bars cannot be affected by this at all.
 *
 * ⛔ AND ONLY THE VALUE EDGES MOVE. A bar's WIDTH is not its datum, and stepping
 * sideways would walk toward its neighbours - the direction this project has
 * been burned in before.
 */

/** The widest stroke still read as an outline rather than another object. */
export const MAX_OUTLINE_PX = 3;

/**
 * How much darker than the fill a pixel must be to be that fill's own stroke.
 *
 * ⚑ A margin rather than an absolute: what matters is the step DOWN from the
 * fill, so a pale bar with a grey stroke works the same way a navy bar with a
 * black one does.
 */
const DARKER_THAN_FILL = 15;

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const lumaAt = (
  data: Uint8Array | Uint8ClampedArray,
  width: number,
  x: number,
  y: number
): number => {
  const i = (y * width + x) * 4;
  return 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
};

/**
 * How many pixels of stroke sit outside `from`, walking in `step`.
 *
 * ⚑ SAMPLED AT THREE PLACES ACROSS THE EDGE AND THE MEDIAN TAKEN, not at one:
 * a single column can land on a hatch line, a data label, or the one place the
 * stroke is broken, and a stroke that is really there is there all the way
 * along.
 */
function strokeDepth(
  data: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  from: number,
  step: -1 | 1,
  acrossLo: number,
  acrossHi: number,
  vertical: boolean,
  fillLuma: number
): number {
  const span = acrossHi - acrossLo;
  if (span <= 0) return 0;
  const samples = [0.25, 0.5, 0.75].map((f) => Math.round(acrossLo + span * f));
  const depths = samples.map((across) => {
    let depth = 0;
    for (let n = 1; n <= MAX_OUTLINE_PX + 1; n++) {
      const along = from + step * n;
      const x = vertical ? across : along;
      const y = vertical ? along : across;
      if (x < 0 || y < 0 || x >= width || y >= height) break;
      if (lumaAt(data, width, x, y) >= fillLuma - DARKER_THAN_FILL) break;
      depth++;
    }
    return depth;
  });
  depths.sort((a, b) => a - b);
  const median = depths[1]!;
  // ⚑ A band deeper than a stroke is another object touching the bar, and
  // absorbing it would invent extent rather than recover it.
  return median > MAX_OUTLINE_PX ? 0 : median;
}

/**
 * Grow a bar's box outward across its own stroke, along the VALUE axis only.
 *
 * `categoryAxis` names the axis the categories run along, so the values run
 * along the other one - the same convention every other bar technique here uses.
 * `fillLuma` is the luminance of the colour the user picked.
 */
export function extendAcrossOutline(
  data: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  box: Box,
  categoryAxis: 'x' | 'y',
  fillLuma: number
): Box {
  // Values run DOWN the image on an upright chart (categories along x).
  const vertical = categoryAxis === 'x';
  const lo = vertical ? box.minY : box.minX;
  const hi = vertical ? box.maxY : box.maxX;
  const acrossLo = vertical ? box.minX : box.minY;
  const acrossHi = vertical ? box.maxX : box.maxY;
  const before = strokeDepth(data, width, height, Math.round(lo), -1, acrossLo, acrossHi, vertical, fillLuma);
  // ⚑ `max` is one past the last matched pixel (see `Blob.bbox`), so the last
  // row of ink is `hi - 1` and the stroke begins one beyond that.
  const after = strokeDepth(data, width, height, Math.round(hi) - 1, 1, acrossLo, acrossHi, vertical, fillLuma);
  return vertical
    ? { ...box, minY: box.minY - before, maxY: box.maxY + after }
    : { ...box, minX: box.minX - before, maxX: box.maxX + after };
}
