import { describe, it, expect } from 'vitest';
import {
  resolveKeyDown,
  resolveDigit,
  nudgeDelta,
  stepSelectablePoint,
  isNudgeRelease,
  type KeyPress,
  type KeyboardState,
  type KeyAction,
} from '../keyboardActions.js';

/**
 * ORDER IS THE BEHAVIOUR here, so most of these assert PRECEDENCE - which
 * branch wins when two could claim the same key - and the mode gating that
 * stops a stale selection acting from the wrong tool (the v0.6.0 finding).
 */

function press(key: string, over: Partial<KeyPress> = {}): KeyPress {
  return { key, shiftKey: false, ctrlKey: false, metaKey: false, targetIsTextField: false, ...over };
}

function state(over: Partial<KeyboardState> = {}): KeyboardState {
  return {
    mode: 'place-point',
    measureTool: null,
    figureCaptured: true,
    canvasHasImage: true,
    isCalibrated: true,
    hasCropRect: false,
    cropMode: false,
    ctxMenuOpen: false,
    settingScale: false,
    pendingMeasureCount: 0,
    selectedPointCount: 0,
    activePointIndex: null,
    activeHandleKey: null,
    hasActiveMeasure: false,
    canvasScale: 1,
    dataPointRoles: () => [],
    autoExtractKind: 'curve',
    hasAnyPoints: () => true,
    ...over,
  };
}

/** The action a press resolves to, or null when the handler ignores it. */
const act = (e: KeyPress, s: KeyboardState): KeyAction | null => resolveKeyDown(e, s)?.action ?? null;

describe('a text field owns its own keys', () => {
  it('ignores EVERY binding while typing - including undo', () => {
    // A rename field's own Ctrl+Z should undo typing, not roll back the whole
    // digitization; and a digit typed into a value box is not a tool switch.
    const typing = { targetIsTextField: true };
    for (const e of [press('3', typing), press('z', { ...typing, ctrlKey: true }), press('Delete', typing), press('Escape', typing), press('ArrowUp', typing)]) {
      expect(resolveKeyDown(e, state({ activePointIndex: 0 })), e.key).toBeNull();
    }
  });
});

describe('the derived state is asked for only when a branch needs it', () => {
  // ⚑ Both suppliers walk the session. Calling them on every keydown would
  // rebuild a points-length array once per keystroke typed into a rename field
  // - work the text-field bail throws away a moment later. The original handler
  // read them inside their own branches, and this is what keeps that true.
  function counted(over: Partial<KeyboardState> = {}) {
    const calls = { roles: 0, points: 0 };
    const s = state({
      dataPointRoles: () => {
        calls.roles++;
        return [null];
      },
      hasAnyPoints: () => {
        calls.points++;
        return true;
      },
      ...over,
    });
    return { s, calls };
  }

  it('touches neither while typing in a text field', () => {
    const { s, calls } = counted();
    resolveKeyDown(press('w', { targetIsTextField: true }), s);
    resolveKeyDown(press('6', { targetIsTextField: true }), s);
    expect(calls).toEqual({ roles: 0, points: 0 });
  });

  it('touches neither for an ordinary editing key', () => {
    const { s, calls } = counted({ activePointIndex: 0 });
    resolveKeyDown(press('ArrowUp'), s);
    resolveKeyDown(press('Escape'), s);
    resolveKeyDown(press('0'), s);
    expect(calls).toEqual({ roles: 0, points: 0 });
  });

  it('asks for the roles only on Q/W, and the point count only on 6', () => {
    const { s, calls } = counted();
    resolveKeyDown(press('w'), s);
    expect(calls).toEqual({ roles: 1, points: 0 });
    resolveKeyDown(press('6'), s);
    expect(calls).toEqual({ roles: 1, points: 1 });
  });
});

