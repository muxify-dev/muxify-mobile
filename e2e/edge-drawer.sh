#!/bin/bash
#
# The Grip, its Fan and the Edge Drawer, on the Terminal Screen and the Web View.
#
# What this proves, against the sandbox's Session 0, with Window 0 split in
# two Panes and a Window 1 `logs` whose Browser has one Tab, and some more
# Windows after it (see extra_windows). Window 0 keeps one Pane after the
# Pane Swipe:
#
#   1  a hold on the Grip opens the Fan, and a lift there runs nothing
#   2  a hold and a slide straight up past 44 points open the Edge Drawer at
#      the point where the finger lit Destinations, and a lift in the Lift
#      Lane closes it and picks nothing: the drawer is drag-only
#   3  a hold and a slide up and to the left run the Go to action, which goes
#      to the Host Screen, and its Cancel goes back to the Terminal Screen
#   4  a hold and a slide to the left run the Options action, which opens the
#      Options sheet
#   5  a hold, a slide up to Destinations and on to a Pane row goes to that Pane
#   6  a quick drag that starts on the Grip is still a Pane Swipe
#   7  a slide onto a Window row goes to that Window
#   8  a slide onto a Tab of another Window goes to that Window first, then
#      opens the Tab in the Web View
#   9  on the Web View, a slide onto a Window goes back to the Terminal
#      Screen on that Window
#  10  the drawer marks the row on screen: the Tab on the Web View, the
#      active Pane on the Terminal Screen, and the Tab again after the round
#      trip (ADR 0038)
#  11  the Web View has the Grip too: Go to runs there, and its Cancel goes
#      back to the Web View
#
# agent-device draws straight lines only, and the Fan wants a bend: up to
# light Destinations, then left to a row. So a slide to a row is one straight
# line from the button's lower right corner that crosses the 44 points round
# the button's centre just left of straight up, where Destinations lights, and
# goes on to the row. Such a line reaches a row only if it is the third row or
# higher from the bottom: nearer the finger it ends in the Lift Lane. And the
# list must have no more than the five rows that the panel shows. A list that
# scrolls moves under the held finger, and the second drawer of a run, the one
# that picks, then took the row below the one it was aimed at. So extra_windows
# and the one Pane of Window 0 put the row we slide to there. See slide_to.
#
# A slide is slow, 50 points a second, so the finger stays within the Grip's
# 20 points for its 250 ms hold. It is no longer than 6 seconds, as a longer
# slide lifts early in agent-device's runner. The place of each row is what
# the drawer writes to the app's log: see slide_to. The Lift Lane, the Cancel
# Zone and the automatic scroll are tried on a device. The drawer closes at
# each lift, so its mark is read from the app's log, where it writes the row
# it marks each time that changes while it is open.
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
# How far the finger moves each second, in points. At 50 a 280 point slide ends within the runner's 6 seconds.
SPEED=50
# The rows of the drawer that a straight slide reaches, as the y of their centres on an iPhone 17 whose
# last row is level with the finger at 393: from the third from the bottom up.
ROW_HIGHEST=201
ROW_LOWEST=297

on_host() { sh -c "$*" 2>/dev/null; }

fail() { echo "FAIL: $1"; exit 1; }

# Makes $1 Windows come after Window 1: more1, more2 and so on.
extra_windows() {
  local want=$1 have i
  have=$(on_host "tmux list-windows -t '$SESSION:' -F '#{window_name}'" | grep -c '^more')
  for ((i = have + 1; i <= want; i++)); do
    on_host "tmux new-window -d -t '$SESSION:$((i + 1))' -n more$i \"$SHELL_COMMAND\""
  done
  for ((i = have; i > want; i--)); do
    on_host "tmux kill-window -t '$SESSION:$((i + 1))'"
  done
  sleep 1
}

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
    # The label alone: the JSON gives the native view's class as its role, not button. The
    # screen and the area round the Grip carry its label too, so take the one that is small.
    r = n.get('rect') or n.get('frame') or {}
    if n.get('label') == 'Grip actions' and r.get('width', 0) < 100:
        print(int(r['x'] + r['width'] / 2), int(r['y'] + r['height'] / 2)); break
