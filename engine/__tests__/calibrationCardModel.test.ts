import { describe, expect, it } from 'vitest';
import { calibrationCardModel, type CalibrationCardInput } from '../calibrationCardModel.js';
import { ALL_AXES_TYPE_CONFIGS } from '../axesTypeConfigs.js';

/**
 * ⚑⚑ THE CALIBRATION CARD'S CASES, as outcomes rather than conclusions.
 *
 * David's design, 2026-08-17: every calibrated type is two stages - calibrate
 * the axes (ending **Calibrate**), then read what those axes make readable
 * (ending **Read cells** / **Read categories**) - and *"the whole two-stage
 * process should just fold down to one row."*
 *
 * ⚑ These live in `engine/` for the reason the whole refactor exists: the same
 * decisions were conditions inside `Workspace.tsx`, invisible to mutation
 * testing and reachable only by an 18-minute Electron run. That is why three
 * types grew three second stages. Here each case costs a millisecond.
 */

/**
 * ⚠️ `placed` MUST AGREE WITH `calibrated`, and it did not: this said
 * `placed: 3, steps: 8` and every case below then set `calibrated: true` on top
 * of it - a heatmap with three of eight points placed and a working axes object,
 * which the app cannot produce. It went unnoticed while the status line asked
 * only whether axes existed; the moment that line started reading the WALK, the
 * inconsistency baked into the fixture became visible.
 * [[feedback_fixture_blind_by_construction]] - ask what your fixture sets to a
 * value nothing else in it could have produced.
 * ▶ The walk-in-progress cases pass their own `placed` explicitly.
 */
const base: CalibrationCardInput = {
  figureCaptured: true,
  calibrated: false,
  placed: 8,
  steps: 8,
  secondStageComplete: false,
  expanded: true,
};
const GRID = { label: 'Grid', ending: 'Read cells' };

describe('⚑⚑ the card is TWO STAGES, and says which one you are in', () => {
  it('nothing captured yet - there is no calibration to show', () => {
    expect(calibrationCardModel({ ...base, figureCaptured: false }).stage).toBe('capture');
  });

  it('walking stage 1: the walk, ending in Calibrate, and the count as its status', () => {
    // ⚑ Mid-walk, so this case states its own `placed` rather than borrowing the
    // finished base - the two facts have to agree, which is what `base`'s own
    // note is about.
    const m = calibrationCardModel({ ...base, placed: 3, secondStage: GRID });
    expect(m.stage).toBe('calibrating');
    expect(m.ending).toBe('Calibrate');
    expect(m.foldedLine.status).toBe('3/8 set');
    expect(m.showsWalk).toBe(true);
    // ⚑ ONE AT A TIME WHILE WORKING - the second stage is not shown yet even
    // though the type has one, because you are not in it.
    expect(m.showsSecondStage).toBe(false);
  });

  it('stage 1 done, stage 2 open: the SECOND stage only, ending in its own words', () => {
    const m = calibrationCardModel({ ...base, secondStage: GRID, calibrated: true });
    expect(m.stage).toBe('second-stage');
    expect(m.ending).toBe('Read cells');
    expect(m.foldedLine.status).toBe('Calibrated ✓');
    expect(m.showsSecondStage).toBe(true);
    // The walk is behind you; the card stops showing it.
    expect(m.showsWalk).toBe(false);
  });

  it('⚑⚑ both stages done and FOLDED: one line, and nothing to end', () => {
    const m = calibrationCardModel({
      ...base, secondStage: GRID, calibrated: true,
      secondStageComplete: true, secondStageSummary: '25 cells read', expanded: false,
    });
    expect(m.stage).toBe('done');
    expect(m.foldedLine).toEqual({
      title: 'Calibration',
      status: 'Calibrated ✓',
      secondStage: '25 cells read ✓',
    });
    expect(m.ending).toBeNull();
    expect(m.showsWalk).toBe(false);
    expect(m.showsSecondStage).toBe(false);
  });

  it('⚑⚑ both done and UNFOLDED: both stages at once - the review view', () => {
    // ⚑ This is the one that looks like it contradicts "one at a time", and does
    // not: unfolding a FINISHED card is a different act from unfolding a WORKING
    // one. While you work the card is a workspace; once done it is a record.
    const m = calibrationCardModel({
      ...base, secondStage: GRID, calibrated: true,
      secondStageComplete: true, expanded: true,
    });
    expect(m.stage).toBe('done');
    expect(m.showsWalk).toBe(true);
    expect(m.showsSecondStage).toBe(true);
  });
});

