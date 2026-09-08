import { useEffect, useRef, useState, type ReactNode } from 'react';
import { theme } from '../theme.js';

/**
 * A container that SAYS when it is hiding something sideways (B17).
 *
 * ⚑ David, photographing the tint: the matrix scrolled horizontally with a
 * fifth column off-screen in a narrow sidebar, and nothing said so. A table
 * that silently ends mid-record is worse than a narrow one - the columns you
 * cannot see look like columns that do not exist, and this panel IS the record.
 *
 * ⚑ MEASURED, not assumed. Whether it overflows depends on the sidebar's width,
 * the number of columns and the font, none of which this component gets to know
 * - so it reads `scrollWidth` against `clientWidth` and re-reads on resize.
 * Guessing from the column count would be wrong at both ends: five narrow
 * columns fit, three wide ones may not.
 *
 * ⚑⚑ IT LIVES HERE BECAUSE THE BAR FAMILY ASKED THE SAME QUESTION AGAIN.
 * David, on a candlestick whose four value columns ran off the panel: *"Should
 * we have scroll bar down the bottom to alert the user that there is more to
 * the right?"* That is this component, already written for the heatmap and
 * sitting private inside `HeatmapCellsTable`. Two tables that clip a record
 * must say so the SAME way, or the user learns two things that mean one.
 *
 * ⚑ `maxHeight` is the one knob, and it is what separates the two callers. The
 * matrix caps its height and scrolls both ways; the bar family's table is the
 * panel's main content, and a second VERTICAL scroller nested in a panel that
 * already scrolls swallows the wheel. Omit it and the container clips sideways
 * only.
 */
export function ScrollNoticer({
  children,
  maxHeight,
  testId = 'table-scroll-notice',
}: {
  children: ReactNode;
  maxHeight?: number;
  testId?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [clipped, setClipped] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setClipped(el.scrollWidth > el.clientWidth + 1);
    measure();
    // ⚑ ResizeObserver rather than a window listener: the sidebar can change
    // width without the window doing so (a fold-out opening beside it), and
    // that is exactly when a matrix starts and stops overflowing.
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [children]);
  return (
    <>
      <div
        ref={ref}
        style={maxHeight === undefined ? { overflowX: 'auto' } : { maxHeight, overflow: 'auto' }}
      >
        {children}
      </div>
      {clipped && (
        <p
          data-testid={testId}
          style={{ margin: '2px 0 0', color: theme.color.text.legend, fontSize: theme.font.size.small }}
        >
          More columns to the right - scroll sideways.
        </p>
      )}
    </>
  );
}
