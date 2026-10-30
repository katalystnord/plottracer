import React, { useEffect, useState } from 'react';
import { theme } from '../theme.js';
import { work } from '../work.js';
import type { WorkView } from '../../../engine/workRegister.js';

/**
 * The ring in the status bar's lower right corner (Ring A, David 2026-10-20). David, 2026-10-30: it is there all the
 * time, with no text beside it, and runs only while a long-running operation does. Standing still it is the faint
 * track alone; running, a teal arc turns round it, or fills to the share done when the work knows its total. What
 * counts as running is decided in engine/workRegister.ts. Where the system asks for reduced motion the arc holds still.
 */
const R = 6;
const CIRCUMFERENCE = 2 * Math.PI * R;
const CSS = `@keyframes pt-ring-turn { to { transform: rotate(360deg); } }
.pt-ring-turning { animation: pt-ring-turn 0.9s linear infinite; transform-origin: 50% 50%; }
@media (prefers-reduced-motion: reduce) { .pt-ring-turning { animation: none; } }`;

export function StatusRing(): React.ReactElement {
  const [view, setView] = useState<WorkView | null>(() => work.view());
  useEffect(() => work.subscribe(() => setView(work.view())), []);
  const running = view !== null;
  const share = view && view.total ? Math.min(1, Math.max(0, (view.done ?? 0) / view.total)) : null;
  return (
    <>
    <style>{CSS}</style>
    <svg
      data-testid="status-ring"
      data-state={running ? 'running' : 'still'}
      role="status"
      aria-label={running ? 'Working' : 'Idle'}
      width={14}
      height={14}
      viewBox="0 0 16 16"
      style={{ flexShrink: 0, display: 'block' }}
    >
      <circle cx="8" cy="8" r={R} fill="none" stroke={theme.color.primary.main} strokeOpacity={0.25} strokeWidth="2" />
      {running && share === null && (
        <path className="pt-ring-turning" d="M8 2 A6 6 0 0 1 14 8" fill="none" stroke={theme.color.primary.main} strokeWidth="2" strokeLinecap="round" />
      )}
      {running && share !== null && (
        <circle
          data-testid="status-ring-share"
          cx="8"
          cy="8"
          r={R}
          fill="none"
          stroke={theme.color.primary.main}
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={`${share * CIRCUMFERENCE} ${CIRCUMFERENCE}`}
          transform="rotate(-90 8 8)"
        />
      )}
    </svg>
    </>
  );
}
