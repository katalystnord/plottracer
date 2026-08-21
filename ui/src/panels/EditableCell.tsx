import type React from 'react';
import { theme } from '../theme.js';

/**
 * Click-to-edit table cells - the typed twin of dragging a marker.
 *
 * ⚑ NOT a permanent boxed field (David, 2026-07-27, re Spider): *"now a user
 * thinks he HAS to add something"*. Everything here is optional - an axis or
 * category the figure prints illegibly is still real - so at rest a cell looks
 * like the rest of the table, and an unnamed one reads as a dash exactly like a
 * value nobody recorded. The dashed underline is the whole affordance.
 *
 * ⚑⚑ AND IT HAS TO BE VISIBLE AT 100% (v2.3, E3). It was drawn in
 * `border.hover` - #dddddd, the FAINTEST colour in the palette, and a HOVER
 * token used for a resting state - under text in `text.legend`, the colour this
 * app uses for inert hints. So the one editable control on a heatmap band
 * advertised itself in two colours that both mean "not interactive". David,
 * looking straight at it: *"I'm testing now, and no, I cannot see that I can."*
 * Then, told where to click, it worked first time. Legible at 3× magnification
 * is not legible.
 * ⚑ Now `border.regular`. The component's own claim - that the underline IS the
 * affordance - is only true if the underline can be seen.
 *
 * ⚑ ONE component per kind, not one per CALL SITE. `EditableValue` serves both
 * the XY table and the spider table, which had hand-rolled the same input/span
 * pair with different testid prefixes and widths; `EditableName` serves all
 * three name columns (Spider's axis, Bar's category, Pie/Box Plot's tuple
 * label). David, 2026-07-30, on the name trio: *"a lot of ... duplicate or near
 * duplicate code for things that should really be almost the same code."* The
 * value pair was the same shape and is folded in here for the same reason.
 */

/**
 * ⚑⚑ THE EDITOR OCCUPIES THE VALUE'S OWN BOX (v2.3, A5).
 *
 * David, 2026-08-16, with two screenshots of one bar chart's data panel, at rest
 * and mid-edit: *"This is the output fields when I'm not trying to edit a cell.
 * This is the same field when I am trying to edit a cell. Not so good
 * consistency."* Every row grew taller, the delete button dropped to its own
 * line, a horizontal scrollbar appeared, and the second series' header shifted.
 * None of it was the cell he clicked. Measured after the fact: opening one name
 * editor moved the NEXT ROW'S name cell 11px.
 *
 * ⚑ THE CAUSE is not a stylesheet detail. A bare `<input>` is about 20
 * characters wide whatever it contains, and these editors took a fixed `width`
 * besides, while the resting span is exactly as wide as its text. So the table's
 * natural width jumped the moment a cell opened, and the browser resolved it by
 * wrapping the narrowest cell and adding a scrollbar.
 *
 * ⚑⚑ THE RULE, David's: *an edit control must occupy the SAME BOX as the value
 * it edits. If entering edit mode moves anything the user was not editing, the
 * control is the wrong size.*
 *
 * ⚑ NO MEASUREMENT, NO REF, NO LAYOUT READ. A hidden copy of the text sits in
 * the same grid cell as the input, so the box is sized BY the text it is
 * replacing, by the browser, at the same moment it is replaced. A measured
 * version would be a second source for the width and would lag by a frame.
 *
 * ⚑ It grows as you TYPE, because the sizer holds the live text: entering edit
 * moves nothing, and a name genuinely longer than its column has somewhere to
 * go. That is exactly the line the rule draws - entering is ours, typing is the
 * user's own doing and is visible as it happens.
 */
function SizedCell({
  sizerText,
  minWidth,
  children,
}: {
  sizerText: string;
  minWidth: number;
  children: React.ReactNode;
}) {
  return (
    <span
      style={{
        position: 'relative',
        display: 'inline-block',
        minWidth,
        whiteSpace: 'pre',
        // ⚑ The SAME 1px the resting cell spends on its dashed underline. Without
        // it the editing box is a pixel shorter and the row below sits a pixel
        // higher - the last of four measured shifts, and the one that shows the
        // rule is about the BOX, not about the width.
        borderBottom: '1px solid transparent',
      }}
    >
      {/* The box IS this text. It stays in normal flow and is the only thing
          that sizes the cell, in both directions. */}
      <span aria-hidden style={{ visibility: 'hidden' }}>{sizerText}</span>
      {children}
    </span>
  );
}

