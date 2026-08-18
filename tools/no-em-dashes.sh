#!/usr/bin/env bash
#
# Refuse an em-dash (U+2014) anywhere in the tree, in any form.
#
# ⚑ WHY THIS EXISTS. David, 2026-08-18, twice: *"remove em-dashes from
# everywhere in the codebase. They are an invasion of satan and should never
# been used. Ever again."* and, when the empty-cell placeholder was left as a
# possible exception: *"Em-dashes are just a nuisance. Properly."* 4,634 came out
# in one sweep; without a gate the next commit puts them back, because
# everything that writes here has the habit.
#
# ⚑ "EVER AGAIN" IS THE POINT. A style decision that lives only in a preference
# is one nobody can act on later, which is the same reason this project turns
# agreed designs into named tests rather than memos.
#
# ⚑ NO ALLOWED USE, including the empty-cell placeholder: a table cell with no
# value reads as a plain hyphen, which is what MANUAL.md and the README already
# called it ("reads as a dash, never an invented Bar 1").
#
# ⚠️⚠️ THIS SCRIPT COULD NOT FIRE WHEN FIRST WRITTEN. It matched the UTF-8 bytes
# as a backslash-x escape, which `grep -E` takes literally, so it passed a file
# containing exactly what it exists to refuse. Caught only by adding a violation
# and watching it NOT be rejected. Same shape as the `calibrate()` that could
# never fail. ▶ ALWAYS add the violation and watch the guard reject it.
#
# ⚠️ AND THE ESCAPED FORMS ARE THE HALF THAT ACTUALLY BIT. A dash written as a
# backslash-u escape inside a TypeScript string is invisible to a literal grep:
# the whole sweep ran, the unit board went green, and one e2e assertion still
# held the old glyph against an app that no longer produced it. It cost a
# 22-minute Electron run to surface one character.
#
# Used by tools/git-hooks/pre-commit and by the CI `check` job, so it cannot be
# satisfied on one and not the other.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)" || exit 1

# ⚑ THIS FILE EXCLUDES ITSELF, and it is the only file that may. A guard has to
# name what it hunts, so its own source necessarily contains every pattern
# below; scanning it would make the check refuse itself and nothing else.
SELF='tools/no-em-dashes.sh'

# ⚠️⚑ EVERY TRACKED FILE, not a chosen extension list. The first version listed
# extensions and so never looked at samples/generators/*.py (85 of them),
# tools/git-hooks/pre-commit, or ui/favicon.svg.
mapfile -t FILES < <(git ls-files | grep -v -x -F "$SELF")
[ ${#FILES[@]} -eq 0 ] && exit 0

# The character itself, then the ways it hides: a JS/TS unicode escape, and the
# HTML entity in three spellings.
CHAR=$(printf '\xe2\x80\x94')
# ⚠️ ONE backslash-pair, not two. `grep -E` needs `\\` to match a single literal
# backslash; four made it hunt for two, so the escaped form sailed through on the
# THIRD attempt at this guard. Every version of it has failed to fire at least
# once, and every one was caught the same way: add a violation, watch it pass.
ESCAPED='\\u2014'
HITS=$(grep -nH -I -E "$CHAR|$ESCAPED|&mdash;|&#8212;|&#x2014;" "${FILES[@]}" 2>/dev/null)

if [ -n "$HITS" ]; then
  echo "$HITS" >&2
  cat >&2 <<'MSG'

REFUSED: em-dash (the lines above).

  Use a spaced hyphen ( - ), a comma, or two sentences. For an empty table
  cell, a plain hyphen. There is no allowed use, in any spelling.

MSG
  exit 1
fi
exit 0
