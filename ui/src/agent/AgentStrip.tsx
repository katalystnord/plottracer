import { theme } from '../theme.js';
import type { AgentStatus } from '../electronApi.js';
import type { AgentMode, RoundsView } from './agentRounds.js';

/**
 * The connected-agent strip (v2.7, M3): while an agent is connected the screen
 * says which one and since when, and offers Disconnect. After a Disconnect it
 * says the agent is kept out, and offers the way back - so being disconnected is
 * never a hidden state.
 *
 * M14 (R1-R10): it also shows how the agent works - in rounds or automatic, the
 * round's steps so far - and holds the answers the person gives: Approve and
 * continue, Undo this round, Continue automatically, Pause and Resume.
 */
export interface AgentRoundsControls {
  view: RoundsView;
  onApprove: () => void;
  onUndoRound: () => void;
  /** Why Undo this round cannot be pressed, when it cannot. */
  undoRoundDisabled: string | null;
  onContinueAutomatically: () => void;
  onPause: () => void;
  onResume: () => void;
  onSetMode: (mode: AgentMode) => void;
}

export function AgentStrip({ status, waiting = false, rounds, onDisconnect, onAllowReconnect }: {
  status: AgentStatus | null;
  /** M7: the agent asked for a step this figure is not calibrated for. */
  waiting?: boolean;
  rounds?: AgentRoundsControls | null;
  onDisconnect: () => void;
  onAllowReconnect: () => void;
}) {
  if (!status || !status.listening) return null;
  const box = {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '4px 12px',
    fontSize: theme.font.size.regular,
    color: theme.color.text.primary,
    background: theme.color.background.panel,
    borderBottom: `1px solid ${theme.color.border.regular}`,
  } as const;
  if (status.client) {
    const since = new Date(status.client.since).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const v = rounds?.view;
    const segment = (mode: AgentMode, label: string) => (
      <button
        type="button"
        data-testid={`agent-mode-${mode}`}
        aria-pressed={v?.mode === mode}
        onClick={() => rounds?.onSetMode(mode)}
        style={{
          padding: '1px 8px',
          border: `1px solid ${theme.color.border.regular}`,
          background: v?.mode === mode ? theme.color.primary.main : 'transparent',
          color: v?.mode === mode ? '#fff' : theme.color.text.primary,
          cursor: 'pointer',
        }}
      >
        {label}
      </button>
    );
    const n = v?.steps.length ?? 0;
    return (
      <div data-testid="agent-strip">
        <div style={box}>
          <span aria-hidden>🤖</span>
          <span data-testid="agent-strip-text">
            Agent connected: <b>{status.client.name}</b>, since {since}. Every step it takes shows here.
            {waiting && (
              <span data-testid="agent-strip-waiting">
                {' '}<b>It is waiting for you</b> to pick the graph type and calibrate this figure.
              </span>
            )}
          </span>
          <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            {v && (
              <span role="group" aria-label="How the agent works" style={{ display: 'flex' }}>
                {segment('rounds', `In rounds of ${v.size}`)}
                {segment('automatic', 'Automatic')}
              </span>
            )}
            {v && (v.paused ? (
              <button type="button" data-testid="agent-resume" onClick={rounds!.onResume}>Resume</button>
            ) : (
              <button type="button" data-testid="agent-pause" onClick={rounds!.onPause}>Pause</button>
            ))}
            <button type="button" data-testid="agent-disconnect" onClick={onDisconnect}>
              Disconnect
            </button>
          </span>
        </div>
        {v && (v.paused || v.waiting || (v.mode === 'rounds' && n > 0)) && (
          <div
            data-testid="agent-round"
            style={{ ...box, background: v.waiting || v.paused ? theme.color.background.selectedRow : theme.color.background.panel }}
          >
            <span data-testid="agent-round-text" style={{ minWidth: 0, flex: 1 }}>
              {v.paused ? (
                <><b>Paused.</b> The agent&apos;s next step waits until you resume.</>
              ) : v.waiting ? (
                <><b>The agent has taken {n} {n === 1 ? 'step' : 'steps'} and is waiting for you.</b></>
              ) : (
                <>Round: {n} of {v.size} {v.size === 1 ? 'step' : 'steps'}.</>
              )}
              {n > 0 && (
                <span data-testid="agent-round-steps" style={{ color: theme.color.text.secondary }}>
                  {' '}{v.steps.map((s, i) => `${i + 1}. ${s}`).join(' · ')}
                </span>
              )}
            </span>
            {v.waiting && !v.paused && (
              <span style={{ display: 'flex', gap: 6 }}>
                <button type="button" data-testid="agent-approve" onClick={rounds!.onApprove}>Approve and continue</button>
                <button
                  type="button"
                  data-testid="agent-undo-round"
                  disabled={rounds!.undoRoundDisabled !== null}
                  title={rounds!.undoRoundDisabled ?? `Take back these ${n} steps`}
                  onClick={rounds!.onUndoRound}
                >
                  Undo this round
                </button>
                <button type="button" data-testid="agent-continue-automatically" onClick={rounds!.onContinueAutomatically}>
                  Continue automatically
                </button>
              </span>
            )}
          </div>
        )}
        {v && v.waiting && !v.paused && rounds!.undoRoundDisabled && (
          <div data-testid="agent-undo-round-reason" style={{ ...box, fontSize: theme.font.size.small, color: theme.color.text.secondary }}>
            {rounds!.undoRoundDisabled}
          </div>
        )}
      </div>
    );
  }
  if (status.blocked) {
    return (
      <div data-testid="agent-strip" style={box}>
        <span aria-hidden>🤖</span>
        <span data-testid="agent-strip-text">Agent disconnected. No agent can connect again until you let it.</span>
        <button type="button" data-testid="agent-allow-reconnect" onClick={onAllowReconnect} style={{ marginLeft: 'auto' }}>
          Let it reconnect
        </button>
      </div>
    );
  }
  return null;
}