describe('⚑⚑ one stage at a time is NOT a hidden next step', () => {
  it('names the second stage while you are still calibrating, without its controls', () => {
    // The card's own history: gating the stage's button on having something to
    // read "removed the button entirely before detection had found anything -
    // the flow lost its visible next step again". A greyed control says what
    // comes next; a missing one says nothing.
    const m = calibrationCardModel({ ...base, secondStage: GRID });
    expect(m.showsSecondStageHeader).toBe(true);
    expect(m.showsSecondStage).toBe(false);
  });

  it('⚑⚑ stays visible while you are IN it, even with the card folded', () => {
    // Finishing the walk auto-folds the card, and stage 2 is the step you are on
    // the instant that happens. Requiring the card to be open would hide the
    // current step behind a fold that just closed on the previous one.
    const m = calibrationCardModel({
      ...base, secondStage: GRID, calibrated: true, expanded: false,
    });
    expect(m.stage).toBe('second-stage');
    expect(m.showsSecondStageHeader).toBe(true);
    expect(m.showsSecondStage).toBe(true);
  });

  it('a type with no second stage never names one', () => {
    expect(calibrationCardModel({ ...base }).showsSecondStageHeader).toBe(false);
  });

  it('and nothing is named before there is a figure to calibrate', () => {
    const m = calibrationCardModel({ ...base, secondStage: GRID, figureCaptured: false });
    expect(m.showsSecondStageHeader).toBe(false);
  });
});

describe('⚑⚑ a finished card you OPEN can still act', () => {
  it('offers the second stage’s ending again in the review view', () => {
    // Folded there is nothing to end. But you opened it to change something, and
    // an opened card with no action is the dead end this card already fixed
    // once: "the grid was gone and Read cells was therefore disabled."
    const m = calibrationCardModel({
      ...base, secondStage: GRID, calibrated: true,
      secondStageComplete: true, expanded: true,
    });
    expect(m.stage).toBe('done');
    expect(m.ending).toBe('Read cells');
  });

  it('and the FOLDED line still has nothing to end', () => {
    const m = calibrationCardModel({
      ...base, secondStage: GRID, calibrated: true,
      secondStageComplete: true, expanded: false,
    });
    expect(m.ending).toBeNull();
  });
});

describe('a type with NO second stage finishes at calibration', () => {
  it('is DONE the moment it is calibrated - it never enters a stage it lacks', () => {
    const m = calibrationCardModel({ ...base, calibrated: true, expanded: false });
    expect(m.stage).toBe('done');
    expect(m.ending).toBeNull();
    expect(m.foldedLine.secondStage).toBeNull();
  });

  it('and cannot be made to show one, however it is unfolded', () => {
    const m = calibrationCardModel({ ...base, calibrated: true, expanded: true });
    expect(m.showsSecondStage).toBe(false);
  });
});

describe('the folded line asserts only what has happened', () => {
  it('⚑ names the second stage only once it has produced a reading', () => {
    // A label with no reading behind it would claim work that has not been done
    // - the same rule that stops a generated grid being drawn like a measured
    // one. Declared-but-unfinished shows nothing.
    const m = calibrationCardModel({ ...base, secondStage: GRID, calibrated: true });
    expect(m.foldedLine.secondStage).toBeNull();
  });

  it('falls back to the stage LABEL when the caller supplies no summary', () => {
    const m = calibrationCardModel({
      ...base, secondStage: GRID, calibrated: true, secondStageComplete: true,
    });
    expect(m.foldedLine.secondStage).toBe('Grid ✓');
  });
});

