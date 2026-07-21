#!/usr/bin/env bash
# Rasterize the PlotTracer master icon (build/icon.svg) into the PNG sizes
# electron-builder consumes (build/icons/*.png) and the Electron window icon
# (electron-main.cjs -> build/icons/512x512.png). Requires Inkscape.
#
# NOTE: snap-confined Inkscape resolves relative paths against $HOME and
# exits 0 even when it can't open the input, so we pass ABSOLUTE paths and
# delete-then-verify each target rather than trusting the exit code.
#
# Usage: scripts/generate-icons.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

SRC="$ROOT/build/icon.svg"
OUT="$ROOT/build/icons"
[ -f "$SRC" ] || { echo "missing $SRC" >&2; exit 1; }
command -v inkscape >/dev/null 2>&1 || { echo "inkscape not found on PATH" >&2; exit 1; }
mkdir -p "$OUT"

for s in 16 32 48 64 128 256 512; do
  dest="$OUT/${s}x${s}.png"
  rm -f "$dest"
  inkscape "$SRC" --export-type=png --export-filename="$dest" -w "$s" -h "$s" >/dev/null 2>&1 || true
  [ -f "$dest" ] || { echo "FAILED to generate $dest (inkscape could not write it)" >&2; exit 1; }
  echo "  generated $dest"
done
echo "Done. (mac .icns / win .ico are produced by electron-builder from these when those targets are built.)"
