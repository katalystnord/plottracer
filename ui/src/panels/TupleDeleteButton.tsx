import { theme } from '../theme.js';

/** The per-row delete control on the grouped-type tables (checkpoint 129) --
 * removes a whole Box Plot box / Histogram bin. Kept as a small component so the
 * histogram and box-plot tables share one styling/labelling; the noun (box/bin)
 * comes from the config's tupleNoun, so the title reads "Delete bin 3" on a
 * histogram and "Delete box 3" on a box plot. */
export function TupleDeleteButton({
  tupleIndex,
  noun,
  onDelete,
}: {
  tupleIndex: number;
  noun: string;
  onDelete: (tupleIndex: number) => void;
}) {
  return (
    <button
      type="button"
      data-testid={`tuple-remove-${tupleIndex}`}
      title={`Delete ${noun} ${tupleIndex + 1}`}
      aria-label={`Delete ${noun} ${tupleIndex + 1}`}
      onClick={(e) => {
        // ⚑ THE ROW AROUND THIS BUTTON NOW SELECTS (v2.3 re-audit, F30), so a
        // press that reached it would delete the tuple AND select a row - and
        // the indices have just shifted, so the selection would land on a
        // DIFFERENT tuple than the one the user was looking at. The value and
        // name cells beside it have stopped the same press since A3; this is
        // the third control in the row and it had been the only one that did
        // not need to.
        e.stopPropagation();
        onDelete(tupleIndex);
      }}
      style={{
        fontSize: theme.font.size.small,
        lineHeight: 1,
        padding: '2px 6px',
        cursor: 'pointer',
        color: theme.color.text.legend,
        background: 'none',
        border: 'none',
      }}
    >
      ✕
    </button>
  );
}
