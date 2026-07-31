import { theme } from './theme';

/**
 * "Exploded slice" — the control that makes a pulled-out sector readable.
 *
 * ⚑ WHY IT IS ON THE CANVAS AND NOT IN THE SIDEBAR (v1.6, David's call). It shipped
 * first as a small chip beside the capture status in the right-hand panel, and it
 * failed the keystone test in the most direct way available: the person who asked for
 * it went looking for it and could not find it. A capability that decides whether a
 * whole slice reads 23 or 27 cannot be a 11px chip inside a sentence, competing with a
 * table. It sits in the lower-right of the FIGURE, where the eye already is while
 * clicking boundaries, sized and coloured like something you are meant to press.
 *
 * ⚑ AND WHY IT IS A BUTTON AND NOT A MODIFIER. Ctrl+click was the first idea and is
 * doubly unavailable — Ctrl+Left is the canvas pan on Windows/Linux and the system
 * context-menu gesture on macOS — but the deciding reason is the keystone rule: a
 * capability reachable only from a held key is a shortcut-only path, and the user
 * never sees that it exists.
 *
 * The fold-out opens UP AND TO THE LEFT because the button is bottom-right; it appears
 * on arming rather than on hover, so the instructions arrive at the moment they are
 * acted on and no explanation is hidden behind a pointer the touchpad cannot express.
 */

export type ExplodedStage = 'off' | 'apex' | 'edges';

interface Props {
  stage: ExplodedStage;
  /** How many of the armed slice's two edges are placed — ticks the checklist. */
  edgesPlaced: number;
  onToggle: () => void;
}

/** One line of the three-click checklist: done, current, or still to come. */
function Step({ n, text, state }: { n: number; text: string; state: 'done' | 'now' | 'todo' }) {
  return (
    <li
      data-testid={`exploded-step-${n}`}
      data-state={state}
      style={{
        display: 'flex',
        gap: 8,
        alignItems: 'baseline',
        color: state === 'todo' ? theme.color.text.secondary : theme.color.text.primary,
        fontWeight: state === 'now' ? 600 : 400,
      }}
    >
      <span aria-hidden style={{ color: state === 'done' ? theme.color.primary.main : 'inherit', width: 12 }}>
        {state === 'done' ? '✓' : `${n}.`}
      </span>
      <span>{text}</span>
    </li>
  );
}

export function ExplodedSliceControl({ stage, edgesPlaced, onToggle }: Props) {
  const armed = stage !== 'off';
  const stepState = (n: number): 'done' | 'now' | 'todo' => {
    const reached = stage === 'apex' ? 0 : 1 + edgesPlaced;
    if (n <= reached) return 'done';
    return n === reached + 1 ? 'now' : 'todo';
  };

  return (
    <div
      style={{
        position: 'absolute',
        right: 16,
        bottom: 16,
        zIndex: 4,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: 8,
        // The figure must stay clickable everywhere this control is not.
        pointerEvents: 'none',
      }}
    >
      {armed && (
        <div
          data-testid="exploded-slice-guide"
          style={{
            // ⚑ CLICK-THROUGH. This panel is pure text -- a heading, the
            // reason, and three steps -- and it appears exactly WHILE the user
            // must land three clicks on the figure. Opaque to pointer events
            // it swallowed presses in the bottom-right of the canvas, which is
            // where the bundled exploded-pie example's own sector and its
            // right-hand edge sit. Every rail fold-out card is click-through
            // for precisely this reason (see ImageEditCard's `interactive`).
            // Same trap, third occurrence. (v2.0 audit, round 2.)
            pointerEvents: 'none',
            width: 268,
            padding: '12px 14px',
            background: theme.color.background.primary,
            border: `1px solid ${theme.color.border.regular}`,
            borderRadius: 8,
            boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
            fontFamily: theme.font.family,
            fontSize: theme.font.size.small,
            color: theme.color.text.primary,
            lineHeight: 1.45,
          }}
        >
          <div style={{ fontWeight: 600, fontSize: theme.font.size.regular, marginBottom: 6 }}>
            Exploded slice
          </div>
          {/* The REASON, not just the recipe — it is what tells you whether this
              button applies to the slice you are looking at. */}
          <p style={{ margin: '0 0 8px', color: theme.color.text.secondary }}>
            A slice pulled out of the pie has its own tip, so its edges no longer point
            at the pie&apos;s centre. Clicked here, it is measured about that tip.
          </p>
          <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 3 }}>
            <Step n={1} text="Click the slice’s tip" state={stepState(1)} />
            <Step n={2} text="Click its first edge" state={stepState(2)} />
            <Step n={3} text="Click its second edge" state={stepState(3)} />
          </ol>
          <p style={{ margin: '8px 0 0', color: theme.color.text.secondary }}>
            This slice only — the next sector goes back to the pie&apos;s centre.
          </p>
        </div>
      )}
      <button
        type="button"
        data-testid="pie-exploded-slice"
        aria-pressed={armed}
        title="This slice is pulled out of the pie — click its tip first, then its two edges"
        onClick={onToggle}
        style={{
          pointerEvents: 'auto',
          fontFamily: theme.font.family,
          fontSize: theme.font.size.regular,
          fontWeight: 600,
          padding: '9px 16px',
          borderRadius: 8,
          cursor: 'pointer',
          color: '#ffffff',
          background: armed ? theme.color.primary.button : theme.color.primary.main,
          border: armed ? `2px solid ${theme.color.primary.clicked}` : '2px solid transparent',
          boxShadow: '0 2px 8px rgba(0,0,0,0.28)',
        }}
      >
        {armed ? 'Exploded slice — cancel' : 'Exploded slice'}
      </button>
    </div>
  );
}