describe('undo / redo, and why every other Ctrl key is left alone', () => {
  it('binds Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z and Ctrl/Cmd+Y', () => {
    expect(act(press('z', { ctrlKey: true }), state())).toEqual({ type: 'undo' });
    expect(act(press('z', { metaKey: true }), state())).toEqual({ type: 'undo' });
    expect(act(press('z', { ctrlKey: true, shiftKey: true }), state())).toEqual({ type: 'redo' });
    expect(act(press('Z', { ctrlKey: true, shiftKey: true }), state())).toEqual({ type: 'redo' });
    expect(act(press('y', { ctrlKey: true }), state())).toEqual({ type: 'redo' });
  });

  it('leaves every OTHER modified key to the native menu accelerators', () => {
    // ⚑ This is what makes KEYBOARD ZOOM work: the View menu already binds
    // CmdOrCtrl+Equal/-/0/1. A renderer copy would DOUBLE-fire, and worse, the
    // modified digit would fall through to the bare-digit chain - Ctrl+1 would
    // switch to Calibrate and Ctrl+3 would act on a data point.
    for (const key of ['1', '3', '0', '=', '-', 'a']) {
      expect(resolveKeyDown(press(key, { ctrlKey: true }), state()), key).toBeNull();
    }
  });
});

describe('Enter resolves innermost-first', () => {
  it('applies a drawn crop before anything else', () => {
    const s = state({ hasCropRect: true, mode: 'measure', measureTool: 'area', figureCaptured: true, isCalibrated: false });
    expect(act(press('Enter'), s)).toEqual({ type: 'apply-crop' });
  });

  it('finishes an Area polygon before it would run a calibration', () => {
    const s = state({ mode: 'measure', measureTool: 'area', isCalibrated: false });
    expect(act(press('Enter'), s)).toEqual({ type: 'finish-area' });
  });

  it('advances a ready calibration through the button itself', () => {
    const s = state({ isCalibrated: false, figureCaptured: true });
    const r = resolveKeyDown(press('Enter'), s)!;
    expect(r.action).toEqual({ type: 'click', selector: '[data-testid="run-calibration"]' });
    // ⚑ Deferred: the default is only suppressed once the button is known to
    // exist, which the pure resolver cannot see.
    expect(r.preventDefault).toBe('if-present');
  });

  it('does nothing - but still CONSUMES the key - with nothing to accept', () => {
    // 'consume' rather than null: the press belongs to this handler, so no
    // later branch may also claim it.
    expect(act(press('Enter'), state())).toEqual({ type: 'consume' });
  });
});

describe('Escape walks back out one layer at a time', () => {
  const everything = state({
    ctxMenuOpen: true,
    cropMode: true,
    hasCropRect: true,
    settingScale: true,
    pendingMeasureCount: 2,
    mode: 'select',
    selectedPointCount: 3,
    activePointIndex: 1,
    activeHandleKey: 'x1',
    hasActiveMeasure: true,
  });

  it('takes the layers in order, innermost first', () => {
    // Peel one layer per press and check the NEXT one surfaces - the ladder's
    // order IS the contract, so assert the whole sequence rather than one rung.
    const order: Array<[Partial<KeyboardState>, KeyAction['type']]> = [
      [{}, 'close-context-menu'],
      [{ ctxMenuOpen: false }, 'cancel-crop'],
      [{ ctxMenuOpen: false, cropMode: false, hasCropRect: false }, 'abandon-pending-measure'],
      [{ ctxMenuOpen: false, cropMode: false, hasCropRect: false, settingScale: false, pendingMeasureCount: 0 }, 'clear-marquee'],
      [{ ctxMenuOpen: false, cropMode: false, hasCropRect: false, settingScale: false, pendingMeasureCount: 0, selectedPointCount: 0 }, 'clear-active-point'],
      [{ ctxMenuOpen: false, cropMode: false, hasCropRect: false, settingScale: false, pendingMeasureCount: 0, selectedPointCount: 0, activePointIndex: null }, 'clear-active-handle'],
      [{ ctxMenuOpen: false, cropMode: false, hasCropRect: false, settingScale: false, pendingMeasureCount: 0, selectedPointCount: 0, activePointIndex: null, activeHandleKey: null }, 'clear-active-measure'],
    ];
    for (const [peeled, expected] of order) {
      expect(act(press('Escape'), { ...everything, ...peeled })?.type, expected).toBe(expected);
    }
  });

  it('cancels a crop that is armed but not yet drawn', () => {
    expect(act(press('Escape'), state({ cropMode: true, hasCropRect: false }))).toEqual({ type: 'cancel-crop' });
  });

  it('abandons a half-made measurement, and an armed Set-scale with no clicks yet', () => {
    expect(act(press('Escape'), state({ pendingMeasureCount: 1 }))?.type).toBe('abandon-pending-measure');
    expect(act(press('Escape'), state({ settingScale: true }))?.type).toBe('abandon-pending-measure');
  });

  it('consumes the key with nothing left to back out of', () => {
    expect(act(press('Escape'), state())).toEqual({ type: 'consume' });
  });

  it('never reaches the marquee branch from another mode', () => {
    expect(act(press('Escape'), state({ mode: 'place-point', selectedPointCount: 3 }))).toEqual({ type: 'consume' });
  });
});

