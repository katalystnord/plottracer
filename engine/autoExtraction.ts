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
  | { kind: 'previous' }
  /** [Accept graph axis points]. Interim, until the tick marks acceptance and the legend step exist:
   * the calibration is done, and the walk hands over to the manual path, keeping everything. */
  | { kind: 'accepted' };

export function nextAutoFlow(f: AutoFlow, e: AutoEvent): AutoFlow {
  switch (e.kind) {
    case 'manual':
    case 'leave':
      return { path: 'manual' };
    case 'accepted':
      return f.path === 'automatic' && f.step === 'axes' ? { path: 'manual' } : f;
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

/** A button and the explanation under it. */
export interface ExplainedButton {
  label: string;
  explanation: string;
}

export interface AutoExtractionView {
  /** "Graph extraction workflow" (David, 2026-10-18), or null. Only the manual button is the teal
   * primary one: the automatic one "is experimental for now". */
  choiceCard: {
    title: string;
    automatic: ExplainedButton & { primary: boolean };
    manual: ExplainedButton & { primary: boolean };
  } | null;
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
  /** The automatic path's calibration card (David, 2026-10-18), or null: under its foldable header, a
   * row of [< Previous] [Leave automatic extraction mode] [Reset calibration], then [Read graph axis]
   * and [Accept graph axis points], each with its explanation. No Next: Accept moves the walk on. */
  axesCard: { leave: string; read: ExplainedButton; accept: ExplainedButton } | null;
}

// ⚑ The four explanations are Claude's wording, built to be seen and changed (docs/v2.7-figure-type.md,
// "Still open"); the titles, labels and layout are David's.
const CHOICE: NonNullable<AutoExtractionView['choiceCard']> = {
  title: 'Graph extraction workflow',
  automatic: {
    label: 'Try automatic graph extraction (beta)',
    primary: false,
    explanation: 'Experimental: PlotTracer suggests the graph type and reads the axes for you to check and accept. Not every graph type is supported yet.',
  },
  manual: {
    label: 'Go to manual guided extraction',
    primary: true,
    explanation: 'You choose the graph type and click the calibration points yourself. Works for every graph type.',
  },
};
const AXES: NonNullable<AutoExtractionView['axesCard']> = {
  leave: 'Leave automatic extraction mode',
  read: { label: 'Read graph axis', explanation: 'Finds the tick marks and labels on both axes and suggests the calibration.' },
  accept: {
    label: 'Accept graph axis points',
    explanation: 'Calibrates with the suggestion and moves on to the next step. Select an axis point first to adjust it.',
  },
};

export function autoExtractionView(f: AutoFlow, figureCaptured: boolean): AutoExtractionView {
  const none: AutoExtractionView = {
    choiceCard: null, calibrationCard: false, manualHint: null, graphTypeCardOpen: false, stepGuide: null,
    apology: null, axesCard: null,
  };
  if (!figureCaptured) return { ...none, calibrationCard: true }; // today's "Capture figure first"
  switch (f.path) {
    case 'unchosen':
      return { ...none, choiceCard: CHOICE };
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
      return { ...none, axesCard: AXES };
  }
}
