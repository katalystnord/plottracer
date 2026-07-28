// Shared IPC handler registration for both of the app's Electron entry points:
// electron-dev.cjs (local hot-reload development) and electron-main.cjs
// (production). Extracted here rather than left duplicated in both (as it was
// through checkpoint 28), so the two entry points can't silently drift apart.
// The IPC channel names/shapes match the old (now-deleted) electron/preload.js
// surface by design -- see ui/electron-preload.cjs's header.
'use strict'

const fs = require('fs')
const path = require('path')

// The formats the renderer can turn into a working image. Most decode straight
// through Chromium's <img> (ui/src/ImageCanvas.tsx's loadImageFromSrc); PDF is
// the exception -- <img> can't decode it, so the renderer detects a PDF and
// renders it via pdf.js (checkpoint 96, ui/src/pdfRender.ts). Keep this list in
// sync with SUPPORTED_IMAGE_FORMATS in ImageCanvas.tsx.
// "All Files" stays as an escape hatch; anything that still can't be opened
// (e.g. TIFF -- <img> can't decode it and we have no TIFF decoder yet) surfaces
// a clear "can't open" message instead of a blank canvas.
// Checkpoint 65 pared this back to formats that genuinely decode after tiff and
// pdf were found to fail silently -- offering a format the app cannot open is a
// *hidden failure*, worse than not offering it. PDF re-joins the list at
// checkpoint 96, now that a PDF genuinely opens; TIFF stays out until it does.
const IMAGE_FILTERS = [
  { name: 'Images, PDF & TIFF', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'pdf', 'tif', 'tiff'] },
  { name: 'Scanned documents (PDF, TIFF)', extensions: ['pdf', 'tif', 'tiff'] },
  { name: 'All Files', extensions: ['*'] },
]

const MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  bmp: 'image/bmp', webp: 'image/webp',
  gif: 'image/gif', svg: 'image/svg+xml', pdf: 'application/pdf',
  tif: 'image/tiff', tiff: 'image/tiff',
}

// ONE door for every project we can read (v1.4). Our own file is a `.zip`
// container (checkpoint 94); `.json` is the legacy single-file form from
// checkpoints 25-93; `.tar` is another digitizer's archive. Which one it actually
// is gets decided by CONTENT in the renderer, never by extension -- users rename
// files (engine/projectContainer.ts's isZipContainer).
//
// ⚑ There used to be a SECOND dialog channel whose only difference was a filter
// naming one foreign tool. That is the first-class status tenet 5 rules out ("no
// allegiance at the code level -- licensing and attribution ONLY"), and the two
// handlers were otherwise byte-identical. A format we can read is a format we can
// read; the file says which it is. Adding the next digitizer means adding an
// extension here and a sniffer in the renderer, and touching no UI at all.
//
// ⚑ These extensions must stay in step with engine/importRegistry.ts, which is
// the real list (`importDialogExtensions()`); this file is the main process and
// cannot import the renderer's TypeScript. The filter is a CONVENIENCE ONLY --
// nothing decides a file's format from its name, so a renamed project still
// opens through "All Files".
const PROJECT_FILTERS = [
  { name: 'Project files', extensions: ['zip', 'json', 'tar', 'dig'] },
  { name: 'All Files', extensions: ['*'] },
]

// getMainWindow: () => BrowserWindow -- a getter rather than a direct
// reference, since both callers only assign their own `mainWindow`
// variable once createWindow() runs, after these handlers are registered.
function registerIpcHandlers(ipcMain, dialog, getMainWindow) {
  ipcMain.handle('dialog:openImage', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(getMainWindow(), {
      properties: ['openFile'],
      filters: IMAGE_FILTERS,
    })
    if (canceled || !filePaths.length) return null
    const filePath = filePaths[0]
    const buffer = fs.readFileSync(filePath)
    const ext = path.extname(filePath).toLowerCase().slice(1)
    const mime = MIME[ext] || 'application/octet-stream'
    return { filePath, dataURL: `data:${mime};base64,${buffer.toString('base64')}` }
  })

  // Checkpoint 25 (project save/load). As of checkpoint 94 a project file is a
  // binary `.zip` container (engine/projectContainer.ts), so this reads BYTES
  // and returns base64 -- the same hop dialog:openImage uses --
  // rather than the UTF-8 text it returned through checkpoint 93. The renderer
  // decides zip-vs-legacy-JSON from the leading bytes; a legacy `.json` project
  // decodes straight back to its text there. saveFile handles the binary write
  // (its `encoding: 'base64'` path).
  ipcMain.handle('dialog:openProject', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(getMainWindow(), {
      properties: ['openFile'],
      filters: PROJECT_FILTERS,
    })
    if (canceled || !filePaths.length) return null
    const filePath = filePaths[0]
    const buffer = fs.readFileSync(filePath)
    return { filePath, base64: buffer.toString('base64') }
  })

  // `encoding` is 'utf8' (the default, and every caller before checkpoint 93)
  // or 'base64'. Base64 is how binary reaches the main process over IPC, which
  // serializes the payload as a plain string either way -- the same base64 hop
  // dialog:openImage already uses for reads, now running the
  // other direction. It unblocks PNG snapshot export (checkpoint 93) and the
  // .zip project container (v0.4). When base64, decode to real bytes before
  // writing; otherwise write the text verbatim exactly as before.
  ipcMain.handle('dialog:saveFile', async (_event, data, defaultName, filters, encoding) => {
    const { canceled, filePath } = await dialog.showSaveDialog(getMainWindow(), {
      defaultPath: defaultName,
      filters: filters || [{ name: 'All Files', extensions: ['*'] }],
    })
    if (canceled || !filePath) return null
    if (encoding === 'base64') {
      fs.writeFileSync(filePath, Buffer.from(data, 'base64'))
    } else {
      fs.writeFileSync(filePath, data, 'utf8')
    }
    return filePath
  })
}

module.exports = { registerIpcHandlers }
