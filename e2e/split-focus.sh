#!/bin/bash
#
# The keyboard after a split: the new Pane takes it, and the keys typed on
# the way there reach the new Pane and never the old one (ADR 0039).
#
# What this proves, against the sandbox's Session 0:
#
#   1  with the keyboard up on Pane A, Split → puts the keyboard on the new
#      Pane: it stays up, and the new Pane is the active one
#   2  a key typed at once after the tap, before the new Pane is painted, and
#      keys typed after the paint, all run in the new Pane and none in A
#   3  with the keyboard down, a Pane swipe leaves it down
#
# The Surface renders with Metal, so what it shows is never in the
# accessibility tree. Each check reads the Host instead: the active Pane and
# what each Pane shows, from tmux.
#
# The keys go in on the software keyboard, key by key at its frame, because
# the keyboard is what is under test. See `key_at` in e2e/regressions.sh for
# why `agent-device type` is not used. The marker is a word the shell does not
# know, so the Pane that ran it says `command not found` with the marker in it.
#
# Requires a booted simulator with a software keyboard.
#   MUXIFY_E2E_DEVICE=<simulator UDID> bash e2e/split-focus.sh

[ -n "${MUXIFY_E2E_ROOT:-}" ] || exec bash "$(dirname "$0")/sandbox.sh" bash "$0" "$@"

set -uo pipefail

APP=dev.muxify.app
SESSION=0
WINDOW="$SESSION:0"
MARKER=qzx
device=()
[ -z "${MUXIFY_E2E_DEVICE:-}" ] || device=(--udid "$MUXIFY_E2E_DEVICE")

# Runs a command on the dev Host, which is this Mac, in the sandbox.
on_host() { sh -c "$*" 2>/dev/null; }

fail() { echo "FAIL: $1"; exit 1; }

active_pane() { on_host "tmux display-message -p -t '$WINDOW' '#{pane_id}'"; }
pane_text() { on_host "tmux capture-pane -p -t '$1'"; }

# The frame of a button or key, as `x y width height`, or nothing when it is not on screen.
frame_of() {
  agent-device snapshot --json 2>/dev/null | LABEL="$1" python3 -c "
import json, os, sys
for n in json.load(sys.stdin)['data']['nodes']:
    if n['type'] in ('Key', 'Button') and (n.get('label') or '').lower() == os.environ['LABEL'].lower():
        r = n['rect']
        print(round(r['x']), round(r['y']), round(r['width']), round(r['height']))
        break
"
}

# Presses the middle of a key of the software keyboard, or of a button.
press_at() {
  local x y w h
  read -r x y w h <<<"$(frame_of "$1")"
  [ -n "${x:-}" ] || fail "no $1 on screen"
  agent-device press "$((x + w / 2))" "$((y + h / 2))" >/dev/null 2>&1
}

keyboard_up() { [ -n "$(frame_of return)" ]; }

attach() {
  agent-device close >/dev/null 2>&1
  agent-device open "$APP" --platform ios --relaunch "${device[@]}" >/dev/null 2>&1
  agent-device wait text "Dev Host" 25000 >/dev/null 2>&1
  agent-device press 'label="Host Dev Host"' >/dev/null 2>&1
  agent-device wait "label=\"Session $SESSION\"" 15000 >/dev/null 2>&1
  agent-device press "label=\"Session $SESSION\"" >/dev/null 2>&1
  agent-device wait 'id="pane-command"' 20000 >/dev/null 2>&1 \
    || fail "the header never showed a program, so the Attach never connected"
}

echo "0/3  a Session with one Window and one Pane at a prompt, the keyboard up"
on_host "tmux kill-window -a -t '$WINDOW' 2>/dev/null; tmux kill-pane -a -t '$WINDOW' 2>/dev/null; true"
on_host "tmux send-keys -t '$WINDOW' C-c; tmux send-keys -t '$WINDOW' 'clear' Enter"
sleep 1
OLD=$(active_pane)
attach
for _ in 1 2 3; do
  keyboard_up && break
  agent-device press 'label="Keyboard"' >/dev/null 2>&1
  sleep 3
done
keyboard_up || fail "the Keyboard button did not raise the keyboard"

echo "1/3  Split → puts the keyboard on the new Pane"
agent-device press 'label="Options"' >/dev/null 2>&1
agent-device wait 'label="Split Pane"' 8000 >/dev/null 2>&1 || fail "no Split Pane in Options"
agent-device press 'label="Split Pane"' >/dev/null 2>&1
agent-device wait 'label="Split →"' 8000 >/dev/null 2>&1 || fail "no Split → in Split Pane"
agent-device press 'label="Split →"' >/dev/null 2>&1
# At once, before the new Pane is painted. A key that finds the keyboard gone
# is lost to the test, not to the app, so the wait is for the keyboard.
for _ in 1 2 3 4 5 6 7 8 9 10; do
  keyboard_up && break
  sleep 0.3
done
keyboard_up || fail "the keyboard did not stay up for the new Pane"
press_at "${MARKER:0:1}"
sleep 3
NEW=$(active_pane)
[ "$NEW" != "$OLD" ] || fail "tmux did not make a new active Pane"
keyboard_up || fail "the keyboard is not up on the new Pane after it painted"
echo "     the keyboard is up and $NEW is the active Pane"

echo "2/3  the keys typed meanwhile run in the new Pane and not in the old one"
press_at "${MARKER:1:1}"
press_at "${MARKER:2:1}"
press_at return
sleep 2
pane_text "$NEW" | grep -q "$MARKER" || fail "the marker never ran in the new Pane $NEW: $(pane_text "$NEW" | tail -3)"
pane_text "$OLD" | grep -qE "q|z|x" && fail "a key reached the old Pane $OLD: $(pane_text "$OLD" | tail -3)"
echo "     $MARKER ran in $NEW, and $OLD shows none of its keys"

echo "3/3  with the keyboard down, a Pane swipe leaves it down"
agent-device press 'label="Keyboard"' >/dev/null 2>&1
sleep 2
keyboard_up && fail "the Keyboard button did not dismiss the keyboard"
agent-device gesture pan 320 400 -220 0 300 >/dev/null 2>&1
sleep 3
[ "$(active_pane)" = "$OLD" ] || fail "the swipe did not go to the other Pane"
keyboard_up && fail "a Pane swipe raised the keyboard that the user had dismissed"
echo "     the swipe moved to $OLD and the keyboard stayed down"
agent-device close >/dev/null 2>&1
echo "PASS"
