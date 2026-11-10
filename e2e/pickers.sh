#!/bin/bash
#
# The Title Sheet's Windows and the Panes picker (ticket 09, redrawn for the
# Header).
#
# Covers the two things the .ad suites cannot: whether a Key Row button is
# genuinely disabled — `agent-device is` has no `enabled` predicate, so this
# reads the flag out of the snapshot JSON — and the Title Sheet and the Panes
# sheet, which cannot both be exercised in one .ad run because a presented
# sheet cannot be dismissed from automation (see e2e/session-picker.ad).
#
# What this proves is that the Host's real Topology reaches both sheets, that
# the Panes sheet carries its own actions and ⋯ carries New Window, and that
# the Key Row reads its three groups from left to right.
#
# A Pane card carries its directory rather than a name of its own, so two Panes
# in one directory are two buttons with the same label and cannot be told apart
# by one. They are pressed by ref instead, in the order the sheet lists them,
# which is tmux's Pane order — see `pane_card`.
#
# Drives the Host's Topology itself, so it does not depend on how the dev Host was
# left. Requires a configured .env.local and a booted simulator.
# Usage:  bash e2e/pickers.sh

[ -n "${MUXIFY_E2E_ROOT:-}" ] || exec bash "$(dirname "$0")/sandbox.sh" bash "$0" "$@"

set -uo pipefail

APP=dev.muxify.app
device=()
[ -z "${MUXIFY_E2E_DEVICE:-}" ] || device=(--udid "$MUXIFY_E2E_DEVICE")
SESSION=0

# Runs a command on the dev Host, which is this Mac, in the sandbox.
on_host() { sh -c "$*" 2>/dev/null; }

fail() { echo "FAIL: $1"; exit 1; }

attach() {
  agent-device close >/dev/null 2>&1
  agent-device open "$APP" --platform ios --relaunch "${device[@]}" >/dev/null 2>&1
  agent-device wait text "Dev Host" 25000 >/dev/null 2>&1
  # The real flow: a saved Host, its Sessions, then one of them.
  agent-device press 'label="Host Dev Host"' >/dev/null 2>&1
  agent-device wait 'label="Edit Host"' 15000 >/dev/null 2>&1
  agent-device wait 1500 >/dev/null 2>&1  # Home is under the Host Screen until the push settles
  agent-device wait "label=\"Session $SESSION\"" 15000 >/dev/null 2>&1
  agent-device press "label=\"Session $SESSION\"" >/dev/null 2>&1
  # The program line renders once the Topology is in, which is after Connected.
  agent-device wait 'id="pane-command"' 20000 >/dev/null 2>&1 \
    || fail "never reached Connected"
}

# The Key Row's Panes button is disabled until Connected, so this waits for
# the answer rather than guessing how long that takes on the day.
expect_enabled() {
  local label=$1 want=$2
  for _ in $(seq 1 15); do
    [ "$(enabled "$label")" = "$want" ] && return 0
    sleep 1
  done
  fail "$label button should be ${want/yes/enabled}${want/no/disabled}, it is $(enabled "$label")"
}

# Whether the button with this label is pressable.
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

# Each row or card is a Button carrying its Window name or its Pane's directory.
named() { agent-device snapshot -i 2>/dev/null | grep -cE "^@e[0-9]+ \[button\] \"$1\""; }

# The Key Row, left to right, as the accessibility tree orders it. The pairs
# are the scroll view; the fixed groups are buttons.
key_row_order() {
  agent-device snapshot --json 2>/dev/null | python3 -c "
import json, sys
FIXED = ('escape', 'control', 'option', 'tab', 'arrows', 'Panes', 'command', 'Keyboard')
across = []
for n in json.load(sys.stdin)['data']['nodes']:
    if n['type'] == 'Button' and n.get('label') in FIXED:
        across.append(n['label'])
    elif n['type'] == 'ScrollView':
        across.append('pairs')
print(' '.join(across))
"
}

# Opens ⋯ and checks that it offers New Window. The menu is left up: the
# next step relaunches the app, and nothing else is read before then.
offers_new_window() {
  for _ in 1 2 3; do
    agent-device press 'label="Options"' >/dev/null 2>&1
    agent-device wait 'label="New Window"' 3000 >/dev/null 2>&1 && return 0
  done
  fail "the Options menu does not offer New Window"
}

