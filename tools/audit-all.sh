#!/bin/bash
# Full audit gate. Run before letting anyone else play.
set -o pipefail
cd "$(dirname "$0")/.."
fail=0
run() { echo; echo "=== $1 ==="; shift; "$@" 2>&1 | tail -"${TAIL:-4}" || fail=1; }
TAIL=3 run "optics"        node tools/test-optics.mjs
TAIL=2 run "levels"        node tools/validate-levels.mjs
TAIL=3 run "singleplayer"  node tools/audit-solo.mjs
TAIL=3 run "real input"    node tools/audit-input.mjs
TAIL=4 run "multiplayer"   node tools/audit-mp.mjs
echo
[ $fail -eq 0 ] && echo "ALL AUDITS PASSED" || echo "SOMETHING FAILED"
exit $fail
