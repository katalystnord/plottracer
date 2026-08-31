// Reading TEXT off a figure, in the main process (v2.4).
//
// ⚑⚑ THIS FILE IS ONE FUNCTION WIDE ON PURPOSE: bytes in, text and confidence
// out. Everything about WHICH pixels get read - the box the user drew, the
// quarter turn the axis is written at - is geometry, and geometry lives in
// engine/ocrRegion.ts where it can be tested without an OCR engine, an Electron
// process or a figure. The renderer crops, turns and encodes; this reads.
//
// ⚑ WHY THE MAIN PROCESS. The measured spike ran exactly this worker
// (tesseract.js/src/worker-script/node), so the 12-of-12 that decided the
// feature is the configuration being shipped rather than a cousin of it. The
// renderer would have to bundle a wasm core and a web worker through Vite; here
// `require` finds them as plain files, which is also why `asar: false` in
// build/electron-builder-ui.yml makes this the cheap option.
//
// ⚑⚑ OFFLINE IS A PRODUCT CONSTRAINT, NOT A SETTING. tesseract.js fetches its
// core and language data from a CDN unless told otherwise, which in a tool whose
// promise is that a figure never leaves the machine would be a cloud dependency
// smuggled in by a default. All three paths below are local files. ▶ And that
// was PROVEN rather than configured: the spike removed `fetch`, `http.request`
// and `https.request` outright and read 6 of 6 category labels anyway
// (2026-08-30, in this repo, with the versions installed here).
'use strict'

const path = require('path')

// ⚑ LSTM only - the accurate engine, and what every measurement here was taken
// with.
//
// ⚠️ IT DOES NOT DECIDE WHICH WASM BUILD IS LOADED, and a comment here once said
// it did. In tesseract.js 7.0.0 `worker-script/index.js` hands
// `getCore(lstmOnly, ...)` a BOOLEAN while `getCore` branches on
// `[OEM.DEFAULT, OEM.LSTM_ONLY].includes(oem)`, so that test is always false and
// the node worker always loads a NON-LSTM core. Which builds the package must
// therefore carry is worked out in build/electron-builder-ui.yml, where the
// evidence for it lives.
const OEM_LSTM_ONLY = 1

/**
 * ⚠️⚑⚑ A READER THAT NEVER ANSWERS MUST BECOME A REFUSAL, and without this it
 * could hang for ever.
 *
 * `tesseract.js` reports a worker-level failure by assigning `worker.onerror` -
 * which is the BROWSER Worker API. A node `worker_threads` Worker has no such
 * property, so the assignment does nothing, the error is never delivered, and
 * the promise `createWorker` returned is never settled either way.
 *
 * ▶ MEASURED, not deduced: a packaged build missing one transitive module made
 * its worker die with `Cannot find module 'bmp-js'` - the raw worker emitted
 * `error` and `exit 1`, and `createWorker`'s promise stayed pending for as long
 * as the app was left running. The missing module is fixed in the packaging
 * rules; this exists so that the NEXT cause of a dead worker is a sentence on
 * screen instead of a control that never comes back.
 */
const READ_TIMEOUT_MS = 30000

let workerPromise = null

/**
 * The language data we ship is the COMPACT set (2.95MB), not the package's own
 * default (10.9MB), which is what `@tesseract.js-data/eng`'s index.js points at.
 * Both read English; the compact one is what the size budget was measured with.
 */
function langPath() {
  return path.join(path.dirname(require.resolve('@tesseract.js-data/eng/package.json')), '4.0.0_best_int')
}

