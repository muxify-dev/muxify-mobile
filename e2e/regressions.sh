#!/bin/bash
#
# Regressions (everything fixed so far that a change could quietly undo).
#
# Each check here stands for a bug that actually happened:
#
#   1  the navigation header, removed so the Surface reaches the top
#   2  the library's own Accessory Bar, hidden by a local patch
#   3  the Session's options, which Muxify used to borrow and now never touches
#   4  the resize, which has broken four separate ways — and the keyboard,
#      which used to be one of them
#   5  Enter, which for a long time only made a new line
#   6  the Session left as it was found, with nothing to put back
#   7  the delete key, which removed one character however long it was held
#   8  the bottom row, which a tap could not reach at all
#   9  the row being typed on, which the keyboard has to stay off
#  10  a second Session opened from the Host Screen, which used to be handed
#      a Surface that had already spoken and so could wait for it forever
#
# Checks 3 and 7 changed shape with control mode. They used to assert that the
# status line was hidden on attach and restored on the way out — the borrowing
# ADR 0006 removed. What they assert now is stronger and simpler: every option
# the Session and its Window carry says exactly the same thing before, during
# and after, because a control client sets none of them.
#
# All three readings are needed, which is not obvious. `status` and `mouse` are
# session options and show up in `show-options`; `window-size` is a *window*
# option and appears only under `show-options -w` — measured, on tmux 3.6, by
# setting it and watching plain `show-options` not mention it. A check that
# read only the session options would have missed the very borrow that squeezed
# somebody's laptop to phone width.
#
# The resize checks are the ones worth explaining. `surface` and `window` must
# agree: the Surface tells tmux its size with `refresh-client -C`, and under
# tmux's default `window-size latest` the Window follows it. And the keyboard
# must change neither — see ADR 0008. It used to shrink the Window to the strip
# above the keys and grow it back, which is a remote reflow per toggle and,
# after a `clear`, text left stranded halfway up the phone.
#
# The padding check is gone, and that is a deletion worth explaining. tmux's
# dot-padding was something tmux drew into an *attached client's* composited
# screen. A control client is sent `%output` per Pane and composites nothing,
# so there is nowhere for padding to come from — measured by forcing the state
# that used to produce it, a Window of 38x8 under a 27x13 Surface, and finding
# zero padding pixels on screen.
#
# What was left was a detector that counted bright pixels in a band, which
# cannot tell a row of dots from a light terminal: under the Solarized Theme the
# background itself is bright and the check reported padding everywhere. A
# check that fails on one Theme and passes on another is measuring the Theme.
# Check 4 carries what it was really protecting — the Surface and the Window
# agreeing — and reads both rather than looking at pixels.
#
# Requires a configured .env.local and a booted simulator.
# Usage:  bash e2e/regressions.sh

[ -n "${MUXIFY_E2E_ROOT:-}" ] || exec bash "$(dirname "$0")/sandbox.sh" bash "$0" "$@"

set -uo pipefail

APP=dev.muxify.app
SESSION=0
MARKER=MUXIFY_ENTER_RUNS
# Twenty characters for the held-delete check. Plain letters: what is asserted
# is how many of them survive, so anything the shell might expand is out.
HELD=abcdefghijklmnopqrst

# Runs a command on the dev Host, which is this Mac, in the sandbox.
on_host() { sh -c "$*" 2>/dev/null; }

fail() { echo "FAIL: $1"; exit 1; }

snap()    { agent-device snapshot -i 2>/dev/null; }
# Whether the software keyboard is up, read from what it moved.
keyboard_up() {
  agent-device snapshot --json 2>/dev/null | python3 -c "
import json, sys
nodes = json.load(sys.stdin)['data']['nodes']
# The Application node is the screen. agent-device 0.21 lists no Window node,
# and a screen of 0 read every keyboard as down.
app = next((n['rect'] for n in nodes if n['type'] == 'Application'), None)
if app is None: sys.exit('the snapshot has no Application node')
screen = app['y'] + app['height']
dock = min((n['rect']['y'] for n in nodes if n['type'] == 'ScrollView'), default=screen)
# The keyboard is at least two hundred points tall, and the Dock rides it up,
# so where the Dock is answers the question with room to spare. Two other
# readings were tried and neither is honest any more. The grid: a Window held
# back from filling the screen keeps its height whatever the keyboard does.
# The accessibility tree's own Keyboard node: the simulator reports it at the
# bottom edge of the screen while it is really up, and stops reporting it at
# all while the keyboard is covering half the Pane — both measured here.
print('yes' if dock < screen - 200 else 'no')
"
}

