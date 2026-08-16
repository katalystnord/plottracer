/**
 * WCAG 2.x contrast, and the one decision it is used to make.
 *
 * ⚑ WHY IT IS A MODULE NOW. The formula lived in `__tests__/contrast.test.ts`,
 * where it guarded the theme's fixed tokens. The heatmap matrix needs the same
 * arithmetic at RUNTIME — a cell is painted in whatever colour its value is
 * worth, so which of black or white is legible on it cannot be decided in
 * advance. Copying the formula into the component would have left two of them
 * to disagree; the test now imports this one, so the tokens and the cells are
 * held to a single implementation of a single standard.
 *
 * ⚑ Small and self-contained rather than a library: the formula is short,
 * stable, and this app has no other consumer for it.
 */

/** WCAG relative luminance (§1.4.3). */
export function relativeLuminance(rgb: readonly [number, number, number]): number {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
}

/** `#rgb` / `#rrggbb` to a triple. Returns black for anything unparseable,
 * which is the safe end: it can only make a contrast check stricter. */
export function parseHex(hex: string): [number, number, number] {
  const v = hex.replace('#', '').trim();
  const full = v.length === 3 ? v.split('').map((c) => c + c).join('') : v;
  if (full.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(full)) return [0, 0, 0];
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

/** Contrast ratio between two colours, 1 (identical) to 21 (black on white). */
export function contrastRatio(
  a: string | readonly [number, number, number],
  b: string | readonly [number, number, number]
): number {
  const lum = (c: string | readonly [number, number, number]) =>
    relativeLuminance(typeof c === 'string' ? parseHex(c) : c);
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1! + 0.05) / (l2! + 0.05);
}

/** Black. Kept as named constants so `textOn`'s two answers are the two things
 * the caller may render, not two string literals to keep in step. */
export const INK_DARK = '#000000';
export const INK_LIGHT = '#ffffff';

/**
 * Which ink to print on a given background — the better-contrasting of black
 * and white.
 *
 * ⚑⚑ THIS IS WHAT LETS THE MATRIX MIRROR THE FIGURE AT ALL. The tint used to be
 * weakened to `alpha 0.35` over white, justified in its own comment as *"so the
 * numbers stay black and legible on a dark palette"* — a workaround that made
 * viridis's darkest purple render as a pale lavender, so the table and the
 * figure were visibly different colours. B16 had already recorded the real
 * answer (*"cell text contrast must follow the fill, or half the matrix is
 * unreadable on a dark palette"*) and it was never built. David settled it,
 * 2026-08-15: *"we can have white text when needed too."*
 *
 * ⚠️ ORDER MATTERS where this is used: pick the text colour FIRST, then raise
 * the tint. Raising the tint alone is what makes half the matrix unreadable,
 * which is exactly why it was weakened in the first place.
 *
 * ⚑ There is no threshold to invent. Whichever ink has the higher ratio wins,
 * and on any background one of them clears the 4.5:1 floor — the worst case is
 * a mid-grey, where both sit near 5:1.
 */
export function textOn(background: readonly [number, number, number]): string {
  return contrastRatio(background, INK_DARK) >= contrastRatio(background, INK_LIGHT)
    ? INK_DARK
    : INK_LIGHT;
}