describe('arrow nudges - which selection the arrows act on', () => {
  it('scales the step to zoom, and makes Shift the COARSE step', () => {
    // One press is ~0.5 SCREEN px at any magnification (WPD's 0.5/zoomRatio).
    expect(nudgeDelta('ArrowLeft', false, 1)).toEqual({ dx: -0.5, dy: 0 });
    expect(nudgeDelta('ArrowRight', true, 1)).toEqual({ dx: 5, dy: 0 });
    expect(nudgeDelta('ArrowUp', false, 2)).toEqual({ dx: 0, dy: -0.25 });
    expect(nudgeDelta('ArrowDown', false, 0.5)).toEqual({ dx: 0, dy: 1 });
  });

  it('survives a zero scale rather than dividing by it', () => {
    expect(nudgeDelta('ArrowUp', false, 0)).toEqual({ dx: 0, dy: -0.5 });
  });

  it('gives the calibration handle priority over a data point', () => {
    // Handle precision matters more than any single point's: recalibrating
    // moves EVERY value (tenet 1).
    const s = state({ activeHandleKey: 'y1', activePointIndex: 4, mode: 'place-point' });
    expect(act(press('ArrowUp'), s)).toEqual({ type: 'nudge-handle', handleKey: 'y1', dx: 0, dy: -0.5 });
  });

  it('nudges a measurement vertex when one is selected', () => {
    expect(act(press('ArrowRight'), state({ hasActiveMeasure: true, mode: 'measure' }))).toEqual({
      type: 'nudge-measure',
      dx: 0.5,
      dy: 0,
    });
  });

  it('moves the whole marquee together in Select', () => {
    expect(act(press('ArrowLeft'), state({ mode: 'select', selectedPointCount: 3 }))).toEqual({
      type: 'nudge-selection',
      dx: -0.5,
      dy: 0,
    });
  });

  it('nudges the single selected point in the data-editing modes only', () => {
    for (const mode of ['place-point', 'interpolate'] as const) {
      expect(act(press('ArrowUp'), state({ mode, activePointIndex: 2 })), mode).toEqual({
        type: 'nudge-point',
        index: 2,
        dx: 0,
        dy: -0.5,
      });
    }
  });

  it('⚑ IGNORES a stale point selection from a mode that does not edit points', () => {
    // The v0.6.0 finding: without this gate a selection lingering from Place
    // Point was silently nudged while the user was in Measure aiming at
    // something else - an edit to the wrong target, with no visible cause.
    for (const mode of ['measure', 'calibrate', 'pan', 'eraser', 'color-trace', 'error-bars'] as const) {
      expect(resolveKeyDown(press('ArrowUp'), state({ mode, activePointIndex: 2 })), mode).toBeNull();
    }
  });
});

