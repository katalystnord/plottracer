import { describe, it, expect } from 'vitest';
import {
  COLOR_NOISE_FLOOR,
  MIN_RAMP_SPREAD,
  MIN_STRIP_LENGTH_PX,
  checkStripSamples,
  stripFromCorners,
  countColorLevels,
  colorDistance,
  invertColor,
  medoidColor,
  positionOnStrip,
  sampleColorBar,
  type ColorBarStrip,
} from '../colorBar.js';
import type { RGB } from '../colorFilter.js';

/**
 * ⚑ MUTATION: 96.30% (359 killed / 14 survived / 0 uncovered), measured with a
 * throwaway Stryker config scoped to `algorithms/colorBar.ts`. The 14 survivors
 * were each read and are EQUIVALENT — they cannot change an output:
 *
 *   - the RGB bounding-box loop run over a 4th channel a colour does not have
 *     (`rgb[3]` is undefined, so neither comparison fires);
 *   - `<` relaxed to `<=` when updating that box, which reassigns the same value;
 *   - the window buffer's initial contents, which are cleared each iteration;
 *   - three of the sampling window's out-of-bounds guards, where the read yields
 *     `undefined` rather than a wrapped pixel and the medoid keeps its first
 *     candidate either way. ⚑ The guard that DOES matter — the one preventing a
 *     read from wrapping onto the next row, which returns a real colour from
 *     somewhere else — is killed by "never lets the window WRAP" below;
 *   - `i < n` in the band scan, where `d[n]` is undefined and compares false;
 *   - a band's stored end index, used only in a containment test it cannot flip;
 *   - dropping half the winner-band predicate, since bands are ordered and
 *     disjoint, so the first band ending at or after the best sample is the one
 *     containing it;
 *   - the three bounds on `tiedRun`'s walk, which the `=== target` test already
 *     stops (an off-the-end read is `undefined`, never equal to a distance).
 *
 * Re-derive with a scoped config rather than the committed one; the standing
 * `stryker.config.json` covers all of `algorithms/` and takes far longer. Delete
 * `.stryker-tmp` afterwards.
 */

/** A colour key expressed as a function of position, 0..1 — the ground truth
 * these tests invert back to. */
type RGBRamp = (u: number) => RGB;

/**
 * A horizontal colour key: `width` px wide, `height` px tall, column x painted
 * `ramp(x / (width - 1))`. Everything outside the key stays opaque white, so a
 * strip clicked slightly off the key reads paper rather than nothing.
 */
function makeKey(width: number, height: number, ramp: RGBRamp): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = ramp(x / (width - 1));
      const i = (y * width + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return data;
}

/** Black -> white. Monotone, well-conditioned everywhere, and linear in RGB so
 * the sub-sample refinement has an exact answer to be checked against. */
const greyRamp: RGBRamp = (u) => {
  const v = Math.round(u * 255);
  return [v, v, v];
};

/** Flat red for the first 60%, then red -> yellow: `jet`'s ill-conditioned end
 * in miniature. Half the key carries no information at all. */
const flatThenRamp: RGBRamp = (u) => {
  if (u < 0.6) return [255, 0, 0];
  const g = Math.round(((u - 0.6) / 0.4) * 255);
  return [255, g, 0];
};

/** Black -> white -> black: the cyclic case (`hsv`'s ends), where a colour is
 * genuinely ambiguous rather than merely imprecise. */
const cyclicRamp: RGBRamp = (u) => {
  const v = Math.round((1 - Math.abs(u * 2 - 1)) * 255);
  return [v, v, v];
};

/** A key quantised into 8 flat entries, the way every real colormap is — a
 * lookup table, not a continuous function. Exaggerated so one entry is 25px. */
const lutRamp: RGBRamp = (u) => {
  const step = Math.min(7, Math.floor(u * 8));
  const v = step * 36;
  return [v, v, v];
};

/**
 * A key that returns close to the same grey three times, at 0.1, 0.5 and 0.9,
 * dipping to 100, 102 and 101 with excursions to 180 in between.
 *
 * ⚑ The dips are deliberately NOT in ascending order of closeness: read the
 * first one and its nearest rival is the LAST dip, so distance order and
 * position order disagree. An earlier version had them agreeing, which left the
 * rival sort untested while looking as though it tested it.
 *
 * A NON-MONOTONE key is not exotic — a diverging map (cold–white–warm) revisits
 * pale colours on both sides of its centre, and any key drawn over a background
 * gradient can too. It is the case where a single "nearest colour" answer is
 * least defensible.
 */
const dipRamp: RGBRamp = (u) => {
  const points: [number, number][] = [
    [0, 180],
    [0.1, 100],
    [0.3, 180],
    [0.5, 102],
    [0.7, 180],
    [0.9, 101],
    [1, 180],
  ];
  let v = 180;
  for (let i = 0; i < points.length - 1; i++) {
    const [ua, va] = points[i]!;
    const [ub, vb] = points[i + 1]!;
    if (u >= ua && u <= ub) {
      v = va + ((u - ua) / (ub - ua)) * (vb - va);
      break;
    }
  }
  const g = Math.round(v);
  return [g, g, g];
};

const KEY_W = 201;
const KEY_H = 21;

/**
 * A strip built straight from a ramp, WITHOUT the sampling entrance's checks.
 *
 * ⚑ For fixtures that are deliberately coarse — `lutRamp` is an eight-entry
 * table, exaggerating a real colormap's 256 — because `sampleColorBar` now
 * REFUSES a key showing that few colours, and rightly: eight colours cannot
 * yield a continuous reading, so a number derived from one would be invented.
 * The tests below are about how a plateau is INVERTED, which is a different
 * question from whether such a key should be accepted, so they take their input
 * directly rather than weakening the gate that protects real figures.
 */
