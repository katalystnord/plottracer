import type { ToolMode } from './toolMode.js';
import type { PointRole } from './calibrationSession.js';
import type { AxesTypeConfig, CalibratedAxes } from './axesTypeConfigs.js';

/**
 * WHICH action a keypress means. Performing it stays in `Workspace.tsx`.
 *
 * ⚑ WHY THIS MOVED OUT (v2.1, the Workspace split). The keydown handler is not
 * a lookup table, it is a PRECEDENCE LADDER: Enter and Escape each resolve
 * innermost-first, and every editing key is gated on the mode that owns it. The
 * gating is not decoration - it is a v0.6.0 release-gate finding. Without it a
 * data-point selection left over from Place Point was silently nudged or
 * deleted by arrows/Del while the user was in Measure aiming at something else:
 * a wrong-target edit with no visible cause.
 *
 * That ladder is ~15 ordered branches whose ORDER is the behaviour, and until
 * now the only way to exercise any of it was to launch Electron and press a
 * key. Splitting the decision from the doing makes the order itself assertable.
 *
 * The split is deliberate about where the line falls: this file answers "what
 * did the user ask for", never "how is it carried out". Anything needing the
 * session, the DOM or a ref is returned as an ACTION for the effect to perform.
 */

/** The parts of a KeyboardEvent a decision can depend on. */
export interface KeyPress {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  /** Focus is in an INPUT/TEXTAREA/contenteditable - resolved by the caller,
   * since only the DOM knows. */
  targetIsTextField: boolean;
}

export interface KeyboardState {
  mode: ToolMode;
  measureTool: string | null;
  figureCaptured: boolean;
  canvasHasImage: boolean;
  /**
   * Every overlay mark is hidden, so the canvas is inert (v2.5).
   *
   * ⚑⚑ THE KEYBOARD IS A THIRD DOOR INTO THE SAME ROOM, and it does not go
   * through the canvas at all. The rail greys its tools and the stage ignores
   * presses, but this handler is wired straight to the window - so without this
   * field the arrow keys went on nudging a point you cannot see and Del went on
   * deleting it. Silent data mutation with nothing on screen to show for it,
   * which is strictly worse than the visible half it accompanies.
   *
   * ⚠️ Found by asking what ELSE reaches the model while the marks are off,
   * after a screenshot caught the tips bar doing the same thing. Two surfaces
   * missed by the same omission: the design named the canvas and the rail, so
   * the tests did too.
   */
  marksHidden?: boolean;
  /** The axes are built - `session.getAxes()` is non-null. */
  isCalibrated: boolean;
  /** A crop rectangle has been drawn and awaits Apply. */
  hasCropRect: boolean;
  cropMode: boolean;
  /** The canvas quick menu is open. */
  ctxMenuOpen: boolean;
  settingScale: boolean;
  pendingMeasureCount: number;
  selectedPointCount: number;
  activePointIndex: number | null;
  activeHandleKey: string | null;
  hasActiveMeasure: boolean;
  /** Live canvas zoom, so one press is ~0.5 SCREEN px at any magnification. */
  canvasScale: number;
  /**
   * Roles of the active series' points, for the Q/W walk.
   *
   * ⚑ A SUPPLIER, not an array, and the same for `hasAnyPoints` below. Both are
   * derived by walking the session, and the ladder needs them only when Q/W or
   * the `6` key is actually pressed. Passing values would rebuild a
   * points-length array on every keydown -- including every keystroke typed
   * into a rename field, which the text-field bail discards a moment later.
   * The original handler read them inside their own branches; the type is how
   * that stays true after the split.
   */
  dataPointRoles: () => readonly (PointRole | null)[];
  autoExtractKind: AxesTypeConfig<CalibratedAxes>['autoExtractKind'];
  /** Any series has at least one point - the Error bars button's own guard. */
  hasAnyPoints: () => boolean;
}