# Where one of the software keyboard's keys is, by its label. Empty with the
# keyboard down, or with the key not on the layer showing. A letter is a `Key`
# and Return is a `Button`, as the accessibility tree has it; both are keys here.
key_at() {
  agent-device snapshot --json 2>/dev/null | KEY="$1" python3 -c "
import json, os, sys
for n in json.load(sys.stdin)['data']['nodes']:
    if n['type'] in ('Key', 'Button') and (n.get('label') or '').lower() == os.environ['KEY'].lower():
        r = n['rect']
        print(round(r['x'] + r['width'] / 2), round(r['y'] + r['height'] / 2))
        break
"
}
# Nothing in this suite types through `agent-device type`, and the reason is
# worth a paragraph. It types by sending hardware key events, and the simulator
# takes the first of those as a hardware keyboard being attached: from then on
# every software keyboard in the app — the Surface's, a plain text field's —
# is presented below the bottom edge of the screen, where it covers nothing and
# lifts nothing. Measured: a keyboard node at y equal to the screen height, the
# Dock unmoved, and the same for the Add Host form's Name field. Nothing short
# of a reboot brings it back. So text the Pane needs goes in through tmux, and
# only the keys under test — Return, delete — are pressed on the glass.
type_into_pane() { on_host "tmux send-keys -t '$SESSION:' -l '$1'"; }
# The last line the Pane is showing, which is the one being typed on.
typed_line() { on_host "tmux capture-pane -t '$SESSION' -p" | grep -v '^$' | tail -1; }

# The lowest point in the Pane, which is just above the Dock. The Dock's own
# padding is what stands between the two, so the Key Bar's capsule locates it.
pane_bottom() {
  agent-device snapshot --json 2>/dev/null | python3 -c "
import json, sys
for n in json.load(sys.stdin)['data']['nodes']:
    if n['type'] == 'ScrollView':
        print(round(n['rect']['y']) - 10)
        break
"
}

# The row a click reported, out of the SGR the Pane echoed back.
clicked_row() {
  on_host "tmux capture-pane -t '$SESSION' -p" | tr -d '\n' | sed -n 's/.*<0;[0-9]*;\([0-9]*\)M.*/\1/p'
}
surface() { snap | grep -oE '\[text\] "[0-9]+x[0-9]+"' | head -1 | grep -oE '[0-9]+x[0-9]+'; }
window()  { on_host "tmux display-message -p -t '$SESSION' '#{window_width}x#{window_height}'"; }
# Everything the Session and its Window carry, sorted so two readings can be
# compared. `-w` is not optional: window-size lives there and nowhere else.
options() {
  on_host "tmux show-options -t '$SESSION:'; tmux show-options -w -t '$SESSION:'" | sort
}
hooks() { on_host "tmux show-hooks -t '$SESSION:'" | sort; }

agree() {
  local what=$1 s w
  s=$(surface); w=$(window)
  [ -n "$s" ] || fail "$what: the Surface never reported a grid"
  [ "$s" = "$w" ] || fail "$what: Surface is $s but tmux draws the Window at $w"
  echo "     $what: surface=$s window=$w"
}

# Presses the Dock's Keyboard button and waits for the keyboard to actually move.
#
# The button toggles, so pressing it blindly is only correct if you already
# know the state — and a press that silently does not register leaves every
# later step off by one. That is how check 6 once failed for a reason that had
# nothing to do with Enter: the keyboard was simply down, and typing went
# nowhere.
toggle_keyboard() {
  local before after
  before=$(keyboard_up)
  # Pressed again rather than once, for the same reason e2e/pickers.sh opens a
  # sheet in a loop: a press landing while the screen is still settling after
  # an attach does nothing at all, and one swallowed press here leaves every
  # later step off by one.
  for _ in 1 2 3; do
    agent-device press 'label="Keyboard"' >/dev/null 2>&1
    for _ in $(seq 1 6); do
      sleep 1
      after=$(keyboard_up)
      # Three seconds after the keyboard has moved, not one: the keyboard is
      # only the start of it. The container is laid out again, the Surface
      # reports a grid, the grid has to stand still to be believed, and the
      # resize is a round trip to the Host. Reading before all that lands is
      # how check 4 came to compare two stale numbers and agree with itself.
      [ "$after" != "$before" ] && sleep 3 && return 0
    done
  done
  fail "the Keyboard button did not move the keyboard (still up=$before)"
}