function rawStripOf(ramp: RGBRamp, width = KEY_W): ColorBarStrip {
  return {
    samples: Array.from({ length: width }, (_, i) => ({
      t: i / (width - 1),
      rgb: ramp(i / (width - 1)),
    })),
    from: { x: 0, y: 10 },
    to: { x: width - 1, y: 10 },
    thickness: 1,
  };
}

function stripOf(ramp: RGBRamp, thickness = 1): ColorBarStrip {
  const img = makeKey(KEY_W, KEY_H, ramp);
  const result = sampleColorBar(img, KEY_W, KEY_H, { x: 0, y: 10 }, { x: KEY_W - 1, y: 10 }, {
    thickness,
  });
  expect(result.reason).toBeNull();
  return result.strip!;
}

describe('stripFromCorners — the gesture a person can actually aim at', () => {
  it('takes the ramp along the LONGER side, whichever way the bar lies', () => {
    // ⚑ Which way the key runs is a property of the figure, not a declaration.
    const flat = stripFromCorners({ x: 10, y: 100 }, { x: 210, y: 130 })!;
    expect(flat.from).toEqual({ x: 10, y: 115 });
    expect(flat.to).toEqual({ x: 210, y: 115 });
    const upright = stripFromCorners({ x: 100, y: 10 }, { x: 130, y: 210 })!;
    expect(upright.from).toEqual({ x: 115, y: 10 });
    expect(upright.to).toEqual({ x: 115, y: 210 });
  });

  it('reads the SAME strip whichever pair of opposite corners is dragged', () => {
    // ⚑ A drag from bottom-right to top-left is the same rectangle, and a user
    // has no reason to prefer one direction.
    const a = stripFromCorners({ x: 10, y: 100 }, { x: 210, y: 130 })!;
    const b = stripFromCorners({ x: 210, y: 130 }, { x: 10, y: 100 })!;
    const c = stripFromCorners({ x: 10, y: 130 }, { x: 210, y: 100 })!;
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  it('MEASURES the thickness off the bar, inset from its drawn frame', () => {
    // ⚑ It was a hardcoded 5 px: on a thin key that sampled outside the ink, on
    // a thick one it discarded most of the evidence. A corner click lands ON the
    // frame, so the window is inset rather than the full short side.
    const strip = stripFromCorners({ x: 0, y: 0 }, { x: 300, y: 40 })!;
    expect(strip.thickness).toBe(24);
    expect(strip.thickness).toBeLessThan(40);
    // A one-pixel-tall key still samples something rather than nothing.
    expect(stripFromCorners({ x: 0, y: 0 }, { x: 300, y: 1 })!.thickness).toBe(1);
  });

  it('refuses corners that are not finite numbers', () => {
    expect(stripFromCorners({ x: NaN, y: 0 }, { x: 10, y: 10 })).toBeNull();
  });

  it('feeds sampleColorBar a strip that reads the key it was drawn round', () => {
    // End to end: draw a key, drag its corners, and check the ramp comes back.
    const img = makeKey(KEY_W, KEY_H, greyRamp);
    const corners = stripFromCorners({ x: 0, y: 0 }, { x: KEY_W - 1, y: KEY_H - 1 })!;
    const result = sampleColorBar(img, KEY_W, KEY_H, corners.from, corners.to, {
      thickness: corners.thickness,
    });
    expect(result.reason).toBeNull();
    expect(result.strip!.samples).toHaveLength(KEY_W);
  });
});

describe('a MONOCHROME key is not a banded one', () => {
  /** Grey, but spanning only 100…160 — a low-contrast key of the kind a
   * black-and-white figure prints. */
  const faintGrey: RGBRamp = (u) => {
    const g = Math.round(100 + u * 60);
    return [g, g, g];
  };
  /** Six flat bands: significance levels, cluster IDs, land cover. */
  const sixBands: RGBRamp = (u) => {
    const g = Math.min(5, Math.floor(u * 6)) * 45 + 10;
    return [g, g, g];
  };

  it('accepts a faint greyscale ramp, which an absolute threshold would refuse', () => {
    // ⚑⚑ David: *"Non-colour / monochrome heatmaps are going to be a problem
    // though."* They are the case that decides how banding is measured. This key
    // moves 0.3 of an RGB unit per sample — far below any fixed noise floor — so
    // counting levels against an absolute distance sees one long plateau and
    // calls an ordinary monochrome key banded. Counted against its OWN spread it
    // resolves as finely as a full-range ramp does.
    const img = makeKey(KEY_W, KEY_H, faintGrey);
    const result = sampleColorBar(img, KEY_W, KEY_H, { x: 0, y: 10 }, { x: KEY_W - 1, y: 10 }, { thickness: 1 });
    expect(result.reason).toBeNull();
    expect(countColorLevels(result.strip!.samples)).toBeGreaterThan(20);
  });

  it('still refuses six flat bands, however far apart their colours are', () => {
    const img = makeKey(KEY_W, KEY_H, sixBands);
    const result = sampleColorBar(img, KEY_W, KEY_H, { x: 0, y: 10 }, { x: KEY_W - 1, y: 10 }, { thickness: 1 });
    expect(result.reason).toBe('discrete');
    expect(result.strip).toBeNull();
  });

  it('reads a faint grey key to the same POSITIONS a bright one gives', () => {
    // ⚑ Accepting it is only half the claim — the readings have to be right.
    // Low contrast costs PRECISION (the band is wider), not accuracy.
    const faint = stripOf(faintGrey);
    for (const u of [0.15, 0.5, 0.85]) {
      const reading = invertColor(faint, faintGrey(u))!;
      expect(reading.t).toBeCloseTo(u, 1);
    }
  });
});

describe('sampleColorBar', () => {
  it('samples one position per pixel step, end to end', () => {
    const strip = stripOf(greyRamp);
    expect(strip.samples).toHaveLength(KEY_W);
    expect(strip.samples[0]!.t).toBe(0);
    expect(strip.samples[strip.samples.length - 1]!.t).toBe(1);
    expect(strip.samples[0]!.rgb).toEqual([0, 0, 0]);
    expect(strip.samples[strip.samples.length - 1]!.rgb).toEqual([255, 255, 255]);
  });

  it('reads the key in either direction — t follows the click order, not the image', () => {
    const img = makeKey(KEY_W, KEY_H, greyRamp);
    const backwards = sampleColorBar(img, KEY_W, KEY_H, { x: KEY_W - 1, y: 10 }, { x: 0, y: 10 });
    expect(backwards.reason).toBeNull();
    expect(backwards.strip!.samples[0]!.rgb).toEqual([255, 255, 255]);
    expect(backwards.strip!.samples[KEY_W - 1]!.rgb).toEqual([0, 0, 0]);
  });

  it('drops fully transparent positions instead of guessing them', () => {
    const img = makeKey(KEY_W, KEY_H, greyRamp);
    for (let x = 100; x < 110; x++) img[(10 * KEY_W + x) * 4 + 3] = 0;
    const result = sampleColorBar(img, KEY_W, KEY_H, { x: 0, y: 10 }, { x: KEY_W - 1, y: 10 });
    expect(result.reason).toBeNull();
    const ts = result.strip!.samples.map((s) => s.t);
    expect(result.strip!.samples).toHaveLength(KEY_W - 10);
    // The surviving positions keep their true t — the gap is a gap, not a shift.
    expect(ts).not.toContain(100 / (KEY_W - 1));
    expect(ts).toContain(99 / (KEY_W - 1));
    expect(ts).toContain(110 / (KEY_W - 1));
  });

  it('outvotes a contaminated cross-section rather than averaging it in', () => {
    // A tick mark / border in black crossing the top rows of the key. A mean
    // would drag every sample toward black and shift every reading; a medoid
    // reports a colour that was actually printed.
    const img = makeKey(KEY_W, KEY_H, greyRamp);
    for (let y = 8; y <= 9; y++)
      for (let x = 0; x < KEY_W; x++) {
        const i = (y * KEY_W + x) * 4;
        img[i] = 0;
        img[i + 1] = 0;
        img[i + 2] = 255;
      }
    const result = sampleColorBar(img, KEY_W, KEY_H, { x: 0, y: 10 }, { x: KEY_W - 1, y: 10 }, {
      thickness: 5,
    });
    expect(result.reason).toBeNull();
    const mid = result.strip!.samples[100]!;
    expect(mid.rgb).toEqual(greyRamp(0.5));
  });

  describe('refusals', () => {
    const img = makeKey(KEY_W, KEY_H, greyRamp);

    it('refuses two ends that are the same point', () => {
      expect(sampleColorBar(img, KEY_W, KEY_H, { x: 5, y: 5 }, { x: 5, y: 5 }).reason).toBe(
        'not-a-line'
      );
    });

    it('refuses a strip shorter than the minimum', () => {
      expect(sampleColorBar(img, KEY_W, KEY_H, { x: 5, y: 5 }, { x: 11, y: 5 }).reason).toBe(
        'not-a-line'
      );
    });

    it('refuses non-finite ends', () => {
      expect(sampleColorBar(img, KEY_W, KEY_H, { x: NaN, y: 5 }, { x: 100, y: 5 }).reason).toBe(
        'not-a-line'
      );
      expect(
        sampleColorBar(img, KEY_W, KEY_H, { x: 0, y: 5 }, { x: Infinity, y: 5 }).reason
      ).toBe('not-a-line');
    });

    it('refuses an end outside the image, on either axis and at either end', () => {
      // All four sides: a key partly outside the canvas is a cropped figure or a
      // mis-drag, and reading it would sample whatever the buffer holds next.
      expect(sampleColorBar(img, KEY_W, KEY_H, { x: -1, y: 5 }, { x: 100, y: 5 }).reason).toBe(
        'off-image'
      );
      expect(sampleColorBar(img, KEY_W, KEY_H, { x: 0, y: 5 }, { x: KEY_W, y: 5 }).reason).toBe(
        'off-image'
      );
      expect(sampleColorBar(img, KEY_W, KEY_H, { x: 0, y: -1 }, { x: 100, y: 5 }).reason).toBe(
        'off-image'
      );
      expect(sampleColorBar(img, KEY_W, KEY_H, { x: 0, y: 5 }, { x: 100, y: KEY_H }).reason).toBe(
        'off-image'
      );
    });

    it('refuses a strip that is one flat colour — the across-the-bar mis-click', () => {
      // Down the key's short axis: every pixel is the same colour, so every cell
      // in the figure would invert to the same meaningless position.
      const result = sampleColorBar(img, KEY_W, KEY_H, { x: 100, y: 0 }, { x: 100, y: KEY_H - 1 });
      expect(result.reason).toBe('no-ramp');
      expect(result.strip).toBeNull();
    });

    it('refuses a strip whose pixels are all transparent', () => {
      const blank = new Uint8ClampedArray(KEY_W * KEY_H * 4);
      expect(sampleColorBar(blank, KEY_W, KEY_H, { x: 0, y: 10 }, { x: KEY_W - 1, y: 10 }).reason).toBe(
        'no-pixels'
      );
    });

    it('applies the identical check to samples arriving from elsewhere', () => {
      // The load path's entrance to the same model.
      expect(checkStripSamples([])).toBe('no-pixels');
      expect(checkStripSamples([{ t: 0, rgb: [1, 2, 3] }])).toBe('no-pixels');
      expect(
        checkStripSamples([
          { t: 0, rgb: [10, 10, 10] },
          { t: 1, rgb: [15, 15, 15] },
        ])
      ).toBe('no-ramp');
      expect(
        checkStripSamples([
          { t: 0, rgb: [0, 0, 0] },
          { t: 1, rgb: [255, 255, 255] },
        ])
      ).toBeNull();
    });

    it('accepts a strip of exactly the minimum length', () => {
      // The threshold is "shorter than", not "no longer than". A key clicked at
      // exactly the limit is a small key, not a mis-click.
      //
      // ⚑ On its own tiny image, because an 8px slice of the 201px key above
      // spans only ~18 RGB units and is rightly refused as flat — the two
      // thresholds are independent and testing one through the other tests
      // neither.
      const short = MIN_STRIP_LENGTH_PX + 1;
      const tiny = makeKey(short, 5, greyRamp);
      expect(
        sampleColorBar(tiny, short, 5, { x: 0, y: 2 }, { x: MIN_STRIP_LENGTH_PX, y: 2 }).reason
      ).toBeNull();
      expect(
        sampleColorBar(tiny, short, 5, { x: 0, y: 2 }, { x: MIN_STRIP_LENGTH_PX - 1, y: 2 }).reason
      ).toBe('not-a-line');
    });

    it('accepts a spread of exactly the minimum', () => {
      // Same boundary, the other threshold: `MIN_RAMP_SPREAD` exactly is enough.
      expect(colorDistance([0, 0, 0], [MIN_RAMP_SPREAD, 0, 0])).toBe(MIN_RAMP_SPREAD);
      expect(
        checkStripSamples([
          { t: 0, rgb: [0, 0, 0] },
          { t: 1, rgb: [MIN_RAMP_SPREAD, 0, 0] },
        ])
      ).toBeNull();
      expect(
        checkStripSamples([
          { t: 0, rgb: [0, 0, 0] },
          { t: 1, rgb: [MIN_RAMP_SPREAD - 1, 0, 0] },
        ])
      ).toBe('no-ramp');
    });

    it('accepts a spread just over the threshold and refuses one just under', () => {
      const under = Math.floor((MIN_RAMP_SPREAD - 1) / Math.sqrt(3));
      const over = Math.ceil((MIN_RAMP_SPREAD + 1) / Math.sqrt(3));
      expect(colorDistance([0, 0, 0], [under, under, under])).toBeLessThan(MIN_RAMP_SPREAD);
      expect(colorDistance([0, 0, 0], [over, over, over])).toBeGreaterThan(MIN_RAMP_SPREAD);
      expect(
        checkStripSamples([
          { t: 0, rgb: [0, 0, 0] },
          { t: 1, rgb: [under, under, under] },
        ])
      ).toBe('no-ramp');
      expect(
        checkStripSamples([
          { t: 0, rgb: [0, 0, 0] },
          { t: 1, rgb: [over, over, over] },
        ])
      ).toBeNull();
    });
  });
});

describe('sampleColorBar at the edge of the image', () => {
  it('reads a key lying on the image border, using only the pixels that exist', () => {
    // A key cropped flush to the edge of a screenshot — half the thickness
    // window is off-image at every position. The samples must come from the
    // pixels that are there rather than from a padded or wrapped guess.
    const img = makeKey(KEY_W, KEY_H, greyRamp);
    const result = sampleColorBar(img, KEY_W, KEY_H, { x: 0, y: 0 }, { x: KEY_W - 1, y: 0 }, {
      thickness: 5,
    });
    expect(result.reason).toBeNull();
    expect(result.strip!.samples).toHaveLength(KEY_W);
    expect(result.strip!.samples[100]!.rgb).toEqual(greyRamp(0.5));
    const bottom = sampleColorBar(
      img,
      KEY_W,
      KEY_H,
      { x: 0, y: KEY_H - 1 },
      { x: KEY_W - 1, y: KEY_H - 1 },
      { thickness: 5 }
    );
    expect(bottom.reason).toBeNull();
    expect(bottom.strip!.samples[100]!.rgb).toEqual(greyRamp(0.5));
  });

  it('takes its thickness window PERPENDICULAR to a diagonal strip', () => {
    // ⚑ The window has to leave the strip's own line, and on a diagonal that
    // means moving in both x and y. Here the line the user clicked runs through
    // a contaminated diagonal (a cell border, a leader line) and its true
    // neighbours are clean: only a genuinely perpendicular window can outvote
    // the contamination. A window scaled or aimed wrongly reads pixels that are
    // off the image and is left with the bad centre.
    const img = makeKey(KEY_W, KEY_W, greyRamp);
    for (let i = 0; i < KEY_W; i++) {
      const idx = (i * KEY_W + i) * 4;
      img[idx] = 255;
      img[idx + 1] = 0;
      img[idx + 2] = 255;
    }
    const result = sampleColorBar(img, KEY_W, KEY_W, { x: 0, y: 0 }, { x: KEY_W - 1, y: KEY_W - 1 }, {
      thickness: 3,
    });
    expect(result.reason).toBeNull();
    const mid = result.strip!.samples[100]!;
    expect(mid.rgb).not.toEqual([255, 0, 255]);
    // A diagonal strip is longer than the key is wide, so this sample's own `t`
    // is what says which column it read.
    expect(mid.rgb).toEqual(greyRamp(Math.round(mid.t * (KEY_W - 1)) / (KEY_W - 1)));
  });

  it('never lets the window WRAP onto the next row of the buffer', () => {
    // ⚑ An image is a flat array, so the pixel "one to the right of the last
    // column" is a real, readable pixel — the first one of the NEXT ROW. On a
    // key running down the right-hand edge of a figure, a missing bounds check
    // therefore does not crash and does not read noise: it reads a genuine
    // colour from somewhere else entirely, which inverts to a genuine wrong
    // value. A thickness of 2 is what exposes it, because there is no third
    // pixel to outvote the intruder.
    const rows = 40;
    const img = new Uint8ClampedArray(KEY_W * rows * 4);
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < KEY_W; x++) {
        const i = (y * KEY_W + x) * 4;
        // A VERTICAL key: the colour is a function of the row, so a pixel
        // fetched from the wrong row is a different colour.
        img[i] = y * 6;
        img[i + 1] = y * 6;
        img[i + 2] = y * 6;
        img[i + 3] = 255;
      }
    const result = sampleColorBar(
      img,
      KEY_W,
      rows,
      { x: KEY_W - 1, y: 0 },
      { x: KEY_W - 1, y: rows - 1 },
      { thickness: 2 }
    );
    expect(result.reason).toBeNull();
    for (const sample of result.strip!.samples) {
      const row = Math.round(sample.t * (rows - 1));
      expect(sample.rgb).toEqual([row * 6, row * 6, row * 6]);
    }
  });

  it('reads a DIAGONAL strip, so the thickness window is not axis-aligned', () => {
    // Nothing requires a key to be horizontal, and a rotated scan makes every
    // one of them diagonal.
    const img = makeKey(KEY_W, KEY_H, greyRamp);
    const result = sampleColorBar(img, KEY_W, KEY_H, { x: 0, y: 0 }, { x: KEY_W - 1, y: KEY_H - 1 }, {
      thickness: 3,
    });
    expect(result.reason).toBeNull();
    // The ramp runs with x, so a diagonal strip still spans the whole key.
    expect(result.strip!.samples[0]!.rgb).toEqual([0, 0, 0]);
    expect(result.strip!.samples[result.strip!.samples.length - 1]!.rgb).toEqual([255, 255, 255]);
  });
});

describe('medoidColor', () => {
  it('returns a colour that was actually present, never a blend', () => {
    // A mean would return [128,128,128] — a colour on neither side of the
    // border, and on a real key a position the figure never asserted.
    expect(medoidColor([[0, 0, 0], [0, 0, 0], [255, 255, 255]])).toEqual([0, 0, 0]);
  });

  it('is null for an empty set and identity for one colour', () => {
    expect(medoidColor([])).toBeNull();
    expect(medoidColor([[7, 8, 9]])).toEqual([7, 8, 9]);
  });

  it('breaks a tie toward the first colour, so a sample is reproducible', () => {
    // Two colours are always equidistant from each other, so a two-pixel window
    // is always a tie. Resolving it by position rather than by whichever
    // comparison happened to run first is what makes re-reading the same key
    // give the same strip.
    expect(medoidColor([[0, 0, 0], [255, 255, 255]])).toEqual([0, 0, 0]);
    expect(medoidColor([[255, 255, 255], [0, 0, 0]])).toEqual([255, 255, 255]);
  });
});

describe('positionOnStrip', () => {
  it('projects a click onto the strip, ignoring the component across it', () => {
    const strip = stripOf(greyRamp);
    expect(positionOnStrip(strip, { x: 0, y: 10 })).toBeCloseTo(0, 10);
    expect(positionOnStrip(strip, { x: KEY_W - 1, y: 10 })).toBeCloseTo(1, 10);
    // A tick clicked well above the bar is the same tick.
    expect(positionOnStrip(strip, { x: 100, y: -30 })).toBeCloseTo(
      positionOnStrip(strip, { x: 100, y: 10 })!,
      10
    );
  });

  it('projects onto a DIAGONAL strip, where both components matter', () => {
    // A horizontal strip hides half the arithmetic: every `dy` term is zero, so
    // a sign error in the y half of the projection is invisible. Real keys are
    // vertical as often as horizontal, and a rotated scan makes them diagonal.
    const strip: ColorBarStrip = {
      samples: [
        { t: 0, rgb: [0, 0, 0] },
        { t: 1, rgb: [255, 255, 255] },
      ],
      from: { x: 10, y: 20 },
      to: { x: 110, y: 220 },
      thickness: 1,
    };
    expect(positionOnStrip(strip, { x: 10, y: 20 })).toBeCloseTo(0, 10);
    expect(positionOnStrip(strip, { x: 110, y: 220 })).toBeCloseTo(1, 10);
    expect(positionOnStrip(strip, { x: 60, y: 120 })).toBeCloseTo(0.5, 10);
    // Off the line but on its perpendicular through the midpoint: the same
    // position. (-2, 1) is perpendicular to the strip's (100, 200).
    expect(positionOnStrip(strip, { x: 60 - 20, y: 120 + 10 })).toBeCloseTo(0.5, 10);
  });

  it('reports a click past an end as a position outside 0..1', () => {
    // Not clamped: "you clicked past the key" is information the caller needs to
    // refuse a tick, and clamping would silently turn it into a valid one.
    const strip = stripOf(greyRamp);
    expect(positionOnStrip(strip, { x: -50, y: 10 })!).toBeLessThan(0);
    expect(positionOnStrip(strip, { x: KEY_W + 50, y: 10 })!).toBeGreaterThan(1);
  });

  it('is null for a degenerate strip or a non-finite click', () => {
    const strip = stripOf(greyRamp);
    expect(positionOnStrip(strip, { x: NaN, y: 10 })).toBeNull();
    expect(positionOnStrip(strip, { x: 10, y: Infinity })).toBeNull();
    expect(
      positionOnStrip(
        { samples: strip.samples, from: { x: 5, y: 5 }, to: { x: 5, y: 5 }, thickness: 1 },
        { x: 10, y: 10 }
      )
    ).toBeNull();
  });
});

describe('invertColor', () => {
  it('recovers the position of a colour taken straight off the key', () => {
    const strip = stripOf(greyRamp);
    for (const trueT of [0, 0.25, 0.5, 0.75, 1]) {
      const reading = invertColor(strip, greyRamp(trueT))!;
      expect(reading.distance).toBeCloseTo(0, 6);
      expect(reading.t).toBeCloseTo(trueT, 2);
      expect(reading.rivals).toHaveLength(0);
    }
  });

  it('places a colour BETWEEN two sampled pixels, not at the nearest one', () => {
    // Halfway between the colours at t = 0.5 and the next pixel along. Without
    // sub-sample refinement this quantises to one of them.
    const strip = stripOf(greyRamp);
    const a = strip.samples[100]!.rgb;
    const b = strip.samples[101]!.rgb;
    const between: [number, number, number] = [
      (a[0] + b[0]) / 2,
      (a[1] + b[1]) / 2,
      (a[2] + b[2]) / 2,
    ];
    const reading = invertColor(strip, between)!;
    const tA = strip.samples[100]!.t;
    const tB = strip.samples[101]!.t;
    expect(reading.t).toBeGreaterThan(tA);
    expect(reading.t).toBeLessThan(tB);
    expect(reading.t).toBeCloseTo((tA + tB) / 2, 4);
  });

  it('reports a narrow band on a steep ramp — the key measured against itself', () => {
    const strip = stripOf(greyRamp);
    const reading = invertColor(strip, greyRamp(0.5))!;
    // Grey climbs ~2.2 RGB units per pixel, so the noise floor buys a couple of
    // pixels either side and no more.
    expect(reading.tHigh - reading.tLow).toBeLessThan(0.05);
    expect(reading.tLow).toBeLessThanOrEqual(reading.t);
    expect(reading.tHigh).toBeGreaterThanOrEqual(reading.t);
  });

  it('widens the band on a flat stretch instead of returning a confident number', () => {
    // ⚑ THE ILL-CONDITIONED CASE. 60% of this key is one colour, so a cell of
    // that colour says only "somewhere in the first 60%". A nearest-colour
    // answer would report t ~ 0.3 with nothing to say it was a guess.
    const strip = stripOf(flatThenRamp);
    const flat = invertColor(strip, [255, 0, 0])!;
    expect(flat.distance).toBeCloseTo(0, 6);
    expect(flat.tLow).toBeCloseTo(0, 2);
    expect(flat.tHigh).toBeGreaterThan(0.59);

    // The same key's well-conditioned half stays tight.
    const steep = invertColor(strip, flatThenRamp(0.8))!;
    expect(steep.tHigh - steep.tLow).toBeLessThan(0.05);
  });

  it('reports a rival position on a cyclic key rather than picking one', () => {
    // ⚑ THE AMBIGUOUS CASE, and it is not the same as an imprecise one: the two
    // candidates are far apart and both exact. Recording either as the value
    // would be a coin toss with no symptom.
    const strip = stripOf(cyclicRamp);
    const reading = invertColor(strip, cyclicRamp(0.25))!;
    expect(reading.distance).toBeCloseTo(0, 6);
    expect(reading.rivals).toHaveLength(1);
    expect(reading.t).toBeCloseTo(0.25, 2);
    expect(reading.rivals[0]!.t).toBeCloseTo(0.75, 2);
    // Both are tight bands — this is ambiguity, not imprecision.
    expect(reading.tHigh - reading.tLow).toBeLessThan(0.05);
    expect(reading.rivals[0]!.tHigh - reading.rivals[0]!.tLow).toBeLessThan(0.05);
  });

  it('says how far off the ramp a colour that is not on the key sits', () => {
    // A gridline, a printed number, a significance asterisk. Green is nowhere on
    // a grey key: the nearest point is ~189 RGB units away, and THAT is the
    // signal the caller acts on. The band widens to match — a quarter of the key
    // — so nothing here reads as a confident position either.
    const strip = stripOf(greyRamp);
    const reading = invertColor(strip, [0, 200, 0])!;
    expect(reading.distance).toBeGreaterThan(150);
    expect(reading.tHigh - reading.tLow).toBeGreaterThan(0.2);
    expect(reading.rivals).toHaveLength(0);
  });

  it('an exact match still carries the noise floor, never zero uncertainty', () => {
    const strip = stripOf(greyRamp);
    const reading = invertColor(strip, greyRamp(0.5))!;
    expect(reading.distance).toBe(0);
    expect(reading.tHigh).toBeGreaterThan(reading.tLow);
    // The band is the stretch within COLOR_NOISE_FLOOR of the queried colour:
    // grey climbs sqrt(3) * 1.275 per pixel, so that is ~2 px each way.
    const perPixel = colorDistance(strip.samples[100]!.rgb, strip.samples[101]!.rgb);
    const expected = (2 * (COLOR_NOISE_FLOOR / perPixel)) / (KEY_W - 1);
    expect(reading.tHigh - reading.tLow).toBeCloseTo(expected, 2);
  });

  it('a CONTAMINATED cell reports MORE uncertainty than a clean one, not less', () => {
    // ⚑ REGRESSION PIN. A cell tinted off the ramp (an alpha-blended border, a
    // JPEG smear, an asterisk clipping the sample) is exactly where a wrong
    // number is most likely and least visible. The first form of the band rule
    // reported it as a POINT — zero width, the most confident reading the module
    // could emit — because every sample is by definition at least `distance`
    // away from a colour that sits off the ramp.
    const strip = stripOf(greyRamp);
    const clean = invertColor(strip, greyRamp(0.5))!;
    const tinted: RGB = [
      greyRamp(0.5)[0],
      Math.min(255, greyRamp(0.5)[1] + 20),
      greyRamp(0.5)[2],
    ];
    const dirty = invertColor(strip, tinted)!;
    expect(dirty.distance).toBeGreaterThan(clean.distance);
    expect(dirty.tHigh - dirty.tLow).toBeGreaterThan(clean.tHigh - clean.tLow);
    expect(dirty.tHigh).toBeGreaterThan(dirty.tLow);
  });

  it('reads the MIDDLE of a lookup-table plateau, not its first pixel', () => {
    // ⚑ A real colormap is a 256-entry table, so a key repeats each colour over
    // a stretch of pixels. `lutRamp` exaggerates it to 25 pixels per entry, which
    // is what a large figure or a coarse key gives. Returning the first tied
    // position — what a plain argmin does — biases EVERY reading to the low end
    // of its plateau by half a plateau, in the same direction every time.
    const strip = rawStripOf(lutRamp);
    const reading = invertColor(strip, lutRamp(0.5))!;
    // The plateau holding this colour runs from t = 0.5 to t = 0.5 + 1/8.
    expect(reading.t).toBeCloseTo(0.5 + 1 / 16, 2);
    expect(reading.distance).toBe(0);
  });

  it('never claims a band narrower than one step of the key', () => {
    // ⚑ The key's own resolution is a floor on precision: two values inside one
    // table entry are printed identically. A band narrower than the step to the
    // next colour would exclude values the figure cannot distinguish, while
    // reporting distance 0.
    const strip = rawStripOf(lutRamp);
    const reading = invertColor(strip, lutRamp(0.5))!;
    // The plateau is 1/8 of the key wide; the band must reach into its
    // neighbours, so it is wider than the plateau alone.
    expect(reading.tHigh - reading.tLow).toBeGreaterThan(1 / 8);
  });

  it('interpolates INSIDE a step of the key when the colour falls between entries', () => {
    // A cell rendered by a smoother pipeline than the key, or an anti-aliased
    // one, lands between two table entries. Its position is inside that step,
    // and reporting the nearest entry instead would quantise every such reading
    // to the key's own pitch.
    const strip = rawStripOf(lutRamp);
    const boundary = strip.samples.findIndex((s) => s.rgb[0] === 144);
    const before = strip.samples[boundary - 1]!;
    const after = strip.samples[boundary]!;
    expect(before.rgb).toEqual([108, 108, 108]);
    const third = 108 + (144 - 108) / 3;
    const reading = invertColor(strip, [third, third, third])!;
    expect(reading.distance).toBeCloseTo(0, 6);
    expect(reading.t).toBeGreaterThan(before.t);
    expect(reading.t).toBeLessThan(after.t);
    expect(reading.t).toBeCloseTo(before.t + (after.t - before.t) / 3, 6);
  });

  it('interpolates into the step BELOW a plateau as readily as the one above', () => {
    // The refinement looks both ways out of a plateau. Only ever testing the
    // upper side would leave a whole branch of the key unread — and a heatmap's
    // low cells are as much data as its high ones.
    const strip = rawStripOf(lutRamp);
    const boundary = strip.samples.findIndex((s) => s.rgb[0] === 144);
    const before = strip.samples[boundary - 1]!;
    const after = strip.samples[boundary]!;
    // Two thirds of the way up the step: nearer to 144, so the plateau found is
    // the UPPER one and the refinement has to walk back down out of it.
    const twoThirds = 108 + ((144 - 108) * 2) / 3;
    const reading = invertColor(strip, [twoThirds, twoThirds, twoThirds])!;
    expect(reading.distance).toBeCloseTo(0, 6);
    expect(reading.t).toBeGreaterThan(before.t);
    expect(reading.t).toBeLessThan(after.t);
    expect(reading.t).toBeCloseTo(before.t + ((after.t - before.t) * 2) / 3, 6);
  });

  it('refines into the step below even when the plateau is the key’s FIRST entry', () => {
    // The segment on the low side of index 1 is the key's very first one, and an
    // off-by-one in the refinement's bounds skips exactly that one — leaving the
    // bottom of every key read a step coarser than the rest of it.
    const strip: ColorBarStrip = {
      samples: [
        { t: 0, rgb: [0, 0, 0] },
        { t: 0.5, rgb: [100, 100, 100] },
        { t: 1, rgb: [220, 220, 220] },
      ],
      from: { x: 0, y: 0 },
      to: { x: 100, y: 0 },
      thickness: 1,
    };
    // 70 is 70% of the way up the FIRST segment, and nearest to the sample at
    // t = 0.5 — so the plateau found is index 1 and the refinement must walk
    // back into the segment before it.
    const reading = invertColor(strip, [70, 70, 70])!;
    expect(reading.distance).toBeCloseTo(0, 6);
    expect(reading.t).toBeCloseTo(0.35, 6);
  });

  it('measures how far OFF the step a between-entries colour sits', () => {
    // Same position, but tinted away from the ramp. The along-the-key component
    // still places it; the across component is reported as distance.
    const strip = rawStripOf(lutRamp);
    const reading = invertColor(strip, [120, 108, 108])!;
    // Projecting (12,0,0) onto the step's direction (36,36,36) leaves
    // (8,-4,-4) — a distance of sqrt(96).
    expect(reading.distance).toBeCloseTo(Math.sqrt(96), 6);
  });

  it('does not slide past the end of a step when the colour lies beyond it', () => {
    // The projection is clamped: a colour brighter than the key's last entry is
    // AT the end, not past it. Built directly, because `sampleColorBar` cannot
    // produce a two-sample strip.
    const strip: ColorBarStrip = {
      samples: [
        { t: 0, rgb: [0, 0, 0] },
        { t: 1, rgb: [100, 100, 100] },
      ],
      from: { x: 0, y: 0 },
      to: { x: 100, y: 0 },
      thickness: 1,
    };
    expect(invertColor(strip, [200, 200, 200])!.t).toBe(1);
    expect(invertColor(strip, [-50, -50, -50] as unknown as RGB)!.t).toBe(0);
  });

  it('reports a POINT, not a band, when no sampled position is within tolerance', () => {
    // ⚑ A key with one tiny step and one enormous one — a discrete or badly
    // drawn scale. The colour sits exactly on the long step, so the reading is
    // exact, but no SAMPLED position is within the tolerance that the tiny local
    // step sets. Widening the band to the nearest samples would claim an extent
    // that was never measured, so the reading is reported as the point it is.
    const strip: ColorBarStrip = {
      samples: [
        { t: 0, rgb: [0, 0, 0] },
        { t: 0.5, rgb: [1, 1, 1] },
        { t: 1, rgb: [201, 201, 201] },
      ],
      from: { x: 0, y: 0 },
      to: { x: 100, y: 0 },
      thickness: 1,
    };
    const reading = invertColor(strip, [100, 100, 100])!;
    expect(reading.distance).toBeCloseTo(0, 6);
    expect(reading.tLow).toBe(reading.t);
    expect(reading.tHigh).toBe(reading.t);
    expect(reading.t).toBeGreaterThan(0.5);
    expect(reading.t).toBeLessThan(1);
    expect(reading.rivals).toHaveLength(0);
  });

  it('survives a strip that carries no second colour at all', () => {
    // `checkStripSamples` refuses this at the sampling entrance, so it can only
    // arrive from a project file — and the model's other entrance must not
    // divide by a step of zero or hand back a NaN position.
    const strip: ColorBarStrip = {
      samples: [
        { t: 0, rgb: [7, 7, 7] },
        { t: 0.5, rgb: [7, 7, 7] },
        { t: 1, rgb: [7, 7, 7] },
      ],
      from: { x: 0, y: 0 },
      to: { x: 100, y: 0 },
      thickness: 1,
    };
    const reading = invertColor(strip, [7, 7, 7])!;
    expect(Number.isFinite(reading.t)).toBe(true);
    expect(reading.t).toBeCloseTo(0.5, 6);
    expect(reading.tLow).toBe(0);
    expect(reading.tHigh).toBe(1);
  });

  it('picks the band the colour is actually in, not the first one found', () => {
    // ⚑ Three stretches of this key are consistent with a mid grey, and the
    // LAST one is the exact match. Returning whichever band came first in the
    // scan would silently swap a reading for its rival — and on a key like this
    // the swapped number is perfectly plausible, so nothing downstream could
    // catch it.
    const strip = stripOf(dipRamp);
    const reading = invertColor(strip, [101, 101, 101])!;
    expect(reading.distance).toBe(0);
    expect(reading.t).toBeCloseTo(0.9, 2);
    expect(reading.rivals).toHaveLength(2);
    expect(reading.rivals.map((r) => Math.round(r.t * 10) / 10).sort()).toEqual([0.1, 0.5]);
  });

  it('orders rivals nearest-first, which is not their order along the key', () => {
    // Reading the FIRST dip: the nearest rival is the LAST dip (101, at 0.9),
    // while the one in between (102, at 0.5) is further away in colour. Distance
    // order and position order therefore disagree, which is the only arrangement
    // that can tell a real sort from no sort at all.
    const strip = stripOf(dipRamp);
    const reading = invertColor(strip, [100, 100, 100])!;
    expect(reading.t).toBeCloseTo(0.1, 2);
    expect(reading.rivals).toHaveLength(2);
    expect(reading.rivals[0]!.t).toBeCloseTo(0.9, 2);
    expect(reading.rivals[1]!.t).toBeCloseTo(0.5, 2);
    expect(reading.rivals[0]!.distance).toBeLessThan(reading.rivals[1]!.distance);
  });

  it('reports a rival at the MIDDLE of its own plateau too', () => {
    // The lookup-table bias one level down: a rival spanning several identical
    // samples must not be reported at its first one either.
    const flatDip: RGBRamp = (u) => (u >= 0.45 && u <= 0.55 ? [101, 101, 101] : dipRamp(u));
    const strip = stripOf(flatDip);
    const reading = invertColor(strip, [100, 100, 100])!;
    const middle = reading.rivals.find((r) => r.t > 0.3 && r.t < 0.7)!;
    expect(middle).toBeDefined();
    expect(middle.t).toBeCloseTo(0.5, 2);
  });

  it('takes the key’s step from the NEARER neighbour, whichever side it is on', () => {
    // The key's resolution is measured at the position being read, and a
    // colormap's step is not symmetric around a plateau. Using only one side
    // would overstate the precision wherever that side happens to be the coarse
    // one.
    const asymmetric = (leftStep: number, rightStep: number): ColorBarStrip => ({
      samples: [
        { t: 0, rgb: [100 - leftStep, 100 - leftStep, 100 - leftStep] },
        { t: 0.5, rgb: [100, 100, 100] },
        { t: 1, rgb: [100 + rightStep, 100 + rightStep, 100 + rightStep] },
      ],
      from: { x: 0, y: 0 },
      to: { x: 100, y: 0 },
      thickness: 1,
    });
    // Coarse on the left, fine on the right, and the reverse. The band must be
    // the same either way — it follows the FINER neighbour in both.
    const fineRight = invertColor(asymmetric(40, 6), [100, 100, 100])!;
    const fineLeft = invertColor(asymmetric(6, 40), [100, 100, 100])!;
    expect(fineRight.tHigh - fineRight.tLow).toBeCloseTo(fineLeft.tHigh - fineLeft.tLow, 10);
    // And a key that is coarse on BOTH sides is read less precisely than one
    // that is fine on either.
    const coarse = invertColor(asymmetric(40, 40), [100, 100, 100])!;
    expect(coarse.tHigh - coarse.tLow).toBeGreaterThan(fineRight.tHigh - fineRight.tLow);
  });

  it('is null for a strip with fewer than two samples — the model’s other entrance', () => {
    expect(invertColor({ samples: [], from: { x: 0, y: 0 }, to: { x: 1, y: 0 }, thickness: 1 }, [0, 0, 0])).toBeNull();
    expect(
      invertColor(
        { samples: [{ t: 0, rgb: [1, 2, 3] }], from: { x: 0, y: 0 }, to: { x: 1, y: 0 }, thickness: 1 },
        [0, 0, 0]
      )
    ).toBeNull();
  });
});
