import styled from '@emotion/styled';
import { theme } from './theme.js';
import { FloatingPanel } from './FloatingPanel.js';
import { GRAPH_TYPE_ICONS } from './icons.js';

/**
 * The graph-type picker (v2.0) — a grid of icon+label CARDS instead of a
 * plain text dropdown (replaces AxesTypeSelect.tsx).
 *
 * ⚑ WHY. David test-drove plotdigitizer.com directly and concluded it is
 * not ahead of PlotTracer in functionality or user-friendliness — except
 * for exactly this: its chart-type picker is a grid of small icon cards,
 * not a text list, and his own read was "more user friendly". A genuine
 * discoverability win (recognize a glyph at a glance vs. read an 11-line
 * list), the same pattern Excel/PowerPoint/Tableau's own chart pickers use
 * — not cosmetic. See project_chart_type_icons_backlog.md.
 *
 * Built on FloatingPanel (the same primitive Grid Removal/Curve Fit/Help
 * already use) rather than MUI's Select — a card grid has nothing in
 * common with a native `<select>`'s single-column text list, and
 * FloatingPanel already solves anchoring/closing/the glass surface. The
 * trigger keeps the SAME "Graph type" caption AxesTypeSelect had (David:
 * "the target user can only use what is on screen, and a bare 'XY' chip
 * never told a first-time user that a graph TYPE exists to choose") —
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

const Card = styled('button')<{ active: boolean }>(({ active }) => ({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 4,
  padding: '8px 4px',
  borderRadius: theme.border.radius.regular,
  border: `1px solid ${active ? theme.color.primary.main : theme.color.border.regular}`,
  background: active ? theme.color.primary.clicked : theme.color.background.primary,
  color: active ? theme.color.background.primary : theme.color.text.primary,
  cursor: 'pointer',
  fontSize: 11,
  fontFamily: theme.font.family,
  lineHeight: 1.2,
  textAlign: 'center',
  '& svg': { width: 22, height: 22 },
  ':hover': {
    borderColor: theme.color.primary.main,
  },
}));

export function GraphTypeCardPicker({ options, value, onChange }: GraphTypeCardPickerProps) {
  const active = options.find((o) => o.id === value);
  const ActiveIcon = active ? GRAPH_TYPE_ICONS[active.id] : undefined;
  return (
    <LabelledRow>
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
              return (
                <Card
                  key={opt.id}
                  type="button"
                  data-testid={`axes-option-${opt.id}`}
                  active={opt.id === value}
                  aria-pressed={opt.id === value}
                  title={opt.label}
                  onClick={() => {
                    onChange(opt.id);
                    close();
                  }}
                >
                  {Icon && <Icon />}
                  <span>{opt.label}</span>
                </Card>
              );
            })}
          </Grid>
        )}
      </FloatingPanel>
    </LabelledRow>
  );
}
