#!/bin/bash
#
# Window and Pane pickers (ticket 09).
#
# Covers the two things the .ad suites cannot: whether a Dock button is
# genuinely disabled — `agent-device is` has no `enabled` predicate, so this
# reads the flag out of the snapshot JSON — and the Windows and Panes sheets,
# which cannot both be exercised in one .ad run because a presented sheet
# cannot be dismissed from automation (see e2e/session-picker.ad).
#
# Selecting a row is still out of reach here and is verified by hand; what this
# proves is that the Host's real Topology reaches the sheet, that the current
# Window and Pane are marked, and that a button with nothing to offer says so.
#
# Drives the Host's Topology itself, so it does not depend on how the VM was
# left. Requires a configured .env.local and a booted simulator.
# Usage:  bash e2e/pickers.sh

set -uo pipefail

APP=dev.muxify.app
SESSION=0

vm() {
  ssh -F /dev/null -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
    -i "$HOME/.orbstack/ssh/id_ed25519" -p 32222 default@127.0.0.1 "$@" 2>/dev/null
}

fail() { echo "FAIL: $1"; exit 1; }

attach() {
  agent-device close >/dev/null 2>&1
  agent-device open "$APP" --platform ios --relaunch >/dev/null 2>&1
  agent-device wait text "No Hosts yet" 25000 >/dev/null 2>&1
  agent-device press 'label="Open Surface smoke test"' >/dev/null 2>&1
  for _ in $(seq 1 20); do
    agent-device is text 'id="connection-status"' "Connected" >/dev/null 2>&1 && break
    sleep 1
  done
  agent-device is text 'id="connection-status"' "Connected" >/dev/null 2>&1 \
    || fail "never reached Connected"
  # The Topology read that decides the Dock's buttons happens just after.
  sleep 3
}

# Whether the Dock button with this label is pressable.
enabled() {
  agent-device snapshot --json 2>/dev/null | python3 -c "
import json,sys
label=sys.argv[1]
for n in json.load(sys.stdin)['data']['nodes']:
    if n['type']=='Button' and n.get('label')==label:
        print('yes' if n['enabled'] else 'no'); break
else: print('missing')
" "$1"
}

rows() { agent-device snapshot -i 2>/dev/null | grep -cE "^@e[0-9]+ \[button\] \"$1\""; }
marked() { agent-device snapshot -i 2>/dev/null | grep -cE '^@e[0-9]+ \[image\] "Selected"'; }

echo "1/4  one Window, one Pane: neither picker has anything to offer"
vm "tmux kill-window -a -t '$SESSION:0' 2>/dev/null; \
    tmux kill-pane -a -t '$SESSION:0.0' 2>/dev/null; true" || fail "could not reach the VM"
attach
[ "$(enabled Windows)" = no ] || fail "Windows button should be disabled for a single Window"
[ "$(enabled Panes)" = no ] || fail "Panes button should be disabled for a single Pane"

echo "2/4  three Windows: the Windows picker opens and lists them"
vm "tmux new-window -t '$SESSION:' -n logs 'exec bash'; \
    tmux new-window -t '$SESSION:' -n notes 'exec bash'; \
    tmux select-window -t '$SESSION:0'"
attach
[ "$(enabled Windows)" = yes ] || fail "Windows button should be enabled for three Windows"
agent-device press 'label="Windows"' >/dev/null 2>&1
agent-device wait text "Windows" 8000 >/dev/null 2>&1
[ "$(rows '[0-9]+: .*')" -eq 3 ] || fail "expected three Windows in the sheet"
[ "$(marked)" -eq 1 ] || fail "the active Window should be the only one marked"

echo "3/4  two Panes: the Panes picker opens and lists them"
vm "tmux split-window -t '$SESSION:0' 'exec bash'; tmux select-pane -t '$SESSION:0.0'"
attach
[ "$(enabled Panes)" = yes ] || fail "Panes button should be enabled for two Panes"
agent-device press 'label="Panes"' >/dev/null 2>&1
agent-device wait text "Panes" 8000 >/dev/null 2>&1
[ "$(rows '[0-9]+: .*')" -eq 2 ] || fail "expected two Panes in the sheet"
[ "$(marked)" -eq 1 ] || fail "the active Pane should be the only one marked"

echo "4/4  putting the Host back the way it was found"
agent-device close >/dev/null 2>&1
vm "tmux kill-window -a -t '$SESSION:0' 2>/dev/null; \
    tmux kill-pane -a -t '$SESSION:0.0' 2>/dev/null; true"

echo
echo "PASS: Topology reaches both sheets, the current row is marked, and a"
echo "      picker with nothing to offer is disabled."
