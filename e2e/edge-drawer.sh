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
#
# A slide is `agent-device gesture drag` from the Grip, held past its
# 400 ms, to the row. The row shows only once the drawer opens, so this
# needs agent-device to find the destination after the hold. The Lift Lane,
# the Cancel Zone and the automatic scroll are tried on a device.
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
now() { on_host "tmux display-message -p -t '$SESSION' '#{window_index}.#{pane_index}'"; }
expect_now() { [ "$(now)" = "$1" ] || fail "$2: tmux is at '$(now)', not '$1'"; }

# The Grip's centre on screen, as `x y`, from the accessibility tree.
grip_centre() {
  agent-device snapshot --json 2>/dev/null | python3 -c "
import json, sys
for n in json.load(sys.stdin)['data']['nodes']:
    if n.get('label') == 'Destinations' and n.get('role', '').lower().find('button') >= 0:
        r = n.get('rect') or n.get('frame') or {}
        print(int(r['x'] + r['width'] / 2), int(r['y'] + r['height'] / 2)); break
"
}

# The drawer's header says SESSION only while it is open: the sandbox's Session is in no Topic.
drawer_open() { agent-device is exists 'text="SESSION"' >/dev/null 2>&1; }
# Holds the Grip past its 400 ms, slides onto the row with the label, and lifts there.
slide_to() {
  agent-device gesture drag 'role=button label="Destinations"' "label=\"$1\"" 700 400 150 >/dev/null 2>&1 \
    || fail "$2: no slide from the Grip onto '$1'"
  sleep 2
}

SHELL_COMMAND="env PS1='\$ ' BASH_SILENCE_DEPRECATION_WARNING=1 bash --noprofile --norc"
on_host "tmux split-window -h -t '$SESSION:0.0' \"$SHELL_COMMAND\"; \
    tmux select-pane -t '$SESSION:0.0'; \
    tmux new-window -d -t '$SESSION:1' -n logs \"$SHELL_COMMAND\""
[ "$(on_host "tmux display-message -p -t '$SESSION:0' '#{window_panes}'")" = 2 ] || fail "Window 0 did not get its two Panes"
stored-tabs "$SESSION:1" 0 "$TAB_URL" || fail "could not store the Tab of Window 1"

echo "1/6  a hold on the Grip and a lift there closes the drawer and picks nothing"
attach
expect_now "0.0" "after the Attach"
agent-device longpress 'role=button label="Destinations"' 900 >/dev/null 2>&1
sleep 1
drawer_open && fail "the lift on the Grip left the drawer open"
expect_now "0.0" "a lift on the Grip"
echo "     closed, and still on Pane 0"

echo "2/6  a slide onto a Pane row goes to that Pane"
slide_to "Pane 1 bash" "a Pane"
expect_now "0.1" "a slide onto Pane 1"
drawer_open && fail "the drawer stayed open after the pick"
echo "     on Pane 1, and the drawer closed"

echo "3/6  a quick drag that starts on the Grip is still a Pane Swipe"
read -r GX GY <<<"$(grip_centre)"
[ -n "${GX:-}" ] || fail "the Grip is not in the accessibility tree"
agent-device gesture pan "$GX" "$GY" -220 0 300 >/dev/null 2>&1
sleep 2
expect_now "0.0" "a drag left from the Grip"
drawer_open && fail "a drag from the Grip opened the drawer"
echo "     the drag went to the next Pane, and no drawer opened"

echo "4/6  a slide onto a Window row goes to that Window"
slide_to "Window 1 logs" "a Window"
expect_now "1.0" "a slide onto Window 1"
echo "     on Window 1"

echo "5/6  a Tab of another Window: its Window first, then the Web View"
slide_to "Window 0 bash" "back to Window 0"
expect_now "0.0" "back to Window 0"
slide_to "Tab $TAB_URL" "a Tab"
agent-device wait 'id="web-view-title"' 10000 >/dev/null 2>&1 || fail "the Tab did not open the Web View"
expect_now "1.0" "a Tab of Window 1"
echo "     Window 1, then the Tab in the Web View"

echo "6/6  on the Web View, a slide onto a Window goes back to the Terminal Screen"
slide_to "Window 0 bash" "on the Web View"
agent-device wait 'label="Open Terminal chooser" enabled=true' 10000 >/dev/null 2>&1 \
  || fail "a Window pick on the Web View did not go back to the Terminal Screen"
expect_now "0.0" "a Window pick on the Web View"
echo "     the Terminal Screen, on Window 0"

agent-device close >/dev/null 2>&1
echo "PASS"
