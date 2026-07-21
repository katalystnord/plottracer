import { describe, expect, it } from 'vitest';
import { positionLoupe } from '../loupePosition.js';

describe('positionLoupe', () => {
  it('places the loupe up and to the right of the cursor by default, away from mid-canvas', () => {
    const pos = positionLoupe(200, 200, 100, 100, 800, 600);
    // dx=24, dy=-24: left = 200+24=224, top = 200-24-100=76
    expect(pos).toEqual({ left: 224, top: 76 });
  });

  it('clamps to the right edge instead of spilling off-screen', () => {
    const pos = positionLoupe(780, 300, 100, 100, 800, 600);
    expect(pos.left).toBe(700); // 800 - 100
  });

  it('clamps to the left edge for a cursor near x=0 with a negative offset', () => {
    const pos = positionLoupe(5, 300, 100, 100, 800, 600, { dx: -24, dy: -24 });
    expect(pos.left).toBe(0);
  });

  it('clamps to the top edge instead of spilling above the container', () => {
    const pos = positionLoupe(300, 10, 100, 100, 800, 600);
    expect(pos.top).toBe(0);
  });

  it('clamps to the bottom edge for a cursor near the bottom with a positive dy', () => {
    const pos = positionLoupe(300, 590, 100, 100, 800, 600, { dx: 24, dy: 24 });
    expect(pos.top).toBe(500); // 600 - 100
  });

  it('never returns a negative position even in a container smaller than the loupe', () => {
    const pos = positionLoupe(10, 10, 100, 100, 50, 50);
    expect(pos.left).toBeGreaterThanOrEqual(0);
    expect(pos.top).toBeGreaterThanOrEqual(0);
  });
});

describe('positionLoupe — dodging an open card (David: "overlay + dodge")', () => {
  // A left-anchored card covering roughly x:[0,260], y:[80,520] of an 800x600
  // container -- the shape a Measure/Auto-extract fold-out card makes.
  const card = { left: 0, top: 80, width: 260, height: 440 };

  const intersects = (p: { left: number; top: number }, w: number, h: number, r: typeof card) =>
    p.left < r.left + r.width && p.left + w > r.left && p.top < r.top + r.height && p.top + h > r.top;

  it('leaves the default position untouched when it is already clear of the card', () => {
    // Cursor mid-canvas, well right of the card: default up-right is clear.
    const pos = positionLoupe(500, 300, 140, 140, 800, 600, undefined, card);
    expect(pos).toEqual({ left: 524, top: 136 });
  });

  it('hops the loupe to the right of the card when the default would overlap it', () => {
    // Cursor just right of the card edge, low down: default up-right lands on
    // the card; it must move fully clear.
    const pos = positionLoupe(150, 450, 140, 140, 800, 600, undefined, card);
    expect(intersects(pos, 140, 140, card)).toBe(false);
    expect(pos.left).toBeGreaterThanOrEqual(card.left + card.width);
  });

  it('still returns an in-bounds, card-clear spot when the cursor sits over the card', () => {
    const pos = positionLoupe(120, 300, 140, 140, 800, 600, undefined, card);
    expect(intersects(pos, 140, 140, card)).toBe(false);
    expect(pos.left).toBeGreaterThanOrEqual(0);
    expect(pos.left).toBeLessThanOrEqual(800 - 140);
    expect(pos.top).toBeGreaterThanOrEqual(0);
    expect(pos.top).toBeLessThanOrEqual(600 - 140);
  });

  it('falls back below the card when there is no horizontal room to its right', () => {
    // A card spanning almost the full width leaves no room on the right; the
    // loupe should drop below it (or above) rather than stay on top of it.
    const wide = { left: 0, top: 0, width: 720, height: 300 };
    const pos = positionLoupe(100, 100, 140, 140, 800, 600, undefined, wide);
    expect(intersects(pos, 140, 140, wide)).toBe(false);
  });

  it('ignores a null avoid rect (unchanged from the no-argument behaviour)', () => {
    const withNull = positionLoupe(150, 450, 140, 140, 800, 600, undefined, null);
    const without = positionLoupe(150, 450, 140, 140, 800, 600);
    expect(withNull).toEqual(without);
  });
});
