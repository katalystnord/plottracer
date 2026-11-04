import type { ReactNode } from 'react';

/**
 * One row of a calibration card's second stage: what it is about on the left, its controls on the right (v2.7;
 * docs/v2.7-workflow-walk.md, "The Categories stage laid out in rows"). The Categories stage and the heatmap's Grid
 * stage both use it, so the two cards mirror.
 */
export function StageRow({ name, testId, children }: { name: string; testId?: string; children: ReactNode }) {
  return (
    <div data-testid={testId} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <span style={{ minWidth: 84 }}>{name}</span>
      {children}
    </div>
  );
}
