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
  // `options.detectorBoxes` (v2.7): the crop is already isolated and margined (contour labels).
  readText: (pngBase64, options) => ipcRenderer.invoke('ocr:readText', pngBase64, options),
  // Automatic graph extraction (v2.7): the captured figure's PNG bytes in, the two graph-type
  // models' logits out (`{ own, docling }` or `{ error }`). See ui/electron-figtype.cjs.
  classifyFigure: (pngBase64) => ipcRenderer.invoke('figtype:classify', pngBase64),

  // Settings (v2.7). Read synchronously once, for the first render; written back
  // on every change. See ui/electron-settings.cjs and ui/src/settings.ts.
  getSettings: () => ipcRenderer.sendSync('settings:get'),
  setSettings: (value) => ipcRenderer.invoke('settings:set', value),

  // Agents (v2.7, docs/v2.7-mcp-cases.md). The main process runs the MCP server
  // and hands each tool call to the window; the window answers through
  // answerAgent. The status says whether it listens, where, and who is connected.
  getAgentStatus: () => ipcRenderer.invoke('agent:get-status'),
  onAgentStatus: (callback) => {
    const listener = (_e, status) => callback(status)
    ipcRenderer.on('agent:status', listener)
    return () => ipcRenderer.removeListener('agent:status', listener)
  },
  onAgentCall: (callback) => {
    const listener = (_e, call) => callback(call)
    ipcRenderer.on('agent:call', listener)
    return () => ipcRenderer.removeListener('agent:call', listener)
  },
  answerAgent: (callId, result, error) => ipcRenderer.send('agent:result', { callId, result, error }),
  notifyAgentReady: (ready) => ipcRenderer.send(ready ? 'agent:ready' : 'agent:gone'),
  disconnectAgent: () => ipcRenderer.invoke('agent:disconnect'),
  allowAgentReconnect: () => ipcRenderer.invoke('agent:allow-reconnect'),
  agentSaveFile: (name, content) => ipcRenderer.invoke('agent:save-file', { name, content }),
  chooseFolder: () => ipcRenderer.invoke('dialog:openFolder'),
})