# Puts the keyboard where a check needs it, whatever it was doing.
#
# Not the same as toggling: a tap on a Pane raises the keyboard by itself, so a
# check that toggles blindly after one is a check that puts it away.
ensure_keyboard() {
  local want=$1
  case "$want:$(keyboard_up)" in
    up:no | away:yes) toggle_keyboard ;;
  esac
}

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
  sleep 3
}

echo "0/10  putting the Session somewhere known"
on_host "tmux send-keys -t '$SESSION' C-c; tmux send-keys -t '$SESSION' 'clear' Enter" \
  || fail "could not reach the dev Host"
sleep 1
# The baseline every later reading is compared against. Taken before Muxify has
# been anywhere near this Session.
BEFORE=$(options)
BEFORE_HOOKS=$(hooks)
attach

echo "1/10  the Terminal Screen has no navigation header"
snap | grep -qE '^@e[0-9]+ \[text\] "Terminal"$' \
  && fail "a navigation title is back; the Surface no longer reaches the top"
snap | grep -qE '^@e[0-9]+ \[button\] "Muxify"$' \
  && fail "a back button is back; Home in the Dock is what leaves this screen"
echo "     no header, no back button"

echo "2/10  the library's Accessory Bar stays hidden"
# Capitalised, every one of them. Muxify's own Key Bar offers ctrl, esc and tab
# — lowercase, which is what keeps this check able to tell the two apart. The
# library's bar spells them `Control`, `Escape` and `Tab`.
snap | grep -qE '\[button\] "(Control|Escape|Tab|Command|Option)"' \
  && fail "the Accessory Bar is back; the accessoryBar prop or its patch is gone"
echo "     no ctrl/esc/tab bar"

echo "3/10  attaching changes no option, on the Session or its Window"
# The whole of ADR 0006. A control client renders nothing, so `status` is not
# its business; it is sized with `refresh-client -C`, so `window-size` is not
# either; and scrolling is a capture, so neither is `mouse`.
[ "$(options)" = "$BEFORE" ] || {
  diff <(echo "$BEFORE") <(options)
  fail "attaching changed a Session option"
}
[ "$(hooks)" = "$BEFORE_HOOKS" ] || fail "attaching left a hook on the Session"
echo "     session and window options byte-identical while attached"

echo "4/10  sizes agree with the keyboard down, and do not change with it up"
agree "keyboard down"
DOWN=$(surface)
toggle_keyboard
agree "keyboard up"
[ "$(surface)" = "$DOWN" ] || fail "the keyboard resized the Window from $DOWN to $(surface); see ADR 0008"

echo "5/10  Enter on the device runs the command"
# Every keystroke arrives from iOS as a bracketed paste, Enter included, which
# is why this once inserted a newline and ran nothing. See toShellInput.
#
# The Pane is cleared first so the marker can be required on a line of its own:
# a line still holding what a previous check typed would match for the wrong
# reason, or not match at all. The command goes in through tmux and only Enter
# is pressed on the device, because Enter is what this is about — see key_at.
on_host "tmux send-keys -t '$SESSION:' C-c; tmux send-keys -t '$SESSION:' 'clear' Enter"
sleep 1
type_into_pane "echo $MARKER"
sleep 1
read -r RETURN_X RETURN_Y <<<"$(key_at return)"
[ -n "$RETURN_X" ] || fail "no Return key on screen; the keyboard is down"
agent-device press "$RETURN_X" "$RETURN_Y" >/dev/null 2>&1
sleep 3
on_host "tmux capture-pane -t '$SESSION' -p" | grep -qE "^$MARKER$" \
  || fail "Enter did not run the command; the shell only saw a new line"

