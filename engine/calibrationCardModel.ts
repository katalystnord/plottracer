/**
 * WHAT THE CALIBRATION CARD SHOWS - decided here, rendered in `ui/`.
 *
 * ⚑⚑ WHY THIS FILE EXISTS. David, 2026-08-17: *"the biggest aim here is
 * CONSISTENCY across all code, and moving code out to where it can be tested."*
 * The card's decisions lived as conditions inside `Workspace.tsx` - 21
 * `heatmapActive` branches alone - where **mutation testing cannot see them at
 * all** and the only other instrument is an 18-minute Electron run. So they
 * diverged: three graph types grew three different second stages, three endings
 * and three folded lines, each locally reasonable.
 *
 * This is the `refactor 4` method, applied to a card instead of a hook: move the
 * BODY into a pure engine function and leave the component rendering it. Every
 * case below is a unit test that runs in milliseconds.
 *
 * ⚑⚑ THE MODEL - every calibrated type is TWO STAGES:
 *   1. calibrate the axes, ending with **Calibrate**;
 *   2. read what those axes make readable, ending with **Read cells** /
 *      **Read categories**.
 * A type with no second stage (XY, polar, ternary, map, CCR, spider, pie,
 * histogram) simply finishes at stage 1. Which types have one is DECLARED
 * (`AxesTypeConfig.secondStage`), never asked by id.
 *
 * ⚑⚑ ONE AT A TIME WHILE WORKING, BOTH AT ONCE WHEN REVIEWING. David: *"when we
 * are running the calibration we see them one at the time"* and *"if we unfold
 * the calibrated calibration card, we see both steps information at once."*
 * Those are not in tension: unfolding a FINISHED card is a different act from
 * unfolding a WORKING one. While you work, the card is a WORKSPACE and shows the
 * step you are on; once done it is a RECORD and shows everything it recorded.
 */

/** Which stage the card is in. */
export type CardStage =
  /** No figure captured - nothing to calibrate yet. */
  | 'capture'
  /** Walking the calibration steps. */
  | 'calibrating'
  /** Axes calibrated; the second stage is unfinished. */
  | 'second-stage'
  /** Everything this type asks for is done. */
  | 'done';

export interface CalibrationCardInput {
  /** The type's declared second stage, or undefined if it has none. */
  /** The type's declared second stage. `done` is what the FOLDED line calls the
   * finished stage where that is not a count of readings - see the field's own
   * note on `AxesTypeConfig.secondStage`. */
  secondStage?: { label: string; ending: string; done?: string | undefined; precondition?: string | undefined } | undefined;
  figureCaptured: boolean;
  calibrated: boolean;
  /** How many calibration points are placed, and how many the walk asks for. */
  placed: number;
  steps: number;
  /** Has the second stage produced its reading? False when there is no second
   * stage - the card is done at calibration. */
  secondStageComplete: boolean;
  /** What the second stage reports once complete - "25 cells read". Blank until
   * then. Supplied by the caller, which is the only thing that has it. */
  secondStageSummary?: string;
  /** Has the user opened the card? A FINISHED card is folded by default. */
  expanded: boolean;
}

export interface CalibrationCardModel {
  stage: CardStage;
  /** The single line a folded, finished card shows. */
  foldedLine: {
    title: string;
    /** "Calibrated ✓", or "3/8 set" while walking. */
    status: string;
    /** "25 cells read ✓", or null for a type with no second stage. */
    secondStage: string | null;
  };
  /**
   * Which sections the body shows. Nothing shows under a FOLDED card: the arrow
   * and the content cannot disagree (David, 2026-11-07: the arrow said folded
   * while the Categories controls showed). Both true only on a finished,
   * unfolded card - the review view.
   */
  showsWalk: boolean;
  showsSecondStage: boolean;
  /**
   * Whether the heading carries the second stage's COUNT ("5 categories",
   * "5 × 5 cells") beside "Calibrated ✓": while you are in that stage, and on a
   * finished card opened to change it, where a boundary added changes the size.
   * Folded and done, `foldedLine.secondStage` stands there alone.
   */
  headingShowsCount: boolean;
  /**
   * The grey line naming the next stage, last on an open card while the axes are
   * being calibrated ("Categories: next, after Calibrate"), or null.
   *
   * ⚑⚑ ONE STAGE AT A TIME MUST NOT MEAN A HIDDEN NEXT STEP. The card's own
   * history records the cost: *"A greyed control says 'this is what comes next';
   * a missing one says nothing at all."* So the next stage is named while you
   * calibrate, after the calibration's own settings, and from Calibrate on its
   * ending stands on the heading, folded or not.
   */
  nextStageLine: string | null;
  /** The button that ends the CURRENT stage, or null when there is nothing to
   * end. Its words come from the type, because reading CELLS through a colour
   * key and reading CATEGORIES off an axis are not the same measurement. */
  ending: string | null;
}

/**
 * The card, from the session's own state.
 *
 * ⚑ Pure: no React, no DOM, no session object - just the facts the card turns
 * on. That is what lets every case below be a millisecond-long unit test rather
 * than a screenshot.
 */
