/**
 * AUTOMATIC GRAPH EXTRACTION (BETA): WHICH CARD SHOWS AT EACH STEP - decided here, rendered in
 * `ui/` (docs/v2.7-figure-type.md; the workflow and every card are David's, 2026-10-16/18).
 *
 * After capture the user chooses between automatic and manual extraction. Manual is today's walk.
 * Automatic is a chain of steps; nothing is read or extracted until the user asks for it, and
 * whatever the automatic path offers is accepted by the user before it counts.
 *
 * Pure, like `calibrationCardModel.ts`: the flow is a value, the events are values, and the card
 * each step shows is a function of them, so every case is a millisecond unit test.
 */

/** Graph types with an automatic workflow (David, 2026-10-18); every other type clicked in the
 * automatic path gets the apology card. */
export const AUTOMATIC_TYPES: readonly string[] = ['xy', 'bar', 'histogram'];

export type AutoFlow =
  /** Captured (or not yet), and neither path chosen. */
  | { path: 'unchosen' }
  | { path: 'manual' }
  | { path: 'automatic'; step: 'type' }
  /** A type with no automatic workflow was clicked. */
  | { path: 'automatic'; step: 'apology'; type: string }
  | { path: 'automatic'; step: 'axes' };

export type AutoEvent =
  | { kind: 'automatic' }
  /** "Go to manual guided extraction", or the apology card's "Continue with manual guided extraction". */
  | { kind: 'manual' }
  /** A graph type clicked on the Graph type card during the automatic path. */
  | { kind: 'type'; type: string }
  | { kind: 'back-to-types' }
  /** "Leave automatic extraction": the manual path, keeping everything accepted so far. */
  | { kind: 'leave' }
  | { kind: 'previous' };

export function nextAutoFlow(f: AutoFlow, e: AutoEvent): AutoFlow {
  switch (e.kind) {
    case 'manual':
    case 'leave':
      return { path: 'manual' };
    case 'automatic':
      return f.path === 'unchosen' ? { path: 'automatic', step: 'type' } : f;
    case 'type':
      if (f.path !== 'automatic' || f.step !== 'type') return f;
      return AUTOMATIC_TYPES.includes(e.type) ? { path: 'automatic', step: 'axes' } : { path: 'automatic', step: 'apology', type: e.type };
    case 'back-to-types':
      return f.path === 'automatic' && f.step === 'apology' ? { path: 'automatic', step: 'type' } : f;
    case 'previous':
      return f.path === 'automatic' && f.step === 'axes' ? { path: 'automatic', step: 'type' } : f;
  }
}

export interface AutoExtractionView {
  /** "Graph extraction": [Try automatic graph extraction (beta)] / [Go to manual guided extraction]. */
  choiceCard: boolean;
  /** Today's calibration card (the manual path). */
  calibrationCard: boolean;
  /** The italic line under "Calibration" on the manual path, or null. */
  manualHint: string | null;
  /** The full Graph type card is open. */
  graphTypeCardOpen: boolean;
  /** The step guide card in the lower right corner of the canvas, or null. */
  stepGuide: { instruction: string; leave: string } | null;
  /** The apology card in the centre of the canvas, or null. */
  apology: { text: string; back: string; manual: string } | null;
  /** The axes card (in the calibration card's place). */
  axesCard: boolean;
  /** The axes card's own leave button text, or null where no card carries one. */
  leave: string | null;
  /** [< Previous] [Next >] on the card. */
  previousNext: boolean;
}

export function autoExtractionView(f: AutoFlow, figureCaptured: boolean): AutoExtractionView {
  const none: AutoExtractionView = {
    choiceCard: false, calibrationCard: false, manualHint: null, graphTypeCardOpen: false, stepGuide: null,
    apology: null, axesCard: false, leave: null, previousNext: false,
  };
  if (!figureCaptured) return { ...none, calibrationCard: true }; // today's "Capture figure first"
  switch (f.path) {
    case 'unchosen':
      return { ...none, choiceCard: true };
    case 'manual':
      return { ...none, calibrationCard: true, manualHint: 'Start by selecting the appropriate graph type.' };
    case 'automatic':
      if (f.step === 'type') {
        return { ...none, graphTypeCardOpen: true, stepGuide: { instruction: 'Please select graph type.', leave: 'Leave automatic extraction' } };
      }
      if (f.step === 'apology') {
        return {
          ...none,
          apology: {
            text: 'Apologies, but we have not yet implemented an automatic extraction for this graph type.',
            back: 'Back to graph type selection',
            manual: 'Continue with manual guided extraction',
          },
        };
      }
      return { ...none, axesCard: true, leave: 'Leave automatic extraction mode', previousNext: true };
  }
}