export type KeyAction =
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'apply-crop' }
  | { type: 'finish-area' }
  | { type: 'cancel-crop' }
  | { type: 'close-context-menu' }
  | { type: 'abandon-pending-measure' }
  | { type: 'clear-marquee' }
  | { type: 'clear-active-point' }
  | { type: 'clear-active-handle' }
  | { type: 'clear-active-measure' }
  | { type: 'nudge-handle'; handleKey: string; dx: number; dy: number }
  | { type: 'nudge-measure'; dx: number; dy: number }
  | { type: 'nudge-selection'; dx: number; dy: number }
  | { type: 'nudge-point'; index: number; dx: number; dy: number }
  | { type: 'delete-selection' }
  | { type: 'delete-point' }
  | { type: 'delete-measurement' }
  | { type: 'select-point'; index: number }
  | { type: 'set-mode'; mode: ToolMode }
  | { type: 'select-tool' }
  | { type: 'toggle-image-edit' }
  | { type: 'toggle-auto-extract' }
  | { type: 'toggle-error-bars' }
  | { type: 'toggle-measure' }
  | { type: 'toggle-marks' }
  /** Fire a rail/panel button by test id - the fly-outs open through their own
   * button so a disabled one cannot be triggered by key. */
  | { type: 'click'; selector: string }
  /** The press belongs to this handler and does nothing further. Distinct from
   * `null`: it stops the ladder, so a later branch cannot also claim the key. */
  | { type: 'consume' };

export interface ResolvedKey {
  action: KeyAction;
  /** Whether the browser default must be suppressed. `'if-present'` defers to
   * the caller, for the branches that only act when their target exists. */
  preventDefault: boolean | 'if-present';
}

const ARROWS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];

function isArrow(key: string): boolean {
  return ARROWS.includes(key);
}

function isDelete(key: string): boolean {
  return key === 'Delete' || key === 'Backspace';
}

/** Ctrl on Windows/Linux, Cmd on macOS. */
function primaryMod(e: KeyPress): boolean {
  return e.ctrlKey || e.metaKey;
}

/**
 * The arrow-key step, scaled to zoom so one press is ~0.5 SCREEN px at any
 * magnification (WPD's own 0.5/zoomRatio), Shift for a coarse 10x.
 *
 * ⚑ Shift is the COARSE step. Reversed, the help card would still read
 * plausibly while telling the user the opposite of the truth.
 */
export function nudgeDelta(key: string, shiftKey: boolean, canvasScale: number): { dx: number; dy: number } {
  const step = (shiftKey ? 5 : 0.5) / (canvasScale || 1);
  return {
    dx: key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0,
    dy: key === 'ArrowUp' ? -step : key === 'ArrowDown' ? step : 0,
  };
}

/**
 * Q/W walk the selection between points - previous (Q), next (W) - so a point
 * placed earlier is reachable by keyboard, not only by clicking.
 *
 * Derived interpolation samples are SKIPPED (you never nudge those), so on an
 * interpolation-assist curve this steps anchor-to-anchor; in Interpolate mode a
 * click ADDS an anchor, so Q/W is the only way to re-select an existing one.
 * Wraps around. Returns null when there is nothing to walk.
 */
export function stepSelectablePoint(
  roles: readonly (PointRole | null)[],
  current: number | null,
  dir: 1 | -1
): number | null {
  const selectable: number[] = [];
  for (let i = 0; i < roles.length; i++) if (roles[i] !== 'interpolated') selectable.push(i);
  if (selectable.length === 0) return null;
  const cur = current != null ? selectable.indexOf(current) : -1;
  const nextPos = cur === -1 ? (dir === 1 ? 0 : selectable.length - 1) : (cur + dir + selectable.length) % selectable.length;
  return selectable[nextPos]!;
}

/**
 * Digit hotkeys mirror the rail order (v0.8, 0-based). Each guard matches its
 * button's `disabled` so a key cannot do what the greyed button cannot.
 *
 * Hotkeys 0-9 run straight down the rail (2026-07-22 redesign): 0 Pan ·
 * 1 Calibrate · 2 Edit img · 3 Add · 4 Auto-extract · 5 Select · 6 Error bars ·
 * 7 Measure · 8 Curve fit · 9 Geometry. Curve Fit (8) / Geometry (9) are fly-out
 * panels: opened by triggering their rail button, skipped when disabled.
 * Clear-all (top bar) and the Eraser have NO key - both destructive, kept out of
 * the 0-9 run.
 */
