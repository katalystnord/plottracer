/**
 * Trace Challenge — all game UI (v1.2), rendered over the normal workspace and
 * driven entirely by props from Workspace (which owns the game state + round
 * setup). Four phases: `intro` (rules modal), `playing` (a floating HUD with the
 * round counter, live timer, instruction and Done), `reveal` (a non-blocking
 * result card so the true-answer overlay stays visible on the figure), and
 * `results` (fireworks + total + high-score table with name entry).
 */
import { useState, useEffect } from 'react';
import { theme } from './theme.js';
import { Fireworks } from './Fireworks.js';
import type { RoundScore } from '../../algorithms/challengeScore.js';
import type { HighScore } from './challengeScores.js';

export type ChallengePhase = 'intro' | 'playing' | 'reveal' | 'results';

export interface ChallengeOverlayProps {
  phase: ChallengePhase;
  roundIndex: number; // 0-based
  roundCount: number;
  instruction: string;
  /** Timestamp (ms) the current round started -- the HUD ticks its OWN clock off
   * this so the timer never re-renders the whole Workspace (that made every click
   * feel laggy during a round). */
  roundStartMs: number;
  lastScore: RoundScore | null;
  totalAdjusted: number;
  highScores: HighScore[];
  qualifies: boolean;
  onConfirmStart: () => void;
  onCancel: () => void;
  onDone: () => void;
  onNext: () => void;
  onSaveHighScore: (name: string) => void;
  onFinish: () => void;
}

function fmtClock(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}
function fmtSecs(s: number): string {
  return `${s.toFixed(1)}s`;
}

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
  padding: 20,
  width: 440,
  maxHeight: '80vh',
  overflow: 'auto',
  fontFamily: theme.font.family,
  color: theme.color.text.primary,
  position: 'relative',
};
const primaryBtn: React.CSSProperties = {
  padding: '8px 16px',
  borderRadius: 6,
  border: 'none',
  background: theme.color.primary.main,
  color: '#fff',
  cursor: 'pointer',
  fontWeight: 600,
  fontFamily: theme.font.family,
};
const ghostBtn: React.CSSProperties = {
  padding: '8px 16px',
  borderRadius: 6,
  border: `1px solid ${theme.color.border.regular}`,
  background: theme.color.background.primary,
  color: theme.color.text.primary,
  cursor: 'pointer',
  fontFamily: theme.font.family,
};

export function ChallengeOverlay(props: ChallengeOverlayProps) {
  const { phase } = props;
  if (phase === 'intro') return <Intro {...props} />;
  if (phase === 'playing') return <Hud {...props} />;
  if (phase === 'reveal') return <Reveal {...props} />;
  return <Results {...props} />;
}

function Intro({ roundCount, onConfirmStart, onCancel }: ChallengeOverlayProps) {
  return (
    <div style={backdrop} data-testid="challenge-intro">
      <div style={card}>
        <strong style={{ fontSize: 20 }}>🎯 The Trace Challenge</strong>
        <div style={{ fontSize: theme.font.size.regular, lineHeight: 1.6, margin: '12px 0 16px' }}>
          <p style={{ margin: '0 0 8px' }}>
            You&apos;ll get <strong>{roundCount}</strong> figures, each already calibrated. For each one, read the
            instruction, <strong>trace it by placing points</strong>, then hit <strong>Done</strong>.
          </p>
          <p style={{ margin: '0 0 8px' }}>
            You&apos;re racing the clock — and every error <em>adds</em> time. Miss a point, place it sloppily, or leave a
            curve half-traced and seconds pile on. <strong>Lowest total time wins.</strong>
          </p>
          <p style={{ margin: 0, color: theme.color.text.legend }}>
            Use whatever tools you like — auto-trace by colour, flood-fill, guide points or by hand. Ready?
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" style={ghostBtn} data-testid="challenge-cancel" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" style={primaryBtn} data-testid="challenge-confirm" onClick={onConfirmStart}>
            Start the challenge
          </button>
        </div>
      </div>
    </div>
  );
}

function Hud({ roundIndex, roundCount, instruction, roundStartMs, onDone }: ChallengeOverlayProps) {
  // The HUD owns the ticking clock -- a local interval re-renders ONLY this
  // component, so the timer never re-renders the whole Workspace (that made
  // every canvas click feel laggy mid-round).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, []);
  const elapsedMs = Math.max(0, now - roundStartMs);
  return (
    <div
      data-testid="challenge-hud"
      style={{
        position: 'fixed',
        top: 60,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 1100,
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '8px 14px',
        borderRadius: 999,
        background: theme.color.background.primary,
        border: `1px solid ${theme.color.border.regular}`,
        boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
        fontFamily: theme.font.family,
        color: theme.color.text.primary,
        maxWidth: '86%',
      }}
    >
      <span style={{ fontWeight: 700, whiteSpace: 'nowrap' }} data-testid="challenge-round">
        Round {roundIndex + 1}/{roundCount}
      </span>
      <span
        data-testid="challenge-timer"
        style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: theme.color.primary.main, whiteSpace: 'nowrap' }}
      >
        ⏱ {fmtClock(elapsedMs)}
      </span>
      <span style={{ color: theme.color.text.secondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {instruction}
      </span>
      <button type="button" style={{ ...primaryBtn, padding: '6px 14px' }} data-testid="challenge-done" onClick={onDone}>
        Done
      </button>
    </div>
  );
}