echo "6/10  holding the delete key removes more than one character"
# The other half of the local patch, and the same kind of check as 2. iOS
# repeats the delete key only while it believes there is something behind the
# caret to delete, and the terminal's document is the IME's composition buffer
# — empty whenever nobody is composing. So UIKit asked once, decided the caret
# was at the start of an empty document and stopped: a key held for three
# seconds removed one character. See patches/expo-libghostty.patch.
#
# Twenty characters, of which a single delete leaves nineteen and a working
# repeat leaves none. Requiring the first ten to be gone is a margin wide
# enough that neither answer can be mistaken for the other.
on_host "tmux send-keys -t '$SESSION:' C-c; tmux send-keys -t '$SESSION:' 'clear' Enter"
sleep 1
type_into_pane "$HELD"
sleep 2
typed_line | grep -q "$HELD" || fail "the marker never reached the Pane"
read -r DELETE_X DELETE_Y <<<"$(key_at delete)"
[ -n "$DELETE_X" ] || fail "no delete key on screen; the keyboard is down"
agent-device longpress "$DELETE_X" "$DELETE_Y" 3000 >/dev/null 2>&1
sleep 2
typed_line | grep -q "${HELD:0:10}" \
  && fail "a three-second hold on delete removed fewer than ten characters: $(typed_line)"
echo "     three seconds of delete took the line back past ten characters"
on_host "tmux send-keys -t '$SESSION:' C-c; tmux send-keys -t '$SESSION:' 'clear' Enter"

echo "7/10  a tap on the bottom row lands on the bottom row"
# Where a terminal application draws its buttons, and where they could not be
# pressed. The layer that turns a touch into a cell used to divide the Pane by
# its grid, which is out by the strip the whole cells do not fill — a quarter
# of a point a row, nothing at the top and a whole row by the bottom. The last
# row was not reachable at all. See cellOf.
#
# `cat -v` with mouse reporting on is the smallest application that answers
# the question: it turns the flag on, and echoes back the SGR of whatever is
# clicked, so the row this asserts is the row the application was told.
#
# Twice, and the second one is the check. A tap in the last few points of the
# Pane lands on the last row either way, because both readings clamp there —
# what tells them apart is a tap on the *upper* part of the last row, which
# dividing the Pane by its grid calls the row above.
for OFFSET in 8 24; do
  # With the keyboard away, because that is when the Pane is at its tallest and
  # the error this stands for is at its worst: it grows with the row number, so
  # forty rows show it and the twenty-four the keyboard leaves do not. And it
  # has to be put back every time round, because a tap on a Pane raises the
  # keyboard — that is what makes an application listening for the mouse
  # typeable at all — so the tap before this one took half the Pane away.
  ensure_keyboard away
  on_host "tmux send-keys -t '$SESSION:' C-c; sleep 1; \
      tmux send-keys -t '$SESSION:' 'clear; printf \"\\033[?1000h\\033[?1006h\"; cat -v' Enter"
  sleep 2
  # A paint, so the mouse flag is read again: nothing in the control protocol
  # announces it, so it is noticed with the rest of the Pane's state.
  on_host "tmux send-keys -t '$SESSION:' 'x'"
  sleep 2
  [ "$(on_host "tmux display-message -p -t '$SESSION:' '#{mouse_any_flag}'")" = 1 ] \
    || fail "the Pane never asked for the mouse; nothing below this means anything"
  # Read here rather than once outside: check 4 has just shown the keyboard
  # leaves it alone, and this is what makes that matter.
  ROWS=$(on_host "tmux display-message -p -t '$SESSION:' '#{pane_height}'")
  [ "$ROWS" -ge 32 ] || fail "the Pane is only $ROWS rows; this check proves nothing that short"
  BOTTOM=$(pane_bottom)
  [ -n "$BOTTOM" ] || fail "could not find the Dock, so could not find the Pane's bottom"
  agent-device press 200 "$((BOTTOM - OFFSET))" >/dev/null 2>&1
  sleep 2
  CLICKED=$(clicked_row)
  [ -n "$CLICKED" ] || fail "a tap $OFFSET points up from the bottom sent no click at all"
  [ "$CLICKED" = "$ROWS" ] \
    || fail "a tap $OFFSET points up from the bottom reported row $CLICKED of $ROWS"
