#!/bin/bash
#
# The Grip and the Edge Drawer, on the Terminal Screen and the Web View.
#
# What this proves, against the sandbox's Session 0, with Window 0 split in
# two Panes and a Window 1 `logs` whose Browser has one Tab:
#
#   1  a hold on the Grip and a lift there closes the drawer and picks
#      nothing: the drawer is drag-only
#   2  a hold, a slide onto a Pane row and a lift there goes to that Pane
#   3  a quick drag that starts on the Grip is still a Pane Swipe
#   4  a slide onto a Window row goes to that Window
#   5  a slide onto a Tab of another Window goes to that Window first, then
#      opens the Tab in the Web View
#   6  on the Web View, a slide onto a Window goes back to the Terminal
#      Screen on that Window
#   7  the drawer marks the row on screen: the Tab on the Web View, the
#      active Pane on the Terminal Screen, and the Tab again after the round
#      trip (ADR 0038)
#
# A slide is a slow drag from the Grip to the row, at the place the drawer
# writes to the app's log: see slide_to. The Lift Lane,
# the Cancel Zone and the automatic scroll are tried on a device. The drawer
# closes at each lift, so its mark is read from the app's log, where it
# writes the row it marks each time that changes while it is open.
#
# Requires a configured .env.local and a booted simulator.
# Usage:  bash e2e/edge-drawer.sh

[ -n "${MUXIFY_E2E_ROOT:-}" ] || exec bash "$(dirname "$0")/sandbox.sh" bash "$0" "$@"

set -uo pipefail

APP=dev.muxify.app
SESSION=0
DEVICE_ARGS=()
[ -z "${MUXIFY_E2E_DEVICE:-}" ] || DEVICE_ARGS=(--udid "$MUXIFY_E2E_DEVICE")
TAB_URL=https://example.com/

on_host() { sh -c "$*" 2>/dev/null; }

fail() { echo "FAIL: $1"; exit 1; }

attach() {
  agent-device close >/dev/null 2>&1
  agent-device open "$APP" --platform ios "${DEVICE_ARGS[@]}" --relaunch >/dev/null 2>&1
  agent-device wait 'label="Host Dev Host"' 25000 >/dev/null 2>&1
  agent-device press 'label="Host Dev Host"' >/dev/null 2>&1
  agent-device wait 'label="Host Options"' 15000 >/dev/null 2>&1
  agent-device wait 1500 >/dev/null 2>&1  # Home is under the Host Screen until the push settles
  agent-device wait "label=\"Session $SESSION\"" 15000 >/dev/null 2>&1
  agent-device press "label=\"Session $SESSION\"" >/dev/null 2>&1
  agent-device wait 'label="Open Terminal chooser" enabled=true' 20000 >/dev/null 2>&1 \
    || fail "never reached Connected"
  agent-device wait 'role="text-view" editable=true' 20000 >/dev/null 2>&1 \
    || fail "the Surface never became ready for input"
  sleep 2
}

# The active Window's index and its active Pane's, as `window.pane`.
# `$SESSION:` and not `$SESSION`: tmux reads a bare `0` as Pane 0 of the current Window.
now() { on_host "tmux display-message -p -t '$SESSION:' '#{window_index}.#{pane_index}'"; }
expect_now() { [ "$(now)" = "$1" ] || fail "$2: tmux is at '$(now)', not '$1'"; }

# The Grip's centre on screen, as `x y`, from the accessibility tree.
grip_centre() {
  agent-device snapshot --json 2>/dev/null | python3 -c "
import json, sys
for n in json.load(sys.stdin)['data']['nodes']:
    # The label alone: the JSON gives the native view's class as its role, not button.
    if n.get('label') == 'Destinations':
        r = n.get('rect') or n.get('frame') or {}
        print(int(r['x'] + r['width'] / 2), int(r['y'] + r['height'] / 2)); break
"
}

