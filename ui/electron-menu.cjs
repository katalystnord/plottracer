// Native menu bar for ui/'s two Electron entry points (checkpoint 32, see
// CLAUDE.md's "engine/ui rebuild -- staged checkpoints") -- both
// electron-main.cjs (production) and electron-dev.cjs (dev preview) call
// buildMenu(mainWindow) so the real menu is what's previewed during
// development too, not a separate dev-only stand-in.
//
// Structure and IPC channel names were originally ported from the old
// electron/menu.js (the retired wpd-core/ui-patches app, deleted 2026-07-19) --
// the File/clicks-send-a-channel pattern and channel names (menu:open-image,
// menu:save-project, etc.) carried over. That reference is gone now; this is the
// only menu.
//
// The Edit menu (Undo/Redo) landed in checkpoint 38, when ui/ finally got
// a real undo/redo system (engine/history.ts + calibrationSession.ts's
// captureState/restoreState) -- checkpoint 32 deliberately left it out
// until then rather than ship permanently-disabled items. Its Undo/Redo
// send menu:undo/menu:redo, wired through Workspace.tsx's onMenuEvent
// listener to the exact same undo()/redo() the Ctrl+Z/Ctrl+Shift+Z
// shortcuts and the on-screen toolbar buttons call.
//
// Deliberate design note: no "Toggle Dark Mode" under View. The app is
// light-only by design (David: no dark mode, ever -- see ui/src/theme.ts's
// header); there is no dark variant to switch to.
//
// Zoom In/Out/Fit to Window/Actual Size are real menu items here, backed by
// engine/canvasView.ts's zoomByFactor (added specifically because menu clicks
// have no mouse position to
// recenter on the way wheel-zoom does) and fitToContainer, wired through
// ui/src/ImageCanvas.tsx's onMenuEvent listener.
'use strict'

const { Menu, shell, dialog, app } = require('electron')

function buildMenu(mainWindow) {
  const send = (channel) => {
    if (mainWindow?.webContents) mainWindow.webContents.send(channel)
  }

  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Image…',
          accelerator: 'CmdOrCtrl+O',
          click: () => send('menu:open-image'),
        },
        {
          label: 'Open WebPlotDigitizer Project…',
          click: () => send('menu:open-wpd-project'),
        },
        {
          label: 'Open Project…',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => send('menu:open-project'),
        },
        { type: 'separator' },
        {
          label: 'Save Project',
          accelerator: 'CmdOrCtrl+S',
          click: () => send('menu:save-project'),
        },
        {
          label: 'Save Data As CSV…',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => send('menu:save-csv'),
        },
        { type: 'separator' },
        {
          label: 'Close',
          accelerator: 'CmdOrCtrl+W',
          click: () => mainWindow?.close(),
        },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        {
          label: 'Undo',
          accelerator: 'CmdOrCtrl+Z',
          click: () => send('menu:undo'),
        },
        {
          label: 'Redo',
          accelerator: 'CmdOrCtrl+Shift+Z',
          click: () => send('menu:redo'),
        },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Zoom In',
          accelerator: 'CmdOrCtrl+Equal',
          click: () => send('menu:zoom-in'),
        },
        {
          label: 'Zoom Out',
          accelerator: 'CmdOrCtrl+-',
          click: () => send('menu:zoom-out'),
        },
        {
          label: 'Fit to Window',
          accelerator: 'CmdOrCtrl+0',
          click: () => send('menu:zoom-fit'),
        },
        {
          label: 'Actual Size',
          accelerator: 'CmdOrCtrl+1',
          click: () => send('menu:zoom-100'),
        },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About PlotTracer',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'About PlotTracer',
              message: `PlotTracer ${app.getVersion()}`,
              detail: [
                'Based on WebPlotDigitizer by Ankit Rohatgi (AGPL-3.0)',
                'Some algorithms are clean-room reimplementations of',
                'Engauge Digitizer ideas (Mark Mitchell, Jason Nicholson; GPL-2.0).',
                'Icon set derived from Ketcher by EPAM Systems (Apache-2.0).',
                '',
                'Developed by Katalyst Nord AB, Stockholm',
                'david@katalystnord.com',
              ].join('\n'),
              buttons: ['OK'],
            })
          },
        },
        { type: 'separator' },
        {
          label: 'Report Issue',
          click: () =>
            shell.openExternal(
              'https://github.com/katalystnord/plottracer/issues'
            ),
        },
        {
          label: 'Documentation',
          click: () =>
            shell.openExternal(
              'https://github.com/katalystnord/plottracer'
            ),
        },
      ],
    },
  ]

  // Standard macOS application menu boilerplate.
  if (process.platform === 'darwin') {
    template.unshift({
      label: app.getName(),
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    })
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

module.exports = { buildMenu }
