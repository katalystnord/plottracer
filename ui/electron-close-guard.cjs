// Confirm-on-close guard for the app's window (v1.0.2, from the v1.0.1
// release-gate audit finding B1).
//
// The OS window-close button / Cmd+Q was the ONE destructive door that bypassed
// the renderer's unsaved-work guard: every other door (Open image/project, New,
// change graph type, ...) routes through confirmDiscardIfDirty, but closing the
// window hit app.quit() directly, silently discarding unsaved calibration and
// data points with no prompt and no autosave to recover from. This is the
// "guards belong in the model, and the model has more than one entrance" lesson
// -- the door that destroys the most work was the unguarded one.
//
// The main process cannot see the renderer's dirty flag, so it ASKS: on a close
// it preventDefault()s and sends `app:close-request`; the renderer runs the SAME
// window.confirm every other door uses and replies `app:close-response`; on
// approval we close for real. Reusing confirmDiscardIfDirty keeps the prompt
// identical everywhere.
//
// Readiness-gated for safety: main only intercepts once the renderer has
// signalled `app:close-guard-ready` (its effect mounted). Before that -- during
// initial load, or if the renderer crashes before mounting -- a close proceeds
// normally, so a broken or still-loading renderer can never trap the user in an
// un-closable window. There is no unsaved work to lose before the effect mounts.
//
// Extracted as a shared module (like electron-ipc.cjs) so both entry points --
// electron-main.cjs (production) and electron-dev.cjs (hot-reload) -- wire the
// exact same guard and can't drift. `win` and `ipcMain` are injected so the
// state machine is unit-testable without launching Electron.
'use strict'

function attachCloseGuard(ipcMain, win) {
  let allowClose = false
  let ready = false

  const onReady = () => {
    ready = true
  }
  const onResponse = (_event, allow) => {
    if (!allow || win.isDestroyed()) return
    allowClose = true
    win.close()
  }

  ipcMain.on('app:close-guard-ready', onReady)
  ipcMain.on('app:close-response', onResponse)

  win.on('close', (e) => {
    // Already approved, or the renderer isn't handling closes yet -> let it go.
    if (allowClose || !ready) return
    e.preventDefault()
    if (!win.isDestroyed()) win.webContents.send('app:close-request')
  })

  // Drop the ipcMain listeners with the window, so a re-created window (macOS
  // dock re-activate) doesn't accumulate stale handlers firing on a dead window.
  win.on('closed', () => {
    ipcMain.removeListener('app:close-guard-ready', onReady)
    ipcMain.removeListener('app:close-response', onResponse)
  })
}

module.exports = { attachCloseGuard }