# The ref of the nth Pane card in an open Panes sheet, in tmux's Pane order.
# Everything else in the sheet is an action with a name of its own.
#
# Empty unless the sheet is actually up. Without that guard the buttons it
# finds are the Key Row's own, still there behind a sheet that never opened,
# and pressing one of those is a check that quietly tests nothing.
pane_card() {
  agent-device snapshot --json 2>/dev/null | python3 -c "
import json, sys
want = int(sys.argv[1])
buttons = [n for n in json.load(sys.stdin)['data']['nodes'] if n['type'] == 'Button']
if not any((n.get('label') or '') == 'Close Panes' for n in buttons):
    print('')
else:
    cards = [n for n in buttons
             if not (n.get('label') or '').startswith(('Close', 'Split', 'Zoom'))]
    print('@' + cards[want - 1]['ref'] if len(cards) >= want else '')
" "$1"
}

# Waits for a sheet to actually be up.
#
# Not `wait text "Panes"`: the Key Row has a button of that name too and it is
# on screen the whole time, so the wait returned at once and everything after
# it raced the sheet's first frame. The close button belongs to the sheet alone.
sheet() { agent-device wait "label=\"Close $1\"" 15000 >/dev/null 2>&1; }

# Presses the Key Row's Panes button until its sheet is actually up.
#
# One press is not enough: a press landing while the screen is still settling
# after an attach does nothing at all, measured, and what follows then reads
# the Key Row through where the sheet should have been — so the failure names
# whatever was asserted next rather than the sheet that never opened.
open_sheet() {
  for _ in 1 2 3; do
    agent-device press "label=\"$1\"" >/dev/null 2>&1
    sheet "$1" && return 0
  done
  fail "the $1 sheet never opened"
}

# Taps the header's title until the Title Sheet is up, for the same reason.
open_title_sheet() {
  for _ in 1 2 3; do
    agent-device press 'id="header-title"' >/dev/null 2>&1
    if sheet Choose; then
      agent-device press 'label="Windows"' >/dev/null 2>&1
      return 0
    fi
  done
  fail "the Title Sheet never opened"
}

echo "1/5  one Window, one Pane: the sheets still open, and ⋯ still offers New Window"
# Deliberately not disabled. The Panes sheet is the only way to a split, and
# one of something is exactly when that is wanted — an earlier version
# disabled the buttons here and locked the user out of the action.
on_host "tmux kill-window -a -t '$SESSION:0' 2>/dev/null; \
    tmux kill-pane -a -t '$SESSION:0.0' 2>/dev/null; true" || fail "could not reach the dev Host"
attach
expect_enabled Panes yes
open_title_sheet
[ "$(named 'bash')" -eq 1 ] || fail "the one Window is missing from the Title Sheet"
agent-device press 'label="Close Choose"' >/dev/null 2>&1
sleep 1
open_sheet Panes
[ "$(named 'Split →')" -eq 1 ] || fail "a Window with one Pane must still offer Split →"
# Offered with one Pane as well. There is nothing to zoom out of yet, but the
# switch is the setting rather than the act — it says what the next split
# should do, and one that appears only after you have split is one you have to
# find twice.
agent-device is exists 'label="Zoom"' >/dev/null 2>&1 \
  || fail "the Zoom switch should be offered whatever the Pane count"
agent-device press 'label="Close Panes"' >/dev/null 2>&1
sleep 1

# Left to right: the fixed modifiers, the pairs, then the arrow key, Panes, ⌘
# and the keyboard.
[ "$(key_row_order)" = "escape control option tab pairs arrows Panes command Keyboard" ] \
  || fail "the Key Row is out of order: $(key_row_order)"
echo "     and the Key Row reads modifiers, pairs, arrow key, Panes, ⌘, Keyboard"
offers_new_window
echo "     and ⋯ offers New Window with one Window"

echo "2/5  three Windows: the Title Sheet lists them"
on_host "tmux new-window -t '$SESSION:' -n logs 'exec bash'; \
    tmux new-window -t '$SESSION:' -n notes 'exec bash'; \
    tmux select-window -t '$SESSION:0'"
