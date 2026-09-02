import { describe, it, expect } from 'vitest';
import { guidanceTipBase } from '../guidanceTip.js';
import { resolveKeyDown, type KeyboardState } from '../keyboardActions.js';
import {
  inertWhileMarksHidden,
  marksToggleLabel,
  MARKS_HIDDEN_REASON,
} from '../marksVisibility.js';

/**
 * Named for the CASE, not the function (CLAUDE.md gate 2). The design David
 * settled in conversation on 2026-09-02 was: one button, marks all off at once,
 * hidden means inert, and the tools that cannot act must READ as inactive.
 * Each of those is an observable outcome, so each gets a test of its own here.
 */
describe('hiding every mark at once', () => {
  it('with the marks shown, every tool works exactly as before', () => {
    for (const mode of ['pan', 'calibrate', 'place-point', 'select', 'eraser', 'error-bars', 'measure']) {
      expect(inertWhileMarksHidden(mode, false)).toBe(false);
    }
  });

  it('with the marks hidden, a tool that places points is inert', () => {
    expect(inertWhileMarksHidden('place-point', true)).toBe(true);
  });

  it('with the marks hidden, a tool that grabs or erases marks is inert', () => {
    expect(inertWhileMarksHidden('select', true)).toBe(true);
    expect(inertWhileMarksHidden('eraser', true)).toBe(true);
    expect(inertWhileMarksHidden('error-bars', true)).toBe(true);
  });

  it('with the marks hidden, calibrating is inert too - its reticles are marks', () => {
    expect(inertWhileMarksHidden('calibrate', true)).toBe(true);
  });

  /**
   * ⚑⚑ THE ONE EXCEPTION, AND IT IS THE POINT OF THE FEATURE. Hiding the marks
   * is how you look at the figure; a look mode you cannot move around in would
   * be worse than no button at all. Pan places nothing and grabs nothing, so it
   * is not "working on it" in the sense David's answer excluded.
   */
  it('PAN still works while the marks are hidden - you are still looking', () => {
    expect(inertWhileMarksHidden('pan', true)).toBe(false);
  });

  it('showing the marks again revives every tool, with nothing left latched', () => {
    for (const mode of ['calibrate', 'place-point', 'select', 'eraser', 'measure']) {
      expect(inertWhileMarksHidden(mode, true)).toBe(true);
      expect(inertWhileMarksHidden(mode, false)).toBe(false);
    }
  });

  /**
   * ⚠️ A greyed tool with no explanation is the "invisible precondition"
   * failure: the button looks dead and nothing on screen says what would revive
   * it. Every other disabledReason in the rail names its unlock, so this one
   * must name the toggle.
   */
  it('a greyed tool says WHY it is greyed, and names what would revive it', () => {
    expect(MARKS_HIDDEN_REASON).toMatch(/hidden/i);
    expect(MARKS_HIDDEN_REASON).toMatch(/show/i);
  });

  /**
   * The button carries both the state and the way out. Neither half alone is
   * enough - see `marksToggleLabel`'s own memo.
   */
  it('the button says which state it is in AND how to leave it', () => {
    expect(marksToggleLabel(false)).toMatch(/hide/i);
    const hidden = marksToggleLabel(true);
    expect(hidden).toMatch(/hidden/i);
    expect(hidden).toMatch(/show/i);
  });

  /**
   * ⚠️⚑⚑ THE SURFACE THE DESIGN DID NOT NAME. The rail greys the moment the
   * marks go, but the tips bar went on reading "Point 2 selected - arrows nudge,
   * Q/W step points, Del removes it. Or click to add another" over a figure
   * where not one of those does anything. Found by LOOKING at a screenshot of
   * the finished feature: every test written from the design was about the
   * canvas and the rail, and both were correct.
   *
   * ⚑ It overrides even the category-axis message, which already overrides
   * everything else - while the marks are hidden no click does anything at all,
   * so every other sentence describes a gesture the app will ignore.
   */
  it('the tips bar stops instructing, and names the way back', () => {
    const tip = guidanceTipBase({
      canvasHasImage: true,
      marksHidden: true,
      mode: 'place-point',
      figureCaptured: true,
      isCalibrated: true,
    } as Parameters<typeof guidanceTipBase>[0]);
    expect(tip).toMatch(/hidden/i);
    expect(tip).toMatch(/bring them back|show/i);
    expect(tip).not.toMatch(/nudge|click to add|Del removes/i);
  });

  it('it outranks even the category-axis message, which outranks the rest', () => {
    const tip = guidanceTipBase({
      canvasHasImage: true,
      marksHidden: true,
      categoryAxisUnplaced: true,
      mode: 'place-point',
      figureCaptured: false,
      isCalibrated: false,
    } as Parameters<typeof guidanceTipBase>[0]);
    expect(tip).toMatch(/hidden/i);
    expect(tip).not.toMatch(/category axis/i);
  });

  /**
   * ⚑⚑ H IS THE SHORTCUT, AND IT IS THE ONE KEY THAT MUST SURVIVE THE STATE IT
   * CREATES. David asked whether the button should have one; a shortcut ALONGSIDE
   * a visible control is the "once fluent, is he fast?" half of the persona, and
   * it stays discoverable because the button names it in its own tooltip.
   */
  const keyState = (over: Partial<KeyboardState> = {}): KeyboardState =>
    ({
      mode: 'place-point',
      canvasHasImage: true,
      figureCaptured: true,
      isCalibrated: true,
      hasAnyPoints: () => true,
      activePointIndex: 0,
      selectedPointCount: 0,
      pendingMeasureCount: 0,
      ...over,
    }) as KeyboardState;

  const press = (key: string, over: Partial<KeyboardState> = {}) =>
    resolveKeyDown({ key, shiftKey: false, ctrlKey: false, metaKey: false, targetIsTextField: false }, keyState(over))
      ?.action ?? null;

  it('H hides the marks, and H shows them again', () => {
    expect(press('h')).toEqual({ type: 'toggle-marks' });
    expect(press('H', { marksHidden: true })).toEqual({ type: 'toggle-marks' });
  });

  it('H does nothing before there is a figure to hide marks on', () => {
    expect(press('h', { canvasHasImage: false })).toBeNull();
  });

  /**
   * ⚠️⚑⚑ THE THIRD DOOR, AND THE WORST OF THE THREE. The rail greys and the
   * stage ignores presses, but this handler is wired straight to the window - so
   * the arrows went on nudging a point nobody can see and Del went on deleting
   * it. Silent data mutation with nothing on screen to show for it is strictly
   * worse than the visible half it accompanies.
   */
  it('the arrows cannot nudge a point that is not on screen', () => {
    expect(press('ArrowLeft')).not.toBeNull(); // shown: nudging works
    expect(press('ArrowLeft', { marksHidden: true })).toEqual({ type: 'consume' });
  });

  it('Delete cannot remove a point that is not on screen', () => {
    expect(press('Delete', { marksHidden: true })).toEqual({ type: 'consume' });
  });

  it('the tool digits are inert too, matching the greyed rail', () => {
    expect(press('3')).toEqual({ type: 'set-mode', mode: 'place-point' });
    expect(press('3', { marksHidden: true })).toEqual({ type: 'consume' });
  });

  /**
   * ⚑ Undo and redo stay live because their top-bar buttons are NOT greyed by
   * this feature - the keyboard must agree with what the screen offers.
   */
  it('undo still works, because its button is still lit', () => {
    const a = resolveKeyDown(
      { key: 'z', shiftKey: false, ctrlKey: true, metaKey: false, targetIsTextField: false },
      keyState({ marksHidden: true })
    );
    expect(a?.action).toEqual({ type: 'undo' });
  });
});
