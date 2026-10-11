import { theme } from '../theme.js';
import type { AgentStatus } from '../electronApi.js';

/**
 * The connected-agent strip (v2.7, M3): while an agent is connected the screen
 * says which one and since when, and offers Disconnect. After a Disconnect it
 * says the agent is kept out, and offers the way back - so being disconnected is
 * never a hidden state.
 */
export function AgentStrip({ status, waiting = false, onDisconnect, onAllowReconnect }: {
  status: AgentStatus | null;
  /** M7: the agent asked for a step this figure is not calibrated for. */
  waiting?: boolean;
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
    return (
      <div data-testid="agent-strip" style={box}>
        <span aria-hidden>🤖</span>
        <span data-testid="agent-strip-text">
          Agent connected: <b>{status.client.name}</b>, since {since}. Every step it takes shows here.
          {waiting && (
            <span data-testid="agent-strip-waiting">
              {' '}<b>It is waiting for you</b> to pick the graph type and calibrate this figure.
            </span>
          )}
        </span>
        <button type="button" data-testid="agent-disconnect" onClick={onDisconnect} style={{ marginLeft: 'auto' }}>
          Disconnect
        </button>
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