# How many times the app's log says the drawer marked a row whose key starts with $1.
marks() { grep -rhF "the Edge Drawer marks $1" "$DATA/muxify-logs" 2>/dev/null | wc -l | tr -d ' '; }
# Holds the Grip and lifts there, and waits for the log to say the drawer marked $1 once more, and no row with $2.
expect_mark() {
  local before wrong i
  before=$(marks "$1"); wrong=$(marks "$2")
  agent-device longpress 'role=button label="Destinations"' 1500 >/dev/null 2>&1
  for i in $(seq 1 20); do
    [ "$(marks "$1")" -gt "$before" ] && break
    sleep 0.5
  done
  [ "$(marks "$1")" -gt "$before" ] || fail "$3: the drawer did not mark $1"
  [ "$(marks "$2")" = "$wrong" ] || fail "$3: the drawer marked $2"
}

# How many times the app's log says the Topology has no Windows. After a Pane
# switch that is the black screen: a reply paired with the wrong command.
no_windows() { grep -rhF '"text":"no Windows"' "$DATA/muxify-logs" 2>/dev/null | wc -l | tr -d ' '; }

# On a phone the open drawer lies on a scrim, which closes it on a tap. A
# `text=` selector would not do: it ignores case, so SESSION matches the
# Session title of the navigation bar.
drawer_open() { agent-device is exists 'label="Close Destinations"' >/dev/null 2>&1; }
# How many times the app's log says where the drawer's rows are.
picks() { grep -rhF ' in the Edge Drawer"' "$DATA/muxify-logs" 2>/dev/null | grep -cF '"text":"picked ' | tr -d ' '; }
rows_said() { grep -rhF 'the Edge Drawer shows ' "$DATA/muxify-logs" 2>/dev/null | wc -l | tr -d ' '; }
# Where the finger last opened the drawer, as `x y`.
opened_at() {
  grep -rhF '"the Edge Drawer opened at ' "$DATA/muxify-logs" 2>/dev/null | tail -1 \
    | sed -E 's/.* at ([0-9]+),([0-9]+)".*/\1 \2/'
}
# Where the drawer last said it put the row with the label $1, as `x y`.
row_at() {
  grep -rhF "\"the Edge Drawer shows $1 at " "$DATA/muxify-logs" 2>/dev/null | tail -1 \
    | sed -E 's/.* at ([0-9]+),([0-9]+)".*/\1 \2/'
}
# Holds the Grip past its 400 ms, slides onto the row with the label, and lifts there.
#
# The row shows only once the drawer opens, and agent-device finds a drag's
# end before its hold, so the slide is in two parts. A hold and a lift on the
# Grip, which picks nothing, makes the drawer write where it opened and where
# its rows are. Then one slow drag from that place to the row: 30 points a
# second keeps the finger inside the Grip's 20 points for its 400 ms, so it
# is a hold, and the drawer opens where it did before.
slide_to() {
  local gx gy x y before i ms
  before=$(rows_said)
  agent-device longpress 'role=button label="Destinations"' 1200 >/dev/null 2>&1
  for i in $(seq 1 10); do
    [ "$(rows_said)" -gt "$before" ] && break
    sleep 0.5
  done
  read -r gx gy <<<"$(opened_at)"
  read -r x y <<<"$(row_at "$1")"
  [ -n "${x:-}" ] || fail "$2: the drawer has no row '$1'"
  # The drawer of that hold slides out after the lift. Over its scrim the
  # finger would close it, not hold the Grip.
  agent-device wait absent 'label="Close Destinations"' 3000 >/dev/null 2>&1
  sleep 0.5
  before=$(picks)
  ms=$(python3 -c "import math; print(max(1500, int(math.hypot($x - $gx, $y - $gy) / 30 * 1000)))")
  agent-device gesture pan "$gx" "$gy" "$((x - gx))" "$((y - gy))" "$ms" >/dev/null 2>&1 \
    || fail "$2: no slide from the Grip onto '$1'"
  # agent-device can answer before a long drag ends: the pick says it did.
  for i in $(seq 1 30); do
    [ "$(picks)" -gt "$before" ] && break
    sleep 0.5
  done
  [ "$(picks)" -gt "$before" ] || fail "$2: the slide onto '$1' picked nothing"
  sleep 1.5
}

SHELL_COMMAND="env PS1='\$ ' BASH_SILENCE_DEPRECATION_WARNING=1 bash --noprofile --norc"
on_host "tmux split-window -h -t '$SESSION:0.0' \"$SHELL_COMMAND\"; \
    tmux select-pane -t '$SESSION:0.0'; \
    tmux new-window -d -t '$SESSION:1' -n logs \"$SHELL_COMMAND\""
