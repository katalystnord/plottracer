import { describe, expect, it } from 'vitest';
import { HEATMAP_AXES_CONFIG } from '../calibrationSession.js';

/**
 * ⚑⚑ SHORT LABELS, LONG PROMPTS - the config's own header states the rule:
 * *"they are two different jobs at two different sites. The LABEL is drawn on
 * the canvas beside its marker; the PROMPT is a line of text on the calibration
 * card."*
 *
 * ⚠️ AND THE CODE THREW THE LABEL AWAY. `5379aa0` shortened these to `C1 × R1`
 * after David's screenshot of the built app showed the long form running across
 * the plot, colliding with the figure, the top-left one clipped behind the
 * calibration card and the bottom-right reading `Last column × fi…`. The static
 * steps carry the short labels; `stepsForOptions` then rebuilt a long one and
 * overwrote them, so the fix never reached the screen. Caught by David again on
 * 2026-08-20, on the same corner, reading `First column × last row=6`.
 *
 * ⚑ `C1`/`R1` rather than `X1`/`Y1` because they MIRROR the results matrix,
 * whose headers are literally `C1` and `R1`. The mark on the figure and the
 * header in the table say the same word for the same band.
 */
const stepsWith = (options: Record<string, string> = {}) =>
  HEATMAP_AXES_CONFIG.stepsForOptions!(HEATMAP_AXES_CONFIG.fixedSteps, options);

const labelOf = (key: string, options: Record<string, string> = {}) =>
  stepsWith(options).find((s) => s.key === key)!.label;

describe('a heatmap calibration handle is labelled SHORT', () => {
  it('⚑⚑ the four corners keep the short form the canvas was fixed to use', () => {
    expect(labelOf('x1')).toBe('C1 × R1');
    expect(labelOf('x2')).toBe('Cn × R1');
    expect(labelOf('y1')).toBe('C1 × R1 (Y)');
    expect(labelOf('y2')).toBe('C1 × Rn');
  });

  it('⚑ and stay short when an axis is a CATEGORY - the option must not restore the long form', () => {
    const cases: Record<string, string>[] = [
      { xIsCategory: 'true' },
      { yIsCategory: 'true' },
      { xIsCategory: 'true', yIsCategory: 'true' },
    ];
    for (const opts of cases) {
      expect(labelOf('x1', opts)).toBe('C1 × R1');
      expect(labelOf('y2', opts)).toBe('C1 × Rn');
    }
  });

  it('⚑ the PROMPT keeps the long form - it is the other job, and it needs the words', () => {
    // The prompt is a sentence on the card with room for it, and it has to name
    // BOTH bands: a click on a matrix is located by both axes.
    const prompt = stepsWith().find((s) => s.key === 'x2')!.prompt;
    expect(prompt).toMatch(/column/i);
    expect(prompt).toMatch(/row/i);
  });
});
