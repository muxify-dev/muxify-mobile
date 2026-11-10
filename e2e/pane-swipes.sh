#!/bin/bash
#
# Pane swipes and the Layout map on the Terminal Screen.
#
# What this proves, against the sandbox's Session 0:
#
#   1  a Window with one Pane shows no Layout map
#   2  a swipe left goes to the next Pane and a swipe right to the previous
#      one, past either end too, and the Window stays zoomed
#   3  the Layout map names the active Pane, and a tap on it opens the Panes
#      picker
#   4  a slow sideways drag short of a quarter of the Surface's width and a
#      diagonal drag change no Pane, and a slow drag past the quarter and a
#      short flick each change it
#   5  a vertical drag still moves the Scrollback, and a swipe moves none
#   6  in a Pane whose program listens for the mouse, a swipe either way
#      changes the Pane and the program gets nothing, a vertical drag is
#      still the wheel, and the mouse layer does not follow to the next Pane
#   7  in a Window that is not zoomed, a swipe changes the Pane from the
#      active Pane and from another one, and the Window stays as it is
#
# The Surface renders with Metal, so what it shows is never in the
# accessibility tree. Each check reads the Host instead: the active Pane and
# the Zoom from tmux, and what a program received from `capture-pane`.
#
# Requires a configured .env.local and a booted simulator.
# Usage:  bash e2e/pane-swipes.sh

[ -n "${MUXIFY_E2E_ROOT:-}" ] || exec bash "$(dirname "$0")/sandbox.sh" bash "$0" "$@"

set -uo pipefail

APP=dev.muxify.app
SESSION=0
WINDOW="$SESSION:0"

# Runs a command on the dev Host, which is this Mac, in the sandbox.
on_host() { sh -c "$*" 2>/dev/null; }

fail() { echo "FAIL: $1"; exit 1; }

attach() {
  agent-device close >/dev/null 2>&1
  agent-device open "$APP" --platform ios --relaunch >/dev/null 2>&1
  agent-device wait text "Dev Host" 25000 >/dev/null 2>&1
  agent-device press 'label="All of Dev Host"' >/dev/null 2>&1
  agent-device wait 'label="Edit Host"' 15000 >/dev/null 2>&1
  agent-device wait 1500 >/dev/null 2>&1  # Home is under the Host Screen until the push settles
  agent-device wait "label=\"Session $SESSION\"" 15000 >/dev/null 2>&1
  agent-device press "label=\"Session $SESSION\"" >/dev/null 2>&1
  agent-device wait 'id="pane-command"' 20000 >/dev/null 2>&1 \
    || fail "never reached Connected"
  sleep 2
}

# The active Pane's index and the Window's Zoom, as `index zoomed`.
window_now() { on_host "tmux display-message -p -t '$WINDOW' '#{pane_index} #{window_zoomed_flag}'"; }

# What the Layout map says, or nothing when there is no map.
map_label() {
  agent-device snapshot --json 2>/dev/null | python3 -c "
import json, sys
for n in json.load(sys.stdin)['data']['nodes']:
    if (n.get('label') or '').startswith('Layout map'):
        print(n['label']); break
"
}

# A one-finger drag on the Surface: where it starts, how far it goes, how long.
drag() {
  agent-device gesture pan "$1" "$2" "$3" "$4" "${5:-300}" >/dev/null 2>&1
  sleep 1.5
}
# Past the commit point, a quarter of the Surface's width: 100 points here.
swipe_left() { drag 320 "${1:-400}" -220 0; }
swipe_right() { drag 80 "${1:-400}" 220 0; }

expect_window() {
  [ "$(window_now)" = "$1" ] || fail "$2: the Window is at '$(window_now)', not '$1'"
}

scrolled_back() { agent-device is exists 'id="scroll-position"' >/dev/null 2>&1; }

echo "1/7  a Window with one Pane shows no Layout map"
attach
[ -z "$(map_label)" ] || fail "one Pane, and there is a Layout map: $(map_label)"
swipe_left
expect_window "0 0" "a swipe with one Pane"
echo "     no map, and a swipe goes nowhere"

echo "2/7  a swipe goes to the next or the previous Pane, and keeps the Zoom"
# Before the Attach, which then zooms the Window, as it does on a phone.
# Each new Pane runs the sandbox's own plain bash, not the user's shell.
SHELL_COMMAND="env PS1='\$ ' BASH_SILENCE_DEPRECATION_WARNING=1 bash --noprofile --norc"
on_host "tmux send-keys -t '$WINDOW.0' 'seq 1 300' Enter; \
    tmux split-window -h -t '$WINDOW.0' \"$SHELL_COMMAND\"; \
    tmux split-window -v -t '$WINDOW.1' \"$SHELL_COMMAND\"; \
    tmux select-pane -t '$WINDOW.0'"
[ "$(on_host "tmux display-message -p -t '$WINDOW' '#{window_panes}'")" = 3 ] \
  || fail "the Window did not get its three Panes"
attach
expect_window "0 1" "after the Attach"
swipe_left;  expect_window "1 1" "a swipe left from Pane 0"
swipe_left;  expect_window "2 1" "a swipe left from Pane 1"
swipe_left;  expect_window "0 1" "a swipe left from the last Pane"
swipe_right; expect_window "2 1" "a swipe right from Pane 0"
swipe_right; expect_window "1 1" "a swipe right from Pane 2"
# Most of the way across. From iOS 26 the system's back swipe starts anywhere
# on a screen, and this is the drag it would take.
drag 60 400 280 0
expect_window "0 1" "a swipe right across the Surface"
agent-device is exists 'id="pane-command"' >/dev/null 2>&1 \
  || fail "a swipe right across the Surface left the Terminal Screen"
