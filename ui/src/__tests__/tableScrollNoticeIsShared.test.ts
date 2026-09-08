/**
 * ⚑⚑ ONE MECHANISM SAYS "THERE IS MORE TO THE RIGHT", AND BOTH TABLES USE IT.
 *
 * David, on a candlestick whose four value columns ran off the panel: *"The
 * output window needs to be wider to see it all here. Should we have scroll bar
 * down the bottom to alert the user that there is more to the right?"*
 *
 * ⚠️ THERE ALREADY WAS A SCROLLBAR, and that is the defect. `Workspace.tsx`
 * scrolls the WHOLE right-hand panel, so the bar sat pinned to the bottom of the
 * window, nowhere near the column that was cut off.
 *
 * ⚠️⚠️ AND THERE ALREADY WAS A CUE - `ScrollNoticer`, written for the SAME
 * complaint on the heatmap (B17) and left private inside `HeatmapCellsTable`.
 * The first pass at this fix wrapped `BarTable` in a bare `overflowX: auto` div
 * and would have shipped a second, quieter answer to a question the project had
 * already answered. That is the reuse rule's exact failure mode, so this test
 * guards the SHARING, not the styling.
 *
 * ⚑ WHAT IT DOES NOT PROVE: that the notice appears at the right width. The
 * decision is `scrollWidth > clientWidth` in a live layout, and this repo has no
 * component-DOM instrument - it is asserted here as source structure, and only
 * David's hands on the built app can say it fires when it should.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const SHARED = readFileSync('ui/src/panels/ScrollNoticer.tsx', 'utf8');
const CALLERS = {
  BarTable: readFileSync('ui/src/panels/BarTable.tsx', 'utf8'),
  HeatmapCellsTable: readFileSync('ui/src/panels/HeatmapCellsTable.tsx', 'utf8'),
};

describe('the clipped-record cue is one shared mechanism', () => {
  it('measures the clipping rather than guessing it from the column count', () => {
    // Five narrow columns fit; three wide ones may not. Only the layout knows.
    expect(SHARED).toContain('scrollWidth > el.clientWidth');
    expect(SHARED).toContain('ResizeObserver');
  });

  it('⚑ both tables render the shared noticer', () => {
    for (const [name, src] of Object.entries(CALLERS)) {
      expect(src, `${name} imports it`).toContain("from './ScrollNoticer.js'");
      expect(src, `${name} renders it`).toContain('<ScrollNoticer');
    }
  });

  it('⚑ neither table rolls its own scroll container beside it', () => {
    for (const [name, src] of Object.entries(CALLERS)) {
      expect(src, `${name} declares no overflow of its own`).not.toMatch(/overflow[XY]?:\s*'(auto|scroll)'/);
    }
  });

  it('⚑ the bar family scrolls SIDEWAYS only, so it cannot trap the wheel', () => {
    // The right-hand panel already scrolls vertically. A second vertical
    // scroller nested inside it swallows the wheel over the table.
    const open = CALLERS.BarTable.slice(
      CALLERS.BarTable.indexOf('<ScrollNoticer'),
      CALLERS.BarTable.indexOf('<ScrollNoticer') + 120
    );
    expect(open).not.toContain('maxHeight');
    expect(SHARED).toContain("maxHeight === undefined ? { overflowX: 'auto' }");
  });

  it('⚑ shows nothing when the table fits - `auto`, never `scroll`', () => {
    expect(SHARED).not.toContain("'scroll'");
  });
});
