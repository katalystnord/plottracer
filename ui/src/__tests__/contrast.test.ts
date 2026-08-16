import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { theme } from '../theme.js';
// ⚑ The formula used to live in this file. It moved to `../contrast.js` when
// the heatmap matrix needed it at RUNTIME (a cell's fill is not known in
// advance), and the test imports it rather than keeping a second copy — the
// theme's tokens and the matrix's cells are now held to one implementation.
import { INK_DARK, INK_LIGHT, contrastRatio, textOn } from '../contrast.js';

/**
 * v2.0 pre-launch audit: two real WCAG contrast failures, plus the shared
 * token behind one of them. `text.legend` is load-bearing text throughout
 * the app (field labels, hints, the tuple/bin row delete button, calibration
 * point counters) -- checked against every background it's actually
 * rendered on -- and the Trace Challenge button's own colour pair.
 */
describe('WCAG AA contrast (4.5:1 for normal text, 3:1 for large/UI components)', () => {
  it('text.legend clears 4.5:1 against every background it is actually used on', () => {
    for (const bg of [theme.color.background.primary, theme.color.background.panel, theme.color.background.canvas]) {
      expect(contrastRatio(theme.color.text.legend, bg)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('text.legend still reads visibly LIGHTER than text.secondary -- the fix keeps the three-tier hierarchy, not just the number', () => {
    const white = theme.color.background.primary;
    expect(contrastRatio(theme.color.text.legend, white)).toBeLessThan(contrastRatio(theme.color.text.secondary, white));
  });

  it('the Trace Challenge button (dark text on the clicked-teal background) clears 4.5:1', () => {
    // White text on this background was ~2.46:1 -- failed AA outright.
    expect(contrastRatio(theme.color.text.primary, theme.color.primary.clicked)).toBeGreaterThanOrEqual(4.5);
  });

  it('the challenge-start button actually uses text.primary, not background.primary (white)', () => {
    // The two tests above only check the THEME MATH -- they'd pass even if the
    // button were still wired to white text on this same background. Read the
    // real source to confirm the wiring itself changed, not just that a
    // hypothetical dark-on-teal pair would have been fine.
    // ⚑ v2.1: the button moved to panels/HelpMenu.tsx with the Help card, and
    // this test caught the move -- but only because of the two POSITIVE
    // assertions. Pointed at a file without the markup, `indexOf` returns -1
    // twice and `slice(-1, -1)` is the empty string: the `toContain` pair fails
    // loudly, while the `not.toContain` below passes vacuously. A version of
    // this test written only in the negative would have gone silent the moment
    // the button moved, and reported nothing ever since.
    const workspacePath = fileURLToPath(new URL('../panels/HelpMenu.tsx', import.meta.url));
    const source = readFileSync(workspacePath, 'utf8');
    const buttonBlock = source.slice(
      source.indexOf('data-testid="challenge-start"'),
      source.indexOf('🎯 Take The Trace Challenge')
    );
    expect(buttonBlock).toContain('background: theme.color.primary.clicked');
    expect(buttonBlock).toContain('color: theme.color.text.primary');
    expect(buttonBlock).not.toContain('color: theme.color.background.primary');
  });

  it('confirms the ORIGINAL defect would have failed, so this test could not pass vacuously', () => {
    expect(contrastRatio('#aeaeae', theme.color.background.primary)).toBeLessThan(4.5);
    expect(contrastRatio(theme.color.background.primary, theme.color.primary.clicked)).toBeLessThan(4.5);
  });
});

/**
 * ⚑⚑ THE HEATMAP MATRIX PAINTS ITS OWN BACKGROUNDS, so its text colour cannot
 * be a token — it is decided per cell, from the fill the cell's VALUE earned.
 * This is the half of B16 that was recorded and never built, and its absence is
 * why the tint was weakened to a pale wash that no longer matched the figure.
 */
describe('textOn — which ink is legible on a cell painted by its own value', () => {
  it('prints WHITE on a dark fill and BLACK on a light one', () => {
    // viridis's two ends, which is the case David actually reported: its
    // darkest purple washed out to a pale lavender rather than let white text in.
    expect(textOn([68, 1, 84])).toBe(INK_LIGHT);
    expect(textOn([253, 231, 37])).toBe(INK_DARK);
    expect(textOn([255, 255, 255])).toBe(INK_DARK);
    expect(textOn([0, 0, 0])).toBe(INK_LIGHT);
  });

  it('clears the WCAG AA floor on EVERY colour, which is what makes a full-strength tint safe', () => {
    // ⚑ The property that matters is not "it picks sensibly" but "there is no
    // fill on which the number becomes unreadable" — otherwise raising the tint
    // trades a colour defect for a legibility one, which is the exact swap that
    // produced the wash in the first place.
    // ⚠️ A colour ramp is a 1-D path through this cube, so sweeping the ramp
    // would test only the colours one colormap happens to use. The whole cube
    // is what a real key can contain.
    let worst = { ratio: 21, rgb: [0, 0, 0] as readonly [number, number, number] };
    for (let r = 0; r <= 255; r += 15) {
      for (let g = 0; g <= 255; g += 15) {
        for (let b = 0; b <= 255; b += 15) {
          const rgb = [r, g, b] as const;
          const ratio = contrastRatio(rgb, textOn(rgb));
          if (ratio < worst.ratio) worst = { ratio, rgb };
        }
      }
    }
    expect(worst.ratio).toBeGreaterThanOrEqual(4.5);
  });

  it('agrees with contrastRatio rather than deciding by a threshold of its own', () => {
    // Two mechanisms that must agree is the shape this project keeps getting
    // bitten by. `textOn` is defined AS the better ratio, and that is asserted
    // rather than restated.
    for (const rgb of [[68, 1, 84], [120, 120, 120], [253, 231, 37], [200, 30, 90]] as const) {
      const picked = textOn(rgb);
      const other = picked === INK_DARK ? INK_LIGHT : INK_DARK;
      expect(contrastRatio(rgb, picked)).toBeGreaterThanOrEqual(contrastRatio(rgb, other));
    }
  });

  it('reads a hex string and a triple as the same colour', () => {
    expect(contrastRatio('#440154', INK_LIGHT)).toBeCloseTo(contrastRatio([68, 1, 84], INK_LIGHT), 10);
    // Short form too, since theme tokens are written both ways.
    expect(contrastRatio('#fff', INK_DARK)).toBeCloseTo(contrastRatio([255, 255, 255], INK_DARK), 10);
  });
});