export function resolveDigit(key: string, s: KeyboardState): KeyAction | null {
  if (key === '0') return { type: 'set-mode', mode: 'pan' };
  if (key === '1' && s.figureCaptured) return { type: 'set-mode', mode: 'calibrate' };
  if (key === '2' && s.canvasHasImage) return { type: 'toggle-image-edit' };
  if (key === '3' && s.isCalibrated) return { type: 'set-mode', mode: 'place-point' };
  if (key === '4' && s.isCalibrated && (s.autoExtractKind ?? 'curve') !== 'none') return { type: 'toggle-auto-extract' };
  // Hotkey 5 activates Select with the current sub-mode but does NOT open the
  // picker (that's the rail button / its arrow) -- see 'select-tool'.
  if (key === '5' && s.isCalibrated) return { type: 'select-tool' };
  if (key === '6' && s.hasAnyPoints()) return { type: 'toggle-error-bars' };
  if (key === '7' && s.figureCaptured) return { type: 'toggle-measure' };
  if (key === '8') return { type: 'click', selector: '[data-testid="curve-fit-trigger"]:not([disabled])' };
  if (key === '9') return { type: 'click', selector: '[data-testid="geometry-trigger"]:not([disabled])' };
  return null;
}

/**
 * The ladder. Returns null when the press is not this handler's business.
 *
 * ⚑ ORDER IS THE BEHAVIOUR. Read it top-down; every early return is a claim
 * that this branch outranks everything below it.
 */
