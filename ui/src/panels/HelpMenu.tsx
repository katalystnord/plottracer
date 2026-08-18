import { theme } from '../theme.js';
import { FloatingPanel } from '../FloatingPanel.js';
import { HelpIcon, GRAPH_TYPE_ICONS } from '../icons.js';
import { EXAMPLES, MANUAL_URL } from '../examples.js';

/**
 * The Help dropdown - the F1 card's visible route, the bundled examples, the
 * manual and the Trace Challenge.
 *
 * ⚑ THE "How to use PlotTracer" BUTTON IS THE POINT OF THIS CARD. F1 opens the
 * same overlay, but a key with no visible route is a capability a first-time
 * user never learns exists (CLAUDE.md's keystone rule). That is why it sits
 * FIRST, above the examples and the game.
 */

export interface HelpMenuProps {
  onOpenHelpOverlay: () => void;
  onOpenExample: (example: (typeof EXAMPLES)[number]) => void;
  onStartChallenge: () => void;
  appVersion: string;
}

export function HelpMenu({ onOpenHelpOverlay, onOpenExample, onStartChallenge, appVersion }: HelpMenuProps) {
  return (
        <FloatingPanel label="Help" icon={<HelpIcon />} hideLabel testId="help" shortcut="F1">
          {(close) => (
            <>
              {/* ⚑ FIRST IN THE CARD, above the examples and the Challenge.
                  This is the one entry here a stuck user needs; the examples
                  are for exploring and the Challenge is a game. It is also
                  what makes F1 discoverable at all -- a key with no visible
                  route is a capability a first-time user never learns
                  exists. */}
              <button
                type="button"
                data-testid="open-help-overlay"
                onClick={() => {
                  close();
                  onOpenHelpOverlay();
                }}
                title="The workflow and the keys, on one card"
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '7px 9px',
                  marginBottom: 10,
                  background: theme.color.background.panel,
                  border: `1px solid ${theme.color.border.regular}`,
                  borderRadius: theme.border.radius.regular,
                  color: theme.color.text.primary,
                  cursor: 'pointer',
                  fontWeight: 650,
                  fontSize: theme.font.size.regular,
                }}
              >
                How to use PlotTracer
                <span style={{ float: 'right', color: theme.color.text.legend, fontWeight: 400 }}>F1</span>
              </button>
              <div
                style={{
                  fontSize: theme.font.size.small,
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: 0.4,
                  color: theme.color.text.legend,
                  marginBottom: 4,
                }}
              >
                Open example
              </div>
              {/* v2.0: a 2-column grid of icon+label cards (David), the same
                  graph-type glyph GraphTypeCardPicker.tsx uses -- so the type
                  reads at a glance instead of only via the text prefix the
                  labels used to carry (now shortened, see EXAMPLES's own
                  comment on why). */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 4, width: 420 }}>
                {EXAMPLES.map((ex) => {
                  const ExampleIcon = GRAPH_TYPE_ICONS[ex.icon ?? ex.axes];
                  return (
                    <button
                      key={ex.id}
                      type="button"
                      data-testid={`example-${ex.id}`}
                      onClick={() => {
                        close(); // dismiss the dropdown when an example is chosen
                        onOpenExample(ex);
                      }}
                      title={ex.name}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 6,
                        textAlign: 'left',
                        background: 'transparent',
                        border: 'none',
                        padding: '5px 6px',
                        borderRadius: theme.border.radius.regular,
                        cursor: 'pointer',
                        fontSize: 11.5,
                        lineHeight: 1.3,
                        color: theme.color.text.primary,
                      }}
                    >
                      {ExampleIcon && (
                        // ⚑ 20px + text.secondary, not 16px + text.legend (David: "a
                        // little small hard to see") -- the fine detail in some glyphs
                        // (spider's hexagon+spokes, ternary's triangle+gridlines) needs
                        // the extra 4px and the darker ink to actually read at this scale.
                        <span
                          style={{
                            flex: '0 0 auto',
                            display: 'inline-flex',
                            color: theme.color.text.secondary,
                          }}
                        >
                          <ExampleIcon size={20} />
                        </span>
                      )}
                      <span>{ex.name}</span>
                    </button>
                  );
                })}
              </div>
              <div style={{ height: 1, background: theme.color.border.regular, margin: '8px 0' }} />
              {/* ⚑⚑ A BUTTON, NOT AN ADDRESS. v1.6 printed the manual's URL as
                  plain selectable text; David overturned that 2026-08-01 --
                  "that was not a good semantic, because the users could not
                  simply click it" -- and then asked for it as a small button
                  beside the Challenge rather than a link above it. A string
                  that looks like a link and does nothing is the worst of both.

                  ⚑ It needs NO new IPC surface. electron-main.cjs's
                  setWindowOpenHandler already routes http(s) to
                  shell.openExternal and denies the window, so window.open is
                  enough. Nor does it fail SILENTLY offline: the browser opens
                  and says it cannot reach the page, which is an ordinary
                  outcome a user understands -- the objection the plain-text
                  version was built on.

                  ⚑ The pair sits on one row because they are the same KIND of
                  thing: the two places you leave this card for. Challenge
                  keeps the width; Manual takes only what it needs. */}
              <div style={{ display: 'flex', gap: 6, alignItems: 'stretch' }}>
                <button
                  type="button"
                  data-testid="challenge-start"
                  onClick={() => {
                    close();
                    onStartChallenge();
                  }}
                  style={{
                    flex: 1,
                    textAlign: 'center',
                    padding: '8px 10px',
                    borderRadius: theme.border.radius.regular,
                    border: `1px solid ${theme.color.primary.main}`,
                    background: theme.color.primary.clicked,
                    // v2.0 pre-launch audit: white text on this background is
                    // ~2.46:1, failing WCAG AA (needs 4.5:1 at 13px bold --
                    // the same contrast defect already fixed once for a
                    // header button). Dark text on the same background is
                    // ~5.14:1.
                    color: theme.color.text.primary,
                    cursor: 'pointer',
                    fontWeight: 700,
                    fontSize: theme.font.size.regular,
                  }}
                  title="Race the clock tracing 5 pre-calibrated example figures - scored against their true values"
                >
                  🎯 Take The Trace Challenge
                </button>
                <button
                  type="button"
                  data-testid="manual-link"
                  onClick={() => {
                    close();
                    window.open(MANUAL_URL, '_blank', 'noreferrer');
                  }}
                  style={{
                    flex: '0 0 auto',
                    padding: '8px 12px',
                    borderRadius: theme.border.radius.regular,
                    border: `1px solid ${theme.color.border.regular}`,
                    background: theme.color.background.panel,
                    color: theme.color.text.primary,
                    cursor: 'pointer',
                    fontWeight: 650,
                    fontSize: theme.font.size.regular,
                    whiteSpace: 'nowrap',
                  }}
                  title="Open the full manual in your browser - every chart type, every export format, and what each tool refuses"
                >
                  Manual ↗
                </button>
              </div>
              <div style={{ height: 1, background: theme.color.border.regular, margin: '8px 0' }} />
              {/* ⚑ NO maxWidth. This carried `maxWidth: 260` from when the help card
                  was a narrow column, and stayed after the example list grew labels
                  like "XY Scatter - modulus vs. crosslinker (Auto-trace ▸ Scattered
                  points)" - which now set the card's width. The attribution was
                  wrapping to seven lines inside a card twice that wide, with the
                  right half of every line empty. It is required text (AGPL-3.0 plus
                  the clean-room and Ketcher acknowledgements), so it should read as
                  a paragraph rather than a ransom note. */}
              <div style={{ fontSize: theme.font.size.small, color: theme.color.text.secondary, lineHeight: 1.5 }}>
                <strong>PlotTracer</strong> <span data-testid="app-version">v{appVersion}</span> - a
                desktop plot digitizer based on{' '}
                <strong>WebPlotDigitizer</strong> by Ankit Rohatgi, distributed under
                AGPL-3.0. Several algorithms are clean-room reimplementations of{' '}
                <strong>Engauge Digitizer</strong> ideas (GPL-2.0); the icon set derives
                from <strong>Ketcher</strong> by EPAM Systems (Apache-2.0). Developed by
                Katalyst Nord AB, Stockholm.
              </div>
            </>
          )}
        </FloatingPanel>  );
}
