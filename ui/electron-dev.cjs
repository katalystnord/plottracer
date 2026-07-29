// Local hot-reload development entry for ui/ (CLAUDE.md "Product #1 —
// rebuild design" spike, checkpoint 1). Loads the Vite dev server (npm run
// ui:dev must be running separately) for hot-reload during development; a
// --built flag loads the static Vite build output instead, for previewing
// a production build without a separate packaging step.
//
// Not the production entry point -- see electron-main.cjs (checkpoint 29,
// see CLAUDE.md) for that. This file keeps its dev conveniences (devtools
// open by default, a dev-server/built toggle) that a real production
// launch shouldn't have. IPC handler registration and the preload script
// are shared with electron-main.cjs (ui/electron-ipc.cjs,
// ui/electron-preload.cjs) now that both are real, ongoing entry points --
// see electron-ipc.cjs's own header comment for why that stopped being
// duplicated code once electron-main.cjs existed to drift against.
'use strict'

const { app, BrowserWindow, dialog, ipcMain } = require('electron')
const path = require('path')
const { registerIpcHandlers } = require('./electron-ipc.cjs')
const { buildMenu } = require('./electron-menu.cjs')
const { attachCloseGuard } = require('./electron-close-guard.cjs')

// seccomp/GPU workarounds -- needed on this Linux dev environment, harmless
// elsewhere (same as electron-main.cjs).
app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('disable-gpu')


// True when driven by the e2e suite (WPD_E2E=1). Used below to skip the
// docked DevTools, which otherwise steal a large slice of the window's
// viewport width -- on the dev machine's fractionally-scaled 4K display a
// side-docked DevTools shrank the page from ~1400 to ~845 CSS px, leaving the
// canvas-dominant layout's canvas too narrow for the tests' absolute click
// coordinates. Interactive `npm run ui:electron` keeps DevTools open as usual.
const isE2E = process.env.WPD_E2E === '1'

let mainWindow = null

registerIpcHandlers(ipcMain, dialog, () => mainWindow)

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'PlotTracer — engine/ui dev preview',
    // Match electron-main.cjs, which removed the native menu in v1.6 to free
    // Alt for the key-tips. See ui/electron-menu.cjs for what that cost.
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'electron-preload.cjs'),
      contextIsolation: true,
    },
  })

  // The same call electron-main.cjs makes, so the dev preview matches the real
  // app: nothing on Windows/Linux, roles-only on macOS. This also replaces
  // Electron's own DEFAULT menu, which this file would otherwise inherit
  // implicitly -- and that default binds Ctrl/Cmd+Q, W, R and the zoom keys,
  // which would shadow the renderer's accelerators in dev only.
  buildMenu()

  const useBuilt = process.argv.includes('--built')
  if (useBuilt) {
    mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'))
  } else {
    mainWindow.loadURL('http://localhost:5173')
  }

  if (!isE2E) mainWindow.webContents.openDevTools()

  // Same unsaved-work close guard as production (audit B1) -- both entry points
  // wire it so they can't drift. See electron-close-guard.cjs.
  attachCloseGuard(ipcMain, mainWindow)
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  app.quit()
})
