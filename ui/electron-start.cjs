// Cross-platform launcher for `npm start` / `npm run ui:start` (v2.0
// pre-launch audit). `--no-sandbox` used to be a literal CLI arg in
// package.json's ui:start script, applied unconditionally on every
// platform -- contradicting electron-main.cjs's own in-code comment, which
// deliberately gates the SAME switch to Linux ("so macOS and Windows keep
// their OS renderer sandbox -- a decoder/parser bug in a malicious figure
// then runs contained"). A CLI flag is read before any of that JS runs, so
// it silently overrode the platform gate for anyone following the
// documented dev workflow on macOS/Windows.
//
// package.json scripts have no native per-OS conditional, so this tiny
// launcher does the platform check in Node (works everywhere npm itself
// works) and spawns the real entry point (electron-main.cjs) with the flag
// added ONLY on Linux -- where it remains genuinely required: this exact
// audit fix was verified by trying to launch WITHOUT it in a sandboxed
// Linux container with no suid chrome-sandbox helper configured, which
// makes Electron abort at startup rather than run unsandboxed.
'use strict'

const { spawnSync } = require('child_process')
const electronPath = require('electron')

const args = [__dirname + '/electron-main.cjs']
if (process.platform === 'linux') args.push('--no-sandbox')

const result = spawnSync(electronPath, args, { stdio: 'inherit' })
process.exit(result.status === null ? 1 : result.status)
