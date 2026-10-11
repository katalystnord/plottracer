// The Settings file (v2.7, docs/v2.7-settings-cases.md), owned by the main
// process so the agent switch that lands with the MCP server can be read here
// before any window has a figure.
//
// ⚑ This side stores and returns a plain object and nothing more. Which keys
// exist and what values they may hold is decided in ONE place, the renderer's
// ui/src/settings.ts `parseSettings`, which every read passes through. A missing
// or unreadable file reads as {} so the app starts with the defaults rather than
// not at all (S3).
'use strict'

const fs = require('fs')
const path = require('path')

const SETTINGS_FILE = 'settings.json'

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function readSettingsFile(dir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(dir, SETTINGS_FILE), 'utf8'))
    return isPlainObject(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

// Written to a side file and renamed over the old one, so a crash mid-write
// leaves the previous settings rather than half a file.
function writeSettingsFile(dir, value) {
  if (!isPlainObject(value)) return false
  const target = path.join(dir, SETTINGS_FILE)
  const tmp = `${target}.tmp`
  try {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8')
    fs.renameSync(tmp, target)
    return true
  } catch {
    try { fs.rmSync(tmp, { force: true }) } catch { /* nothing to tidy */ }
    return false
  }
}

// `getDir` is a getter because app.getPath('userData') is only final once the
// command line (--user-data-dir) has been read.
// `onWrite` hears every stored value, so the main process can act on a setting
// it owns (the agent server, M1) without reading the file back.
function registerSettingsHandlers(ipcMain, getDir, onWrite) {
  // Synchronous on purpose: the renderer needs the starting values for its
  // first render, and this is one small local file.
  ipcMain.on('settings:get', (event) => {
    event.returnValue = readSettingsFile(getDir())
  })
  ipcMain.handle('settings:set', (_event, value) => {
    const ok = writeSettingsFile(getDir(), value)
    if (ok && onWrite) onWrite(value)
    return ok
  })
}

module.exports = { SETTINGS_FILE, readSettingsFile, writeSettingsFile, registerSettingsHandlers }