describe('Delete - only ever the thing you are actually pointing at', () => {
  it('removes the whole marquee as one step, in Select', () => {
    expect(act(press('Delete'), state({ mode: 'select', selectedPointCount: 2 }))).toEqual({ type: 'delete-selection' });
    expect(act(press('Backspace'), state({ mode: 'select', selectedPointCount: 2 }))).toEqual({ type: 'delete-selection' });
  });

  it('removes the selected point in the data-editing modes', () => {
    expect(act(press('Delete'), state({ mode: 'place-point', activePointIndex: 0 }))).toEqual({ type: 'delete-point' });
    expect(act(press('Backspace'), state({ mode: 'interpolate', activePointIndex: 0 }))).toEqual({ type: 'delete-point' });
  });

  it('⚑ never peels off a point from a mode that is not editing points', () => {
    for (const mode of ['measure', 'calibrate', 'pan', 'select'] as const) {
      expect(resolveKeyDown(press('Backspace'), state({ mode, activePointIndex: 0 })), mode).toBeNull();
    }
  });

  it('removes the active MEASUREMENT, in Measure only', () => {
    expect(act(press('Delete'), state({ mode: 'measure', hasActiveMeasure: true }))).toEqual({ type: 'delete-measurement' });
    // A stale measure selection must not be deletable from elsewhere.
    expect(resolveKeyDown(press('Delete'), state({ mode: 'pan', hasActiveMeasure: true }))).toBeNull();
  });

  it('does nothing at all with nothing selected', () => {
    expect(resolveKeyDown(press('Delete'), state({ mode: 'place-point' }))).toBeNull();
  });
});

describe('Q / W walk the selection', () => {
  it('steps forward on W and back on Q, and wraps around', () => {
    const roles = [null, null, null];
    expect(stepSelectablePoint(roles, 0, 1)).toBe(1);
    expect(stepSelectablePoint(roles, 2, 1)).toBe(0);
    expect(stepSelectablePoint(roles, 0, -1)).toBe(2);
  });

  it('starts at the near end when nothing is selected yet', () => {
    const roles = [null, null, null];
    expect(stepSelectablePoint(roles, null, 1)).toBe(0);
    expect(stepSelectablePoint(roles, null, -1)).toBe(2);
  });

  it('SKIPS derived interpolation samples - you never nudge those', () => {
    // On an interpolation-assist curve this steps anchor to anchor.
    const roles = ['anchor', 'interpolated', 'interpolated', 'anchor'] as const;
    expect(stepSelectablePoint(roles, 0, 1)).toBe(3);
    expect(stepSelectablePoint(roles, 3, 1)).toBe(0);
  });

  it('has nothing to walk when every point is derived', () => {
    expect(stepSelectablePoint(['interpolated', 'interpolated'], null, 1)).toBeNull();
    expect(stepSelectablePoint([], null, 1)).toBeNull();
  });

  it('is wired to q/Q and w/W, and consumes the key when there is nothing to walk', () => {
    const s = state({ dataPointRoles: () => [null, null] });
    expect(act(press('w'), s)).toEqual({ type: 'select-point', index: 0 });
    expect(act(press('W'), s)).toEqual({ type: 'select-point', index: 0 });
    expect(act(press('q'), s)).toEqual({ type: 'select-point', index: 1 });
    expect(act(press('Q'), s)).toEqual({ type: 'select-point', index: 1 });
    expect(act(press('w'), state({ dataPointRoles: () => [] }))).toEqual({ type: 'consume' });
  });

  it('does nothing before the axes exist', () => {
    expect(resolveKeyDown(press('w'), state({ isCalibrated: false, dataPointRoles: () => [null] }))).toBeNull();
  });

  it('⚑ still works while a marquee selection is live - that branch falls THROUGH', () => {
    // The Select branch returns only for arrows and Delete; anything else must
    // carry on down the ladder.
    const s = state({ mode: 'select', selectedPointCount: 2, dataPointRoles: () => [null, null] });
    expect(act(press('w'), s)).toEqual({ type: 'select-point', index: 0 });
  });
});

