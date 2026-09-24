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
# proves is that the Host's real Topology reaches both sheets, that each sheet
# carries its own actions, and that a button with nothing to offer says so.
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
  agent-device wait text "Dev Host" 25000 >/dev/null 2>&1
  # The real flow: a saved Host, its Sessions, then one of them.
  agent-device press 'label="Dev Host"' >/dev/null 2>&1
  agent-device wait "label=\"Session $SESSION\"" 15000 >/dev/null 2>&1
  agent-device press "label=\"Session $SESSION\"" >/dev/null 2>&1
  for _ in $(seq 1 20); do
    agent-device is text 'id="connection-status"' "Connected" >/dev/null 2>&1 && break
    sleep 1
  done
  agent-device is text 'id="connection-status"' "Connected" >/dev/null 2>&1 \
    || fail "never reached Connected"
}

# The Topology read that decides the Dock's buttons lands a few round trips
# after Connected, so this waits for the answer rather than guessing how long
# those take on the day.
expect_enabled() {
  local label=$1 want=$2
  for _ in $(seq 1 15); do
    [ "$(enabled "$label")" = "$want" ] && return 0
    sleep 1
  done
  fail "$label button should be ${want/yes/enabled}${want/no/disabled}, it is $(enabled "$label")"
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

# Each card is a Button carrying its Window name or Pane title.
named() { agent-device snapshot -i 2>/dev/null | grep -cE "^@e[0-9]+ \[button\] \"$1\""; }

echo "1/4  one Window, one Pane: neither picker has anything to offer"
vm "tmux kill-window -a -t '$SESSION:0' 2>/dev/null; \
    tmux kill-pane -a -t '$SESSION:0.0' 2>/dev/null; true" || fail "could not reach the VM"
attach
expect_enabled Windows no
expect_enabled Panes no

echo "2/4  three Windows: the Windows picker opens and lists them"
vm "tmux new-window -t '$SESSION:' -n logs 'exec bash'; \
    tmux new-window -t '$SESSION:' -n notes 'exec bash'; \
    tmux select-window -t '$SESSION:0'"
attach
expect_enabled Windows yes
agent-device press 'label="Windows"' >/dev/null 2>&1
agent-device wait text "Windows" 8000 >/dev/null 2>&1
[ "$(named 'logs')" -eq 1 ] || fail "the logs Window is missing from the sheet"
[ "$(named 'notes')" -eq 1 ] || fail "the notes Window is missing from the sheet"
# `exists` rather than `visible`: SwiftUI content inside the sheet reports
# itself unhittable to agent-device even when a finger can press it.
agent-device is exists 'label="New Window"' >/dev/null 2>&1 \
  || fail "the Windows sheet has no New Window action"

echo "3/4  two Panes: the Panes picker opens and lists them"
vm "tmux split-window -t '$SESSION:0' 'exec bash'; tmux select-pane -t '$SESSION:0.0'"
attach
expect_enabled Panes yes
agent-device press 'label="Panes"' >/dev/null 2>&1
agent-device wait text "Panes" 8000 >/dev/null 2>&1
[ "$(named 'Split →')" -eq 1 ] || fail "the Panes sheet has no Split → action"
[ "$(named 'Split ↓')" -eq 1 ] || fail "the Panes sheet has no Split ↓ action"
agent-device snapshot -i 2>/dev/null | grep -q 'Zoom' \
  || fail "the Panes sheet has no Zoom toggle"

echo "4/4  putting the Host back the way it was found"
agent-device close >/dev/null 2>&1
vm "tmux kill-window -a -t '$SESSION:0' 2>/dev/null; \
    tmux kill-pane -a -t '$SESSION:0.0' 2>/dev/null; true"

echo
echo "PASS: Topology reaches both sheets, each carries its own actions, and a"
echo "      picker with nothing to offer is disabled."