export function resolveKeyDown(e: KeyPress, s: KeyboardState): ResolvedKey | null {
  // Inside a text field, let the browser's own text undo/redo and typed digits
  // win -- both the numbered tool shortcuts and app-level undo are suppressed
  // here, deliberately (a rename field's own Ctrl+Z should undo typing, not
  // roll back the whole digitization).
  if (e.targetIsTextField) return null;

  // Undo/redo (checkpoint 38): Ctrl/Cmd+Z, and Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y
  // for redo -- the exact bindings Ketcher's own undo action uses.
  if (primaryMod(e) && (e.key === 'z' || e.key === 'Z')) {
    return { action: e.shiftKey ? { type: 'redo' } : { type: 'undo' }, preventDefault: true };
  }
  if (primaryMod(e) && (e.key === 'y' || e.key === 'Y')) {
    return { action: { type: 'redo' }, preventDefault: true };
  }
  // Any OTHER primary-modified key belongs to the native menu accelerators, NOT
  // to the renderer tool/nav shortcuts below -- so bail here. This is what makes
  // KEYBOARD ZOOM work: the View menu already binds CmdOrCtrl+Equal/-/0/1 to
  // menu:zoom-in/out/fit/100 (electron-menu.cjs), wired to the canvas in
  // ImageCanvas (onMenuEvent). A renderer copy of those bindings would
  // DOUBLE-fire (menu accelerator + this keydown) and, worse, the modified digit
  // would fall through to the bare-digit tool chain below (Ctrl+1 -> Calibrate,
  // Ctrl+3 -> delete a point). Guarding here fixes both.
  if (primaryMod(e)) return null;

  // ⚑⚑ H HIDES AND SHOWS EVERY MARK (v2.5). A bare letter, which is this app's
  // convention for a tool key (q/w already are), and it is DISCOVERABLE because
  // the button names it in its own tooltip - a shortcut whose only home is the
  // keyboard fails the "can only use what he sees" rule outright.
  // ⚑ Placed above the inert gate below so it is the one key that always works:
  // the way OUT of a state must never be the thing the state disables.
  if (e.key === 'h' || e.key === 'H') {
    return s.canvasHasImage ? { action: { type: 'toggle-marks' }, preventDefault: true } : null;
  }

  // ⚑⚑ WHILE THE MARKS ARE HIDDEN, NOTHING ELSE ACTS. Consume rather than return
  // null, so no branch below can claim the key: the arrows, Del, the digits and
  // Enter all reach the model without touching the canvas, and every one of them
  // would change a figure the user cannot currently see. Undo/redo are already
  // handled above and stay live, matching their top-bar buttons, which this
  // feature does not grey.
  if (s.marksHidden === true) return { action: { type: 'consume' }, preventDefault: false };

  // Enter = accept/confirm the current step's primary action (David, mouse+
  // keyboard theme). Value-in-a-box Enter is handled by each input's own
  // onKeyDown (and this handler already returned above when a text field has
  // focus) -- this branch is the "highlighted box": the primary button of
  // whatever step is on screen. Precedence is innermost-first.
  if (e.key === 'Enter') {
    // A drawn crop rectangle awaiting its "Apply" bar.
    if (s.hasCropRect) return { action: { type: 'apply-crop' }, preventDefault: true };
    // An in-progress Area polygon: Enter finishes it (its own "Finish" button).
    if (s.mode === 'measure' && s.measureTool === 'area') {
      return { action: { type: 'finish-area' }, preventDefault: false };
    }
    // A fully-placed-but-not-yet-run calibration: Enter is the "Calibrate"
    // button, triggered through the button itself. It is only in the DOM when a
    // run is actually available, so this can only ever advance a ready one.
    if (s.figureCaptured && !s.isCalibrated) {
      return { action: { type: 'click', selector: '[data-testid="run-calibration"]' }, preventDefault: 'if-present' };
    }
    return { action: { type: 'consume' }, preventDefault: false };
  }

  // Esc = back out of the current step (David), innermost-first. Each branch
  // undoes exactly one layer of in-progress state, so repeated Esc walks back
  // out: pending gesture -> selection -> (nothing). It never discards recorded
  // data -- only abandons half-made input or clears a selection. (Open MUI
  // popovers/menus close on Escape via their own onClose before this runs.)
  if (e.key === 'Escape') {
    // The canvas quick menu is open: close it and stop (MUI also closes it on
    // Escape, but handle it here so Esc doesn't ALSO clear a selection).
    if (s.ctxMenuOpen) return { action: { type: 'close-context-menu' }, preventDefault: true };
    // A crop being drawn/awaiting-Apply: cancel it (unarms crop mode too).
    if (s.cropMode || s.hasCropRect) return { action: { type: 'cancel-crop' }, preventDefault: true };
    // A half-made measurement or an armed Set-scale: abandon the pending clicks.
    if (s.settingScale || s.pendingMeasureCount > 0) {
      return { action: { type: 'abandon-pending-measure' }, preventDefault: true };
    }
    // Otherwise clear whatever single thing is selected. Only one of these is
    // ever set at a time (each self-clears on mode change), so order is moot.
    if (s.mode === 'select' && s.selectedPointCount > 0) {
      return { action: { type: 'clear-marquee' }, preventDefault: true };
    }
    if (s.activePointIndex != null) return { action: { type: 'clear-active-point' }, preventDefault: true };
    if (s.activeHandleKey != null) return { action: { type: 'clear-active-handle' }, preventDefault: true };
    if (s.hasActiveMeasure) return { action: { type: 'clear-active-measure' }, preventDefault: true };
    return { action: { type: 'consume' }, preventDefault: false };
  }

  // Keyboard CALIBRATION-HANDLE adjustment (checkpoint 127): nudge the selected
  // handle with the arrows. updateCalibPointPixel re-runs calibration live, so
  // every data value updates as the handle moves -- the reason handle precision
  // matters more than any single point's (tenet 1). Checked before the data-point
  // branch since the two selections are mutually exclusive.
  if (s.activeHandleKey != null && isArrow(e.key)) {
    const { dx, dy } = nudgeDelta(e.key, e.shiftKey, s.canvasScale);
    return {
      action: { type: 'nudge-handle', handleKey: s.activeHandleKey, dx, dy },
      preventDefault: 'if-present',
    };
  }

  // Keyboard MEASUREMENT-VERTEX adjustment (checkpoint 128): nudge the selected
  // measurement point; its value re-derives from the pixels (ckpt 82), so the
  // card and on-canvas label update live.
  if (s.hasActiveMeasure && isArrow(e.key)) {
    const { dx, dy } = nudgeDelta(e.key, e.shiftKey, s.canvasScale);
    return { action: { type: 'nudge-measure', dx, dy }, preventDefault: true };
  }

  // The Select tool acts on the whole marquee SELECTION (David 2026-07-21):
  // arrows nudge every selected point together, Del removes them all as ONE undo
  // step, Esc clears the selection (handled in the ladder above). Gated on select
  // mode + a non-empty selection, so a stale selection never acts from another
  // mode. ⚑ Falls THROUGH on any other key -- Q/W below must still work here.
  if (s.mode === 'select' && s.selectedPointCount > 0) {
    if (isArrow(e.key)) {
      const { dx, dy } = nudgeDelta(e.key, e.shiftKey, s.canvasScale);
      return { action: { type: 'nudge-selection', dx, dy }, preventDefault: true };
    }
    if (isDelete(e.key)) return { action: { type: 'delete-selection' }, preventDefault: true };
  }

  // Data-point arrow-nudge and Del are gated to the modes where you actually
  // EDIT data points -- Place Point and Interpolate -- and only there does the
  // tips bar advertise them. Without this gate a data-point selection lingering
  // from Place Point would be silently nudged/deleted by arrows/Del while the
  // user is in Measure/Calibrate/etc. aiming at something else (a silent
  // wrong-target edit). Release-gate audit finding, v0.6.0.
  const dataPointEditing = s.mode === 'place-point' || s.mode === 'interpolate';

  // The precision path WPD leans on. We move the PIXEL and let the value derive
  // (tenet 9), through the very method a drag uses. Commit is deferred to keyup
  // so a burst -- or a held key auto-repeating -- collapses to ONE undo step.
  if (dataPointEditing && s.activePointIndex != null && isArrow(e.key)) {
    const { dx, dy } = nudgeDelta(e.key, e.shiftKey, s.canvasScale);
    return {
      action: { type: 'nudge-point', index: s.activePointIndex, dx, dy },
      preventDefault: 'if-present',
    };
  }

  // Delete the selected point -- only when one is EXPLICITLY selected AND in a
  // data-editing mode, so a stray Backspace never silently peels off a point
  // while you are aiming at a measurement or a calibration handle.
  if (dataPointEditing && isDelete(e.key) && s.activePointIndex != null) {
    return { action: { type: 'delete-point' }, preventDefault: true };
  }

  // Del also removes the active *measurement* -- the on-canvas "line" (David:
  // "remove currently active point or line"). Gated on measure mode + an explicit
  // active selection, the same discipline as the point delete above.
  if (s.mode === 'measure' && s.hasActiveMeasure && isDelete(e.key)) {
    return { action: { type: 'delete-measurement' }, preventDefault: true };
  }

  if (s.isCalibrated && (e.key === 'q' || e.key === 'Q' || e.key === 'w' || e.key === 'W')) {
    const dir = e.key === 'w' || e.key === 'W' ? 1 : -1;
    const index = stepSelectablePoint(s.dataPointRoles(), s.activePointIndex, dir);
    if (index === null) return { action: { type: 'consume' }, preventDefault: false };
    return { action: { type: 'select-point', index }, preventDefault: true };
  }

  const digit = resolveDigit(e.key, s);
  // ⚑ The digit chain does NOT preventDefault, matching the original: these keys
  // carry no browser default worth suppressing, and a digit typed into a field
  // never reaches here (the text-field bail is the first branch).
  return digit ? { action: digit, preventDefault: false } : null;
}

/** Commit the nudge once, on release -- one undo step per gesture, not per event. */
export function isNudgeRelease(key: string, nudgePending: boolean): boolean {
  return nudgePending && isArrow(key);
}
