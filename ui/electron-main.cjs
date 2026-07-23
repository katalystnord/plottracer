// Production entry point for the app (`package.json` `main`; `npm start` ==
// `npm run ui:start`). Always loads the built static output (ui/dist/index.html,
// via `npm run ui:build`), never the Vite dev server, and drops every dev-only
// convenience electron-dev.cjs keeps (devtools auto-open, the dev-server/--built
// toggle, the "dev preview" window title).
//
// History (harmless to know): this began at checkpoint 29 as an *additional*
// entry point alongside the old wpd-core/ui-patches app during the strangler-fig
// migration. That old app was deleted 2026-07-19 -- this is now simply the entry
// point, and it packages via build/electron-builder-ui.yml (linux/mac/win in CI).
'use strict'

const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron')
const path = require('path')
const { registerIpcHandlers } = require('./electron-ipc.cjs')
const { buildMenu } = require('./electron-menu.cjs')
const { attachCloseGuard } = require('./electron-close-guard.cjs')

// no-sandbox is a Linux AppImage/seccomp workaround (the deb postinst + afterPack
// wrapper cover the same need). Gated to Linux so macOS and Windows keep their OS
// renderer sandbox — a decoder/parser bug in a malicious figure then runs
// contained. disable-gpu stays cross-platform (unchanged behaviour).
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('no-sandbox')
}
app.commandLine.appendSwitch('disable-gpu')

let mainWindow = null

registerIpcHandlers(ipcMain, dialog, () => mainWindow)

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'PlotTracer',
    icon: path.join(__dirname, '..', 'build', 'icons', '512x512.png'),
    // The in-app top bar (checkpoint 39) now carries File (Save/Open/Export),
    // Edit (undo/redo), View (zoom) and the analysis panels, so the native
    // menu bar duplicated all of it. Hidden (not removed) at checkpoint 41:
    // autoHideMenuBar keeps the row out of the layout while the menu itself
    // stays built -- so its keyboard accelerators (Ctrl+O/S, zoom, etc.) and,
    // importantly, Help > About (the AGPL/WebPlotDigitizer attribution
    // CLAUDE.md requires) remain reachable with Alt. Removing it outright
    // would have dropped both.
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'electron-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // The renderer parses untrusted figures (images, PDFs via pdf.js). The OS
      // renderer sandbox contains a decoder bug. Compatible here because the
      // preload uses only contextBridge + ipcRenderer (no fs/node). Inert on
      // Linux, where the no-sandbox switch above wins.
      sandbox: true,
    },
  })

  // Native menu bar (checkpoint 32, see CLAUDE.md and
  // ui/electron-menu.cjs) -- closes the known gap flagged in checkpoint
  // 29's notes. Wired through ui/electron-preload.cjs's onMenuEvent and
  // consumed in ui/src/ImageCanvas.tsx and ui/src/Workspace.tsx. Hidden by
  // autoHideMenuBar above (checkpoint 41) but still built and functional.
  buildMenu(mainWindow)

  mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'))

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  // Block top-level navigation away from the local app. setWindowOpenHandler
  // above only covers new windows; without this a compromised renderer or an
  // in-page link could navigate the main window itself to a remote origin,
  // which would then inherit the preload bridge. The app is a single file://
  // document, so any non-file:// navigation is illegitimate.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) event.preventDefault()
  })

  // Confirm unsaved work before the window closes / Cmd+Q -- the one destructive
  // door that used to bypass the renderer's dirty-guard (audit B1). See
  // electron-close-guard.cjs.
  attachCloseGuard(ipcMain, mainWindow)
}

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