function penaltyLine(label: string, seconds: number) {
  if (seconds <= 0.001) return null;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', color: theme.color.text.secondary }}>
      <span>{label}</span>
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>+{fmtSecs(seconds)}</span>
    </div>
  );
}

function Reveal({ roundIndex, roundCount, lastScore, onNext }: ChallengeOverlayProps) {
  const s = lastScore;
  const isLast = roundIndex + 1 >= roundCount;
  return (
    <div
      data-testid="challenge-reveal"
      style={{
        position: 'fixed',
        bottom: 44,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 1100,
        width: 320,
        padding: 16,
        borderRadius: 10,
        background: theme.color.background.primary,
        border: `1px solid ${theme.color.border.regular}`,
        boxShadow: '0 6px 24px rgba(0,0,0,0.22)',
        fontFamily: theme.font.family,
        color: theme.color.text.primary,
      }}
    >
      <div style={{ fontSize: theme.font.size.small, color: theme.color.text.legend, marginBottom: 4 }}>
        The true answer is shown on the figure.
      </div>
      {s && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
            <span style={{ fontWeight: 700 }}>Round time</span>
            <span data-testid="challenge-round-adjusted" style={{ fontSize: 22, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
              {fmtSecs(s.adjustedSeconds)}
            </span>
          </div>
          <div style={{ fontSize: theme.font.size.small, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: theme.color.text.secondary }}>
              <span>Traced in</span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtSecs(s.rawSeconds)}</span>
            </div>
            {penaltyLine('Position error', s.breakdown.errorSeconds)}
            {penaltyLine('Under-traced', s.breakdown.coverageSeconds)}
            {penaltyLine(`Missed (${s.breakdown.misses})`, s.breakdown.missSeconds)}
            {penaltyLine(`Extra (${s.breakdown.extras})`, s.breakdown.extraSeconds)}
          </div>
        </>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
        <button type="button" style={primaryBtn} data-testid="challenge-next" onClick={onNext}>
          {isLast ? 'See results →' : 'Next round →'}
        </button>
      </div>
    </div>
  );
}

function Results({ roundCount, totalAdjusted, highScores, qualifies, onSaveHighScore, onFinish }: ChallengeOverlayProps) {
  const [name, setName] = useState('');
  const [saved, setSaved] = useState(false);
  const showEntry = qualifies && !saved;
  return (
    <div style={backdrop} data-testid="challenge-results">
      <div style={card}>
        <Fireworks />
        <div style={{ position: 'relative' }}>
          <strong style={{ fontSize: 20 }}>🏁 Challenge complete</strong>
          <div style={{ textAlign: 'center', margin: '16px 0' }}>
            <div style={{ fontSize: theme.font.size.small, color: theme.color.text.legend }}>
              Total adjusted time · {roundCount} rounds
            </div>
            <div data-testid="challenge-total" style={{ fontSize: 40, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
              {fmtSecs(totalAdjusted)}
            </div>
          </div>

          {showEntry && (
            <div
              data-testid="challenge-qualify"
              style={{
                background: theme.color.background.canvas,
                borderRadius: 8,
                padding: 12,
                marginBottom: 12,
                display: 'flex',
                gap: 8,
                alignItems: 'center',
                flexWrap: 'wrap',
              }}
            >
              <span style={{ fontWeight: 600 }}>🎉 High score! Enter your name:</span>
              <input
                data-testid="challenge-name"
                value={name}
                autoFocus
                maxLength={24}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                style={{
                  flex: 1,
                  minWidth: 120,
                  padding: '6px 8px',
                  borderRadius: 6,
                  border: `1px solid ${theme.color.border.regular}`,
                  fontFamily: theme.font.family,
                }}
              />
              <button
                type="button"
                style={primaryBtn}
                data-testid="challenge-save-score"
                onClick={() => {
                  onSaveHighScore(name);
                  setSaved(true);
                }}
              >
                Save
              </button>
            </div>
          )}

          <div style={{ fontSize: theme.font.size.small, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: theme.color.text.legend, marginBottom: 6 }}>
            Best times
          </div>
          <ol data-testid="challenge-highscores" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {highScores.length === 0 && <li style={{ color: theme.color.text.legend }}>No scores yet — you&apos;re first!</li>}
            {highScores.map((h, i) => (
              <li
                key={i}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: '4px 6px',
                  borderRadius: 4,
                  background: i % 2 ? 'transparent' : theme.color.background.canvas,
                }}
              >
                <span style={{ display: 'flex', gap: 8 }}>
                  <span style={{ color: theme.color.text.legend, width: 18 }}>{i + 1}.</span>
                  <span style={{ fontWeight: 600 }}>{h.name}</span>
                  <span style={{ color: theme.color.text.legend }}>{h.date}</span>
                </span>
                <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{fmtSecs(h.adjustedSeconds)}</span>
              </li>
            ))}
          </ol>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
            <button type="button" style={primaryBtn} data-testid="challenge-finish" onClick={onFinish}>
              Finish
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
