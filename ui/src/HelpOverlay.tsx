/**
 * "How to use PlotTracer" — the in-the-moment card (v2.0).
 *
 * ⚑ WHAT THIS IS FOR, and the whole reason it can stay small: help you in the
 * MIDDLE of a job. Not a manual, not a tour. Somebody who is three clicks into
 * a calibration and cannot remember which key nudges, or which order the steps
 * go in. So it holds the WORKFLOW and the KEYS and nothing else, on one screen,
 * with no scrolling.
 *
 * ⚑⚑ THE CONTENT RULE (settled with David, and it is why this is short):
 * the WORKFLOW lives in the app; everything VERSION-SPECIFIC lives in
 * MANUAL.md. Per-format export caveats, per-type calibration steps, what each
 * tool refuses and why — none of that belongs here. Two homes for one fact is
 * exactly how the README came to promise a feature the app refuses, and how the
 * website came to advertise an export that did not exist. The workflow is the
 * stable part, so a card about the workflow cannot drift; a card that
 * duplicated the manual would.
 *
 * ⚑ THE MANUAL IS A BUTTON IN THE FOOTER, not a link in the prose. A first
 * draft put "Read the full manual" inline in the footer sentence and David cut
 * it — *"In the overlay?"* — then asked for it back as a button, bottom right.
 * The distinction is real and worth keeping: a link buried mid-sentence
 * interrupts a card you are scanning, while a button parked in the corner is
 * out of the reading path until you want it. Same content, opposite behaviour.
 *
 * ⚑ REACHABLE TWO WAYS, DELIBERATELY. F1 opens it, and so does a button in the
 * Help card. The button is not a convenience — a key is the only route means a
 * first-time user never learns the thing exists, which fails the keystone rule
 * that every capability must be discoverable from what is on screen. The key is
 * for the second time onwards.
 *
 * ⚑ EVERY KEY BELOW WAS READ OUT OF THE HANDLERS, not copied from the manual.
 * This project has shipped three wrong hotkeys in MANUAL.md once already, and a
 * documented Ctrl+arrow pan that never existed. `helpOverlayKeys.test.ts` holds
 * that line by asserting the table against Workspace.tsx's own source.
 */
import React from 'react';
import { theme } from './theme.js';
import {
  HandIcon,
  CalibrateIcon,
  ImageEditIcon,
  PlusIcon,
  AutoTraceIcon,
  SelectBoxIcon,
  ErrorBarsIcon,
  MeasureIcon,
  CurveFitIcon,
  GeometryIcon,
} from './icons.js';

export interface HelpOverlayProps {
  onClose: () => void;
  /** The manual's address. Passed in so there is one place it is written down. */
  manualUrl: string;
}

/** The six steps, in the order they actually happen. */
const WORKFLOW: Array<[string, string]> = [
  ['Open a figure', 'An image, or a page from a PDF.'],
  ['Pick the graph type', 'XY, bar, pie, spider… the type decides what a datum IS.'],
  ['Calibrate', 'Click the prompted points and type their known values.'],
  ['Capture', 'Place points by hand, drag a box for a bar, or auto-extract by colour.'],
  ['Correct', 'Drag, nudge, delete. Nothing is committed until you export.'],
  ['Export', 'CSV, XLSX, ODS, JSON, LaTeX, MATLAB, Python, R — or save the project.'],
];

/**
 * ⚑⚑ THE ICONS ARE THE POINT OF THIS LIST, not decoration (David's call).
 * The tool rail is icons ONLY — no labels — so a card that says "3 — Place
 * point" tells you the name of something you still cannot find. Showing the
 * SAME glyph the rail draws is what turns the row into a lookup: match the
 * picture, press the digit.
 *
 * ⚑ They are imported from icons.tsx rather than redrawn, so the card cannot
 * drift from the rail. If a tool's glyph changes, this changes with it.
 *
 * Select shows the RECTANGLE glyph because that is the sub-mode the rail
 * defaults to (SELECT_MODES[0]); the button swaps its own icon once another
 * sub-mode is chosen, which is a detail the manual carries, not this card.
 */
