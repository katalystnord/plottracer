// Application menu for ui/'s two Electron entry points (electron-main.cjs and
// electron-dev.cjs both call buildMenu(mainWindow)).
//
// ⚑ THE NATIVE MENU IS GONE (v1.6, David's call), and what remains is a macOS
// compatibility shim. The reason is Alt: Electron's `autoHideMenuBar` made Alt
// reveal the hidden menu bar, so Alt-reveals-key-tips could not be built while
// the menu existed. The menu had to go for the key-tips to happen.
//
// ⚑ The justification for keeping it had become circular. It was kept so Help ▸
// About stayed "reachable with Alt" -- but the app carries its own Help panel
// with the full AGPL / WebPlotDigitizer / Engauge / StarryDigitizer / Ketcher
// attribution CLAUDE.md requires (ui/src/Workspace.tsx), on a control that is
// visible on screen. A badge on a visible control beats a hidden bar nobody
// knows to summon -- which is the keystone's own test, since a hidden menu bar
// is exactly the "shortcut-only path" it fails things for.
//
// ⚑ WHAT THIS COST, and where it went: `Menu.setApplicationMenu` is what
// registered the accelerators, so removing the menu unregisters them. Open /
// Save / Export AND all four zoom keys are now bound in the renderer
// (ui/src/Workspace.tsx's accelerator effect -- read its note before changing
// either side). Undo/redo were already renderer-side. Ctrl+W is deliberately
// dropped; the titlebar close, Alt+F4 and Cmd+Q all still run the unsaved-work
// guard in electron-close-guard.cjs.
//
// ⚑ WHY macOS STILL GETS A MENU. A null application menu on macOS takes the
// Edit menu's Cut/Copy/Paste/Select All ROLES with it, and those roles are what
// make Cmd+C/V/X work inside a text field -- the platform has no other binding
// for them. So a Mac user would lose clipboard editing in every rename and value
// box. The App menu likewise carries the Quit/Hide/Services conventions macOS
// users expect. Roles only: no click handlers, no accelerators of our own, and
// nothing that duplicates an in-app control. Windows and Linux get no menu at
// all, which is the whole point.
'use strict'

const { Menu, app } = require('electron')

function buildMenu() {
  if (process.platform !== 'darwin') {
    // No menu bar, so Alt is free for the key-tips.
    Menu.setApplicationMenu(null)
    return
  }

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
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
      },
      {
        // Roles only -- this menu exists so the clipboard shortcuts keep working
        // in text fields, NOT to offer actions. App-level undo/redo are the
        // renderer's (they roll back a digitization, not typing), so they are
        // deliberately absent: `role: 'undo'` here would shadow them.
        label: 'Edit',
        submenu: [
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' },
        ],
      },
    ])
  )
}

module.exports = { buildMenu }
