import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';

/**
 * ⚑⚑ READING A LABEL NEEDS NO NETWORK, AND THAT IS PROVEN HERE RATHER THAN
 * CONFIGURED (v2.4).
 *
 * `tesseract.js` fetches its wasm core AND its language data from a CDN unless
 * every path is set to a local file. In a tool whose whole promise is that a
 * figure never leaves the machine, a default like that is a cloud dependency
 * smuggled in by omission - and setting three options is not evidence that it
 * worked, because a silent fallback would look identical until the day someone
 * runs it on a train.
 *
 * ▶ So this test REMOVES the network: `fetch`, `http.request` and
 * `https.request` are replaced with functions that throw, and the OCR path has
 * to read a real label anyway. It is the same instrument the v2.4 spike used,
 * committed rather than remembered - the README states this offline claim in the
 * user's own words, and a claim nothing enforces is exactly what CLAUDE.md's
 * third gate is about.
 *
 * ⚑ It exercises `ui/electron-ocr.cjs`, the module the SHIPPED main process
 * loads, not a copy of its settings. That module needs no Electron - it is
 * `tesseract.js` and `path` - which is what makes this testable at all, and is
 * one more reason the reader was kept one function wide.
 *
 * ⚑ The fixture is one category label cropped from our own `samples/
 * bar-tensile-strength.png`. A drawn-by-the-test image would prove only that we
 * can read our own drawing; this is the ink the app actually meets.
 */

const require_ = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));

interface OcrModule {
  readText(
    pngBase64: string,
    timeoutMs?: number
  ): Promise<{ text?: string; confidence?: number; error?: string }>;
  shutdownOcr(): Promise<void>;
}

let ocr: OcrModule;
const realFetch = globalThis.fetch;
const realHttp = http.request;
const realHttps = https.request;

describe('OCR: a label is read with the network removed', () => {
  beforeAll(() => {
    const boom = (): never => {
      throw new Error('NETWORK USED - OCR must read from local files only');
    };
    globalThis.fetch = boom as unknown as typeof fetch;
    http.request = boom as unknown as typeof http.request;
    https.request = boom as unknown as typeof https.request;
    ocr = require_('../../ui/electron-ocr.cjs') as OcrModule;
  });

  afterAll(async () => {
    await ocr?.shutdownOcr();
    globalThis.fetch = realFetch;
    http.request = realHttp;
    https.request = realHttps;
  });

  it('reads a category label off the figure with no network available', async () => {
    const png = readFileSync(path.join(here, 'fixtures/ocr/label-flax.png')).toString('base64');
    const result = await ocr.readText(png);
    expect(result.error, 'the reader answered with a refusal instead of text').toBeUndefined();
    expect(result.text?.trim()).toBe('Flax');
    // ⚑ The confidence is REPORTED to the user beside the proposal, never used
    // as a threshold that drops a reading - so what is asserted here is only
    // that a number comes back at all, and that a good read is not mistaken for
    // a bad one. Measured on this fixture: 96.
    expect(result.confidence).toBeGreaterThan(50);
  });

  it('leaves nothing behind on disk', async () => {
    // ⚠️ MEASURED, NOT IMAGINED: the first test run wrote a 5MB
    // `eng.traineddata` into the repository root, because tesseract.js caches
    // the decompressed language data to `${cachePath || '.'}` by default. In the
    // packaged app that directory is the install directory - root-owned on a
    // `.deb`, under Program Files on Windows - so the default turns reading a
    // label into a write the app may not be permitted to make.
    const png = readFileSync(path.join(here, 'fixtures/ocr/label-flax.png')).toString('base64');
    await ocr.readText(png);
    expect(
      existsSync(path.join(process.cwd(), 'eng.traineddata')),
      'reading a label wrote language data into the working directory'
    ).toBe(false);
  });

  it('gives up with a sentence rather than waiting for ever', async () => {
    // ⚠️⚑⚑ THE HANG IS REAL AND IT WAS MEASURED. `tesseract.js` reports a
    // worker-level failure by assigning `worker.onerror`, which is the BROWSER
    // Worker API - a node `worker_threads` Worker has no such property, so the
    // error is never delivered and `createWorker`'s promise is never settled.
    // A packaged build missing one transitive module (`bmp-js`) hit exactly
    // this: the raw worker emitted `error` and `exit 1` while the app waited
    // for ever, and no timeout anywhere in the app would fire.
    // ▶ So the reader is BOUNDED. The bound is passed in here rather than waited
    // out: a read of this fixture takes single-digit milliseconds, so 1ms is
    // reliably too short, and what is asserted is that the answer is a sentence
    // rather than a promise nobody ever settles.
    const png = readFileSync(path.join(here, 'fixtures/ocr/label-flax.png')).toString('base64');
    const result = await ocr.readText(png, 1);
    expect(result.error, 'a read that ran out of time must come back as a refusal').toMatch(
      /did not answer/
    );
    expect(result.text).toBeUndefined();
  });

  it('answers with a sentence rather than killing the process when the bytes are not an image', async () => {
    // ⚠️ THE CASE THAT CRASHED THE APP. `createWorker.js` rejects the caller's
    // promise and THEN throws from inside the worker's message callback unless
    // an `errorHandler` is supplied - an uncaught exception on the main thread,
    // which in Electron takes the whole process down with the user's unsaved
    // work. Found by driving the shipped path with garbage, not by reading it.
    const result = await ocr.readText('not-a-png');
    expect(result.error, 'an unreadable region must come back as a refusal').toBeTruthy();
    expect(result.text).toBeUndefined();
  });
});
