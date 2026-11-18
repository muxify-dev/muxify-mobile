#!/bin/bash
#
# The back swipe: the left edge always goes back. See ADR 0025.
#
# What this proves, against the sandbox's Session 0:
#
#   1  on the Terminal Screen, a drag right from the left edge goes back to
#      the Host Screen and changes no Pane
#   2  on the Terminal Screen, a drag right that starts outside the edge band
#      is still a Pane Swipe
#   3  on the Terminal Screen with a Selection open, a drag from the edge
#      does not go back
#   4  in a Pane whose program listens for the mouse, a drag from the edge
#      goes back, and the program gets nothing
#   5  on the Host Screen, a sideways drag on the tab control or on the bar
#      at the bottom changes the tab, one on a row does not, a tap on the
#      control, the Go to field and ＋ still works, a drag right from the
#      middle of the list goes back to Home, and so does a drag from the edge
#      on the tab control
#   6  on Settings, a drag right goes back from the edge and from the middle
#
# The Surface renders with Metal, so what it shows is never in the
# accessibility tree. Which screen is on top comes from the Header, and the
# active Pane from tmux.
#
# Requires a configured .env.local and a booted simulator.
# Usage:  bash e2e/back-swipe.sh

[ -n "${MUXIFY_E2E_ROOT:-}" ] || exec bash "$(dirname "$0")/sandbox.sh" bash "$0" "$@"

set -uo pipefail

APP=dev.muxify.app
SESSION=0
WINDOW="$SESSION:0"
PANE="$WINDOW.0"
DEVICE_ARGS=()
[ -z "${MUXIFY_E2E_DEVICE:-}" ] || DEVICE_ARGS=(--udid "$MUXIFY_E2E_DEVICE")

on_host() { sh -c "$*" 2>/dev/null; }

SETTINGS="$(xcrun simctl get_app_container "${MUXIFY_E2E_DEVICE:-booted}" "$APP" data)/Documents/muxify-settings.json"
# The tab the Host Screen remembers for the dev Host, which is the one on show.
tab_now() {
  python3 -c "import json, sys; print(*json.load(open(sys.argv[1])).get('hostScreenTabs', {}).values())" "$SETTINGS"
}
expect_tab() {
  [ "$(tab_now)" = "$1" ] || fail "$2: the Host Screen is on '$(tab_now)', not '$1'"
}
on_home() { agent-device is exists 'label="Host Dev Host"' >/dev/null 2>&1 && ! agent-device is exists 'label="Host Options"' >/dev/null 2>&1; }

fail() { echo "FAIL: $1"; exit 1; }

open_host() {
  agent-device close >/dev/null 2>&1
  agent-device open "$APP" --platform ios "${DEVICE_ARGS[@]}" --relaunch >/dev/null 2>&1
  agent-device wait 'label="Host Dev Host"' 25000 >/dev/null 2>&1
  agent-device press 'label="Host Dev Host"' >/dev/null 2>&1
  agent-device wait 'label="Host Options"' 15000 >/dev/null 2>&1 || fail "the Host Screen did not open"
  agent-device wait 1500 >/dev/null 2>&1  # Home is under the Host Screen until the push settles
}

attach() {
  open_host
  agent-device wait "label=\"Session $SESSION\"" 15000 >/dev/null 2>&1
  agent-device press "label=\"Session $SESSION\"" >/dev/null 2>&1
  agent-device wait 'label="Open Terminal chooser" enabled=true' 20000 >/dev/null 2>&1 \
    || fail "never reached Connected"
  agent-device wait 'role="text-view" editable=true' 20000 >/dev/null 2>&1 \
    || fail "the Surface never became ready for input"
  sleep 2
}

drag() {
  agent-device gesture pan "$1" "$2" "$3" "$4" "${5:-300}" >/dev/null 2>&1
  sleep 1.5
}

on_terminal() { agent-device is exists 'label="Open Terminal chooser"' >/dev/null 2>&1; }
on_host_screen() { agent-device is exists 'label="Host Options"' >/dev/null 2>&1 && ! on_terminal; }

window_now() { on_host "tmux display-message -p -t '$WINDOW' '#{pane_index} #{window_zoomed_flag}'"; }
expect_window() {
  [ "$(window_now)" = "$1" ] || fail "$2: the Window is at '$(window_now)', not '$1'"
}

SHELL_COMMAND="env PS1='\$ ' BASH_SILENCE_DEPRECATION_WARNING=1 bash --noprofile --norc"
on_host "tmux send-keys -t '$PANE' 'echo hello world' Enter; \
    tmux split-window -h -t '$PANE' \"$SHELL_COMMAND\"; \
    tmux select-pane -t '$PANE'"

echo "1/6  on the Terminal Screen, a drag from the left edge goes back"
attach
expect_window "0 1" "after the Attach"
drag 2 400 220 0
on_host_screen || fail "a drag from the left edge did not leave the Terminal Screen"
expect_window "0 1" "a drag from the left edge"
echo "     the Host Screen is on top, and the Pane did not change"

echo "2/6  outside the band, a drag right is a Pane Swipe"
attach
drag 60 400 220 0
on_terminal || fail "a drag right from x = 60 left the Terminal Screen"
expect_window "1 1" "a drag right from x = 60"
drag 320 400 -220 0
expect_window "0 1" "a drag left back to Pane 0"
echo "     the Pane changed, and the Terminal Screen stayed"