attach
open_title_sheet
[ "$(named 'logs')" -eq 1 ] || fail "the logs Window is missing from the Title Sheet"
[ "$(named 'notes')" -eq 1 ] || fail "the notes Window is missing from the Title Sheet"
agent-device press 'label="Close Choose"' >/dev/null 2>&1
sleep 1
offers_new_window
echo "     logs and notes listed, and ⋯ offers New Window"

echo "3/5  two Panes: the Session arrives zoomed, and unzooming shows the split"
on_host "tmux split-window -t '$SESSION:0' 'exec bash'; tmux select-pane -t '$SESSION:0.0'; \
    tmux resize-pane -t '$SESSION:0' 2>/dev/null; true"
attach
# A phone is too narrow for side-by-side Panes, so a split Session is zoomed on
# arrival and the Panes picker is where that is turned off.
[ "$(on_host "tmux display-message -p -t '$SESSION' '#{window_zoomed_flag}'")" = 1 ] \
  || fail "a split Session should arrive with its active Pane zoomed"
echo "     arrived zoomed"
# Waited for, not assumed. The Key Row's Panes button is disabled until
# Connected, and a press that arrives before that does nothing at all — which
# shows up here as a sheet that never opened and an action that is "missing"
# from it. Check 1 waits; this one did not, and failed exactly once that way.
expect_enabled Panes yes
open_sheet Panes
[ "$(named 'Split →')" -eq 1 ] || fail "the Panes sheet has no Split → action"
[ "$(named 'Split ↓')" -eq 1 ] || fail "the Panes sheet has no Split ↓ action"
agent-device snapshot -i 2>/dev/null | grep -q 'Zoom' \
  || fail "the Panes sheet has no Zoom toggle"

# Turning zoom off shows the real split: a Surface per Pane, laid out where
# tmux says they are. The inactive one is a tap target, which is what makes it
# assertable from here at all — the Surfaces themselves render with Metal and
# never reach the accessibility tree.
SWITCH=$(agent-device snapshot -i 2>/dev/null | grep -E '^@e[0-9]+ \[switch\] "[01]"' | head -1 | awk '{print $1}')
[ -n "$SWITCH" ] || fail "no Zoom switch to turn off"
agent-device press "$SWITCH" >/dev/null 2>&1
sleep 2
agent-device press 'label="Close Panes"' >/dev/null 2>&1
sleep 3
[ "$(on_host "tmux display-message -p -t '$SESSION' '#{window_zoomed_flag}'")" = 0 ] \
  || fail "turning the Zoom switch off did not unzoom the Window"
agent-device is exists 'label="Pane 1"' >/dev/null 2>&1 \
  || fail "unzooming should show the other Pane, not one stretched across the split"
echo "     unzoomed, and both Panes are on screen"

echo "4/5  picking a Pane keeps the Zoom the switch is still asking for"
# tmux drops a Window out of zoom the moment another of its Panes is selected,
# so Muxify has to put the preference back — every other verb already did. It
# did not, and the Session came back drawn as a split with the Zoom switch
# still reading on: the preference saying one thing and the screen another.
#
# A fresh Attach, so the preference is the Setting's again rather than the off
# check 3 left behind.
attach
expect_enabled Panes yes
open_sheet Panes
CARD=$(pane_card 2)
[ -n "$CARD" ] || fail "the Panes sheet lists no second Pane to pick"
agent-device press "$CARD" >/dev/null 2>&1
sleep 4
[ "$(on_host "tmux display-message -p -t '$SESSION:0' '#{pane_index}'")" = 1 ] \
  || fail "picking the second Pane did not make it the active one"
[ "$(on_host "tmux display-message -p -t '$SESSION:0' '#{window_zoomed_flag}'")" = 1 ] \
  || fail "picking a Pane left the Window unzoomed while Zoom was still asked for"
echo "     the picked Pane is active, and it is the one filling the Window"

echo "5/5  putting the Host back the way it was found"
agent-device close >/dev/null 2>&1
on_host "tmux kill-window -a -t '$SESSION:0' 2>/dev/null; \
    tmux kill-pane -a -t '$SESSION:0.0' 2>/dev/null; true"

echo
echo "PASS: a split Session arrives zoomed, unzooming shows a Surface per Pane,"
echo "      picking a Pane keeps it zoomed, Topology reaches the Title Sheet and"
echo "      the Panes sheet, the Key Row is in order, and the sheets and New"
echo "      Window stay reachable with one of something so more can be made."