function startWorker() {
  const { createWorker } = require('tesseract.js')
  return createWorker('eng', OEM_LSTM_ONLY, {
    workerPath: require.resolve('tesseract.js/src/worker-script/node/index.js'),
    corePath: path.dirname(require.resolve('tesseract.js-core/package.json')),
    langPath: langPath(),
    gzip: true,
    // ⚠️⚑⚑ NO DISK CACHE, AND THIS IS NOT A TUNING CHOICE. tesseract.js
    // decompresses the language data and writes it to
    // `${cachePath || '.'}/eng.traineddata` - the CURRENT WORKING DIRECTORY -
    // unless told otherwise. A 5MB file appeared in the repo root the first time
    // the tests ran, which is the harmless version; in the packaged app the
    // working directory is the INSTALL directory, which on a `.deb` install is
    // root-owned and read-only, and on Windows sits under Program Files. So the
    // default quietly turns "read a label" into a write to a place the app has
    // no business writing to, and may not be able to.
    // ▶ `'none'` removes the read AND the write. The cost is one gunzip of
    // 2.95MB per app session, inside the ~250ms the worker already takes to
    // start, which is not a cost worth a file anywhere.
    // ⚑ It also keeps the promise the feature is sold on exactly true: reading a
    // label leaves nothing behind and sends nothing anywhere.
    cacheMethod: 'none',
    // ⚑ Silent. Progress belongs on screen next to the region being read, not in
    // a terminal nobody running the packaged app can see.
    logger: () => {},
    // ⚠️⚑⚑ WITHOUT THIS, AN UNREADABLE REGION KILLS THE APP. `createWorker.js`
    // rejects the caller's promise and THEN, if nobody supplied an
    // `errorHandler`, does `throw Error(data)` from inside the worker's message
    // callback - an uncaught exception on the main thread, which in Electron
    // takes the whole process down and the user's unsaved work with it. So the
    // `try/catch` below is necessary and NOT sufficient: it catches the
    // rejection while the throw escapes past it on its own path.
    // ▶ Found by driving it, not by reading it: a probe fed the shipped path
    // garbage bytes and the process died between one console line and the next.
    // The rejection still arrives, so `readText` still answers `{ error }`;
    // this only stops the second, fatal copy of the same failure.
    errorHandler: () => {},
  })
}

/**
 * ⚑⚑ HOW THE ENGINE IS TOLD TO READ A LABEL, and both settings were MEASURED on
 * 887 real published charts (ICPR 2022 CHART-Infographics UB-UNITEC PMC), not
 * chosen from the documentation.
 *
 * `tessedit_pageseg_mode` 6 is "assume a single uniform block of text". The
 * default assumes a whole PAGE, which a 20x14 pixel crop of `8` plainly is not:
 * short numeric labels came back EMPTY, at confidence 0, and they are the
 * commonest label on a chart.
 *
 * ⚠️⚑⚑ WHY 6 AND NOT 7, WHICH SCORED HIGHER. Measured on 876 labels, `7`
 * (single line) read 78.8% against `6`'s 78.1% - a difference of eight labels,
 * inside the noise. On the 70 labels that span TWO LINES, `7` read **0 of 70**
 * and `6` read **46 of 70**. A mode that forces one line cannot read a
 * two-line label at all, and the aggregate hid it because such labels are 1.2%
 * of the corpus. ▶ The same trap as choosing an angle from four short probe
 * labels: the average agreed with the wrong choice.
 */
async function applyReadingMode(worker) {
  await worker.setParameters({ tessedit_pageseg_mode: '6' })
}

/**
 * Read one already-cropped, already-turned region.
 *
 * Returns `{ text, confidence }`, or `{ error }` with a sentence the panel can
 * show. ⚑ A REFUSAL IS A VALUE HERE, not a thrown stack: the one thing the user
 * must never see is a region that silently produced nothing, because an absent
 * proposal is indistinguishable from a label that genuinely read as blank.
 */
async function readText(pngBase64, timeoutMs = READ_TIMEOUT_MS) {
  let timer = null
  try {
    if (!workerPromise) {
      workerPromise = startWorker().then(async (w) => {
        await applyReadingMode(w)
        return w
      })
    }
    // ⚑ The bound covers the WHOLE operation - starting the engine and reading -
    // because both halves are promises from the same library and either can be
    // left pending by the mechanism described above.
    const read = (async () => {
      const worker = await workerPromise
      const { data } = await worker.recognize(Buffer.from(pngBase64, 'base64'))
      return { text: data.text, confidence: data.confidence }
    })()
    const answer = await Promise.race([
      read,
      new Promise((resolve) => {
        timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs)
      }),
    ])
    if (answer.timedOut) {
      // ⚑ The worker is dropped, so a later attempt starts a fresh one rather
      // than joining the dead one for ever.
      workerPromise = null
      return {
        error: `The text reader did not answer within ${Math.round(timeoutMs / 1000)} seconds, so it was stopped. Try again, and if it keeps happening the OCR engine did not start.`,
      }
    }
    return answer
  } catch (e) {
    // ⚑ The worker is dropped so the NEXT read starts one cleanly. A half-built
    // worker cached here would turn one bad start into a permanently dead
    // feature with nothing on screen saying why.
    workerPromise = null
    return { error: `Could not read the text: ${e && e.message ? e.message : String(e)}` }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** Let the OCR worker thread go when the app is quitting. */
async function shutdownOcr() {
  const pending = workerPromise
  workerPromise = null
  if (!pending) return
  try {
    const worker = await pending
    await worker.terminate()
  } catch {
    // Quitting anyway - a worker that never started has nothing to release.
  }
}

module.exports = { readText, shutdownOcr }