echo "3/6  with a Selection open, a drag from the edge does not go back"
agent-device longpress 30 140 800 >/dev/null 2>&1
sleep 1.5
agent-device is exists 'label="Copy"' >/dev/null 2>&1 || fail "the long press opened no Selection"
drag 2 400 220 0
on_terminal || fail "a drag from the edge with a Selection open left the Terminal Screen"
echo "     the Terminal Screen stayed"

echo "4/6  in a Pane that listens for the mouse, a drag from the edge goes back"
# `cat -v` echoes the SGR of every mouse event it is sent. See pane-swipes.sh.
attach
on_host "tmux send-keys -t '$PANE' 'clear; printf \"\\033[?1049h\\033[?1000h\\033[?1006h\"; cat -v' Enter"
sleep 2
on_host "tmux send-keys -t '$PANE' 'x'"
sleep 2
[ "$(on_host "tmux display-message -p -t '$PANE' '#{mouse_any_flag}'")" = 1 ] \
  || fail "the Pane never asked for the mouse"
agent-device is exists 'id="mouse-layer"' >/dev/null 2>&1 || fail "no mouse layer over the Pane"
drag 2 400 220 0
on_host_screen || fail "a drag from the edge on the mouse layer did not leave the Terminal Screen"
expect_window "0 1" "a drag from the edge on the mouse layer"
[ "$(on_host "tmux capture-pane -p -t '$PANE'" | grep -c '\[<')" = 0 ] \
  || fail "the program got mouse events from the back swipe"
echo "     the Host Screen is on top, and the program got nothing"

echo "5/6  on the Host Screen, the tab control and the bar change the tab, and the list goes back"
# The centre of the first node with label $1, or of type $2 when $1 is empty, as "x y".
centre() {
  agent-device snapshot --json 2>/dev/null | python3 -c "
import json, sys
for n in json.load(sys.stdin)['data']['nodes']:
    if (n.get('label') == sys.argv[1]) if sys.argv[1] else (n.get('type') == sys.argv[2]):
        r = n['rect']; print(round(r['x'] + r['width'] / 2), round(r['y'] + r['height'] / 2)); break
" "$1" "${2:-}"
}
open_host
expect_tab sessions "after the Host Screen opened"
read -r _ CONTROL_Y < <(centre "Host Screen view")
read -r _ BAR_Y < <(centre "Go to")
[ -n "${CONTROL_Y:-}" ] && [ -n "${BAR_Y:-}" ] || fail "no tab control or Go to field on the Host Screen"
drag 100 "$CONTROL_Y" 200 0
expect_tab topics "a drag right on the tab control on Sessions"
on_host_screen || fail "a drag right on the tab control left the Host Screen"
drag 280 "$BAR_Y" -200 0
expect_tab sessions "a drag left on the Go to field on Topics"
agent-device press 'label="Topics"' >/dev/null 2>&1
sleep 1
expect_tab topics "a tap on Topics"
read -r _ ROW_Y < <(centre "" Cell)
[ -n "${ROW_Y:-}" ] || fail "no row on Topics"
drag 300 "$ROW_Y" -200 0
expect_tab topics "a drag left on a row on Topics"
agent-device press 'label="Go to"' >/dev/null 2>&1
agent-device wait 'role=search' 3000 >/dev/null 2>&1
agent-device snapshot -i 2>/dev/null | grep -q 'search.*\[focused\]' || fail "a tap on Go to did not give it the keys"
agent-device press 'label="close"' >/dev/null 2>&1
agent-device wait 'label="Host Screen view"' 5000 >/dev/null 2>&1 || fail "no tab control after Go to closed"
agent-device press 'label="New"' >/dev/null 2>&1
agent-device wait 'label="New Topic"' 3000 >/dev/null 2>&1 || fail "a tap on ＋ did not open its menu"
agent-device press 200 450 >/dev/null 2>&1
agent-device wait absent 'label="New Topic"' 3000 >/dev/null 2>&1 || fail "the ＋ menu did not close"
expect_tab topics "after Go to and ＋"
drag 150 500 220 0
on_home || fail "a drag right from the middle of the list did not go back to Home"
open_host
drag 2 "$CONTROL_Y" 220 0
on_home || fail "a drag right from the left edge on the tab control did not go back to Home"
echo "     the control and the bar changed the tab, the row and the taps kept theirs, the list and the edge went back"

echo "6/6  on Settings, a drag right goes back from the edge and from the middle"
agent-device press 'role=button label="Settings"' >/dev/null 2>&1
agent-device wait 'label="Add Host"' 8000 >/dev/null 2>&1 || fail "Settings did not open"
sleep 1
drag 2 500 220 0
agent-device is exists 'label="Add Host"' >/dev/null 2>&1 && fail "a drag from the edge did not leave Settings"
agent-device press 'role=button label="Settings"' >/dev/null 2>&1
agent-device wait 'label="Add Host"' 8000 >/dev/null 2>&1 || fail "Settings did not open again"
sleep 1
drag 150 500 220 0
agent-device is exists 'label="Add Host"' >/dev/null 2>&1 && fail "a drag from the middle did not leave Settings"
echo "     both went back to Home"

echo "PASS"
