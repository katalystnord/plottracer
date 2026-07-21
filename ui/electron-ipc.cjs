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

const PROJECT_FILTERS = [
  // Our own project file is a `.zip` container (checkpoint 94); `.json` is the
  // legacy single-file form from checkpoints 25-93, still opened for backward
  // compatibility (detected by content, not by extension -- see engine/
  // projectContainer.ts's isZipContainer).
  { name: 'PlotTracer Project', extensions: ['zip', 'json'] },
  { name: 'All Files', extensions: ['*'] },
]

// WebPlotDigitizer's real project format is a `.tar` bundle (info.json +
// wpd.json + the image), NOT plain JSON -- so importing one needs a BINARY read
// (checkpoint 88), which dialog:openProject's utf8 path could not do. This is
// the migration route off WebPlotDigitizer (and any legacy plottracer save);
// without it every WPD project is unopenable. `.tar` only for now; `.zip` (our own
// container) and `.pdf` inside a tar come with the container work.
const WPD_PROJECT_FILTERS = [
  { name: 'WebPlotDigitizer Project', extensions: ['tar'] },
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
  // and returns base64 -- the same hop dialog:openWpdProject/openImage use --
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

  // Read a WebPlotDigitizer `.tar` as BINARY (checkpoint 88). Returns base64
  // because IPC serializes it as a plain string either way and the renderer
  // decodes to a Uint8Array for engine/tarRead.ts -- the same base64 hop
  // dialog:openImage already uses for image bytes, so no new capability in the
  // preload's shape, just a second binary reader.
  ipcMain.handle('dialog:openWpdProject', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(getMainWindow(), {
      properties: ['openFile'],
      filters: WPD_PROJECT_FILTERS,
    })
    if (canceled || !filePaths.length) return null
    const filePath = filePaths[0]
    const buffer = fs.readFileSync(filePath)
    return { filePath, base64: buffer.toString('base64') }
  })

  // `encoding` is 'utf8' (the default, and every caller before checkpoint 93)
  // or 'base64'. Base64 is how binary reaches the main process over IPC, which
  // serializes the payload as a plain string either way -- the same base64 hop
  // dialog:openImage/openWpdProject already use for reads, now running the
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
