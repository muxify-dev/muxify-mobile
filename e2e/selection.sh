#!/bin/bash
#
# The Selection on the Terminal Screen: a long press selects text the iOS way,
# and the system menu copies it and pastes into the Pane.
#
# What this proves, against the sandbox's Session 0:
#
#   1  a long press on a word selects it, and Copy puts it on the clipboard
#      and ends the Selection, with the keyboard left down
#   2  a handle dragged along the row makes the Selection longer
#   3  a Selection across a row that tmux wrapped copies as one line
#   4  the keyboard goes down for a Selection, and a tap outside ends the
#      Selection and brings the keyboard back
#   5  a long press where there is no text offers Paste alone, and a paste of
#      two lines runs neither
#   6  for a program that runs each line of a paste, the phone asks first
#   7  in a Pane whose program listens for the mouse, a long press starts a
#      Selection and the program gets no click
#   8  a Pane Swipe is refused while a Selection is open, and a change of
#      Pane from the Host ends the Selection
#   9  a vertical drag moves a Pane with a Selection through its Scrollback,
#      and a handle held at the top edge takes the Selection past the first
#      row that was on screen
#
# The Surface renders with Metal, so what it shows is never in the
# accessibility tree. The edit menu is, and the clipboard and the Host say
# what a Selection held and what a paste did.
#
# Requires a configured .env.local and a booted simulator.
# Usage:  bash e2e/selection.sh

[ -n "${MUXIFY_E2E_ROOT:-}" ] || exec bash "$(dirname "$0")/sandbox.sh" bash "$0" "$@"

set -uo pipefail

APP=dev.muxify.app
SESSION=0
WINDOW="$SESSION:0"
PANE="$WINDOW.0"

# Runs a command on the dev Host, which is this Mac, in the sandbox.
on_host() { sh -c "$*" 2>/dev/null; }

fail() { echo "FAIL: $1"; exit 1; }

attach() {
  agent-device close >/dev/null 2>&1
  agent-device open "$APP" --platform ios --relaunch >/dev/null 2>&1
  agent-device wait text "Dev Host" 25000 >/dev/null 2>&1
  agent-device press 'label="Host Dev Host"' >/dev/null 2>&1
  agent-device wait 'label="Edit Host"' 15000 >/dev/null 2>&1
  agent-device wait 1500 >/dev/null 2>&1  # Home is under the Host Screen until the push settles
  agent-device wait "label=\"Session $SESSION\"" 15000 >/dev/null 2>&1
  agent-device press "label=\"Session $SESSION\"" >/dev/null 2>&1
  agent-device wait 'id="pane-command"' 20000 >/dev/null 2>&1 \
    || fail "never reached Connected"
  sleep 2
}

# The Pane's lines, without the empty ones under the prompt.
pane() { on_host "tmux capture-pane -p -t '$PANE'" | grep -v '^[[:space:]]*$'; }
# A Pane with only this command's output in it, from its first row down.
show() {
  on_host "tmux send-keys -t '$PANE' C-c; tmux send-keys -t '$PANE' C-u; tmux send-keys -t '$PANE' \"clear; $1\" Enter"
  sleep 1.5
}

# One fact about the screen from the accessibility tree. See each caller.
tree() { agent-device snapshot --json 2>/dev/null | WANT="${2:-}" python3 -c "$1"; }

# The Surface area's frame, as `x y width height`.
surface_frame() {
  tree "
import json, sys
for n in json.load(sys.stdin)['data']['nodes']:
    if n.get('identifier') == 'surface-area':
        r = n['rect']; print(r['x'], r['y'], r['width'], r['height']); break
"
}

# The labels of the edit menu's items, in order, or nothing when no menu is up.
menu_items() {
  tree "
import json, sys
seen = []
for n in json.load(sys.stdin)['data']['nodes']:
    if n.get('role') == '_UIEditMenuListViewCell' and n.get('label') and n['label'] not in seen:
        seen.append(n['label'])
print(' | '.join(seen))
"
}