swipe_left
echo "     0 → 1 → 2 → 0, then back 0 → 2 → 1 → 0, zoomed throughout"

echo "3/7  the Layout map names the active Pane and opens the Panes picker"
[ "$(map_label)" = "Layout map, Pane 1 of 3" ] || fail "the map says '$(map_label)' on Pane 1 of 3"
swipe_right
[ "$(map_label)" = "Layout map, Pane 0 of 3" ] || fail "the map says '$(map_label)' on Pane 0 of 3"
agent-device press 'id="layout-map"' >/dev/null 2>&1
agent-device wait 'label="Close Panes"' 5000 >/dev/null 2>&1 \
  || fail "a tap on the Layout map did not open the Panes picker"
agent-device press 'label="Close Panes"' >/dev/null 2>&1
agent-device wait 1500 >/dev/null 2>&1
echo "     it follows the swipe, and a tap opens the picker"

echo "4/7  a drag changes the Pane past a quarter of the width, or on a flick"
# Slow, so that the speed of the finger makes no swipe of it.
drag 300 400 -80 0 1500
expect_window "0 1" "a slow 80 point drag"
drag 300 400 -160 0 1500
expect_window "1 1" "a slow 160 point drag"
drag 100 400 160 0 1500
expect_window "0 1" "a slow 160 point drag back"
drag 300 400 -60 0 50
expect_window "1 1" "a 60 point flick"
drag 100 400 60 0 50
expect_window "0 1" "a 60 point flick back"
drag 300 400 -120 100
expect_window "0 1" "a diagonal drag"
agent-device press 'label="Jump to latest"' >/dev/null 2>&1
sleep 1
echo "     the short slow drag and the diagonal one left Pane 0, the others did not"

echo "5/7  a vertical drag moves the Scrollback, and a swipe moves none"
scrolled_back && fail "the Pane is in its Scrollback before the drag"
drag 200 300 0 200
scrolled_back || fail "a vertical drag did not move the Scrollback"
expect_window "0 1" "a vertical drag"
agent-device press 'label="Jump to latest"' >/dev/null 2>&1
sleep 1
swipe_left
expect_window "1 1" "a swipe after the scroll"
scrolled_back && fail "a swipe moved the Scrollback"
swipe_right
echo "     the pill came up for the drag only"

echo "6/7  a program that listens for the mouse: a swipe is the Pane's, a drag is the wheel"
# `cat -v` echoes the SGR of every mouse event it is sent. See regressions.sh.
# On the alternate screen, as a full-screen program is: there a drag is the
# program's to scroll, and on the normal screen it is the Scrollback.
on_host "tmux send-keys -t '$WINDOW.0' 'clear; printf \"\\033[?1049h\\033[?1000h\\033[?1006h\"; cat -v' Enter"
sleep 2
on_host "tmux send-keys -t '$WINDOW.0' 'x'"
sleep 2
[ "$(on_host "tmux display-message -p -t '$WINDOW.0' '#{mouse_any_flag}'")" = 1 ] \
  || fail "the Pane never asked for the mouse; nothing below this means anything"
agent-device is exists 'id="mouse-layer"' >/dev/null 2>&1 || fail "no mouse layer over the Pane"
received() { on_host "tmux capture-pane -p -t '$WINDOW.0'" | grep -c '\[<'; }
swipe_left
expect_window "1 1" "a swipe left on the mouse layer"
agent-device is exists 'id="mouse-layer"' >/dev/null 2>&1 \
  && fail "the mouse layer followed the swipe to a Pane that does not ask for the mouse"
swipe_right
expect_window "0 1" "a swipe back to the Pane with the mouse"
agent-device is exists 'id="mouse-layer"' >/dev/null 2>&1 \
  || fail "no mouse layer after the swipe back to the Pane that asks for the mouse"
swipe_right
expect_window "2 1" "a swipe right on the mouse layer"
swipe_left
expect_window "0 1" "a swipe back from the last Pane"
[ "$(received)" = 0 ] || fail "the program got mouse events from a swipe"
drag 200 300 0 200
[ "$(received)" -gt 0 ] || fail "a vertical drag sent the program no wheel"
on_host "tmux capture-pane -p -t '$WINDOW.0'" | grep -q '\[<6[45];' \
  || fail "what the program got from a vertical drag is not a wheel"
expect_window "0 1" "a vertical drag on the mouse layer"
on_host "tmux send-keys -t '$WINDOW.0' C-c; sleep 1; \
    tmux send-keys -t '$WINDOW.0' 'printf \"\\033[?1006l\\033[?1000l\\033[?1049l\"; clear' Enter"
echo "     the swipes sent the program nothing, the drag sent it the wheel"

echo "7/7  a Window that is not zoomed keeps its split across a swipe"
# Two Panes side by side, so each one is a known half of the Surface.
on_host "tmux kill-pane -t '$WINDOW.2'; tmux select-pane -t '$WINDOW.0'"
sleep 2
expect_window "0 0" "after closing a Pane from the Host"
# From the active Pane, on the left: the Surface's own gesture.
drag 180 400 -150 0
expect_window "1 0" "a swipe on the active Pane of a split"
# From Pane 0 again, which is now the other Pane: the layer over it.
drag 180 400 -150 0
expect_window "0 0" "a swipe on the other Pane of a split"
echo "     0 → 1 → 0, and never zoomed"

echo
echo "PASS: a swipe left or right on the Surface goes to the next or the previous"
echo "      Pane and keeps the Zoom, a vertical drag stays the Scrollback or the"
echo "      wheel, and the Layout map shows the active Pane and opens the Panes"
echo "      picker."
