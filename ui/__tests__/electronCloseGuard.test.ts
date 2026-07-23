import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';

// electron-close-guard.cjs is CommonJS (an Electron main-process module); load
// it with require so its module.exports resolves cleanly under vitest's ESM.
const require = createRequire(import.meta.url);
const { attachCloseGuard } = require('../electron-close-guard.cjs') as {
  attachCloseGuard: (ipcMain: unknown, win: unknown) => void;
};

/**
 * The confirm-on-close guard (v1.0.2, audit finding B1). The module takes
 * ipcMain + win as parameters precisely so its state machine is testable
 * without launching Electron — the native close DIALOG itself is manually
 * verified (a structural e2e gap, like the native menu accelerators).
 */
function makeIpcMain() {
  const handlers: Record<string, Array<(...a: unknown[]) => void>> = {};
  return {
    on(ch: string, fn: (...a: unknown[]) => void) {
      (handlers[ch] ||= []).push(fn);
    },
    removeListener(ch: string, fn: (...a: unknown[]) => void) {
      handlers[ch] = (handlers[ch] || []).filter((f) => f !== fn);
    },
    emit(ch: string, ...args: unknown[]) {
      (handlers[ch] || []).slice().forEach((f) => f(...args));
    },
    count(ch: string) {
      return (handlers[ch] || []).length;
    },
  };
}

function makeWin() {
  const handlers: Record<string, Array<(...a: unknown[]) => void>> = {};
  let destroyed = false;
  return {
    on(ev: string, fn: (...a: unknown[]) => void) {
      (handlers[ev] ||= []).push(fn);
    },
    fire(ev: string, ...args: unknown[]) {
      (handlers[ev] || []).slice().forEach((f) => f(...args));
    },
    close: vi.fn(),
    isDestroyed: () => destroyed,
    setDestroyed(v: boolean) {
      destroyed = v;
    },
    webContents: { send: vi.fn() },
  };
}

const closeEvent = () => ({ preventDefault: vi.fn() });

describe('attachCloseGuard — the confirm-on-close state machine', () => {
  it('does NOT intercept a close before the renderer signals ready', () => {
    const ipcMain = makeIpcMain();
    const win = makeWin();
    attachCloseGuard(ipcMain, win);

    const e = closeEvent();
    win.fire('close', e);

    // A still-loading / crashed renderer must never trap the user in an
    // un-closable window, and there is no unsaved work before mount.
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(win.webContents.send).not.toHaveBeenCalled();
  });

  it('once ready, intercepts a close and asks the renderer', () => {
    const ipcMain = makeIpcMain();
    const win = makeWin();
    attachCloseGuard(ipcMain, win);
    ipcMain.emit('app:close-guard-ready');

    const e = closeEvent();
    win.fire('close', e);

    expect(e.preventDefault).toHaveBeenCalledTimes(1);
    expect(win.webContents.send).toHaveBeenCalledWith('app:close-request');
    expect(win.close).not.toHaveBeenCalled(); // waits for the reply
  });

  it('closes for real when the renderer approves (discard)', () => {
    const ipcMain = makeIpcMain();
    const win = makeWin();
    attachCloseGuard(ipcMain, win);
    ipcMain.emit('app:close-guard-ready');
    win.fire('close', closeEvent());

    ipcMain.emit('app:close-response', {}, true);
    expect(win.close).toHaveBeenCalledTimes(1);

    // ...and that real close is NOT intercepted again (allowClose is set).
    const e2 = closeEvent();
    win.fire('close', e2);
    expect(e2.preventDefault).not.toHaveBeenCalled();
  });

  it('stays open when the renderer declines (keep working)', () => {
    const ipcMain = makeIpcMain();
    const win = makeWin();
    attachCloseGuard(ipcMain, win);
    ipcMain.emit('app:close-guard-ready');
    win.fire('close', closeEvent());

    ipcMain.emit('app:close-response', {}, false);
    expect(win.close).not.toHaveBeenCalled();

    // A later close is still guarded (the state didn't get stuck open).
    const e2 = closeEvent();
    win.fire('close', e2);
    expect(e2.preventDefault).toHaveBeenCalledTimes(1);
  });

  it('drops its ipcMain listeners when the window is gone (no stale handlers)', () => {
    const ipcMain = makeIpcMain();
    const win = makeWin();
    attachCloseGuard(ipcMain, win);
    expect(ipcMain.count('app:close-response')).toBe(1);
    expect(ipcMain.count('app:close-guard-ready')).toBe(1);

    win.fire('closed');
    expect(ipcMain.count('app:close-response')).toBe(0);
    expect(ipcMain.count('app:close-guard-ready')).toBe(0);
  });

  it('ignores a stray approval after the window is destroyed', () => {
    const ipcMain = makeIpcMain();
    const win = makeWin();
    attachCloseGuard(ipcMain, win);
    ipcMain.emit('app:close-guard-ready');
    win.setDestroyed(true);

    ipcMain.emit('app:close-response', {}, true);
    expect(win.close).not.toHaveBeenCalled();
  });
});
