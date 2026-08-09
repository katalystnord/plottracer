import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { theme } from '../theme.js';

/**
 * WCAG 2.x contrast ratio (relative luminance formula, §1.4.3/§1.4.11).
 * Small, self-contained rather than pulling in a library: this app has no
 * other consumer for it, and the formula is short and stable.
 */
function relativeLuminance(hex: string): number {
  const v = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(b!);
}

function contrastRatio(a: string, b: string): number {
  const [l1, l2] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (l1! + 0.05) / (l2! + 0.05);
}

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
