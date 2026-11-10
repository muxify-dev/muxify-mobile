#!/bin/bash
#
# The Terminal Screen's Header: the title, the Title Sheet and the ⋯ Options.
#
# What this proves, against the sandbox's Session 0:
#
#   1  the title is the Session name over the program in the active Pane
#   2  a Window made on the Host is a row of the Title Sheet
#   3  Font size − and + change the setting live: the Surface reflows, reports
#      a new grid, and tmux's Window follows it both ways
#   4  Copy Pane text puts the Pane's text on the clipboard
#   5  the chooser lists the Host's Topics, and a Topic opens its
#      Session in the current Attach
#   6  Disconnect ends the Attach, so the Host has no Client left, and lands
#      on Home
#
# The Surface renders with Metal, so what it shows is never in the
# accessibility tree. Each check reads the Host instead: tmux's Window size for
# the font, the clipboard for the Pane text, `list-clients` for the Attach.
#
# The Topics list is off by default, so the app's settings get it for the run,
# as e2e/topic-screen.sh does. The sandbox puts the settings back.
#
# Requires a configured .env.local and a booted simulator.
# Usage:  bash e2e/header.sh

[ -n "${MUXIFY_E2E_ROOT:-}" ] || exec bash "$(dirname "$0")/sandbox.sh" bash "$0" "$@"

set -uo pipefail

APP=dev.muxify.app
device=()
[ -z "${MUXIFY_E2E_DEVICE:-}" ] || device=(--udid "$MUXIFY_E2E_DEVICE")
SESSION=0
MARKER=header-e2e-marker
TOPIC="e2e Switch Topic"

# Runs a command on the dev Host, which is this Mac, in the sandbox.
on_host() { sh -c "$*" 2>/dev/null; }

fail() { echo "FAIL: $1"; exit 1; }

window() { on_host "tmux display-message -p -t '$SESSION' '#{window_width}x#{window_height}'"; }

attach() {
  agent-device close >/dev/null 2>&1
  agent-device open "$APP" --platform ios --relaunch "${device[@]}" >/dev/null 2>&1
  agent-device wait text "Dev Host" 25000 >/dev/null 2>&1
  agent-device press 'label="Host Dev Host"' --settle >/dev/null 2>&1
  agent-device wait "label=\"Session $SESSION\"" 15000 >/dev/null 2>&1
  agent-device press "label=\"Session $SESSION\"" >/dev/null 2>&1
  # The program line renders once the Topology has an active Pane, which the
  # Attach reads only after it is connected on a settled grid.
  agent-device wait 'id="pane-command"' 20000 >/dev/null 2>&1 \
    || fail "the header never showed a program, so the Attach never connected"
}

# Opens ⋯ and presses one of its items. Pressed again if the menu did not come
# up: a press landing while the screen is still settling does nothing at all.
option() {
  for _ in 1 2 3; do
    agent-device press 'label="Options"' >/dev/null 2>&1
    if agent-device wait "label=\"$1\"" 3000 >/dev/null 2>&1; then
      # By role: a menu item is a cell and a button under one label.
      agent-device press "role=button label=\"$1\"" >/dev/null 2>&1
      return 0
    fi
  done
  fail "the Options menu never offered $1"
}

# Dismisses the alert an action ends with.
ok() {
  agent-device wait 'label="OK"' 8000 >/dev/null 2>&1 || fail "$1 showed no alert"
  agent-device press 'label="OK"' >/dev/null 2>&1
  sleep 1
}

echo "0/6  a Session with one Window, and the Pane at a prompt"
python3 - "$(xcrun simctl get_app_container "${MUXIFY_E2E_DEVICE:-booted}" "$APP" data)/Documents/muxify-settings.json" <<'PY'
import json, sys
path = sys.argv[1]
settings = json.load(open(path))
settings.pop("hostListPreferences", None)
settings["hostScreenLists"] = ["topics", "sessions"]
json.dump(settings, open(path, "w"))
PY
TOPIC_ID=$(muxify topic new "$TOPIC" --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["changed"]["topic_id"])') || fail "could not make a Topic"
mkdir -p "$MUXIFY_E2E_ROOT/header-topic"
TOPIC_SESSION=$(muxify topic add-session "$MUXIFY_E2E_ROOT/header-topic" --topic "$TOPIC_ID" --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["changed"]["session_name"])') || fail "could not add a Session"
on_host "tmux kill-window -a -t '$SESSION:0' 2>/dev/null; \
    tmux send-keys -t '$SESSION:' C-c; tmux send-keys -t '$SESSION:' 'clear' Enter; true" \
  || fail "could not reach the dev Host"