describe('the digit hotkeys mirror the rail, and each guard matches its button', () => {
  it('maps 0-9 straight down the rail', () => {
    const s = state();
    expect(resolveDigit('0', s)).toEqual({ type: 'set-mode', mode: 'pan' });
    expect(resolveDigit('1', s)).toEqual({ type: 'set-mode', mode: 'calibrate' });
    expect(resolveDigit('2', s)).toEqual({ type: 'toggle-image-edit' });
    expect(resolveDigit('3', s)).toEqual({ type: 'set-mode', mode: 'place-point' });
    expect(resolveDigit('4', s)).toEqual({ type: 'toggle-auto-extract' });
    expect(resolveDigit('5', s)).toEqual({ type: 'select-tool' });
    expect(resolveDigit('6', s)).toEqual({ type: 'toggle-error-bars' });
    expect(resolveDigit('7', s)).toEqual({ type: 'toggle-measure' });
    expect(resolveDigit('8', s)?.type).toBe('click');
    expect(resolveDigit('9', s)?.type).toBe('click');
  });

  it('refuses a key whose button would be greyed', () => {
    expect(resolveDigit('1', state({ figureCaptured: false }))).toBeNull();
    expect(resolveDigit('2', state({ canvasHasImage: false }))).toBeNull();
    expect(resolveDigit('3', state({ isCalibrated: false }))).toBeNull();
    expect(resolveDigit('5', state({ isCalibrated: false }))).toBeNull();
    expect(resolveDigit('6', state({ hasAnyPoints: () => false }))).toBeNull();
    expect(resolveDigit('7', state({ figureCaptured: false }))).toBeNull();
  });

  it('⚑ refuses 4 on a graph type that refuses auto-extract', () => {
    // The rail button is disabled for autoExtractKind 'none' (Box Plot,
    // categorical Line, Pie); the hotkey must not do what the button cannot.
    expect(resolveDigit('4', state({ autoExtractKind: 'none' }))).toBeNull();
    expect(resolveDigit('4', state({ autoExtractKind: undefined }))).toEqual({ type: 'toggle-auto-extract' });
    expect(resolveDigit('4', state({ isCalibrated: false }))).toBeNull();
  });

  it('opens the fly-outs through a button that is NOT disabled', () => {
    // Going through the button is what keeps a disabled panel unopenable by key.
    expect(resolveDigit('8', state())).toEqual({ type: 'click', selector: '[data-testid="curve-fit-trigger"]:not([disabled])' });
    expect(resolveDigit('9', state())).toEqual({ type: 'click', selector: '[data-testid="geometry-trigger"]:not([disabled])' });
  });

  it('leaves Pan always available - it can never be the wrong thing to do', () => {
    expect(resolveDigit('0', state({ figureCaptured: false, canvasHasImage: false, isCalibrated: false }))).toEqual({
      type: 'set-mode',
      mode: 'pan',
    });
  });

  it('has no binding for the destructive tools', () => {
    // Clear-all and the Eraser are deliberately kept out of the 0-9 run.
    for (const key of ['e', 'E', 'Backspace']) {
      expect(resolveDigit(key, state())).toBeNull();
    }
  });

  it('does not suppress the browser default - these keys have none worth taking', () => {
    expect(resolveKeyDown(press('3'), state())!.preventDefault).toBe(false);
  });
});

