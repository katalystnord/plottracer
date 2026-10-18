/**
 * Pure positioning math for the floating cursor-following zoom loupe (see
 * CLAUDE.md "Product #1 - rebuild design": offset from the cursor so it
 * doesn't cover the point about to be clicked, edge-of-screen clamped,
 * modeled on Photoshop/Figma-style detail loupes rather than the fixed-
 * position zoom panels every reference tool used).
 */

export interface LoupePosition {
  left: number;
  top: number;
}

/** A rectangle (container-local coords) the loupe should not overlap - the
 * open tool card / rail (David, 2026-07-20: "overlay + dodge" - the cards keep
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
 * sits offset from (cursorX, cursorY) - by default up and to the right,
 * away from the point under the cursor - and never spills outside a
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
  avoid?: AvoidRect | readonly AvoidRect[] | null
): LoupePosition {
  // ⚑ More than one card can float over the canvas at once (v2.7: the calibration card along the
  // top, a tool card down the left), and the loupe must stay clear of every one of them.
  const rects: readonly AvoidRect[] = !avoid ? [] : Array.isArray(avoid) ? avoid : [avoid as AvoidRect];
  const rawLeft = cursorX + offset.dx;
  const rawTop = cursorY + offset.dy - loupeHeight;

  const maxLeft = Math.max(0, containerWidth - loupeWidth);
  const maxTop = Math.max(0, containerHeight - loupeHeight);

  const clampLeft = (l: number) => Math.min(Math.max(l, 0), maxLeft);
  const clampTop = (t: number) => Math.min(Math.max(t, 0), maxTop);

  const left = clampLeft(rawLeft);
  const top = clampTop(rawTop);

  const clear = (c: LoupePosition) => rects.every((r) => !overlaps(c.left, c.top, loupeWidth, loupeHeight, r));
  // No card open, or the default spot is already clear -> use it unchanged.
  if (clear({ left, top })) {
    return { left, top };
  }

  // Dodge: try to move the loupe fully clear of the card. Right of the card is
  // the natural first choice (cards are left-anchored), then below/above/left.
  // The default `top`/`left` are kept on the axis that isn't dodging so the
  // loupe stays as near the cursor as it can. Falls back to pushed-right if the
  // card is so large no candidate is fully clear (the loupe still tracks the
  // cursor's zoom -- only its panel moved).
  const gap = 12;
  const around = (r: AvoidRect): LoupePosition[] => [
    { left: clampLeft(r.left + r.width + gap), top }, // right of the card
    { left, top: clampTop(r.top + r.height + gap) }, // below card
    { left, top: clampTop(r.top - loupeHeight - gap) }, // above card
    { left: clampLeft(r.left - loupeWidth - gap), top }, // left of card
  ];
  // the cards the default spot runs into first, then the others, so a single card dodges as before
  const hit = rects.filter((r) => overlaps(left, top, loupeWidth, loupeHeight, r));
  const order = [...hit, ...rects.filter((r) => !hit.includes(r))];
  for (const r of order) {
    for (const c of around(r)) {
      if (clear(c)) return c;
    }
  }
  return around(hit[0]!)[0]!;
}