const TOOLS: Array<[string, string, () => React.JSX.Element]> = [
  ['0', 'Pan', HandIcon],
  ['1', 'Calibrate', CalibrateIcon],
  ['2', 'Edit image', ImageEditIcon],
  ['3', 'Place point', PlusIcon],
  ['4', 'Auto-extract', AutoTraceIcon],
  ['5', 'Select', SelectBoxIcon],
  ['6', 'Error bars', ErrorBarsIcon],
  ['7', 'Measure', MeasureIcon],
  ['8', 'Curve fit', CurveFitIcon],
  ['9', 'Geometry', GeometryIcon],
];

const EDITING: Array<[string, string]> = [
  ['↑ ↓ ← →', 'Nudge the selection'],
  ['Shift + arrows', 'Nudge coarsely'],
  ['Q / W', 'Previous / next point'],
  ['Enter', 'Accept the current step'],
  ['Esc', 'Back out, or clear the selection'],
  ['Del', 'Delete the active point'],
];

const DOCUMENT: Array<[string, string]> = [
  ['Ctrl + Z', 'Undo'],
  ['Ctrl + Shift + Z', 'Redo'],
  ['Ctrl + O / S', 'Open / save project'],
  ['Ctrl + + / −', 'Zoom in / out'],
  ['Ctrl + 0 / 1', 'Fit / actual size'],
];

/**
 * ⚑ The mouse earns its own group, for two reasons. Grouping: a wheel-zoom is
 * not a "document" action, and it was only sitting under that heading because
 * that is where the zoom keys are. Balance: pulling it out is what lets the
 * three columns end at roughly the same height instead of the key columns
 * running 80px past the Tools list.
 *
 * ⚑ Right-click was MISSING entirely until this split made room for it — the
 * canvas has had a context menu since v1.1 and nothing in the app said so.
 */
const MOUSE: Array<[string, string]> = [
  ['Wheel', 'Zoom'],
  ['Ctrl + drag', 'Pan (or middle-drag)'],
  ['Right-click', 'Context menu'],
];

const backdrop: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.35)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1200,
};

const card: React.CSSProperties = {
  background: theme.color.background.primary,
  border: `1px solid ${theme.color.border.regular}`,
  borderRadius: 10,
  boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
  // ⚑ Sized to fit, not to scroll. If a future edit makes this need a
  // scrollbar, the edit is wrong -- cut content instead, because a card you
  // have to scroll is a manual with a worse layout.
  // ⚑ THREE columns, not two, and this is what keeps the card SMALL. Two
  // columns put the 10-row Tools list under the 6-step workflow while the
  // right column ran out after Document & view -- so the bottom-right quadrant
  // was empty and the card was ~260px taller than its content needed. Read
  // cold on screen it was 64% of the window height, which is not the "quite a
  // small window" this is meant to be. Three balanced columns end together.
  width: 860,
  maxWidth: 'calc(100vw - 48px)',
  maxHeight: 'calc(100vh - 48px)',
  padding: '18px 22px 16px',
  overflow: 'auto',
};

const colHead: React.CSSProperties = {
  fontSize: theme.font.size.small,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  color: theme.color.text.legend,
  margin: '0 0 6px',
};

const keyCap: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  fontSize: 11,
  background: theme.color.background.panel,
  border: `1px solid ${theme.color.border.regular}`,
  borderRadius: 4,
  padding: '1px 5px',
  whiteSpace: 'nowrap',
};