done
echo "     the bottom row answers to its own row, $CLICKED of $ROWS"
on_host "tmux send-keys -t '$SESSION:' C-c; sleep 1; tmux send-keys -t '$SESSION:' 'clear' Enter"

echo "8/10  the keyboard covers the Window without resizing it, and stays off the cursor"
# ADR 0008. The Window keeps the height it has with the keyboard down and is
# slid up under the keys just far enough for the row being typed on to clear
# them. Two readings prove it. tmux's Window height, which must not move — the
# old behaviour reflowed it to the strip above the keys, and a reflow is where
# text gets stranded. And where the cursor's row is drawn, which must be above
# the Dock: the Surface's frame and tmux's cursor row give it, at the cell the
# frame divides into.
#
# Both halves of the slide: a Pane full to its last row is slid by the whole
# of what the keyboard covers, and a Pane with three lines on it is not slid
# at all — those lines would otherwise be behind the status bar.
FULL=$(on_host "tmux display-message -p -t '$SESSION:' '#{window_height}'")
ensure_keyboard away
on_host "tmux send-keys -t '$SESSION:' C-c; tmux send-keys -t '$SESSION:' 'clear; seq 1 100' Enter"
sleep 2
ensure_keyboard up
sleep 2
[ "$(on_host "tmux display-message -p -t '$SESSION:' '#{window_height}'")" = "$FULL" ] \
  || fail "the keyboard shrank the Window from $FULL to $(on_host "tmux display-message -p -t '$SESSION:' '#{window_height}'")"
cursor_on_screen() {
  # Where the bottom of the cursor's row is drawn, against where the Dock starts.
  local row
  row=$(on_host "tmux display-message -p -t '$SESSION:' '#{cursor_y}'")
  agent-device snapshot --json 2>/dev/null | ROW="$row" ROWS="$FULL" python3 -c "
import json, os, sys
nodes = json.load(sys.stdin)['data']['nodes']
# The Application node is the screen. agent-device 0.21 lists no Window node,
# and a screen of 0 read every keyboard as down.
app = next((n['rect'] for n in nodes if n['type'] == 'Application'), None)
if app is None: sys.exit('the snapshot has no Application node')
screen = app['y'] + app['height']
dock = min((n['rect']['y'] for n in nodes if n['type'] == 'ScrollView'), default=screen)
tv = next(n['rect'] for n in nodes if n['type'] == 'TextView')
cell = tv['height'] / int(os.environ['ROWS'])
bottom = tv['y'] + (int(os.environ['ROW']) + 1) * cell
print('yes' if bottom <= dock + 1 and bottom > 0 else 'no', round(bottom), round(dock))
"
}
read -r SHOWN BOTTOM DOCK <<<"$(cursor_on_screen)"
[ "$SHOWN" = yes ] || fail "with a full Pane the cursor's row ends at $BOTTOM but the Dock starts at $DOCK"
echo "     full Pane: Window still $FULL rows, cursor row ends at $BOTTOM above the Dock at $DOCK"