describe('every branch declares whether the browser default is suppressed', () => {
  // ⚑ preventDefault IS behaviour, not bookkeeping: Backspace navigates back and
  // arrows scroll the page if it is missed. Asserted branch by branch, because a
  // test that only checks the ACTION passes just as happily with it wrong.
  const CASES: Array<[string, KeyPress, KeyboardState, KeyAction['type'], boolean | 'if-present']> = [
    ['undo', press('z', { ctrlKey: true }), state(), 'undo', true],
    ['redo via Y', press('Y', { ctrlKey: true }), state(), 'redo', true],
    ['redo via Shift+Z', press('z', { ctrlKey: true, shiftKey: true }), state(), 'redo', true],
    ['apply crop', press('Enter'), state({ hasCropRect: true }), 'apply-crop', true],
    // Finish-area does not suppress: the Area card's own Finish button owns it.
    ['finish area', press('Enter'), state({ mode: 'measure', measureTool: 'area' }), 'finish-area', false],
    ['run calibration', press('Enter'), state({ isCalibrated: false }), 'click', 'if-present'],
    ['Enter with nothing to accept', press('Enter'), state(), 'consume', false],
    ['close quick menu', press('Escape'), state({ ctxMenuOpen: true }), 'close-context-menu', true],
    ['cancel crop', press('Escape'), state({ cropMode: true }), 'cancel-crop', true],
    ['abandon pending', press('Escape'), state({ settingScale: true }), 'abandon-pending-measure', true],
    ['clear marquee', press('Escape'), state({ mode: 'select', selectedPointCount: 1 }), 'clear-marquee', true],
    ['clear point', press('Escape'), state({ activePointIndex: 0 }), 'clear-active-point', true],
    ['clear handle', press('Escape'), state({ activeHandleKey: 'x1' }), 'clear-active-handle', true],
    ['clear measure', press('Escape'), state({ hasActiveMeasure: true }), 'clear-active-measure', true],
    ['Escape with nothing left', press('Escape'), state(), 'consume', false],
    // Deferred: these two only suppress once their target is known to exist.
    ['nudge handle', press('ArrowDown'), state({ activeHandleKey: 'x1' }), 'nudge-handle', 'if-present'],
    ['nudge point', press('ArrowDown'), state({ activePointIndex: 1 }), 'nudge-point', 'if-present'],
    ['nudge measure', press('ArrowDown'), state({ hasActiveMeasure: true }), 'nudge-measure', true],
    ['nudge marquee', press('ArrowDown'), state({ mode: 'select', selectedPointCount: 2 }), 'nudge-selection', true],
    ['delete marquee', press('Delete'), state({ mode: 'select', selectedPointCount: 2 }), 'delete-selection', true],
    ['delete point', press('Delete'), state({ activePointIndex: 0 }), 'delete-point', true],
    ['delete measurement', press('Delete'), state({ mode: 'measure', hasActiveMeasure: true }), 'delete-measurement', true],
    ['step point', press('w'), state({ dataPointRoles: () => [null] }), 'select-point', true],
    ['step with nothing to walk', press('w'), state({ dataPointRoles: () => [] }), 'consume', false],
    ['a tool digit', press('7'), state(), 'toggle-measure', false],
  ];

  for (const [name, e, s, type, preventDefault] of CASES) {
    it(name, () => {
      const r = resolveKeyDown(e, s);
      expect(r, name).not.toBeNull();
      expect(r!.action.type).toBe(type);
      expect(r!.preventDefault).toBe(preventDefault);
    });
  }
});

describe('the conjunctions that decide which branch claims a key', () => {
  it('finishes an Area polygon only when BOTH the mode and the tool say so', () => {
    expect(act(press('Enter'), state({ mode: 'measure', measureTool: 'slope' }))).toEqual({ type: 'consume' });
    expect(act(press('Enter'), state({ mode: 'place-point', measureTool: 'area' }))).toEqual({ type: 'consume' });
  });

  it('acts on the marquee only in Select - a selection count elsewhere is stale', () => {
    // In Place Point the arrows must reach the SINGLE selected point instead.
    const s = state({ mode: 'place-point', selectedPointCount: 3, activePointIndex: 1 });
    expect(act(press('ArrowUp'), s)?.type).toBe('nudge-point');
    expect(resolveKeyDown(press('Delete'), state({ mode: 'place-point', selectedPointCount: 3 }))).toBeNull();
  });

  it('needs an actual point selected before an arrow means "nudge"', () => {
    expect(resolveKeyDown(press('ArrowUp'), state({ mode: 'place-point', activePointIndex: null }))).toBeNull();
  });

  it('recognises all four arrows, not just the ones with obvious deltas', () => {
    for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
      expect(act(press(key), state({ activePointIndex: 0 }))?.type, key).toBe('nudge-point');
    }
  });
});

describe('the nudge commits once, on release', () => {
  it('fires only for arrows, and only when a nudge is actually pending', () => {
    // One undo step per gesture, not per event - a held key auto-repeating
    // must still collapse to one.
    expect(isNudgeRelease('ArrowUp', true)).toBe(true);
    expect(isNudgeRelease('ArrowUp', false)).toBe(false);
    expect(isNudgeRelease('a', true)).toBe(false);
    expect(isNudgeRelease('Shift', true)).toBe(false);
  });
});
