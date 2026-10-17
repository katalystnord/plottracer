import React from 'react';
import { theme } from '../theme.js';

/**
 * The SERIES EXTRACTION card - the step after Legend detection (David,
 * 2026-10-17: "it will be the next card in the workflow"), the last of the
 * steps the automated extraction takes: calibration, legend, series.
 *
 * One row per series the accepted legend named: its colour, its name, and the
 * tool that reads it, chosen from the legend's sample and the graph type and
 * changeable. "Read series" runs those EXISTING tools (By colour ▸ Bars, Find
 * lines, By colour ▸ Scattered points) on each series' colour into that series,
 * and each row then says what its tool said. "Accept series read" ends the step.
 *
 * ⚑ Same shape as the legend card, and small until there is a read to show.
 */
export type SeriesMethod = 'bars' | 'lines' | 'points';
export interface SeriesRow {
  index: number;
  name: string;
  colour: [number, number, number] | null;
  method: SeriesMethod;
}
export interface SeriesCardProps {
  expanded: boolean;
  onToggle: () => void;
  rows: SeriesRow[];
  /** Which tools this graph type offers. */
  methods: SeriesMethod[];
  onMethod: (row: number, m: SeriesMethod) => void;
  busy: boolean;
  /** What each row's tool said, once read. */
  results: (string | null)[] | null;
  accepted: boolean;
  onRead: () => void;
  onAccept: () => void;
  endsButton: React.CSSProperties;
}

const LABEL: Record<SeriesMethod, string> = { bars: 'Bars (By colour)', lines: 'Line (Find lines)', points: 'Points (By colour, Scattered points)' };
const hex = (c: readonly number[]) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;

export function SeriesCard(p: SeriesCardProps): React.ReactElement {
  const small = { fontSize: theme.font.size.small, color: theme.color.text.secondary } as const;
  const line = p.accepted
    ? 'Series read accepted. Each series can still be edited as usual; Undo takes a read back.'
    : p.results
      ? 'Read. Check each series on the figure and in the table, then accept the read.'
      : `Read the ${p.rows.length} series the legend named, each with the tool shown.`;
  return (
    <div
      data-testid="series-card"
      style={{
        background: theme.color.background.primary,
        border: `1px solid ${theme.color.border.regular}`,
        borderRadius: 8,
        boxShadow: '0 2px 8px rgba(103, 104, 132, 0.22)',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: '5px 10px',
        maxWidth: 460,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          type="button"
          data-testid="series-fold"
          onClick={p.onToggle}
          title={p.expanded ? 'Fold the card' : 'Unfold the card'}
          style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, fontSize: 12 }}
        >
          {p.expanded ? '▾' : '▸'}
        </button>
        <strong style={{ fontSize: theme.font.size.regular }}>Series extraction</strong>
        {p.accepted && (
          <span data-testid="series-status" style={{ fontSize: theme.font.size.small, color: theme.color.primary.main }}>
            Read ✓
          </span>
        )}
      </div>
      {p.expanded && (
        <>
          <span data-testid="series-line" style={small}>{line}</span>
          {!p.accepted && (
            <div data-testid="series-rows" style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {p.rows.map((r, i) => (
                <span key={r.index} style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                    <span style={{ width: 14, height: 14, borderRadius: 3, border: `1px solid ${theme.color.border.regular}`, background: r.colour ? hex(r.colour) : 'transparent' }} />
                    <span data-testid={`series-row-name-${i}`} style={{ minWidth: 80 }}>{r.name}</span>
                    <select
                      data-testid={`series-row-method-${i}`}
                      value={r.method}
                      disabled={p.busy || !!p.results}
                      onChange={(e) => p.onMethod(i, e.target.value as SeriesMethod)}
                      style={{ fontSize: 12 }}
                    >
                      {p.methods.map((m) => (
                        <option key={m} value={m}>{LABEL[m]}</option>
                      ))}
                    </select>
                  </span>
                  {p.results?.[i] && (
                    <span data-testid={`series-row-result-${i}`} style={{ ...small, marginLeft: 20 }}>{p.results[i]}</span>
                  )}
                </span>
              ))}
            </div>
          )}
          {!p.accepted && (
            <span>
              {!p.results ? (
                <button
                  type="button"
                  data-testid="series-read"
                  onClick={p.onRead}
                  disabled={p.busy || p.rows.some((r) => !r.colour)}
                  title={p.rows.some((r) => !r.colour) ? 'A series has no colour - correct the legend read first' : 'Read every series with its tool'}
                  style={p.busy ? { fontSize: 12 } : p.endsButton}
                >
                  {p.busy ? 'Reading…' : 'Read series'}
                </button>
              ) : (
                <button type="button" data-testid="series-accept" onClick={p.onAccept} style={p.endsButton}>
                  Accept series read
                </button>
              )}
            </span>
          )}
        </>
      )}
    </div>
  );
}
