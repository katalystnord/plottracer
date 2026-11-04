/**
 * The Categories stage's Names row (v2.7; docs/v2.7-workflow-walk.md, "The Categories stage laid out in rows").
 *
 * The row holds whatever writes the category names, and only one thing at a time: the names [Automatic axis
 * detection] read and offered, or, with no offer, the button that reads them from a dragged box. Both write the same
 * column, so they share the row rather than sit in two places on the card.
 */
export type NamesRow = { kind: 'offer'; text: string } | { kind: 'read'; label: string };

export function namesRow({ offered, readingArmed }: { offered: number | null; readingArmed: boolean }): NamesRow {
  if (offered !== null && offered > 0) return { kind: 'offer', text: `${offered} read from the labels` };
  return { kind: 'read', label: readingArmed ? 'Drag a box round the labels...' : 'Read labels from the figure' };
}
