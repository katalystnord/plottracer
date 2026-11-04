import { describe, expect, it } from 'vitest';
import { toolAfterClosingCard, DATA_EXTRACTION_MODES, type ToolMode } from '../toolMode.js';

/**
 * Closing a rail card by clicking its rail icon again (David, 2026-11-04: closing Data extraction opened the Legend
 * card, because it went back to the tool used before it). Closing a card goes back to the tool used before it only when
 * that tool has no card of its own; otherwise to Pan. Closing a card never opens another one.
 */
describe('closing a card never opens another one', () => {
  const withCards: ToolMode[] = ['legend', 'image-edit', 'error-bars', 'measure', 'calibrate', ...DATA_EXTRACTION_MODES];
  for (const before of withCards) {
    it(`given ${before} used before the card, closing the card leaves Pan picked and no card open`, () => {
      expect(toolAfterClosingCard(before)).toBe('pan');
    });
  }
  for (const before of ['pan', 'select', 'eraser'] as ToolMode[]) {
    it(`given ${before} used before the card, closing the card goes back to ${before}, which has no card`, () => {
      expect(toolAfterClosingCard(before)).toBe(before);
    });
  }
});