"
}

# Reads the Grip's centre again. A screen whose tree does not show it, such as the page of
# the Web View, keeps the centre of the last screen that did: it is in the same place.
refresh_grip() {
  local x y
  read -r x y <<<"$(grip_centre)"
  [ -z "${x:-}" ] || { GX=$x; GY=$y; }
}

# How many times the app's log has a line whose text is exactly $1.
said() { grep -rhF "\"text\":\"$1\"" "$DATA/muxify-logs" 2>/dev/null | wc -l | tr -d ' '; }
# How many times the app's log says the drawer marked a row whose key starts with $1.
marks() { grep -rhF "the Edge Drawer marks $1" "$DATA/muxify-logs" 2>/dev/null | wc -l | tr -d ' '; }
# Waits for `said "$1"` to pass $2, and says whether it did.
said_more() {
  local i
  for i in $(seq 1 20); do
    [ "$(said "$1")" -gt "$2" ] && return 0
    sleep 0.5
  done
  return 1
}
# Holds the Grip and lifts there, and waits for the log to say the drawer marked $1 once more, and no row with $2.
# The drawer opens only from the Fan, so this slides straight up to Destinations and lifts in the Lift Lane.
expect_mark() {
  local before wrong i
  before=$(marks "$1"); wrong=$(marks "$2")
  slide_up
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
# Where the finger last lit Destinations, as `x y`.
opened_at() {
  grep -rhF '"the Edge Drawer opened at ' "$DATA/muxify-logs" 2>/dev/null | tail -1 \
    | sed -E 's/.* at ([0-9]+),([0-9]+)".*/\1 \2/'
}
# What the drawer wrote when it last opened: where the finger lit Destinations, then its rows.
last_batch() {
  local newest
  newest=$(ls -t "$DATA"/muxify-logs/* 2>/dev/null | head -1)
  grep -hF -e '"the Edge Drawer opened at ' -e '"the Edge Drawer shows ' "$newest" 2>/dev/null \
    | awk '/opened at/ { batch = "" } { batch = batch $0 "\n" } END { printf "%s", batch }'
}
# Where the drawer put the row with the label $1 when it last opened, as `x y`.
row_at() {
  last_batch | grep -F "\"the Edge Drawer shows $1 at " | tail -1 | sed -E 's/.* at ([0-9]+),([0-9]+)".*/\1 \2/'
}

# The Go to field's own Cancel, once the field has the keys. iOS draws it as an ✕ named "close".
cancel_go_to() {
  agent-device wait 'role=button label="close"' 10000 >/dev/null 2>&1 || fail "Go to has no Cancel: the field did not take the keys"
  agent-device press 'role=button label="close"' >/dev/null 2>&1 || fail "no press on the Cancel of Go to"
}

# One slow straight slide of the finger, from $1,$2 to $3,$4, at SPEED points a second.
# At least 1.5 seconds: a shorter one is not slow enough for the Fan to open in it.
slide() {
  local ms
  ms=$(python3 -c "import math; print(max(1500, int(math.hypot($3 - $1, $4 - $2) / $SPEED * 1000)))")
  agent-device gesture pan "$1" "$2" "$((${3%.*} - ${1%.*}))" "$((${4%.*} - ${2%.*}))" "$ms" >/dev/null 2>&1
}

# The finger starts at the button's lower right corner and crosses the 44 points round its
# centre at 7 points left of straight up, 3 points inside the edge of where Destinations lights.
# `bend $k` is the line's point $k times as far along: 1 is the crossing.
bend() {
  python3 -c "
gx, gy, k = $GX, $GY, $1
sx, sy, lx, ly = gx + 20, gy + 20, gx - 7, gy - 43.5
print(int(sx + k * (lx - sx)), int(sy + k * (ly - sy)))
"
}

# Holds the Grip, slides on past Destinations, and lifts in the Lift Lane: the drawer opens and closes.
slide_up() {
  local x y
  refresh_grip
  read -r x y <<<"$(bend 1.35)"
  slide "$((GX + 20))" "$((GY + 20))" "$x" "$y"
}

# A hold, a slide to Destinations and a lift there, which picks nothing, make the drawer
# write where it opened and where its rows are. It goes again while the Tab of Window 1 is
# not among them: a Tab that arrives later moves the rows above it up by one.
probe() {
  local before i try
  for try in 1 2 3; do
    before=$(rows_said)
    slide_up
    for i in $(seq 1 10); do
      [ "$(rows_said)" -gt "$before" ] && break
      sleep 0.5
    done
    sleep 0.5  # the drawer writes its rows one after the other
    [ "$(rows_said)" -gt "$before" ] && last_batch | grep -qF "shows Tab $TAB_URL at " && return 0
    # The drawer of that hold slides out after the lift.
    agent-device wait absent 'label="Close Destinations"' 3000 >/dev/null 2>&1
    sleep 0.5
  done
  return 1
}

# Holds the Grip, slides on up to Destinations and on to the row with the label $1, and lifts there.
#
# The row shows only once the drawer opens, so the slide is in two parts: the probe, and
# then one slide along the same line, on to the row.
slide_to() {
  local x y ex ey before i
  refresh_grip
  probe || fail "$2: the Tab of Window 1 did not come into the drawer"
  read -r x y <<<"$(row_at "$1")"
  [ -n "${x:-}" ] || fail "$2: the drawer has no row '$1'"
  # The drawer of that hold slides out after the lift. Over its scrim the
  # finger would close it, not hold the Grip.
  agent-device wait absent 'label="Close Destinations"' 3000 >/dev/null 2>&1
  sleep 0.5
  # The line goes on to the row's height. Past the Lift Lane's edge at 358 it
  # lifts in the Lane, which picks nothing.
  read -r ex ey <<<"$(python3 -c "
gx, gy, ry = $GX, $GY, $y
sx, sy, lx, ly = gx + 20, gy + 20, gx - 7, gy - 43.5
k = (ry - sy) / (ly - sy)
print(int(sx + k * (lx - sx)), ry)
")"
  { [ "$y" -ge "$ROW_HIGHEST" ] && [ "$y" -le "$ROW_LOWEST" ]; } \
    || fail "$2: the row '$1' is at $y, not at $ROW_HIGHEST to $ROW_LOWEST, where a straight slide reaches it (see extra_windows)"
  before=$(picks)
  slide "$((GX + 20))" "$((GY + 20))" "$ex" "$ey" \
    || fail "$2: no slide from the Grip onto '$1'"
  # agent-device can answer before a long drag ends: the pick says it did.
  for i in $(seq 1 30); do
    [ "$(picks)" -gt "$before" ] && break
    sleep 0.5
  done
  [ "$(picks)" -gt "$before" ] || fail "$2: the slide onto '$1' picked nothing"
  sleep 1.5
}

# Holds the Grip and slides from its centre to the slot at $1 degrees (90 is straight up, 180 is
# straight left), 120 points out, and lifts there.
slide_to_slot() {
  local x y
  refresh_grip
  read -r x y <<<"$(python3 -c "
import math
a = math.radians($1)
print(int($GX + 120 * math.cos(a)), int($GY - 120 * math.sin(a)))
")"
  slide "$GX" "$GY" "$x" "$y"
}

SHELL_COMMAND="env PS1='\$ ' BASH_SILENCE_DEPRECATION_WARNING=1 bash --noprofile --norc"
on_host "tmux split-window -h -t '$SESSION:0.0' \"$SHELL_COMMAND\"; \
    tmux select-pane -t '$SESSION:0.0'; \
    tmux new-window -d -t '$SESSION:1' -n logs \"$SHELL_COMMAND\""
[ "$(on_host "tmux display-message -p -t '$SESSION:0' '#{window_panes}'")" = 2 ] || fail "Window 0 did not get its two Panes"
stored-tabs "$SESSION:1" 0 "$TAB_URL" || fail "could not store the Tab of Window 1"
LOGS_WINDOW=$(on_host "tmux display-message -p -t '$SESSION:1' '#{window_id}'")
DATA=$(xcrun simctl get_app_container "${MUXIFY_E2E_DEVICE:-booted}" "$APP" data)/Documents

echo "1/11  a hold on the Grip opens the Fan, and a lift there runs nothing"
attach
read -r GX GY <<<"$(grip_centre)"
[ -n "${GX:-}" ] || fail "the Grip is not in the accessibility tree"
OPENED=$(said "the Fan opened")
agent-device longpress 'role=button label="Grip actions"' 900 >/dev/null 2>&1
said_more "the Fan opened" "$OPENED" || fail "the hold did not open the Fan"
sleep 1
drawer_open && fail "the lift on the Grip left the drawer open"
expect_now "0.0" "a lift on the Grip"
echo "      the Fan opened, nothing ran, and still on Pane 0"

echo "2/11  a slide up to Destinations opens the drawer where it lit, and a lift in the Lift Lane picks nothing"
ROWS=$(rows_said)
slide_up
for i in $(seq 1 10); do
  [ "$(rows_said)" -gt "$ROWS" ] && break
  sleep 0.5
done
read -r AX AY <<<"$(opened_at)"
[ -n "${AX:-}" ] || fail "the slide did not open the drawer"
# The finger lit Destinations between 44 and 62 points above the centre, in the Lift Lane.
[ "$AY" -le "$((GY - 44))" ] && [ "$AY" -ge "$((GY - 62))" ] \
  || fail "the drawer opened at $AX,$AY, not 44 to 62 points above the Grip at $GX,$GY"
[ "$AX" -ge "$((GX + 22 - 44))" ] || fail "the drawer opened at $AX,$AY, outside the Lift Lane"
agent-device wait absent 'label="Close Destinations"' 3000 >/dev/null 2>&1 || fail "the lift in the Lift Lane left the drawer open"
expect_now "0.0" "a lift in the Lift Lane"
echo "      the drawer opened at $AX,$AY, closed at the lift, and picked nothing"

echo "3/11  a slide to Go to runs it, goes to the Host Screen, and Cancel goes back"
RAN=$(said "the Fan ran go-to")
slide_to_slot 120
said_more "the Fan ran go-to" "$RAN" || fail "the lift on the Go to slot ran no Go to"
agent-device wait 'label="Host Options"' 10000 >/dev/null 2>&1 || fail "Go to did not reach the Host Screen"
cancel_go_to
agent-device wait 'label="Open Terminal chooser" enabled=true' 10000 >/dev/null 2>&1 \
  || fail "Cancel of Go to did not go back to the Terminal Screen"
echo "      the Host Screen, and Cancel went back to the Terminal Screen"
attach
read -r GX GY <<<"$(grip_centre)"

echo "4/11  a slide to Options runs it, and opens the Options sheet"
RAN=$(said "the Fan ran options")
slide_to_slot 180
said_more "the Fan ran options" "$RAN" || fail "the lift on the Options slot ran no Options"
agent-device wait 'label="Close Options"' 10000 >/dev/null 2>&1 || fail "Options did not open its sheet"
# The button, not the first node with that label: that one is the dimmed area behind the sheet.
agent-device press 'role=button label="Close Options"' >/dev/null 2>&1
for i in $(seq 1 10); do
  agent-device is exists 'label="Close Options"' >/dev/null 2>&1 || break
  sleep 1
done
agent-device is exists 'label="Close Options"' >/dev/null 2>&1 && fail "the Options sheet did not close"
echo "      the Options sheet opened and closed"

echo "5/11  a slide up to Destinations and on to a Pane row goes to that Pane"
BLANK=$(no_windows)
slide_to "Pane 1 bash" "a Pane"
expect_now "0.1" "a slide onto Pane 1"
drawer_open && fail "the drawer stayed open after the pick"
[ "$(no_windows)" = "$BLANK" ] || fail "after the pick, the app's log says the Topology has no Windows"
echo "      on Pane 1, the drawer closed, and the Topology kept its Windows"

echo "6/11  a quick drag that starts on the Grip is still a Pane Swipe"
FANS=$(said "the Fan opened")
agent-device gesture pan "$GX" "$GY" -220 0 300 >/dev/null 2>&1
sleep 2
expect_now "0.0" "a drag left from the Grip"
drawer_open && fail "a drag from the Grip opened the drawer"
[ "$(said "the Fan opened")" = "$FANS" ] || fail "a drag from the Grip opened the Fan"
echo "      the drag went to the next Pane, and no Fan or drawer opened"
# One Pane in Window 0 from here on, so the list has no Pane rows and stays short.
on_host "tmux kill-pane -t '$SESSION:0.1'"
[ "$(on_host "tmux display-message -p -t '$SESSION:0' '#{window_panes}'")" = 1 ] || fail "Window 0 kept its two Panes"
sleep 2  # the app reads the Topology again

echo "7/11  a slide onto a Window row goes to that Window"
extra_windows 1
slide_to "Window 1 logs" "a Window"
expect_now "1.0" "a slide onto Window 1"
echo "      on Window 1"

echo "8/11  a Tab of another Window: its Window first, then the Web View"
slide_to "Window 0 bash" "back to Window 0"
expect_now "0.0" "back to Window 0"
extra_windows 2
slide_to "Tab $TAB_URL" "a Tab"
agent-device wait 'id="web-view-title"' 10000 >/dev/null 2>&1 || fail "the Tab did not open the Web View"
expect_now "1.0" "a Tab of Window 1"
echo "      Window 1, then the Tab in the Web View"

echo "9/11  on the Web View, a slide onto a Window goes back to the Terminal Screen"
extra_windows 1
slide_to "Window 0 bash" "on the Web View"
agent-device wait 'label="Open Terminal chooser" enabled=true' 10000 >/dev/null 2>&1 \
  || fail "a Window pick on the Web View did not go back to the Terminal Screen"
expect_now "0.0" "a Window pick on the Web View"
echo "      the Terminal Screen, on Window 0"

echo "10/11  the drawer marks the row on screen, after each switch"
# The Window has one Pane, so the drawer lists no Panes and marks the Window.
WINDOW_0=$(on_host "tmux display-message -p -t '$SESSION:0' '#{window_id}'")
expect_mark "window:$SESSION:$WINDOW_0 " "tab:" "on the Terminal Screen"
echo "      the Terminal Screen: Window 0 is marked, and no Tab"
extra_windows 2
slide_to "Tab $TAB_URL" "the Tab again"
agent-device wait 'id="web-view-title"' 10000 >/dev/null 2>&1 || fail "the Tab did not open the Web View again"
expect_mark "tab:$LOGS_WINDOW:" "window:" "on the Web View"
echo "      the Web View: the Tab is marked, and no Window"
extra_windows 1
slide_to "Window 0 bash" "back to the terminal"
agent-device wait 'label="Open Terminal chooser" enabled=true' 10000 >/dev/null 2>&1 \
  || fail "a Window pick on the Web View did not go back to the Terminal Screen"
expect_mark "window:$SESSION:$WINDOW_0 " "tab:" "back on the Terminal Screen"
echo "      back on the Terminal Screen: Window 0 is marked again"

echo "11/11  the Web View has the Grip too: Go to runs there"
extra_windows 2
slide_to "Tab $TAB_URL" "the Tab for the last check"
agent-device wait 'id="web-view-title"' 10000 >/dev/null 2>&1 || fail "the Tab did not open the Web View for the last check"
RAN=$(said "the Fan ran go-to")
slide_to_slot 120
said_more "the Fan ran go-to" "$RAN" || fail "the lift on the Go to slot ran no Go to on the Web View"
agent-device wait 'label="Host Options"' 10000 >/dev/null 2>&1 || fail "Go to on the Web View did not reach the Host Screen"
cancel_go_to
agent-device wait 'id="web-view-title"' 10000 >/dev/null 2>&1 || fail "Cancel of Go to did not go back to the Web View"
echo "      Go to from the Web View reached the Host Screen, and Cancel went back to the page"

agent-device close >/dev/null 2>&1
echo "PASS"
