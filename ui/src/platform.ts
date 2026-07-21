// Single source of truth for platform-dependent input handling.
//
// The mouse/keyboard model (David, 2026-07) needs ONE place that asks "are we on
// a Mac?" -- before this, the answer lived inline in ImageCanvas while other
// handlers did `ctrlKey || metaKey` by hand, so a platform rule could only be
// enforced wherever someone remembered to repeat it. Everything platform-aware
// now imports from here.
//
// The renderer runs under Electron, so `navigator.platform` is reliable; detected
// once at module load.
export const IS_MAC =
  typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || navigator.userAgent || '');

/**
 * The platform's primary command modifier is held: Cmd on macOS, Ctrl elsewhere.
 *
 * On a Mac the Cmd key sets `metaKey`; on Windows/Linux the Ctrl key sets
 * `ctrlKey`. We accept EITHER rather than branching on {@link IS_MAC}: a Mac user
 * who reflexively hits Ctrl+0 still gets the same result, and it matches the
 * existing undo/redo binding (`ctrlKey || metaKey`). The only place platform
 * actually changes *behaviour* is Ctrl+Left-pan (a Mac's system context-menu
 * gesture), which branches on IS_MAC directly at the mouse-down site.
 */
export function primaryMod(e: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey'>): boolean {
  return e.ctrlKey || e.metaKey;
}
