/**
 * ⚑⚑ DIRECTION FROM THE FIGURE'S COLOUR - the bit the geometry cannot supply.
 *
 * David: *"Is it not dependant on the color?"* The two body edges are the same
 * rectangle either way round, so colour is the only signal there is.
 */
import { describe, expect, it } from 'vitest';
import {
  candleDirections,
  clusterCandleBodies,
  risingAppearance,
  sampleBackground,
  sampleCandleBody,
} from '../candleDirection.js';
import type { RGB } from '../../algorithms/colorFilter.js';

const GREEN: RGB = [0, 128, 0];
const RED: RGB = [214, 39, 40];
const WHITE: RGB = [255, 255, 255];
const BLACK: RGB = [0, 0, 0];

describe('splitting a figure into its two candle appearances', () => {
  it('groups green bodies apart from red ones', () => {
    const { group, centres } = clusterCandleBodies([GREEN, RED, GREEN, RED, RED]);
    expect(centres).not.toBeNull();
    // Same appearance, same group - whichever index the seeding happened to give.
    expect(group[0]).toBe(group[2]);
    expect(group[1]).toBe(group[3]);
    expect(group[1]).toBe(group[4]);
    expect(group[0]).not.toBe(group[1]);
  });

  it('⚑ finds ONE appearance on a figure whose periods all rose', () => {
    // ⚠️ A real figure, and the case that must not be forced into two groups:
    // saying "two" here would invent a distinction the figure never drew.
    const { group, centres } = clusterCandleBodies([GREEN, GREEN, GREEN]);
    expect(centres).toBeNull();
    expect(group).toEqual([0, 0, 0]);
  });

  it('treats anti-aliased near-copies as one appearance, not two', () => {
    const { centres } = clusterCandleBodies([GREEN, [2, 130, 3], [0, 126, 1]]);
    expect(centres).toBeNull();
  });
});

describe('which appearance rises', () => {
  it('reads green as rising against red', () => {
    expect(risingAppearance([GREEN, RED], WHITE)).toBe(0);
    expect(risingAppearance([RED, GREEN], WHITE)).toBe(1);
  });

  it('⚑⚑ reads HOLLOW as rising in the print convention, where both are dark', () => {
    // Investopedia's own diagram: an unfilled body on white paper rises, a
    // filled one falls. Hue cannot separate these - both are black ink.
    expect(risingAppearance([WHITE, BLACK], WHITE)).toBe(0);
    expect(risingAppearance([BLACK, WHITE], WHITE)).toBe(1);
  });

  it('⚑ measures "hollow" against the FIGURE\'s background, not against white', () => {
    // A dark-ground chart: the hollow body is BLACK because the paper is. Judged
    // against a hardcoded white this reads as two filled bodies and falls to
    // hue, which calls the green one rising - the wrong answer for a figure
    // drawing the print convention on a dark ground.
    expect(risingAppearance([BLACK, GREEN], BLACK)).toBe(0);
  });
});

describe('the whole answer, per candle', () => {
  it('reports each candle against the figure it was measured in', () => {
    expect(candleDirections([GREEN, RED, RED, GREEN], WHITE)).toEqual([true, false, false, true]);
  });

  it('⚑ lets the user flip a figure whose convention we read backwards', () => {
    expect(candleDirections([GREEN, RED], WHITE, true)).toEqual([false, true]);
  });

  it('calls every candle rising on a single-appearance figure', () => {
    expect(candleDirections([GREEN, GREEN], WHITE)).toEqual([true, true]);
  });
});

/** A tiny figure: white paper, one green body from y=10..30 centred on x=20. */
function figure(body: RGB, background: RGB = WHITE) {
  const width = 40;
  const height = 40;
  const src = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    src[i * 4] = background[0];
    src[i * 4 + 1] = background[1];
    src[i * 4 + 2] = background[2];
    src[i * 4 + 3] = 255;
  }
  for (let y = 10; y <= 30; y++) {
    for (let x = 14; x <= 26; x++) {
      const i = (y * width + x) * 4;
      src[i] = body[0];
      src[i + 1] = body[1];
      src[i + 2] = body[2];
    }
  }
  return { src, width, height };
}

describe('sampling a candle off the figure', () => {
  it('reads the body colour from inside the body', () => {
    const { src, width, height } = figure(GREEN);
    const rgb = sampleCandleBody(src, width, height, { x: 20, y: 30 }, { x: 20, y: 10 }, 12);
    expect(rgb).toEqual(GREEN);
  });

  it('⚑ does not read the border, which is neither the body nor the paper', () => {
    // A one-pixel dark outline round the body, as most figures draw. Sampling
    // the edge would return the outline or an anti-aliased blend of both.
    const { src, width, height } = figure(GREEN);
    for (let x = 14; x <= 26; x++) {
      for (const y of [10, 30]) {
        const i = (y * width + x) * 4;
        src[i] = 0;
        src[i + 1] = 0;
        src[i + 2] = 0;
      }
    }
    expect(sampleCandleBody(src, width, height, { x: 20, y: 30 }, { x: 20, y: 10 }, 12)).toEqual(GREEN);
  });

  it('⚑ still reads a doji, off the line the figure draws where the body would be', () => {
    // Open equal to close: no body height, but the figure draws a coloured line
    // there. The reading is real; the DIRECTION is immaterial by definition.
    const { src, width, height } = figure(GREEN);
    expect(sampleCandleBody(src, width, height, { x: 20, y: 20 }, { x: 20, y: 20 }, 12)).toEqual(GREEN);
  });

  it('reads nothing off a box that is not on the image', () => {
    const { src, width, height } = figure(GREEN);
    expect(sampleCandleBody(src, width, height, { x: 500, y: 30 }, { x: 500, y: 10 }, 12)).toBeNull();
  });

  it('⚑ measures the paper rather than assuming it is white', () => {
    const dark = figure(GREEN, BLACK);
    expect(sampleBackground(dark.src, dark.width, dark.height)).toEqual(BLACK);
    const light = figure(GREEN);
    expect(sampleBackground(light.src, light.width, light.height)).toEqual(WHITE);
  });
});
