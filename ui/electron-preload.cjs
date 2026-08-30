// Preload for the app's two Electron entry points: electron-dev.cjs (local
// hot-reload development) and electron-main.cjs (production). Pure contextBridge
// exposure (same shape either way). Its electronAPI surface is a minimal subset of
// what the old (now-deleted) electron/preload.js exposed -- just what this app
// uses. Checkpoint 32 (native menu bar, see ui/electron-menu.cjs) added
// onMenuEvent: a callback registered for one of a fixed set of `menu:*` channels
// the main process sends on a menu click (same allowlist-gated pattern the old
// preload used),
// with one real improvement rather than a straight copy: this version
// returns an unsubscribe function. electron/preload.js's original never
// offered one because overrides.js only ever calls it once, for the
// life of the page -- ui/'s React effects need to clean up after
// themselves (React StrictMode double-invokes effects in development,
// so an effect that registers a listener without a matching cleanup
// would silently double-fire every menu action in dev).
'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  openImage: () => ipcRenderer.invoke('dialog:openImage'),
  openProject: () => ipcRenderer.invoke('dialog:openProject'),
  saveFile: (data, defaultName, filters, encoding) => ipcRenderer.invoke('dialog:saveFile', data, defaultName, filters, encoding),

  // Confirm-on-close guard (electron-close-guard.cjs). The main process asks the
  // renderer to run its unsaved-work confirm before the window closes / Cmd+Q;
  // the renderer replies via confirmClose. notifyCloseGuardReady tells main the
  // handler is mounted, so main only intercepts once we're actually handling it.
  onCloseRequest: (callback) => {
    const listener = () => callback()
    ipcRenderer.on('app:close-request', listener)
    return () => ipcRenderer.removeListener('app:close-request', listener)
  },
  confirmClose: (allow) => ipcRenderer.send('app:close-response', Boolean(allow)),
  notifyCloseGuardReady: () => ipcRenderer.send('app:close-guard-ready'),

  // Read text off one region of the figure (v2.4). `pngBase64` is a crop the
  // renderer has already taken and turned; the answer is `{ text, confidence }`
  // or `{ error }`. See ui/electron-ocr.cjs.
  readText: (pngBase64) => ipcRenderer.invoke('ocr:readText', pngBase64),
})