describe('⚑⚑ EVERY REGISTERED TYPE gets a coherent card - a thirteenth cannot diverge', () => {
  it('is not vacuous - the registry is populated', () => {
    expect(ALL_AXES_TYPE_CONFIGS.length).toBeGreaterThanOrEqual(12);
  });

  for (const config of ALL_AXES_TYPE_CONFIGS) {
    it(`${config.label}: declares a second stage or has none, and the card agrees`, () => {
      const declared = config.secondStage;
      if (declared) {
        // ⚑ A declaration must be usable: both halves non-blank, because both
        // reach the screen - one on the folded line, one on a button.
        expect(declared.label.trim().length).toBeGreaterThan(0);
        expect(declared.ending.trim().length).toBeGreaterThan(0);
      }
      const input: CalibrationCardInput = {
        ...base,
        ...(declared ? { secondStage: declared } : {}),
        calibrated: true,
      };
      const m = calibrationCardModel(input);
      // The whole rule in one assertion: a type with a second stage lands in it
      // once calibrated; a type without one is finished.
      expect(m.stage).toBe(declared ? 'second-stage' : 'done');
      expect(m.ending).toBe(declared ? declared.ending : null);
    });
  }

  it('⚑ the types that declare one are exactly those with a stage to declare', () => {
    // ⚑⚑ PINNED so that adding a declaration is a DECISION rather than a
    // side effect. Bar and Box Plot mark category ticks; the heatmap reads a
    // grid; `categorical` (Line) joined them in v2.3.
    //
    // ⚑ AND THIS ASSERTION DID ITS JOB. It used to read `['bar','boxplot',
    // 'heatmap']` above a comment that said Line *"wants one and deliberately
    // has none yet… that changes when v2.3 moves it onto a banded axis, and this
    // assertion is what will say so."* It said so: moving Line onto the banded
    // axis turned it red, which is what a pin is for - the fourth entry arrives
    // with a reason attached rather than unnoticed.
    const withStage = ALL_AXES_TYPE_CONFIGS.filter((c) => c.secondStage).map((c) => c.id).sort();
    expect(withStage).toEqual(['bar', 'boxplot', 'categorical', 'heatmap']);
  });

  it('⚑ every type that marks CATEGORY TICKS declares the stage that marks them', () => {
    // The two capabilities describe the same work and must not drift apart -
    // `categoryTicks` says where the ticks anchor, `secondStage` says the card
    // has a stage for placing them.
    for (const c of ALL_AXES_TYPE_CONFIGS) {
      if (c.categoryTicks) expect(c.secondStage, `${c.id} marks ticks`).toBeDefined();
    }
  });
});

/**
 * ⚑⚑ THE FOLDED LINE'S WORD COMES FROM THE TYPE - and this case was declared and
 * never read for one commit, which is CLAUDE.md gate 3 in miniature: the field
 * existed, its doc described the behaviour, and nothing enforced it. The e2e
 * caught it at 20 minutes a run; this catches it in a millisecond.
 */
describe('what a finished second stage is CALLED', () => {
  const base = { figureCaptured: true, calibrated: true, placed: 4, steps: 4, expanded: false };

  it("⚑⚑ uses the type's own `done` word - David: \"Categories marked check\"", () => {
    const model = calibrationCardModel({
      ...base,
      secondStage: { label: 'Categories', ending: 'Mark categories', done: 'Categories marked' },
      secondStageComplete: true,
    });
    expect(model.foldedLine.secondStage).toBe('Categories marked ✓');
  });

  it('⚑ a caller-supplied SUMMARY still wins, because a heatmap counts what it read', () => {
    const model = calibrationCardModel({
      ...base,
      secondStage: { label: 'Grid', ending: 'Read cells' },
      secondStageComplete: true,
      secondStageSummary: '20 cells read',
    });
    expect(model.foldedLine.secondStage).toBe('20 cells read ✓');
  });

  it('falls back to the stage LABEL when the type says neither', () => {
    const model = calibrationCardModel({
      ...base,
      secondStage: { label: 'Grid', ending: 'Read cells' },
      secondStageComplete: true,
    });
    expect(model.foldedLine.secondStage).toBe('Grid ✓');
  });

  it('says nothing at all until the stage has actually finished', () => {
    const model = calibrationCardModel({
      ...base,
      secondStage: { label: 'Categories', ending: 'Mark categories', done: 'Categories marked' },
      secondStageComplete: false,
    });
    expect(model.foldedLine.secondStage).toBeNull();
  });
});

/**
 * ⚑⚑ `Calibrated ✓` MEANT "an axes object exists", and that stopped being the
 * same thing as "the walk is finished" the day a figure could arrive
 * part-calibrated - a WPD import, a pre-v2.4 project.
 *
 * ⚠️ CAUGHT ON THE BENCH: the card said `Calibrated ✓` while the tips bar said
 * `Calibration step 3/4 - Cat 1`. Two lines on screen at once, disagreeing about
 * whether the job was done. The same stale equivalence had already been removed
 * from `getCurrentStep`, `getStepIndex` and `handleCalibrationClick`; this was
 * the one place it survived.
 */
describe('the status line reports the WALK, not merely that axes exist', () => {
  const base = { figureCaptured: true, expanded: false, secondStageComplete: false };

  it('⚑⚑ says how many are set while any step is unplaced, even with axes built', () => {
    const model = calibrationCardModel({ ...base, calibrated: true, placed: 2, steps: 4 });
    expect(model.foldedLine.status).toBe('2/4 set');
  });

  it('says Calibrated once every step is placed', () => {
    const model = calibrationCardModel({ ...base, calibrated: true, placed: 4, steps: 4 });
    expect(model.foldedLine.status).toBe('Calibrated ✓');
  });

  it('and still counts up during an ordinary first walk', () => {
    const model = calibrationCardModel({ ...base, calibrated: false, placed: 1, steps: 4 });
    expect(model.foldedLine.status).toBe('1/4 set');
  });
});
