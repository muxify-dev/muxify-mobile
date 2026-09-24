#!/bin/bash
#
# Regressions (everything fixed so far that a change could quietly undo).
#
# Each check here stands for a bug that actually happened:
#
#   1  the navigation header, removed so the Surface reaches the top
#   2  the library's own Accessory Bar, hidden by a local patch
#   3  the Session's options, which Muxify used to borrow and now never touches
#   4  the resize, which has broken four separate ways
#   5  Enter, which for a long time only made a new line
#   6  the Session left as it was found, with nothing to put back
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
# tmux's default `window-size latest` the Window follows it.
#
# The padding check is gone, and that is a deletion worth explaining. tmux's
# dot-padding was something tmux drew into an *attached client's* composited
# screen. A control client is sent `%output` per Pane and composites nothing,
# so there is nowhere for padding to come from — measured by forcing the state
# that used to produce it, a Window of 38x8 under a 27x13 Surface, and finding
# zero padding pixels on screen.
#
# What was left was a detector that counted bright pixels in a band, which
# cannot tell a row of dots from a light terminal: under the Latte Theme the
# background itself is bright and the check reported padding everywhere. A
# check that fails on one Theme and passes on another is measuring the Theme.
# Check 4 carries what it was really protecting — the Surface and the Window
# agreeing — and reads both rather than looking at pixels.
#
# Requires a configured .env.local and a booted simulator.
# Usage:  bash e2e/regressions.sh

set -uo pipefail

APP=dev.muxify.app
SESSION=0
MARKER=MUXIFY_ENTER_RUNS

vm() {
  ssh -F /dev/null -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
    -i "$HOME/.orbstack/ssh/id_ed25519" -p 32222 default@127.0.0.1 "$@" 2>/dev/null
}

fail() { echo "FAIL: $1"; exit 1; }

snap()    { agent-device snapshot -i 2>/dev/null; }
surface() { snap | grep -oE '\[text\] "[0-9]+x[0-9]+"' | head -1 | grep -oE '[0-9]+x[0-9]+'; }
window()  { vm "tmux display-message -p -t '$SESSION' '#{window_width}x#{window_height}'"; }
# Everything the Session and its Window carry, sorted so two readings can be
# compared. `-w` is not optional: window-size lives there and nowhere else.
options() {
  vm "tmux show-options -t '$SESSION:'; tmux show-options -w -t '$SESSION:'" | sort
}
hooks() { vm "tmux show-hooks -t '$SESSION:'" | sort; }

agree() {
  local what=$1 s w
  s=$(surface); w=$(window)
  [ -n "$s" ] || fail "$what: the Surface never reported a grid"
  [ "$s" = "$w" ] || fail "$what: Surface is $s but tmux draws the Window at $w"
  echo "     $what: surface=$s window=$w"
}

# Presses the Dock's Keyboard button and waits for the grid to actually move.
#
# The button toggles, so pressing it blindly is only correct if you already
# know the state — and a press that silently does not register leaves every
# later step off by one. That is how check 6 once failed for a reason that had
# nothing to do with Enter: the keyboard was simply down, and typing went
# nowhere. The grid changing is the only honest signal that the keyboard did
# what was asked, so that is what is waited for.
toggle_keyboard() {
  local before after
  before=$(surface)
  agent-device press 'label="Keyboard"' >/dev/null 2>&1
  for _ in $(seq 1 10); do
    sleep 1
    after=$(surface)
    [ -n "$after" ] && [ "$after" != "$before" ] && return 0
  done
  fail "the Keyboard button did not move the grid (still $before)"
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

echo "0/6  putting the Session somewhere known"
vm "tmux send-keys -t '$SESSION' C-c; tmux send-keys -t '$SESSION' 'clear' Enter" \
  || fail "could not reach the VM"
sleep 1
# The baseline every later reading is compared against. Taken before Muxify has
# been anywhere near this Session.
BEFORE=$(options)
BEFORE_HOOKS=$(hooks)
attach

echo "1/6  the Terminal Screen has no navigation header"
snap | grep -qE '^@e[0-9]+ \[text\] "Terminal"$' \
  && fail "a navigation title is back; the Surface no longer reaches the top"
snap | grep -qE '^@e[0-9]+ \[button\] "Muxify"$' \
  && fail "a back button is back; Home in the Dock is what leaves this screen"
echo "     no header, no back button"

echo "2/6  the library's Accessory Bar stays hidden"
# `Escape` and `Command` only. The Dock's own Meta menu offers Control, Option
# and Tab, so those three no longer tell the two apart — the bar's full-word
# `Escape` and its `Command`, which Muxify has no use for, still do.
snap | grep -qE '\[button\] "(Escape|Command)"' \
  && fail "the Accessory Bar is back; the accessoryBar prop or its patch is gone"
echo "     no ctrl/esc/tab bar"

echo "3/6  attaching changes no option, on the Session or its Window"
# The whole of ADR 0006. A control client renders nothing, so `status` is not
# its business; it is sized with `refresh-client -C`, so `window-size` is not
# either; and scrolling is a capture, so neither is `mouse`.
[ "$(options)" = "$BEFORE" ] || {
  diff <(echo "$BEFORE") <(options)
  fail "attaching changed a Session option"
}
[ "$(hooks)" = "$BEFORE_HOOKS" ] || fail "attaching left a hook on the Session"
echo "     session and window options byte-identical while attached"

echo "4/6  sizes agree with the keyboard down, and again with it up"
agree "keyboard down"
toggle_keyboard
agree "keyboard up"

echo "5/6  Enter on the device runs the command"
# Every keystroke arrives from iOS as a bracketed paste, Enter included, which
# is why this once inserted a newline and ran nothing. See toShellInput.
#
# The Pane is cleared first so the marker can be required on a line of its own:
# a line still holding what a previous check typed would match for the wrong
# reason, or not match at all.
vm "tmux send-keys -t '$SESSION:' C-c; tmux send-keys -t '$SESSION:' 'clear' Enter"
sleep 1
agent-device type "echo $MARKER" >/dev/null 2>&1
sleep 1
agent-device type "
" >/dev/null 2>&1
sleep 3
vm "tmux capture-pane -t '$SESSION' -p" | grep -qE "^$MARKER$" \
  || fail "Enter did not run the command; the shell only saw a new line"

echo "6/6  leaving finds the Session exactly as it was, bar the zoom"
toggle_keyboard
sleep 1
agent-device press 'label="Home"' >/dev/null 2>&1
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
echo "     zoom is left as Muxify set it: $(vm "tmux display-message -p -t '$SESSION' '#{window_zoomed_flag}'")"

agent-device close >/dev/null 2>&1
echo
echo "PASS: no header, no Accessory Bar, the Session's and Window's options"
echo "      untouched throughout, sizes agree in both keyboard states, and"
echo "      Enter runs commands."
