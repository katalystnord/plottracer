import { theme } from '../theme.js';
import { SidebarSection, SidebarHeading } from '../layout.js';

/**
 * PLACES TO CHECK (v2.6, K1) - every place Find lines was unsure about, kept on
 * screen while the user corrects (Cut, Join, Move, the Level field), each one a
 * click away. Find lines is a FIRST VERSION (David, 2026-10-10): where it is
 * unsure it splits and says where, so nothing it gets wrong is silent - this
 * list is where it says so.
 */
export interface LinePlace {
  id: number;
  kind: 'bridge' | 'split' | 'end' | 'unresolved' | 'label';
  /** Image pixels. */
  at: [number, number];
  text: string;
}

export function PlacesToCheck(props: {
  places: readonly LinePlace[];
  onGo: (place: LinePlace) => void;
  onDone: (id: number) => void;
  onClear: () => void;
}) {
  const { places, onGo, onDone, onClear } = props;
  if (!places.length) return null;
  return (
    <SidebarSection data-testid="places-to-check">
      <SidebarHeading>
        Places to check ({places.length})
        <button
          type="button"
          data-testid="places-to-check-clear"
          onClick={onClear}
          title="Close the list - every place has been checked"
          style={{ marginLeft: 8, fontSize: theme.font.size.small }}
        >
          Clear
        </button>
      </SidebarHeading>
      <span style={{ fontSize: theme.font.size.small, color: theme.color.text.legend }}>
        Click a place to go there. Put a line right with Cut (rail), Join with, or Move selected points; tick a place once it is right.
      </span>
      <ul style={{ listStyle: 'none', margin: '6px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 220, overflowY: 'auto' }}>
        {places.map((pl) => (
          <li key={pl.id} data-testid={`place-${pl.id}`} style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
            <button
              type="button"
              data-testid={`place-go-${pl.id}`}
              onClick={() => onGo(pl)}
              title="Go to this place on the figure"
              style={{ textAlign: 'left', flex: '1 1 auto', fontSize: theme.font.size.small, background: 'none', border: `1px solid ${theme.color.border.regular}`, borderRadius: 4, padding: '3px 6px', cursor: 'pointer' }}
            >
              {pl.text}
            </button>
            <button
              type="button"
              data-testid={`place-done-${pl.id}`}
              onClick={() => onDone(pl.id)}
              title="This place is right now - take it off the list"
              aria-label="Checked"
              style={{ fontSize: theme.font.size.small, cursor: 'pointer' }}
            >
              ✓
            </button>
          </li>
        ))}
      </ul>
    </SidebarSection>
  );
}