/**
 * The resting cell: the same box, with the text visible rather than hidden.
 *
 * ⚑ AND IT CARRIES THE UNDERLINE, not the text inside it. The dashed rule IS the
 * affordance (see this file's header, and E3: David could not see that a heatmap
 * band was editable at all). Under an UNNAMED cell the text is a single dash, so
 * the affordance was four pixels wide - an invitation nobody could aim at. Now
 * that rest and edit share one box, the underline can be the width of the thing
 * you are about to type into.
 */
function RestingCell({
  minWidth,
  children,
}: {
  minWidth: number;
  children: React.ReactNode;
}) {
  return (
    <span
      style={{
        display: 'inline-block',
        minWidth,
        whiteSpace: 'pre',
        borderBottom: `1px dashed ${theme.color.border.regular}`,
        cursor: 'text',
      }}
    >
      {children}
    </span>
  );
}

/** What an overlaid editor needs to occupy its cell exactly and contribute
 * nothing to its size. ⚑ ABSOLUTE, which is the whole trick: an in-flow input
 * adds its own border and padding to the row's height, and the row grew 5px on
 * open even once its width was right. Out of flow, it cannot affect layout in
 * either direction. */
const OVERLAY = {
  position: 'absolute' as const,
  inset: 0,
  width: '100%',
  height: '100%',
  minWidth: 0,
  boxSizing: 'border-box' as const,
};

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
      // ⚑ Sized by the text, not by `width` - see SizedEditor. `width` survives
      // only as the resting span's own hint, so the two states agree.
      <SizedCell sizerText={editValue} minWidth={width}>
        <input
          data-testid={testIdEdit}
          autoFocus
          // ⚑⚑ `size={1}`, and it is what actually fixes this. An <input>'s
          // INTRINSIC width is its `size` attribute, which defaults to 20
          // characters, and a grid track sizes to its items' max-content - so
          // the cell grew from 120px to 204px on open no matter what `width` or
          // `box-sizing` said. Measured on the built app, which is the only
          // place a layout claim can be settled. With the intrinsic width out of
          // the way, `width: 100%` fills the box the hidden sizer defines.
          size={1}
          value={editValue}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onCommit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onCommit();
            else if (e.key === 'Escape') onCancel();
          }}
          // The cell around this one SELECTS its row - the same rule
          // `EditableName` below has always followed. Without it, clicking into
          // the box you are already typing in re-fires that selection and
          // toggles it back OFF, taking the canvas highlight with it mid-edit.
          onClick={(e) => e.stopPropagation()}
          // ⚑ `border-box`, or the input is its border and padding WIDER than the
          // box it was given: `width: 100%` sets the CONTENT width by default, so
          // the last 7px of the shift survived three attempts at the sizer.
          style={{ ...OVERLAY, ...(align ? { textAlign: align } : {}) }}
        />
      </SizedCell>
    );
  }
  return (
    <RestingCell minWidth={width}>
      <span
        data-testid={testIdValue}
        // ⚑⚑ DOUBLE click edits; a single click falls through to the row,
        // which SELECTS it (v2.3, A3). David: *"One click == Select, double
        // click == edit value"*, consistent for every output panel on every
        // graph type.
        //
        // ⚑⚑ AND IT MAKES "EDIT APPLIES TO ONE CELL" A PROPERTY OF THE GESTURE
        // RATHER THAN A RULE ANYONE ENFORCES - the same move as collapsing the
        // error-bar ball into the whisker end: the unwanted state stops being
        // reachable instead of being checked for.
        //
        // ⚠️ It also unblocked A5. Once the resting cell filled its box it
        // became a much bigger target, so a row click meant to SELECT landed on
        // a value and opened an editor instead, and Delete then had nothing
        // selected to remove. Two e2e tests caught it. Widening the cell and
        // splitting the gestures are one change, not two.
        onDoubleClick={onStartEdit}
        title={title}
        style={{ display: 'inline-block', width: '100%', ...(align ? { textAlign: align } : {}) }}
      >
        {display}
      </span>
    </RestingCell>
  );
}

