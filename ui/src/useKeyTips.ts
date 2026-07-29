import { createContext, useEffect, useState } from 'react';
import { IS_MAC } from './platform.js';

/**
 * "Hold Alt to see every keyboard route" — v1.6's key-tips (David, referencing
 * ONLYOFFICE / Office KeyTips).
 *
 * ⚑ WHY THIS EXISTS, and it is the keystone rather than decoration. The design
 * keystone lists **shortcut-only paths** as an explicit FAIL: *if the keyboard is the
 * only way, he never sees it.* Every accelerator in the top bar was exactly that —
 * `Ctrl+O`, `Ctrl+S`, the zoom keys — knowable only by already knowing. Badges on
 * demand convert that knowledge into on-screen state without cluttering the default
 * view, which is progressive disclosure in the sense the keystone allows.
 *
 * ⚑ THIS IS WHY THE NATIVE MENU HAD TO GO. Electron's `autoHideMenuBar` spent Alt on
 * revealing the hidden menu bar, so these badges could not exist while it did. Removal
 * on its own would have been a pure regression (see ui/electron-menu.cjs); this is the
 * half that makes it a trade.
 *
 * ⚑ THE BADGE SHOWS THE REAL SHORTCUT, not an Office-style letter you then press.
 * Office KeyTips arm a second, parallel binding set: press Alt, then F for File. That
 * teaches a key sequence that exists nowhere else and tells you nothing about the
 * `Ctrl+S` you already half-remember. Showing the actual accelerator cures the defect
 * we have (an invisible route) instead of adding a second route to learn, and needs no
 * new bindings, no conflict analysis and no mode. If the two-step is ever wanted, it
 * layers on top of this rather than replacing it.
 *
 * ⚑ THE BADGES LATCH (David, seeing it run). Releasing Alt does NOT take them down --
 * they stay until you do something else: press any other key (including the one you
 * just read, or Esc), or reach for the mouse. Holding a modifier down while hunting
 * for a key you have not learnt yet is precisely the position someone consulting the
 * badges is in, so requiring the hold defeats the purpose. Office latches for the same
 * reason.
 *
 * Deliberately does NOT `preventDefault`. With the menu gone Alt does nothing on
 * Windows/Linux, and on macOS Option is a live text-entry modifier (it types special
 * characters) — swallowing it would break typing in every value and rename field to
 * power a hint.
 */
export function useKeyTips(): boolean {
  const [showing, setShowing] = useState(false);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Alt ALONE. A combination that merely includes Alt (AltGr on a European
      // layout is Ctrl+Alt, and it types real characters) is somebody entering text,
      // not asking what the shortcuts are.
      if (e.key === 'Alt' && !e.ctrlKey && !e.metaKey && !e.shiftKey) setShowing(true);
      // ⚑ ...and ANY other key takes them down again. That is the "something else"
      // half of the latch below: pressing the key you just read dismisses the badges
      // as it fires, and Esc dismisses them having done nothing, which is exactly how
      // Office behaves.
      else if (e.key !== 'Alt') setShowing(false);
    }
    // ⚑ Alt+Tab away and the keyup lands in the OTHER window, so without these the
    // badges stay on screen for as long as the app is left alone — the first thing
    // anyone tries after pressing Alt.
    function clear() {
      setShowing(false);
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('blur', clear);
    // A click is "something else" too -- having reached for the mouse, the user is no
    // longer asking what the keyboard can do.
    window.addEventListener('pointerdown', clear);
    document.addEventListener('visibilitychange', clear);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('blur', clear);
      window.removeEventListener('pointerdown', clear);
      document.removeEventListener('visibilitychange', clear);
    };
  }, []);

  return showing;
}

/**
 * The text a key-tip shows for a primary-modified key.
 *
 * Platform-aware for the same reason `primaryMod` is: the modifier a user actually
 * presses is Cmd on macOS and Ctrl everywhere else, and a badge that named the wrong
 * one would be worse than no badge. Mac gets the conventional glyphs (a Mac user reads
 * `⌘⇧O` faster than `Cmd+Shift+O`); everywhere else gets words.
 */
export function keyTipLabel(key: string, shift = false): string {
  // ⚑ `⇧` rather than the word: "Ctrl+Shift+Z" is ~55px at this size and overflowed a
  // 36px icon button, so the undo and redo chips overlapped into an unreadable
  // "Ct·Ctrl+Shift+Z" (seen on David's screen, invisible to every test -- the badges
  // were all present and correct, just illegible). The glyph is standard on both
  // platforms and takes the chip back inside the button.
  return IS_MAC ? `⌘${shift ? '⇧' : ''}${key}` : `Ctrl+${shift ? '⇧' : ''}${key}`;
}

/**
 * Whether key-tips are currently showing, for components too deep to be handed the
 * flag.
 *
 * ⚑ A CONTEXT rather than a prop on each call site, and that is the point: the LEFT
 * RAIL already carries a permanent faint digit on every tool (IconButton's `shortcut`).
 * Holding Alt therefore has to light those up too, or the window lands in a
 * half-dressed state -- teal chips across the top bar, untouched grey digits down the
 * rail -- which reads as unfinished rather than as a mode (David, 2026-07-29). Reading
 * it from context means every IconButton in the app, present and future, joins in
 * without a single call site remembering to opt in.
 */
export const KeyTipsContext = createContext(false);