/** The tool rows: digit, the rail's own glyph, then the name. */
function ToolList({ rows }: { rows: Array<[string, string, () => React.JSX.Element]> }): React.ReactElement {
  return (
    <table style={{ borderCollapse: 'collapse', width: '100%' }}>
      <tbody>
        {rows.map(([k, what, ToolIcon]) => (
          <tr key={k}>
            <td style={{ padding: '2px 7px 2px 0', verticalAlign: 'middle', width: 1 }}>
              <span style={keyCap}>{k}</span>
            </td>
            <td style={{ padding: '2px 7px 2px 0', verticalAlign: 'middle', width: 1 }}>
              <span
                style={{ display: 'inline-flex', color: theme.color.text.secondary, verticalAlign: 'middle' }}
                aria-hidden="true"
              >
                <ToolIcon />
              </span>
            </td>
            <td style={{ padding: '2px 0', fontSize: 12, color: theme.color.text.secondary, lineHeight: 1.4 }}>
              {what}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function KeyList({ rows }: { rows: Array<[string, string]> }): React.ReactElement {
  return (
    <table style={{ borderCollapse: 'collapse', width: '100%' }}>
      <tbody>
        {rows.map(([k, what]) => (
          <tr key={k}>
            {/* width:1 collapses the key column onto its content, so a single
                digit sits BESIDE its label instead of being marooned a third of
                the column away from it. */}
            <td style={{ padding: '2px 7px 2px 0', verticalAlign: 'top', width: 1, whiteSpace: 'nowrap' }}>
              <span style={keyCap}>{k}</span>
            </td>
            <td style={{ padding: '2px 0', fontSize: 12, color: theme.color.text.secondary, lineHeight: 1.4 }}>
              {what}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function HelpOverlay({ onClose, manualUrl }: HelpOverlayProps): React.ReactElement {
  // Esc closes, like every other overlay here. Captured on the window so it
  // works regardless of what has focus inside the card.
  React.useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div
      style={backdrop}
      data-testid="help-overlay-backdrop"
      onMouseDown={(e) => {
        // Backdrop click dismisses; a click INSIDE the card must not.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div style={card} data-testid="help-overlay" role="dialog" aria-label="How to use PlotTracer">
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 17, letterSpacing: '-0.01em', color: theme.color.text.primary }}>
            How to use PlotTracer
          </h2>
          <button
            type="button"
            data-testid="help-overlay-close"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              fontSize: 16,
              lineHeight: 1,
              color: theme.color.text.legend,
              padding: 4,
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.25fr 0.85fr 1fr', gap: 22 }}>
          <div>
            <p style={colHead}>The workflow</p>
            <ol style={{ margin: 0, paddingLeft: 17 }}>
              {WORKFLOW.map(([step, detail]) => (
                <li key={step} style={{ marginBottom: 5, fontSize: 12.5, lineHeight: 1.4 }}>
                  <b style={{ color: theme.color.text.primary }}>{step}</b>
                  <span style={{ color: theme.color.text.secondary }}> — {detail}</span>
                </li>
              ))}
            </ol>
          </div>

          <div>
            <p style={colHead}>Tools</p>
            <ToolList rows={TOOLS} />
            <p style={{ ...colHead, marginTop: 14 }}>Mouse</p>
            <KeyList rows={MOUSE} />
          </div>

          <div>
            <p style={colHead}>While you work</p>
            <KeyList rows={EDITING} />
            <p style={{ ...colHead, marginTop: 14 }}>Document &amp; view</p>
            <KeyList rows={DOCUMENT} />
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            margin: '14px 0 0',
            paddingTop: 10,
            borderTop: `1px solid ${theme.color.border.regular}`,
          }}
        >
          <p style={{ margin: 0, fontSize: 11.5, lineHeight: 1.5, color: theme.color.text.legend }}>
            <b>F1</b> reopens this card. Hold <b>Alt</b> for key tips on the buttons.
          </p>
          {/* ⚑ Same button as the Help card's, deliberately — one affordance
              for one action, so it is recognisable in both places. window.open
              is enough: electron-main.cjs's setWindowOpenHandler routes http(s)
              to shell.openExternal and denies the window, so no IPC surface. */}
          <button
            type="button"
            data-testid="help-overlay-manual"
            onClick={() => window.open(manualUrl, '_blank', 'noreferrer')}
            title="Open the full manual in your browser — every chart type, every export format, and what each tool refuses"
            style={{
              flex: '0 0 auto',
              padding: '6px 12px',
              borderRadius: theme.border.radius.regular,
              border: `1px solid ${theme.color.border.regular}`,
              background: theme.color.background.panel,
              color: theme.color.text.primary,
              cursor: 'pointer',
              fontWeight: 650,
              fontSize: theme.font.size.regular,
              whiteSpace: 'nowrap',
            }}
          >
            Manual ↗
          </button>
        </div>
      </div>
    </div>
  );
}
