import styled from '@emotion/styled';
import { theme } from './theme.js';
import { FloatingPanel } from './FloatingPanel.js';
import { GRAPH_TYPE_ICONS } from './icons.js';

/**
 * The graph-type picker (v2.0) - a grid of icon+label CARDS instead of a
 * plain text dropdown (replaces AxesTypeSelect.tsx).
 *
 * ⚑ WHY. David test-drove plotdigitizer.com directly and concluded it is
 * not ahead of PlotTracer in functionality or user-friendliness - except
 * for exactly this: its chart-type picker is a grid of small icon cards,
 * not a text list, and his own read was "more user friendly". A genuine
 * discoverability win (recognize a glyph at a glance vs. read an 11-line
 * list), the same pattern Excel/PowerPoint/Tableau's own chart pickers use
 * - not cosmetic. See project_chart_type_icons_backlog.md.
 *
 * Built on FloatingPanel (the same primitive Grid Removal/Curve Fit/Help
 * already use) rather than MUI's Select - a card grid has nothing in
 * common with a native `<select>`'s single-column text list, and
 * FloatingPanel already solves anchoring/closing/the glass surface. The
 * trigger keeps the SAME "Graph type" caption AxesTypeSelect had (David:
 * "the target user can only use what is on screen, and a bare 'XY' chip
 * never told a first-time user that a graph TYPE exists to choose") -
 * only the fold-out's own CONTENTS change.
 */
export interface GraphTypeOption {
  id: string;
  label: string;
}

export interface GraphTypeCardPickerProps {
  options: readonly GraphTypeOption[];
  value: string;
  onChange: (id: string) => void;
  /**
   * The graph type the captured figure's classifier suggests (v2.7), or null. Its card is outlined green with
   * "Suggested" under its name; nothing is selected by it (docs/v2.7-workflow-walk.md, The graph type suggestion).
   */
  suggested?: string | null;
  /** How many captures the suggestion has answered for; on the row for the e2e tests to wait on. */
  suggestionAnswered?: number;
}

const LabelledRow = styled('div')({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  paddingLeft: 8, // matches AxesTypeSelect's own inset -- see its own comment on why
});

const FieldLabel = styled('label')({
  fontSize: theme.font.size.regular,
  color: theme.color.text.primary,
  fontFamily: theme.font.family,
  whiteSpace: 'nowrap',
});

const Grid = styled('div')({
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 1fr)',
  gap: 6,
  width: 340,
});

const Card = styled('button')<{ active: boolean; suggested: boolean }>(({ active, suggested }) => ({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 4,
  borderRadius: theme.border.radius.regular,
  border: suggested
    ? `2px solid ${theme.color.suggested}`
    : `1px solid ${active ? theme.color.primary.main : theme.color.border.regular}`,
  // the 2px outline takes its extra pixel from the padding, so a suggested card is the size of the others
  padding: suggested ? '7px 3px' : '8px 4px',
  background: active ? theme.color.primary.clicked : theme.color.background.primary,
  color: active ? theme.color.background.primary : theme.color.text.primary,
  cursor: 'pointer',
  fontSize: 11,
  fontFamily: theme.font.family,
  lineHeight: 1.2,
  textAlign: 'center',
  '& svg': { width: 22, height: 22 },
  ':hover': {
    borderColor: suggested ? theme.color.suggested : theme.color.primary.main,
  },
}));

const SuggestedNote = styled('span')<{ active: boolean }>(({ active }) => ({
  fontSize: 10,
  fontWeight: 600,
  color: active ? theme.color.background.primary : theme.color.suggested,
}));

export function GraphTypeCardPicker({ options, value, onChange, suggested = null, suggestionAnswered = 0 }: GraphTypeCardPickerProps) {
  const active = options.find((o) => o.id === value);
  const ActiveIcon = active ? GRAPH_TYPE_ICONS[active.id] : undefined;
  return (
    <LabelledRow data-testid="axes-type-row" data-suggestion-answered={suggestionAnswered}>
      <FieldLabel id="axes-type-label" data-testid="axes-type-label">
        Graph type
      </FieldLabel>
      <FloatingPanel
        label={active?.label ?? 'Graph type'}
        icon={ActiveIcon ? <ActiveIcon /> : undefined}
        testId="axes-type"
      >
        {(close) => (
          <Grid role="listbox" aria-labelledby="axes-type-label">
            {options.map((opt) => {
              const Icon = GRAPH_TYPE_ICONS[opt.id];
              const isSuggested = opt.id === suggested;
              return (
                <Card
                  key={opt.id}
                  type="button"
                  data-testid={`axes-option-${opt.id}`}
                  active={opt.id === value}
                  suggested={isSuggested}
                  data-suggested={isSuggested ? 'true' : undefined}
                  aria-pressed={opt.id === value}
                  title={isSuggested ? `${opt.label}: suggested from the captured figure` : opt.label}
                  onClick={() => {
                    onChange(opt.id);
                    close();
                  }}
                >
                  {Icon && <Icon />}
                  <span>{opt.label}</span>
                  {isSuggested && <SuggestedNote active={opt.id === value}>Suggested</SuggestedNote>}
                </Card>
              );
            })}
          </Grid>
        )}
      </FloatingPanel>
    </LabelledRow>
  );
}
