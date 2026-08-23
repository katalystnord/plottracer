import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  DEFAULT_PANEL_WIDTH,
  MAX_PANEL_WIDTH,
  MIN_PANEL_WIDTH,
  clampPanelWidth,
  defaultPanelWidthFor,
  readPanelWidth,
  readStoredPanelWidth,
  writePanelWidth,
} from '../panelWidth.js';

/**
 * The data panel's remembered width.
 *
 * ⚑ Small, but it is a STORE with three ways to be wrong - a missing entry, a
 * corrupt one, and one outside the range the drag handle allows - and none of
 * them is reachable from the e2e, which only ever drags the real handle.
 */

const KEY = 'plottracer.panel.width';

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  });
  return map;
}

describe('the data panel remembers its width', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('falls back to the default when nothing has been chosen', () => {
    fakeStorage();
    expect(readPanelWidth()).toBe(DEFAULT_PANEL_WIDTH);
  });

  it('reads back the width the user dragged to', () => {
    const map = fakeStorage();
    writePanelWidth(512);
    expect(map.get(KEY)).toBe('512');
    expect(readPanelWidth()).toBe(512);
  });

  it('⚑ CLAMPS ON THE WAY IN AND OUT - the store is another entrance to the model', () => {
    // The drag handle already refuses anything outside this range. A stored
    // value is a SECOND entrance, and a hand-edited entry must not be able to
    // smuggle a width past the limit the gesture enforces.
    fakeStorage({ [KEY]: '99999' });
    expect(readPanelWidth()).toBe(MAX_PANEL_WIDTH);
    fakeStorage({ [KEY]: '10' });
    expect(readPanelWidth()).toBe(MIN_PANEL_WIDTH);
    const map = fakeStorage();
    writePanelWidth(-40);
    expect(map.get(KEY)).toBe(String(MIN_PANEL_WIDTH));
  });

  it('falls back rather than throwing on a corrupt entry', () => {
    fakeStorage({ [KEY]: 'wide please' });
    expect(readPanelWidth()).toBe(DEFAULT_PANEL_WIDTH);
    expect(clampPanelWidth(Number.NaN)).toBe(DEFAULT_PANEL_WIDTH);
  });

  it('survives storage being unavailable, because private mode is not an error', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
    });
    expect(readPanelWidth()).toBe(DEFAULT_PANEL_WIDTH);
    expect(() => writePanelWidth(400)).not.toThrow();
  });

  it('⚑ the default is inside the range the handle allows', () => {
    // Asserted rather than assumed: a default outside the clamp would be
    // silently corrected on the first read, so the app would start at one width
    // and remember another.
    expect(DEFAULT_PANEL_WIDTH).toBeGreaterThanOrEqual(MIN_PANEL_WIDTH);
    expect(DEFAULT_PANEL_WIDTH).toBeLessThanOrEqual(MAX_PANEL_WIDTH);
    expect(clampPanelWidth(DEFAULT_PANEL_WIDTH)).toBe(DEFAULT_PANEL_WIDTH);
  });
});

/**
 * ⚑⚑ A DEFAULT PER GRAPH TYPE (B5). One number was serving a two-column
 * spreadsheet and a matrix, and this file's own comment admitted it was a
 * compromise: *"a 5-column heatmap matrix needs about 530 px."*
 *
 * David, 2026-08-21: *"We have already talked about making the default size a
 * bit bigger for some types of graphs. Lets do that."*
 */
describe('a type opens at a width that suits its table', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('⚑ a heatmap opens wide enough for its matrix', () => {
    // 530 is this file's own measured figure for a 5-column matrix read
    // without scrolling - not a number picked to look generous.
    expect(defaultPanelWidthFor('heatmap')).toBe(530);
  });

  it('⚑ the panels that grow a COLUMN PER SERIES open wider than the rest', () => {
    // Bar and Spider render a matrix, so their width tracks the series count,
    // and multi-series is the ordinary case: 65% of the ICPR/PMC corpus's 280
    // vertical bar charts carry more than one series.
    expect(defaultPanelWidthFor('bar')).toBe(480);
    expect(defaultPanelWidthFor('spider')).toBe(480);
  });

  it('⚑ everything else keeps the width that was chosen for it', () => {
    expect(defaultPanelWidthFor(undefined)).toBe(DEFAULT_PANEL_WIDTH);
    expect(defaultPanelWidthFor('bins')).toBe(DEFAULT_PANEL_WIDTH);
  });

  it('⚑⚑ a width the user DRAGGED beats the type default, on every type', () => {
    // The whole reason the rail remembers. Widening it under someone who has
    // already answered would be the app overruling a gesture it can see.
    fakeStorage();
    writePanelWidth(300);
    expect(readPanelWidth('heatmap')).toBe(300);
    expect(readPanelWidth('bar')).toBe(300);
  });

  it('⚑⚑ NULL and 420 are different facts, which is why the reader can say null', () => {
    // A function that answers "the user picked 420" and "nobody has picked
    // anything" with the same number cannot tell the rail which it is holding -
    // and only one of the two may follow the graph type.
    fakeStorage();
    expect(readStoredPanelWidth()).toBeNull();
    writePanelWidth(DEFAULT_PANEL_WIDTH);
    expect(readStoredPanelWidth()).toBe(DEFAULT_PANEL_WIDTH);
  });

  it('⚑ a corrupt entry reads as unchosen, so the type default still applies', () => {
    fakeStorage({ [KEY]: 'not-a-width' });
    expect(readStoredPanelWidth()).toBeNull();
    expect(readPanelWidth('heatmap')).toBe(530);
  });
});