export function calibrationCardModel(input: CalibrationCardInput): CalibrationCardModel {
  const {
    secondStage,
    figureCaptured,
    calibrated,
    placed,
    steps,
    secondStageComplete,
    secondStageSummary,
    expanded,
  } = input;

  const stage: CardStage = !figureCaptured
    ? 'capture'
    : !calibrated
      ? 'calibrating'
      : secondStage && !secondStageComplete
        ? 'second-stage'
        : 'done';

  // ⚑ A type with no second stage is DONE at calibration - it never enters
  // 'second-stage', so it cannot show a stage it does not have.
  const done = stage === 'done';

  return {
    stage,
    foldedLine: {
      title: 'Calibration',
      // ⚑⚑ THE WALK, NOT JUST THE AXES (v2.3). This asked only whether an axes
      // object existed, which was the same question as "is the walk finished"
      // right up until a figure could arrive calibrated with steps unplaced -
      // a WPD import, a pre-v2.3 project. Caught on the bench: the card said
      // `Calibrated ✓` while the tips bar said `Calibration step 3/4`, two lines
      // on screen at once disagreeing about whether the job was done. The same
      // stale equivalence that had to be removed from `getCurrentStep`,
      // `getStepIndex` and `handleCalibrationClick`, in the one place left.
      status: calibrated && placed >= steps ? 'Calibrated ✓' : `${placed}/${steps} set`,
      // ⚑ Only once the stage has actually produced something. A label with no
      // reading behind it would assert work that has not happened - the same
      // rule that stops a generated grid being drawn like a measured one.
      // ⚑⚑ THE TYPE'S OWN WORD FIRST. A heatmap's line is a summary of what was
      // READ ("20 cells read"), assembled by the caller from the record; a bar
      // chart's is a statement about the WALK, and David gave it verbatim:
      // "> Calibration *Calibrated check* *categories marked check*". So the
      // type declares `done` and the caller supplies a summary only where there
      // is a reading to summarise. `label` remains the last resort.
      secondStage:
        secondStage && secondStageComplete
          ? `${secondStageSummary ?? secondStage.done ?? secondStage.label} ✓`
          : null,
    },
    // ⚑⚑ ONE AT A TIME WHILE WORKING, BOTH WHEN REVIEWING. The walk shows while
    // walking; the second stage shows while in it; a FINISHED card that the user
    // opens shows both, because at that point it is a record rather than a
    // workspace. And only on an OPEN card (2026-11-07): the heading carries the
    // current step's ending, so folding can hide the controls without hiding it.
    showsWalk: expanded && (stage === 'calibrating' || done),
    showsSecondStage:
      expanded && (stage === 'second-stage' || (done && secondStage !== undefined)),
    headingShowsCount: stage === 'second-stage' || (done && expanded && secondStage !== undefined),
    nextStageLine:
      secondStage && stage === 'calibrating' && expanded
        ? `${secondStage.label}: next, after Calibrate${secondStage.precondition ? `. ${secondStage.precondition}` : ''}`
        : null,
    // ⚑⚑ AND A FINISHED CARD YOU HAVE OPENED OFFERS IT AGAIN. Folded, there is
    // nothing to end - the line is a record. But you opened it in order to
    // change something, and without the action that is the dead end this card
    // already fixed once: *"the grid was gone and Read cells was therefore
    // disabled."* Re-reading is the whole point of the review view.
    ending:
      stage === 'calibrating'
        ? 'Calibrate'
        : stage === 'second-stage' || (done && expanded && secondStage !== undefined)
          ? (secondStage?.ending ?? null)
          : null,
  };
}

/**
 * Does Calibrate leave the card open? Yes when it opens a second stage still to
 * do: the card goes straight into it, arrow ▼ (David, 2026-11-07, approving the
 * three-state layout). Otherwise it folds, as it always has (checkpoint 86).
 */
export function keepsCardOpenAfterCalibrate(
  secondStage: CalibrationCardInput['secondStage'],
  secondStageComplete: boolean
): boolean {
  return secondStage !== undefined && !secondStageComplete;
}

/**
 * Whether [Automatic axis detection] can fill this type's walk (v2.7): X1, X2, Y1, Y2 on x/y axes (XY, Contour,
 * Histogram, and any later type with that walk), or the bar family's value points and its category ticks. Asked of the
 * walk, not of the type's id: the histogram has XY's walk and was greyed only because it was not named (David,
 * 2026-11-08: "why no auto callibration here?"). The heatmap's X2 and Y2 also take its band counts, and its walk goes
 * on to the colour key, which detection does not read.
 */
export function autoAxesApplies(
  config: { id: string; axesKind: string; categoryTicks?: unknown },
  stepKeys: readonly string[]
): boolean {
  const has = (...k: string[]) => k.every((key) => stepKeys.includes(key));
  if (config.axesKind === 'xy' && config.id !== 'heatmap' && has('x1', 'x2', 'y1', 'y2') && stepKeys.length === 4) return true;
  return !!config.categoryTicks && has('c1', 'c2');
}