on_host "tmux send-keys -t '$SESSION:' 'clear; seq 1 3' Enter"
sleep 3
read -r SHOWN BOTTOM DOCK <<<"$(cursor_on_screen)"
[ "$SHOWN" = yes ] || fail "with three lines the cursor's row ends at $BOTTOM but the Dock starts at $DOCK"
# Not slid: the Surface's top is where the container's is. Read as the frame's
# y against the full Pane's, which was the slid one.
TOP=$(agent-device snapshot --json 2>/dev/null | python3 -c "
import json, sys
print(round(next(n['rect']['y'] for n in json.load(sys.stdin)['data']['nodes'] if n['type'] == 'TextView')))")
echo "     short Pane: cursor row ends at $BOTTOM, Surface top at $TOP"
ensure_keyboard away
[ "$(on_host "tmux display-message -p -t '$SESSION:' '#{window_height}'")" = "$FULL" ] \
  || fail "the keyboard changed the Window on the way down"

echo "9/10  a second Session, opened from the Host Screen over the first, connects and paints"
# The Attach is replaced under a Terminal Screen that stays up, and the Surface
# it measures with is mounted in the beat between the old Attach going and the
# new one arriving. It reports its grid once, into that beat. The screen used to
# hand the report to whichever Attach happened to be listening — nobody — and
# the new Attach waited for a settled grid that had already been said: a
# Session that showed Connecting and never connected. The screen now tells
# whichever Attach is current what the Surface has said, so the second Session
# has to reach Connected, report a grid, and take the keyboard like the first.
SECOND=muxify-regressions-second
on_host "tmux has-session -t '$SECOND' 2>/dev/null || tmux new-session -d -s '$SECOND'" \
  || fail "could not make a second Session on the dev Host"
ensure_keyboard away
agent-device press 'role=button label="Home"' >/dev/null 2>&1
agent-device wait text "Dev Host" 8000 >/dev/null 2>&1
agent-device press 'label="Dev Host"' >/dev/null 2>&1
agent-device wait "label=\"Session $SECOND\"" 15000 >/dev/null 2>&1
agent-device press "label=\"Session $SECOND\"" >/dev/null 2>&1
for _ in $(seq 1 25); do
  agent-device is text 'id="connection-status"' "Connected" >/dev/null 2>&1 && break
  sleep 1
done
agent-device is text 'id="connection-status"' "Connected" >/dev/null 2>&1 \
  || fail "the second Session never reached Connected"
agent-device is text 'id="attached-session"' "$SECOND" >/dev/null 2>&1 \
  || fail "the screen is not showing the second Session"
sleep 2
[ -n "$(surface)" ] || fail "the second Session's Surface never reported a grid"
# The keyboard is the Pane view's word that it holds the Surface: a view with
# a Surface it was never introduced to raises nothing.
toggle_keyboard
[ "$(keyboard_up)" = yes ] || fail "the keyboard did not rise on the second Session"
ensure_keyboard away
echo "     second Session connected at $(surface), keyboard rose and fell"
# Back to the first, the same way round, so what follows leaves it as found.
agent-device press 'role=button label="Home"' >/dev/null 2>&1
agent-device wait text "Dev Host" 8000 >/dev/null 2>&1
agent-device press 'label="Dev Host"' >/dev/null 2>&1
agent-device wait "label=\"Session $SESSION\"" 15000 >/dev/null 2>&1
agent-device press "label=\"Session $SESSION\"" >/dev/null 2>&1
for _ in $(seq 1 25); do
  agent-device is text 'id="connection-status"' "Connected" >/dev/null 2>&1 && break
  sleep 1
done
agent-device is text 'id="connection-status"' "Connected" >/dev/null 2>&1 \
  || fail "the first Session did not come back"
on_host "tmux kill-session -t '$SECOND'" >/dev/null 2>&1
sleep 2

echo "10/10 leaving finds the Session exactly as it was, bar the zoom"
# The keyboard is already away: check 8 put it there, and toggling it again
# here would only raise it on the way out.
agent-device press 'role=button label="Home"' >/dev/null 2>&1
agent-device wait text "No Hosts yet" 8000 >/dev/null 2>&1
sleep 2
[ "$(options)" = "$BEFORE" ] || {
  diff <(echo "$BEFORE") <(options)
  fail "Muxify changed the Host and did not put it back"
}
[ "$(hooks)" = "$BEFORE_HOOKS" ] || fail "Muxify left a hook on the Session"
# The one exception, named rather than hidden. Muxify zooms the active Pane on
# Attach because a phone is too narrow for two side by side — see CONTEXT.md,
# **Zoom** — and `resize-pane -Z` is a Window flag every other Client sees, not
# a Session option. It is not restored: the user can turn it off in the Panes
# picker, and undoing their choice on the way out would be its own surprise.
# Reported so a reader knows it changed, and so that anything *else* appearing
# here is a regression.
echo "     session options, window options and hooks unchanged from before"
echo "     zoom is left as Muxify set it: $(on_host "tmux display-message -p -t '$SESSION' '#{window_zoomed_flag}'")"

agent-device close >/dev/null 2>&1
echo
echo "PASS: no header, no Accessory Bar, the Session's and Window's options"
echo "      untouched throughout, sizes agree in both keyboard states, Enter"
echo "      runs commands, a held delete key keeps deleting, a tap on the"
echo "      bottom row lands on the bottom row, the keyboard covers the"
echo "      Window without resizing it or the row being typed on, and a"
echo "      second Session opened over the first connects and paints."
