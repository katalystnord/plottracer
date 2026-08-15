import { theme } from '../theme.js';

/**
 * Click-to-edit table cells — the typed twin of dragging a marker.
 *
 * ⚑ NOT a permanent boxed field (David, 2026-07-27, re Spider): *"now a user
 * thinks he HAS to add something"*. Everything here is optional — an axis or
 * category the figure prints illegibly is still real — so at rest a cell looks
 * like the rest of the table, and an unnamed one reads as a dash exactly like a
 * value nobody recorded. The dashed underline is the whole affordance.
 *
 * ⚑ ONE component per kind, not one per CALL SITE. `EditableValue` serves both
 * the XY table and the spider table, which had hand-rolled the same input/span
 * pair with different testid prefixes and widths; `EditableName` serves all
 * three name columns (Spider's axis, Bar's category, Pie/Box Plot's tuple
 * label). David, 2026-07-30, on the name trio: *"a lot of ... duplicate or near
 * duplicate code for things that should really be almost the same code."* The
 * value pair was the same shape and is folded in here for the same reason.
 */

export interface EditableValueProps {
  editing: boolean;
  /** The text in the box while editing. */
  editValue: string;
  /** The formatted value shown at rest. */
  display: string;
  /** Test id for the input, and for the span at rest. */
  testIdEdit: string;
  testIdValue: string;
  title: string;
  width: number;
  align?: 'right';
  /** Open the editor, seeded by the caller (it decides the seed's precision). */
  onStartEdit: () => void;
  onChange: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}

export function EditableValue({
  editing,
  editValue,
  display,
  testIdEdit,
  testIdValue,
  title,
  width,
  align,
  onStartEdit,
  onChange,
  onCommit,
  onCancel,
}: EditableValueProps) {
  if (editing) {
    return (
      <input
        data-testid={testIdEdit}
        autoFocus
        value={editValue}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onCommit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onCommit();
          else if (e.key === 'Escape') onCancel();
        }}
        // The cell around this one SELECTS its row — the same rule `EditableName`
        // below has always followed. Without it, clicking into the box you are
        // already typing in re-fires that selection and toggles it back OFF,
        // taking the canvas highlight with it mid-edit.
        onClick={(e) => e.stopPropagation()}
        style={align ? { width, textAlign: align } : { width }}
      />
    );
  }
  return (
    <span
      data-testid={testIdValue}
      onClick={onStartEdit}
      title={title}
      style={{ cursor: 'text', borderBottom: `1px dashed ${theme.color.border.hover}` }}
    >
      {display}
    </span>
  );
}

export interface EditableNameProps {
  editing: boolean;
  /** The name as stored — empty means unnamed, and shows a dash. */
  name: string;
  /**
   * What to show at rest when the name is empty, instead of the dash.
   *
   * ⚑ A dash is right where something ELSE in the row identifies it — a bar's
   * value, a spider axis's reading. It is wrong where the name is the row's ONLY
   * identifier: a heatmap's category column rendered five dashes and the rows
   * became indistinguishable, so the table stopped saying which cell was which.
   * Callers in that position pass the ordinal the record actually holds.
   */
  emptyDisplay?: string;
  testId: string;
  placeholder: string;
  title: string;
  width: number;
  onStartEdit: () => void;
  onChange: (name: string) => void;
  /** Close the editor and commit — the caller owns both halves. */
  onFinish: () => void;
}

export function EditableName({
  editing,
  name,
  emptyDisplay,
  testId,
  placeholder,
  title,
  width,
  onStartEdit,
  onChange,
  onFinish,
}: EditableNameProps) {
  if (editing) {
    return (
      <input
        data-testid={testId}
        autoFocus
        value={name}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onFinish}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur();
        }}
        // The cell around this one SELECTS its row; typing in the name must not
        // also re-select it out from under the cursor.
        onClick={(e) => e.stopPropagation()}
        style={{ width, fontSize: 12.5 }}
      />
    );
  }
  return (
    <span
      data-testid={testId}
      onClick={onStartEdit}
      title={title}
      style={{ cursor: 'text', borderBottom: `1px dashed ${theme.color.border.hover}` }}
    >
      {name === '' ? (
        <span style={{ color: theme.color.text.legend }}>{emptyDisplay ?? '—'}</span>
      ) : (
        name
      )}
    </span>
  );
}