[ "$(on_host "tmux display-message -p -t '$SESSION:0' '#{window_panes}'")" = 2 ] || fail "Window 0 did not get its two Panes"
stored-tabs "$SESSION:1" 0 "$TAB_URL" || fail "could not store the Tab of Window 1"
LOGS_WINDOW=$(on_host "tmux display-message -p -t '$SESSION:1' '#{window_id}'")
DATA=$(xcrun simctl get_app_container "${MUXIFY_E2E_DEVICE:-booted}" "$APP" data)/Documents

echo "1/7  a hold on the Grip and a lift there closes the drawer and picks nothing"
attach
expect_now "0.0" "after the Attach"
agent-device longpress 'role=button label="Destinations"' 900 >/dev/null 2>&1
sleep 1
drawer_open && fail "the lift on the Grip left the drawer open"
expect_now "0.0" "a lift on the Grip"
echo "     closed, and still on Pane 0"

echo "2/7  a slide onto a Pane row goes to that Pane"
BLANK=$(no_windows)
slide_to "Pane 1 bash" "a Pane"
expect_now "0.1" "a slide onto Pane 1"
drawer_open && fail "the drawer stayed open after the pick"
[ "$(no_windows)" = "$BLANK" ] || fail "after the pick, the app's log says the Topology has no Windows"
echo "     on Pane 1, the drawer closed, and the Topology kept its Windows"

echo "3/7  a quick drag that starts on the Grip is still a Pane Swipe"
read -r GX GY <<<"$(grip_centre)"
[ -n "${GX:-}" ] || fail "the Grip is not in the accessibility tree"
agent-device gesture pan "$GX" "$GY" -220 0 300 >/dev/null 2>&1
sleep 2
expect_now "0.0" "a drag left from the Grip"
drawer_open && fail "a drag from the Grip opened the drawer"
echo "     the drag went to the next Pane, and no drawer opened"

echo "4/7  a slide onto a Window row goes to that Window"
slide_to "Window 1 logs" "a Window"
expect_now "1.0" "a slide onto Window 1"
echo "     on Window 1"

echo "5/7  a Tab of another Window: its Window first, then the Web View"
slide_to "Window 0 bash" "back to Window 0"
expect_now "0.0" "back to Window 0"
slide_to "Tab $TAB_URL" "a Tab"
agent-device wait 'id="web-view-title"' 10000 >/dev/null 2>&1 || fail "the Tab did not open the Web View"
expect_now "1.0" "a Tab of Window 1"
echo "     Window 1, then the Tab in the Web View"

echo "6/7  on the Web View, a slide onto a Window goes back to the Terminal Screen"
slide_to "Window 0 bash" "on the Web View"
agent-device wait 'label="Open Terminal chooser" enabled=true' 10000 >/dev/null 2>&1 \
  || fail "a Window pick on the Web View did not go back to the Terminal Screen"
expect_now "0.0" "a Window pick on the Web View"
echo "     the Terminal Screen, on Window 0"

echo "7/7  the drawer marks the row on screen, after each switch"
PANE_0=$(on_host "tmux display-message -p -t '$SESSION:0.0' '#{pane_id}'")
expect_mark "pane:$PANE_0 " "tab:" "on the Terminal Screen"
echo "     the Terminal Screen: Pane 0 is marked, and no Tab"
slide_to "Tab $TAB_URL" "the Tab again"
agent-device wait 'id="web-view-title"' 10000 >/dev/null 2>&1 || fail "the Tab did not open the Web View again"
expect_mark "tab:$LOGS_WINDOW:" "pane:" "on the Web View"
echo "     the Web View: the Tab is marked, and no Pane"
slide_to "Window 0 bash" "back to the terminal"
agent-device wait 'label="Open Terminal chooser" enabled=true' 10000 >/dev/null 2>&1 \
  || fail "a Window pick on the Web View did not go back to the Terminal Screen"
expect_mark "pane:$PANE_0 " "tab:" "back on the Terminal Screen"
echo "     back on the Terminal Screen: Pane 0 is marked again"

agent-device close >/dev/null 2>&1
echo "PASS"
