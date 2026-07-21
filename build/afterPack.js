// afterPack hook: wraps the Linux binary in a shell script that passes
// --no-sandbox on the actual command line.
//
// Why this is needed: Chromium pre-spawns the zygote process during early
// browser startup, before Node.js initialises. app.commandLine.appendSwitch
// ('no-sandbox') runs in main.js and is therefore too late — the zygote has
// already done its setuid_sandbox_host check.  In an AppImage the squashfs
// is mounted nosuid, so chrome-sandbox can never be setuid; the zygote aborts
// silently and the renderer never starts, leaving a blank white window.
//
// The wrapper ensures --no-sandbox is present in argv[1] when the binary
// first starts, which Chromium reads before the zygote is spawned.
//
// For deb packages, postinst.sh sets chrome-sandbox to root:4755 instead,
// so the sandbox works correctly; the wrapper is still harmless there.

const path = require('path')
const fs = require('fs')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'linux') return

  const appOutDir = context.appOutDir
  const binaryName = context.packager.executableName  // 'plottracer'
  const binaryPath = path.join(appOutDir, binaryName)
  const wrappedName = `${binaryName}.bin`
  const wrappedPath = path.join(appOutDir, wrappedName)

  // Rename the real Electron binary
  fs.renameSync(binaryPath, wrappedPath)

  // Write a wrapper that adds --no-sandbox before any user-supplied args
  const wrapper = [
    '#!/bin/bash',
    'SCRIPT_DIR="$(dirname "$(readlink -f "$0")")"',
    `exec "$SCRIPT_DIR/${wrappedName}" --no-sandbox "$@"`,
    '',
  ].join('\n')

  fs.writeFileSync(binaryPath, wrapper, { mode: 0o755 })
  console.log(`  afterPack: wrapped ${binaryName} → ${binaryName}.bin + shell wrapper`)
}
