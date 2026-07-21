/**
 * Pure positioning math for the floating cursor-following zoom loupe (see
 * CLAUDE.md "Product #1 — rebuild design": offset from the cursor so it
 * doesn't cover the point about to be clicked, edge-of-screen clamped,
 * modeled on Photoshop/Figma-style detail loupes rather than the fixed-
 * position zoom panels every reference tool used).
 */

export interface LoupePosition {
  left: number;
  top: number;
}

/** A rectangle (container-local coords) the loupe should not overlap — the
 * open tool card / rail (David, 2026-07-20: "overlay + dodge" — the cards keep
 * floating over the figure, but the loupe hops clear of them so it never hides
 * behind, or draws over, the card you're driving). */
export interface AvoidRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

function overlaps(
  left: number,
  top: number,
  w: number,
  h: number,
  r: AvoidRect
): boolean {
  return left < r.left + r.width && left + w > r.left && top < r.top + r.height && top + h > r.top;
}

export interface LoupeOffset {
  /** Horizontal offset from the cursor to the loupe's left edge. */
  dx: number;
  /** Vertical offset from the cursor to the loupe's *bottom* edge (negative = above the cursor). */
  dy: number;
}

export const DEFAULT_LOUPE_OFFSET: LoupeOffset = { dx: 24, dy: -24 };

/**
 * Compute the top-left position of a loupeWidth x loupeHeight panel so it
 * sits offset from (cursorX, cursorY) — by default up and to the right,
 * away from the point under the cursor — and never spills outside a
 * containerWidth x containerHeight viewport.
 */
export function positionLoupe(
  cursorX: number,
  cursorY: number,
  loupeWidth: number,
  loupeHeight: number,
  containerWidth: number,
  containerHeight: number,
  offset: LoupeOffset = DEFAULT_LOUPE_OFFSET,
  avoid?: AvoidRect | null
): LoupePosition {
  const rawLeft = cursorX + offset.dx;
  const rawTop = cursorY + offset.dy - loupeHeight;

  const maxLeft = Math.max(0, containerWidth - loupeWidth);
  const maxTop = Math.max(0, containerHeight - loupeHeight);

  const clampLeft = (l: number) => Math.min(Math.max(l, 0), maxLeft);
  const clampTop = (t: number) => Math.min(Math.max(t, 0), maxTop);

  const left = clampLeft(rawLeft);
  const top = clampTop(rawTop);

  // No card open, or the default spot is already clear -> use it unchanged.
  if (!avoid || !overlaps(left, top, loupeWidth, loupeHeight, avoid)) {
    return { left, top };
  }

  // Dodge: try to move the loupe fully clear of the card. Right of the card is
  // the natural first choice (cards are left-anchored), then below/above/left.
  // The default `top`/`left` are kept on the axis that isn't dodging so the
  // loupe stays as near the cursor as it can. Falls back to pushed-right if the
  // card is so large no candidate is fully clear (the loupe still tracks the
  // cursor's zoom -- only its panel moved).
  const gap = 12;
  const rightOfCard: LoupePosition = { left: clampLeft(avoid.left + avoid.width + gap), top };
  const candidates: LoupePosition[] = [
    rightOfCard,
    { left, top: clampTop(avoid.top + avoid.height + gap) }, // below card
    { left, top: clampTop(avoid.top - loupeHeight - gap) }, // above card
    { left: clampLeft(avoid.left - loupeWidth - gap), top }, // left of card
  ];
  for (const c of candidates) {
    if (!overlaps(c.left, c.top, loupeWidth, loupeHeight, avoid)) return c;
  }
  return rightOfCard;
}