# Taps one item of the edit menu. By its frame: the label is on the cell and on its text.
menu_tap() {
  local at
  at=$(tree "
import json, os, sys
for n in json.load(sys.stdin)['data']['nodes']:
    if n.get('role') == '_UIEditMenuListViewCell' and n.get('label') == os.environ['WANT']:
        r = n['rect']; print(round(r['x'] + r['width'] / 2), round(r['y'] + r['height'] / 2)); break
" "$1")
  [ -n "$at" ] || return 1
  # shellcheck disable=SC2086
  agent-device press $at >/dev/null 2>&1
  sleep 1.5
}

# The software keyboard is up when its return key is on screen. See key-row.sh.
keyboard_up() {
  [ -n "$(tree "
import json, sys
for n in json.load(sys.stdin)['data']['nodes']:
    if n['type'] in ('Key', 'Button') and (n.get('label') or '').lower() == 'return':
        print('up'); break
")" ]
}

clipboard() { agent-device clipboard read 2>/dev/null; }

# The grid, from the Host, and the cell in points. The Window is zoomed, so the
# Pane's size is the Surface's. The cell is a little too big, because the grid
# does not fill the Surface: the checks keep to the first rows, where that
# stays well inside one cell.
measure() {
  read -r X0 Y0 WIDTH HEIGHT <<<"$(surface_frame)"
  [ -n "${HEIGHT:-}" ] || fail "no Surface area on screen"
  read -r COLS ROWS <<<"$(on_host "tmux display-message -p -t '$PANE' '#{pane_width} #{pane_height}'")"
}
# The middle of a cell, or a place in it: `at column row [across] [down]`, in cells.
at() {
  python3 -c "
import sys
x0, y0, w, h, cols, rows, col, row, dx, dy = map(float, sys.argv[1:])
print(round(x0 + (col + dx) * w / cols), round(y0 + (row + dy) * h / rows))
" "$X0" "$Y0" "$WIDTH" "$HEIGHT" "$COLS" "$ROWS" "$1" "$2" "${3:-0.5}" "${4:-0.5}"
}
cells() { python3 -c "import sys; print(round(float(sys.argv[1]) * float(sys.argv[2]) / float(sys.argv[3])))" "$1" "$2" "$3"; }
across() { cells "$1" "$WIDTH" "$COLS"; }
down() { cells "$1" "$HEIGHT" "$ROWS"; }

long_press() {
  # shellcheck disable=SC2046
  agent-device longpress $(at "$1" "$2") 800 >/dev/null 2>&1
  sleep 1.5
}
# A drag of the handle at the end of a Selection that ends after `column` on
# `row`. The handle's knob hangs under the row.
drag_end_handle() {
  # shellcheck disable=SC2046
  agent-device gesture pan $(at "$1" "$2" 0 1.2) "$3" "$4" 700 >/dev/null 2>&1
  sleep 1.5
}
tap_outside() {
  # shellcheck disable=SC2046
  agent-device press $(at 20 12) >/dev/null 2>&1
  sleep 1.5
}

echo "1/9  a long press on a word selects it, and Copy takes it and ends the Selection"
attach
measure
show "echo hello world; echo second line here"
agent-device clipboard write "nothing yet" >/dev/null 2>&1
keyboard_up && fail "the keyboard is up before anything asked for it"
long_press 1 0
[ "$(menu_items)" = "Copy | Paste | Look Up" ] || fail "the menu on a word is '$(menu_items)'"
menu_tap Copy
[ "$(clipboard)" = "hello" ] || fail "Copy of the word gave '$(clipboard)'"
[ -z "$(menu_items)" ] || fail "the menu is still up after Copy"
keyboard_up && fail "the keyboard came up after a Selection that began with it down"
echo "     hello is on the clipboard, the menu has gone, and the keyboard is still down"

echo "2/9  a handle dragged along the row makes the Selection longer"
long_press 1 0
drag_end_handle 5 0 "$(across 5.6)" 0
menu_tap Copy || fail "no menu after the handle drag"
[ "$(clipboard)" = "hello world" ] || fail "Copy after the drag gave '$(clipboard)'"
echo "     hello world"

echo "3/9  a Selection across a row that tmux wrapped copies as one line"
# AAAA, a space, and enough B to fill the three rows after the first one.
show "printf 'AAAA %s\\\\n' \$(printf 'B%.0s' \$(seq $((COLS * 4 - 5))))"
long_press 1 0
# iOS holds a handle on its row until the finger is about two rows away.
drag_end_handle 4 0 "$(across 2)" "$(down 3)"
menu_tap Copy || fail "no menu after the drag onto the wrapped row"
COPIED=$(clipboard)
[ "$(echo "$COPIED" | wc -l)" -eq 1 ] || fail "the wrapped row copied as more than one line: '$COPIED'"
echo "$COPIED" | grep -Eq '^AAAA B+$' || fail "the wrapped row copied as '$COPIED'"
[ "${#COPIED}" -gt "$COLS" ] || fail "the Selection did not reach the second row: '$COPIED'"
echo "     ${#COPIED} characters across $COLS columns, and no line break"

echo "4/9  the keyboard goes down for a Selection and comes back after it"
show "echo hello world"
for _ in 1 2 3; do
  keyboard_up && break
  agent-device press 'label="Keyboard"' >/dev/null 2>&1
  sleep 3
done
keyboard_up || fail "the Keyboard button did not raise the keyboard"
long_press 1 0
[ "$(menu_items)" = "Copy | Paste | Look Up" ] || fail "no Selection with the keyboard up: '$(menu_items)'"
keyboard_up && fail "the keyboard stayed up under the Selection"
tap_outside
sleep 1.5
[ -z "$(menu_items)" ] || fail "a tap outside left the menu up"
keyboard_up || fail "the keyboard did not come back after the Selection"
long_press 1 0
menu_tap Copy
[ "$(clipboard)" = "hello" ] || fail "no new Selection after a tap ended the last one"
echo "     down, a tap outside, up again"

echo "5/9  a long press on no text offers Paste, and two lines run neither"
show "true"
agent-device clipboard write $'echo one\necho two' >/dev/null 2>&1
long_press 20 12
[ "$(menu_items)" = "Paste" ] || fail "the menu where there is no text is '$(menu_items)'"
menu_tap Paste
sleep 1
agent-device is exists 'label="Allow Paste"' >/dev/null 2>&1 && fail "iOS asked to allow the paste"
[ "$(pane)" = $'$ echo one\necho two' ] || fail "the paste left this in the Pane: $(pane)"
echo "     both lines are on the prompt, neither ran, and iOS asked nothing"

echo "6/9  for a program that runs each line, the phone asks first"
on_host "tmux send-keys -t '$PANE' C-c"
show "true"
on_host "tmux send-keys -t '$PANE' \"bind 'set enable-bracketed-paste off'\" Enter; tmux send-keys -t '$PANE' 'clear' Enter"
sleep 1
long_press 20 12
menu_tap Paste || fail "no Paste in the menu"
agent-device wait 'label="Paste more than one line?"' 8000 >/dev/null 2>&1 \
  || fail "Paste of two lines did not ask before a program that runs each line"
agent-device press 'label="Cancel"' >/dev/null 2>&1
sleep 2
[ "$(pane)" = '$' ] || fail "a cancelled Paste left this in the Pane: $(pane)"
on_host "tmux send-keys -t '$PANE' \"bind 'set enable-bracketed-paste on'\" Enter"
echo "     it asked, and Cancel pasted nothing"

echo "7/9  a program that listens for the mouse: a long press selects and sends no click"
# \`cat -v\` echoes the SGR of every mouse event it is sent. See regressions.sh.
show "echo hello world; printf '\\\\033[?1000h\\\\033[?1006h'; cat -v"
sleep 1
on_host "tmux send-keys -t '$PANE' 'x'"
sleep 2
agent-device is exists 'id="mouse-layer"' >/dev/null 2>&1 || fail "no mouse layer over the Pane"
long_press 1 0
[ "$(menu_items)" = "Copy | Paste | Look Up" ] || fail "no Selection on the mouse layer: '$(menu_items)'"
agent-device is exists 'id="mouse-layer"' >/dev/null 2>&1 && fail "the mouse layer is over an open Selection"
menu_tap Copy
[ "$(clipboard)" = "hello" ] || fail "Copy on the mouse layer gave '$(clipboard)'"
[ "$(pane | grep -c '\[<')" = 0 ] || fail "the program got a click from the long press"
agent-device is exists 'id="mouse-layer"' >/dev/null 2>&1 || fail "no mouse layer after the Selection"
on_host "tmux send-keys -t '$PANE' C-c; sleep 1; tmux send-keys -t '$PANE' \"printf '\\\\033[?1006l\\\\033[?1000l'; clear\" Enter"
echo "     hello is on the clipboard, and the program got nothing"

echo "8/9  no Pane Swipe under a Selection, and a change of Pane ends it"
show "echo hello world"
SHELL_COMMAND="env PS1='\$ ' BASH_SILENCE_DEPRECATION_WARNING=1 bash --noprofile --norc"
on_host "tmux split-window -h -t '$PANE' \"$SHELL_COMMAND\"; tmux select-pane -t '$PANE'"
attach
measure
window_now() { on_host "tmux display-message -p -t '$WINDOW' '#{pane_index} #{window_zoomed_flag}'"; }
[ "$(window_now)" = "0 1" ] || fail "the Window is at '$(window_now)' after the Attach"
long_press 1 0
[ "$(menu_items)" = "Copy | Paste | Look Up" ] || fail "no Selection before the swipe: '$(menu_items)'"
# shellcheck disable=SC2046
agent-device gesture pan $(at 28 12) -150 0 300 >/dev/null 2>&1
sleep 1.5
[ "$(window_now)" = "0 1" ] || fail "a swipe changed the Pane under an open Selection"
on_host "tmux select-pane -Z -t '$WINDOW.1'"
sleep 2
[ -z "$(menu_items)" ] || fail "the Selection outlived a change of Pane"
# shellcheck disable=SC2046
agent-device gesture pan $(at 28 12) -150 0 300 >/dev/null 2>&1
sleep 1.5
[ "$(window_now)" = "0 1" ] || fail "a swipe after the Selection did not change the Pane: $(window_now)"
on_host "tmux kill-pane -t '$WINDOW.1'"
sleep 2
echo "     the swipe waited for the Selection to end"

echo "9/9  a Selection goes into the Scrollback, by a drag and by a handle at the edge"
measure
show "seq 1000 1300"
scrolled_back() { agent-device is exists 'id="scroll-position"' >/dev/null 2>&1; }
# The number in the first row. 1300 is on the row above the prompt.
TOP=$((1300 - (ROWS - 2)))
SELECTED=$((TOP + 3))
long_press 1 3
[ "$(menu_items)" = "Copy | Paste | Look Up" ] || fail "no Selection on a number: '$(menu_items)'"
# Off the handles: the Pane moves under the Selection.
# shellcheck disable=SC2046
agent-device gesture pan $(at 25 6) 0 "$(down 6)" 400 >/dev/null 2>&1
sleep 2
scrolled_back || fail "a vertical drag with a Selection open did not move the Scrollback"
tap_outside
[ -z "$(menu_items)" ] || fail "a tap outside left the menu up in the Scrollback"
agent-device press 'label="Jump to latest"' >/dev/null 2>&1
sleep 1.5
scrolled_back && fail "the Pane did not go back to the live bottom"
# With the keyboard up the Window is slid, and the first row is not on screen.
for _ in 1 2 3; do
  keyboard_up || break
  agent-device press 'label="Keyboard"' >/dev/null 2>&1
  sleep 3
done
keyboard_up && fail "the Keyboard button did not put the keyboard down"

long_press 1 3
# The start handle, from its row to above the Surface, slowly: it is held at
# the top edge for the last part of the way.
read -r HANDLE_X HANDLE_Y <<<"$(at 0 3 0.4 0.3)"
agent-device gesture pan "$HANDLE_X" "$HANDLE_Y" 30 "$(python3 -c "print(round($Y0 - 20 - $HANDLE_Y))")" 6000 >/dev/null 2>&1
sleep 2
scrolled_back || fail "a handle held at the top edge did not move the Scrollback"
menu_tap Copy || fail "no menu after the handle was let go at the edge"
COPIED=$(clipboard)
FIRST=$(($(echo "$COPIED" | sed -n 2p) - 1))
LAST=$(echo "$COPIED" | tail -1)
[ "$LAST" = "$SELECTED" ] || fail "the Selection ends at '$LAST', not at $SELECTED"
[ "$FIRST" -lt "$TOP" ] || fail "the Selection starts at $FIRST, not above $TOP, the first row on screen before the drag"
[ "$(echo "$COPIED" | wc -l)" -eq $((LAST - FIRST + 1)) ] || fail "the copy does not have one line for each number"
echo "     $FIRST to $LAST: $((TOP - FIRST)) lines above the first row that was on screen"

echo
echo "PASS: a long press selects text on the Surface, the handles and the edges"
echo "      take the Selection across rows and into the Scrollback, Copy gives the"
echo "      text as it was typed, and Paste goes in without a prompt and runs nothing."