export interface EditableNameProps {
  editing: boolean;
  /** The name as stored - empty means unnamed, and shows a dash. */
  name: string;
  /**
   * What to show at rest when the name is empty, instead of the dash.
   *
   * ⚑ A dash is right where something ELSE in the row identifies it - a bar's
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
  /** Close the editor and commit - the caller owns both halves. */
  onFinish: () => void;
  /**
   * Put back the name the editor opened with, and close.
   *
   * ⚑⚑ ESCAPE MEANT TWO THINGS IN ONE TABLE (v2.3 re-audit, F40). In
   * `EditableValue`, two cells to the left, Escape CANCELS - it matches the
   * global ladder, whose own comment is *"Esc = back out of the current step...
   * It never discards recorded data"*. Here Escape did exactly what Enter did:
   * blur, which commits. So the key that backs out of everything else in this
   * app silently wrote a half-typed name, and nothing on screen distinguished
   * the two cells.
   *
   * ⚑ A name is written THROUGH on every keystroke (that is what makes the
   * table live), so cancelling is not "do not commit" - it is "write back what
   * was there". The caller owns the seed for the same reason it owns the
   * editing key.
   */
  onCancel: () => void;
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
  onCancel,
}: EditableNameProps) {
  if (editing) {
    return (
      // ⚑ The sizer holds the PLACEHOLDER while the name is empty, so a blank
      // cell opens at the width of the words it is inviting rather than
      // collapsing to nothing.
      <SizedCell sizerText={name || placeholder} minWidth={width}>
        <input
          data-testid={testId}
          autoFocus
          // ⚑⚑ `size={1}`, and it is what actually fixes this. An <input>'s
          // INTRINSIC width is its `size` attribute, which defaults to 20
          // characters, and a grid track sizes to its items' max-content - so
          // the cell grew from 120px to 204px on open no matter what `width` or
          // `box-sizing` said. Measured on the built app, which is the only
          // place a layout claim can be settled. With the intrinsic width out of
          // the way, `width: 100%` fills the box the hidden sizer defines.
          size={1}
          value={name}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onFinish}
          onKeyDown={(e) => {
            // ⚑ Enter accepts, Escape backs out - the same two meanings the
            // value editor above gives them, and the same Escape the global key
            // ladder gives everywhere else (F40).
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            else if (e.key === 'Escape') onCancel();
          }}
          // The cell around this one SELECTS its row; typing in the name must
          // not also re-select it out from under the cursor.
          onClick={(e) => e.stopPropagation()}
          // ⚑⚑ NO `fontSize: 12.5` ANY MORE. It was hardcoded here while the
          // heatmap matrix renders at `theme.font.size.small`, so opening a row
          // name changed the TYPE SIZE as well as the box. `inherit` makes the
          // editor take whatever the table around it is using, which is the same
          // idea as sizing to the text: the editor belongs to its cell.
          style={{ ...OVERLAY, fontSize: 'inherit', fontFamily: 'inherit' }}
        />
      </SizedCell>
    );
  }
  return (
    // ⚑⚑ THE RESTING CELL TAKES THE SAME BOX, and that is the half a
    // self-sizing editor alone does not fix. An unnamed category rests as a
    // single DASH and opens onto a name-sized editor, so sizing only the editor
    // still moved the row: measured, the neighbour's cell jumped 17px. The
    // column has a width; the value and its editor are both tenants of it.
    <RestingCell minWidth={width}>
      <span
        data-testid={testId}
        // ⚑⚑ DOUBLE click edits; a single click falls through to the row,
        // which SELECTS it (v2.3, A3). David: *"One click == Select, double
        // click == edit value"*, consistent for every output panel on every
        // graph type.
        //
        // ⚑⚑ AND IT MAKES "EDIT APPLIES TO ONE CELL" A PROPERTY OF THE GESTURE
        // RATHER THAN A RULE ANYONE ENFORCES - the same move as collapsing the
        // error-bar ball into the whisker end: the unwanted state stops being
        // reachable instead of being checked for.
        //
        // ⚠️ It also unblocked A5. Once the resting cell filled its box it
        // became a much bigger target, so a row click meant to SELECT landed on
        // a value and opened an editor instead, and Delete then had nothing
        // selected to remove. Two e2e tests caught it. Widening the cell and
        // splitting the gestures are one change, not two.
        onDoubleClick={onStartEdit}
        // ⚑⚑ A NAME IS NOT A VALUE, so clicking one does not select the row.
        // A1 says *"single click on a VALUE selects it"*, and that is the line:
        // a heatmap's long-form row picks its cell on click, so a name cell
        // inside it was answering to two gestures at once and the double click
        // could not land. Naming a band and picking a cell are different acts on
        // different things that happen to share a row.
        onClick={(e) => e.stopPropagation()}
        title={title}
        style={{ display: 'inline-block', width: '100%' }}
      >
        {name === '' ? (
          <span style={{ color: theme.color.text.legend }}>{emptyDisplay ?? '-'}</span>
        ) : (
          name
        )}
      </span>
    </RestingCell>
  );
}