attach

echo "1/6  the title is the Session name over the program"
agent-device is text 'id="attached-session"' "$SESSION" >/dev/null 2>&1 \
  || fail "the header does not name Session $SESSION"
agent-device is text 'id="pane-command"' "bash" >/dev/null 2>&1 \
  || fail "the header does not say the Pane runs bash"
echo "     $SESSION over bash"

echo "2/6  a Window made on the Host is a row of the Title Sheet"
on_host "tmux new-window -t '$SESSION:' -n logs 'exec bash'; tmux select-window -t '$SESSION:0'"
sleep 2
agent-device press 'id="header-title"' >/dev/null 2>&1
agent-device wait 'label="Close Choose"' 8000 >/dev/null 2>&1 || fail "the Title Sheet never opened"
agent-device press 'label="Windows"' >/dev/null 2>&1
agent-device wait 'label="logs"' 8000 >/dev/null 2>&1 || fail "the logs Window is not in the Title Sheet"
agent-device is exists 'label="Sessions"' >/dev/null 2>&1 || fail "the chooser has no Sessions tab"
agent-device press 'label="Close Choose"' >/dev/null 2>&1
sleep 1
echo "     logs listed in Windows"

echo "3/6  Font size − grows the Window, and Font size + brings it back"
BEFORE=$(window)
option "Font size −"
sleep 5
SMALLER=$(window)
python3 - "$BEFORE" "$SMALLER" <<'PY' || fail "Font size − did not grow the Window: $BEFORE → $SMALLER"
import sys
(bw, bh), (sw, sh) = (map(int, a.split('x')) for a in sys.argv[1:3])
sys.exit(0 if sw > bw and sh > bh else 1)
PY
echo "     $BEFORE → $SMALLER at the smaller font"
option "Font size +"
sleep 5
[ "$(window)" = "$BEFORE" ] || fail "Font size + did not bring the Window back: $BEFORE → $(window)"
echo "     and back to $BEFORE"

echo "4/6  Copy Pane text puts the Pane on the clipboard"
on_host "tmux send-keys -t '$SESSION:' 'echo $MARKER' Enter"
sleep 1
option "Copy Pane text"
ok "Copy Pane text"
xcrun simctl pbpaste "${MUXIFY_E2E_DEVICE:-booted}" | grep -q "$MARKER" \
  || fail "the clipboard does not hold the Pane's text"
echo "     the marker is on the clipboard"

echo "5/6  Topics opens a Topic Session in place"
agent-device press 'id="header-title"' >/dev/null 2>&1
agent-device wait 'label="Close Choose"' 8000 >/dev/null 2>&1 || fail "the Title Sheet never opened"
agent-device press 'label="Topics"' >/dev/null 2>&1
agent-device wait "label=\"Topic $TOPIC\"" 15000 >/dev/null 2>&1 || fail "the chooser does not list the Topic"
# The row is in the tree before the sheet has come to rest, and a press on a
# sheet that still moves lands nowhere.
sleep 1
agent-device press "label=\"Topic $TOPIC\"" >/dev/null 2>&1
agent-device wait 'id="topic-title"' 15000 >/dev/null 2>&1 || fail "the Topic did not attach"
agent-device is text 'id="topic-title"' "$TOPIC" >/dev/null 2>&1 || fail "the Header names another Topic"
agent-device is text 'id="attached-session"' "$TOPIC_SESSION" >/dev/null 2>&1 || fail "the Topic Session did not attach"
echo "     the Topic opened its Session in the same Attach"

echo "6/6  Disconnect ends the Attach and returns to the Host Screen"
option "Disconnect"
agent-device wait 'label="Edit Host"' 8000 >/dev/null 2>&1 || fail "Disconnect did not return to the Host Screen"
sleep 2
CLIENTS=$(on_host "tmux list-clients" | wc -l | tr -d ' ')
[ "$CLIENTS" = 0 ] || fail "the Host still has $CLIENTS Client(s) on Session $SESSION after Disconnect"
echo "     Host Screen, and no Client left on the Host"

agent-device close >/dev/null 2>&1
on_host "tmux kill-window -a -t '$SESSION:0' 2>/dev/null; true"
echo
echo "PASS: the Header names the Session and its program, the Title Sheet lists"
echo "      the Host's Windows, the font follows the Options menu live both"
echo "      ways, Copy Pane text reaches the clipboard, the chooser lists the Host's"
echo "      Topics and switches to one in the Attach, and Disconnect leaves no"
echo "      Client behind."
